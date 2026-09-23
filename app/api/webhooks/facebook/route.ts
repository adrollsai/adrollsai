import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification, sendAdminMultiChannelNotification } from '@/utils/notification-helper'
import { sendCAPIEvent, callGemini, callGeminiWithUsage } from '@/utils/external-apis'
import { createOpenAI } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'
import { generateText, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { triggerWelcomeDrip, sendInstantFormCatalogMessage } from '@/utils/whatsapp/drips'
import { bookAppointment, triggerOutboundCall } from '@/utils/voice-helper'
import { deductCreditsByCost, calculateLLMCost } from '@/utils/credits'
import { createCreativeSessionToken } from '@/utils/creative-token'
import { updateLeadScoreInDB, parseCustomFields } from '@/utils/lead-scoring'
import { matchesCampaignRule } from '@/utils/campaign-matcher'
import { executeFlowRunner } from '@/utils/whatsapp/flow-runner'
import { processLeadEvent } from '@/lib/agent/lead-orchestrator'
import { processOwnerMessage, transcribeVoiceNote } from '@/lib/agent/owner-orchestrator'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  console.log(`🔗 WEBHOOK VERIFY ATTEMPT: mode=${mode}, token=${token}`)

  const VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'adrolls_secure_webhook_token'

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED")
    return new Response(challenge, { status: 200 })
  }
  console.error("❌ WEBHOOK VERIFICATION FAILED: Token Mismatch")
  return new Response('Forbidden', { status: 403 })
}

// Bypassing RLS with Admin Key because Webhooks lack user cookies
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const processedMessageIds = new Set<string>();
const activeProcessingLeadIds = new Set<string>();

function isUuid(val: any): boolean {
    return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

function isRealPublicImageUrl(url: string | null | undefined): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (lower.includes('placehold.co') || lower.includes('placeholder') || lower.includes('via.placeholder')) {
        return false;
    }
    return url.startsWith('http://') || url.startsWith('https://');
}

async function getNextRoundRobinAgent(supabaseAdmin: any, agentIds: string[]) {
    if (!agentIds || agentIds.length === 0) return null;
    if (agentIds.length === 1) return agentIds[0];

    const { data: lastLeads } = await supabaseAdmin
        .from('leads')
        .select('assigned_to, created_at')
        .in('assigned_to', agentIds)
        .order('created_at', { ascending: false })
        .limit(200);
        
    const agentLastAssigned = agentIds.reduce((acc: any, id: string) => { acc[id] = 0; return acc; }, {});
    if (lastLeads) {
        lastLeads.forEach((l: any) => {
            if (l.assigned_to && agentIds.includes(l.assigned_to) && agentLastAssigned[l.assigned_to] === 0) {
                agentLastAssigned[l.assigned_to] = new Date(l.created_at).getTime();
            }
        });
    }
    
    let selectedAgent = agentIds[0];
    let oldestTime = Infinity;
    for (const agentId of agentIds) {
        const time = agentLastAssigned[agentId];
        if (time === 0) return agentId; // Never assigned recently, pick immediately
        if (time < oldestTime) {
            oldestTime = time;
            selectedAgent = agentId;
        }
    }
    return selectedAgent;
}

async function sendTypingIndicator(waPhoneId: string, waToken: string, messageId: string) {
    if (!waPhoneId || !waToken || !messageId) return;
    try {
        fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${waToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId,
                typing_indicator: {
                    type: 'text'
                }
            })
        }).catch(err => {
            console.warn('[sendTypingIndicator] Non-blocking notice:', err?.message);
        });
    } catch (e) {
        // Non-blocking
    }
}

