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

                                            if (lastOutbound && !lastOutbound.message_text.includes('Delivery Failed by Meta')) {
                                                const errReason = firstErr.code === 131049 
                                                    ? 'Meta suppressed delivery to maintain healthy ecosystem engagement (Marketing message frequency limit). The recipient has reached Meta’s marketing message cap.'
                                                    : (firstErr.message || firstErr.title || 'Delivery failed');
                                                
                                                await supabaseAdmin
                                                    .from('whatsapp_messages')
                                                    .update({
                                                        message_text: `${lastOutbound.message_text}\n\n⚠️ *Delivery Failed by Meta (Error ${firstErr.code})*: ${errReason}`
                                                    })
                                                    .eq('id', lastOutbound.id);
                                            }

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
                                console.log(`[Facebook Webhook] Skipping duplicate message ID: ${msgId}`);
                                continue;
                            }
                            processedMessageIds.add(msgId);
                            if (processedMessageIds.size > 1000) {
                                processedMessageIds.clear();
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
                                    
                                    // Query Context
                                    const { data: properties } = await supabaseAdmin
                                        .from('properties')
                                        .select('title, price, status, property_type')
                                        .eq('user_id', matchedProfile.id)
                                        .limit(10);
                                                   // Smart lead search check
                                     let matchedLeadsText = '';
                                     let leadsList: any[] = [];
                                     try {
                                         // 1. Fetch basic leads list (up to 500 leads) for fallback/fuzzy match
                                         const { data: listData } = await supabaseAdmin
                                             .from('leads')
                                             .select('id, name, phone, email, pipeline_stage, created_at')
                                             .eq('user_id', matchedProfile.id)
                                             .order('created_at', { ascending: false })
                                             .limit(500);
                                         leadsList = listData || [];

                                         // 2. Extract keywords to perform a database-side ilike query
                                         const searchTerms = messageText
                                             .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
                                             .split(/\s+/)
                                             .filter((word: string) => word.length > 2 && !['lead', 'info', 'details', 'who', 'show', 'find', 'search', 'get', 'about', 'the', 'for', 'this', 'that', 'with', 'from', 'status', 'stage', 'contact', 'hello', 'greetings', 'status', 'hi', 'hey', 'help', 'menu', 'tell', 'want'].includes(word.toLowerCase()));

                                         if (searchTerms.length > 0) {
                                             // Search leads by name or email or phone matching the terms
                                             let leadSearchQuery = supabaseAdmin
                                                 .from('leads')
                                                 .select('id, name, phone, email, pipeline_stage, notes, source, created_at')
                                                 .eq('user_id', matchedProfile.id);
                                             
                                             const orConditions = searchTerms.map((term: string) => `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`).join(',');
                                             leadSearchQuery = leadSearchQuery.or(orConditions);
                                             
                                             const { data: matchedLeads } = await leadSearchQuery.limit(5);
                                             if (matchedLeads && matchedLeads.length > 0) {
                                                 matchedLeadsText = `\nMatched Leads details found in database:\n` + matchedLeads.map((l: any) => {
                                                     const leadLink = `https://app.nobogent.com/dashboard/crm/${l.id}`;
                                                     return `- Name: ${l.name}
  Phone: ${l.phone || 'N/A'}
  Email: ${l.email || 'N/A'}
  Stage: ${l.pipeline_stage || 'New'}
  Source: ${l.source || 'N/A'}
  Created: ${new Date(l.created_at).toLocaleString()}
  Notes: ${l.notes || 'None'}
  Link to Lead: ${leadLink}`;
                                                 }).join('\n\n');
                                             }
                                         }
                                     } catch (errSearch) {
                                         console.error("❌ Failed to search leads for context:", errSearch);
                                     }
                                     // Assign leads to the leadsList which was fetched successfully
                                     const leads: any[] = leadsList;
                                     if (false) console.log(leads);
                                        
                                    let campaignsContext = '';
                                    let facebookToken = matchedProfile.facebook_token;
                                    let adAccountId = matchedProfile.ad_account_id;
                                    
                                    // Resolve token from parent if agent/admin
                                    if ((matchedProfile.role === 'admin' || matchedProfile.role === 'agent') && (matchedProfile.parent_id || matchedProfile.agency_id)) {
                                        const { data: parentProf } = await supabaseAdmin
                                            .from('profiles')
                                            .select('facebook_token, ad_account_id')
                                            .eq('id', matchedProfile.parent_id || matchedProfile.agency_id)
                                            .single();
                                        if (parentProf) {
                                            facebookToken = parentProf.facebook_token || facebookToken;
                                            adAccountId = parentProf.ad_account_id || adAccountId;
                                        }
                                    }
                                    
                                    if (facebookToken && adAccountId) {
                                        try {
                                            const cleanAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
                                            const fbUrl = `https://graph.facebook.com/v19.0/${cleanAdAccountId}/campaigns?fields=id,name,status,effective_status,objective,start_time,insights{results,spend,actions}&limit=20&access_token=${facebookToken}`;
                                            const fbRes = await fetch(fbUrl);
                                            if (fbRes.ok) {
                                                const fbData = await fbRes.json();
                                                if (fbData.data && Array.isArray(fbData.data)) {
                                                    const liveCampaigns = fbData.data.map((c: any) => {
                                                        let spend = "0.00";
                                                        let primaryResults = "0";
                                                        let breakdownText = "None";
                                                        
                                                        if (c.insights && c.insights.data && c.insights.data[0]) {
                                                            const ins = c.insights.data[0];
                                                            spend = ins.spend || "0.00";
                                                            
                                                            // Get the primary dashboard result count
                                                            if (ins.results && Array.isArray(ins.results) && ins.results.length > 0) {
                                                                primaryResults = ins.results[0].value || "0";
                                                            }
                                                            
                                                            // Collect de-duplicated actions/events breakdown
                                                            const actionMap: Record<string, string> = {};
                                                            if (ins.actions && Array.isArray(ins.actions)) {
                                                                ins.actions.forEach((a: any) => {
                                                                    actionMap[a.action_type] = a.value;
                                                                });
                                                            }
                                                            // Ensure results action types are also in the map if missing
                                                            if (ins.results && Array.isArray(ins.results)) {
                                                                ins.results.forEach((r: any) => {
                                                                    if (r.action_type && !actionMap[r.action_type]) {
                                                                        actionMap[r.action_type] = r.value;
                                                                    }
                                                                });
                                                            }
                                                            
                                                            const actionParts = Object.entries(actionMap).map(([k, v]) => `${k}: ${v}`);
                                                            if (actionParts.length > 0) {
                                                                breakdownText = actionParts.join(', ');
                                                            }
                                                        }
                                                        return `- Campaign Name: "${c.name}" (ID: ${c.id}), Status: ${c.effective_status || c.status}, Objective: ${c.objective}, Spent: Rs. ${spend}, Start Date: ${c.start_time ? new Date(c.start_time).toLocaleDateString() : 'N/A'}, Dashboard Results: ${primaryResults}, Actions Breakdown: [${breakdownText}]`;
                                                    });
                                                    campaignsContext = `Live Meta Ad Account campaigns found:\n${liveCampaigns.join('\n')}`;
                                                }
                                            } else {
                                                const errJson = await fbRes.json();
                                                console.error("[Webhook Status] Meta API returned status code:", fbRes.status, errJson);
                                            }
                                        } catch (err: any) {
                                            console.error("[Webhook Status] Failed to fetch live campaigns from Meta:", err.message);
                                        }
                                    }
                                    
                                    if (!campaignsContext) {
                                        const { data: campaigns } = await supabaseAdmin
                                            .from('campaign_jobs')
                                            .select('status, created_at')
                                            .eq('user_id', matchedProfile.id)
                                            .limit(5);
                                        const campaignsText = campaigns
                                            ?.map((c: any) => `- Created: ${new Date(c.created_at).toLocaleDateString()}, Status: ${c.status}`)
                                            ?.join('\n') || 'No campaigns launched';
                                        campaignsContext = `Campaign Jobs (Local DB status):\n${campaignsText}`;
                                    }

                                    let systemWideStats = '';
                                    if (matchedProfile.role === 'super_admin') {
                                        const { count: totalUsers } = await supabaseAdmin
                                            .from('profiles')
                                            .select('id', { count: 'exact', head: true });
                                        const { count: totalCampaigns } = await supabaseAdmin
                                            .from('campaign_jobs')
                                            .select('id', { count: 'exact', head: true });
                                        const { count: totalLeads } = await supabaseAdmin
                                            .from('leads')
                                            .select('id', { count: 'exact', head: true });
                                            
                                        systemWideStats = `
System-Wide Super Admin Stats:
- Total Platform Users: ${totalUsers || 0}
- Total Campaigns Launched: ${totalCampaigns || 0}
- Total CRM Leads Captured: ${totalLeads || 0}
`;
                                    }
                                    
                                    const totalLeadsCount = leads?.length || 0;
                                    const stageCounts: Record<string, number> = {};
                                    const leadsByCampaign: Record<string, number> = {};
                                    leads?.forEach((l: any) => {
                                        stageCounts[l.pipeline_stage] = (stageCounts[l.pipeline_stage] || 0) + 1;
                                        if (l.campaign_id) {
                                            leadsByCampaign[l.campaign_id] = (leadsByCampaign[l.campaign_id] || 0) + 1;
                                        }
                                    });
                                    
                                    const recentLeadsText = leads
                                        ?.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                                        ?.slice(0, 5)
                                        ?.map((l: any) => `- ${l.name} (Stage: ${l.pipeline_stage})`)
                                        ?.join('\n') || 'None';
                                        
                                    const propertiesText = properties
                                        ?.map((p: any) => `- Name: "${p.title}", Price: ${p.price || 'Not Set'}, Type: ${p.property_type || 'General'}, Status: ${p.status || 'Active'}`)
                                        ?.join('\n') || 'No products in inventory';
                                        
                                    const systemContext = `
Account Context for "${matchedProfile.business_name}" (Role: ${matchedProfile.role}):
- Business Name: ${matchedProfile.business_name}
- Office Address: ${matchedProfile.address || 'Contact representative'}
- Business Overview: ${matchedProfile.business_info || `${matchedProfile.business_name} Professional Services & Offerings`}
- Contact Phone: ${matchedProfile.contact_number || matchedProfile.whatsapp_phone_number || ''}
- Total Products in Inventory: ${properties?.length || 0}
- Inventory Products:
${propertiesText}

- CRM Leads (Total: ${totalLeadsCount}):
  * Stage breakdown: ${JSON.stringify(stageCounts)}
  * Lead Counts by Campaign ID (matching Meta Campaign IDs): ${JSON.stringify(leadsByCampaign)}
  * Recent 5 Leads:
${recentLeadsText}

- Campaigns Launched:
${campaignsContext}
${systemWideStats}
`;

                                    // Fetch recent message history to provide context of the conversation
                                    let chatHistoryText = '';
                                    if (ownerChat) {
                                        try {
                                            const { data: historyMsgs } = await supabaseAdmin
                                                .from('whatsapp_messages')
                                                .select('direction, message_text, created_at')
                                                .eq('chat_id', ownerChat.id)
                                                .order('created_at', { ascending: false })
                                                .limit(10);
                                                
                                            if (historyMsgs && historyMsgs.length > 0) {
                                                chatHistoryText = historyMsgs
                                                    .reverse()
                                                    .map((m: any) => `${m.direction === 'inbound' ? 'User' : 'Bot'}: ${m.message_text}`)
                                                    .join('\n');
                                            }
                                        } catch (histErr) {
                                            console.error("❌ Failed to fetch chat history:", histErr);
                                        }
                                    }
                                    const botPrompt = `You are "Nobogent Executive Assistant & MCP Operator", the AI operational co-pilot for the Nobogent CRM, Ads, and Automation platform.
You are communicating directly via WhatsApp with the workspace owner/admin ("${matchedProfile.business_name || 'Admin'}").

Account Context:
${systemContext}

Recent Conversation History:
${chatHistoryText || "No previous messages."}

CAPABILITIES & MCP TOOLS:
You have tools to both QUERY and OPERATE the workspace:
1. Inventory Management: Add new properties/products using 'add_inventory_item', or attach photos/images to existing or newly created products using 'attach_image_to_inventory'.
2. Ad & Lead Quality Diagnostics: Use 'analyze_lead_quality' to inspect why leads might be disqualified, check call transcripts/notes, and diagnose ad performance with live data.
3. Automation Flows & Campaigns:
   - Use 'generate_campaign_flow' to build qualification workflows, calling scripts, and lead routing. It automatically registers and saves to Flow Builder and Qualification Questions!
   - Use 'publish_campaign_flow' to explicitly activate and persist a qualification flow to Flow Builder and Qualification Questions database.
   - Use 'create_campaign_draft' to build Meta ad drafts (defaults to Click-to-WhatsApp ads).
   - Use 'update_campaign_draft' to update budget (e.g. to ₹600 or any amount), campaign type (Click-to-WhatsApp vs Lead Form), target location/city, lead form ID, or campaign name on an existing draft.
   - Use 'list_facebook_lead_forms' to fetch existing active lead forms on their Facebook page whenever the user chooses or asks about lead form campaigns.
   - Use 'attach_creative_to_campaign' to attach image/video creatives (sent directly on WhatsApp or from URL) to a campaign draft.
   - Use 'generate_ai_creative' to generate fresh high-converting AI marketing creatives (images) using Nobogent's AI engine.
   - Use 'list_user_creatives' to inspect and pick from previously created graphics/videos in the user's asset library.
   - Use 'send_creative_picker' to send an in-app visual picker link allowing the user to browse high-res previews, filter by category/aspect ratio, and multi-select creatives directly inside WhatsApp's built-in browser.
   - Use 'launch_meta_campaign' to publish and launch the campaign directly into Meta Ads Manager once the user confirms with "Confirm" or "Launch".
4. CRM Operations: Search leads, inspect transcripts, fetch WhatsApp history, and update stages with 'update_lead_stage'.
${(inboundMediaType === 'image' && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:'))
    ? `\nCURRENT ATTACHED PHOTO:\nThe user has attached a photo/image directly with this WhatsApp message!\nPermanent Public Image URL: "${inboundMediaUrl}"\n- If they ask to use this photo as an ad creative (e.g. "ye creative use krlo", "use this creative", "attach to campaign"), call 'attach_creative_to_campaign' with this URL!\n- If they ask to add it to a product listing, call 'attach_image_to_inventory' with this URL!\n- If creating a new listing, pass it to 'add_inventory_item'.\n`
    : ''}
CRITICAL CONVERSATIONAL RULES:
- CAMPAIGN FORMAT SELECTION (CLICK-TO-WHATSAPP BY DEFAULT):
  * When discussing or setting up a campaign, ALWAYS explain the two formats to the user and clarify what they want:
    1. *🟢 Click-to-WhatsApp Ads (Recommended & Default)*: Leads click the ad and instantly land in your WhatsApp chat, where Nobogent AI immediately engages, qualifies, and books site visits.
    2. *📋 Instant Lead Form Ads*: Leads fill out a contact form directly inside Facebook/Instagram.
  * Unless the user specifically asks for a lead form, ALWAYS DEFAULT to Click-to-WhatsApp ('whatsapp_chat').
- LEAD FORM INQUIRY (IF USER CHOOSES INSTANT FORM):
  * If the user chooses Instant Form (or says "lead form chalana hai"):
    1. Call 'list_facebook_lead_forms' to see what active forms already exist on their Facebook page.
    2. Then ask the user:
       - Whether they want to reuse one of their existing forms (list the active form names found), OR
       - Create a new form — and ask what specific questions they want to include (e.g. Name, Phone, Email + BHK preference, Budget, Location).
    3. Update the draft with their choice ('lead_form_id' or 'custom_questions') using 'update_campaign_draft'.
- ALWAYS SOLICIT CREATIVES: When drafting or discussing a campaign, ALWAYS proactively ask the user about their creative:
  * Example: "Do you have an ad creative (photo or video) you'd like to use? You can send it directly here in WhatsApp, choose from your library, or I can generate a new AI image creative for you."
- NEVER claim that you cannot upload creatives to Meta campaigns, or that the user has to do it manually from the dashboard. You have 'attach_creative_to_campaign' and 'launch_meta_campaign'!
- NEVER claim that you cannot generate images or videos. You have 'generate_ai_creative' which connects directly to Nobogent's AI creative engine!
- When the user confirms with "Confirm", "Launch", or "Go ahead", call 'launch_meta_campaign' immediately to push it to Meta Ads Manager!
- STRICT ANTI-HALLUCINATION & SLOT FILLING:
  * NEVER claim a campaign is active or a flow is live/published unless the tool ('launch_meta_campaign' or 'publish_campaign_flow'/'generate_campaign_flow') actually returns success: true and a confirmed campaign_id or flow_id! Always report the actual tool result.
  * Never invent or guess critical parameters (e.g. price, property address, campaign budget, target city, or customer phone numbers).
  * If the user asks to add inventory, launch a campaign, or build a flow, check whether all required information is provided.
  * If any required parameter is missing, DO NOT call the tool with made-up data. Instead, politely and clearly ask the user for the missing details.
- CONFIRMATION FOR HIGH-IMPACT ACTIONS:
  * Before launching paid campaigns, present a clear summary of what will be done (budget, targeting, creative attached, flow) and ask for their confirmation (e.g. "Reply 'Confirm' to launch").
- WHATSAPP FORMATTING CONSTRAINTS:
  * WhatsApp does NOT support markdown tables, HTML, or code-blocks. NEVER output tables, columns, or markdown table syntax (| --- |).
  * Always format lists, metrics, or chat history logs as a clean, vertical, chronological stream with bold headers (*Title*) and clean bullets (•).
  * Keep messages punchy, executive-friendly, and easy to read on mobile.
- Always use "Dashboard Results" as the primary campaign result/lead count (this matches the Meta Ads Manager results column).
- Answer their query accurately using ONLY the data provided or returned by tools. Do NOT invent, estimate, or hallucinate any fields.
- Always output the full lead details if requested and provide the Link to Lead exactly as "https://app.nobogent.com/dashboard/crm/{id}" where {id} is the lead's UUID.
- ALWAYS use the host "app.nobogent.com" for lead links. Do NOT use custom domains.`;

                                    const isVisualMedia = inboundMediaType === 'image' || inboundMediaType === 'video';

                                    const saveQualificationAndFlow = async ({
                                      userId,
                                      flowName,
                                      questions,
                                      linkedCampaignId,
                                      description,
                                      callingWindow = '9:00 AM - 7:00 PM'
                                    }: {
                                      userId: string;
                                      flowName: string;
                                      questions: Array<{ question: string; options: string[] }>;
                                      linkedCampaignId?: string | null;
                                      description?: string;
                                      callingWindow?: string;
                                    }) => {
                                      // 1. Insert into whatsapp_question_flows for /dashboard/qualifying
                                      const { data: qFlow, error: qErr } = await supabaseAdmin
                                        .from('whatsapp_question_flows')
                                        .insert({
                                          user_id: userId,
                                          name: flowName,
                                          linked_campaign_id: linkedCampaignId || null,
                                          is_active: true,
                                          questions: questions
                                        })
                                        .select('id, name')
                                        .single();

                                      if (qErr) {
                                        console.error("❌ Failed to save whatsapp_question_flows:", qErr);
                                      }

                                      // 2. Update profiles so qualification is active
                                      await supabaseAdmin
                                        .from('profiles')
                                        .update({
                                          qualifying_enabled: true,
                                          qualifying_questions: questions
                                        })
                                        .eq('id', userId);

                                      // 3. Insert into automations for Flow Builder (/dashboard/flows)
                                      const flowPayload = {
                                        name: flowName,
                                        description: description || `Automated lead qualification and outreach flow for ${flowName}`,
                                        icon: 'Workflow',
                                        trigger: {
                                          type: 'trigger_meta_ad',
                                          label: linkedCampaignId ? `Meta Ad Campaign (${linkedCampaignId})` : 'Incoming Meta Ad Lead',
                                          campaignId: linkedCampaignId || null
                                        },
                                        nodes: [
                                          {
                                            id: 'node_1',
                                            type: 'trigger_meta_ad',
                                            title: 'Meta Ad Lead Arrived',
                                            description: 'Triggered when a lead submits the ad form',
                                            branch: 'main',
                                            config: { campaignId: linkedCampaignId || null }
                                          },
                                          {
                                            id: 'node_2',
                                            type: 'action_whatsapp_questions',
                                            title: 'Step 1: WhatsApp Intake Questions',
                                            description: 'Asks screening questions to the lead',
                                            branch: 'main',
                                            config: { questions: questions }
                                          },
                                          {
                                            id: 'node_3',
                                            type: 'action_qualify',
                                            title: 'Step 2: Deterministic Qualification & Scoring',
                                            description: 'Scores responses against criteria',
                                            branch: 'main',
                                            config: { scoringMode: 'points', passScore: 70 }
                                          },
                                          {
                                            id: 'node_4',
                                            type: 'action_whatsapp_msg',
                                            title: 'Step 3: Asset Delivery',
                                            description: 'Delivers property/package brochure & booking link',
                                            branch: 'main',
                                            config: { includeBrochure: true }
                                          },
                                          {
                                            id: 'node_5',
                                            type: 'action_ai_call',
                                            title: 'Step 4: AI Voice Demo Call',
                                            description: `Automated outbound sales call scheduled within ${callingWindow}`,
                                            branch: 'main',
                                            config: { voiceAgent: 'Fenrir (Crisp & Focused)' }
                                          }
                                        ],
                                        edges: [
                                          { id: 'e1-2', source: 'node_1', target: 'node_2' },
                                          { id: 'e2-3', source: 'node_2', target: 'node_3' },
                                          { id: 'e3-4', source: 'node_3', target: 'node_4' },
                                          { id: 'e4-5', source: 'node_4', target: 'node_5' }
                                        ],
                                        settings: { callingWindow }
                                      };

                                      const { data: auto, error: aErr } = await supabaseAdmin
                                        .from('automations')
                                        .insert({
                                          user_id: userId,
                                          title: `Flow: ${flowName}`,
                                          description: JSON.stringify(flowPayload),
                                          icon_name: 'Workflow',
                                          is_active: true,
                                          stats: JSON.stringify({ runs: 0, completed: 0, lastTriggeredAt: null }),
                                          created_at: new Date().toISOString()
                                        })
                                        .select('id, title')
                                        .single();

                                      if (aErr) {
                                        console.error("❌ Failed to save automation flow:", aErr);
                                      }

                                      return {
                                        qFlowId: qFlow?.id,
                                        automationId: auto?.id
                                      };
                                    };

                                    const tools = {
                                      search_leads: tool({
                                        description: 'Search for leads in the database by name, phone number, or email. Returns matching leads.',
                                        inputSchema: z.object({
                                          searchQuery: z.string().describe('The name, phone number, or email to search for.')
                                        }),
                                        execute: async (args: { searchQuery: string }) => {
                                          console.log(`🤖 [TOOL: search_leads] Triggered with search query: "${args.searchQuery}"`);
                                          const results = await dbSearchLeads(matchedProfile.id, args.searchQuery);
                                          console.log(`🤖 [TOOL: search_leads] Found ${results.length} matched leads`);
                                          return results;
                                        }
                                      }),
                                      get_lead_details: tool({
                                        description: 'Fetch full detailed profile of a specific lead by their lead UUID.',
                                        inputSchema: z.object({
                                          leadId: z.string().describe('The UUID of the lead.')
                                        }),
                                        execute: async (args: { leadId: string }) => {
                                          console.log(`🤖 [TOOL: get_lead_details] Fetching details for lead ID: "${args.leadId}"`);
                                          const result = await dbGetLeadDetails(matchedProfile.id, args.leadId);
                                          console.log(`🤖 [TOOL: get_lead_details] Result:`, result);
                                          return result;
                                        }
                                      }),
                                      get_lead_whatsapp_history: tool({
                                        description: 'Retrieve WhatsApp chat history (last 20 messages) for a specific lead by their lead UUID.',
                                        inputSchema: z.object({
                                          leadId: z.string().describe('The UUID of the lead.')
                                        }),
                                        execute: async (args: { leadId: string }) => {
                                          console.log(`🤖 [TOOL: get_lead_whatsapp_history] Fetching WhatsApp history for lead ID: "${args.leadId}"`);
                                          const result = await dbGetLeadWhatsAppHistory(matchedProfile.id, args.leadId);
                                          console.log(`🤖 [TOOL: get_lead_whatsapp_history] Retrieved ${result.length} message logs`);
                                          return result;
                                        }
                                      }),
                                      get_leads_by_stage: tool({
                                        description: 'Fetch leads in a specific pipeline stage.',
                                        inputSchema: z.object({
                                          stageName: z.string().describe("The name of the pipeline stage (e.g. 'New', 'Contacted', 'Won', 'Lost').")
                                        }),
                                        execute: async (args: { stageName: string }) => {
                                          console.log(`🤖 [TOOL: get_leads_by_stage] Fetching leads in stage: "${args.stageName}"`);
                                          const result = await dbGetLeadsByStage(matchedProfile.id, args.stageName);
                                          console.log(`🤖 [TOOL: get_leads_by_stage] Found ${result.length} leads in stage`);
                                          return result;
                                        }
                                      }),
                                      attach_image_to_inventory: tool({
                                        description: "Attaches a photo/image to an existing product or property in the user's catalog. Call this when the user sends a photo or asks to attach an image to an existing or newly created product.",
                                        inputSchema: z.object({
                                          property_id: z.string().optional().describe("UUID of the property, or leave empty if updating the most recently created product"),
                                          property_title: z.string().optional().describe("Title or search term of the property if UUID is unknown"),
                                          image_url: z.string().optional().describe("Direct image URL to attach. Defaults to the currently attached photo if omitted")
                                        }),
                                        execute: async (args: { property_id?: string; property_title?: string; image_url?: string }) => {
                                          const targetImageUrl = args.image_url || (isVisualMedia && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:') ? inboundMediaUrl : null);
                                          if (!targetImageUrl) {
                                            return { success: false, error: "No image attachment or URL available to attach." };
                                          }

                                          let targetPropertyId = args.property_id;

                                          if (!targetPropertyId) {
                                            let query = supabaseAdmin
                                              .from('properties')
                                              .select('id, title, images')
                                              .eq('user_id', matchedProfile.id);

                                            if (args.property_title) {
                                              query = query.ilike('title', `%${args.property_title}%`);
                                            } else {
                                              query = query.order('created_at', { ascending: false });
                                            }

                                            const { data: matchedProps } = await query.limit(1);
                                            if (matchedProps && matchedProps.length > 0) {
                                              targetPropertyId = matchedProps[0].id;
                                            }
                                          }

                                          if (!targetPropertyId) {
                                            return { success: false, error: "No product found in catalog to attach the photo to." };
                                          }

                                          const { data: currProp } = await supabaseAdmin
                                            .from('properties')
                                            .select('id, title, image_url, images')
                                            .eq('id', targetPropertyId)
                                            .single();

                                          const existingImages: string[] = Array.isArray(currProp?.images) ? [...currProp.images] : [];
                                          if (!existingImages.includes(targetImageUrl)) {
                                            existingImages.push(targetImageUrl);
                                          }

                                          const { data: updatedProp, error: updateErr } = await supabaseAdmin
                                            .from('properties')
                                            .update({
                                              image_url: targetImageUrl,
                                              images: existingImages
                                            })
                                            .eq('id', targetPropertyId)
                                            .select('id, title, image_url')
                                            .single();

                                          if (updateErr) {
                                            return { success: false, error: updateErr.message };
                                          }

                                          return {
                                            success: true,
                                            property_id: updatedProp.id,
                                            property_title: updatedProp.title,
                                            image_url: updatedProp.image_url,
                                            message: `Successfully attached photo to "${updatedProp.title}". It is now active on your public landing page and catalog!`
                                          };
                                        }
                                      }),
                                      add_inventory_item: tool({
                                        description: "Adds a new property or product listing to the user's inventory catalog. ONLY call this when title, price, address, and property_type are provided. If any required detail is missing, ask the user first before calling this tool.",
                                        inputSchema: z.object({
                                          title: z.string().describe("Property title, e.g. '3BHK Luxury Apartment, Green Valley'"),
                                          price: z.string().describe("Price or price range, e.g. '₹85 Lakhs' or '₹1.2 Cr'"),
                                          address: z.string().describe("Location or locality, e.g. 'Baner, Pune'"),
                                          property_type: z.string().describe("Property type: 1BHK, 2BHK, 3BHK, 4BHK, Villa, Commercial, Plot, or Generic"),
                                          description: z.string().optional().describe("Description, amenities, or highlights"),
                                          image_urls: z.array(z.string()).optional().describe("Optional array of image URLs to attach")
                                        }),
                                        execute: async (args: { title: string; price: string; address: string; property_type: string; description?: string; image_urls?: string[] }) => {
                                          console.log(`🤖 [TOOL: add_inventory_item] Adding property: "${args.title}" for user: ${matchedProfile.id}`);
                                          try {
                                            const images = args.image_urls || (isVisualMedia && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:') ? [inboundMediaUrl] : []);
                                            const { data: newProp, error: propErr } = await supabaseAdmin
                                              .from('properties')
                                              .insert({
                                                user_id: matchedProfile.id,
                                                title: args.title,
                                                price: args.price,
                                                address: args.address,
                                                property_type: args.property_type || 'Generic',
                                                description: args.description || '',
                                                image_url: images[0] || '',
                                                images: images,
                                                status: 'Active',
                                                show_on_landing_page: true
                                              })
                                              .select('id, title, price, address, property_type')
                                              .single();

                                            if (propErr) {
                                              console.error("❌ [TOOL: add_inventory_item] Insert error:", propErr);
                                              return { success: false, error: propErr.message };
                                            }

                                            return {
                                              success: true,
                                              property_id: newProp.id,
                                              title: newProp.title,
                                              price: newProp.price,
                                              address: newProp.address,
                                              message: "Property successfully added to inventory and is now active on your landing page."
                                            };
                                          } catch (err: any) {
                                            console.error("❌ [TOOL: add_inventory_item] Error:", err);
                                            return { success: false, error: err.message };
                                          }
                                        }
                                      }),
                                      analyze_lead_quality: tool({
                                        description: "Analyzes why lead quality might be low, inspecting lead qualification scores, CRM rejection notes, AI call transcripts, and live Meta ad metrics. Call this when the user asks about lead quality, conversion issues, or ad optimization.",
                                        inputSchema: z.object({
                                          timeframe_days: z.number().optional().describe("Number of days to analyze, default 7")
                                        }),
                                        execute: async (args: { timeframe_days?: number }) => {
                                          console.log(`🤖 [TOOL: analyze_lead_quality] Running diagnostics for user: ${matchedProfile.id}`);
                                          try {
                                            const days = args.timeframe_days || 7;
                                            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

                                            const { data: recentLeads, error: leadsErr } = await supabaseAdmin
                                              .from('leads')
                                              .select('id, name, phone, pipeline_stage, notes, summary, budget, timeline, voice_call_status, voice_call_summary, created_at, campaign_id')
                                              .eq('user_id', matchedProfile.id)
                                              .gte('created_at', cutoff)
                                              .order('created_at', { ascending: false })
                                              .limit(100);

                                            if (leadsErr) {
                                              console.error("❌ [TOOL: analyze_lead_quality] Leads fetch error:", leadsErr);
                                            }

                                            const { data: callLogs, error: callsErr } = await supabaseAdmin
                                              .from('call_logs')
                                              .select('id, lead_id, status, notes, duration, created_at')
                                              .eq('user_id', matchedProfile.id)
                                              .gte('created_at', cutoff)
                                              .limit(50);

                                            if (callsErr) {
                                              console.error("❌ [TOOL: analyze_lead_quality] Calls fetch error:", callsErr);
                                            }

                                            const totalLeads = recentLeads?.length || 0;
                                            const stages: Record<string, number> = {};
                                            let jobSeekersCount = 0;
                                            let webinarOrMeetingCount = 0;
                                            let lowBudgetCount = 0;
                                            let locationMismatchCount = 0;
                                            let dnpCount = 0;
                                            let qualifiedCount = 0;

                                            recentLeads?.forEach((l: any) => {
                                              stages[l.pipeline_stage || 'Unknown'] = (stages[l.pipeline_stage || 'Unknown'] || 0) + 1;
                                              const combinedNotes = `${l.notes || ''} ${l.summary || ''} ${l.voice_call_summary || ''}`.toLowerCase();

                                              if (combinedNotes.includes('job') || combinedNotes.includes('resume') || combinedNotes.includes('cv') || combinedNotes.includes('interview')) {
                                                jobSeekersCount++;
                                              }
                                              if (combinedNotes.includes('webinar') || combinedNotes.includes('meeting') || combinedNotes.includes('demo') || combinedNotes.includes('register')) {
                                                webinarOrMeetingCount++;
                                              }
                                              if (combinedNotes.includes('budget') || combinedNotes.includes('low') || combinedNotes.includes('expensive')) {
                                                lowBudgetCount++;
                                              }
                                              if (combinedNotes.includes('location') || combinedNotes.includes('far') || combinedNotes.includes('area')) {
                                                locationMismatchCount++;
                                              }
                                              if (combinedNotes.includes('not picked') || combinedNotes.includes('dnp') || combinedNotes.includes('switched off') || combinedNotes.includes('not answer')) {
                                                dnpCount++;
                                              }
                                              if (['meeting planned', 'meeting done', 'qualified', 'won', 'site visit'].some(s => (l.pipeline_stage || '').toLowerCase().includes(s)) || combinedNotes.includes('registered for webinar') || combinedNotes.includes('joined the webinar')) {
                                                qualifiedCount++;
                                              }
                                            });

                                            const sampleCallNotes = (recentLeads || [])
                                              .filter((l: any) => l.notes || l.summary)
                                              .slice(0, 10)
                                              .map((l: any) => ({
                                                lead_name: l.name,
                                                stage: l.pipeline_stage,
                                                note_snippet: (l.notes || l.summary || '').replace(/\s+/g, ' ').trim().substring(0, 150)
                                              }));

                                            return {
                                              timeframe_days: days,
                                              total_leads_in_crm: totalLeads,
                                              qualified_or_high_intent_leads: qualifiedCount,
                                              qualification_rate_percent: totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 100) : 0,
                                              stage_breakdown: stages,
                                              call_and_rejection_reasons: {
                                                job_seekers_or_interview_inquiries: jobSeekersCount,
                                                webinar_or_demo_attendees: webinarOrMeetingCount,
                                                unreachable_or_dnp: dnpCount,
                                                budget_or_cost_mismatches: lowBudgetCount,
                                                location_mismatches: locationMismatchCount
                                              },
                                              total_calls_logged: callLogs?.length || 0,
                                              sample_live_call_notes: sampleCallNotes,
                                              ad_campaigns_summary: campaignsContext || "No active Meta campaign data available."
                                            };
                                          } catch (err: any) {
                                            console.error("❌ [TOOL: analyze_lead_quality] Error:", err);
                                            return { error: err.message };
                                          }
                                        }
                                      }),
                                      generate_campaign_flow: tool({
                                        description: "Designs, saves, and registers a multi-step WhatsApp lead qualification & automated calling workflow into Flow Builder and Qualification Questions database from natural language instructions.",
                                        inputSchema: z.object({
                                          prompt: z.string().describe("Natural language description of the automation flow (e.g. 'Ask for budget and timeline, if qualified send brochure and trigger sales call')"),
                                          flow_name: z.string().optional().describe("Optional descriptive name for the flow"),
                                          linked_campaign_id: z.string().optional().describe("Optional Meta campaign ID or draft ID to link"),
                                          questions: z.array(z.object({
                                            question: z.string(),
                                            options: z.array(z.string()).optional()
                                          })).optional().describe("Optional specific qualification questions")
                                        }),
                                        execute: async (args: { prompt: string; flow_name?: string; linked_campaign_id?: string; questions?: Array<{ question: string; options?: string[] }> }) => {
                                          console.log(`🤖 [TOOL: generate_campaign_flow] Generating and saving flow for: "${args.prompt}"`);
                                          try {
                                            const flowName = args.flow_name || (args.prompt.length > 40 ? `${args.prompt.slice(0, 37)}...` : args.prompt);

                                            let finalQuestions: Array<{ question: string; options: string[] }> = [];
                                            if (args.questions && args.questions.length > 0) {
                                              finalQuestions = args.questions.map(q => ({
                                                question: q.question,
                                                options: q.options && q.options.length > 0 ? q.options : ['Yes', 'No']
                                              }));
                                            } else {
                                              const pLower = args.prompt.toLowerCase();
                                              if (pLower.includes('broker') || pLower.includes('listing') || pLower.includes('nobogent') || pLower.includes('sales package')) {
                                                finalQuestions = [
                                                  {
                                                    question: 'Kitne active listings/projects hain aur NCR mein kis area mein?',
                                                    options: ['1 - 5 Listings (Gurgaon / Noida)', '5 - 20 Listings (Delhi NCR)', '20+ Listings (Multiple Cities)']
                                                  },
                                                  {
                                                    question: 'Meta ads chal rahe hain ya nahi? Monthly ad budget aur leads status?',
                                                    options: ['Chal rahe hain (Budget ₹15k+)', 'Chal rahe hain (Budget <₹15k)', 'Abhi nahi chal rahe']
                                                  },
                                                  {
                                                    question: 'Nobogent AI Sales & Marketing Package (₹15,000) schedule karein?',
                                                    options: ['Haan, Demo Call Schedule Karein', 'Brochure / Details Bhejo', 'Baad Mein Batayenge']
                                                  }
                                                ];
                                              } else {
                                                finalQuestions = [
                                                  {
                                                    question: 'What type of property or service are you looking for?',
                                                    options: ['Residential', 'Commercial', 'Investment / Advisory']
                                                  },
                                                  {
                                                    question: 'What is your budget range?',
                                                    options: ['Under ₹50 Lacs', '₹50L - ₹1.5 Cr', 'Above ₹1.5 Cr']
                                                  },
                                                  {
                                                    question: 'What is your purchase or implementation timeline?',
                                                    options: ['Immediate (< 1 Month)', '1 - 3 Months', 'Exploring']
                                                  }
                                                ];
                                              }
                                            }

                                            // Persist directly to DB
                                            const saved = await saveQualificationAndFlow({
                                              userId: matchedProfile.id,
                                              flowName,
                                              questions: finalQuestions,
                                              linkedCampaignId: args.linked_campaign_id || null,
                                              description: args.prompt
                                            });

                                            return {
                                              success: true,
                                              flow_id: saved.automationId,
                                              qualification_flow_id: saved.qFlowId,
                                              flow_name: flowName,
                                              questions: finalQuestions,
                                              message: `✅ Flow "${flowName}" has been structured and saved to your database! It is now active in your Flow Builder (/dashboard/flows) and Qualification Questions (/dashboard/qualifying).`
                                            };
                                          } catch (err: any) {
                                            console.error("❌ [TOOL: generate_campaign_flow] Error:", err);
                                            return { success: false, error: err.message };
                                          }
                                        }
                                      }),
                                      publish_campaign_flow: tool({
                                        description: "Publishes and activates a WhatsApp Qualification Flow and saves it to Flow Builder and Qualification Questions database. Call this whenever the user confirms or asks to publish/activate a workflow.",
                                        inputSchema: z.object({
                                          flow_name: z.string().describe("Name of the flow, e.g. 'Delhi NCR Broker Qualification'"),
                                          prompt: z.string().optional().describe("Description of the workflow"),
                                          linked_campaign_id: z.string().optional().describe("Meta Campaign ID or draft ID to link this flow to"),
                                          questions: z.array(z.object({
                                            question: z.string(),
                                            options: z.array(z.string()).optional()
                                          })).optional().describe("Qualification questions list"),
                                          calling_window: z.string().optional().describe("Calling window (e.g. '9 AM - 7 PM')")
                                        }),
                                        execute: async (args: { flow_name: string; prompt?: string; linked_campaign_id?: string; questions?: Array<{ question: string; options?: string[] }>; calling_window?: string }) => {
                                          console.log(`🤖 [TOOL: publish_campaign_flow] Publishing flow: "${args.flow_name}"`);
                                          try {
                                            const finalQuestions = (args.questions && args.questions.length > 0)
                                              ? args.questions.map(q => ({ question: q.question, options: q.options || ['Yes', 'No'] }))
                                              : [
                                                  {
                                                    question: 'Kitne active listings/projects hain aur NCR mein kis area mein?',
                                                    options: ['1 - 5 Listings (Gurgaon / Noida)', '5 - 20 Listings (Delhi NCR)', '20+ Listings (Multiple Cities)']
                                                  },
                                                  {
                                                    question: 'Meta ads chal rahe hain ya nahi? Monthly ad budget aur leads status?',
                                                    options: ['Chal rahe hain (Budget ₹15k+)', 'Chal rahe hain (Budget <₹15k)', 'Abhi nahi chal rahe']
                                                  },
                                                  {
                                                    question: 'Nobogent AI Sales & Marketing Package (₹15,000) schedule karein?',
                                                    options: ['Haan, Demo Call Schedule Karein', 'Brochure / Details Bhejo', 'Baad Mein Batayenge']
                                                  }
                                                ];

                                            const saved = await saveQualificationAndFlow({
                                              userId: matchedProfile.id,
                                              flowName: args.flow_name,
                                              questions: finalQuestions,
                                              linkedCampaignId: args.linked_campaign_id || null,
                                              description: args.prompt,
                                              callingWindow: args.calling_window || '9:00 AM - 7:00 PM'
                                            });

                                            return {
                                              success: true,
                                              flow_id: saved.automationId,
                                              qualification_flow_id: saved.qFlowId,
                                              flow_name: args.flow_name,
                                              message: `✅ Flow "${args.flow_name}" has been published and activated in Flow Builder (/dashboard/flows) and Qualification Questions (/dashboard/qualifying).`
                                            };
                                          } catch (err: any) {
                                            console.error("❌ [TOOL: publish_campaign_flow] Error:", err);
                                            return { success: false, error: err.message };
                                          }
                                        }
                                      }),
                                      list_facebook_lead_forms: tool({
                                        description: "Lists existing Meta Instant Lead Forms from the user's connected Facebook Page. Call this whenever the user chooses an instant lead form campaign or asks what lead forms already exist.",
                                        inputSchema: z.object({}),
                                        execute: async () => {
                                          try {
                                            const pageId = (matchedProfile as any).selected_page_id;
                                            const pageToken = (matchedProfile as any).selected_page_token || matchedProfile.facebook_token;
                                            if (!pageId || !pageToken) {
                                              return { success: false, error: "Facebook Page is not connected in settings." };
                                            }

                                            const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?fields=id,name,status,questions{id,label,key,type}&limit=10&access_token=${pageToken}`);
                                            const data = await res.json();
                                            if (!res.ok || data.error) {
                                              return { success: false, error: data.error?.message || "Failed to fetch lead forms from Facebook." };
                                            }

                                            const forms = (data.data || []).map((f: any) => ({
                                              id: f.id,
                                              name: f.name,
                                              status: f.status,
                                              questions: (f.questions || []).map((q: any) => q.label || q.key || q.type)
                                            }));

                                            return {
                                              success: true,
                                              forms,
                                              count: forms.length,
                                              message: forms.length > 0
                                                ? `Found ${forms.length} active lead form(s) on your Facebook Page. Ask the user if they'd like to use one of these or create a new custom form.`
                                                : "No existing lead forms found on your Facebook Page. Ask the user what questions they want to include in their new lead form."
                                            };
                                          } catch (e: any) {
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      }),
                                      create_campaign_draft: tool({
                                        description: "Creates a draft Meta ad campaign. Ask user whether they want Click-to-WhatsApp (DEFAULT & RECOMMENDED) or Instant Lead Form. ONLY call this when daily budget, target location, and campaign name are provided.",
                                        inputSchema: z.object({
                                          campaign_name: z.string().describe("Name of the campaign"),
                                          daily_budget_inr: z.number().describe("Daily budget in INR (e.g. 1500 or 600)"),
                                          target_city: z.string().describe("City or locality to target"),
                                          campaign_type: z.enum(['whatsapp_chat', 'instant_form']).default('whatsapp_chat').describe("Type of campaign: 'whatsapp_chat' for Click-to-WhatsApp (DEFAULT & RECOMMENDED), or 'instant_form' for on-Facebook Lead Form."),
                                          lead_form_id: z.string().optional().describe("ID of existing Meta lead form to use if campaign_type is 'instant_form'"),
                                          custom_questions: z.array(z.string()).optional().describe("List of custom questions to ask in the form if creating a new lead form (e.g. ['2BHK or 3BHK?', 'Budget range?'])"),
                                          property_id: z.string().optional().describe("UUID of property from inventory"),
                                          objective: z.string().optional().describe("Campaign objective, e.g. 'OUTCOME_ENGAGEMENT' for WhatsApp or 'OUTCOME_LEADS' for instant form"),
                                          creative_url: z.string().optional().describe("Optional direct image or video URL for the ad creative")
                                        }),
                                        execute: async (args: {
                                          campaign_name: string;
                                          daily_budget_inr: number;
                                          target_city: string;
                                          campaign_type?: 'whatsapp_chat' | 'instant_form';
                                          lead_form_id?: string;
                                          custom_questions?: string[];
                                          property_id?: string;
                                          objective?: string;
                                          creative_url?: string;
                                        }) => {
                                          const selectedType = args.campaign_type || 'whatsapp_chat';
                                          const selectedObjective = args.objective || (selectedType === 'whatsapp_chat' ? 'OUTCOME_ENGAGEMENT' : 'OUTCOME_LEADS');
                                          console.log(`🤖 [TOOL: create_campaign_draft] Creating draft campaign: "${args.campaign_name}" (${selectedType})`);
                                          try {
                                            const initialCreative = args.creative_url || (isVisualMedia && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:') ? inboundMediaUrl : null);
                                            const creativeList = initialCreative ? [initialCreative] : [];

                                            let customQuestionsStr: string | null = null;
                                            if (args.custom_questions && args.custom_questions.length > 0) {
                                              customQuestionsStr = JSON.stringify(args.custom_questions.map(q => ({ type: 'CUSTOM', label: q })));
                                            }

                                            const parsedLocations = args.target_city.split(/[,&/+]|\band\b/i).map(s => s.trim()).filter(Boolean);
                                            const { data: job, error } = await supabaseAdmin
                                              .from('campaign_jobs')
                                              .insert({
                                                user_id: matchedProfile.id,
                                                target_user_id: matchedProfile.id,
                                                status: 'draft',
                                                payload: {
                                                  campaign_name: args.campaign_name,
                                                  daily_budget: args.daily_budget_inr,
                                                  dailyBudget: args.daily_budget_inr,
                                                  target_locations: parsedLocations.length > 0 ? parsedLocations : [args.target_city],
                                                  property_id: args.property_id || null,
                                                  objective: selectedObjective,
                                                  campaignType: selectedType,
                                                  leadFormId: args.lead_form_id || null,
                                                  customQuestionsStr: customQuestionsStr,
                                                  creative_urls: creativeList,
                                                  creativeUrls: creativeList
                                                }
                                              })
                                              .select('id, status')
                                              .single();

                                            if (error) {
                                              console.error("❌ [TOOL: create_campaign_draft] DB error:", error);
                                              return { success: false, error: error.message };
                                            }

                                            return {
                                              success: true,
                                              draft_id: job.id,
                                              campaign_name: args.campaign_name,
                                              daily_budget: args.daily_budget_inr,
                                              campaign_type: selectedType,
                                              lead_form_id: args.lead_form_id || null,
                                              has_creative: creativeList.length > 0,
                                              creative_url: initialCreative || null,
                                              status: 'draft',
                                              message: `Campaign draft created as ${selectedType === 'whatsapp_chat' ? 'Click-to-WhatsApp (Messages)' : 'Instant Lead Form'}! ${creativeList.length > 0 ? "Creative is attached. Present summary and ask user to reply 'Confirm' to launch." : "Proactively ask user for their ad creative."}`
                                            };
                                          } catch (err: any) {
                                            return { success: false, error: err.message };
                                          }
                                        }
                                      }),
                                      update_campaign_draft: tool({
                                        description: "Updates an existing draft campaign's parameters such as daily budget, target location/city, campaign type ('whatsapp_chat' vs 'instant_form'), lead form ID, custom questions, campaign name, or objective. Call this whenever the user asks to change or update their budget (e.g. 'budget 600 kar do'), switch between WhatsApp and Lead Form, choose an existing form, add questions, or change the city BEFORE launching.",
                                        inputSchema: z.object({
                                          job_id: z.string().optional().describe("UUID of the campaign job from campaign_jobs. Defaults to the user's latest draft campaign if omitted."),
                                          daily_budget_inr: z.number().optional().describe("New daily budget in INR (e.g. 600 or 1500)"),
                                          target_city: z.string().optional().describe("New target city or locality (e.g. 'Pune' or 'Delhi NCR')"),
                                          campaign_type: z.enum(['whatsapp_chat', 'instant_form']).optional().describe("Switch type: 'whatsapp_chat' (Click-to-WhatsApp) or 'instant_form' (Instant Lead Form)"),
                                          lead_form_id: z.string().optional().describe("ID of existing Meta lead form to use if campaign_type is 'instant_form'"),
                                          custom_questions: z.array(z.string()).optional().describe("Custom questions to ask in the lead form (e.g. ['Preferred unit size?', 'Budget range?'])"),
                                          campaign_name: z.string().optional().describe("New name for the campaign"),
                                          objective: z.string().optional().describe("Campaign objective, e.g. 'OUTCOME_LEADS' or 'OUTCOME_ENGAGEMENT'")
                                        }),
                                        execute: async (args: {
                                          job_id?: string;
                                          daily_budget_inr?: number;
                                          target_city?: string;
                                          campaign_type?: 'whatsapp_chat' | 'instant_form';
                                          lead_form_id?: string;
                                          custom_questions?: string[];
                                          campaign_name?: string;
                                          objective?: string;
                                        }) => {
                                          try {
                                            let targetJobId = args.job_id;
                                            if (!targetJobId) {
                                              const { data: latestDraft } = await supabaseAdmin
                                                .from('campaign_jobs')
                                                .select('id, payload')
                                                .eq('user_id', matchedProfile.id)
                                                .eq('status', 'draft')
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .maybeSingle();
                                              if (latestDraft) targetJobId = latestDraft.id;
                                            }

                                            if (!targetJobId) {
                                              return { success: false, error: "No campaign draft found to update. Please create a campaign draft first." };
                                            }

                                            const { data: currentJob } = await supabaseAdmin
                                              .from('campaign_jobs')
                                              .select('id, payload')
                                              .eq('id', targetJobId)
                                              .single();

                                            if (!currentJob) {
                                              return { success: false, error: "Campaign draft not found." };
                                            }

                                            const existingPayload = currentJob.payload || {};
                                            const newType = args.campaign_type || existingPayload.campaignType || 'whatsapp_chat';
                                            const newObjective = args.objective || (args.campaign_type ? (args.campaign_type === 'whatsapp_chat' ? 'OUTCOME_ENGAGEMENT' : 'OUTCOME_LEADS') : existingPayload.objective);

                                            let newCustomQuestionsStr = existingPayload.customQuestionsStr;
                                            if (args.custom_questions && args.custom_questions.length > 0) {
                                              newCustomQuestionsStr = JSON.stringify(args.custom_questions.map(q => ({ type: 'CUSTOM', label: q })));
                                            }

                                            const updatedLocations = args.target_city
                                              ? args.target_city.split(/[,&/+]|\band\b/i).map(s => s.trim()).filter(Boolean)
                                              : existingPayload.target_locations;

                                            const updatedPayload = {
                                              ...existingPayload,
                                              ...(args.daily_budget_inr ? { daily_budget: args.daily_budget_inr, dailyBudget: args.daily_budget_inr } : {}),
                                              target_locations: updatedLocations,
                                              ...(args.campaign_name ? { campaign_name: args.campaign_name } : {}),
                                              campaignType: newType,
                                              objective: newObjective,
                                              ...(args.lead_form_id !== undefined ? { leadFormId: args.lead_form_id } : {}),
                                              ...(newCustomQuestionsStr !== undefined ? { customQuestionsStr: newCustomQuestionsStr } : {})
                                            };

                                            const { error: updateErr } = await supabaseAdmin
                                              .from('campaign_jobs')
                                              .update({
                                                payload: updatedPayload,
                                                updated_at: new Date().toISOString()
                                              })
                                              .eq('id', targetJobId);

                                            if (updateErr) {
                                              return { success: false, error: updateErr.message };
                                            }

                                            return {
                                              success: true,
                                              job_id: targetJobId,
                                              campaign_name: updatedPayload.campaign_name,
                                              campaign_type: updatedPayload.campaignType,
                                              daily_budget: updatedPayload.daily_budget,
                                              lead_form_id: updatedPayload.leadFormId || null,
                                              target_locations: updatedPayload.target_locations,
                                              message: `Campaign draft updated successfully! Type: ${updatedPayload.campaignType === 'whatsapp_chat' ? 'Click-to-WhatsApp' : 'Instant Lead Form'}, Budget: ₹${updatedPayload.daily_budget || '1500'}/day, Location: ${Array.isArray(updatedPayload.target_locations) ? updatedPayload.target_locations.join(', ') : updatedPayload.target_locations}.`
                                            };
                                          } catch (e: any) {
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      }),
                                      attach_creative_to_campaign: tool({
                                        description: "Attaches an image or video creative to a draft Meta ad campaign. Call this whenever the user provides a photo/video (or sends an image URL) and asks to use it as an ad creative, or says 'use this creative', 'attach this to the campaign'.",
                                        inputSchema: z.object({
                                          job_id: z.string().optional().describe("UUID of the campaign job from campaign_jobs. Defaults to the user's most recent draft campaign if omitted."),
                                          creative_url: z.string().optional().describe("Direct image or video URL to use. Defaults to the currently attached photo from WhatsApp if omitted."),
                                          headline: z.string().optional().describe("Optional headline for the ad creative"),
                                          primary_text: z.string().optional().describe("Optional primary copy text for the ad")
                                        }),
                                        execute: async (args: { job_id?: string; creative_url?: string; headline?: string; primary_text?: string }) => {
                                          const targetUrl = args.creative_url || (isVisualMedia && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:') ? inboundMediaUrl : null);
                                          if (!targetUrl) {
                                            return { success: false, error: "No image/video creative provided or attached to message." };
                                          }

                                          let targetJobId = args.job_id;
                                          if (!targetJobId) {
                                            const { data: latestJob } = await supabaseAdmin
                                              .from('campaign_jobs')
                                              .select('id, payload')
                                              .eq('user_id', matchedProfile.id)
                                              .order('created_at', { ascending: false })
                                              .limit(1)
                                              .single();
                                            if (latestJob) {
                                              targetJobId = latestJob.id;
                                            }
                                          }

                                          if (!targetJobId) {
                                            return { success: false, error: "No campaign draft found in your account. Please create a campaign draft first." };
                                          }

                                          const { data: currentJob } = await supabaseAdmin
                                            .from('campaign_jobs')
                                            .select('id, payload')
                                            .eq('id', targetJobId)
                                            .single();

                                          const existingPayload = currentJob?.payload || {};
                                          const existingCreatives: string[] = Array.isArray(existingPayload.creativeUrls || existingPayload.creative_urls)
                                            ? [...(existingPayload.creativeUrls || existingPayload.creative_urls)]
                                            : [];

                                          if (!existingCreatives.includes(targetUrl)) {
                                            existingCreatives.push(targetUrl);
                                          }

                                          const updatedPayload = {
                                            ...existingPayload,
                                            creative_urls: existingCreatives,
                                            creativeUrls: existingCreatives,
                                            adCopy: {
                                              headline: args.headline || existingPayload.adCopy?.headline || "AI Sales & Marketing Platform",
                                              primary_text: args.primary_text || existingPayload.adCopy?.primary_text || "Automate your lead generation with Nobogent AI.",
                                              description: existingPayload.adCopy?.description || "Book a free demo"
                                            }
                                          };

                                          const { error: updateErr } = await supabaseAdmin
                                            .from('campaign_jobs')
                                            .update({
                                              payload: updatedPayload,
                                              updated_at: new Date().toISOString()
                                            })
                                            .eq('id', targetJobId);

                                          if (updateErr) {
                                            return { success: false, error: updateErr.message };
                                          }

                                          // Also register in assets table
                                          try {
                                            await supabaseAdmin.from('assets').insert({
                                              user_id: matchedProfile.id,
                                              url: targetUrl,
                                              type: targetUrl.includes('.mp4') ? 'video' : 'image',
                                              status: 'Draft',
                                              caption: args.headline || 'Campaign Creative'
                                            });
                                          } catch (e) {}

                                          return {
                                            success: true,
                                            job_id: targetJobId,
                                            attached_creative_url: targetUrl,
                                            message: `Creative successfully attached to campaign "${existingPayload.campaign_name || targetJobId}". The campaign now has its creative and is ready to launch!`
                                          };
                                        }
                                      }),
                                      generate_ai_creative: tool({
                                        description: "Generates a high-converting AI image creative for ads or marketing using Nobogent's AI creative engine. Call this when the user asks to generate, create, or design a new image creative or visual for an ad.",
                                        inputSchema: z.object({
                                          prompt: z.string().describe("Detailed description of the visual scene, subject, headline text overlay, and style"),
                                          aspect_ratio: z.enum(["1:1", "4:5", "9:16", "16:9"]).optional().describe("Aspect ratio, default 1:1 or 4:5 for Meta Feed"),
                                          campaign_job_id: z.string().optional().describe("Optional campaign draft ID to automatically attach this generated creative to")
                                        }),
                                        execute: async (args: { prompt: string; aspect_ratio?: "1:1" | "4:5" | "9:16" | "16:9"; campaign_job_id?: string }) => {
                                          try {
                                            console.log(`🎨 [TOOL: generate_ai_creative] Generating AI creative: "${args.prompt}"`);
                                            const { createKieImageTask, queryKieTask } = await import('@/utils/external-apis');
                                            const ratio = args.aspect_ratio || "1:1";
                                            const taskId = await createKieImageTask(args.prompt, "gpt-image-2-5-flare-text-to-image", ratio);

                                            if (!taskId) {
                                              return { success: false, error: "Failed to queue image generation task." };
                                            }

                                            // Poll up to 10 seconds for immediate resolution
                                            let finalImageUrl: string | null = null;
                                            for (let attempt = 0; attempt < 5; attempt++) {
                                              await new Promise(r => setTimeout(r, 2000));
                                              const statusRes = await queryKieTask(taskId);
                                              if (statusRes.state === 'success' && statusRes.resultUrl) {
                                                finalImageUrl = statusRes.resultUrl;
                                                break;
                                              }
                                              if (statusRes.state === 'fail') break;
                                            }

                                            const returnUrl = finalImageUrl || `https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/${matchedProfile.id}/${Date.now()}.jpg`;

                                            // Save to assets table
                                            await supabaseAdmin.from('assets').insert({
                                              user_id: matchedProfile.id,
                                              url: returnUrl,
                                              type: 'image',
                                              status: finalImageUrl ? 'Draft' : 'Processing',
                                              caption: args.prompt.substring(0, 100),
                                              kie_task_id: taskId
                                            });

                                            // If campaign draft exists, attach it
                                            let targetJobId = args.campaign_job_id;
                                            if (!targetJobId) {
                                              const { data: latestDraft } = await supabaseAdmin
                                                .from('campaign_jobs')
                                                .select('id')
                                                .eq('user_id', matchedProfile.id)
                                                .eq('status', 'draft')
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .single();
                                              if (latestDraft) targetJobId = latestDraft.id;
                                            }

                                            if (targetJobId && returnUrl) {
                                              const { data: currentJob } = await supabaseAdmin
                                                .from('campaign_jobs')
                                                .select('payload')
                                                .eq('id', targetJobId)
                                                .single();
                                              if (currentJob) {
                                                const p = currentJob.payload || {};
                                                const cUrls = Array.isArray(p.creativeUrls) ? [...p.creativeUrls] : [];
                                                if (!cUrls.includes(returnUrl)) cUrls.push(returnUrl);
                                                await supabaseAdmin.from('campaign_jobs').update({
                                                  payload: { ...p, creative_urls: cUrls, creativeUrls: cUrls }
                                                }).eq('id', targetJobId);
                                              }
                                            }

                                            return {
                                              success: true,
                                              image_url: returnUrl,
                                              task_id: taskId,
                                              message: finalImageUrl
                                                ? `AI Creative generated successfully and added to your asset library! URL: ${finalImageUrl}`
                                                : `AI Creative task queued (${taskId}). It is processing in the background and will be saved in your asset library shortly.`
                                            };
                                          } catch (e: any) {
                                            console.error("❌ [TOOL: generate_ai_creative] Error:", e);
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      }),
                                      send_creative_picker: tool({
                                        description: "Sends an interactive WhatsApp message with a secure link and CTA button that opens the mobile-first Creative Picker webview directly inside WhatsApp. The webview lets the user view full image/video previews, filter by category (Images, Videos, AI Generated) and aspect ratio (1:1, 9:16), upload new files from their phone, and multi-select items. Call this whenever the user asks to see, choose, filter, or select creatives for a campaign.",
                                        inputSchema: z.object({
                                          campaign_job_id: z.string().optional().describe("Optional campaign draft ID to attach the selected creatives to.")
                                        }),
                                        execute: async (args: { campaign_job_id?: string }) => {
                                          try {
                                            console.log(`🎨 [TOOL: send_creative_picker] Triggered for user ${matchedProfile.id}`);

                                            let targetJobId = args.campaign_job_id;
                                            if (!targetJobId) {
                                              const { data: latestDraft } = await supabaseAdmin
                                                .from('campaign_jobs')
                                                .select('id, payload')
                                                .eq('user_id', matchedProfile.id)
                                                .eq('status', 'draft')
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .maybeSingle();
                                              if (latestDraft) targetJobId = latestDraft.id;
                                            }

                                            // Generate secure session token (valid for 48 hours)
                                            const token = createCreativeSessionToken({
                                              userId: matchedProfile.id,
                                              campaignId: targetJobId,
                                              phone: cleanFrom
                                            });

                                            // Base URL for webview (strictly enforce public app.nobogent.com for mobile devices)
                                            let baseUrl = 'https://app.nobogent.com';
                                            if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes('local.') && !process.env.NEXT_PUBLIC_APP_URL.includes('localhost')) {
                                              baseUrl = process.env.NEXT_PUBLIC_APP_URL;
                                            }
                                            const pickerUrl = `${baseUrl.replace(/\/$/, '')}/select-creatives?token=${token}`;

                                            const targetPhoneId = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_PHONE_ID || wabaPhoneId || matchedProfile.whatsapp_phone_number_id)
                                              : (wabaPhoneId || matchedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID);
                                            const targetToken = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_ACCESS_TOKEN || matchedProfile.whatsapp_access_token || matchedProfile.facebook_token)
                                              : (matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN);

                                            // Send interactive CTA URL message to WhatsApp
                                            const msgPayload = {
                                              messaging_product: 'whatsapp',
                                              recipient_type: 'individual',
                                              to: cleanFrom,
                                              type: 'interactive',
                                              interactive: {
                                                type: 'cta_url',
                                                header: {
                                                  type: 'text',
                                                  text: '🎨 Select Campaign Creatives'
                                                },
                                                body: {
                                                  text: `Tap the button below to view full visual previews of your creatives, filter by Images, Videos & AI, or upload new files from your phone gallery.\n\n🔗 *Direct Link:*\n${pickerUrl}`
                                                },
                                                footer: {
                                                  text: 'Nobogent AI'
                                                },
                                                action: {
                                                  name: 'cta_url',
                                                  parameters: {
                                                    display_text: 'Select Creatives 🎨',
                                                    url: pickerUrl
                                                  }
                                                }
                                              }
                                            };

                                            const sendRes = await fetch(`https://graph.facebook.com/v20.0/${targetPhoneId}/messages`, {
                                              method: 'POST',
                                              headers: {
                                                'Authorization': `Bearer ${targetToken}`,
                                                'Content-Type': 'application/json'
                                              },
                                              body: JSON.stringify(msgPayload)
                                            });

                                            const sendData = await sendRes.json();
                                            if (!sendRes.ok) {
                                              console.warn('[send_creative_picker] CTA URL failed, sending text fallback:', sendData);
                                              // Fallback to standard formatted text message with link
                                              await fetch(`https://graph.facebook.com/v20.0/${targetPhoneId}/messages`, {
                                                method: 'POST',
                                                headers: {
                                                  'Authorization': `Bearer ${targetToken}`,
                                                  'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                  messaging_product: 'whatsapp',
                                                  recipient_type: 'individual',
                                                  to: cleanFrom,
                                                  type: 'text',
                                                  text: {
                                                    body: `🎨 *Select Your Campaign Creatives*\n\nTap the link below to open your creative gallery directly in WhatsApp. You can preview high-res images, filter by video/image/AI, upload new photos, and multi-select:\n\n👉 ${pickerUrl}\n\nOnce selected, tap 'Attach to Campaign' and I'll update your campaign automatically!`
                                                  }
                                                })
                                              });
                                            }

                                            return {
                                              success: true,
                                              picker_url: pickerUrl,
                                              message: "Sent interactive Creative Picker link to the user's WhatsApp. They can tap to open the visual gallery, filter, preview, and multi-select."
                                            };
                                          } catch (e: any) {
                                            console.error('❌ [send_creative_picker] Error:', e);
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      }),
                                      send_location_picker: tool({
                                        description: "Sends an interactive WhatsApp message with a secure link that opens the live Meta Location and Radius Picker webview. The user can search any city or region directly against Meta's Marketing API directory, select cities, set radius (17-80 km), and save directly to their campaign draft. Call this whenever the user wants to change, select, verify, or fine-tune target locations or radiuses for their campaign, or asks how to target specific cities.",
                                        inputSchema: z.object({
                                          campaign_job_id: z.string().optional().describe("Optional campaign draft ID to attach locations to.")
                                        }),
                                        execute: async (args: { campaign_job_id?: string }) => {
                                          try {
                                            console.log(`📍 [TOOL: send_location_picker] Triggered for user ${matchedProfile.id}`);

                                            let targetJobId = args.campaign_job_id;
                                            if (!targetJobId) {
                                              const { data: latestDraft } = await supabaseAdmin
                                                .from('campaign_jobs')
                                                .select('id, payload')
                                                .eq('user_id', matchedProfile.id)
                                                .eq('status', 'draft')
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .maybeSingle();
                                              if (latestDraft) targetJobId = latestDraft.id;
                                            }

                                            const token = createCreativeSessionToken({
                                              userId: matchedProfile.id,
                                              campaignId: targetJobId,
                                              phone: cleanFrom
                                            });

                                            let baseUrl = 'https://app.nobogent.com';
                                            if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes('local.') && !process.env.NEXT_PUBLIC_APP_URL.includes('localhost')) {
                                              baseUrl = process.env.NEXT_PUBLIC_APP_URL;
                                            }
                                            const pickerUrl = `${baseUrl.replace(/\/$/, '')}/select-creatives?token=${token}&tab=locations`;

                                            const targetPhoneId = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_PHONE_ID || wabaPhoneId || matchedProfile.whatsapp_phone_number_id)
                                              : (wabaPhoneId || matchedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID);
                                            const targetToken = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_ACCESS_TOKEN || matchedProfile.whatsapp_access_token || matchedProfile.facebook_token)
                                              : (matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN);

                                            const msgPayload = {
                                              messaging_product: 'whatsapp',
                                              recipient_type: 'individual',
                                              to: cleanFrom,
                                              type: 'interactive',
                                              interactive: {
                                                type: 'cta_url',
                                                header: {
                                                  type: 'text',
                                                  text: '📍 Target Locations & Radius'
                                                },
                                                body: {
                                                  text: `Search and select exact cities directly from Meta's live directory (Muktsar, Mohali, Panchkula, etc.) and set radiuses (17-80 km):\n\n🔗 *Direct Link:*\n${pickerUrl}`
                                                },
                                                footer: {
                                                  text: 'Nobogent AI'
                                                },
                                                action: {
                                                  name: 'cta_url',
                                                  parameters: {
                                                    display_text: 'Select Locations 📍',
                                                    url: pickerUrl
                                                  }
                                                }
                                              }
                                            };

                                            const sendRes = await fetch(`https://graph.facebook.com/v20.0/${targetPhoneId}/messages`, {
                                              method: 'POST',
                                              headers: {
                                                'Authorization': `Bearer ${targetToken}`,
                                                'Content-Type': 'application/json'
                                              },
                                              body: JSON.stringify(msgPayload)
                                            });

                                            if (!sendRes.ok) {
                                              await fetch(`https://graph.facebook.com/v20.0/${targetPhoneId}/messages`, {
                                                method: 'POST',
                                                headers: {
                                                  'Authorization': `Bearer ${targetToken}`,
                                                  'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                  messaging_product: 'whatsapp',
                                                  recipient_type: 'individual',
                                                  to: cleanFrom,
                                                  type: 'text',
                                                  text: {
                                                    body: `📍 *Select Target Locations & Radius*\n\nTap the link below to search live Meta cities and adjust radius:\n👉 ${pickerUrl}\n\nOnce saved, your campaign draft will be updated automatically!`
                                                  }
                                                })
                                              });
                                            }

                                            return {
                                              success: true,
                                              location_picker_url: pickerUrl,
                                              message: "Sent interactive Location & Radius Picker link to the user's WhatsApp. They can tap to search live Meta cities, adjust radius, and save."
                                            };
                                          } catch (e: any) {
                                            console.error('❌ [send_location_picker] Error:', e);
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      }),
                                      launch_meta_campaign: tool({
                                        description: "Publishes and launches a draft Meta ad campaign directly into Meta Ads Manager. Call this when the user confirms with 'Confirm', 'Launch', 'Go ahead', or asks to activate the campaign.",
                                        inputSchema: z.object({
                                          job_id: z.string().optional().describe("UUID of the campaign job from campaign_jobs. Defaults to the latest draft campaign if omitted."),
                                          daily_budget_inr: z.number().optional().describe("Optional daily budget override in INR (e.g. 600). If specified, launches with this budget.")
                                        }),
                                        execute: async (args: { job_id?: string; daily_budget_inr?: number }) => {
                                          let targetJobId = args.job_id;
                                          if (!targetJobId) {
                                            const { data: latestDraft } = await supabaseAdmin
                                              .from('campaign_jobs')
                                              .select('id, payload')
                                              .eq('user_id', matchedProfile.id)
                                              .eq('status', 'draft')
                                              .order('created_at', { ascending: false })
                                              .limit(1)
                                              .single();
                                            if (latestDraft) targetJobId = latestDraft.id;
                                          }

                                          if (!targetJobId) {
                                            return { success: false, error: "No campaign draft found to launch. Please create a campaign draft first." };
                                          }

                                          const { data: job } = await supabaseAdmin
                                            .from('campaign_jobs')
                                            .select('*')
                                            .eq('id', targetJobId)
                                            .single();

                                          if (!job) {
                                            return { success: false, error: "Campaign draft not found." };
                                          }

                                          const payload = job.payload || {};
                                          const creativeList = payload.creativeUrls || payload.creative_urls || [];
                                          if (creativeList.length === 0) {
                                            return {
                                              success: false,
                                              error: "Campaign requires at least one creative (photo or video). Please send a photo here or ask me to generate an AI creative first."
                                            };
                                          }

                                          // Verify Meta credentials
                                          const fbToken = matchedProfile.facebook_token;
                                          const adAccId = matchedProfile.ad_account_id;
                                          const pageId = (matchedProfile as any).selected_page_id;

                                          if (!fbToken || !adAccId) {
                                            return {
                                              success: false,
                                              error: "Meta Ad Account or Facebook Token is missing from your profile. Please check your Facebook connection in settings."
                                            };
                                          }

                                          const targetBudget = args.daily_budget_inr || payload.daily_budget || payload.dailyBudget || 1500;
                                          const selectedType = payload.campaignType || 'whatsapp_chat';
                                          const fullJobPayload = {
                                            ...payload,
                                            facebookToken: fbToken,
                                            adAccountId: adAccId,
                                            pageId: pageId || undefined,
                                            selected_page_token: (matchedProfile as any).selected_page_token || undefined,
                                            dailyBudget: targetBudget,
                                            daily_budget: targetBudget,
                                            metaLocationsStr: payload.metaLocationsStr || (Array.isArray(payload.target_locations) ? payload.target_locations.join(', ') : (payload.target_locations || 'Delhi NCR')),
                                            target_locations: payload.target_locations || ['Delhi NCR'],
                                            creativeUrls: creativeList,
                                            campaign_name: payload.campaign_name || 'Nobogent Campaign',
                                            campaignType: selectedType,
                                            objective: selectedType === 'whatsapp_chat' ? 'OUTCOME_ENGAGEMENT' : (payload.objective || 'OUTCOME_LEADS'),
                                            leadFormId: payload.leadFormId || null,
                                            customQuestionsStr: payload.customQuestionsStr || null,
                                            adCopy: payload.adCopy || {
                                              headline: 'AI Sales Team for Real Estate',
                                              primary_text: 'Stop wasting ad spend on cold leads. Automate your sales with Nobogent.',
                                              description: 'Book a free demo'
                                            },
                                            whatsappNumber: matchedProfile.contact_number || '',
                                            businessName: matchedProfile.business_name || 'Nobogent',
                                            contactNumber: matchedProfile.contact_number || '',
                                            currency: (matchedProfile as any).currency || 'INR',
                                            linkUrl: 'https://app.nobogent.com',
                                            privacyPolicyUrl: 'https://nobogent.com/privacy'
                                          };

                                          await supabaseAdmin
                                            .from('campaign_jobs')
                                            .update({
                                              status: 'pending',
                                              payload: fullJobPayload,
                                              updated_at: new Date().toISOString()
                                            })
                                            .eq('id', targetJobId);

                                          // Execute campaign launch and await result
                                          try {
                                            const { runCampaignJob } = await import('@/utils/campaign-processor');
                                            const jobResult = await runCampaignJob(targetJobId, fullJobPayload);
                                            const createdCampaignId = jobResult?.campaignId;

                                            // Auto-link any unlinked qualification flow for this user to this newly created campaign ID
                                            if (createdCampaignId) {
                                              try {
                                                await supabaseAdmin
                                                  .from('whatsapp_question_flows')
                                                  .update({ linked_campaign_id: createdCampaignId })
                                                  .eq('user_id', matchedProfile.id)
                                                  .is('linked_campaign_id', null);
                                              } catch (linkErr) {
                                                console.warn("Could not auto-link campaign to flow:", linkErr);
                                              }
                                            }

                                            return {
                                              success: true,
                                              job_id: targetJobId,
                                              campaign_id: createdCampaignId || null,
                                              campaign_name: fullJobPayload.campaign_name,
                                              daily_budget: fullJobPayload.dailyBudget,
                                              creative_count: creativeList.length,
                                              message: jobResult?.message || `🚀 Campaign "${fullJobPayload.campaign_name}" has been successfully created in your Meta Ads Manager!`
                                            };
                                          } catch (procErr: any) {
                                            console.error("❌ Failed to launch campaign via runCampaignJob:", procErr);
                                            return {
                                              success: false,
                                              job_id: targetJobId,
                                              error: procErr.message || "Meta Ads Manager launch failed",
                                              message: `❌ Campaign launch failed: ${procErr.message || "Error communicating with Meta API"}. Please check your ad creative, payment method, or Meta settings.`
                                            };
                                          }
                                        }
                                      }),
                                      update_lead_stage: tool({
                                        description: "Updates a lead's pipeline stage (e.g. 'Qualified', 'Site Visit Scheduled', 'Contacted', 'Won', 'Lost') or appends notes to their profile.",
                                        inputSchema: z.object({
                                          leadId: z.string().describe("The UUID of the lead to update"),
                                          newStage: z.string().describe("The new pipeline stage: 'New', 'Contacted', 'Qualified', 'Site Visit Scheduled', 'Negotiation', 'Won', 'Lost'"),
                                          notes: z.string().optional().describe("Optional note to append to the lead record")
                                        }),
                                        execute: async (args: { leadId: string; newStage: string; notes?: string }) => {
                                          console.log(`🤖 [TOOL: update_lead_stage] Updating lead: ${args.leadId} to stage: ${args.newStage}`);
                                          try {
                                            const updatePayload: any = {
                                              pipeline_stage: args.newStage,
                                              updated_at: new Date().toISOString()
                                            };
                                            if (args.notes) {
                                              const { data: currentLead } = await supabaseAdmin
                                                .from('leads')
                                                .select('notes')
                                                .eq('id', args.leadId)
                                                .single();
                                              updatePayload.notes = currentLead?.notes ? `${currentLead.notes}\n[WhatsApp Update]: ${args.notes}` : args.notes;
                                            }

                                            const { data: updatedLead, error } = await supabaseAdmin
                                              .from('leads')
                                              .update(updatePayload)
                                              .eq('id', args.leadId)
                                              .eq('user_id', matchedProfile.id)
                                              .select('id, name, phone, pipeline_stage')
                                              .single();

                                            if (error) return { success: false, error: error.message };

                                            await supabaseAdmin.from('lead_history').insert({
                                              lead_id: args.leadId,
                                              action_type: 'STAGE_CHANGE',
                                              description: `Pipeline stage updated to "${args.newStage}" via WhatsApp MCP Assistant.`
                                            });

                                            return { success: true, lead: updatedLead, message: `Lead updated to "${args.newStage}" successfully.` };
                                          } catch (err: any) {
                                            return { success: false, error: err.message };
                                          }
                                        }
                                      }),
                                      list_inventory_items: tool({
                                        description: "Lists properties or products in the user's catalog. Call this when the user asks what products/properties they have or wants to attach a campaign to an inventory item.",
                                        inputSchema: z.object({
                                          limit: z.number().optional().describe("Number of items to return, default 5")
                                        }),
                                        execute: async (args: { limit?: number }) => {
                                          const lim = args.limit || 5;
                                          const { data: props, error } = await supabaseAdmin
                                            .from('properties')
                                            .select('id, title, price, address, status, image_url')
                                            .eq('user_id', matchedProfile.id)
                                            .order('created_at', { ascending: false })
                                            .limit(lim);

                                          if (error || !props || props.length === 0) {
                                            return { products: [], message: "No inventory items found." };
                                          }

                                          return {
                                            total: props.length,
                                            products: props.map((p: any) => ({
                                              id: p.id,
                                              title: p.title,
                                              price: p.price,
                                              address: p.address,
                                              status: p.status,
                                              image_url: p.image_url || 'No image attached'
                                            }))
                                          };
                                        }
                                      }),
                                      trigger_ai_call: tool({
                                        description: "Triggers an instant or scheduled AI voice call to a lead using Nobogent's voice AI calling engine. Call this when the user asks to call a lead, dial a prospect, or test AI calling.",
                                        inputSchema: z.object({
                                          lead_id: z.string().describe("UUID of the lead to call"),
                                          force_now: z.boolean().optional().describe("Force dial immediately even if outside normal calling hours, default true")
                                        }),
                                        execute: async (args: { lead_id: string; force_now?: boolean }) => {
                                          try {
                                            console.log(`📞 [TOOL: trigger_ai_call] Calling lead: ${args.lead_id} for user: ${matchedProfile.id}`);
                                            const res = await triggerOutboundCall(supabaseAdmin, args.lead_id, matchedProfile.id, false);
                                            if (!res.success) {
                                              return { success: false, error: res.error || "Failed to initiate call." };
                                            }
                                            return {
                                              success: true,
                                              call_sid: res.callSid,
                                              scheduled: res.scheduled,
                                              message: res.scheduled
                                                ? `Call has been scheduled for ${res.scheduledTime ? new Date(res.scheduledTime).toLocaleTimeString() : 'the next calling window'}.`
                                                : `AI Call has been initiated! The prospect's phone is ringing now.`
                                            };
                                          } catch (e: any) {
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      })
                                    };

                                    let botResponseText = "Hello! I received your message, but I encountered an error while processing your request. Please try again.";
                                    let ownerUsage = { promptTokens: 0, completionTokens: 0, modelName: 'gemini-3.5-flash' };
                                    
                                    try {
                                        // 1. Fetch super admin model selection
                                        let selectedModel = 'gemini';
                                        try {
                                            const { data: adminProfs } = await supabaseAdmin
                                                .from('profiles')
                                                .select('selected_text_llm')
                                                .eq('role', 'super_admin')
                                                .limit(1);
                                            if (adminProfs && adminProfs.length > 0) {
                                                selectedModel = adminProfs[0].selected_text_llm || 'gemini';
                                            }
                                        } catch (errAdmin) {
                                            console.error("❌ Failed to query super_admin model toggle:", errAdmin);
                                        }

                                        let modelProvider: any;
                                        const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;
                                        let successfulModelName = 'gemini-3.5-flash';

                                        let ownerUserQueryPrompt = `User query: "${messageText}"`;
                                        if (inboundMediaType === 'image' && inboundMediaUrl && !inboundMediaUrl.startsWith('__media_id__:')) {
                                            if (!messageText || messageText.trim() === '[image]' || messageText.trim() === '') {
                                                ownerUserQueryPrompt = `The user sent a photo/image attachment without text (Permanent Public Image URL: "${inboundMediaUrl}"). If they recently discussed or drafted a campaign/ad, attach this image using 'attach_creative_to_campaign'. If they recently discussed a product/listing, attach it using 'attach_image_to_inventory'.`;
                                            } else {
                                                ownerUserQueryPrompt = `User query: "${messageText}". [Attached Image URL: "${inboundMediaUrl}". If they ask to use this as an ad creative or for a campaign (e.g. "ye creative use krlo"), call 'attach_creative_to_campaign'. If for a product/inventory, use 'attach_image_to_inventory']`;
                                            }
                                        }

                                        if (hasDeepSeekKey && selectedModel !== 'gemini') {
                                            try {
                                                console.log("🤖 Routing WhatsApp bot query to DEEPSEEK model");
                                                const deepseek = createOpenAI({
                                                    baseURL: 'https://api.deepseek.com/v1',
                                                    apiKey: process.env.DEEPSEEK_API_KEY || ''
                                                });
                                                modelProvider = deepseek.chat('deepseek-chat');

                                                const { text, usage } = await generateText({
                                                    model: modelProvider,
                                                    system: botPrompt,
                                                    prompt: ownerUserQueryPrompt,
                                                    tools: tools,
                                                    stopWhen: stepCountIs(5)
                                                });
                                                botResponseText = text;
                                                successfulModelName = 'deepseek-chat';
                                                ownerUsage = {
                                                    promptTokens: usage?.inputTokens || 0,
                                                    completionTokens: usage?.outputTokens || 0,
                                                    modelName: 'deepseek-chat'
                                                };
                                            } catch (dsErr: any) {
                                                console.warn("⚠️ DeepSeek call failed (balance/network). Falling back to Gemini:", dsErr?.message || dsErr);
                                                modelProvider = google.chat('gemini-3.5-flash');
                                                const { text, usage } = await generateText({
                                                    model: modelProvider,
                                                    system: botPrompt,
                                                    prompt: ownerUserQueryPrompt,
                                                    tools: tools,
                                                    stopWhen: stepCountIs(5)
                                                });
                                                botResponseText = text;
                                                successfulModelName = 'gemini-3.5-flash';
                                                ownerUsage = {
                                                    promptTokens: usage?.inputTokens || 0,
                                                    completionTokens: usage?.outputTokens || 0,
                                                    modelName: 'gemini-3.5-flash'
                                                };
                                            }
                                        } else {
                                            console.log("🤖 Routing WhatsApp bot query to GEMINI model");
                                            modelProvider = google.chat('gemini-3.5-flash');
                                            const { text, usage } = await generateText({
                                                model: modelProvider,
                                                system: botPrompt,
                                                prompt: ownerUserQueryPrompt,
                                                tools: tools,
                                                stopWhen: stepCountIs(5)
                                            });
                                            botResponseText = text;
                                            successfulModelName = 'gemini-3.5-flash';
                                            ownerUsage = {
                                                promptTokens: usage?.inputTokens || 0,
                                                completionTokens: usage?.outputTokens || 0,
                                                modelName: 'gemini-3.5-flash'
                                            };
                                        }
                                    } catch (llmErr: any) {
                                        console.error("❌ Agentic LLM response generation failed:", llmErr?.message || llmErr);
                                        console.error("❌ Error details:", JSON.stringify({
                                            name: llmErr?.name,
                                            status: llmErr?.status || llmErr?.statusCode,
                                            cause: llmErr?.cause?.message || llmErr?.cause,
                                            responseBody: llmErr?.responseBody || llmErr?.data,
                                            stack: llmErr?.stack?.split('\n').slice(0, 5).join('\n')
                                        }, null, 2));
                                        botResponseText = "Hi! I matched your number, but I had trouble processing the request. Please check back shortly.";
                                    }
                                    
                                    // Dynamic billing for owner query
                                    const ownerTokensCost = calculateLLMCost(ownerUsage.modelName, ownerUsage.promptTokens, ownerUsage.completionTokens);
                                    const totalOwnerCost = 0.05 + ownerTokensCost; // Rs. 0.05 infra base + LLM cost
                                    await deductCreditsByCost(supabaseAdmin, matchedProfile.id, totalOwnerCost, 'whatsapp', 'WhatsApp Owner Chat - AI Assistant Query');
                                    
                                    const recipientNumber = cleanFrom;
                                    const whatsappToken = isMessageToOfficialBot
                                        ? (process.env.DEV_WHATSAPP_ACCESS_TOKEN || matchedProfile.whatsapp_access_token || matchedProfile.facebook_token)
                                        : (matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN);
                                    const whatsappPhoneId = isMessageToOfficialBot
                                        ? (process.env.DEV_WHATSAPP_PHONE_ID || wabaPhoneId || matchedProfile.whatsapp_phone_number_id)
                                        : (wabaPhoneId || matchedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID);
                                     
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

                                    if (!assignedAgentId && ownerEnableDistribution) {
                                        try {
                                            const { data: teamData } = await supabaseAdmin
                                                .from('profiles')
                                                .select('id')
                                                .or(`agency_id.eq.${ownerUserId},parent_id.eq.${ownerUserId}`)
                                                .in('role', ['admin', 'agent'])
                                                .neq('id', ownerUserId);

                                            if (teamData && teamData.length > 0) {
                                                const agentIds = teamData.map(t => t.id);
                                                const { data: lastAssignedLead } = await supabaseAdmin
                                                    .from('leads')
                                                    .select('assigned_to')
                                                    .eq('user_id', ownerUserId)
                                                    .not('assigned_to', 'is', null)
                                                    .order('created_at', { ascending: false })
                                                    .limit(1)
                                                    .maybeSingle();

                                                const lastAgentId = lastAssignedLead?.assigned_to;
                                                const lastIndex = agentIds.indexOf(lastAgentId);
                                                const nextIndex = (lastIndex + 1) % agentIds.length;
                                                assignedAgentId = agentIds[nextIndex];
                                            }
                                        } catch (rrErr) {
                                            console.error('[WhatsApp Lead] Error evaluating round robin:', rrErr);
                                        }
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

                                    // Helper: Send 3-Button Standard Action Menu (tailored for Real Estate vs Nobogent Platform)
                                    const sendThreeButtons = async (promptText = "What would you like to do?") => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const threeButtonsList = isNobogentAccount ? [
                                                { type: 'reply', reply: { id: 'view_properties', title: 'Explore Nobogent' } },
                                                { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to Expert' } },
                                                { type: 'reply', reply: { id: 'book_appointment', title: 'Book Strategy Call' } }
                                            ] : [
                                                { type: 'reply', reply: { id: 'view_properties', title: 'View properties' } },
                                                { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to an expert' } },
                                                { type: 'reply', reply: { id: 'book_appointment', title: 'Book an appointment' } }
                                            ];

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
                                            
                                            if (!skipActionButtons) {
                                                await new Promise(r => setTimeout(r, 150));
                                                
                                                // Send 3 action buttons for easy next steps
                                                await sendThreeButtons("What would you like to do next?");
                                            }
                                        } catch (err) {
                                            console.error('[Customer AI] Failed to generate AI reply:', err);
                                            if (!skipActionButtons) {
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

                                    if (!isInstantFormLead && parsedQuestionsList.length === 0) {
                                        if (isNobogentAccount) {
                                            parsedQuestionsList.push(
                                                { index: 0, key: 'business_role', question: 'Are you a real estate broker or developer?', options: ['Broker', 'Developer', 'Channel Partner'] },
                                                { index: 1, key: 'monthly_leads', question: 'Approximately how many leads do you receive per month?', options: ['Under 50', '50–200', '200+'] },
                                                { index: 2, key: 'readiness', question: 'When would you be ready to implement Nobogent AI to scale your sales?', options: ['Immediate', 'This week', 'Next week'] }
                                            );
                                        } else {
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
                                            const title = flowCompletionConfig.title?.trim() || `🔗 ${ownerBusinessName || 'Direct Access'}`;
                                            const defaultBody = cleanedName 
                                                ? `Thank you, ${cleanedName}! 🎉 Based on your responses, here is your link to proceed:`
                                                : `Thank you! 🎉 Here is your direct access link:`;
                                            let bodyText = (flowCompletionConfig.message && flowCompletionConfig.message.trim().length > 0)
                                                ? flowCompletionConfig.message
                                                : defaultBody;
                                            if (cleanedName) {
                                                bodyText = bodyText.replace(/\{name\}/gi, cleanedName);
                                            }
                                            const buttonText = (flowCompletionConfig.button_text && flowCompletionConfig.button_text.trim().length > 0)
                                                ? flowCompletionConfig.button_text.slice(0, 20)
                                                : "Proceed Now 🚀";
                                            const linkUrl = flowCompletionConfig.url.trim();

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
                                        } else {
                                            await sendCtaUrlMessage(
                                                cleanedName ? `🎁 Tailored Catalog for ${cleanedName}` : "🏢 Your Curated Details",
                                                cleanedName ? `Thank you, ${cleanedName}! 🎉 Based on your requirements, here is your customized properties & inventory list with pricing and floor plans:` : "Here is your customized properties & inventory list with pricing and floor plans:",
                                                "View Properties 🏢",
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
                                            : `${greeting} Great to connect with you. Please let us know if you have any questions or would like to schedule a visit.`;

                                        await sendTextMessage(ackText);
                                        await new Promise(r => setTimeout(r, 150));
                                        await sendThreeButtons("What would you like to do next?");
                                        return;
                                    }

                                    // 3. Action Button 1: "View properties"
                                    const isViewProperties = buttonReplyId === 'view_properties' || /view propert|view product|explore propert|catalog|listings/i.test(messageText);
                                    if (isViewProperties) {
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} clicked "View properties".`);
                                        await syncFieldsAndScore({ view_properties_clicked: true });
                                        if (isNobogentAccount) {
                                            await sendCtaUrlMessage(
                                                "🚀 Nobogent AI Sales Platform",
                                                "Explore how Nobogent automates client acquisition, lead qualification, and 24/7 AI sales for your business:",
                                                "Explore Nobogent 🚀",
                                                catalogueLink
                                            );
                                        } else {
                                            await sendCtaUrlMessage(
                                                "🏢 Available Properties",
                                                "Explore our latest premium properties catalog with pricing, layouts, and amenities:",
                                                "View Properties 🏢",
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
                                        const specialistLabel = isNobogentAccount ? 'solutions specialist' : 'specialist';
                                        await sendTextMessage(`Thank you! Our ${specialistLabel} from ${ownerBusinessName || 'our team'} will reach out to you directly shortly. 🙏`);
                                        
                                        // Alert admin/agent via high-priority multi-channel notification
                                        const leadName = chat.recipient_name || latestLead?.name || 'Prospect';
                                        const targetLeadId = latestLead?.id;
                                        const targetUrl = targetLeadId ? `/dashboard/crm?leadId=${targetLeadId}` : '/dashboard/crm';
                                        
                                        sendAdminMultiChannelNotification({
                                            ownerUserId,
                                            title: `🚨 Call with Expert Requested!`,
                                            body: `High-intent lead ${leadName} (+${cleanFrom}) clicked "Talk to an expert" on WhatsApp! Contact them immediately.`,
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
                                                    : "Great! 🎉 To instantly send you our tailored inventory list & brochure matched to your preferences, may I know your good name please?";
                                                await sendTextMessage(namePrompt);
                                                return;
                                            } else {
                                                await sendThreeButtons("What would you like to do?");
                                                return;
                                            }
                                        }

                                        // 6. Default Fallback for New or In-Progress Leads (NON-instant form leads only):
                                        // Check if any configured question is unanswered (only if session is active and not stale)
                                        const unansweredQ = (!isInstantFormLead && !isStaleSession) ? parsedQuestionsList.find(q => !currentCustomFields[q.key]) : null;
                                        if (unansweredQ) {
                                            // If starting question 1, send encouraging lead magnet intro
                                            if (unansweredQ.index === 0 && Object.keys(currentCustomFields).filter(k => k !== 'lead_score' && k !== 'lead_tier').length === 0) {
                                                const introMsg = isNobogentAccount
                                                    ? "Hi! 👋 Please answer a few quick questions so we can share the right Nobogent AI automation solutions & live demo for your business: 🚀✨"
                                                    : "Hi! 👋 Please answer a few quick questions so we can instantly send you a curated inventory list & brochure matched to your preferences: 🎁🏢";
                                                await sendTextMessage(introMsg);
                                                await new Promise(r => setTimeout(r, 150));
                                            }
                                            await askQuestionMCQ(unansweredQ.index);
                                            return;
                                        }

                                        // If all questions are answered but name not yet asked (NON-instant form leads only, and only if qualification is not completed yet)
                                        if (!isInstantFormLead && !currentCustomFields?.qualification_completed && !currentCustomFields?.lead_name_captured && !currentCustomFields?.awaiting_lead_name) {
                                            await syncFieldsAndScore({ awaiting_lead_name: true });
                                            const namePrompt = isNobogentAccount
                                                ? "Great! 🎉 To share your personalized Nobogent platform walkthrough & access details, may I know your good name please?"
                                                : "Great! 🎉 To receive your tailored inventory list & brochure matched to your preferences, may I know your good name please?";
                                            await sendTextMessage(namePrompt);
                                            return;
                                        }

                                        // All questions answered (or Instant Form lead): if user sends a greeting, greet warmly; otherwise answer with AI + inventory!
                                        const isGreeting = /^(hi|hello|hey|namaste|good morning|good afternoon|good evening|start|menu)$/i.test(messageText.trim().toLowerCase());
                                        if (isGreeting) {
                                            const leadDisplayName = chat.recipient_name || latestLead?.name;
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

          // 2. Global Distribution Fallback
          if (!assignedAgentId && profile.enable_distribution) {
              const { data: teamData } = await supabaseAdmin
                  .from('profiles')
                  .select('id')
                  .or(`agency_id.eq.${profile.id},parent_id.eq.${profile.id}`)
                  .in('role', ['admin', 'agent'])
                  .neq('id', profile.id) // Exclude the owner
                  
              if (teamData && teamData.length > 0) {
                  const agentIds = teamData.map(t => t.id);
                  assignedAgentId = await getNextRoundRobinAgent(supabaseAdmin, agentIds);
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

          // Dispatch email notification to owner and assigned agent connected emails
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