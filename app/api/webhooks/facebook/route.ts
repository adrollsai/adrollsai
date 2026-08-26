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
import { updateLeadScoreInDB, parseCustomFields } from '@/utils/lead-scoring'
import { matchesCampaignRule } from '@/utils/campaign-matcher'

export const dynamic = 'force-dynamic'

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
        console.log("🟢 WhatsApp Webhook matched whatsapp_business_account");
        for (const entry of body.entry) {
            for (const change of entry.changes) {
                if (change.field === 'messages') {
                    const val = change.value;
                    const statuses = val.statuses || [];
                    if (statuses.length > 0) {
                        for (const statusObj of statuses) {
                            console.log(`[WHATSAPP WEBHOOK STATUS] Message ID: ${statusObj.id}, Status: ${statusObj.status}, Recipient: ${statusObj.recipient_id}`);
                            if (statusObj.errors) {
                                console.error(`[WHATSAPP WEBHOOK STATUS ERROR] Message ID: ${statusObj.id}, Errors:`, JSON.stringify(statusObj.errors, null, 2));
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
                          ? message.interactive?.button_reply?.id 
                          : isButton 
                          ? (message.button?.payload || message.button?.text) 
                          : null;
                        const buttonReplyTitle = isInteractive 
                          ? message.interactive?.button_reply?.title 
                          : isButton 
                          ? (message.button?.text || message.button?.payload) 
                          : null;
                        
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

                        const messageText = buttonReplyTitle || message.text?.body || mediaCaption || (isMediaMessage ? `[${message.type}]` : '');

                        
                        console.log(`💬 Received message from ${fromPhone}: "${messageText}"${isMediaMessage ? ` [media: ${message.type}]` : ''}`);
                        if (!messageText && !isMediaMessage) continue;
                        
                        const cleanFrom = fromPhone.replace(/\D/g, '');
                        
                        // Look up matched profile by personal notification number
                        const { data: profiles } = await supabaseAdmin
                            .from('profiles')
                            .select('id, role, parent_id, agency_id, business_name, whatsapp_personal_number, whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token, ad_account_id, custom_domain')
                            .not('whatsapp_personal_number', 'is', null);
                            
                        const wabaPhoneId = val.metadata?.phone_number_id || '';
                        const matchedProfile = profiles?.find((p: any) => {
                            const cleanPersonal = p.whatsapp_personal_number ? p.whatsapp_personal_number.replace(/\D/g, '') : '';
                            if (!cleanPersonal) return false;
                            
                            const phoneMatch = cleanPersonal === cleanFrom || 
                                               (cleanPersonal.length >= 10 && cleanFrom.endsWith(cleanPersonal.slice(-10))) ||
                                               (cleanFrom.length >= 10 && cleanPersonal.endsWith(cleanFrom.slice(-10)));
                                               
                            if (!phoneMatch) return false;

                            // If WABA phone ID is available, match exact WABA phone ID
                            if (wabaPhoneId && p.whatsapp_phone_number_id) {
                                return p.whatsapp_phone_number_id === wabaPhoneId;
                            }
                            return true;
                        });
                        
                        if (matchedProfile) {
                            console.log(`🤖 MATCHED PROFILE: ${matchedProfile.business_name} (User: ${matchedProfile.id})`);
                            
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
                                            // Resolve media URL for owner messages if needed
                                            if (isMediaMessage && inboundMediaUrl?.startsWith('__media_id__:')) {
                                                const ownerToken = matchedProfile.whatsapp_access_token || matchedProfile.facebook_token;
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
                                    const botPrompt = `You are "Nobogent AI Assistant", a smart personal assistant for the Nobogent CRM and ads dashboard.
You are communicating via WhatsApp with the business owner/user.

Here is the real-time data context from their account:
${systemContext}

Recent Conversation History:
${chatHistoryText || "No previous messages."}

IMPORTANT RULES:
- WHATSAPP FORMATTING CONSTRAINTS:
  * WhatsApp does NOT support markdown tables, HTML, or code-blocks. NEVER output tables, columns, or markdown table syntax (| --- |).
  * Always format lists, metrics, or chat history logs as a clean, vertical, chronological stream.
  * For chat histories, format precisely like this:
    📅 *July 8, 2026*
    📩 *Inbound*: "User message text"
    📤 *Outbound*: "Bot message text"
  * Use bold text (*text*) and standard bullets (•) to group details. Keep everything extremely readable on a narrow phone screen.
- READ-ONLY SCOPE LIMITATION:
  * You are a read-only assistant. You CANNOT update, modify, delete, or move leads. You cannot change pipeline stages, add notes, or edit contact details.
  * NEVER suggest, offer, or ask the user if they want you to perform any write/update actions (e.g. do NOT ask if they want you to "move them to a different stage" or "update details"). 
  * Only suggest viewing or querying information that you can actually retrieve (e.g. "Would you like to view their WhatsApp chat history?").
- Always use "Dashboard Results" as the primary campaign result/lead count (this matches the Meta Ads Manager results column). Do NOT sum the metrics inside "Actions Breakdown" unless explicitly asked to provide other specific events breakdown. Use "Dashboard Results" directly for any questions about campaign results or lead counts!
- Answer their query accurately using ONLY the data provided or returned by tools. Do NOT invent, estimate, or hallucinate any fields.
- If the user asks about a lead (e.g. details, stage, what conversation happened, contacts, etc.), you MUST call the relevant tool (search_leads, get_lead_details, or get_lead_whatsapp_history) to retrieve the active, fresh data from the database.
- If they misspelled a name (e.g. "Hrsh" for "Harsh" or "Jne" for "Jane"), search the "Basic Leads Directory" or call search_leads with your best guess and fetch the correct details.
- Always output the full lead details if requested and provide the Link to Lead exactly as "https://app.nobogent.com/dashboard/crm/{id}" where {id} is the lead's UUID.
- ALWAYS use the host "app.nobogent.com" for lead links (i.e. "https://app.nobogent.com/dashboard/crm/{id}"). Do NOT use custom domains.
- Do NOT mention internal database names, table names, or ID strings (except in the Link to Lead URLs).
- Identify campaign conversions/results based on their Conversions/Actions metric:
  * For website lead campaigns: look for "offsite_conversion.fb_pixel_lead" or similar event value.
  * For instant form lead campaigns: look for "lead" or "results.lead" event value.
  * For click-to-WhatsApp/messaging campaigns: look for messaging actions (e.g. "onsite_conversion.messaging_first_reply", "onsite_conversion.messaging_conversation_started_7d") value.
  * If a campaign lists "None" or has no conversions under the requested type, state "0" or "None".`;

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
                                                    prompt: `User query: "${messageText}"`,
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
                                                    prompt: `User query: "${messageText}"`,
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
                                                prompt: `User query: "${messageText}"`,
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
                                    const whatsappToken = matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
                                    const whatsappPhoneId = matchedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
                                     
                                    console.log(`🔐 Token resolution - DB Token exists: ${!!matchedProfile.whatsapp_access_token}, FB Token exists: ${!!matchedProfile.facebook_token}, Env Token exists: ${!!process.env.DEV_WHATSAPP_ACCESS_TOKEN}`);
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
                                    let catalogueBtnText = 'View Products';
                                    let ownerCustomDomain: string | null = null;
                                    let ownerButtons: any[] = [];
                                    let ownerAutoCallNewLeads = false;
                                    let ownerRole = '';

                                    let ownerQualifyingEnabled = false;
                                    let ownerQualifyingQuestions: string[] = [];
                                    let ownerBusinessName = 'our company';
                                    let ownerEnableDistribution = false;

                                    // PRIMARY: Resolve from webhook phone_number_id (most reliable)
                                    if (wabaPhoneId) {
                                        const { data: ownerProfiles } = await supabaseAdmin
                                            .from('profiles')
                                            .select('id, whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name, role, whatsapp_catalogue_button_text, whatsapp_buttons, custom_domain, qualifying_enabled, qualifying_questions, auto_call_new_leads, enable_distribution')
                                            .eq('whatsapp_phone_number_id', wabaPhoneId);
                                        
                                        if (ownerProfiles && ownerProfiles.length > 0) {
                                            // Prefer super_admin, then admin, then first one
                                            const selectedProfile = ownerProfiles.find((p: any) => p.role === 'super_admin') ||
                                                                    ownerProfiles.find((p: any) => p.role === 'admin') ||
                                                                    ownerProfiles[0];
                                            
                                            ownerUserId = selectedProfile.id;
                                            ownerWaToken = selectedProfile.whatsapp_access_token || selectedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || null;
                                            ownerWaPhoneId = selectedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || null;
                                            catalogueBtnText = selectedProfile.whatsapp_catalogue_button_text || 'View Products';
                                            ownerCustomDomain = selectedProfile.custom_domain || null;
                                            ownerButtons = selectedProfile.whatsapp_buttons || [];
                                            ownerAutoCallNewLeads = !!selectedProfile.auto_call_new_leads;
                                            ownerRole = selectedProfile.role || '';
                                            ownerQualifyingEnabled = selectedProfile.qualifying_enabled || false;
                                            ownerQualifyingQuestions = selectedProfile.qualifying_questions || [];
                                            ownerBusinessName = selectedProfile.business_name || 'our company';
                                            ownerEnableDistribution = !!selectedProfile.enable_distribution;
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
                                                .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, whatsapp_catalogue_button_text, whatsapp_buttons, custom_domain, qualifying_enabled, qualifying_questions, auto_call_new_leads, role, business_name, enable_distribution')
                                                .eq('id', ownerUserId)
                                                .maybeSingle();
                                            if (ownerProfile) {
                                                ownerWaToken = ownerProfile.whatsapp_access_token || ownerProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || null;
                                                ownerWaPhoneId = ownerProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || null;
                                                catalogueBtnText = ownerProfile.whatsapp_catalogue_button_text || 'View Products';
                                                ownerCustomDomain = ownerProfile.custom_domain || null;
                                                ownerButtons = ownerProfile.whatsapp_buttons || [];
                                                ownerAutoCallNewLeads = !!ownerProfile.auto_call_new_leads;
                                                ownerRole = ownerProfile.role || '';
                                                ownerQualifyingEnabled = ownerProfile.qualifying_enabled || false;
                                                ownerQualifyingQuestions = ownerProfile.qualifying_questions || [];
                                                ownerBusinessName = ownerProfile.business_name || 'our company';
                                                ownerEnableDistribution = !!ownerProfile.enable_distribution;
                                            }
                                            console.log(`[Flow] Owner resolved from lead match: ${selectedLead.name} -> user ${ownerUserId}`);
                                        }
                                    }

                                    if (!ownerUserId || !ownerWaToken || !ownerWaPhoneId) {
                                        console.log(`[Flow] Could not resolve owner for phone ${cleanFrom}. Skipping.`);
                                        return;
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
                                    const adId = inboundReferral?.source_id || inboundReferral?.ad_id || '';
                                    const adHeadline = inboundReferral?.headline || '';
                                    const adBody = inboundReferral?.body || '';
                                    const adSourceUrl = inboundReferral?.source_url || '';

                                    let campaignName = '';
                                    let campaignId = '';
                                    let adNameStr = adHeadline || 'WhatsApp Ad';
                                    let adCampaignString = adNameStr;

                                    if (adId && ownerWaToken) {
                                        try {
                                            const metaToken = ownerWaToken;
                                            const adRes = await fetch(`https://graph.facebook.com/v20.0/${adId}?fields=id,name,adset{id,name},campaign{id,name}&access_token=${metaToken}`);
                                            if (adRes.ok) {
                                                const adDetails = await adRes.json();
                                                campaignId = adDetails.campaign?.id || '';
                                                campaignName = adDetails.campaign?.name || '';
                                                adNameStr = adDetails.name || adHeadline || 'WhatsApp Ad';
                                                adCampaignString = campaignName ? `${campaignName} / ${adNameStr}` : adNameStr;
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
                                                    const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];

                                                    if (groupMembers.length > 0 && groupCampaigns.length > 0) {
                                                        const leadCtx = {
                                                            campaignId: campaignId || null,
                                                            campaignName: campaignName || null,
                                                            adName: adNameStr || null,
                                                            adCampaignString: adCampaignString || null,
                                                            formName: adHeadline || null
                                                        };
                                                        const matchesCamp = groupCampaigns.some(gc => matchesCampaignRule(gc, leadCtx));

                                                        if (matchesCamp) {
                                                            const weightedPool: any[] = [];
                                                            groupMembers.forEach(m => {
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
                                        .select('id, name, custom_fields, booked_time, pipeline_stage, assigned_to, ad_name, campaign_id')
                                        .eq('user_id', ownerUserId)
                                        .ilike('phone', `%${cleanFrom.slice(-10)}%`)
                                        .order('created_at', { ascending: false, nullsFirst: false })
                                        .limit(1)
                                        .maybeSingle();

                                    const formattedPhone = cleanFrom.startsWith('+') ? cleanFrom : `+${cleanFrom}`;
                                    const defaultLeadName = (waProfileName && waProfileName.trim()) ? waProfileName.trim() : formattedPhone;

                                    if (!latestLead) {
                                        const newLeadPayload: any = {
                                            user_id: ownerUserId,
                                            name: defaultLeadName,
                                            phone: formattedPhone,
                                            source: inboundReferral ? 'Facebook Ads (WhatsApp)' : 'WhatsApp Inbound',
                                            pipeline_stage: 'New',
                                            status: 'New',
                                            ad_name: adCampaignString || null,
                                            campaign_id: campaignId || null,
                                            assigned_to: assignedAgentId || null,
                                            created_at: new Date().toISOString()
                                        };

                                        if (inboundReferral) {
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
                                        }

                                        const { data: createdLead, error: createLeadErr } = await supabaseAdmin
                                            .from('leads')
                                            .insert(newLeadPayload)
                                            .select('id, name, custom_fields, booked_time, pipeline_stage, assigned_to, ad_name, campaign_id')
                                            .single();

                                        if (createdLead) {
                                            latestLead = createdLead;
                                            console.log(`[Flow] Created new CRM lead for incoming WhatsApp contact: ${defaultLeadName} (${formattedPhone}), Assigned: ${assignedAgentId || 'Owner'}`);
                                            
                                            if (assignedAgentId && assignedAgentId !== ownerUserId) {
                                                sendAdminMultiChannelNotification({
                                                    ownerUserId: assignedAgentId,
                                                    title: "🎯 WhatsApp Lead Assigned to You!",
                                                    body: `Lead: ${defaultLeadName}\nPhone: ${formattedPhone}\nSource: ${adCampaignString || 'WhatsApp Inbound'}`,
                                                    url: `/dashboard/crm/${createdLead.id}`,
                                                    type: 'new_lead'
                                                }).catch(err => console.error('[Notification] Error notifying assigned agent:', err));
                                            }
                                        } else {
                                            console.error('[Flow] Error creating CRM lead for WhatsApp contact:', createLeadErr);
                                        }
                                    } else {
                                        // If existing lead was unassigned and we now have an assigned agent from group rules, update it
                                        if (!latestLead.assigned_to && assignedAgentId) {
                                            await supabaseAdmin
                                                .from('leads')
                                                .update({
                                                    assigned_to: assignedAgentId,
                                                    ad_name: adCampaignString || latestLead.ad_name,
                                                    campaign_id: campaignId || latestLead.campaign_id
                                                })
                                                .eq('id', latestLead.id);
                                            latestLead.assigned_to = assignedAgentId;

                                            if (assignedAgentId !== ownerUserId) {
                                                sendAdminMultiChannelNotification({
                                                    ownerUserId: assignedAgentId,
                                                    title: "🎯 WhatsApp Lead Assigned to You!",
                                                    body: `Lead: ${latestLead.name || defaultLeadName}\nPhone: ${formattedPhone}\nSource: ${adCampaignString || 'WhatsApp Inbound'}`,
                                                    url: `/dashboard/crm/${latestLead.id}`,
                                                    type: 'new_lead'
                                                }).catch(err => console.error('[Notification] Error notifying assigned agent:', err));
                                            }
                                        }
                                    }

                                    let { data: rawChat } = await supabaseAdmin
                                        .from('whatsapp_chats')
                                        .select('id, recipient_name, current_flow_id, current_question_index, flow_answers, flow_completed, lead_id, qualifying_flow_active')
                                        .eq('user_id', ownerUserId)
                                        .eq('recipient_phone', cleanFrom)
                                        .maybeSingle();
                                    let chat = rawChat as any;

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
                                                flow_answers: {},
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

                                      // Check if this was a click on "Interested" for Nobogent AI Offer campaign
                                      const isInterestedClick = buttonReplyId === 'interested_btn' || (buttonReplyTitle && buttonReplyTitle.toLowerCase().includes('interested')) || (messageText && /^interested$/i.test(messageText.trim()));
                                      if (isInterestedClick) {
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
                                          const leadReplyText = `Thank you! Our ${ownerBusinessName || 'team'} has been notified and our property expert will reach out to you directly shortly. You can also pick a convenient time slot using the link above! 🙏`;
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
                                                    await new Promise(resolve => setTimeout(resolve, 800));
                                                    
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
                                                    await new Promise(resolve => setTimeout(resolve, 800));
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
                                    const bookingLink = ownerCustomDomain 
                                        ? `https://${ownerCustomDomain}?book=1` 
                                        : `${appUrl}/shared/${ownerUserId}?book=1`;

                                    // Helper: Send 3-Button Standard Action Menu (1. View properties, 2. Talk to an expert, 3. Book an appointment)
                                    const sendThreeButtons = async (promptText = "What would you like to do?") => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const payload = {
                                                messaging_product: 'whatsapp',
                                                recipient_type: 'individual',
                                                to: cleanFrom,
                                                type: 'interactive',
                                                interactive: {
                                                    type: 'button',
                                                    body: { text: promptText },
                                                    action: {
                                                        buttons: [
                                                            { type: 'reply', reply: { id: 'view_properties', title: 'View properties' } },
                                                            { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to an expert' } },
                                                            { type: 'reply', reply: { id: 'book_appointment', title: 'Book an appointment' } }
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
                                                await supabaseAdmin.from('whatsapp_messages').insert({
                                                    chat_id: chat.id,
                                                    direction: 'outbound',
                                                    message_text: `${promptText} [Buttons: View properties | Talk to an expert | Book an appointment]`
                                                });
                                                await supabaseAdmin.from('whatsapp_chats').update({
                                                    last_message_text: promptText,
                                                    updated_at: new Date().toISOString()
                                                }).eq('id', chat.id);
                                            } else {
                                                console.error('[WhatsApp Bot] Failed to send 3-button menu:', await res.json());
                                            }
                                        } catch (err) {
                                            console.error('[WhatsApp Bot] Error sending 3-button menu:', err);
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
                                                await supabaseAdmin.from('whatsapp_messages').insert({
                                                    chat_id: chat.id,
                                                    direction: 'outbound',
                                                    message_text: `${questionText} [Options: ${buttons.map(b => b.title).join(', ')}]`
                                                });
                                                await supabaseAdmin.from('whatsapp_chats').update({
                                                    last_message_text: questionText,
                                                    updated_at: new Date().toISOString()
                                                }).eq('id', chat.id);
                                            } else {
                                                console.error('[WhatsApp Bot] Failed to send MCQ buttons:', await res.json());
                                            }
                                        } catch (err) {
                                            console.error('[WhatsApp Bot] Error sending MCQ buttons:', err);
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
                                                await supabaseAdmin.from('whatsapp_messages').insert({
                                                    chat_id: chat.id,
                                                    direction: 'outbound',
                                                    message_text: text
                                                });
                                                await supabaseAdmin.from('whatsapp_chats').update({
                                                    last_message_text: text,
                                                    updated_at: new Date().toISOString()
                                                }).eq('id', chat.id);
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
                                                    footer: { text: (ownerBusinessName || 'Property Advisory').slice(0, 60) },
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
                                                await supabaseAdmin.from('whatsapp_messages').insert({
                                                    chat_id: chat.id,
                                                    direction: 'outbound',
                                                    message_text: `${bodyText} [Button: ${buttonText} -> ${url}]`
                                                });
                                                await supabaseAdmin.from('whatsapp_chats').update({
                                                    last_message_text: bodyText,
                                                    updated_at: new Date().toISOString()
                                                }).eq('id', chat.id);
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

                                    // Helper: Sync Custom Fields and Recalculate Lead Score
                                    const syncFieldsAndScore = async (fieldsToMerge: Record<string, any>) => {
                                        currentCustomFields = { ...currentCustomFields, ...fieldsToMerge };
                                        await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .update({ flow_answers: currentCustomFields, updated_at: new Date().toISOString() })
                                            .eq('id', chat.id);
                                        
                                        if (latestLead?.id) {
                                            await supabaseAdmin
                                                .from('leads')
                                                .update({ custom_fields: currentCustomFields })
                                                .eq('id', latestLead.id);
                                            
                                            await updateLeadScoreInDB(supabaseAdmin, latestLead.id, ['property_type', 'budget', 'timeline']);
                                        }
                                    };

                                    // 1. Check for Opt-Out / Stop / Not Interested
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

                                    // 2. Action Button 1: "View properties"
                                    const isViewProperties = buttonReplyId === 'view_properties' || /view propert|view product|explore propert|catalog|listings/i.test(messageText);
                                    if (isViewProperties) {
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} clicked "View properties".`);
                                        await syncFieldsAndScore({ view_properties_clicked: true });
                                        await sendCtaUrlMessage(
                                            "🏢 Available Properties",
                                            "Explore our latest premium properties catalog with pricing, layouts, and amenities:",
                                            "View Properties 🏢",
                                            catalogueLink
                                        );
                                        await new Promise(r => setTimeout(r, 800));
                                        await sendThreeButtons("What would you like to do next?");
                                        return;
                                    }

                                    // 3. Action Button 2: "Talk to an expert"
                                    const isTalkExpert = buttonReplyId === 'talk_expert' || buttonReplyId === 'connect_expert' || /talk to an expert|talk to expert|connect with expert|speak with expert|call expert/i.test(messageText);
                                    if (isTalkExpert) {
                                        console.log(`[WhatsApp Bot] Lead ${cleanFrom} clicked "Talk to an expert".`);
                                        await syncFieldsAndScore({ connect_expert_clicked: true, requested_callback: true });
                                        
                                        // Confirm to lead
                                        await sendTextMessage(`Thank you! Our property specialist from ${ownerBusinessName || 'our team'} will reach out to you directly shortly. 🙏`);
                                        
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

                                        await new Promise(r => setTimeout(r, 600));
                                        await sendThreeButtons("What would you like to do?");
                                        return;
                                    }

                                    // 4. Action Button 3: "Book an appointment"
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
                                        await new Promise(r => setTimeout(r, 800));
                                        await sendThreeButtons("What would you like to do next?");
                                        return;
                                    }

                                    // 5. Dynamic Qualification MCQ Handlers & Parsers
                                    const leadCampaignId = campaignId || latestLead?.campaign_id || adId;
                                    if (leadCampaignId) {
                                        try {
                                            const { data: matchedFlow } = await supabaseAdmin
                                                .from('whatsapp_question_flows')
                                                .select('questions, name')
                                                .eq('user_id', ownerUserId)
                                                .eq('linked_campaign_id', leadCampaignId)
                                                .maybeSingle();

                                            if (matchedFlow && Array.isArray(matchedFlow.questions) && matchedFlow.questions.length > 0) {
                                                console.log(`[WhatsApp Bot] Using campaign-specific flow "${matchedFlow.name}" for campaign ${leadCampaignId}`);
                                                ownerQualifyingQuestions = matchedFlow.questions;
                                            }
                                        } catch (fErr) {
                                            console.warn('[WhatsApp Bot] Failed to fetch campaign question flow:', fErr);
                                        }
                                    }

                                    const parsedQuestionsList: { index: number; key: string; question: string; options: string[] }[] = [];
                                    if (Array.isArray(ownerQualifyingQuestions) && ownerQualifyingQuestions.length > 0) {
                                        ownerQualifyingQuestions.forEach((item: any, idx: number) => {
                                            if (typeof item === 'string') {
                                                const match = item.match(/\(([^)]+)\)/);
                                                const qText = item.replace(/\s*\([^)]+\)/, '').trim();
                                                const options = match ? match[1].split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                                                const key = idx === 0 ? 'property_type' : idx === 1 ? 'budget' : idx === 2 ? 'timeline' : `custom_q_${idx}`;
                                                parsedQuestionsList.push({ index: idx, key, question: qText || item, options });
                                            } else if (typeof item === 'object' && item !== null) {
                                                const qText = item.question || item.text || `Question ${idx + 1}`;
                                                const key = idx === 0 ? 'property_type' : idx === 1 ? 'budget' : idx === 2 ? 'timeline' : `custom_q_${idx}`;
                                                parsedQuestionsList.push({
                                                    index: idx,
                                                    key,
                                                    question: qText,
                                                    options: Array.isArray(item.options) ? item.options : []
                                                });
                                            }
                                        });
                                    }

                                    if (parsedQuestionsList.length === 0) {
                                        parsedQuestionsList.push(
                                            { index: 0, key: 'property_type', question: 'What type of property are you interested in?', options: ['Residential', 'Commercial', 'Plots / Land'] },
                                            { index: 1, key: 'budget', question: 'What is your budget range?', options: ['Under ₹50 Lacs', '₹50L - ₹1.5 Cr', 'Above ₹1.5 Cr'] },
                                            { index: 2, key: 'timeline', question: 'What is your timeline to purchase?', options: ['Immediate (<1 Mo)', '1 - 3 Months', 'Exploring'] }
                                        );
                                    }

                                        const askQuestionMCQ = async (qIndex: number) => {
                                            const qObj = parsedQuestionsList[qIndex];
                                            if (!qObj) return;
                                            const rawOptions = qObj.options.length > 0 ? qObj.options.slice(0, 3) : ['Option 1', 'Option 2', 'Option 3'];
                                            const buttons = rawOptions.map((opt, optIdx) => ({
                                                id: `q_opt_${qIndex}_${optIdx}`,
                                                title: opt.slice(0, 20)
                                            }));
                                            await sendMCQButtons(qObj.question, buttons);
                                        };

                                        // Check if we are waiting for the lead's name after qualification questions
                                        if (currentCustomFields?.awaiting_lead_name && messageText && messageText.trim().length > 1 && !buttonReplyId) {
                                            const cleanedName = messageText.trim()
                                                .replace(/^(my name is|i am|this is|name:)\s*/i, '')
                                                .split('\n')[0]
                                                .slice(0, 50);

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

                                            // Send tailored lead magnet catalog link
                                            await sendCtaUrlMessage(
                                                `🎁 Tailored Catalog for ${cleanedName}`,
                                                `Thank you, ${cleanedName}! 🎉 Based on your requirements, here is your customized properties & inventory list with pricing and floor plans:`,
                                                "View Properties 🏢",
                                                catalogueLink
                                            );
                                            await new Promise(r => setTimeout(r, 800));
                                            await sendThreeButtons("What would you like to do next?");
                                            return;
                                        }

                                        // Dynamic MCQ button clicks (q_opt_{qIndex}_{optIndex})
                                        if (buttonReplyId?.startsWith('q_opt_')) {
                                            const parts = buttonReplyId.split('_');
                                            const qIdx = parseInt(parts[2], 10);
                                            const optIdx = parseInt(parts[3], 10);
                                            const qObj = parsedQuestionsList[qIdx];
                                            if (qObj) {
                                                const selectedValue = qObj.options[optIdx] || messageText.trim();
                                                console.log(`[WhatsApp Bot] Lead ${cleanFrom} answered Q#${qIdx + 1} (${qObj.key}): ${selectedValue}`);
                                                const updateObj: Record<string, any> = { [qObj.key]: selectedValue };
                                                if (qObj.key === 'property_type') updateObj.interested_property = selectedValue;
                                                await syncFieldsAndScore(updateObj);

                                                const nextIdx = qIdx + 1;
                                                if (nextIdx < parsedQuestionsList.length) {
                                                    await askQuestionMCQ(nextIdx);
                                                    return;
                                                } else {
                                                    // All qualification questions answered -> Ask for lead name to complete tailored catalog
                                                    if (!currentCustomFields?.lead_name_captured) {
                                                        await syncFieldsAndScore({ awaiting_lead_name: true });
                                                        await sendTextMessage("Great! 🎉 To instantly receive your tailored inventory list & brochure matched to your preferences, may I know your good name please?");
                                                        return;
                                                    } else {
                                                        await syncFieldsAndScore({ qualification_completed: true });
                                                        await sendCtaUrlMessage(
                                                            "🏢 Your Curated Properties",
                                                            "Thank you! 🎉 Here is your customized property catalog based on your requirements:",
                                                            "View Properties 🏢",
                                                            catalogueLink
                                                        );
                                                        await new Promise(r => setTimeout(r, 800));
                                                        await sendThreeButtons("What would you like to do next?");
                                                        return;
                                                    }
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
                                                await sendTextMessage("Great! 🎉 To instantly send you our tailored inventory list & brochure matched to your preferences, may I know your good name please?");
                                                return;
                                            } else {
                                                await sendThreeButtons("What would you like to do?");
                                                return;
                                            }
                                        }

                                        // 6. Default Fallback for New or In-Progress Leads:
                                        // Check if any configured question is unanswered
                                        const unansweredQ = parsedQuestionsList.find(q => !currentCustomFields[q.key]);
                                        if (unansweredQ) {
                                            // If starting question 1, send encouraging lead magnet intro
                                            if (unansweredQ.index === 0 && Object.keys(currentCustomFields).filter(k => k !== 'lead_score' && k !== 'lead_tier').length === 0) {
                                                await sendTextMessage("Hi! 👋 Please answer a few quick questions so we can instantly send you a curated inventory list & brochure matched to your preferences: 🎁🏢");
                                                await new Promise(r => setTimeout(r, 600));
                                            }
                                            await askQuestionMCQ(unansweredQ.index);
                                            return;
                                        }

                                        // If all questions are answered but name not yet asked
                                        if (!currentCustomFields?.lead_name_captured && !currentCustomFields?.awaiting_lead_name) {
                                            await syncFieldsAndScore({ awaiting_lead_name: true });
                                            await sendTextMessage("Great! 🎉 To receive your tailored inventory list & brochure matched to your preferences, may I know your good name please?");
                                            return;
                                        }

                                        // All questions answered: respond strictly with "What would you like to do?" and the 3 buttons
                                        await sendThreeButtons("What would you like to do?");
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

          // Find the User based on the Page ID using Admin Client
          const { data: profiles, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, selected_page_token, facebook_token, pixel_id, enable_distribution, auto_call_new_leads, role')
            .eq('selected_page_id', page_id);

          if (profileErr || !profiles || profiles.length === 0) {
            console.error(`❌ No profile found for Page ID: ${page_id}. Error:`, profileErr);
            continue;
          }

          const profile = profiles.find((p: any) => p.selected_page_token && ['admin', 'agency', 'super_admin'].includes(p.role)) ||
                          profiles.find((p: any) => p.selected_page_token) ||
                          profiles[0];

          if (!profile.selected_page_token) {
            console.error(`❌ Profile found but NO Page Token for Page ID: ${page_id}`)
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
            const fbUrl = `https://graph.facebook.com/v19.0/${leadgen_id}?fields=id,created_time,field_data,form_id&access_token=${profile.selected_page_token}`
            const fbResponse = await fetch(fbUrl)
            fbLead = await fbResponse.json()
          }
          
          if (fbLead.error) {
            console.error(`❌ Meta Lead Fetch Failed:`, fbLead.error)
            continue;
          }

          let name = 'Unknown', phone = '', email = ''
          const customFields: Record<string, any> = {}
          let firstName = '', lastName = ''
          fbLead.field_data?.forEach((field: any) => {
            if (!field.name || !field.values || field.values.length === 0) return;
            
            const fieldName = field.name.toLowerCase()
            const fieldValue = field.values[0]

            if (fieldName.includes('full_name') || fieldName.includes('fullname') || fieldName === 'name' || fieldName.includes('your_name') || fieldName.includes('your name')) name = fieldValue
            else if (fieldName.includes('first_name') || fieldName.includes('firstname') || fieldName.includes('first name')) firstName = fieldValue
            else if (fieldName.includes('last_name') || fieldName.includes('lastname') || fieldName.includes('last name')) lastName = fieldValue
            else if (fieldName.includes('email') || fieldName.includes('e-mail')) email = fieldValue
            else if (fieldName.includes('phone') || fieldName.includes('mobile') || fieldName.includes('contact') || fieldName.includes('whatsapp') || fieldName.includes('tel')) phone = fieldValue
            else {
              customFields[field.name] = fieldValue
            }
          })

          if ((!name || name === 'Unknown') && (firstName || lastName)) {
            name = `${firstName} ${lastName}`.trim()
          }

          if (!name || name === 'Unknown') {
            if (email) {
              name = email.split('@')[0]
            } else if (phone) {
              name = phone
            } else {
              name = 'Lead'
            }
          }

          // Fetch Form Name
          let formName = 'Facebook Lead Form'
          if (fbLead.form_id) {
            try {
              const formRes = await fetch(`https://graph.facebook.com/v19.0/${fbLead.form_id}?fields=name&access_token=${profile.selected_page_token}`)
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

          if (ad_id) {
            try {
                const metaToken = profile.facebook_token || profile.selected_page_token || process.env.META_SYSTEM_USER_TOKEN || '';
                const adRes = await fetch(`https://graph.facebook.com/v20.0/${ad_id}?fields=id,name,adset{id,name},campaign{id,name},creative{id,name,image_url,thumbnail_url,object_story_spec,asset_feed_spec}&access_token=${metaToken}`)
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
                        ad_id: ad_id,
                        ad_name: adNameStr,
                        adset_id: adDetails.adset?.id || '',
                        adset_name: adDetails.adset?.name || '',
                        campaign_id: campaignId || '',
                        campaign_name: campaignName,
                        headline: headlineText,
                        body: bodyText,
                        image_url: creativeImg,
                        video_url: videoMp4Url || '',
                        source_id: ad_id,
                        source_url: `https://www.facebook.com/ads/library/?id=${ad_id}`
                    };
                }
            } catch (e) {
                console.error("Could not fetch Ad metadata", e)
            }
          }

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
              ad_id: ad_id || '',
              ad_name: adCampaignString.includes(' / ') ? adCampaignString.split(' / ')[1] : adCampaignString,
              campaign_name: campaignName || (adCampaignString.includes(' / ') ? adCampaignString.split(' / ')[0] : formName),
              headline: matchedPropertyTitle || adCampaignString,
              body: formName ? `Submitted via form: ${formName}` : '',
              image_url: fallbackImg,
              video_url: '',
              source_url: ad_id ? `https://www.facebook.com/ads/library/?id=${ad_id}` : 'https://www.facebook.com/ads/library/',
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
            const [{ data: groupAutomations }, { data: dbUserCampaigns }] = await Promise.all([
              supabaseAdmin
                .from('automations')
                .select('*')
                .eq('user_id', profile.id)
                .like('title', 'Group-Distribution:%')
                .eq('is_active', true),
              supabaseAdmin
                .from('campaigns')
                .select('id, name')
                .eq('user_id', profile.id)
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
              adName: fbLead.ad_name,
              formName,
              adCampaignString
            };

            if (groupAutomations && groupAutomations.length > 0) {
              for (const aut of groupAutomations) {
                try {
                  const parsedGroup = JSON.parse(aut.description || '{}');
                  const groupCampaigns: string[] = Array.isArray(parsedGroup.campaigns) ? parsedGroup.campaigns : [];
                  const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];
                  if (groupMembers.length > 0 && groupCampaigns.length > 0) {
                    const matchesCamp = groupCampaigns.some(gc => matchesCampaignRule(gc, leadCtx, campaignsMap));

                    if (matchesCamp) {
                      // Build weighted sequence pool
                      const weightedPool: any[] = [];
                      groupMembers.forEach(m => {
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

          // Also check by phone number (both raw and normalized last 10 digits) to prevent duplicate leads
          const cleanPhoneDigits = phone ? phone.replace(/\D/g, '').slice(-10) : '';
          if (cleanPhoneDigits && cleanPhoneDigits.length >= 7) {
            const { data: existingByPhone } = await supabaseAdmin
              .from('leads')
              .select('*')
              .eq('user_id', profile.id)
              .or(`phone.eq.${phone},phone.ilike.%${cleanPhoneDigits}`)
              .limit(1);

            if (existingByPhone && existingByPhone.length > 0) {
              const existingLead = existingByPhone[0];
              let cf = existingLead.custom_fields || {};
              if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }

              // Always count as reopened — every repeat submission increments the count
              const currentSourceId = (adCampaignString || formName || campaignId || 'Meta Ad').trim();
              const reopenedCount = (cf.reopened_count || 0) + 1;

              // Track sources for audit (append even if same source)
              const previousSources: string[] = Array.isArray(cf.reopened_sources) ? cf.reopened_sources : [];
              const updatedSources = [...previousSources, currentSourceId];

              cf = {
                ...cf,
                reopened_count: reopenedCount,
                reopened_sources: updatedSources,
                last_reopened_at: new Date().toISOString(),
                last_reopened_source: currentSourceId
              };

              await supabaseAdmin
                .from('leads')
                .update({ custom_fields: cf })
                .eq('id', existingLead.id);

              const reopenDesc = `The lead was reopened from Facebook\nLead Name : ${name || existingLead.name}\nContact no : ${phone}\nEmail : ${email || existingLead.email || 'N/A'}\nLead Source : Facebook\nSource Details : ${currentSourceId}\nReopen Count : ${reopenedCount}\nLead Status : ${existingLead.pipeline_stage || 'New'}`;

              await supabaseAdmin.from('lead_history').insert({
                lead_id: existingLead.id,
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

          // Trigger automated Voice Dialing if enabled
          if (savedLead && phone && profile.auto_call_new_leads) {
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