async function extractLeadNameWithAI(rawText: string): Promise<{ hasName: boolean; name: string | null; isQuestionOrRefusal: boolean }> {
    const raw = (rawText || '').trim();
    if (!raw || raw.length < 2) {
        return { hasName: false, name: null, isQuestionOrRefusal: false };
    }

    // 1. Zero-latency heuristic fast path for clean names (e.g. "Rahul", "Adinath Pawar", "Dr. Mehta", "my name is Rahul Sharma")
    const lower = raw.toLowerCase();
    const refusalOrQuestionWords = /\b(what|price|cost|budget|rate|rates|brochure|detail|details|location|where|kahan|kitna|batao|send|bhejo|call|expert|appointment|visit|why|no|nahi|na|later|stop|bye|hi|hello|hey|yes|haan|ok|okay|broker|developer|agent|inventory|flat|villa|plot|commercial|residential|interested|interest|looking|share|tell|info|information|catalog|catalogue)\b/i;

    // Explicit rejection for common button texts and phrases that are never person names
    if (/^(interested|i am interested|im interested|yes interested|tell me more|more info|view properties|view products|talk to an expert|book an appointment|not interested|stop|cancel|unsubscribe)[!.]*$/i.test(raw)) {
        return { hasName: false, name: null, isQuestionOrRefusal: false };
    }

    if (!raw.includes('?') && !refusalOrQuestionWords.test(lower)) {
        const stripped = raw.replace(/^(my name is|i am|this is|name\s*:|mera naam|call me)\s*/i, '').trim();
        const words = stripped.split(/\s+/).filter(Boolean);
        if (words.length >= 1 && words.length <= 4 && /^[a-zA-Z\s.]{2,40}$/.test(stripped)) {
            const titleCased = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            return { hasName: true, name: titleCased, isQuestionOrRefusal: false };
        }
    }

    const dsKey = process.env.DEEPSEEK_API_KEY || 'sk-20cf24c78eeb44669f22cd92b2d0382f';
    const prompt = `You are an entity extractor. A WhatsApp bot asked: "May I know your good name please?".
The user replied: "${raw}"

Task:
1. Determine if the user provided their name (e.g. "My name is Rahul", "Rahul", "my name is rahul sharma", "mera naam Gaurav hai", "Rahul Sharma here from Mohali", "Dr. Mehta", "call me Rohan", "Amit").
   - If YES: Extract ONLY the clean, Title-Cased person's name (e.g. "Rahul", "Rahul Sharma", "Gaurav Sharma"). Remove all filler words ("my name is", "mera naam", "here", "from Mohali", "i am", "call me", "hai", "this is").
   - Set "has_name": true, "name": "<Clean Title-Cased Name>", "is_question_or_refusal": false.
2. If the user did NOT provide a name (e.g. they asked a question "what is the price?", "send brochure first", "location?", or said "why?", "no", "nahi", "pehle details do"):
   - Set "has_name": false, "name": null, "is_question_or_refusal": true.

Return ONLY a valid JSON object without markdown formatting:
{"has_name": boolean, "name": string | null, "is_question_or_refusal": boolean}`;

    try {
        let content = '';

        // Priority 1: Fast Gemini Flash if configured (typically <400ms)
        if (process.env.GEMINI_API_KEY) {
            try {
                const geminiPromise = callGeminiWithUsage(prompt);
                const timeoutPromise = new Promise<{ text: string }>((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), 2200));
                const res = await Promise.race([geminiPromise, timeoutPromise]);
                content = res.text || '';
            } catch (gErr: any) {
                console.warn('[extractLeadNameWithAI] Gemini fast path timeout/error:', gErr?.message);
            }
        }

        // Priority 2: DeepSeek with strict 2.5s timeout
        if (!content && dsKey) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2500);
                const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${dsKey}`
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.1
                    })
                });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const data = await res.json();
                    content = data.choices?.[0]?.message?.content || '';
                }
            } catch (dsErr: any) {
                console.warn('[extractLeadNameWithAI] DeepSeek fetch timeout/failed:', dsErr?.message);
            }
        }

        if (content) {
            const cleanJson = content.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            if (parsed && typeof parsed.has_name === 'boolean') {
                return {
                    hasName: !!parsed.has_name && !!parsed.name,
                    name: parsed.name ? String(parsed.name).trim() : null,
                    isQuestionOrRefusal: !!parsed.is_question_or_refusal
                };
            }
        }
    } catch (err) {
        console.error('[extractLeadNameWithAI] Error parsing AI response:', err);
    }

    // Heuristic fallback if AI is completely unavailable
    const cleaned = raw.replace(/^(my name is|i am|this is|name:|mera naam|call me)\s*/i, '').split('\n')[0].trim().slice(0, 40);
    if (cleaned.includes('?') || cleaned.split(' ').length > 4 || /\b(price|brochure|location|details|kahan|cost|budget|rates|no|nahi)\b/i.test(cleaned)) {
        return { hasName: false, name: null, isQuestionOrRefusal: true };
    }
    const titleCased = cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return { hasName: titleCased.length >= 2, name: titleCased, isQuestionOrRefusal: false };
}

async function logPastWhatsAppHistory(supabaseAdmin: any, chatId: string, leadId: string, cutoffCreatedAt: string | null) {
  try {
    let query = supabaseAdmin
      .from('whatsapp_messages')
      .select('*')
      .eq('chat_id', chatId);
      
    if (cutoffCreatedAt) {
      query = query.lt('created_at', cutoffCreatedAt);
    }
    
    const { data: messages, error } = await query.order('created_at', { ascending: true });
    
    if (error || !messages || messages.length === 0) return;
    
    const historyItems: any[] = [];
    let i = 0;
    while (i < messages.length) {
      const current = messages[i];
      if (current.direction === 'inbound') {
        const user_msg = current.message_text;
        let bot_reply = '';
        const nextMsg = messages[i + 1];
        if (nextMsg && nextMsg.direction === 'outbound') {
          bot_reply = nextMsg.message_text;
          i += 2;
        } else {
          i += 1;
        }
        
        historyItems.push({
          lead_id: leadId,
          action_type: 'WHATSAPP_CHAT',
          description: `💬 WA_JSON:${JSON.stringify({ user_msg, bot_reply, booking_time: null })}`,
          created_at: current.created_at
        });
      } else {
        historyItems.push({
          lead_id: leadId,
          action_type: 'WHATSAPP_CHAT',
          description: `💬 WA_JSON:${JSON.stringify({ user_msg: '', bot_reply: current.message_text, booking_time: null })}`,
          created_at: current.created_at
        });
        i += 1;
      }
    }
    
    if (historyItems.length > 0) {
      await supabaseAdmin.from('lead_history').insert(historyItems);
      console.log(`[Flow] Successfully back-populated ${historyItems.length} history logs for lead ${leadId}`);
    }
  } catch (e) {
    console.error('[Flow] Error back-populating WhatsApp history logs:', e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log("📥 WEBHOOK RECEIVED:", JSON.stringify(body, null, 2))

    // Forward webhook if FORWARD_WEBHOOK_URL is configured
    const forwardUrl = process.env.FORWARD_WEBHOOK_URL;
    let forwardPromise: Promise<any> | null = null;
    if (forwardUrl) {
      console.log(`🔗 Forwarding webhook payload to: ${forwardUrl}`);
      forwardPromise = fetch(forwardUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      }).then((res) => {
        console.log(`✅ Webhook forward status: ${res.status}`);
        return res;
      }).catch((err) => {
        console.error(`❌ Webhook forward error:`, err);
      });
    }

    if (body.object !== 'page' && body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ success: true }, { status: 200 })
    }

    if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry) {
            for (const change of entry.changes) {
                if (change.field === 'messages') {
                    const val = change.value;
                    const statuses = val.statuses || [];
                    if (statuses.length > 0) {
                        for (const statusObj of statuses) {
                            if (statusObj.errors && statusObj.errors.length > 0) {
                                console.error(`[WHATSAPP WEBHOOK STATUS ERROR] Message ID: ${statusObj.id}, Errors:`, JSON.stringify(statusObj.errors, null, 2));
                                const firstErr = statusObj.errors[0];
                                const recipient = (statusObj.recipient_id || '').replace(/\D/g, '');
                                const phoneDigits = recipient.slice(-10);

                                if (phoneDigits) {
                                    try {
                                        // Find chat for this recipient
                                        const { data: chat } = await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .select('id, lead_id')
                                            .ilike('recipient_phone', `%${phoneDigits}%`)
                                            .order('updated_at', { ascending: false })
                                            .limit(1)
                                            .maybeSingle();

                                        if (chat) {
                                            // Find most recent outbound message in this chat
                                            const { data: lastOutbound } = await supabaseAdmin
                                                .from('whatsapp_messages')
                                                .select('id, message_text')
                                                .eq('chat_id', chat.id)
                                                .eq('direction', 'outbound')
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .maybeSingle();

                                            const errReason = firstErr.code === 131049 
                                                ? 'Meta marketing frequency limit reached for recipient'
                                                : (firstErr.message || firstErr.title || 'Delivery failed');

                                            // Update broadcast recipient status cleanly in DB without corrupting chat bubble text
                                            await supabaseAdmin
                                                .from('whatsapp_broadcast_recipients')
                                                .update({ status: 'failed', error_message: `Error ${firstErr.code}: ${errReason}` })
                                                .ilike('phone_number', `%${phoneDigits}%`)
                                                .eq('status', 'sent');

                                            if (chat.lead_id) {
                                                await supabaseAdmin.from('lead_history').insert({
                                                    lead_id: chat.lead_id,
                                                    action_type: 'WHATSAPP_CHAT',
                                                    description: `⚠️ WhatsApp Delivery Failed: Error ${firstErr.code} - ${firstErr.title || firstErr.message || 'Delivery error'}`
                                                });
                                            }
                                        }
                                    } catch (err) {
                                        console.error('[WHATSAPP WEBHOOK] Error annotating failed message:', err);
                                    }
                                }
                            }
                        }
                    }

                    const messages = val.messages || [];
                      for (const message of messages) {
                        const msgId = message.id;
                        if (msgId) {
                            if (processedMessageIds.has(msgId)) {
                                console.log(`[Facebook Webhook] Skipping duplicate message ID (in-memory): ${msgId}`);
                                continue;
                            }
                            processedMessageIds.add(msgId);
                            if (processedMessageIds.size > 1000) {
                                processedMessageIds.clear();
                            }

                            // Persistent cross-instance serverless deduplication
                            try {
                                const { data: existingMsg } = await supabaseAdmin
                                    .from('processed_webhook_messages')
                                    .select('message_id')
                                    .eq('message_id', msgId)
                                    .maybeSingle();

                                if (existingMsg) {
                                    console.log(`[Facebook Webhook] Skipping duplicate message ID (database): ${msgId}`);
                                    continue;
                                }

                                await supabaseAdmin
                                    .from('processed_webhook_messages')
                                    .insert({ message_id: msgId });
                            } catch (dbDedupErr) {
                                // Non-blocking fallback to in-memory set if table or network unavailable
                                console.warn('[Facebook Webhook] DB dedup check warning:', dbDedupErr);
                            }
                        }

                        const fromPhone = message.from; 
                        const isInteractive = message.type === 'interactive';
                        const isButton = message.type === 'button';
                        const buttonReplyId = isInteractive 
                          ? (message.interactive?.button_reply?.id || message.interactive?.list_reply?.id) 
                          : isButton 
                          ? (message.button?.payload || message.button?.text) 
                          : null;
                        const buttonReplyTitle = isInteractive 
                          ? (message.interactive?.button_reply?.title || message.interactive?.list_reply?.title) 
                          : isButton 
                          ? (message.button?.text || message.button?.payload) 
                          : null;
                        const listReplyTitle = isInteractive ? message.interactive?.list_reply?.title : null;

                        // Support WhatsApp Flows (nfm_reply)
                        const isNfmReply = isInteractive && message.interactive?.type === 'nfm_reply';
                        let nfmSelectedCreatives: string[] = [];
                        let nfmFlowText = '';
                        if (isNfmReply && message.interactive?.nfm_reply?.response_json) {
                            try {
                                const parsedNfm = JSON.parse(message.interactive.nfm_reply.response_json);
                                if (parsedNfm.selected_creatives) {
                                    nfmSelectedCreatives = Array.isArray(parsedNfm.selected_creatives)
                                        ? parsedNfm.selected_creatives
                                        : [parsedNfm.selected_creatives];
                                    nfmFlowText = `I have selected and submitted ${nfmSelectedCreatives.length} creative(s) from my library using the WhatsApp Flow: ${nfmSelectedCreatives.join(', ')}. Please attach them to my campaign draft.`;
                                    console.log(`🎨 [NFM Flow Reply] Extracted ${nfmSelectedCreatives.length} creative(s):`, nfmSelectedCreatives);
                                }
                            } catch (nfmErr) {
                                console.error('❌ [NFM JSON Parse Error]:', nfmErr);
                            }
                        }
                        
                        // Handle media messages (image, video, document, audio, sticker)
                        const mediaTypes = ['image', 'video', 'document', 'audio', 'sticker'];
                        const isMediaMessage = mediaTypes.includes(message.type);
                        let inboundMediaUrl: string | null = null;
                        let inboundMediaType: string | null = null;
                        let mediaCaption = '';

                        if (isMediaMessage) {
                            inboundMediaType = message.type;
                            const mediaObj = message[message.type]; // e.g. message.image, message.video
                            mediaCaption = mediaObj?.caption || '';
                            const mediaId = mediaObj?.id;
                            
                            if (mediaId) {
                                // Resolve the media download URL from Meta Graph API
                                // We need the WABA token from the profile matched below, so we store media ID and resolve later
                                inboundMediaUrl = `__media_id__:${mediaId}`; // Placeholder, resolved after profile match
                            }
                        }

                        let messageText = buttonReplyTitle || listReplyTitle || nfmFlowText || message.text?.body || mediaCaption || (isMediaMessage ? `[${message.type}]` : '');

                        
                        console.log(`💬 Received message from ${fromPhone}: "${messageText}"${isMediaMessage ? ` [media: ${message.type}]` : ''}`);
                        if (!messageText && !isMediaMessage) continue;
                        
                        const cleanFrom = fromPhone.replace(/\D/g, '');
                        const cleanFromDigits = cleanFrom.slice(-10);
                        const wabaPhoneId = val.metadata?.phone_number_id || '';
                        const masterPhoneId = process.env.DEV_WHATSAPP_PHONE_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
                        const isMessageToOfficialBot = !wabaPhoneId || (masterPhoneId && wabaPhoneId === masterPhoneId);
                        
                        // Look up matched profile by personal notification number (filtered by phone digits to avoid slow full-table scan)
                        const { data: profiles } = cleanFromDigits ? await supabaseAdmin
                            .from('profiles')
                            .select('id, role, parent_id, agency_id, business_name, address, business_info, contact_number, whatsapp_phone_number, whatsapp_personal_number, whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token, ad_account_id, selected_page_id, currency, custom_domain')
                            .or(`whatsapp_personal_number.ilike.%${cleanFromDigits}%,contact_number.ilike.%${cleanFromDigits}%,whatsapp_phone_number.ilike.%${cleanFromDigits}%`)
                            : { data: [] };
                            
                        const matchedProfile = profiles?.find((p: any) => {
                            const rawPersonal = p.whatsapp_personal_number || '';
                            const cleanPersonal = rawPersonal.replace(/\D/g, '');
                            if (!cleanPersonal) return false;
                            
                            const cleanPersonalDigits = cleanPersonal.slice(-10);
                            const phoneMatch = cleanPersonal === cleanFrom || 
                                               (cleanPersonalDigits.length === 10 && cleanFromDigits === cleanPersonalDigits);
                                               
                            if (!phoneMatch) return false;

                            // If message arrived at Official Nobogent Master Bot, ANY registered personal number is valid!
                            if (isMessageToOfficialBot) {
                                return true;
                            }

                            // If message arrived at a specific agency WABA, match if it's their WABA
                            if (wabaPhoneId && p.whatsapp_phone_number_id) {
                                return p.whatsapp_phone_number_id === wabaPhoneId;
                            }
                            return true;
                        });
                        
                        if (matchedProfile) {
                            console.log(`🤖 MATCHED PROFILE: ${matchedProfile.business_name} (User: ${matchedProfile.id})`);
                            
                            // If user selected creatives via WhatsApp Flow, automatically attach them to active campaign draft
                            if (nfmSelectedCreatives && nfmSelectedCreatives.length > 0) {
                                try {
                                    const { data: latestDraft } = await supabaseAdmin
                                        .from('campaign_jobs')
                                        .select('id, payload')
                                        .eq('user_id', matchedProfile.id)
                                        .eq('status', 'draft')
                                        .order('created_at', { ascending: false })
                                        .limit(1)
                                        .maybeSingle();

                                    if (latestDraft) {
                                        const p = latestDraft.payload || {};
                                        const cUrls: string[] = Array.isArray(p.creativeUrls || p.creative_urls)
                                            ? [...(p.creativeUrls || p.creative_urls)]
                                            : [];
                                        nfmSelectedCreatives.forEach((u: string) => {
                                            if (!cUrls.includes(u)) cUrls.push(u);
                                        });
                                        await supabaseAdmin.from('campaign_jobs').update({
                                            payload: { ...p, creative_urls: cUrls, creativeUrls: cUrls },
                                            updated_at: new Date().toISOString()
                                        }).eq('id', latestDraft.id);
                                        console.log(`✅ [NFM Flow Auto-Attach] Attached ${nfmSelectedCreatives.length} creative(s) to draft campaign ${latestDraft.id}`);
                                    }
                                } catch (nfmAttachErr) {
                                    console.error('❌ [NFM Flow Auto-Attach Error]:', nfmAttachErr);
                                }
                            }
                            
                            // Database helper functions for agentic bot tools (declared as const to avoid block-scope syntax issues)
                            const dbSearchLeads = async (userId: string, query: string) => {
                                 console.log(`🔍 dbSearchLeads triggered with query: "${query}" for userId: ${userId}`);
                                 const cleanQuery = query.trim();
                                 if (!cleanQuery) return [];

                                 const words = cleanQuery.split(/\s+/).filter(w => w.length > 1);
                                 if (words.length === 0) {
                                     const { data: matched } = await supabaseAdmin
                                         .from('leads')
                                         .select('id, name, phone, email, pipeline_stage, notes, source, created_at')
                                         .eq('user_id', userId)
                                         .or(`name.ilike.%${cleanQuery}%,email.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%`);
                                     return matched || [];
                                 }

                                 const conditions: string[] = [];
                                 for (const word of words) {
                                     conditions.push(`name.ilike.%${word}%`);
                                 }
                                 conditions.push(`email.ilike.%${cleanQuery}%`);
                                 conditions.push(`phone.ilike.%${cleanQuery}%`);

                                 const orCondition = conditions.join(',');
                                 console.log(`🔍 Constructed OR condition: ${orCondition}`);

                                 const { data: matchedLeads, error } = await supabaseAdmin
                                     .from('leads')
                                     .select('id, name, phone, email, pipeline_stage, notes, source, created_at')
                                     .eq('user_id', userId)
                                     .or(orCondition);

                                 if (error) {
                                     console.error("❌ dbSearchLeads error:", error);
                                     return [];
                                 }

                                 console.log(`🔍 dbSearchLeads found ${matchedLeads?.length || 0} leads`);
                                 return matchedLeads || [];
                             };

                            const dbGetLeadDetails = async (userId: string, leadId: string) => {
                                const { data: lead } = await supabaseAdmin
                                    .from('leads')
                                    .select('id, name, phone, email, pipeline_stage, notes, source, created_at')
                                    .eq('user_id', userId)
                                    .eq('id', leadId)
                                    .maybeSingle();
                                return lead || null;
                            };

                            const dbGetLeadWhatsAppHistory = async (userId: string, leadId: string) => {
                                const { data: chat } = await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .select('id')
                                    .eq('user_id', userId)
                                    .eq('lead_id', leadId)
                                    .maybeSingle();

                                if (!chat) return [];

                                const { data: messages } = await supabaseAdmin
                                    .from('whatsapp_messages')
                                    .select('direction, message_text, created_at')
                                    .eq('chat_id', chat.id)
                                    .order('created_at', { ascending: false })
                                    .limit(20);

                                return messages ? messages.reverse() : [];
                            };

                            const dbGetLeadsByStage = async (userId: string, stage: string) => {
                                const { data: leads } = await supabaseAdmin
                                    .from('leads')
                                    .select('id, name, phone, email, pipeline_stage, created_at')
                                    .eq('user_id', userId)
                                    .eq('pipeline_stage', stage)
                                    .limit(10);
                                return leads || [];
                            };
                            
                            // Process and wait to ensure Vercel does not freeze execution before completion
                            await (async () => {
                                try {
                                    let ownerChat: any = null;
                                    try {
                                        const { data: existingChat } = await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .select('id')
                                            .eq('user_id', matchedProfile.id)
                                            .eq('recipient_phone', cleanFrom)
                                            .maybeSingle();

                                        if (!existingChat) {
                                            const { data: newChat } = await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .insert({
                                                    user_id: matchedProfile.id,
                                                    recipient_phone: cleanFrom,
                                                    recipient_name: matchedProfile.business_name + " (Owner)",
                                                    last_message_text: messageText,
                                                    unread_count: 0
                                                })
                                                .select('id')
                                                .single();
                                            ownerChat = newChat;
                                        } else {
                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({
                                                    last_message_text: messageText,
                                                    updated_at: new Date().toISOString()
                                                })
                                                .eq('id', existingChat.id);
                                            ownerChat = existingChat;
                                        }

                                        if (ownerChat) {
                                            const ownerToken = isMessageToOfficialBot
                                                ? (process.env.DEV_WHATSAPP_ACCESS_TOKEN || matchedProfile.whatsapp_access_token || matchedProfile.facebook_token)
                                                : (matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN);

                                            // Resolve media URL for owner messages if needed
                                            if (isMediaMessage && inboundMediaUrl?.startsWith('__media_id__:')) {
                                                if (ownerToken) {
                                                    const mediaId = inboundMediaUrl.replace('__media_id__:', '');
                                                    try {
                                                        const mediaInfoRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
                                                            headers: { 'Authorization': `Bearer ${ownerToken}` }
                                                        });
                                                        if (mediaInfoRes.ok) {
                                                            const mediaInfo = await mediaInfoRes.json();
                                                            inboundMediaUrl = mediaInfo.url || null;
                                                        }
                                                    } catch (mediaErr) {
                                                        console.error(`[Flow] Error resolving owner media URL:`, mediaErr);
                                                    }
                                                }
                                            }

                                            // If the owner sent an image, download from Meta and upload to Cloudflare R2 for a permanent public URL
                                            if (inboundMediaType === 'image' && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:') && ownerToken) {
                                                try {
                                                    console.log(`📸 Uploading owner image to Cloudflare R2 Storage...`);
                                                    const imgFetchRes = await fetch(inboundMediaUrl, {
                                                        headers: { 'Authorization': `Bearer ${ownerToken}` }
                                                    });
                                                    if (imgFetchRes.ok) {
                                                        const imgBuffer = await imgFetchRes.arrayBuffer();
                                                        const r2Key = `inventory/${matchedProfile.id}/${Date.now()}_img.jpg`;
                                                        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
                                                        const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');

                                                        await r2.send(new PutObjectCommand({
                                                            Bucket: R2_BUCKET,
                                                            Key: r2Key,
                                                            Body: Buffer.from(imgBuffer),
                                                            ContentType: 'image/jpeg'
                                                        }));

                                                        const publicBase = (R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev').replace(/\/$/, '');
                                                        const r2Url = `${publicBase}/${r2Key}`;
                                                        inboundMediaUrl = r2Url;
                                                        console.log(`✅ [Owner Image Uploaded to Cloudflare R2]: ${r2Url}`);
                                                    }
                                                } catch (imgErr) {
                                                    console.error("❌ Failed to process owner image to R2:", imgErr);
                                                }
                                            }

                                            // If the owner sent a voice note, transcribe it via Gemini
                                            if (inboundMediaType === 'audio' && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:') && ownerToken) {
                                                try {
                                                    console.log(`🎙️ Transcribing owner voice note from Meta media URL...`);
                                                    const audioFetchRes = await fetch(inboundMediaUrl, {
                                                        headers: { 'Authorization': `Bearer ${ownerToken}` }
                                                    });
                                                    if (audioFetchRes.ok) {
                                                        const audioBuffer = await audioFetchRes.arrayBuffer();
                                                        const { GoogleGenerativeAI } = await import('@google/generative-ai');
                                                        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '');
                                                        const geminiModel = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
                                                        const audioBase64 = Buffer.from(audioBuffer).toString('base64');
                                                        const sttRes = await geminiModel.generateContent([
                                                            {
                                                                inlineData: {
                                                                    data: audioBase64,
                                                                    mimeType: 'audio/ogg'
                                                                }
                                                            },
                                                            "Accurately transcribe the spoken voice note into text. The speaker may speak in English, Hindi, Hinglish, Punjabi, or other regional languages. Transcribe the speech faithfully into natural Latin/English text (or Hinglish) so operational instructions can be understood clearly by the AI. Return ONLY the transcription text, nothing else."
                                                        ]);
                                                        const transcribed = sttRes.response.text().trim();
                                                        if (transcribed) {
                                                            console.log(`🎙️ [Owner Voice Note Transcribed]: "${transcribed}"`);
                                                            messageText = transcribed;
                                                        }
                                                    }
                                                } catch (audioErr) {
                                                    console.error("❌ Failed to transcribe owner voice note:", audioErr);
                                                }
                                            }

                                            const ownerMsgInsert: any = {
                                                chat_id: ownerChat.id,
                                                direction: 'inbound',
                                                message_text: messageText || `[${inboundMediaType || 'media'}]`
                                            };
                                            if (inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:')) {
                                                ownerMsgInsert.media_url = inboundMediaUrl;
                                            }
                                            if (inboundMediaType) ownerMsgInsert.media_type = inboundMediaType;
                                            await supabaseAdmin
                                                .from('whatsapp_messages')
                                                .insert(ownerMsgInsert);
                                        }
                                    } catch (dbErr) {
                                        console.error("❌ Failed to log owner message to DB:", dbErr);
                                    }
                                    
                                    let botResponseText = "Hello! I received your message, but I encountered an error while processing your request. Please try again.";
                                    let ownerUsage = { promptTokens: 500, completionTokens: 250, modelName: "deepseek-chat" };

                                    try {
                                        console.log(`🤖 [Owner Orchestrator] Executing processOwnerMessage for owner: ${matchedProfile.business_name} (${matchedProfile.id})`);
                                        botResponseText = await processOwnerMessage({
                                            userId: matchedProfile.id,
                                            messageText: messageText,
                                            fromPhone: cleanFrom,
                                            mediaUrl: inboundMediaUrl || undefined,
                                            mediaType: inboundMediaType || undefined
                                        });
                                        botResponseText = (botResponseText || '').trim();
                                        if (!botResponseText) {
                                            botResponseText = "Hi! I checked your request and updated the system. Let me know if you would like more details.";
                                        }
                                        console.log(`🤖 Final processed response: "${botResponseText.substring(0, 100)}..."`);
                                    } catch (llmErr: any) {
                                        console.error("❌ processOwnerMessage failed:", llmErr?.message || llmErr);
                                        botResponseText = "Hi! I ran into an issue processing that request. Please try again in a moment.";
                                    }
                                    botResponseText = (botResponseText || '').trim() || "Hi! Your request has been noted.";
                                    // Dynamic billing for owner query
                                    const ownerTokensCost = calculateLLMCost(ownerUsage.modelName, ownerUsage.promptTokens, ownerUsage.completionTokens);
                                    const totalOwnerCost = 0.05 + ownerTokensCost; // Rs. 0.05 infra base + LLM cost
                                    await deductCreditsByCost(supabaseAdmin, matchedProfile.id, totalOwnerCost, 'whatsapp', 'WhatsApp Owner Chat - AI Assistant Query');
                                    
                                    const recipientNumber = cleanFrom;
                                    const whatsappToken = matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
                                    const whatsappPhoneId = wabaPhoneId || matchedProfile.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.DEV_WHATSAPP_PHONE_ID;
                                     
                                    console.log(`🔐 Token resolution (isOfficialBot: ${isMessageToOfficialBot}) - DB Token exists: ${!!matchedProfile.whatsapp_access_token}, FB Token exists: ${!!matchedProfile.facebook_token}, Env Token exists: ${!!process.env.DEV_WHATSAPP_ACCESS_TOKEN}`);
                                    if (whatsappToken) {
                                        console.log(`🔑 Token string: ${whatsappToken.substring(0, 15)}...${whatsappToken.substring(whatsappToken.length - 15)}`);
                                    }
                                    
                                    if (whatsappToken && whatsappPhoneId) {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/messages`;
                                            console.log(`📤 Sending WhatsApp reply to ${recipientNumber} via phone ID ${whatsappPhoneId}`);
                                            console.log(`📝 Bot response (first 200 chars): ${botResponseText.substring(0, 200)}`);
                                            const sendRes = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${whatsappToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                    messaging_product: 'whatsapp',
                                                    recipient_type: 'individual',
                                                    to: recipientNumber,
                                                    type: 'text',
                                                    text: { body: botResponseText }
                                                })
                                            });
                                            const sendResData = await sendRes.json();
                                            if (!sendRes.ok) {
                                                console.error("❌ WhatsApp send failed:", JSON.stringify(sendResData));
                                            } else {
                                                console.log("✅ WhatsApp message sent successfully:", JSON.stringify(sendResData));
                                            }

                                            // Always record bot response in database so dashboard and history reflect it
                                            if (ownerChat) {
                                                await supabaseAdmin
                                                    .from('whatsapp_messages')
                                                    .insert({
                                                        chat_id: ownerChat.id,
                                                        direction: 'outbound',
                                                        message_text: botResponseText
                                                    });

                                                await supabaseAdmin
                                                    .from('whatsapp_chats')
                                                    .update({
                                                        last_message_text: botResponseText,
                                                        updated_at: new Date().toISOString()
                                                    })
                                                    .eq('id', ownerChat.id);
                                            }
                                        } catch (sendErr: any) {
                                            console.error("❌ Failed to send WhatsApp message back:", sendErr);
                                        }
                                    }
                                }
                                catch (bgErr) {
                                    console.error("❌ Background webhook processing error:", bgErr);
                                }
                            })();
                        } else {
                            // Customer/Lead incoming message — Flow State Machine
                            console.log(`📬 Message from customer/lead: ${fromPhone}`);

                            // Process in background to immediately return 200 to Meta
                            await (async () => {
                                try {
                                    // 1. Resolve owner — ALWAYS prioritize the webhook's phone_number_id first
                                    // This tells us exactly which WhatsApp business number received the message
                                    const wabaPhoneId = val.metadata?.phone_number_id || '';
                                    let ownerUserId: string | null = null;
                                    let ownerWaToken: string | null = null;
                                    let ownerWaPhoneId: string | null = null;
                                    let ownerFacebookToken: string | null = null;
                                    let catalogueBtnText = 'View Products';
                                    let ownerCustomDomain: string | null = null;
                                    let ownerButtons: any[] = [];
                                    let ownerAutoCallNewLeads = false;
                                    let ownerRole = '';

                                    let ownerQualifyingEnabled = false;
                                    let ownerQualifyingQuestions: string[] = [];
                                    let ownerBusinessName = 'our company';
                                    let ownerAddress = '';
                                    let ownerBusinessInfo = '';
                                    let ownerContactNumber = '';
                                    let ownerEnableDistribution = false;
                                    let ownerHasVoiceNumber = false;

                                    // PRIMARY: Resolve from webhook phone_number_id (most reliable)
                                    if (wabaPhoneId) {
                                        const { data: ownerProfiles } = await supabaseAdmin
                                            .from('profiles')
                                            .select('id, whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name, address, business_info, contact_number, whatsapp_phone_number, role, whatsapp_catalogue_button_text, whatsapp_buttons, custom_domain, qualifying_enabled, qualifying_questions, auto_call_new_leads, enable_distribution, voice_twilio_number, voice_twilio_sid')
                                            .eq('whatsapp_phone_number_id', wabaPhoneId);
                                        
                                        if (ownerProfiles && ownerProfiles.length > 0) {
                                            // Prefer super_admin, then admin, then first one
                                            const selectedProfile = ownerProfiles.find((p: any) => p.role === 'super_admin') ||
                                                                    ownerProfiles.find((p: any) => p.role === 'admin') ||
                                                                    ownerProfiles[0];
                                            
                                            ownerUserId = selectedProfile.id;
                                            ownerWaToken = selectedProfile.whatsapp_access_token || selectedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || null;
                                            ownerFacebookToken = selectedProfile.facebook_token || null;
                                            ownerWaPhoneId = selectedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || null;
                                            catalogueBtnText = selectedProfile.whatsapp_catalogue_button_text || 'View Products';
                                            ownerCustomDomain = selectedProfile.custom_domain || null;
                                            ownerButtons = selectedProfile.whatsapp_buttons || [];
                                            ownerAutoCallNewLeads = !!selectedProfile.auto_call_new_leads;
                                            ownerRole = selectedProfile.role || '';
                                            ownerQualifyingEnabled = selectedProfile.qualifying_enabled || false;
                                            ownerQualifyingQuestions = selectedProfile.qualifying_questions || [];
                                            ownerBusinessName = selectedProfile.business_name || 'our company';
                                            ownerAddress = selectedProfile.address || '';
                                            ownerBusinessInfo = selectedProfile.business_info || '';
                                            ownerContactNumber = selectedProfile.contact_number || selectedProfile.whatsapp_phone_number || '';
                                            ownerEnableDistribution = !!selectedProfile.enable_distribution;
                                            const sBi = typeof selectedProfile.business_info === 'string' ? JSON.parse(selectedProfile.business_info || '{}') : (selectedProfile.business_info || {});
                                            ownerHasVoiceNumber = !!(sBi.claimed_vobiz_number || sBi.voice_vobiz_number || (selectedProfile.voice_twilio_number && selectedProfile.voice_twilio_sid));
                                            console.log(`[Flow] Owner resolved from wabaPhoneId: ${selectedProfile.business_name} (${ownerUserId})`);
                                        }
                                    }

                                    // FALLBACK: If wabaPhoneId didn't resolve, try matching via existing leads phone
                                    if (!ownerUserId) {
                                        const { data: matchedLeads } = await supabaseAdmin
                                            .from('leads')
                                            .select('id, user_id, name')
                                            .ilike('phone', `%${cleanFrom.slice(-10)}%`);

                                        if (matchedLeads && matchedLeads.length > 0) {
                                            let selectedLead = matchedLeads[0];
                                            if (wabaPhoneId && matchedLeads.length > 1) {
                                                const ownerIds = matchedLeads.map((l: any) => l.user_id);
                                                const { data: matchedProfiles } = await supabaseAdmin
                                                    .from('profiles')
                                                    .select('id, whatsapp_phone_number_id')
                                                    .in('id', ownerIds);
                                                
                                                const profileWithPhoneId = matchedProfiles?.find((p: any) => p.whatsapp_phone_number_id === wabaPhoneId);
                                                if (profileWithPhoneId) {
                                                    const leadForProfile = matchedLeads.find((l: any) => l.user_id === profileWithPhoneId.id);
                                                    if (leadForProfile) {
                                                        selectedLead = leadForProfile;
                                                    }
                                                }
                                            }
                                            
                                            ownerUserId = selectedLead.user_id;
                                            const { data: ownerProfile } = await supabaseAdmin
                                                .from('profiles')
                                                .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, whatsapp_catalogue_button_text, whatsapp_buttons, custom_domain, qualifying_enabled, qualifying_questions, auto_call_new_leads, role, business_name, address, business_info, contact_number, whatsapp_phone_number, enable_distribution, voice_twilio_number, voice_twilio_sid')
                                                .eq('id', ownerUserId)
                                                .maybeSingle();
                                            if (ownerProfile) {
                                                ownerWaToken = ownerProfile.whatsapp_access_token || ownerProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || null;
                                                ownerFacebookToken = ownerProfile.facebook_token || null;
                                                ownerWaPhoneId = ownerProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || null;
                                                catalogueBtnText = ownerProfile.whatsapp_catalogue_button_text || 'View Products';
                                                ownerCustomDomain = ownerProfile.custom_domain || null;
                                                ownerButtons = ownerProfile.whatsapp_buttons || [];
                                                ownerAutoCallNewLeads = !!ownerProfile.auto_call_new_leads;
                                                ownerRole = ownerProfile.role || '';
                                                ownerQualifyingEnabled = ownerProfile.qualifying_enabled || false;
                                                ownerQualifyingQuestions = ownerProfile.qualifying_questions || [];
                                                ownerBusinessName = ownerProfile.business_name || 'our company';
                                                ownerAddress = ownerProfile.address || ownerAddress || '';
                                                ownerBusinessInfo = ownerProfile.business_info || ownerBusinessInfo || '';
                                                ownerContactNumber = ownerProfile.contact_number || ownerProfile.whatsapp_phone_number || ownerContactNumber || '';
                                                ownerEnableDistribution = !!ownerProfile.enable_distribution;
                                                const oBi = typeof ownerProfile.business_info === 'string' ? JSON.parse(ownerProfile.business_info || '{}') : (ownerProfile.business_info || {});
                                                ownerHasVoiceNumber = !!(oBi.claimed_vobiz_number || oBi.voice_vobiz_number || (ownerProfile.voice_twilio_number && ownerProfile.voice_twilio_sid));
                                            }
                                            console.log(`[Flow] Owner resolved from lead match: ${selectedLead.name} -> user ${ownerUserId}`);
                                        }
                                    }

                                    if (!ownerUserId || !ownerWaToken || !ownerWaPhoneId) {
                                        console.log(`[Flow] Could not resolve owner for phone ${cleanFrom}. Skipping.`);
                                        return;
                                    }

                                    // 🟢 Send native WhatsApp typing indicator & read receipt immediately
                                    // Shows "typing..." animation on prospect's WhatsApp screen and marks message as read
                                    if (msgId && ownerWaPhoneId && ownerWaToken) {
                                        sendTypingIndicator(ownerWaPhoneId, ownerWaToken, msgId);
                                    }

                                    // Resolve billing user and inventory owner (charge clients talking to official support)
                                    let billingUserId = ownerUserId;
                                    let inventoryOwnerId = ownerUserId;

                                    if (ownerRole === 'super_admin') {
                                        // Query if cleanFrom belongs to a client profile
                                        const { data: clientProfile } = await supabaseAdmin
                                            .from('profiles')
                                            .select('id')
                                            .or(`whatsapp_phone_number.ilike.%${cleanFrom.slice(-10)}%,contact_number.ilike.%${cleanFrom.slice(-10)}%`)
                                            .maybeSingle();
                                        if (clientProfile) {
                                            billingUserId = clientProfile.id;
                                            inventoryOwnerId = clientProfile.id;
                                            console.log(`[Flow] Webhook conversation is with client ${clientProfile.id}. Setting billing and inventory owner to client.`);
                                        }
                                    }

                                    // Extract Meta contact profile name if available
                                    const waContact = val.contacts && val.contacts[0];
                                    const waProfileName = waContact?.profile?.name || null;

                                    // 2. Find or create CRM lead record with Meta Ad Referral tracking & Group Distribution
                                    const inboundReferral = message.referral || (message.context as any)?.referral || null;

                                    // Check if existing chat has cached Meta referral info (for subsequent messages from this prospect)
                                    let cachedReferralOrigin: any = null;
                                    try {
                                        const { data: existingChatForOrigin } = await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .select('id, flow_answers')
                                            .eq('user_id', ownerUserId)
                                            .eq('recipient_phone', cleanFrom)
                                            .maybeSingle();
                                        cachedReferralOrigin = existingChatForOrigin?.flow_answers?.meta_ad_origin || null;
                                    } catch (e) {}

                                    let adId = inboundReferral?.source_id || inboundReferral?.ad_id || cachedReferralOrigin?.ad_id || '';
                                    let adHeadline = inboundReferral?.headline || cachedReferralOrigin?.headline || '';
                                    let adBody = inboundReferral?.body || cachedReferralOrigin?.body || '';
                                    let adSourceUrl = inboundReferral?.source_url || cachedReferralOrigin?.source_url || '';

                                    let campaignName = cachedReferralOrigin?.campaign_name || '';
                                    let campaignId = cachedReferralOrigin?.campaign_id || '';
                                    let adNameStr = cachedReferralOrigin?.ad_name || adHeadline || 'WhatsApp Ad';
                                    let adCampaignString = campaignName ? `${campaignName} / ${adNameStr}` : adNameStr;

                                    if (adId && (!campaignId || !campaignName)) {
                                        try {
                                            const metaToken = ownerFacebookToken || process.env.META_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || ownerWaToken;
                                            if (metaToken) {
                                                const adRes = await fetch(`https://graph.facebook.com/v20.0/${adId}?fields=id,name,adset{id,name},campaign{id,name}&access_token=${metaToken}`);
                                                if (adRes.ok) {
                                                    const adDetails = await adRes.json();
                                                    campaignId = adDetails.campaign?.id || campaignId;
                                                    campaignName = adDetails.campaign?.name || campaignName;
                                                    adNameStr = adDetails.name || adHeadline || 'WhatsApp Ad';
                                                    adCampaignString = campaignName ? `${campaignName} / ${adNameStr}` : adNameStr;
                                                    console.log(`[WhatsApp Webhook] Resolved ad ${adId}: Campaign ${campaignName} (${campaignId}), Ad ${adNameStr}`);
                                                } else {
                                                    console.warn(`[WhatsApp Webhook] Error response from Meta ad fetch (${adId}):`, await adRes.json());
                                                }
                                            }
                                        } catch (adFetchErr) {
                                            console.error('[WhatsApp Webhook] Error fetching ad details from Meta:', adFetchErr);
                                        }
                                    }

                                    // Evaluate Group-Distribution automation rules
                                    let assignedAgentId: string | null = null;
                                    let assignedAgentName = '';

                                    try {
                                        const { data: groupAutomations } = await supabaseAdmin
                                            .from('automations')
                                            .select('*')
                                            .eq('user_id', ownerUserId)
                                            .like('title', 'Group-Distribution:%')
                                            .eq('is_active', true);

                                        if (groupAutomations && groupAutomations.length > 0) {
                                            for (const aut of groupAutomations) {
                                                try {
                                                    const parsedGroup = JSON.parse(aut.description || '{}');
                                                    const groupCampaigns: string[] = Array.isArray(parsedGroup.campaigns) ? parsedGroup.campaigns : [];
                                                    const groupCampaignIds: string[] = Array.isArray(parsedGroup.campaign_ids) ? parsedGroup.campaign_ids : [];
                                                    const groupFormIds: string[] = Array.isArray(parsedGroup.form_ids) ? parsedGroup.form_ids : [];
                                                    const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];
                                                    const activeMembers = groupMembers.filter((m: any) => m.is_active !== false);

                                                    if (activeMembers.length > 0 && (groupCampaigns.length > 0 || groupCampaignIds.length > 0 || groupFormIds.length > 0)) {
                                                        const leadCtx = {
                                                            campaignId: campaignId || null,
                                                            campaignName: campaignName || null,
                                                            adName: adNameStr || null,
                                                            adCampaignString: adCampaignString || null,
                                                            formName: adHeadline || null,
                                                            formId: null,
                                                            source: 'Facebook'
                                                        };
                                                        const matchesById = (campaignId && groupCampaignIds.includes(String(campaignId)));
                                                        const matchesCamp = matchesById || (groupCampaigns.length > 0 && groupCampaigns.some(gc => matchesCampaignRule(gc, leadCtx)));

                                                        if (matchesCamp) {
                                                            const weightedPool: any[] = [];
                                                            activeMembers.forEach(m => {
                                                                for (let i = 0; i < Math.max(1, m.weight || 1); i++) {
                                                                    weightedPool.push(m);
                                                                }
                                                            });

                                                            let currentIdx = 0;
                                                            if (parsedGroup.last_assigned_user_id) {
                                                                const lastIdx = weightedPool.findIndex(m => m.userId === parsedGroup.last_assigned_user_id);
                                                                if (lastIdx !== -1) {
                                                                    currentIdx = (lastIdx + 1) % weightedPool.length;
                                                                }
                                                            }

                                                            const selectedMember = weightedPool[currentIdx];
                                                            assignedAgentId = selectedMember.userId;
                                                            assignedAgentName = selectedMember.name || '';

                                                            parsedGroup.last_assigned_user_id = selectedMember.userId;
                                                            parsedGroup.last_assigned_user_name = selectedMember.name;
                                                            parsedGroup.last_assigned_at = new Date().toISOString();

                                                            const updatedGroupJson = JSON.stringify(parsedGroup);
                                                            aut.description = updatedGroupJson;

                                                            await supabaseAdmin
                                                                .from('automations')
                                                                .update({ description: updatedGroupJson })
                                                                .eq('id', aut.id);

                                                            console.log(`[WhatsApp Lead] Group distribution assigned lead to ${selectedMember.name} (${selectedMember.userId}) for rule ${aut.title}`);
                                                            break;
                                                        }
                                                    }
                                                } catch (pErr) {
                                                    console.error('[WhatsApp Lead] Error parsing group rule:', pErr);
                                                }
                                            }
                                        }
                                    } catch (distErr) {
                                        console.error('[WhatsApp Lead] Error evaluating group distribution:', distErr);
                                    }



                                    let { data: latestLead } = await supabaseAdmin
                                        .from('leads')
                                        .select('id, name, custom_fields, booked_time, pipeline_stage, assigned_to, ad_name, campaign_id, source, facebook_lead_id, form_id, form_name, voice_call_status, voice_call_scheduled_at')
                                        .eq('user_id', ownerUserId)
                                        .ilike('phone', `%${cleanFrom.slice(-10)}%`)
                                        .order('created_at', { ascending: false, nullsFirst: false })
                                        .limit(1)
                                        .maybeSingle();

                                    const formattedPhone = cleanFrom.startsWith('+') ? cleanFrom : `+${cleanFrom}`;
                                    const defaultLeadName = (waProfileName && waProfileName.trim()) ? waProfileName.trim() : formattedPhone;

                                    const isFromAd = !!(inboundReferral || campaignId || (adId && String(adId).length > 3));

                                    if (!latestLead) {
                                        const newLeadPayload: any = {
                                            user_id: ownerUserId,
                                            name: defaultLeadName,
                                            phone: formattedPhone,
                                            source: isFromAd ? 'Facebook Ads (WhatsApp)' : 'WhatsApp Inbound',
                                            pipeline_stage: 'New',
                                            status: 'New',
                                            ad_name: adCampaignString || (isFromAd ? 'WhatsApp Ad' : null),
                                            campaign_id: campaignId || null,
                                            assigned_to: assignedAgentId || null,
                                            created_at: new Date().toISOString()
                                        };

                                        if (isFromAd) {
                                            newLeadPayload.custom_fields = {
                                                meta_ad_origin: {
                                                    ad_id: adId,
                                                    ad_name: adNameStr,
                                                    campaign_id: campaignId,
                                                    campaign_name: campaignName,
                                                    headline: adHeadline,
                                                    body: adBody,
                                                    source_url: adSourceUrl
                                                }
                                            };
                                            // Schedule automated AI voice call ONLY if user has auto_call_new_leads enabled and has a connected voice number
                                            if (ownerAutoCallNewLeads && ownerHasVoiceNumber) {
                                                newLeadPayload.voice_call_scheduled_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
                                                newLeadPayload.voice_call_status = 'pending_qualification';
                                            } else {
                                                newLeadPayload.voice_call_scheduled_at = null;
                                                newLeadPayload.voice_call_status = 'not_called';
                                            }
                                            newLeadPayload.voice_campaign_id = isUuid(campaignId) ? campaignId : null;
                                        }

                                        const { data: createdLead, error: createLeadErr } = await supabaseAdmin
                                            .from('leads')
                                            .insert(newLeadPayload)
                                            .select('id, name, custom_fields, booked_time, pipeline_stage, assigned_to, ad_name, campaign_id, source, facebook_lead_id, form_id, form_name, voice_call_status, voice_call_scheduled_at')
                                            .single();

                                        if (createdLead) {
                                            latestLead = createdLead;
                                            console.log(`[Flow] Created new CRM lead for incoming WhatsApp contact: ${defaultLeadName} (${formattedPhone}), Source: ${newLeadPayload.source}, Campaign: ${campaignName || campaignId || 'N/A'}, Assigned: ${assignedAgentId || 'Owner'}`);
                                            
                                            if (assignedAgentId && assignedAgentId !== ownerUserId) {
                                                sendAdminMultiChannelNotification({
                                                    ownerUserId: assignedAgentId,
                                                    title: "🎯 WhatsApp Lead Assigned to You!",
                                                    body: `Lead: ${defaultLeadName}\nPhone: ${formattedPhone}\nSource: ${adCampaignString || newLeadPayload.source}`,
                                                    url: `/dashboard/crm/${createdLead.id}`,
                                                    type: 'new_lead'
                                                }).catch(err => console.error('[Notification] Error notifying assigned agent:', err));
                                            }
                                        } else {
                                            console.error('[Flow] Error creating CRM lead for WhatsApp contact:', createLeadErr);
                                        }
                                    } else {
                                        // Existing lead: update assignment & if arrived from ad and not yet qualified, schedule drop-off call
                                        const existingCf = parseCustomFields(latestLead.custom_fields);
                                        const updatePayload: Record<string, any> = {};

                                        if (!latestLead.assigned_to && assignedAgentId) {
                                            updatePayload.assigned_to = assignedAgentId;
                                            latestLead.assigned_to = assignedAgentId;
                                        }
                                        if (isFromAd) {
                                            if (!latestLead.source || latestLead.source === 'WhatsApp Inbound') {
                                                updatePayload.source = 'Facebook Ads (WhatsApp)';
                                                latestLead.source = 'Facebook Ads (WhatsApp)';
                                            }
                                            if (adCampaignString && (!latestLead.ad_name || latestLead.ad_name === 'WhatsApp Inbound' || latestLead.ad_name === 'WhatsApp Ad')) {
                                                updatePayload.ad_name = adCampaignString;
                                                latestLead.ad_name = adCampaignString;
                                            }
                                            if (campaignId && !latestLead.campaign_id) {
                                                updatePayload.campaign_id = campaignId;
                                                latestLead.campaign_id = campaignId;
                                            }
                                            if (!existingCf?.meta_ad_origin && (adId || campaignId || campaignName)) {
                                                updatePayload.custom_fields = {
                                                    ...(existingCf || {}),
                                                    meta_ad_origin: {
                                                        ad_id: adId,
                                                        ad_name: adNameStr,
                                                        campaign_id: campaignId,
                                                        campaign_name: campaignName,
                                                        headline: adHeadline,
                                                        body: adBody,
                                                        source_url: adSourceUrl
                                                    }
                                                };
                                            }
                                        }

                                        if (isFromAd && !existingCf?.qualification_completed && (!latestLead.voice_call_status || latestLead.voice_call_status === 'pending_qualification' || latestLead.voice_call_status === 'not_called')) {
                                            if (ownerAutoCallNewLeads && ownerHasVoiceNumber) {
                                                updatePayload.voice_call_scheduled_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
                                                updatePayload.voice_call_status = 'pending_qualification';
                                            } else {
                                                updatePayload.voice_call_scheduled_at = null;
                                                updatePayload.voice_call_status = 'not_called';
                                            }
                                            const vCamp = campaignId || latestLead.campaign_id;
                                            updatePayload.voice_campaign_id = isUuid(vCamp) ? vCamp : null;
                                        }

                                        if (Object.keys(updatePayload).length > 0) {
                                            await supabaseAdmin.from('leads').update(updatePayload).eq('id', latestLead.id);
                                        }

                                        if (updatePayload.assigned_to && assignedAgentId && assignedAgentId !== ownerUserId) {
                                            sendAdminMultiChannelNotification({
                                                ownerUserId: assignedAgentId,
                                                title: "🎯 WhatsApp Lead Assigned to You!",
                                                body: `Lead: ${latestLead.name || defaultLeadName}\nPhone: ${formattedPhone}\nSource: ${adCampaignString || 'WhatsApp Inbound'}`,
                                                url: `/dashboard/crm/${latestLead.id}`,
                                                type: 'new_lead'
                                            }).catch(err => console.error('[Notification] Error notifying assigned agent:', err));
                                        }
                                    }

                                    let { data: rawChat } = await supabaseAdmin
                                        .from('whatsapp_chats')
                                        .select('id, recipient_name, current_flow_id, current_question_index, flow_answers, flow_completed, lead_id, qualifying_flow_active')
                                        .eq('user_id', ownerUserId)
                                        .eq('recipient_phone', cleanFrom)
                                        .maybeSingle();
                                    let chat = rawChat as any;

                                    const initialFlowAnswers: any = {};
                                    if (isFromAd) {
                                        initialFlowAnswers.meta_ad_origin = {
                                            ad_id: adId,
                                            ad_name: adNameStr,
                                            campaign_id: campaignId,
                                            campaign_name: campaignName,
                                            headline: adHeadline,
                                            body: adBody,
                                            source_url: adSourceUrl
                                        };
                                    }

                                    if (!chat) {
                                        const { data: newChat } = await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .insert({
                                                user_id: ownerUserId,
                                                recipient_phone: cleanFrom,
                                                recipient_name: latestLead?.name || null,
                                                lead_id: latestLead?.id || null,
                                                last_message_text: messageText,
                                                unread_count: 1,
                                                current_flow_id: null,
                                                current_question_index: 0,
                                                flow_answers: initialFlowAnswers,
                                                flow_completed: false
                                            })
                                            .select('id, recipient_name, current_flow_id, current_question_index, flow_answers, flow_completed, lead_id, qualifying_flow_active')
                                            .single();
                                        chat = newChat as any;
                                    } else {
                                        const updates: any = {
                                            last_message_text: messageText,
                                            unread_count: (chat as any).flow_completed ? 1 : 0,
                                            updated_at: new Date().toISOString()
                                        };
                                        if (latestLead) {
                                            if (chat.lead_id !== latestLead.id) {
                                                updates.lead_id = latestLead.id;
                                                chat.lead_id = latestLead.id;
                                            }
                                            if (!chat.recipient_name || chat.recipient_name !== latestLead.name) {
                                                updates.recipient_name = latestLead.name;
                                                chat.recipient_name = latestLead.name;
                                            }
                                        }
                                        if (isFromAd && (!chat.flow_answers?.meta_ad_origin || inboundReferral)) {
                                            updates.flow_answers = {
                                                ...(chat.flow_answers || {}),
                                                meta_ad_origin: {
                                                    ad_id: adId,
                                                    ad_name: adNameStr,
                                                    campaign_id: campaignId,
                                                    campaign_name: campaignName,
                                                    headline: adHeadline,
                                                    body: adBody,
                                                    source_url: adSourceUrl
                                                }
                                            };
                                            chat.flow_answers = updates.flow_answers;
                                        }
                                        await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .update(updates)
                                            .eq('id', chat.id);
                                    }

                                    if (!chat) {
                                        console.error(`[Flow] Failed to create/find chat for ${cleanFrom}`);
                                        return;
                                    }

                                    // Resolve media URL if this is a media message
                                    if (isMediaMessage && inboundMediaUrl?.startsWith('__media_id__:')) {
                                        const mediaId = inboundMediaUrl.replace('__media_id__:', '');
                                        try {
                                            const mediaInfoRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
                                                headers: { 'Authorization': `Bearer ${ownerWaToken}` }
                                            });
                                            if (mediaInfoRes.ok) {
                                                const mediaInfo = await mediaInfoRes.json();
                                                inboundMediaUrl = mediaInfo.url || null;
                                            } else {
                                                console.error(`[Flow] Failed to fetch media info for ${mediaId}`);
                                                inboundMediaUrl = null;
                                            }
                                        } catch (mediaErr) {
                                            console.error(`[Flow] Error resolving media URL:`, mediaErr);
                                            inboundMediaUrl = null;
                                        }
                                    }

                                    // Log inbound message (with media if present)
                                    const inboundInsert: any = {
                                        chat_id: chat.id,
                                        direction: 'inbound',
                                        message_text: messageText || `[${inboundMediaType || 'media'}]`
                                    };
                                    if (inboundMediaUrl) inboundInsert.media_url = inboundMediaUrl;
                                    if (inboundMediaType) inboundInsert.media_type = inboundMediaType;

                                    const { data: currentInboundMsg } = await supabaseAdmin
                                         .from('whatsapp_messages')
                                         .insert(inboundInsert)
                                         .select('created_at')
                                         .single();
                                     const currentInboundMsgCreatedAt = currentInboundMsg?.created_at || null;
                                     // Routine inbound messages are logged in chat & CRM silently without sending notification noise
                                     const leadDisplayName = chat.recipient_name || latestLead?.name || 'Customer';
                                     const leadDisplayPhone = '+' + cleanFrom;

                                     // Bypass bot execution for system verification code messages
                                     const isVerificationMessage = /confirmation code|facebook code|verification code|security code/i.test(messageText);
                                     if (isVerificationMessage) {
                                         console.log(`[Flow] Logged verification message to CRM, skipping bot execution: "${messageText}"`);
                                         return;
                                     }

                                     // Bypass automated auto-replies / greetings from other business WhatsApp accounts to prevent bot-to-bot reply loops
                                     const isAutoGreeting = /^(thank you for (contacting|reaching out|messaging|your message)|welcome to|we('re| are) (currently )?unavailable|we will (respond|reply) as soon as|we are at your service|greetings from|shukran|شكرًا|how may (i|we) assist|please let us know how we can (help|assist)|agents are waiting|to assist you better|to assist you with your|in order to assist you|not registered in our system|hi, what is your name|if you have a legal inquiry|we have demand of \d+\+|select the type of .* visa|reply with the number of the service|good day.*thank you for reaching out)/i.test((messageText || '').trim());
                                     if (isAutoGreeting) {
                                         console.log(`[Flow] Logged automated business greeting to CRM, skipping automated bot response for ${cleanFrom}: "${(messageText || '').slice(0, 80)}"`);
                                         return;
                                     }

                                      // 🚀 Trigger Autonomous Lead Agent & Handshake fulfillment on inbound customer message
                                    if (latestLead?.id) {
                                        processLeadEvent({
                                            eventType: 'MESSAGE_RECEIVED',
                                            leadId: latestLead.id,
                                            inboundText: messageText
                                        }).catch(err => console.error('[AUTONOMOUS AGENT] Error on customer inbound:', err));
                                    }

                                      // 1. Dynamic User-Configured Automation Flows (ChatbotX Engine)
                                      try {
                                          const flowResult = await executeFlowRunner({
                                              supabaseAdmin,
                                              ownerUserId,
                                              ownerWaToken,
                                              ownerWaPhoneId,
                                              ownerBusinessName,
                                              ownerCustomDomain,
                                              ownerContactNumber,
                                              cleanFrom,
                                              chat,
                                              latestLead,
                                              messageType: message.type,
                                              buttonReplyId,
                                              buttonReplyTitle,
                                              messageText,
                                              contextMessageId: message.context?.id || null,
                                              isFromAd: isFromAd || Boolean(latestLead?.campaign_id || latestLead?.ad_name),
                                              campaignId: campaignId || latestLead?.campaign_id || null
                                          });

                                          if (flowResult.handled) {
                                              console.log(`[Flow] 🚀 Dynamic flow "${flowResult.flowName}" executed for ${cleanFrom}. Bypassing AI assistant & default 3-buttons.`);
                                              return;
                                          }
                                      } catch (flowErr) {
                                          console.error('[Flow] Error running dynamic flow runner:', flowErr);
                                      }

                                       // Fallback: Check if this was an "Interested" button click specifically for Nobogent's internal account
                                       const isInternalNobogentAccount = 
                                           ownerUserId === 'bc63c065-9bcc-4793-bedc-f0960406425b' ||
                                           ownerUserId === '91553adf-20b5-4c4c-9614-6b6f89fd0bfd' ||
                                           ownerUserId === 'b1645a6d-4b73-41ef-a197-8247d0168905' ||
                                           (ownerBusinessName || '').toLowerCase().includes('nobogent') ||
                                           (ownerBusinessName || '').toLowerCase().includes('adrolls');

                                       const isInterestedBtnClick = isInternalNobogentAccount && (buttonReplyId === 'interested_btn' || (buttonReplyTitle && buttonReplyTitle.toLowerCase().includes('interested')));
                                       if (isInterestedBtnClick) {
                                           console.log(`[Flow] Lead ${cleanFrom} clicked "Interested" on Nobogent Offer! Sending demo response & alerting admin.`);

                                           const demoReplyText = `Awesome! 🚀 Here is how Nobogent — the world's first AI Sales & Marketing Department for Real Estate — works:\n\n🎥 Watch 2-Min Demo: https://nobogent.com\n\nNobogent automates your entire department for ₹9,999/mo:\n✅ 500 AI Calling Minutes to cold & warm leads\n✅ Automated WhatsApp Broadcasts & AI Auto-Replies\n✅ AI Video Ads & Social Media Content Creation\n✅ Built-in Lead CRM & Pipeline Automation\n\nWould you like to speak directly with our team or schedule a live 1-on-1 walkthrough?`;

                                           try {
                                               const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                               await fetch(metaUrl, {
                                                   method: 'POST',
                                                   headers: {
                                                       'Authorization': `Bearer ${ownerWaToken}`,
                                                       'Content-Type': 'application/json'
                                                   },
                                                   body: JSON.stringify({
                                                       messaging_product: 'whatsapp',
                                                       recipient_type: 'individual',
                                                       to: cleanFrom,
                                                       type: 'interactive',
                                                       interactive: {
                                                           type: 'button',
                                                           body: { text: demoReplyText },
                                                           action: {
                                                               buttons: [
                                                                   {
                                                                       type: 'reply',
                                                                       reply: { id: 'connect_expert', title: 'Talk to Expert 📞' }
                                                                   }
                                                               ]
                                                           }
                                                       }
                                                   })
                                               });

                                               // Log bot reply in database
                                               await supabaseAdmin
                                                   .from('whatsapp_messages')
                                                   .insert({
                                                       chat_id: chat.id,
                                                       direction: 'outbound',
                                                       message_text: demoReplyText
                                                   });
                                               await supabaseAdmin
                                                   .from('whatsapp_chats')
                                                   .update({ last_message_text: demoReplyText, updated_at: new Date().toISOString() })
                                                   .eq('id', chat.id);
                                           } catch (waErr) {
                                               console.error('[Flow] Error sending demo response to lead:', waErr);
                                           }

                                           // Trigger Multi-Channel Alert to Admin
                                           const leadName = chat.recipient_name || latestLead?.name || 'Prospect';
                                           const leadPhone = '+' + cleanFrom;
                                           const targetLeadId = latestLead?.id;
                                           const targetUrl = targetLeadId ? `/dashboard/crm?leadId=${targetLeadId}` : '/dashboard/crm';

                                           sendAdminMultiChannelNotification({
                                               ownerUserId,
                                               title: '🔥 Lead Clicked Interested on Nobogent Offer!',
                                               body: `Prospect ${leadName} (${leadPhone}) clicked "Interested" on your Nobogent broadcast! Follow up now.`,
                                               url: targetUrl,
                                               type: 'connect_expert',
                                               leadPhone,
                                               leadName,
                                               leadId: targetLeadId
                                           }).catch(err => console.error('[Flow] Multi-channel alert failed:', err));

                                           return; // Stop processing real estate qualifying flows
                                       }

                                     // Check if this was a click on "Connect with Expert" or "Get System" button
                                      const isConnectExpertClick = buttonReplyId === 'connect_expert' || buttonReplyId === 'get_nobogent_system' || /connect with expert|connect expert|speak with expert|talk to expert|call expert|get nobogent system|nobogent system/i.test(messageText);
                                      if (isConnectExpertClick) {
                                          console.log(`[Flow] Lead ${cleanFrom} clicked Connect with Expert! Sending alert to admin.`);
                                          
                                          // 1. Reply to lead on WhatsApp
                                          const leadReplyText = isInternalNobogentAccount
                                              ? `Thank you! Our team at ${ownerBusinessName || 'Nobogent'} has been notified and our solutions specialist will reach out to you directly shortly. You can also pick a convenient time slot using the link above! 🙏`
                                              : `Thank you! Our team at ${ownerBusinessName || 'our office'} has been notified and our specialist will reach out to you directly shortly. You can also pick a convenient time slot using the link above! 🙏`;
                                          try {
                                              const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                              await fetch(metaUrl, {
                                                  method: 'POST',
                                                  headers: {
                                                      'Authorization': `Bearer ${ownerWaToken}`,
                                                      'Content-Type': 'application/json'
                                                  },
                                                  body: JSON.stringify({
                                                      messaging_product: 'whatsapp',
                                                      recipient_type: 'individual',
                                                      to: cleanFrom,
                                                      type: 'text',
                                                      text: { body: leadReplyText }
                                                  })
                                              });
                                              
                                              // Log bot reply in chat
                                              await supabaseAdmin
                                                  .from('whatsapp_messages')
                                                  .insert({
                                                      chat_id: chat.id,
                                                      direction: 'outbound',
                                                      message_text: leadReplyText
                                                  });
                                              await supabaseAdmin
                                                  .from('whatsapp_chats')
                                                  .update({ last_message_text: leadReplyText, updated_at: new Date().toISOString() })
                                                  .eq('id', chat.id);
                                          } catch (waErr) {
                                              console.error('[Flow] Error sending expert connection response to lead:', waErr);
                                          }
                                          
                                          // 2. Trigger Multi-Channel Alert to Admin with Direct CRM Lead Link
                                          const leadName = chat.recipient_name || latestLead?.name || 'Prospect';
                                          const leadPhone = '+' + cleanFrom;
                                          const targetLeadId = latestLead?.id;
                                          const targetUrl = targetLeadId ? `/dashboard/crm?leadId=${targetLeadId}` : '/dashboard/crm';
                                          
                                          sendAdminMultiChannelNotification({
                                              ownerUserId,
                                              title: `🚨 Call with Expert Requested!`,
                                              body: `High-intent lead ${leadName} (${leadPhone}) requested to connect with an expert for ${ownerBusinessName || 'your business'}! Please contact them immediately.`,
                                              url: targetUrl,
                                              type: 'connect_expert',
                                              leadPhone,
                                              leadName,
                                              leadId: targetLeadId
                                          }).catch(err => console.error('[Flow] Multi-channel expert request alert failed:', err));
                                          
                                          return; // Stop processing further automation rules/flows or Gemini
                                      }

                                    // Helper: send WhatsApp interactive message with customizable action buttons
                                    const sendWAMessage = async (text: string) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                                            const catalogueLink = ownerCustomDomain 
                                                ? `https://${ownerCustomDomain}` 
                                                : `${appUrl}/shared/${ownerUserId}`;

                                            // Build buttons list
                                            let buttons = [{ text: catalogueBtnText || 'View Products', url: catalogueLink }];
                                            if (ownerButtons && Array.isArray(ownerButtons) && ownerButtons.length > 0) {
                                                buttons = ownerButtons.map((btn: any, idx: number) => {
                                                    let url = btn.url ? btn.url.trim() : '';
                                                    if (!url) {
                                                        url = catalogueLink;
                                                    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
                                                        url = 'https://' + url;
                                                    }
                                                    return {
                                                        text: (btn.text || (idx === 0 ? (catalogueBtnText || 'View Products') : 'View Link')).slice(0, 20),
                                                        url: url
                                                    };
                                                });
                                            }

                                            // Send the primary button (cta_url type)
                                            const sendRes = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${ownerWaToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                    messaging_product: 'whatsapp',
                                                    recipient_type: 'individual',
                                                    to: cleanFrom,
                                                    type: 'interactive',
                                                    interactive: {
                                                        type: 'cta_url',
                                                        body: {
                                                            text: text
                                                        },
                                                        action: {
                                                            name: 'cta_url',
                                                            parameters: {
                                                                display_text: buttons[0].text,
                                                                url: buttons[0].url
                                                            }
                                                        }
                                                    }
                                                })
                                            });

                                            if (sendRes.ok) {
                                                // Log outbound
                                                await supabaseAdmin
                                                    .from('whatsapp_messages')
                                                    .insert({
                                                        chat_id: chat!.id,
                                                        direction: 'outbound',
                                                        message_text: text
                                                    });
                                                await supabaseAdmin
                                                    .from('whatsapp_chats')
                                                    .update({ last_message_text: text, updated_at: new Date().toISOString() })
                                                    .eq('id', chat!.id);

                                                // Send subsequent buttons as separate messages (if any)
                                                for (let i = 1; i < buttons.length; i++) {
                                                    const extraBtn = buttons[i];
                                                    // Small delay to ensure order in WhatsApp UI
                                                    await new Promise(resolve => setTimeout(resolve, 150));
                                                    
                                                    const extraBodyText = `Click below to access ${extraBtn.text}:`;
                                                    
                                                    const extraRes = await fetch(metaUrl, {
                                                        method: 'POST',
                                                        headers: {
                                                            'Authorization': `Bearer ${ownerWaToken}`,
                                                            'Content-Type': 'application/json'
                                                        },
                                                        body: JSON.stringify({
                                                            messaging_product: 'whatsapp',
                                                            recipient_type: 'individual',
                                                            to: cleanFrom,
                                                            type: 'interactive',
                                                            interactive: {
                                                                type: 'cta_url',
                                                                body: {
                                                                    text: extraBodyText
                                                                },
                                                                action: {
                                                                    name: 'cta_url',
                                                                    parameters: {
                                                                        display_text: extraBtn.text,
                                                                        url: extraBtn.url
                                                                    }
                                                                }
                                                            }
                                                        })
                                                    });

                                                    if (extraRes.ok) {
                                                        await supabaseAdmin
                                                            .from('whatsapp_messages')
                                                            .insert({
                                                                chat_id: chat!.id,
                                                                direction: 'outbound',
                                                                message_text: extraBodyText
                                                            });
                                                    } else {
                                                        const errData = await extraRes.json();
                                                        console.error(`[Flow] Failed to send extra WA button ${i}:`, errData);
                                                    }
                                                }
                                                
                                                // Send "Connect with Expert" quick reply button as a subsequent message
                                                if (chat?.recipient_name) {
                                                    await new Promise(resolve => setTimeout(resolve, 150));
                                                    const expertBodyText = "Would you like to speak directly with our expert on call?";
                                                    const expertRes = await fetch(metaUrl, {
                                                        method: 'POST',
                                                        headers: {
                                                            'Authorization': `Bearer ${ownerWaToken}`,
                                                            'Content-Type': 'application/json'
                                                        },
                                                        body: JSON.stringify({
                                                            messaging_product: 'whatsapp',
                                                            recipient_type: 'individual',
                                                            to: cleanFrom,
                                                            type: 'interactive',
                                                            interactive: {
                                                                type: 'button',
                                                                body: {
                                                                    text: expertBodyText
                                                                },
                                                                action: {
                                                                    buttons: [
                                                                        {
                                                                            type: 'reply',
                                                                            reply: {
                                                                                id: 'connect_expert',
                                                                                title: 'Connect with Expert'
                                                                            }
                                                                        }
                                                                    ]
                                                                }
                                                            }
                                                        })
                                                    });
                                                    if (expertRes.ok) {
                                                        await supabaseAdmin
                                                            .from('whatsapp_messages')
                                                            .insert({
                                                                chat_id: chat!.id,
                                                                direction: 'outbound',
                                                                message_text: expertBodyText + " [Button: Connect with Expert]"
                                                            });
                                                    } else {
                                                        const errData = await expertRes.json();
                                                        console.error(`[Flow] Failed to send Connect with Expert button:`, errData);
                                                    }
                                                }
                                     } else {
                                                const errData = await sendRes.json();
                                                console.error(`[Flow] Failed to send WA message:`, errData);
                                            }
                                        } catch (err) {
                                            console.error(`[Flow] Error sending WA message:`, err);
                                        }
                                    };

                                    // Helper: send WhatsApp Media message (Image/Video/Document with caption)
                                    const sendWAMediaMessage = async (mediaUrl: string, mediaType: 'image' | 'video' | 'document', captionText: string) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const res = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${ownerWaToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                    messaging_product: 'whatsapp',
                                                    recipient_type: 'individual',
                                                    to: cleanFrom,
                                                    type: mediaType,
                                                    [mediaType]: {
                                                        link: mediaUrl,
                                                        caption: captionText
                                                    }
                                                })
                                            });
                                            if (res.ok) {
                                                await supabaseAdmin.from('whatsapp_messages').insert({
                                                    chat_id: chat!.id,
                                                    direction: 'outbound',
                                                    message_text: `[${mediaType.toUpperCase()}] ${captionText}`
                                                });
                                                await supabaseAdmin.from('whatsapp_chats').update({
                                                    last_message_text: captionText,
                                                    updated_at: new Date().toISOString()
                                                }).eq('id', chat!.id);
                                            } else {
                                                const errData = await res.json();
                                                console.error('[Flow] Send WAMediaMessage failed:', errData);
                                            }
                                        } catch (err) {
                                            console.error('[Flow] Error sending WA media message:', err);
                                        }
                                    };

                                    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                                    const catalogueLink = ownerCustomDomain 
                                        ? `https://${ownerCustomDomain}` 
                                        : `${appUrl}/shared/${ownerUserId}`;
                                    const baseBookingUrl = ownerCustomDomain 
                                        ? `https://${ownerCustomDomain}` 
                                        : `${appUrl}/shared/${ownerUserId}`;
                                    const bookingLink = latestLead?.id 
                                        ? `${baseBookingUrl}/booking/${latestLead.id}` 
                                        : `${baseBookingUrl}/booking`;

                                    const isNobogentAccount = 
                                        ownerUserId === 'bc63c065-9bcc-4793-bedc-f0960406425b' ||
                                        ownerUserId === '91553adf-20b5-4c4c-9614-6b6f89fd0bfd' ||
                                        ownerUserId === 'b1645a6d-4b73-41ef-a197-8247d0168905' ||
                                        (ownerBusinessName || '').toLowerCase().includes('nobogent') ||
                                        (ownerBusinessName || '').toLowerCase().includes('adrolls');

                                    const isPipixelAccount = 
                                        ownerUserId === 'c7bede84-d7ea-4b02-bbbb-017d24a37914' ||
                                        (ownerBusinessName || '').toLowerCase().includes('pipixel');

                                    // Check if this business actually sells properties (has entries in properties table)
                                    const { count: propertiesCount } = await supabaseAdmin
                                        .from('properties')
                                        .select('id', { count: 'exact', head: true })
                                        .eq('user_id', ownerUserId);
                                    const hasProperties = (propertiesCount || 0) > 0;

                                    // Helper: Send 3-Button Standard Action Menu (dynamic based on business type / industry)
                                    const sendThreeButtons = async (promptText = "What would you like to do?") => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            let threeButtonsList: any[] = [];

                                            if (Array.isArray(ownerButtons) && ownerButtons.length > 0) {
                                                threeButtonsList = ownerButtons.slice(0, 3).map((b: any, idx: number) => ({
                                                    type: 'reply',
                                                    reply: { id: b.id || `btn_custom_${idx}`, title: String(b.title || b.text || 'Select').slice(0, 20) }
                                                }));
                                            } else if (isNobogentAccount) {
                                                threeButtonsList = [
                                                    { type: 'reply', reply: { id: 'view_properties', title: 'Explore Nobogent' } },
                                                    { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to Expert' } },
                                                    { type: 'reply', reply: { id: 'book_appointment', title: 'Book Strategy Call' } }
                                                ];
                                            } else if (isPipixelAccount) {
                                                threeButtonsList = [
                                                    { type: 'reply', reply: { id: 'claim_trial', title: 'Claim Free Trial' } },
                                                    { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to Specialist' } },
                                                    { type: 'reply', reply: { id: 'book_appointment', title: 'Schedule a Call' } }
                                                ];
                                            } else if (hasProperties) {
                                                threeButtonsList = [
                                                    { type: 'reply', reply: { id: 'view_properties', title: catalogueBtnText && catalogueBtnText !== 'View Products' ? catalogueBtnText.slice(0, 20) : 'View Properties' } },
                                                    { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to an expert' } },
                                                    { type: 'reply', reply: { id: 'book_appointment', title: 'Book an appointment' } }
                                                ];
                                            } else {
                                                threeButtonsList = [
                                                    { type: 'reply', reply: { id: 'view_properties', title: catalogueBtnText && catalogueBtnText !== 'View Products' ? catalogueBtnText.slice(0, 20) : 'Explore Services' } },
                                                    { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to Expert' } },
                                                    { type: 'reply', reply: { id: 'book_appointment', title: 'Schedule a Call' } }
                                                ];
                                            }

                                            const payload = {
                                                messaging_product: 'whatsapp',
                                                recipient_type: 'individual',
                                                to: cleanFrom,
                                                type: 'interactive',
                                                interactive: {
                                                    type: 'button',
                                                    body: { text: promptText },
                                                    action: {
                                                        buttons: threeButtonsList
                                                    }
                                                }
                                            };
                                            const res = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${ownerWaToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify(payload)
                                            });
                                            if (res.ok) {
                                                Promise.all([
                                                    supabaseAdmin.from('whatsapp_messages').insert({
                                                        chat_id: chat.id,
                                                        direction: 'outbound',
                                                        message_text: `${promptText} [Buttons: ${threeButtonsList.map(b => b.reply.title).join(' | ')}]`
                                                    }),
                                                    supabaseAdmin.from('whatsapp_chats').update({
                                                        last_message_text: promptText,
                                                        updated_at: new Date().toISOString()
                                                    }).eq('id', chat.id)
                                                ]).catch(dbErr => console.error('[WhatsApp Bot] Non-blocking DB log error:', dbErr));
                                            } else {
                                                console.error('[WhatsApp Bot] Failed to send 3-button menu:', await res.json());
                                            }
                                        } catch (err) {
                                            console.error('[WhatsApp Bot] Error sending 3-button menu:', err);
                                        }
                                    };

                                    // Helper: Answer customer free-form property inquiry with AI + 3 Action Buttons
                                    const answerCustomerQueryWithAI = async (queryText: string, skipActionButtons = false) => {
                                        try {
                                            console.log(`🤖 [Customer AI] Answering query from ${cleanFrom} for ${ownerBusinessName}: "${queryText}"`);
                                            if (msgId && ownerWaPhoneId && ownerWaToken) {
                                                sendTypingIndicator(ownerWaPhoneId, ownerWaToken, msgId);
                                            }
                                            
                                            // Fetch real-time available properties for owner
                                            const { data: properties } = await supabaseAdmin
                                                .from('properties')
                                                .select('title, price, address, property_type, description')
                                                .eq('user_id', ownerUserId)
                                                .limit(15);
                                                
                                            let inventoryText = 'No specific listings in database yet.';
                                            if (properties && properties.length > 0) {
                                                inventoryText = properties.map((p: any, idx: number) => {
                                                    return `${idx + 1}. *${p.title}*\n   • Type: ${p.property_type || 'Residential'}\n   • Price: ${p.price || 'Contact for Price'}\n   • Location: ${p.address || 'New Chandigarh / Tri-city'}\n   • Highlights: ${p.description ? p.description.slice(0, 250) : 'Premium property'}`;
                                                }).join('\n\n');
                                            }

                                            const effectiveAddress = ownerAddress || '';
                                            const effectivePhone = ownerContactNumber || '';
                                            const effectiveBusinessInfo = ownerBusinessInfo || `${ownerBusinessName} provides expert client services and solutions.`;

                                            const systemPrompt = `You are the friendly, professional AI Assistant representing "${ownerBusinessName}".
You assist prospective clients, answering inquiries about services, offerings, pricing, and scheduling appointments.

Official Company Details for ${ownerBusinessName}:
• Company / Business Name: ${ownerBusinessName}
${effectiveAddress ? `• Office Address: ${effectiveAddress}` : ''}
${effectivePhone ? `• Contact Phone: ${effectivePhone}` : ''}
• Business Overview: ${effectiveBusinessInfo}

Available Offerings & Catalog for ${ownerBusinessName}:
${inventoryText}

RULES:
1. Always represent "${ownerBusinessName}" with utmost professionalism, warmth, and accuracy.
2. If the user asks about your office location, address, or contact details, provide the official details above clearly.
3. If they inquire about specific offerings, services, or products, reference the catalog highlights above with pricing and features.
4. Keep responses concise (under 120 words), readable on mobile, using WhatsApp formatting (bold *text*, bullet points •). Do NOT use HTML or markdown tables.
5. End with a helpful, friendly question or call to action to guide the client to the next step.`;

                                            let aiReply = '';
                                            try {
                                                const { text } = await generateText({
                                                    model: google.chat('gemini-3.5-flash'),
                                                    system: systemPrompt,
                                                    prompt: `Client WhatsApp Query: "${queryText}"`
                                                });
                                                aiReply = text;
                                            } catch (callErr: any) {
                                                console.warn('[Customer AI] generateText failed, falling back to callGemini:', callErr?.message);
                                                aiReply = await callGemini(`${systemPrompt}\n\nClient WhatsApp Query: "${queryText}"`);
                                            }

                                            if (!aiReply || aiReply.trim().length === 0) {
                                                aiReply = `Thank you for reaching out to *${ownerBusinessName || 'our team'}*! We are delighted to assist you with our services, catalog, and offerings. Please let us know how we can help you today.`;
                                            }

                                            // Send AI answer as clear message
                                            await sendTextMessage(aiReply);
                                            
                                            if (!skipActionButtons && !isPipixelAccount) {
                                                await new Promise(r => setTimeout(r, 150));
                                                
                                                // Send 3 action buttons for easy next steps
                                                await sendThreeButtons("What would you like to do next?");
                                            }
                                        } catch (err) {
                                            console.error('[Customer AI] Failed to generate AI reply:', err);
                                            if (!skipActionButtons && !isPipixelAccount) {
                                                await sendThreeButtons("What would you like to do next?");
                                            }
                                        }
                                    };

                                    // Helper: Send Interactive MCQ Question Buttons (up to 3 options)
                                    const sendMCQButtons = async (questionText: string, buttons: { id: string; title: string }[]) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const payload = {
                                                messaging_product: 'whatsapp',
                                                recipient_type: 'individual',
                                                to: cleanFrom,
                                                type: 'interactive',
                                                interactive: {
                                                    type: 'button',
                                                    body: { text: questionText },
                                                    action: {
                                                        buttons: buttons.slice(0, 3).map(b => ({
                                                            type: 'reply',
                                                            reply: { id: b.id, title: b.title.slice(0, 20) }
                                                        }))
                                                    }
                                                }
                                            };
                                            const res = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${ownerWaToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify(payload)
                                            });
                                            if (res.ok) {
                                                Promise.all([
                                                    supabaseAdmin.from('whatsapp_messages').insert({
                                                        chat_id: chat.id,
                                                        direction: 'outbound',
                                                        message_text: `${questionText} [Options: ${buttons.map(b => b.title).join(', ')}]`
                                                    }),
                                                    supabaseAdmin.from('whatsapp_chats').update({
                                                        last_message_text: questionText,
                                                        updated_at: new Date().toISOString()
                                                    }).eq('id', chat.id)
                                                ]).catch(dbErr => console.error('[WhatsApp Bot] Non-blocking DB log error:', dbErr));
                                            } else {
                                                console.error('[WhatsApp Bot] Failed to send MCQ buttons:', await res.json());
                                            }
                                        } catch (err) {
                                            console.error('[WhatsApp Bot] Error sending MCQ buttons:', err);
                                        }
                                    };

                                    // Helper: Send Interactive MCQ Question List (for 4 to 10 options, opens WhatsApp in-app bottom sheet drawer)
                                    const sendMCQList = async (questionText: string, items: { id: string; title: string; description?: string }[]) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const payload = {
                                                messaging_product: 'whatsapp',
                                                recipient_type: 'individual',
                                                to: cleanFrom,
                                                type: 'interactive',
                                                interactive: {
                                                    type: 'list',
                                                    header: { type: 'text', text: (ownerBusinessName || 'Quick Selection').slice(0, 60) },
                                                    body: { text: questionText },
                                                    footer: { text: 'Tap button below to select an option 📋'.slice(0, 60) },
                                                    action: {
                                                        button: 'Choose Option 📋',
                                                        sections: [
                                                            {
                                                                title: 'Available Options',
                                                                rows: items.slice(0, 10).map((item, idx) => ({
                                                                    id: item.id,
                                                                    title: item.title.slice(0, 24),
                                                                    description: (item.description || `Option ${idx + 1}`).slice(0, 72)
                                                                }))
                                                            }
                                                        ]
                                                    }
                                                }
                                            };
                                            const res = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${ownerWaToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify(payload)
                                            });
                                            if (res.ok) {
                                                Promise.all([
                                                    supabaseAdmin.from('whatsapp_messages').insert({
                                                        chat_id: chat.id,
                                                        direction: 'outbound',
                                                        message_text: `${questionText} [List Options: ${items.map(b => b.title).join(' | ')}]`
                                                    }),
                                                    supabaseAdmin.from('whatsapp_chats').update({
                                                        last_message_text: questionText,
                                                        updated_at: new Date().toISOString()
                                                    }).eq('id', chat.id)
                                                ]).catch(dbErr => console.error('[WhatsApp Bot] Non-blocking DB log error:', dbErr));
                                            } else {
                                                const errData = await res.json();
                                                console.warn('[WhatsApp Bot] Failed to send MCQ list, falling back to text options:', errData);
                                                const numberedOptions = items.map((it, idx) => `${idx + 1}️⃣ ${it.title}`).join('\n');
                                                await sendTextMessage(`${questionText}\n\n${numberedOptions}\n\n👉 Reply with the option number or name.`);
                                            }
                                        } catch (err) {
                                            console.error('[WhatsApp Bot] Error sending MCQ list:', err);
                                            const numberedOptions = items.map((it, idx) => `${idx + 1}️⃣ ${it.title}`).join('\n');
                                            await sendTextMessage(`${questionText}\n\n${numberedOptions}\n\n👉 Reply with the option number or name.`);
                                        }
                                    };

                                    // Helper: Send Free-form Text Message
                                    const sendTextMessage = async (text: string) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const res = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${ownerWaToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                    messaging_product: 'whatsapp',
                                                    recipient_type: 'individual',
                                                    to: cleanFrom,
                                                    type: 'text',
                                                    text: { body: text }
                                                })
                                            });
                                            if (res.ok) {
                                                Promise.all([
                                                    supabaseAdmin.from('whatsapp_messages').insert({
                                                        chat_id: chat.id,
                                                        direction: 'outbound',
                                                        message_text: text
                                                    }),
                                                    supabaseAdmin.from('whatsapp_chats').update({
                                                        last_message_text: text,
                                                        updated_at: new Date().toISOString()
                                                    }).eq('id', chat.id)
                                                ]).catch(dbErr => console.error('[WhatsApp Bot] Non-blocking DB log error:', dbErr));
                                            }
                                        } catch (err) {
                                            console.error('[WhatsApp Bot] Error sending text message:', err);
                                        }
                                    };

                                    // Helper: Send Interactive CTA URL Button Message (with fallback to direct text link)
                                    const sendCtaUrlMessage = async (headerText: string, bodyText: string, buttonText: string, url: string) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const payload = {
                                                messaging_product: 'whatsapp',
                                                recipient_type: 'individual',
                                                to: cleanFrom,
                                                type: 'interactive',
                                                interactive: {
                                                    type: 'cta_url',
                                                    header: { type: 'text', text: headerText.slice(0, 60) },
                                                    body: { text: bodyText },
                                                    footer: { text: (ownerBusinessName || (isNobogentAccount ? 'Nobogent AI' : 'Advisory')).slice(0, 60) },
                                                    action: {
                                                        name: 'cta_url',
                                                        parameters: {
                                                            display_text: buttonText.slice(0, 20),
                                                            url: url
                                                        }
                                                    }
                                                }
                                            };
                                            const res = await fetch(metaUrl, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${ownerWaToken}`,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify(payload)
                                            });
                                            if (res.ok) {
                                                Promise.all([
                                                    supabaseAdmin.from('whatsapp_messages').insert({
                                                        chat_id: chat.id,
                                                        direction: 'outbound',
                                                        message_text: `${bodyText} [Button: ${buttonText} -> ${url}]`
                                                    }),
                                                    supabaseAdmin.from('whatsapp_chats').update({
                                                        last_message_text: bodyText,
                                                        updated_at: new Date().toISOString()
                                                    }).eq('id', chat.id)
                                                ]).catch(dbErr => console.error('[WhatsApp Bot] Non-blocking DB log error:', dbErr));
                                            } else {
                                                console.warn('[WhatsApp Bot] CTA URL button response not ok, sending direct text link:', await res.json());
                                                await sendTextMessage(`${bodyText}\n\n👉 ${url}`);
                                            }
                                        } catch (err) {
                                            console.error('[WhatsApp Bot] Error sending CTA URL button:', err);
                                            await sendTextMessage(`${bodyText}\n\n👉 ${url}`);
                                        }
                                    };

                                    // Load existing lead custom fields
                                    let currentCustomFields = parseCustomFields(latestLead?.custom_fields || chat.flow_answers || {});

                                    // Detect if this lead originated from a Meta/Facebook Lead Ad Instant Form
                                    const isInstantFormLead = Boolean(
                                        latestLead?.facebook_lead_id ||
                                        latestLead?.form_id ||
                                        (latestLead?.source && (latestLead.source === 'Facebook Ads' || latestLead.source.toLowerCase().includes('form'))) ||
                                        currentCustomFields?.is_instant_form ||
                                        (chat as any)?.flow_answers?.is_instant_form
                                    );

                                    if (isInstantFormLead) {
                                        if (!currentCustomFields.is_instant_form || !currentCustomFields.qualification_completed) {
                                            currentCustomFields.is_instant_form = true;
                                            currentCustomFields.qualification_completed = true;
                                            // Persist silently so future messages also recognize it immediately
                                            try {
                                                await supabaseAdmin.from('whatsapp_chats').update({
                                                    flow_completed: true,
                                                    flow_answers: currentCustomFields,
                                                    updated_at: new Date().toISOString()
                                                }).eq('id', chat.id);
                                                if (latestLead?.id) {
                                                    await supabaseAdmin.from('leads').update({
                                                        custom_fields: currentCustomFields
                                                    }).eq('id', latestLead.id);
                                                }
                                            } catch (persistErr) {
                                                console.warn('[WhatsApp Bot] Failed to persist instant form status:', persistErr);
                                            }
                                        }
                                    }

                                    let matchedFlowName: string | null = null;
                                    let matchedFlowId: string | null = null;

                                    // Helper: Sync Custom Fields and Recalculate Lead Score
                                    const syncFieldsAndScore = async (fieldsToMerge: Record<string, any>) => {
                                        currentCustomFields = { ...currentCustomFields, ...fieldsToMerge };
                                        if (matchedFlowName && !currentCustomFields.qualification_flow_name) {
                                            currentCustomFields.qualification_flow_name = matchedFlowName;
                                            currentCustomFields.qualification_flow_id = matchedFlowId;
                                        }
                                        await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .update({ flow_answers: currentCustomFields, updated_at: new Date().toISOString() })
                                            .eq('id', chat.id);
                                        
                                        if (latestLead?.id) {
                                            const leadUpdates: Record<string, any> = { custom_fields: currentCustomFields };
                                            const leadForm = (latestLead as any)?.form_name;
                                            if (matchedFlowName && (!leadForm || leadForm === 'WhatsApp Ad' || leadForm === 'WhatsApp Inbound' || leadForm.startsWith('AI Ad Variation'))) {
                                                leadUpdates.form_name = `WhatsApp Flow: ${matchedFlowName}`;
                                            }
                                            if (currentCustomFields?.budget) leadUpdates.budget = currentCustomFields.budget;
                                            if (currentCustomFields?.timeline) leadUpdates.timeline = currentCustomFields.timeline;

                                            // If qualification is completed on WhatsApp, cancel any scheduled voice call
                                            if (currentCustomFields?.qualification_completed) {
                                                leadUpdates.voice_call_scheduled_at = null;
                                                leadUpdates.voice_call_status = 'qualified_via_whatsapp';
                                            } else if ((latestLead as any).voice_call_status === 'pending_qualification') {
                                                if (ownerAutoCallNewLeads && ownerHasVoiceNumber) {
                                                    // Mid-flow answer: give the user another 15 minutes of grace before initiating voice call
                                                    leadUpdates.voice_call_scheduled_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
                                                } else {
                                                    leadUpdates.voice_call_scheduled_at = null;
                                                    leadUpdates.voice_call_status = 'not_called';
                                                }
                                            }

                                            await supabaseAdmin
                                                .from('leads')
                                                .update(leadUpdates)
                                                .eq('id', latestLead.id);
                                            
                                            await updateLeadScoreInDB(supabaseAdmin, latestLead.id, ownerQualifyingQuestions || undefined);
                                        }
                                    };

                                    // 1. Dynamic Qualification MCQ Handlers & Parsers
                                    const leadCampaignId = campaignId || latestLead?.campaign_id || adId;
                                    let matchedFlowQuestions: any[] | null = null;
                                    matchedFlowName = null;
                                    matchedFlowId = null;

                                    if (!isInstantFormLead && leadCampaignId) {
                                        try {
                                            const { data: matchedFlow } = await supabaseAdmin
                                                .from('whatsapp_question_flows')
                                                .select('id, questions, name, is_active')
                                                .eq('user_id', ownerUserId)
                                                .eq('linked_campaign_id', leadCampaignId)
                                                .maybeSingle();

                                            if (matchedFlow && Array.isArray(matchedFlow.questions) && matchedFlow.questions.length > 0) {
                                                console.log(`[WhatsApp Bot] Using campaign-specific flow "${matchedFlow.name}" for campaign ${leadCampaignId}`);
                                                matchedFlowQuestions = matchedFlow.questions;
                                                matchedFlowName = matchedFlow.name;
                                                matchedFlowId = matchedFlow.id;
                                                ownerQualifyingQuestions = matchedFlow.questions;
                                                ownerQualifyingEnabled = true;
                                            }
                                        } catch (fErr) {
                                            console.warn('[WhatsApp Bot] Failed to fetch campaign question flow:', fErr);
                                        }
                                    }

                                    // Fallback: If no campaign-specific flow matched, check if there is a TRUE default flow (one without a linked campaign)
                                    // IMPORTANT: Only pick flows that are NOT tied to a specific campaign, to avoid showing wrong questions for unrelated leads
                                    if (!isInstantFormLead && !matchedFlowQuestions) {
                                        try {
                                            const { data: defaultFlow } = await supabaseAdmin
                                                .from('whatsapp_question_flows')
                                                .select('id, questions, name')
                                                .eq('user_id', ownerUserId)
                                                .eq('is_active', true)
                                                .is('linked_campaign_id', null)
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .maybeSingle();

                                            if (defaultFlow && Array.isArray(defaultFlow.questions) && defaultFlow.questions.length > 0) {
                                                console.log(`[WhatsApp Bot] Using active default flow "${defaultFlow.name}" for user ${ownerUserId}`);
                                                matchedFlowQuestions = defaultFlow.questions;
                                                matchedFlowName = defaultFlow.name;
                                                matchedFlowId = defaultFlow.id;
                                                ownerQualifyingQuestions = defaultFlow.questions;
                                                ownerQualifyingEnabled = true;
                                            }
                                        } catch (dfErr) {
                                            console.warn('[WhatsApp Bot] Failed to fetch default question flow:', dfErr);
                                        }
                                    }

                                    // Persist matched qualification flow name to lead and chat records
                                    if (matchedFlowName) {
                                        const updatedFlowCf = {
                                            ...currentCustomFields,
                                            qualification_flow_name: matchedFlowName,
                                            qualification_flow_id: matchedFlowId
                                        };
                                        currentCustomFields = updatedFlowCf;

                                        if (latestLead?.id) {
                                            const leadFlowUpdates: Record<string, any> = { custom_fields: updatedFlowCf };
                                            const currentLeadForm = (latestLead as any)?.form_name;
                                            if (!currentLeadForm || currentLeadForm === 'WhatsApp Ad' || currentLeadForm === 'WhatsApp Inbound' || currentLeadForm.startsWith('AI Ad Variation')) {
                                                leadFlowUpdates.form_name = `WhatsApp Flow: ${matchedFlowName}`;
                                            }
                                            Promise.resolve(
                                                supabaseAdmin
                                                    .from('leads')
                                                    .update(leadFlowUpdates)
                                                    .eq('id', latestLead.id)
                                            ).catch(err => console.error('[WhatsApp Bot] Error associating qualification flow with lead:', err));
                                        }

                                        if (chat?.id) {
                                            Promise.resolve(
                                                supabaseAdmin
                                                    .from('whatsapp_chats')
                                                    .update({
                                                        current_flow_id: matchedFlowId,
                                                        flow_answers: updatedFlowCf
                                                    })
                                                    .eq('id', chat.id)
                                            ).catch(err => console.error('[WhatsApp Bot] Error updating chat with qualification flow:', err));
                                        }
                                    }

                                    if (!isInstantFormLead && Array.isArray(ownerQualifyingQuestions) && ownerQualifyingQuestions.length > 0) {
                                        ownerQualifyingEnabled = true;
                                    }
                                    let flowCompletionConfig: {
                                        action?: 'custom_link' | 'custom_message' | 'catalog';
                                        title?: string;
                                        url?: string;
                                        button_text?: string;
                                        message?: string;
                                    } | null = null;

                                    const parsedQuestionsList: { index: number; key: string; question: string; type?: 'choice' | 'text'; options: string[] }[] = [];
                                    if (!isInstantFormLead && Array.isArray(ownerQualifyingQuestions) && ownerQualifyingQuestions.length > 0) {
                                        let questionIdxCounter = 0;
                                        ownerQualifyingQuestions.forEach((rawItem: any) => {
                                            let item = rawItem;
                                            if (typeof item === 'string' && item.trim().startsWith('{')) {
                                                try {
                                                    const parsed = JSON.parse(item);
                                                    if (parsed && typeof parsed === 'object') item = parsed;
                                                } catch (e) {}
                                            }

                                            if (typeof item === 'object' && item !== null) {
                                                if (item._type === 'flow_completion') {
                                                    flowCompletionConfig = {
                                                        action: item.action || 'catalog',
                                                        title: item.title || '',
                                                        url: item.url || '',
                                                        button_text: item.button_text || '',
                                                        message: item.message || ''
                                                    };
                                                    return;
                                                }
                                                const qText = item.question || item.text || `Question ${questionIdxCounter + 1}`;
                                                const qLower = qText.toLowerCase();
                                                let key = item.key;
                                                if (!key) {
                                                    if (qLower.includes('budget') || qLower.includes('price')) key = 'budget';
                                                    else if (qLower.includes('timeline') || qLower.includes('when') || qLower.includes('month')) key = 'timeline';
                                                    else if (qLower.includes('property') || qLower.includes('project') || qLower.includes('type') || qLower.includes('looking for')) key = 'property_type';
                                                    else key = `custom_q_${questionIdxCounter}`;
                                                }
                                                const isTextType = item.type === 'text' || (!Array.isArray(item.options) || item.options.length === 0);
                                                parsedQuestionsList.push({
                                                    index: questionIdxCounter++,
                                                    key,
                                                    question: qText,
                                                    type: isTextType ? 'text' : 'choice',
                                                    options: isTextType ? [] : (Array.isArray(item.options) ? item.options : [])
                                                });
                                            } else if (typeof item === 'string') {
                                                const match = item.match(/\(([^)]+)\)/);
                                                const qText = item.replace(/\s*\([^)]+\)/, '').trim();
                                                const options = match ? match[1].split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                                                const qLower = (qText || item).toLowerCase();
                                                let key = `custom_q_${questionIdxCounter}`;
                                                if (qLower.includes('budget') || qLower.includes('price')) key = 'budget';
                                                else if (qLower.includes('timeline') || qLower.includes('when') || qLower.includes('month')) key = 'timeline';
                                                else if (qLower.includes('property') || qLower.includes('project') || qLower.includes('type') || qLower.includes('looking for')) key = 'property_type';
                                                const isTextType = options.length === 0;
                                                parsedQuestionsList.push({ index: questionIdxCounter++, key, question: qText || item, type: isTextType ? 'text' : 'choice', options });
                                            }
                                        });
                                    }

                                    if (!isInstantFormLead && ownerQualifyingEnabled && parsedQuestionsList.length === 0) {
                                        if (isNobogentAccount) {
                                            parsedQuestionsList.push(
                                                { index: 0, key: 'business_role', question: 'Are you a real estate broker or developer?', options: ['Broker', 'Developer', 'Channel Partner'] },
                                                { index: 1, key: 'monthly_leads', question: 'Approximately how many leads do you receive per month?', options: ['Under 50', '50–200', '200+'] },
                                                { index: 2, key: 'readiness', question: 'When would you be ready to implement Nobogent AI to scale your sales?', options: ['Immediate', 'This week', 'Next week'] }
                                            );
                                        } else if (hasProperties) {
                                            parsedQuestionsList.push(
                                                { index: 0, key: 'property_type', question: 'What type of property are you interested in?', options: ['Residential', 'Commercial', 'Plots / Land'] },
                                                { index: 1, key: 'budget', question: 'What is your budget range?', options: ['Under ₹50 Lacs', '₹50L - ₹1.5 Cr', 'Above ₹1.5 Cr'] },
                                                { index: 2, key: 'timeline', question: 'What is your timeline to purchase?', options: ['Immediate (<1 Mo)', '1 - 3 Months', 'Exploring'] }
                                            );
                                        }
                                    }

                                    const deliverPostQualificationLink = async (cleanedName?: string) => {
                                        const actionType = flowCompletionConfig?.action || 'catalog';

                                        // 1. Custom Text Message (e.g. Next steps, callback notice, personalized confirmation)
                                        if (actionType === 'custom_message' && flowCompletionConfig?.message) {
                                            let bodyText = flowCompletionConfig.message;
                                            if (cleanedName) {
                                                bodyText = bodyText.replace(/\{name\}/gi, cleanedName);
                                            }
                                            await sendTextMessage(bodyText);
                                            return;
                                        }

                                        // 2. Custom Link / Action CTA Button (e.g. Webinar, Calendly, Payment, Website, Brochure PDF)
                                        if (actionType === 'custom_link' && flowCompletionConfig?.url) {
                                            const title = flowCompletionConfig.title || (cleanedName ? `🎁 Information for ${cleanedName}` : "Curated Details");
                                            const bodyText = flowCompletionConfig.message || (cleanedName ? `Thank you, ${cleanedName}! Based on your preferences, here are your details:` : "Based on your preferences, here are your curated details:");
                                            const buttonText = flowCompletionConfig.button_text || "View Details 🚀";
                                            const linkUrl = flowCompletionConfig.url;

                                            await sendCtaUrlMessage(title, bodyText, buttonText, linkUrl);
                                            return;
                                        }

                                        // 3. Catalog fallback
                                        if (isNobogentAccount) {
                                            await sendCtaUrlMessage(
                                                cleanedName ? `🎁 Platform Information for ${cleanedName}` : "🚀 Nobogent AI Platform Overview",
                                                cleanedName ? `Thank you, ${cleanedName}! 🎉 Here is your customized overview of Nobogent AI sales automation and capabilities:` : "Here is your customized overview of Nobogent AI sales automation and capabilities:",
                                                "Explore Nobogent 🚀",
                                                catalogueLink
                                            );
                                        } else if (isPipixelAccount) {
                                            await sendTextMessage(
                                                cleanedName ? `Thank you, ${cleanedName}! 🎉 Our PiPixel specialist will connect with you shortly to share details about our marketing systems and free trial.` : "Thank you! 🎉 Our PiPixel specialist will connect with you shortly to share details about our marketing systems and free trial."
                                            );
                                            return;
                                        } else if (hasProperties) {
                                            await sendCtaUrlMessage(
                                                cleanedName ? `🎁 Tailored Catalog for ${cleanedName}` : "🏢 Your Curated Details",
                                                cleanedName ? `Thank you, ${cleanedName}! 🎉 Based on your requirements, here is your customized properties & inventory list with pricing and floor plans:` : "Here is your customized properties & inventory list with pricing and floor plans:",
                                                catalogueBtnText && catalogueBtnText !== 'View Products' ? catalogueBtnText : "View Properties 🏢",
                                                catalogueLink
                                            );
                                        } else {
                                            await sendCtaUrlMessage(
                                                cleanedName ? `🎁 Information for ${cleanedName}` : `✨ ${ownerBusinessName || 'Our Offerings'}`,
                                                cleanedName ? `Thank you, ${cleanedName}! 🎉 Here are the details tailored to your inquiry:` : "Here are the details tailored to your inquiry:",
                                                catalogueBtnText && catalogueBtnText !== 'View Products' ? catalogueBtnText : "Learn More ✨",
                                                catalogueLink
                                            );
                                        }
                                        await new Promise(r => setTimeout(r, 150));
                                        await sendThreeButtons("What would you like to do next?");
                                    };

                                    const askQuestionMCQ = async (qIndex: number) => {
                                        const qObj = parsedQuestionsList[qIndex];
                                        if (!qObj) return;
                                        if (qObj.type !== 'text' && Array.isArray(qObj.options) && qObj.options.length > 0) {
                                            if (qObj.options.length <= 3) {
                                                const rawOptions = qObj.options.slice(0, 3);
                                                const buttons = rawOptions.map((opt, optIdx) => ({
                                                    id: `q_opt_${qIndex}_${optIdx}`,
                                                    title: String(opt).slice(0, 20)
                                                }));
                                                await sendMCQButtons(qObj.question, buttons);
                                            } else {
                                                // 4 to 10 options: WhatsApp native in-app bottom sheet drawer (List message)
                                                const rawOptions = qObj.options.slice(0, 10);
                                                const items = rawOptions.map((opt, optIdx) => ({
                                                    id: `q_opt_${qIndex}_${optIdx}`,
                                                    title: String(opt).slice(0, 24),
                                                    description: String(opt).length > 24 ? String(opt).slice(0, 72) : `Option ${optIdx + 1}`
                                                }));
                                                await sendMCQList(qObj.question, items);
                                            }
                                        } else {
                                            // Short answer / text response question without options -> Send as clean text without dummy Option 1/2/3 buttons!
                                            await sendTextMessage(qObj.question);
                                        }
                                    };

                                    // 2. Check for Opt-Out / Stop / Not Interested
                                    const isOptOut = buttonReplyId === 'not_interested' || /^(stop|unsubscribe|not interested|no thanks|cancel)$/i.test(messageText.trim());
                                    if (isOptOut) {
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} requested opt-out.`);
                                        await syncFieldsAndScore({ opt_out: true, unsubscribed_at: new Date().toISOString() });
                                        if (latestLead?.id) {
                                            await supabaseAdmin.from('leads').update({ pipeline_stage: 'Lost/NI' }).eq('id', latestLead.id);
                                        }
                                        await sendTextMessage("Thank you for letting us know! 🙏 We have paused automated follow-ups. You can message us anytime if you need assistance.");
                                        return;
                                    }

                                        // 2.5 Check for "Interested" button click or text from Broadcast / Campaign templates
                                    const isInterestedClick = buttonReplyId === 'interested' || buttonReplyId === 'interested_btn' || /^(interested|i am interested|im interested|yes interested)[!.]*$/i.test(messageText.trim());
                                    if (isInterestedClick) {
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} clicked "Interested!".`);
                                        await syncFieldsAndScore({ interested_clicked: true });
                                        
                                        const validName = latestLead?.name && !/^(interested|valued lead|valued customer|lead|prospect)$/i.test(latestLead.name.trim())
                                            ? latestLead.name.trim()
                                            : (chat.recipient_name && !/^(interested|valued lead|valued customer|lead|prospect)$/i.test(chat.recipient_name.trim()) ? chat.recipient_name.trim() : '');

                                        const greeting = validName ? `Thank you, ${validName}! 🎉` : `Thank you! 🎉`;
                                        const ackText = isNobogentAccount
                                            ? `${greeting} Great to connect with you. Please let us know if you would like a live walkthrough or demo of Nobogent.`
                                            : isPipixelAccount
                                            ? `${greeting} Great to connect with you. Please let us know if you would like to claim your free trial or speak with a marketing specialist.`
                                            : hasProperties
                                            ? `${greeting} Great to connect with you. Please let us know if you have any questions or would like to schedule a visit.`
                                            : `${greeting} Great to connect with you. Please let us know how we can assist you today.`;

                                        await sendTextMessage(ackText);

                                        // Alert admin/agent via multi-channel notification with direct lead link and campaign source
                                        const notifyLeadName = validName || latestLead?.name || chat.recipient_name || 'Prospect';
                                        const targetLeadId = latestLead?.id;
                                        const targetUrl = targetLeadId ? `/dashboard/crm/${targetLeadId}` : '/dashboard/crm';
                                        const campaignContext = latestLead?.ad_name || latestLead?.source || 'WhatsApp Broadcast / Inbound';

                                        sendAdminMultiChannelNotification({
                                            ownerUserId,
                                            title: `🔥 Lead Clicked Interested on WhatsApp: ${notifyLeadName}`,
                                            body: `Prospect ${notifyLeadName} (+${cleanFrom}) clicked "Interested" on WhatsApp!\n\n📢 Source / Campaign: ${campaignContext}\n🔗 Direct CRM Link: https://app.nobogent.com${targetUrl}`,
                                            url: targetUrl,
                                            type: 'lead_interested',
                                            leadPhone: '+' + cleanFrom,
                                            leadName: notifyLeadName,
                                            leadId: targetLeadId
                                        }).catch(err => console.error('[WhatsApp Bot] Interested notification failed:', err));

                                        await new Promise(r => setTimeout(r, 150));
                                        await sendThreeButtons("What would you like to do next?");
                                        return;
                                    }

                                    // 3. Action Button 1: "View properties" / "Explore Services"
                                    const isViewProperties = buttonReplyId === 'view_properties' || /view propert|view product|explore propert|catalog|listings/i.test(messageText);
                                    if (isViewProperties) {
                                        if (isPipixelAccount) {
                                             console.log(`[WhatsApp Bot] PiPixel lead ${cleanFrom} sent view_properties/listings keyword. Bypassing real estate catalog.`);
                                             return;
                                        }
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} clicked "View properties".`);
                                        await syncFieldsAndScore({ view_properties_clicked: true });
                                        if (isNobogentAccount) {
                                            await sendCtaUrlMessage(
                                                "🚀 Nobogent AI Sales Platform",
                                                "Explore how Nobogent automates client acquisition, lead qualification, and 24/7 AI sales for your business:",
                                                "Explore Nobogent 🚀",
                                                catalogueLink
                                            );
                                        } else if (hasProperties) {
                                            await sendCtaUrlMessage(
                                                "🏢 Available Properties",
                                                "Explore our latest premium properties catalog with pricing, layouts, and amenities:",
                                                catalogueBtnText && catalogueBtnText !== 'View Products' ? catalogueBtnText : "View Properties 🏢",
                                                catalogueLink
                                            );
                                        } else {
                                            await sendCtaUrlMessage(
                                                `✨ ${ownerBusinessName || 'Our Offerings'}`,
                                                "Explore our latest products, services, and solutions:",
                                                catalogueBtnText && catalogueBtnText !== 'View Products' ? catalogueBtnText : "Explore More ✨",
                                                catalogueLink
                                            );
                                        }

                                        // If qualification is not yet completed, gently follow up with the pending qualification question (NON-instant form leads only)
                                        if (!isInstantFormLead && !currentCustomFields?.qualification_completed) {
                                            const pendingQIndex = parsedQuestionsList.findIndex(q => !currentCustomFields[q.key]);
                                            if (pendingQIndex !== -1) {
                                                await new Promise(r => setTimeout(r, 150));
                                                await sendTextMessage("To help us share the best matching options for you, please answer:");
                                                await new Promise(r => setTimeout(r, 100));
                                                await askQuestionMCQ(pendingQIndex);
                                                return;
                                            }
                                        }

                                        await new Promise(r => setTimeout(r, 150));
                                        await sendThreeButtons("What would you like to do next?");
                                        return;
                                    }

                                    // 4. Action Button 2: "Talk to an expert"
                                    const isTalkExpert = buttonReplyId === 'talk_expert' || buttonReplyId === 'connect_expert' || /talk to an expert|talk to expert|connect with expert|speak with expert|call expert/i.test(messageText);
                                    if (isTalkExpert) {
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} clicked "Talk to an expert".`);
                                        await syncFieldsAndScore({ connect_expert_clicked: true, requested_callback: true });
                                        
                                        // Confirm to lead
                                        const specialistLabel = isNobogentAccount ? 'solutions specialist' : hasProperties ? 'property advisor' : 'specialist';
                                        await sendTextMessage(`Thank you! Our ${specialistLabel} from ${ownerBusinessName || 'our team'} will reach out to you directly shortly. 🙏`);
                                        
                                        // Alert admin/agent via high-priority multi-channel notification
                                        const leadName = chat.recipient_name || latestLead?.name || 'Prospect';
                                        const targetLeadId = latestLead?.id;
                                        const targetUrl = targetLeadId ? `/dashboard/crm/${targetLeadId}` : '/dashboard/crm';
                                        const campaignContext = latestLead?.ad_name || latestLead?.source || 'WhatsApp Inbound';
                                        
                                        sendAdminMultiChannelNotification({
                                            ownerUserId,
                                            title: `🚨 Call with Expert Requested: ${leadName}`,
                                            body: `High-intent lead ${leadName} (+${cleanFrom}) clicked "Talk to an expert" on WhatsApp!\n\n📢 Source / Campaign: ${campaignContext}\n🔗 Direct CRM Link: https://app.nobogent.com${targetUrl}`,
                                            url: targetUrl,
                                            type: 'connect_expert',
                                            leadPhone: '+' + cleanFrom,
                                            leadName,
                                            leadId: targetLeadId
                                        }).catch(err => console.error('[WhatsApp Bot] Expert alert failed:', err));

                                        // If qualification is not yet completed, ask pending question so expert gets lead context (NON-instant form leads only)
                                        if (!isInstantFormLead && !currentCustomFields?.qualification_completed) {
                                            const pendingQIndex = parsedQuestionsList.findIndex(q => !currentCustomFields[q.key]);
                                            if (pendingQIndex !== -1) {
                                                await new Promise(r => setTimeout(r, 150));
                                                await sendTextMessage("While our specialist connects with you, please share:");
                                                await new Promise(r => setTimeout(r, 100));
                                                await askQuestionMCQ(pendingQIndex);
                                                return;
                                            }
                                        }

                                        await new Promise(r => setTimeout(r, 150));
                                        await sendThreeButtons("What would you like to do?");
                                        return;
                                    }

                                    // 5. Action Button 3: "Book an appointment"
                                    const isBookAppointment = buttonReplyId === 'book_appointment' || /book an appointment|book appointment|schedule visit|book site visit|schedule meeting/i.test(messageText);
                                    if (isBookAppointment) {
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} clicked "Book an appointment".`);
                                        await syncFieldsAndScore({ book_appointment_clicked: true });
                                        await sendCtaUrlMessage(
                                            "📅 Schedule Appointment",
                                            "Select a convenient consultation or site visit slot directly from our calendar:",
                                            "Book Appointment 📅",
                                            bookingLink
                                        );

                                        // If qualification is not yet completed, follow up with pending question (NON-instant form leads only)
                                        if (!isInstantFormLead && !currentCustomFields?.qualification_completed) {
                                            const pendingQIndex = parsedQuestionsList.findIndex(q => !currentCustomFields[q.key]);
                                            if (pendingQIndex !== -1) {
                                                await new Promise(r => setTimeout(r, 150));
                                                await sendTextMessage("To prepare the best options for your visit, please answer:");
                                                await new Promise(r => setTimeout(r, 100));
                                                await askQuestionMCQ(pendingQIndex);
                                                return;
                                            }
                                        }

                                        await new Promise(r => setTimeout(r, 150));
                                        await sendThreeButtons("What would you like to do next?");
                                        return;
                                    }

                                        // Check if we are waiting for the lead's name after qualification questions
                                        if (currentCustomFields?.awaiting_lead_name && messageText && messageText.trim().length > 0 && !buttonReplyId) {
                                            console.log(`[WhatsApp Bot] Lead ${cleanFrom} is in awaiting_lead_name state. Analyzing reply: "${messageText}" with AI.`);
                                            const nameAnalysis = await extractLeadNameWithAI(messageText);

                                            if (nameAnalysis.hasName && nameAnalysis.name) {
                                                const cleanedName = nameAnalysis.name;
                                                console.log(`[WhatsApp Bot] Lead ${cleanFrom} provided their name: "${cleanedName}". Updating CRM lead record.`);

                                                if (latestLead?.id) {
                                                    await supabaseAdmin.from('leads').update({ name: cleanedName }).eq('id', latestLead.id);
                                                }
                                                await supabaseAdmin.from('whatsapp_chats').update({ recipient_name: cleanedName }).eq('id', chat.id);

                                                await syncFieldsAndScore({
                                                    awaiting_lead_name: false,
                                                    lead_name_captured: true,
                                                    qualification_completed: true,
                                                    full_name: cleanedName
                                                });

                                                // Execute post-qualification flow completion action
                                                await deliverPostQualificationLink(cleanedName);
                                                return;
                                            } else {
                                                // Prospect did not give their name (e.g. asked a question like "what is the price?" or refused)
                                                console.log(`[WhatsApp Bot] Lead ${cleanFrom} did not provide a name (question/refusal). Answering inquiry and delivering completion action.`);
                                                
                                                // Answer their question/inquiry via AI without 3 generic action buttons
                                                await answerCustomerQueryWithAI(messageText, true);

                                                await syncFieldsAndScore({
                                                    awaiting_lead_name: false,
                                                    qualification_completed: true
                                                });

                                                await new Promise(r => setTimeout(r, 150));
                                                await deliverPostQualificationLink();
                                                return;
                                            }
                                        }

                                        // If qualification was already completed, but name was not previously captured, check if incoming text is the lead's name
                                        const isActionOrCommonReply = /^(interested|i am interested|im interested|yes interested|tell me more|more info|view properties|view products|talk to an expert|book an appointment|hello|hi|hey|ok|okay|thanks|thank you)[!.]*$/i.test(messageText.trim());
                                        if (!buttonReplyId && !isActionOrCommonReply && currentCustomFields?.qualification_completed && !currentCustomFields?.lead_name_captured && messageText && messageText.trim().length > 0 && messageText.trim().split(/\s+/).length <= 4) {
                                            const nameAnalysis = await extractLeadNameWithAI(messageText);
                                            if (nameAnalysis.hasName && nameAnalysis.name) {
                                                const cleanedName = nameAnalysis.name;
                                                console.log(`[WhatsApp Bot] Post-qualification name detected for lead ${cleanFrom}: "${cleanedName}". Updating CRM.`);
                                                if (latestLead?.id) {
                                                    await supabaseAdmin.from('leads').update({ name: cleanedName }).eq('id', latestLead.id);
                                                }
                                                await supabaseAdmin.from('whatsapp_chats').update({ recipient_name: cleanedName }).eq('id', chat.id);
                                                await syncFieldsAndScore({
                                                    lead_name_captured: true,
                                                    full_name: cleanedName
                                                });
                                                const nameAck = isNobogentAccount
                                                    ? `Thank you, ${cleanedName}! 🎉 Great to connect with you. Please let us know if you would like a live walkthrough or demo of Nobogent.`
                                                    : `Thank you, ${cleanedName}! 🎉 Great to connect with you. Please let us know if you have any questions or would like to schedule a visit.`;
                                                await sendTextMessage(nameAck);
                                                await new Promise(r => setTimeout(r, 150));
                                                await sendThreeButtons("What would you like to do next?");
                                                return;
                                            }
                                        }

                                        // Dynamic MCQ button clicks (q_opt_{qIndex}_{optIndex})
                                        if (buttonReplyId?.startsWith('q_opt_')) {
                                            const parts = buttonReplyId.split('_');
                                            const qIdx = parseInt(parts[2], 10);
                                            const optIdx = parseInt(parts[3], 10);
                                            const qObj = parsedQuestionsList[qIdx];
                                            if (qObj) {
                                                const selectedValue = (qObj.options && qObj.options[optIdx]) || messageText.trim();
                                                console.log(`[WhatsApp Bot] Lead ${cleanFrom} answered Q#${qIdx + 1} (${qObj.key}): ${selectedValue}`);
                                                const updateObj: Record<string, any> = { [qObj.key]: selectedValue };
                                                if (qObj.key === 'property_type') updateObj.interested_property = selectedValue;
                                                await syncFieldsAndScore(updateObj);

                                                const nextIdx = qIdx + 1;
                                                if (nextIdx < parsedQuestionsList.length) {
                                                    await askQuestionMCQ(nextIdx);
                                                    return;
                                                } else {
                                                    // All qualification questions answered -> Ask for lead name to complete tailored details
                                                    if (!currentCustomFields?.lead_name_captured) {
                                                        await syncFieldsAndScore({ awaiting_lead_name: true });
                                                        await sendTextMessage("Great! 🎉 To instantly receive your tailored details matched to your preferences, may I know your good name please?");
                                                        return;
                                                    } else {
                                                        await syncFieldsAndScore({ qualification_completed: true });
                                                        await deliverPostQualificationLink(currentCustomFields?.full_name);
                                                        return;
                                                    }
                                                }
                                            }
                                        }

                                        // Dynamic Free-Text & Number reply handler for active qualification questions (NON-instant form leads only)
                                        // If an unfinished flow has been inactive for >24 hours, consider the old qualification session expired
                                        // so that subsequent replies (e.g. to a new offer template message 2-3 days later) are answered cleanly by AI
                                        // rather than being trapped in the stale question from 3 days ago.
                                        const lastChatTime = chat?.updated_at ? new Date(chat.updated_at).getTime() : 0;
                                        const isStaleSession = lastChatTime > 0 && ((Date.now() - lastChatTime) > 24 * 60 * 60 * 1000);

                                        let activeQIndex = !isInstantFormLead ? parsedQuestionsList.findIndex(q => !currentCustomFields[q.key]) : -1;
                                        if (isStaleSession && !currentCustomFields?.qualification_completed && currentCustomFields?.qualification_started) {
                                            console.log(`[WhatsApp Bot] Stale qualification session detected for lead ${cleanFrom}. Bypassing old pending question #${activeQIndex}.`);
                                            activeQIndex = -1;
                                        }
                                        if (!isInstantFormLead && activeQIndex !== -1 && messageText && messageText.trim().length > 0 && !buttonReplyId) {
                                            const activeQ = parsedQuestionsList[activeQIndex];
                                            const hasAnyAnswer = parsedQuestionsList.some(q => currentCustomFields[q.key]);

                                            // Check if user's text matches one of the options of the active question (e.g. "1", "2", "3", "4", "5", or exact option text)
                                            let matchedOptionValue: string | null = null;
                                            if (Array.isArray(activeQ.options) && activeQ.options.length > 0) {
                                                const numMatch = messageText.trim().match(/^(?:option\s*)?([1-9]|10)$/i);
                                                if (numMatch) {
                                                    const idx = parseInt(numMatch[1], 10) - 1;
                                                    if (activeQ.options[idx]) matchedOptionValue = activeQ.options[idx];
                                                } else {
                                                    const matchedOpt = activeQ.options.find(opt => opt.toLowerCase() === messageText.trim().toLowerCase());
                                                    if (matchedOpt) matchedOptionValue = matchedOpt;
                                                }
                                            }

                                            // CASE 1: Initial message from new prospect or Ad Click (e.g. "Hello! Can I get more info on this?", "Hi", etc.)
                                            // If they have not answered any question yet and didn't directly type an MCQ option
                                            if (activeQIndex === 0 && !hasAnyAnswer && !matchedOptionValue && !currentCustomFields?.qualification_started) {
                                                console.log(`[WhatsApp Bot] Initial message for lead ${cleanFrom}: "${messageText}". Starting qualification flow with Q#0.`);
                                                if (latestLead?.id && !currentCustomFields?.qualification_completed) {
                                                    if (ownerAutoCallNewLeads && ownerHasVoiceNumber) {
                                                        await supabaseAdmin.from('leads').update({
                                                            voice_call_scheduled_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                                                            voice_call_status: 'pending_qualification',
                                                            voice_campaign_id: isUuid(leadCampaignId || latestLead.campaign_id) ? (leadCampaignId || latestLead.campaign_id) : null
                                                        }).eq('id', latestLead.id);
                                                    }
                                                }
                                                await syncFieldsAndScore({ qualification_started: true });
                                                const welcomeMsg = isNobogentAccount
                                                    ? `Hello! 👋 Welcome to *${ownerBusinessName || 'Nobogent'}*. Please answer 2 quick questions so we can share the right AI automation solutions for your business: 🚀✨`
                                                    : `Hello! 👋 Welcome to *${ownerBusinessName || 'our team'}*. Please answer 2 quick questions so we can assist you with the right options & details: 🎁🏢`;
                                                await sendTextMessage(welcomeMsg);
                                                await new Promise(r => setTimeout(r, 150));
                                                await askQuestionMCQ(0);
                                                return;
                                            }

                                            // CASE 2: Prospect asks a question / inquiry mid-qualification (e.g. "where is the site located?", "what is the price?")
                                            const isQuestionOrInquiry = messageText.includes('?') ||
                                                /\b(which|what|where|when|who|how|why|options|option|project|projects|flat|flats|villa|villas|apartment|apartments|plot|plots|floor|floors|commercial|residential|price|cost|budget|rates|rate|location|located|address|chandigarh|omaxe|lake|mulberry|celestia|cassia|resort|birch|ambrosia|gardenia|mullanpur|mohali|panchkula|zirakpur|site|visit|office|brochure|detail|details|tell me|show me|explain|available|availability|kahan|kidhar|pata|headquarters|hq|contact)\b/i.test(messageText);

                                            if (isQuestionOrInquiry && !matchedOptionValue) {
                                                // Answer query using AI without the 3 distracting buttons
                                                await answerCustomerQueryWithAI(messageText, true);
                                                if (activeQIndex !== -1 && activeQIndex < parsedQuestionsList.length) {
                                                    await new Promise(r => setTimeout(r, 150));
                                                    await sendTextMessage("To help us share the best options for you, please answer:");
                                                    await new Promise(r => setTimeout(r, 100));
                                                    await askQuestionMCQ(activeQIndex);
                                                }
                                                return;
                                            }

                                            // CASE 3: Prospect provided an answer (matched option or free-text)
                                            let selectedValue = matchedOptionValue || messageText.trim();
                                            console.log(`[WhatsApp Bot] Lead ${cleanFrom} answered active Q#${activeQIndex + 1} (${activeQ.key}) via free-text: ${selectedValue}`);
                                            const updateObj: Record<string, any> = { [activeQ.key]: selectedValue };
                                            if (activeQ.key === 'property_type') updateObj.interested_property = selectedValue;
                                            await syncFieldsAndScore(updateObj);

                                            const nextIdx = activeQIndex + 1;
                                            if (nextIdx < parsedQuestionsList.length) {
                                                await askQuestionMCQ(nextIdx);
                                                return;
                                            } else {
                                                if (!currentCustomFields?.lead_name_captured) {
                                                    await syncFieldsAndScore({ awaiting_lead_name: true });
                                                    const namePrompt = isNobogentAccount
                                                        ? "Great! 🎉 To share your personalized Nobogent platform walkthrough & access details, may I know your good name please?"
                                                        : "Great! 🎉 To receive your tailored brochure & details matched to your preferences, may I know your good name please?";
                                                    await sendTextMessage(namePrompt);
                                                    return;
                                                } else {
                                                    await syncFieldsAndScore({ qualification_completed: true });
                                                    await deliverPostQualificationLink(currentCustomFields?.full_name);
                                                    return;
                                                }
                                            }
                                        }

                                        // Legacy Real Estate Button / Keyword Fallbacks
                                        if (buttonReplyId?.startsWith('q_prop_') || /^(residential|commercial|plots|land|flat|apartment|villa)/i.test(messageText.trim())) {
                                            let selectedType = 'Residential';
                                            if (buttonReplyId === 'q_prop_commercial' || /commercial/i.test(messageText)) selectedType = 'Commercial';
                                            if (buttonReplyId === 'q_prop_plots' || /plot|land/i.test(messageText)) selectedType = 'Plots / Land';
                                            
                                            console.log(`[WhatsApp Bot] Lead ${cleanFrom} answered Property Type: ${selectedType}`);
                                            await syncFieldsAndScore({ property_type: selectedType, interested_property: selectedType });

                                            if (parsedQuestionsList.length > 1) {
                                                await askQuestionMCQ(1);
                                            } else {
                                                await sendThreeButtons("What would you like to do?");
                                            }
                                            return;
                                        }

                                        if (buttonReplyId?.startsWith('q_bud_') || /(under|50l|1\.5|cr|lacs|budget)/i.test(messageText.trim())) {
                                            let selectedBudget = '₹50L - ₹1.5 Cr';
                                            if (buttonReplyId === 'q_bud_under_50l' || /under/i.test(messageText)) selectedBudget = 'Under ₹50 Lacs';
                                            if (buttonReplyId === 'q_bud_above_1_5cr' || /above/i.test(messageText)) selectedBudget = 'Above ₹1.5 Cr';

                                            console.log(`[WhatsApp Bot] Lead ${cleanFrom} answered Budget: ${selectedBudget}`);
                                            await syncFieldsAndScore({ budget: selectedBudget });

                                            if (parsedQuestionsList.length > 2) {
                                                await askQuestionMCQ(2);
                                            } else {
                                                await sendThreeButtons("What would you like to do?");
                                            }
                                            return;
                                        }

                                        if (buttonReplyId?.startsWith('q_time_') || /(immediate|month|exploring|timeline)/i.test(messageText.trim())) {
                                            let selectedTime = '1 - 3 Months';
                                            if (buttonReplyId === 'q_time_immediate' || /immediate/i.test(messageText)) selectedTime = 'Immediate (<1 Mo)';
                                            if (buttonReplyId === 'q_time_exploring' || /exploring/i.test(messageText)) selectedTime = 'Exploring';

                                            console.log(`[WhatsApp Bot] Lead ${cleanFrom} answered Timeline: ${selectedTime}`);
                                            await syncFieldsAndScore({ timeline: selectedTime });

                                            if (!currentCustomFields?.lead_name_captured) {
                                                await syncFieldsAndScore({ awaiting_lead_name: true });
                                                const namePrompt = isNobogentAccount
                                                    ? "Great! 🎉 To share your personalized Nobogent platform walkthrough & access details, may I know your good name please?"
                                                    : hasProperties
                                                    ? "Great! 🎉 To instantly send you our tailored inventory list & brochure matched to your preferences, may I know your good name please?"
                                                    : "Great! 🎉 To share personalized information tailored to your requirements, may I know your good name please?";
                                                await sendTextMessage(namePrompt);
                                                return;
                                            } else {
                                                await sendThreeButtons("What would you like to do?");
                                                return;
                                            }
                                        }

                                        // 6. Default Fallback for New or In-Progress Leads (NON-instant form leads only):
                                        // Check if any configured question is unanswered (only if session is active, qualification enabled, and not PiPixel)
                                        const unansweredQ = (!isInstantFormLead && !isStaleSession && !isPipixelAccount && ownerQualifyingEnabled && parsedQuestionsList.length > 0) ? parsedQuestionsList.find(q => !currentCustomFields[q.key]) : null;
                                        if (unansweredQ) {
                                            // If starting question 1, send encouraging lead magnet intro
                                            if (unansweredQ.index === 0 && Object.keys(currentCustomFields).filter(k => k !== 'lead_score' && k !== 'lead_tier').length === 0) {
                                                const introMsg = isNobogentAccount
                                                    ? "Hi! 👋 Please answer a few quick questions so we can share the right Nobogent AI automation solutions & live demo for your business: 🚀✨"
                                                    : hasProperties
                                                    ? "Hi! 👋 Please answer a few quick questions so we can instantly send you a curated inventory list & brochure matched to your preferences: 🎁🏢"
                                                    : "Hi! 👋 Please answer a few quick questions so we can assist you with the right details: ✨";
                                                await sendTextMessage(introMsg);
                                                await new Promise(r => setTimeout(r, 150));
                                            }
                                            await askQuestionMCQ(unansweredQ.index);
                                            return;
                                        }

                                        // If all questions are answered but name not yet asked (NON-instant form leads only, and only if qualification is enabled and not completed yet)
                                        if (!isInstantFormLead && !isPipixelAccount && ownerQualifyingEnabled && parsedQuestionsList.length > 0 && !currentCustomFields?.qualification_completed && !currentCustomFields?.lead_name_captured && !currentCustomFields?.awaiting_lead_name) {
                                            await syncFieldsAndScore({ awaiting_lead_name: true });
                                            const namePrompt = isNobogentAccount
                                                ? "Great! 🎉 To share your personalized Nobogent platform walkthrough & access details, may I know your good name please?"
                                                : hasProperties
                                                ? "Great! 🎉 To receive your tailored inventory list & brochure matched to your preferences, may I know your good name please?"
                                                : "Great! 🎉 To share personalized information tailored to your requirements, may I know your good name please?";
                                            await sendTextMessage(namePrompt);
                                            return;
                                        }

                                        // All questions answered (or Instant Form lead): if user sends a greeting, greet warmly; otherwise answer with AI + inventory!
                                        const isGreeting = /^(hi|hello|hey|namaste|good morning|good afternoon|good evening|start|menu)$/i.test(messageText.trim().toLowerCase());
                                        if (isGreeting) {
                                            const leadDisplayName = chat.recipient_name || latestLead?.name;
                                            if (isPipixelAccount) {
                                                const greetingText = `Hello${leadDisplayName ? ' ' + leadDisplayName : ''}! 👋 Welcome to *PiPixel*. We help immigration and study-abroad businesses scale with high-converting marketing & client acquisition systems.\n\nHow can we assist you today?`;
                                                await sendTextMessage(greetingText);
                                                return;
                                            }
                                            const greetingText = `Hello${leadDisplayName ? ' ' + leadDisplayName : ''}! 👋 Welcome to *${ownerBusinessName || 'our team'}*. How can we assist you today?`;
                                            await sendThreeButtons(greetingText);
                                            return;
                                        }

                                        // Free-form inquiry / question: Answer with AI + Real Inventory + 3 Action Buttons!
                                        await answerCustomerQueryWithAI(messageText);
                                        return;

                                } catch (bgErr) {
                                    console.error('[Flow] Background customer message processing error:', bgErr);
                                }
                            })();
                        }
                    }
                }
            }
        }
        return NextResponse.json({ success: true }, { status: 200 });
    }

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === 'leadgen') {
          const leadData = change.value
          const { leadgen_id, page_id, ad_id } = leadData
          console.log(`🔍 Processing Lead: ${leadgen_id} for Page: ${page_id}`)

          if (leadgen_id && leadgen_id !== '999999999999999') {
            if (activeProcessingLeadIds.has(leadgen_id)) {
              console.log(`[Facebook Webhook] Lead ID ${leadgen_id} is currently being processed by another concurrent thread. Skipping duplicate.`);
              continue;
            }
            activeProcessingLeadIds.add(leadgen_id);
          }

          try {

          // Find the User based on the Page ID (primary selected_page_id or secondary selected_pages in business_info)
          const { data: profiles, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, selected_page_id, selected_page_name, selected_page_token, facebook_token, pixel_id, enable_distribution, auto_call_new_leads, role, agency_id, parent_id, business_info')
            .or(`selected_page_id.eq.${page_id},business_info.ilike.*${page_id}*`);

          if (profileErr || !profiles || profiles.length === 0) {
            console.error(`❌ No profile found for Page ID: ${page_id}. Error:`, profileErr);
            continue;
          }

          let matchedProfile: any = null;
          let matchedPageToken: string | null = null;

          for (const p of profiles) {
            // Check primary page
            if (String(p.selected_page_id) === String(page_id)) {
              matchedProfile = p;
              matchedPageToken = p.selected_page_token || p.facebook_token;
              break;
            }
            // Check secondary pages in business_info.selected_pages
            try {
              const bInfo = typeof p.business_info === 'string' ? JSON.parse(p.business_info) : (p.business_info || {});
              if (Array.isArray(bInfo.selected_pages)) {
                const sp = bInfo.selected_pages.find((x: any) => String(x.id) === String(page_id));
                if (sp) {
                  matchedProfile = p;
                  matchedPageToken = sp.access_token || p.facebook_token;
                  break;
                }
              }
            } catch (e) {}
          }

          if (!matchedProfile) {
            console.error(`❌ Security guard triggered: No matching profile found for Page ID: ${page_id}. Skipping.`);
            continue;
          }

          const profile = matchedProfile;
          const effectivePageToken = matchedPageToken || profile.selected_page_token || profile.facebook_token;

          if (!effectivePageToken) {
            console.error(`❌ Profile found (${profile.id}) but NO Page Token for Page ID: ${page_id}`);
            continue;
          }

          // Fetch the actual Lead Details (Name, Email, Phone, Created Time, Form ID)
          let fbLead;
          if (leadgen_id === '999999999999999') {
            fbLead = {
              id: '999999999999999',
              created_time: new Date().toISOString(),
              field_data: [
                { name: 'full_name', values: ['Test Meta Lead'] },
                { name: 'email', values: ['testmetalead@example.com'] },
                { name: 'phone_number', values: ['+919999999999'] }
              ],
              form_id: 'dummy_form_id'
            };
          } else {
            const fbUrl = `https://graph.facebook.com/v19.0/${leadgen_id}?fields=id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name&access_token=${effectivePageToken}`
            const fbResponse = await fetch(fbUrl)
            fbLead = await fbResponse.json()
          }
          
          if (fbLead.error) {
            console.error(`❌ Meta Lead Fetch Failed:`, fbLead.error)
            continue;
          }

          let name = '', phone = '', email = ''
          const customFields: Record<string, any> = {}
          let firstName = '', lastName = ''
          fbLead.field_data?.forEach((field: any) => {
            if (!field.name || !field.values || field.values.length === 0) return;
            
            const fieldName = field.name.toLowerCase().trim()
            const fieldValue = (typeof field.values[0] === 'string' ? field.values[0] : String(field.values[0] || '')).trim()
            if (!fieldValue) return

            if (
              fieldName.includes('full_name') || 
              fieldName.includes('fullname') || 
              fieldName === 'name' || 
              fieldName.includes('your_name') || 
              fieldName.includes('your name') ||
              fieldName.includes('customer_name') ||
              fieldName.includes('prospect_name') ||
              fieldName.includes('user_name') ||
              fieldName.includes('client_name')
            ) {
              name = fieldValue
            } else if (
              fieldName.includes('first_name') || 
              fieldName.includes('firstname') || 
              fieldName.includes('first name') || 
              fieldName === 'fname'
            ) {
              firstName = fieldValue
            } else if (
              fieldName.includes('last_name') || 
              fieldName.includes('lastname') || 
              fieldName.includes('last name') || 
              fieldName === 'lname'
            ) {
              lastName = fieldValue
            } else if (fieldName.includes('email') || fieldName.includes('e-mail')) {
              email = fieldValue
            } else if (
              (fieldName.includes('phone') || 
              fieldName.includes('mobile') || 
              fieldName.includes('contact') || 
              fieldName.includes('whatsapp') || 
              fieldName.includes('tel')) &&
              !fieldName.includes('verified')
            ) {
              phone = fieldValue
            } else {
              customFields[field.name] = fieldValue
            }
          })

          if (phone) {
            const hasPlus = phone.trim().startsWith('+')
            const digitsOnly = phone.replace(/\D/g, '')
            if (digitsOnly.length > 15) {
              if (digitsOnly.startsWith('91') && digitsOnly.length >= 12) {
                phone = '+91' + digitsOnly.slice(2, 12)
              } else {
                phone = (hasPlus ? '+' : '') + digitsOnly.slice(0, 15)
              }
            }
          }

          if ((!name || name.toLowerCase() === 'unknown' || name.toLowerCase() === 'lead') && (firstName || lastName)) {
            name = `${firstName} ${lastName}`.trim()
          }

          // Check customFields for first_name / full_name
          if (!name || name.toLowerCase() === 'unknown' || name.toLowerCase() === 'lead') {
            const cfFirst = customFields['first_name'] || customFields['firstName'] || customFields['First Name'] || ''
            const cfLast = customFields['last_name'] || customFields['lastName'] || customFields['Last Name'] || ''
            const cfFull = customFields['full_name'] || customFields['fullName'] || customFields['Full Name'] || customFields['name'] || customFields['Name'] || ''
            if (cfFull) {
              name = cfFull.trim()
            } else if (cfFirst || cfLast) {
              name = `${cfFirst} ${cfLast}`.trim()
            }
          }

          if (!name || name.toLowerCase() === 'unknown' || name.toLowerCase() === 'lead') {
            if (email) {
              const emailUser = email.split('@')[0].replace(/[._-]/g, ' ')
              name = emailUser.charAt(0).toUpperCase() + emailUser.slice(1)
            } else if (phone) {
              name = `Lead (${phone})`
            } else {
              name = `Meta Lead #${leadgen_id.slice(-4)}`
            }
          }

          // Fetch Form Name
          let formName = 'Facebook Lead Form'
          if (fbLead.form_id) {
            try {
              const formRes = await fetch(`https://graph.facebook.com/v19.0/${fbLead.form_id}?fields=name&access_token=${effectivePageToken}`)
              const formData = await formRes.json()
              if (formData.name) formName = formData.name
            } catch (e) {
              console.error("Could not fetch Form metadata", e)
            }
          }

          // Fetch Ad and Campaign Name if available
          let adCampaignString = 'Direct Lead Form'
          let campaignName = 'Unknown Campaign'
          let campaignId: string | null = null
          let metaAdOrigin: any = null

          const effectiveAdId = ad_id || fbLead.ad_id || null;
          if (effectiveAdId) {
            try {
                const metaToken = effectivePageToken || profile.facebook_token || profile.selected_page_token || process.env.META_SYSTEM_USER_TOKEN || '';
                const adRes = await fetch(`https://graph.facebook.com/v20.0/${effectiveAdId}?fields=id,name,adset{id,name},campaign{id,name},creative{id,name,image_url,thumbnail_url,object_story_spec,asset_feed_spec}&access_token=${metaToken}`)
                const adDetails = await adRes.json()
                if (adDetails && !adDetails.error) {
                    campaignId = adDetails.campaign?.id || null
                    campaignName = adDetails.campaign?.name || 'Unknown Campaign'
                    const adNameStr = adDetails.name || 'Facebook Lead Ad'
                    adCampaignString = `${campaignName} / ${adNameStr}`

                    const spec = adDetails.creative?.object_story_spec;
                    const assetFeed = adDetails.creative?.asset_feed_spec;
                    const creativeImg = spec?.video_data?.image_url || spec?.link_data?.picture || spec?.photo_data?.url || adDetails.creative?.image_url || adDetails.creative?.thumbnail_url || assetFeed?.images?.[0]?.url || null;
                    const headlineText = spec?.link_data?.name || spec?.video_data?.title || adNameStr;
                    const bodyText = spec?.link_data?.message || spec?.video_data?.message || assetFeed?.bodies?.[0]?.text || '';

                    const videoId = spec?.video_data?.video_id;
                    let videoMp4Url: string | null = null;
                    if (videoId) {
                        try {
                            const vidRes = await fetch(`https://graph.facebook.com/v20.0/${videoId}?fields=source&access_token=${metaToken}`);
                            const vidData = await vidRes.json();
                            if (vidData?.source) {
                                videoMp4Url = vidData.source;
                            }
                        } catch (vidErr) {
                            console.error("[Facebook Webhook] Could not fetch video MP4 URL:", vidErr);
                        }
                    }

                    metaAdOrigin = {
                        ad_id: effectiveAdId,
                        ad_name: adNameStr,
                        adset_id: adDetails.adset?.id || '',
                        adset_name: adDetails.adset?.name || '',
                        campaign_id: campaignId || '',
                        campaign_name: campaignName,
                        headline: headlineText,
                        body: bodyText,
                        image_url: creativeImg,
                        video_url: videoMp4Url || '',
                        source_id: effectiveAdId,
                        source_url: `https://www.facebook.com/ads/library/?id=${effectiveAdId}`
                    };
                }
            } catch (e) {
                console.error("Could not fetch Ad metadata", e)
            }
          }

          // Fallback attribution from raw leadgen response if ad details unavailable
          if (!campaignId && fbLead.campaign_id) campaignId = fbLead.campaign_id;
          if ((!campaignName || campaignName === 'Unknown Campaign') && fbLead.campaign_name) campaignName = fbLead.campaign_name;

          // Match property in active inventory if it corresponds to an existing product
          let matchedPropertyTitle = '';
          let matchedPropertyId: string | null = null;
          let propertiesList: any[] = [];
          try {
              const { data: properties } = await supabaseAdmin
                  .from('properties')
                  .select('id, title, image_url, images')
                  .eq('user_id', profile.id);
                  
              if (properties && properties.length > 0) {
                  propertiesList = properties;
                  const searchStr = `${campaignName} ${adCampaignString} ${formName}`.toLowerCase();
                  const matched = properties.find(p => p.title && p.title.trim().length > 2 && searchStr.includes(p.title.toLowerCase().trim()));
                  if (matched) {
                      matchedPropertyTitle = matched.title;
                      matchedPropertyId = matched.id;
                      if (metaAdOrigin) {
                          metaAdOrigin.product_name = matched.title;
                          metaAdOrigin.product_id = matched.id;
                          if (!metaAdOrigin.image_url && (matched.image_url || matched.images?.[0])) {
                              metaAdOrigin.image_url = matched.image_url || matched.images?.[0];
                          }
                      }
                  }
              }
          } catch (propErr) {
              console.error("[Facebook Webhook] Property attribution matching failed:", propErr);
          }

          if (!metaAdOrigin && (adCampaignString || formName)) {
            const matchedPropObj = propertiesList.find((p: any) => matchedPropertyId === p.id);
            const fallbackImg = matchedPropObj?.image_url || matchedPropObj?.images?.[0] || '';
            metaAdOrigin = {
              ad_id: effectiveAdId || '',
              ad_name: adCampaignString.includes(' / ') ? adCampaignString.split(' / ')[1] : adCampaignString,
              campaign_name: campaignName || (adCampaignString.includes(' / ') ? adCampaignString.split(' / ')[0] : formName),
              headline: matchedPropertyTitle || adCampaignString,
              body: formName ? `Submitted via form: ${formName}` : '',
              image_url: fallbackImg,
              video_url: '',
              source_url: effectiveAdId ? `https://www.facebook.com/ads/library/?id=${effectiveAdId}` : 'https://www.facebook.com/ads/library/',
              product_name: matchedPropertyTitle || null,
              product_id: matchedPropertyId || null
            };
          }

          if (metaAdOrigin) {
            customFields.meta_ad_origin = metaAdOrigin;
          }

          // ASSIGNMENT LOGIC: Group-Weighted Rule First, then Campaign Rule, then Global Rule
          let assignedAgentId: string | null = null;
          
          // 0. GROUP WEIGHTED DISTRIBUTION RULE (Primary Strategy)
          try {
            const targetOwnerIds = [profile.id, profile.agency_id, profile.parent_id].filter(Boolean);
            const [{ data: groupAutomations }, { data: dbUserCampaigns }] = await Promise.all([
              supabaseAdmin
                .from('automations')
                .select('*')
                .in('user_id', targetOwnerIds)
                .like('title', 'Group-Distribution:%')
                .eq('is_active', true),
              supabaseAdmin
                .from('campaigns')
                .select('id, name')
                .in('user_id', targetOwnerIds)
            ]);

            const idToName: Record<string, string> = {};
            const nameToId: Record<string, string> = {};
            dbUserCampaigns?.forEach((c: any) => {
              if (c.id && c.name) {
                idToName[c.id] = c.name;
                nameToId[c.name] = c.id;
              }
            });
            const campaignsMap = { idToName, nameToId };

            const leadCtx = {
              campaignId,
              campaignName,
              adName: metaAdOrigin?.ad_name || fbLead.ad_name || null,
              formName,
              formId: fbLead.form_id || null,
              adCampaignString,
              source: 'Facebook'
            };

            if (groupAutomations && groupAutomations.length > 0) {
              for (const aut of groupAutomations) {
                try {
                  const parsedGroup = JSON.parse(aut.description || '{}');
                  const groupCampaigns: string[] = Array.isArray(parsedGroup.campaigns) ? parsedGroup.campaigns : [];
                  const groupCampaignIds: string[] = Array.isArray(parsedGroup.campaign_ids) ? parsedGroup.campaign_ids : [];
                  const groupFormIds: string[] = Array.isArray(parsedGroup.form_ids) ? parsedGroup.form_ids : [];
                  const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];
                  const activeMembers = groupMembers.filter((m: any) => m.is_active !== false);
                  if (activeMembers.length > 0 && (groupCampaigns.length > 0 || groupCampaignIds.length > 0 || groupFormIds.length > 0)) {
                    const matchesById = (campaignId && groupCampaignIds.includes(String(campaignId))) ||
                                        (fbLead.form_id && groupFormIds.includes(String(fbLead.form_id)));
                    const matchesCamp = matchesById || (groupCampaigns.length > 0 && groupCampaigns.some(gc => matchesCampaignRule(gc, leadCtx, campaignsMap)));

                    if (matchesCamp) {
                      // Build weighted sequence pool
                      const weightedPool: any[] = [];
                      activeMembers.forEach(m => {
                        for (let i = 0; i < Math.max(1, m.weight || 1); i++) {
                          weightedPool.push(m);
                        }
                      });

                      let currentIdx = 0;
                      if (parsedGroup.last_assigned_user_id) {
                        const lastIdx = weightedPool.findIndex(m => m.userId === parsedGroup.last_assigned_user_id);
                        if (lastIdx !== -1) {
                          currentIdx = (lastIdx + 1) % weightedPool.length;
                        }
                      }

                      const selectedMember = weightedPool[currentIdx];
                      assignedAgentId = selectedMember.userId;

                      // Update group automation rule state
                      parsedGroup.last_assigned_user_id = selectedMember.userId;
                      parsedGroup.last_assigned_user_name = selectedMember.name;
                      parsedGroup.last_assigned_at = new Date().toISOString();

                      const updatedGroupJson = JSON.stringify(parsedGroup);
                      aut.description = updatedGroupJson;

                      await supabaseAdmin
                        .from('automations')
                        .update({ description: updatedGroupJson })
                        .eq('id', aut.id);

                      break;
                    }
                  }
                } catch (e) {
                  console.error("Error parsing Group-Distribution rule:", e);
                }
              }
            }
          } catch (err) {
            console.error("Error evaluating Group-Distribution rules:", err);
          }

          // 1. Campaign-Specific Assignment Fallback
          if (!assignedAgentId) {
            const ruleTitle = `Campaign-Assignment: ${adCampaignString}`;
            const ruleTitleCamp = `Campaign-Assignment: ${campaignName}`;
            
            const { data: automations } = await supabaseAdmin
              .from('automations')
              .select('description')
              .eq('user_id', profile.id)
              .in('title', [ruleTitle, ruleTitleCamp])
              .eq('is_active', true)
              .limit(1)

            if (automations && automations.length > 0) {
                try {
                    const agentIds = JSON.parse(automations[0].description || '[]');
                    if (agentIds && agentIds.length > 0) {
                        assignedAgentId = await getNextRoundRobinAgent(supabaseAdmin, agentIds);
                    }
                } catch (e) { console.error("Error parsing campaign assignment rule", e) }
            }
          }


          // Check for existing lead with this facebook_lead_id to prevent duplicates from webhook retries
          const { data: existingLead } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('facebook_lead_id', leadgen_id)
            .limit(1);

          if (existingLead && existingLead.length > 0) {
            console.log(`[Facebook Webhook] Lead ${leadgen_id} already exists in DB (by leadgen_id). Skipping.`);
            continue;
          }

          // Fetch all workspace team IDs for organization-wide deduplication
          const { data: workspaceMembers } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .or(`parent_id.eq.${profile.id},agency_id.eq.${profile.id},id.eq.${profile.id}`);
          const workspaceTeamIds = Array.from(new Set((workspaceMembers || []).map(p => p.id)));
          if (workspaceTeamIds.length === 0) workspaceTeamIds.push(profile.id);

          // Also check by phone number (both raw and normalized last 10 digits) across workspace
          const cleanPhoneDigits = phone ? phone.replace(/\D/g, '').slice(-10) : '';
          if (cleanPhoneDigits && cleanPhoneDigits.length >= 7) {
            const { data: existingByPhone } = await supabaseAdmin
              .from('leads')
              .select('*')
              .in('user_id', workspaceTeamIds)
              .ilike('phone', `%${cleanPhoneDigits}%`)
              .order('created_at', { ascending: false })
              .limit(1);

            if (existingByPhone && existingByPhone.length > 0) {
              const existingLead = existingByPhone[0];
              let cf = existingLead.custom_fields || {};
              if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }

              const currentSourceId = (adCampaignString || formName || campaignId || 'Meta Ad').trim();
              const lastReopenTime = cf.last_reopened_at ? new Date(cf.last_reopened_at).getTime() : 0;
              const isRecentReopenGlitch = (Date.now() - lastReopenTime) < 3600000 && cf.last_reopened_source === currentSourceId;

              if (isRecentReopenGlitch) {
                console.log(`[Facebook Webhook] Skipping duplicate reopen for lead ${existingLead.id} within 1h cooldown.`);
                continue;
              }

              const reopenedCount = (existingLead.reopened_count || cf.reopened_count || 0) + 1;

              // Track sources for audit (append even if same source)
              const previousSources: string[] = Array.isArray(cf.reopened_sources) ? cf.reopened_sources : [];
              const updatedSources = [...previousSources, currentSourceId];

              cf = {
                ...cf,
                is_instant_form: true,
                qualification_completed: true,
                reopened_count: reopenedCount,
                reopened_sources: updatedSources,
                last_reopened_at: new Date().toISOString(),
                last_reopened_source: currentSourceId
              };

              const updatePayloadObj: Record<string, any> = {
                custom_fields: cf,
                reopened_count: reopenedCount
              };
              if (leadgen_id && !existingLead.facebook_lead_id) {
                updatePayloadObj.facebook_lead_id = leadgen_id;
              }
              if (fbLead.form_id && !existingLead.form_id) {
                updatePayloadObj.form_id = fbLead.form_id;
              }
              if (campaignId && !existingLead.campaign_id) {
                updatePayloadObj.campaign_id = campaignId;
              }
              if (adCampaignString && !existingLead.ad_name) {
                updatePayloadObj.ad_name = adCampaignString;
              }
              if (formName && !existingLead.form_name) {
                updatePayloadObj.form_name = formName;
              }
              if (!existingLead.assigned_to && assignedAgentId) {
                updatePayloadObj.assigned_to = assignedAgentId;
              }

              await supabaseAdmin
                .from('leads')
                .update(updatePayloadObj)
                .eq('id', existingLead.id);

              const reopenDesc = `The lead was reopened from Facebook Ads\nLead Name : ${name || existingLead.name}\nContact no : ${phone}\nEmail : ${email || existingLead.email || 'N/A'}\nLead Source : Facebook\nSource Details : ${currentSourceId}\nReopen Count : ${reopenedCount}\nCurrent Stage : ${existingLead.pipeline_stage || 'New'}`;

              await supabaseAdmin.from('lead_history').insert({
                lead_id: existingLead.id,
                user_id: existingLead.assigned_to || existingLead.user_id,
                action_type: 'REOPENED',
                performed_by: 'System / Facebook',
                actor_name: 'Facebook Ads',
                description: reopenDesc,
                details: {
                  source: 'Facebook Ads',
                  ad_name: adCampaignString,
                  form_name: formName,
                  campaign_id: campaignId,
                  reopened_count: reopenedCount,
                  all_sources: updatedSources,
                  timestamp: new Date().toISOString()
                },
                created_at: new Date().toISOString()
              });

              console.log(`[Facebook Webhook] Lead ${existingLead.id} reopened (${reopenedCount} times) from ${currentSourceId}`);
              continue;
            }
          }

          // Save to DB using Admin Client
          const { data: savedLead, error } = await supabaseAdmin.from('leads').insert({
            user_id: profile.id,
            name,
            phone,
            email,
            source: 'Facebook Ads',
            facebook_lead_id: leadgen_id,
            facebook_created_at: fbLead.created_time,
            form_id: fbLead.form_id,
            form_name: formName,
            custom_fields: { ...(customFields || {}), is_instant_form: true, qualification_completed: true },
            pipeline_stage: 'New Lead',
            status: 'New Lead',
            ad_name: adCampaignString,
            assigned_to: assignedAgentId,
            campaign_id: campaignId,
            property_id: matchedPropertyId || null,
            created_at: fbLead.created_time || new Date().toISOString()
          }).select().single()

          if (error) continue;

          // 🚀 Trigger Autonomous Lead Agent for new lead qualification & booking
          if (savedLead?.id) {
              processLeadEvent({
                  eventType: 'LEAD_CREATED',
                  leadId: savedLead.id
              }).catch(err => console.error('[AUTONOMOUS AGENT] Error on LEAD_CREATED:', err));
          }
          try {
              const recipientEmails: string[] = [];
              if (profile.email) {
                  recipientEmails.push(profile.email);
              }
              
              if (assignedAgentId) {
                  const { data: agentProfile } = await supabaseAdmin
                      .from('profiles')
                      .select('email')
                      .eq('id', assignedAgentId)
                      .maybeSingle();
                  
                  if (agentProfile?.email && !recipientEmails.includes(agentProfile.email)) {
                      recipientEmails.push(agentProfile.email);
                  }
              }

              // Routine raw lead emails suppressed (Email notifications limited to high-priority events: Meeting Booked, Connect with Expert)
              console.log(`[Facebook Webhook] Raw lead email skipped for ${name} (${recipientEmails.join(', ')}). Email notifications restricted to high-priority events.`);
          } catch (emailErr: any) {
              console.error("[Facebook Webhook] Failed to send lead notification emails:", emailErr);
          }

          // Dispatch thank you auto-response email to the captured lead
          if (email) {
              try {
                  const { sendLeadAutoResponseEmail } = await import('@/utils/email-helper');
                  console.log(`[Facebook Webhook] Sending auto-response thank you email to lead: ${email}`);
                  await sendLeadAutoResponseEmail(
                      email,
                      name,
                      profile.business_name || '',
                      adCampaignString
                  );
              } catch (autoEmailErr) {
                  console.error("[Facebook Webhook] Failed to send auto-response email to lead:", autoEmailErr);
              }
          }
          const cleanSource = (adCampaignString || 'Meta Ads').split(' / ')[0];

          await sendAdminMultiChannelNotification({
              ownerUserId: profile.id,
              title: "🎯 New Facebook Lead!",
              body: `Lead: ${name}\nPhone: ${phone || 'N/A'}\nSource: ${cleanSource}`,
              url: `/dashboard/crm/${savedLead.id}`,
              type: 'new_lead'
          });
          if (assignedAgentId && assignedAgentId !== profile.id) {
              await sendAdminMultiChannelNotification({
                  ownerUserId: assignedAgentId,
                  title: "🎯 Lead Assigned to You!",
                  body: `Lead: ${name}\nPhone: ${phone || 'N/A'}\nSource: ${cleanSource}`,
                  url: `/dashboard/crm/${savedLead.id}`,
                  type: 'new_lead'
              });
          }

          // Personalize welcome template campaign name based on matched property in active inventory
          let welcomePropertyTitle = '';
          try {
              const { data: properties } = await supabaseAdmin
                  .from('properties')
                  .select('title')
                  .eq('user_id', profile.id);
                  
              if (properties && properties.length > 0) {
                  // Scan for property title in campaignName, adCampaignString, formName (case-insensitive)
                  const searchStr = `${campaignName} ${adCampaignString} ${formName}`.toLowerCase();
                  const matched = properties.find(p => p.title && searchStr.includes(p.title.toLowerCase().trim()));
                  if (matched) {
                      welcomePropertyTitle = matched.title;
                  }
              }
          } catch (propErr) {
              console.error("[Facebook Webhook] Property attribution matching failed:", propErr);
          }

          const targetCampaignName = welcomePropertyTitle || campaignName || 'our properties';

          // Trigger automated WhatsApp welcome drip campaign & instant catalog template with 'View Listings' button
          if (savedLead && phone) {
              sendInstantFormCatalogMessage(
                  supabaseAdmin,
                  savedLead.id,
                  name,
                  phone,
                  profile.id,
                  targetCampaignName
              ).catch(err => {
                  console.error('[INSTANT CATALOG WA] Instant form WhatsApp catalog message failed:', err);
              });

              triggerWelcomeDrip(
                  supabaseAdmin,
                  savedLead.id,
                  name,
                  phone,
                  profile.id,
                  targetCampaignName
              ).catch(err => {
                  console.error('[DRIP TRIGGER] Facebook lead welcome drip failed:', err);
              });
          }

          // Trigger automated Voice Dialing ONLY if auto_call_new_leads is enabled AND user has a connected voice number
          const biProfile = typeof profile?.business_info === 'string' ? JSON.parse(profile.business_info || '{}') : (profile?.business_info || {});
          const hasConnectedVoice = !!(biProfile?.claimed_vobiz_number || biProfile?.voice_vobiz_number || (profile?.voice_twilio_number && profile?.voice_twilio_sid));
          if (savedLead && phone && profile.auto_call_new_leads && hasConnectedVoice) {
              triggerOutboundCall(supabaseAdmin, savedLead.id, profile.id, true).catch(err => {
                  console.error('[AUTO CALL] Auto voice call trigger failed:', err);
              });
          }
          } finally {
            if (leadgen_id) {
              activeProcessingLeadIds.delete(leadgen_id);
            }
          }
        }
      }
    }
    if (forwardPromise) {
      try {
        await forwardPromise;
      } catch (err) {
        console.error("Error awaiting forward promise:", err);
      }
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Webhook Error:', error)
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}