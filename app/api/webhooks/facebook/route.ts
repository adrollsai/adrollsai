import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'
import { sendCAPIEvent, callGemini, callGeminiWithUsage } from '@/utils/external-apis'
import { createOpenAI } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'
import { generateText, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { triggerWelcomeDrip } from '@/utils/whatsapp/drips'
import { bookAppointment, triggerOutboundCall } from '@/utils/voice-helper'
import { deductCreditsByCost, calculateLLMCost } from '@/utils/credits'

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
                        const buttonReplyId = isInteractive ? message.interactive?.button_reply?.id : null;
                        const buttonReplyTitle = isInteractive ? message.interactive?.button_reply?.title : null;
                        
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
                            .select('id, role, parent_id, agency_id, business_name, whatsapp_personal_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token, ad_account_id, custom_domain')
                            .not('whatsapp_personal_number', 'is', null);
                            
                        const wabaPhoneId = val.metadata?.phone_number_id || '';
                        const matchedProfile = profiles?.find((p: any) => {
                            // Ensure the message was received on the phone number ID registered to this profile
                            if (p.whatsapp_phone_number_id !== wabaPhoneId) return false;
                            
                            const cleanPersonal = p.whatsapp_personal_number.replace(/\D/g, '');
                            return cleanPersonal === cleanFrom || 
                                   (cleanPersonal.length >= 10 && cleanFrom.endsWith(cleanPersonal)) ||
                                   (cleanFrom.length >= 10 && cleanPersonal.endsWith(cleanFrom));
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
                                        if (selectedModel === 'deepseek' && hasDeepSeekKey) {
                                            console.log("🤖 Routing WhatsApp bot query to DEEPSEEK model");
                                            const deepseek = createOpenAI({
                                                baseURL: 'https://api.deepseek.com/v1',
                                                apiKey: process.env.DEEPSEEK_API_KEY || ''
                                            });
                                            modelProvider = deepseek.chat('deepseek-v4-flash');
                                        } else {
                                            if (selectedModel === 'deepseek') {
                                                console.warn("⚠️ DEEPSEEK_API_KEY is missing in env. Falling back to GEMINI model.");
                                            }
                                            console.log("🤖 Routing WhatsApp bot query to GEMINI model");
                                            modelProvider = google.chat('gemini-3.5-flash');
                                        }

                                        const { text, usage } = await generateText({
                                            model: modelProvider,
                                            system: botPrompt,
                                            prompt: `User query: "${messageText}"`,
                                            tools: tools,
                                            stopWhen: stepCountIs(5)
                                        });

                                        botResponseText = text;
                                        ownerUsage = {
                                            promptTokens: usage?.inputTokens || 0,
                                            completionTokens: usage?.outputTokens || 0,
                                            modelName: (selectedModel === 'deepseek' && hasDeepSeekKey) ? 'deepseek-v4-flash' : 'gemini-3.5-flash'
                                        };
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

                                    // PRIMARY: Resolve from webhook phone_number_id (most reliable)
                                    if (wabaPhoneId) {
                                        const { data: ownerProfiles } = await supabaseAdmin
                                            .from('profiles')
                                            .select('id, whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name, role, whatsapp_catalogue_button_text, whatsapp_buttons, custom_domain, qualifying_enabled, qualifying_questions, auto_call_new_leads')
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
                                                .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, whatsapp_catalogue_button_text, whatsapp_buttons, custom_domain, qualifying_enabled, qualifying_questions, auto_call_new_leads, role')
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

                                    // 2. Find or create chat record
                                    const { data: latestLead } = await supabaseAdmin
                                        .from('leads')
                                        .select('id, name')
                                        .eq('user_id', ownerUserId)
                                        .ilike('phone', `%${cleanFrom.slice(-10)}%`)
                                        .order('created_at', { ascending: false, nullsFirst: false })
                                        .limit(1)
                                        .maybeSingle();

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

                                    await supabaseAdmin
                                        .from('whatsapp_messages')
                                        .insert(inboundInsert);

                                     // Check if this was a click on the "Connect with Expert" button
                                     const isConnectExpertClick = buttonReplyId === 'connect_expert';
                                     if (isConnectExpertClick) {
                                         console.log(`[Flow] Lead ${cleanFrom} requested to connect with an expert!`);
                                         
                                         // 1. Reply to lead on WhatsApp
                                         const leadReplyText = "Thank you! An expert will get back to you shortly. 🙏";
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
                                         
                                         // 2. Fetch business profile details to send alerts
                                         const { data: ownerProfile } = await supabaseAdmin
                                             .from('profiles')
                                             .select('id, email, business_name, whatsapp_personal_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
                                             .eq('id', ownerUserId)
                                             .single();
                                             
                                         const leadName = chat.recipient_name || latestLead?.name || 'Prospect';
                                         const leadPhone = '+' + cleanFrom;
                                         
                                         if (ownerProfile) {
                                             // A. Trigger Email Notification to Admin
                                             try {
                                                 const { sendConnectExpertNotificationEmail } = await import('@/utils/email-helper');
                                                 await sendConnectExpertNotificationEmail(
                                                     ownerProfile.email,
                                                     ownerProfile.business_name || 'Nobogent CRM Client',
                                                     leadName,
                                                     leadPhone
                                                 );
                                                 console.log(`[Flow] Expert request email sent to ${ownerProfile.email}`);
                                             } catch (emailErr: any) {
                                                 console.error('[Flow] Failed to send expert request email:', emailErr.message);
                                             }
                                             
                                             // B. Trigger Push Notification to Admin
                                             try {
                                                 await sendPushNotification(
                                                     ownerProfile.id,
                                                     '☎️ Expert Callback Requested!',
                                                     `Lead ${leadName} (${leadPhone}) has requested to connect with an expert immediately.`,
                                                     '/dashboard/crm'
                                                 );
                                                 console.log(`[Flow] Expert request push notification sent to owner ${ownerProfile.id}`);
                                             } catch (pushErr: any) {
                                                 console.error('[Flow] Failed to send expert request push:', pushErr.message);
                                             }
                                             
                                             // C. Trigger WhatsApp Template Message to Admin's Personal Number
                                             const personalPhone = ownerProfile.whatsapp_personal_number;
                                             if (personalPhone) {
                                                 let cleanPersonal = personalPhone.replace(/\D/g, '');
                                                 if (cleanPersonal.length === 10) {
                                                     cleanPersonal = '91' + cleanPersonal;
                                                 }
                                                 
                                                 const token = ownerProfile.whatsapp_access_token || ownerProfile.facebook_token || ownerWaToken;
                                                 const phoneId = ownerProfile.whatsapp_phone_number_id || ownerWaPhoneId;
                                                 
                                                 if (cleanPersonal && token && phoneId) {
                                                     try {
                                                         const adminWaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
                                                         console.log(`[Flow] Sending WhatsApp template alert to admin personal number: ${cleanPersonal}`);
                                                         const waAlertRes = await fetch(adminWaUrl, {
                                                             method: 'POST',
                                                             headers: {
                                                                 'Authorization': `Bearer ${token}`,
                                                                 'Content-Type': 'application/json'
                                                             },
                                                             body: JSON.stringify({
                                                                 messaging_product: 'whatsapp',
                                                                 recipient_type: 'individual',
                                                                 to: cleanPersonal,
                                                                 type: 'template',
                                                                 template: {
                                                                     name: 'expert_connection_notification',
                                                                     language: {
                                                                         code: 'en_US'
                                                                     },
                                                                     components: [
                                                                         {
                                                                             type: 'body',
                                                                             parameters: [
                                                                                 { type: 'text', text: leadName },
                                                                                 { type: 'text', text: leadPhone }
                                                                             ]
                                                                         }
                                                                     ]
                                                                 }
                                                             })
                                                         });
                                                         
                                                         const waAlertData = await waAlertRes.json();
                                                         if (!waAlertRes.ok) {
                                                             console.error('[Flow] Failed to send WhatsApp template alert to admin:', waAlertData);
                                                         } else {
                                                             console.log(`[Flow] WhatsApp template alert sent to admin: ${cleanPersonal}`);
                                                             
                                                             // Log the template message in the CRM WhatsApp inbox so it's visible
                                                             try {
                                                                 const templateBodyText = `🔔 Expert Connection Request!\n\nLead *${leadName}* (${leadPhone}) has requested to connect with an expert.\n\nPlease call them back as soon as possible.`;
                                                                 
                                                                 // Upsert chat for admin's personal number
                                                                 const { data: existingAdminChat } = await supabaseAdmin
                                                                     .from('whatsapp_chats')
                                                                     .select('id')
                                                                     .eq('user_id', ownerUserId)
                                                                     .eq('recipient_phone', cleanPersonal)
                                                                     .maybeSingle();
                                                                 
                                                                 let adminChatId = existingAdminChat?.id;
                                                                 
                                                                 if (!adminChatId) {
                                                                     const { data: newAdminChat } = await supabaseAdmin
                                                                         .from('whatsapp_chats')
                                                                         .insert({
                                                                             user_id: ownerUserId,
                                                                             recipient_phone: cleanPersonal,
                                                                             recipient_name: ownerProfile.business_name ? `${ownerProfile.business_name} (Admin)` : 'Admin',
                                                                             last_message_text: templateBodyText,
                                                                             updated_at: new Date().toISOString()
                                                                         })
                                                                         .select('id')
                                                                         .single();
                                                                     adminChatId = newAdminChat?.id;
                                                                 } else {
                                                                     await supabaseAdmin
                                                                         .from('whatsapp_chats')
                                                                         .update({ last_message_text: templateBodyText, updated_at: new Date().toISOString() })
                                                                         .eq('id', adminChatId);
                                                                 }
                                                                 
                                                                 if (adminChatId) {
                                                                     await supabaseAdmin
                                                                         .from('whatsapp_messages')
                                                                         .insert({
                                                                             chat_id: adminChatId,
                                                                             direction: 'outbound',
                                                                             message_text: templateBodyText
                                                                         });
                                                                 }
                                                             } catch (logErr) {
                                                                 console.error('[Flow] Failed to log admin template in CRM inbox:', logErr);
                                                             }
                                                         }
                                                     } catch (waAlertErr: any) {
                                                         console.error('[Flow] Exception sending WhatsApp alert to admin:', waAlertErr.message);
                                                     }
                                                 }
                                             }
                                         }
                                         
                                         return; // Stop processing further automation rules/flows or Gemini
                                     }

                                    // Helper: send WhatsApp interactive message with Connect with Expert button built-in
                                    const sendWAMessage = async (text: string) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                                            const catalogueLink = ownerCustomDomain 
                                                ? `https://${ownerCustomDomain}` 
                                                : `${appUrl}/shared/${ownerUserId}`;

                                            // Build buttons list for CTA links
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

                                            // Append catalogue link(s) to the body text so user can click them
                                            let bodyWithLinks = text;
                                            const linkLines = buttons.map(b => `🔗 ${b.text}: ${b.url}`).join('\n');
                                            bodyWithLinks += `\n\n${linkLines}`;

                                            // Send as interactive button type with "Connect with Expert" quick reply
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
                                                        type: 'button',
                                                        body: {
                                                            text: bodyWithLinks
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
                                             } else {
                                                const errData = await sendRes.json();
                                                console.error(`[Flow] Failed to send WA message:`, errData);
                                            }
                                        } catch (err) {
                                            console.error(`[Flow] Error sending WA message:`, err);
                                        }
                                    };

                                    // 3. FLOW STATE MACHINE
                                    const hasName = !!chat.recipient_name;
                                    const flowCompleted = chat.flow_completed || false;

                                    // Check for campaign-specific flow via referral
                                    const referral = message.referral;
                                    let campaignSourceId = referral?.source_id || null;

                                    // STEP A: Name not yet provided — ask for name
                                    if (!hasName) {
                                        // Check if we already asked for the name by looking at outbound messages (exclude templates)
                                        const { count: outboundCount } = await supabaseAdmin
                                            .from('whatsapp_messages')
                                            .select('id', { count: 'exact', head: true })
                                            .eq('chat_id', chat.id)
                                            .eq('direction', 'outbound')
                                            .not('message_text', 'like', 'Sent Template:%');

                                        if (!outboundCount || outboundCount === 0) {
                                            // First message ever — ask for name
                                            await sendWAMessage("Hi! 👋 Welcome! Before we get started, could you please share your name?");
                                            return;
                                        }

                                        // They are responding with their name
                                        const providedName = messageText.trim();
                                        if (providedName.length < 1 || providedName.length > 100) {
                                            await sendWAMessage("Please provide a valid name to continue.");
                                            return;
                                        }

                                        // Get the response through LLM (Gemini) to extract clean name
                                        let parsedName = providedName;
                                        try {
                                            const namePrompt = `
You are an expert name parser. Your job is to extract a clean, professional recipient name from a user's conversational input to a WhatsApp chatbot.

Guidelines:
1. Extract the person's name accurately.
2. If they provide a nickname alongside their real name (e.g. "Rahul, nick name is manu" or "my name is John but you can call me Johnny"), format it as: "RealName (Nickname)" (e.g., "Rahul (Manu)", "John (Johnny)").
3. Remove conversational filler (e.g., "my name is", "I am", "this is", spaces, weird characters).
4. If they give a full name, return the full name (e.g. "Rahul Chopra").
5. Return ONLY the clean extracted name string. Do not include any other text, explanation, or punctuation.

User Input: "${providedName}"
Clean Name:`;
                                            const nameRes = await callGeminiWithUsage(namePrompt);
                                            const cleanName = nameRes.text.trim();
                                            if (cleanName && cleanName.length > 0 && cleanName.length <= 100) {
                                                parsedName = cleanName;
                                            }
                                            // Dynamic billing for name parse
                                            const nameTokensCost = calculateLLMCost(nameRes.modelName, nameRes.promptTokens, nameRes.completionTokens);
                                            const totalNameCost = 0.05 + nameTokensCost;
                                            await deductCreditsByCost(supabaseAdmin, billingUserId, totalNameCost, 'whatsapp', 'WhatsApp Customer Flow - Name Parsing');
                                        } catch (geminiErr) {
                                            console.error("[Flow] Gemini name parsing failed, fallback to raw name:", geminiErr);
                                            // Fallback billing for webhook processing
                                            await deductCreditsByCost(supabaseAdmin, billingUserId, 0.05, 'whatsapp', 'WhatsApp Customer Flow - Name Parsing (Fallback)');
                                        }

                                        // Save the name
                                        await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .update({ recipient_name: parsedName })
                                            .eq('id', chat.id);

                                        chat.recipient_name = parsedName;
                                        console.log(`[Flow] Name captured: ${providedName} for chat ${chat.id}`);

                                        // Now find an active qualification flow
                                        let selectedFlow: any = null;

                                        // Try campaign-specific flow first
                                        if (campaignSourceId) {
                                            const { data: campFlow } = await supabaseAdmin
                                                .from('whatsapp_question_flows')
                                                .select('*')
                                                .eq('user_id', ownerUserId)
                                                .eq('linked_campaign_id', campaignSourceId)
                                                .eq('is_active', true)
                                                .maybeSingle();
                                            if (campFlow) selectedFlow = campFlow;
                                        }

                                        // Fallback to default active flow
                                        if (!selectedFlow) {
                                            const { data: defaultFlow } = await supabaseAdmin
                                                .from('whatsapp_question_flows')
                                                .select('*')
                                                .eq('user_id', ownerUserId)
                                                .eq('is_active', true)
                                                .is('linked_campaign_id', null)
                                                .maybeSingle();
                                            if (defaultFlow) selectedFlow = defaultFlow;
                                        }

                                        // If no default, try any active flow
                                        if (!selectedFlow) {
                                            const { data: anyFlow } = await supabaseAdmin
                                                .from('whatsapp_question_flows')
                                                .select('*')
                                                .eq('user_id', ownerUserId)
                                                .eq('is_active', true)
                                                .limit(1);
                                            if (anyFlow?.[0]) selectedFlow = anyFlow[0];
                                        }

                                        if (ownerQualifyingEnabled && ownerQualifyingQuestions && ownerQualifyingQuestions.length > 0) {
                                            // Start the profile qualification flow
                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({
                                                    qualifying_flow_active: true,
                                                    current_question_index: 0,
                                                    flow_answers: {},
                                                    flow_completed: false
                                                })
                                                .eq('id', chat.id);

                                            const firstQ = ownerQualifyingQuestions[0];
                                            await sendWAMessage(`Thank you, ${parsedName}! 🙏\n\n${firstQ}`);
                                        } else if (selectedFlow && selectedFlow.questions && selectedFlow.questions.length > 0) {
                                            // Start the flow — send first question
                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({
                                                    current_flow_id: selectedFlow.id,
                                                    current_question_index: 0,
                                                    flow_answers: {},
                                                    flow_completed: false
                                                })
                                                .eq('id', chat.id);

                                            const firstQ = selectedFlow.questions[0];
                                            await sendWAMessage(`Thank you, ${parsedName}! 🙏\n\n${firstQ.question}`);
                                        } else {
                                            // No qualification flow — just greet and create lead immediately
                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({ flow_completed: true })
                                                .eq('id', chat.id);

                                            // Create lead in CRM
                                            const { data: newLead } = await supabaseAdmin
                                                .from('leads')
                                                .insert({
                                                    user_id: ownerUserId,
                                                    name: parsedName,
                                                    phone: cleanFrom,
                                                    source: 'WhatsApp',
                                                    pipeline_stage: 'New',
                                                    campaign_id: campaignSourceId,
                                                    created_at: new Date().toISOString()
                                                 })
                                                 .select('id')
                                                 .single();

                                            if (newLead) {
                                                await supabaseAdmin
                                                    .from('whatsapp_chats')
                                                    .update({ lead_id: newLead.id })
                                                    .eq('id', chat.id);

                                                // Trigger welcome drip
                                                try {
                                                    await triggerWelcomeDrip(supabaseAdmin, newLead.id, parsedName, cleanFrom, ownerUserId!, 'All');
                                                } catch (dripErr) {
                                                     console.error('[Flow] Welcome drip trigger failed:', dripErr);
                                                }

                                                // Trigger automated Voice Dialing if enabled
                                                if (ownerAutoCallNewLeads) {
                                                    triggerOutboundCall(supabaseAdmin, newLead.id, ownerUserId!, true).catch(err => {
                                                        console.error('[AUTO CALL] Auto voice call trigger failed:', err);
                                                    });
                                                }
                                            }

                                            await sendWAMessage(`Thank you, ${parsedName}! 🙏 We've received your message. Our team will get back to you shortly.`);

                                            try {
                                                await sendPushNotification(ownerUserId!, `New WhatsApp Lead: ${parsedName}`, `Phone: ${cleanFrom}`);
                                            } catch (pushErr: any) {}
                                        }
                                        return;
                                    }

                                    // STEP B1: Profile Qualifying Questions in progress
                                    if (chat.qualifying_flow_active && !flowCompleted) {
                                        const questions = ownerQualifyingQuestions || [];
                                        const currentIdx = chat.current_question_index || 0;
                                        const currentAnswers = (chat.flow_answers || {}) as Record<string, string>;

                                        // Save the answer to the current question
                                        if (currentIdx < questions.length) {
                                            const currentQ = questions[currentIdx];
                                            currentAnswers[currentQ] = messageText.trim();
                                        }

                                        const nextIdx = currentIdx + 1;

                                        if (nextIdx < questions.length) {
                                            // More questions to ask
                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({
                                                    current_question_index: nextIdx,
                                                    flow_answers: currentAnswers
                                                })
                                                .eq('id', chat.id);

                                            const nextQ = questions[nextIdx];
                                            await sendWAMessage(nextQ);
                                        } else {
                                            // Flow complete! Create lead in CRM
                                            const leadName = chat.recipient_name || 'WhatsApp Lead';

                                            // Extract email from answers if available
                                            const emailField = Object.entries(currentAnswers).find(([key]) =>
                                                key.toLowerCase().includes('email')
                                            );

                                            const { data: newLead } = await supabaseAdmin
                                                .from('leads')
                                                .insert({
                                                    user_id: ownerUserId,
                                                    name: leadName,
                                                    phone: cleanFrom,
                                                    email: emailField?.[1] || '',
                                                    source: 'WhatsApp',
                                                    pipeline_stage: 'New',
                                                    custom_fields: currentAnswers,
                                                    campaign_id: campaignSourceId,
                                                    created_at: new Date().toISOString()
                                                })
                                                .select('id')
                                                .single();

                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({
                                                    flow_completed: true,
                                                    qualifying_flow_active: false,
                                                    flow_answers: currentAnswers,
                                                    lead_id: newLead?.id || null
                                                })
                                                .eq('id', chat.id);
                                            chat.flow_completed = true;
                                            chat.lead_id = newLead?.id || null;
                                            chat.flow_answers = currentAnswers;

                                            await sendWAMessage(`Thank you for your responses, ${leadName}! ✅ Our team will reach out to you very soon. Feel free to ask any questions in the meantime!`);

                                            // Send push notification
                                            try {
                                                await sendPushNotification(ownerUserId!, `✅ New Qualified WhatsApp Lead: ${leadName}`, `Phone: ${cleanFrom} | Answers: ${Object.values(currentAnswers).join(', ').substring(0, 100)}`);
                                            } catch (pushErr: any) {}

                                            // Trigger welcome drip
                                            if (newLead) {
                                                try {
                                                    await triggerWelcomeDrip(supabaseAdmin, newLead.id, leadName, cleanFrom, ownerUserId!, 'All');
                                                } catch (dripErr) {
                                                    console.error('[Flow] Welcome drip trigger failed:', dripErr);
                                                }

                                                if (ownerAutoCallNewLeads) {
                                                    triggerOutboundCall(supabaseAdmin, newLead.id, ownerUserId!, true).catch(err => {
                                                        console.error('[AUTO CALL] Auto voice call trigger failed:', err);
                                                    });
                                                }
                                            }
                                        }
                                        return;
                                    }

                                    // STEP B: Name provided, flow in progress
                                    if (chat.current_flow_id && !flowCompleted) {
                                        // Load the flow
                                        const { data: activeFlow } = await supabaseAdmin
                                            .from('whatsapp_question_flows')
                                            .select('*')
                                            .eq('id', chat.current_flow_id)
                                            .single();

                                        if (!activeFlow || !activeFlow.questions || activeFlow.questions.length === 0) {
                                            // Flow deleted/invalid, mark complete
                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({ flow_completed: true, current_flow_id: null })
                                                .eq('id', chat.id);
                                            await sendWAMessage("Thank you! Our team will be in touch shortly. 🙏");
                                            return;
                                        }

                                        const questions = activeFlow.questions as { question: string; field_name: string }[];
                                        const currentIdx = chat.current_question_index || 0;
                                        const currentAnswers = (chat.flow_answers || {}) as Record<string, string>;

                                        // Save the answer to the current question
                                        if (currentIdx < questions.length) {
                                            const currentQ = questions[currentIdx];
                                            currentAnswers[currentQ.field_name] = messageText.trim();
                                        }

                                        const nextIdx = currentIdx + 1;

                                        if (nextIdx < questions.length) {
                                            // More questions to ask
                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({
                                                    current_question_index: nextIdx,
                                                    flow_answers: currentAnswers
                                                })
                                                .eq('id', chat.id);

                                            const nextQ = questions[nextIdx];
                                            await sendWAMessage(nextQ.question);
                                        } else {
                                            // Flow complete! Create lead in CRM
                                            const leadName = chat.recipient_name || 'WhatsApp Lead';

                                            // Extract email from answers if available
                                            const emailField = Object.entries(currentAnswers).find(([key]) =>
                                                key.toLowerCase().includes('email')
                                            );

                                            const { data: newLead } = await supabaseAdmin
                                                .from('leads')
                                                .insert({
                                                    user_id: ownerUserId,
                                                    name: leadName,
                                                    phone: cleanFrom,
                                                    email: emailField?.[1] || '',
                                                    source: 'WhatsApp',
                                                    pipeline_stage: 'New',
                                                    custom_fields: currentAnswers,
                                                    campaign_id: campaignSourceId || activeFlow.linked_campaign_id,
                                                    created_at: new Date().toISOString()
                                                })
                                                .select('id')
                                                .single();

                                            await supabaseAdmin
                                                .from('whatsapp_chats')
                                                .update({
                                                    flow_completed: true,
                                                    flow_answers: currentAnswers,
                                                    lead_id: newLead?.id || null
                                                })
                                                .eq('id', chat.id);
                                            chat.flow_completed = true;
                                            chat.lead_id = newLead?.id || null;
                                            chat.flow_answers = currentAnswers;

                                            await sendWAMessage(`Thank you for your responses, ${leadName}! ✅ Our team will reach out to you very soon. Feel free to ask any questions in the meantime!`);

                                            // Send push notification
                                            try {
                                                await sendPushNotification(ownerUserId!, `✅ New Qualified WhatsApp Lead: ${leadName}`, `Phone: ${cleanFrom} | Answers: ${Object.values(currentAnswers).join(', ').substring(0, 100)}`);
                                            } catch (pushErr: any) {}

                                            // Trigger welcome drip
                                            if (newLead) {
                                                try {
                                                    await triggerWelcomeDrip(supabaseAdmin, newLead.id, leadName, cleanFrom, ownerUserId!, 'All');
                                                } catch (dripErr) {
                                                    console.error('[Flow] Welcome drip trigger failed:', dripErr);
                                                }

                                                if (ownerAutoCallNewLeads) {
                                                    triggerOutboundCall(supabaseAdmin, newLead.id, ownerUserId!, true).catch(err => {
                                                        console.error('[AUTO CALL] Auto voice call trigger failed:', err);
                                                    });
                                                }
                                            }
                                        }
                                        return;
                                    }

                                    // STEP C: Flow completed or no flow — AI assistant conversation
                                    console.log(`[WhatsApp AI Assistant] Processing message from customer ${cleanFrom} for owner ${ownerUserId}...`);
                                     
                                    // Run all independent context queries in parallel for speed
                                    const [profileResult, propertiesResult, historyResult, chatHistoryResult] = await Promise.all([
                                        // 1. Business profile
                                        supabaseAdmin
                                            .from('profiles')
                                            .select('business_name, business_info')
                                            .eq('id', ownerUserId)
                                            .maybeSingle(),
                                        // 2. Properties/listings
                                        supabaseAdmin
                                            .from('properties')
                                            .select('id, title, price, address, property_type, description, configurations')
                                            .eq('user_id', inventoryOwnerId),
                                        // 3. Voice call history (lead_history for matched leads)
                                        (async () => {
                                            try {
                                                const { data: matchedLeads } = await supabaseAdmin
                                                    .from('leads')
                                                    .select('id')
                                                    .eq('user_id', ownerUserId)
                                                    .ilike('phone', `%${cleanFrom.slice(-10)}%`);
                                                const matchedLeadIds = matchedLeads?.map((l: any) => l.id) || [];
                                                if (matchedLeadIds.length > 0) {
                                                    const { data: histories } = await supabaseAdmin
                                                        .from('lead_history')
                                                        .select('description, created_at')
                                                        .in('lead_id', matchedLeadIds)
                                                        .eq('action_type', 'REMARK')
                                                        .order('created_at', { ascending: true });
                                                    return histories;
                                                }
                                                return null;
                                            } catch { return null; }
                                        })(),
                                        // 4. Chat message history
                                        supabaseAdmin
                                            .from('whatsapp_messages')
                                            .select('direction, message_text')
                                            .eq('chat_id', chat.id)
                                            .order('created_at', { ascending: true })
                                            .limit(12)
                                    ]);

                                    const companyName = profileResult.data?.business_name || 'our business';
                                    const companyInfo = profileResult.data?.business_info || 'A professional business service.';

                                    let propertiesText = 'No active listings in inventory.';
                                    if (propertiesResult.data && propertiesResult.data.length > 0) {
                                        propertiesText = propertiesResult.data
                                            .map((p: any) => {
                                                return `<property>
  <id>${p.id}</id>
  <title>${p.title || 'N/A'}</title>
  <type>${p.property_type || 'N/A'}</type>
  <price>${p.price || 'N/A'}</price>
  <address>${p.address || 'N/A'}</address>
  <description>${p.description || 'N/A'}</description>
</property>`;
                                            })
                                            .join('\n');
                                    }

                                    let voiceCallHistory = 'No previous voice calls.';
                                    if (historyResult && Array.isArray(historyResult) && historyResult.length > 0) {
                                        const voiceCalls: string[] = [];
                                        historyResult.forEach((h: any) => {
                                            if (h.description && h.description.startsWith('🎙️ CALL_JSON:')) {
                                                try {
                                                    const jsonStr = h.description.substring('🎙️ CALL_JSON:'.length);
                                                    const callData = JSON.parse(jsonStr);
                                                    if (callData.transcript) {
                                                        voiceCalls.push(`[Voice Call at ${new Date(h.created_at).toLocaleString()}] Transcript:\n${callData.transcript}`);
                                                    } else if (callData.summary) {
                                                        voiceCalls.push(`[Voice Call at ${new Date(h.created_at).toLocaleString()}] Summary:\n${callData.summary}`);
                                                    }
                                                } catch (parseErr) {
                                                    // Ignore malformed json
                                                }
                                            }
                                        });
                                        if (voiceCalls.length > 0) {
                                            voiceCallHistory = voiceCalls.join('\n\n');
                                        }
                                    }

                                    let chatHistory = 'No previous messages.';
                                    if (chatHistoryResult.data && chatHistoryResult.data.length > 0) {
                                        chatHistory = chatHistoryResult.data
                                            .map((m: any) => `${m.direction === 'inbound' ? 'User' : 'Assistant'}: ${m.message_text}`)
                                            .join('\n');
                                    }

                                    // 3. Prompt Gemini to generate dynamic reply and extract appointment schedule
                                    const customerName = chat.recipient_name || 'Rahul';
                                    const aiPrompt = `
You are an AI sales and booking assistant for "${companyName}".
Here is information about our business:
${companyInfo}

Available Properties/Listings in our active inventory:
${propertiesText}

Current Date & Time: ${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}

Guidelines:
1. Speak in a natural, polite, and professional English language when responding.
2. STRICT CLOSED-WORLD GROUNDING: Answer the user's queries accurately based ONLY on the provided business profile and active properties catalog. If a user asks a question about a property, project, or developer that is not explicitly answered in the catalog provided below, set "flag_unanswered_question" to the user's raw question, and politely state in your "reply" that you don't have that detail but would love to schedule a call to get it for them. If the information IS in the catalog, set "flag_unanswered_question" to null. Do NOT make up any details or mix details from different properties (such as builder/developer names or prices).
3. If the user explicitly asks to be called right now, requests a voice call, says "call me", or asks to speak on the phone immediately, set "trigger_call" to true. Otherwise, set it to false.
4. Gently encourage the user to book a meeting or consultation slot (e.g., "Would you like me to book a quick consultation call for you?").
5. Keep all responses brief (under 50 words) and suitable for a WhatsApp text.
6. If the user explicitly proposes, confirms, or agrees to a meeting time/day (e.g., "book for tomorrow at 2 pm", "yes 5 pm works", "sure let's talk at 3 tomorrow"), extract that timestamp as an ISO-8601 string. Otherwise, set it to null.
7. The user's name is "${customerName}". Address them by name ONLY if this is the start of the conversation (i.e. first 1-2 messages in history). For subsequent replies, do NOT repeat greetings like "Hi [Name]" or "Hello [Name]" at the beginning of every message.
8. If the user explicitly asks to be called after 7 PM, suggests a late call, or says it is okay to call them at night or at any time in general, set "allow_after_hours" to true. Otherwise, default it to false.
9. If the user asks for details or information about a particular product/property in the active inventory (either explicitly by name or by referencing listings details), identify it and set the "send_product_id" in the output JSON to the exact UUID value of that property's <id>. Otherwise set it to null.

Recent WhatsApp Chat History:
${chatHistory}

Recent Voice Call History / Transcript Context:
${voiceCallHistory}

Incoming User Message: "${messageText}"

Format your output as a valid JSON object ONLY. Do not use markdown tags, ticks, or backticks:
{
  "reply": "Your message reply in English",
  "booking_time": "ISO-8601 string of agreed meeting slot or null",
  "trigger_call": true/false,
  "allow_after_hours": true/false,
  "flag_unanswered_question": "raw question text if unanswered, otherwise null",
  "send_product_id": "UUID string of requested product/property from active inventory if customer asked for details of a particular one, otherwise null"
}
`;

                                    let replyText = "Thank you! Our representative will get back to you shortly.";
                                    let extractedBookingTime: string | null = null;
                                    let triggerCallRequested = false;
                                    let extractedAllowAfterHours = false;
                                    let unansweredQuestionToFlag: string | null = null;
                                    let extractedProductId: string | null = null;

                                    let assistantUsage = { promptTokens: 0, completionTokens: 0, modelName: 'gemini-3.5-flash' };
                                    try {
                                        const aiRes = await callGeminiWithUsage(aiPrompt);
                                        const cleanJson = aiRes.text.replace(/```json/g, '').replace(/```/g, '').trim();
                                        const parsed = JSON.parse(cleanJson);
                                        replyText = parsed.reply || replyText;
                                        extractedBookingTime = parsed.booking_time || null;
                                        triggerCallRequested = !!parsed.trigger_call;
                                        extractedAllowAfterHours = !!parsed.allow_after_hours;
                                        unansweredQuestionToFlag = parsed.flag_unanswered_question || null;
                                        extractedProductId = parsed.send_product_id || null;
                                        assistantUsage = aiRes;
                                        console.log('[WhatsApp AI Assistant] Gemini parsed response:', { replyText, extractedBookingTime, triggerCallRequested, extractedAllowAfterHours, unansweredQuestionToFlag, extractedProductId });
                                        
                                        // Dynamic billing for customer AI reply
                                        const aiTokensCost = calculateLLMCost(assistantUsage.modelName, assistantUsage.promptTokens, assistantUsage.completionTokens);
                                        const totalAiCost = 0.05 + aiTokensCost;
                                        await deductCreditsByCost(supabaseAdmin, billingUserId, totalAiCost, 'whatsapp', 'WhatsApp Customer AI Assistant response');
                                    } catch (geminiErr) {
                                        console.error('[WhatsApp AI Assistant] Gemini generation/parsing failed:', geminiErr);
                                        // Fallback billing for webhook processing
                                        await deductCreditsByCost(supabaseAdmin, billingUserId, 0.05, 'whatsapp', 'WhatsApp Customer AI Assistant response (Fallback)');
                                    }

                                    // 4. Send the reply via WhatsApp
                                    await sendWAMessage(replyText);

                                    // If a specific product was requested, send the product card as a follow-up
                                    if (extractedProductId) {
                                        try {
                                            const { data: prop } = await supabaseAdmin
                                                .from('properties')
                                                .select('id, title, price, description, image_url, images')
                                                .eq('id', extractedProductId)
                                                .maybeSingle();

                                            if (prop) {
                                                const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                                                
                                                // Fetch custom domain of the inventory owner
                                                const { data: invProfile } = await supabaseAdmin
                                                    .from('profiles')
                                                    .select('custom_domain')
                                                    .eq('id', inventoryOwnerId)
                                                    .maybeSingle();

                                                const productUrl = invProfile?.custom_domain 
                                                    ? `https://${invProfile.custom_domain}?property=${prop.id}` 
                                                    : `${appUrl}/shared/${inventoryOwnerId}?property=${prop.id}`;

                                                const lines = [];
                                                if (prop.title) lines.push(`🏷️ *${prop.title}*`);
                                                if (prop.description) {
                                                    const shortDesc = prop.description.length > 500 
                                                        ? prop.description.substring(0, 500) + '...' 
                                                        : prop.description;
                                                    lines.push(`\n${shortDesc}`);
                                                }
                                                lines.push(`\n🌐 View Details & Photos: ${productUrl}`);
                                                const productText = lines.join('\n');

                                                const imageUrl = prop.image_url || (prop.images && prop.images.length > 0 ? prop.images[0] : null);

                                                // Send the follow-up message
                                                if (imageUrl && isRealPublicImageUrl(imageUrl)) {
                                                    const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
                                                    const imgRes = await fetch(metaUrl, {
                                                        method: 'POST',
                                                        headers: {
                                                            'Authorization': `Bearer ${ownerWaToken}`,
                                                            'Content-Type': 'application/json'
                                                        },
                                                        body: JSON.stringify({
                                                            messaging_product: 'whatsapp',
                                                            recipient_type: 'individual',
                                                            to: cleanFrom,
                                                            type: 'image',
                                                            image: {
                                                                link: imageUrl,
                                                                caption: productText
                                                            }
                                                        })
                                                    });
                                                    if (imgRes.ok) {
                                                        await supabaseAdmin
                                                            .from('whatsapp_messages')
                                                            .insert({
                                                                chat_id: chat.id,
                                                                direction: 'outbound',
                                                                message_text: `[Image Product Card] ${productText}`
                                                            });
                                                    } else {
                                                        // Fallback: send as text if image fails
                                                        await sendWAMessage(productText);
                                                    }
                                                } else {
                                                    await sendWAMessage(productText);
                                                }
                                            }
                                        } catch (prodErr) {
                                            console.error('[WhatsApp AI Assistant] Failed to send product follow-up:', prodErr);
                                        }
                                    }

                                    // 5. Post-reply operations: update notes, log history, push notification — fire-and-forget for speed
                                    const postReplyLeadId = chat.lead_id;
                                    const postReplyLeadName = chat.recipient_name || 'WhatsApp Lead';
                                    (async () => {
                                        try {
                                            if (postReplyLeadId) {
                                                const dateStr = new Date().toLocaleDateString();
                                                const notesAddition = `[💬 WhatsApp Message - ${dateStr}]: User: "${messageText}" | Assistant: "${replyText}"`;

                                                const waHistoryPayload = JSON.stringify({
                                                    user_msg: messageText,
                                                    bot_reply: replyText,
                                                    booking_time: extractedBookingTime || null
                                                });

                                                // Run notes update, history log, booking, call triggering, and question flagging in parallel
                                                await Promise.all([
                                                    // Update lead notes and custom_fields
                                                    (async () => {
                                                        try {
                                                            const { data: lead } = await supabaseAdmin
                                                                .from('leads')
                                                                .select('notes, custom_fields')
                                                                .eq('id', postReplyLeadId)
                                                                .single();
                                                            const newNotes = lead?.notes ? `${notesAddition}\n\n${lead.notes}` : notesAddition;
                                                            let customFieldsObj: any = {}
                                                            if (lead?.custom_fields) {
                                                                if (typeof lead.custom_fields === 'string') {
                                                                    try {
                                                                        customFieldsObj = JSON.parse(lead.custom_fields)
                                                                    } catch (e) {
                                                                        customFieldsObj = {}
                                                                    }
                                                                } else if (typeof lead.custom_fields === 'object') {
                                                                    customFieldsObj = lead.custom_fields
                                                                }
                                                            }
                                                            if (extractedAllowAfterHours) {
                                                                customFieldsObj.allow_after_hours = true;
                                                            }
                                                            await supabaseAdmin.from('leads').update({ 
                                                                notes: newNotes,
                                                                custom_fields: customFieldsObj
                                                            }).eq('id', postReplyLeadId);
                                                        } catch (e) { console.error('[WA AI] Notes update failed:', e); }
                                                    })(),
                                                    // Log to lead_history
                                                    (async () => {
                                                        try {
                                                            await supabaseAdmin.from('lead_history').insert({
                                                                lead_id: postReplyLeadId,
                                                                action_type: 'WHATSAPP_CHAT',
                                                                description: `💬 WA_JSON:${waHistoryPayload}`
                                                            });
                                                        } catch (e: any) { console.error('[WA AI] History log failed:', e); }
                                                    })(),
                                                    // Booking if extracted
                                                    extractedBookingTime ? bookAppointment(supabaseAdmin, postReplyLeadId, extractedBookingTime, ownerUserId, true).catch(e => console.error('[WA AI] Booking failed:', e)) : Promise.resolve(),
                                                    // Immediate outbound voice call if requested
                                                    triggerCallRequested ? triggerOutboundCall(supabaseAdmin, postReplyLeadId, ownerUserId).catch(e => console.error('[WA AI] Outbound call trigger failed:', e)) : Promise.resolve(),
                                                    // Flag unanswered questions
                                                    unansweredQuestionToFlag ? supabaseAdmin.from('flagged_questions').insert({
                                                        user_id: ownerUserId,
                                                        lead_id: postReplyLeadId,
                                                        channel: 'whatsapp',
                                                        question: unansweredQuestionToFlag
                                                    }) : Promise.resolve()
                                                ]);
                                            }
                                            // Push notification
                                            await sendPushNotification(ownerUserId!, `New WhatsApp from ${postReplyLeadName || cleanFrom}`, messageText.substring(0, 100)).catch(() => {});
                                        } catch (postErr) {
                                            console.error('[WA AI] Post-reply operations error:', postErr);
                                        }
                                    })();

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

          // Find the User based on the Page ID using Admin Client
          const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, selected_page_token, pixel_id, enable_distribution, auto_call_new_leads')
            .eq('selected_page_id', page_id)
            .single()

          if (profileErr || !profile) {
            console.error(`❌ No profile found for Page ID: ${page_id}. Error:`, profileErr)
            continue;
          }

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
          if (ad_id) {
            try {
                const adRes = await fetch(`https://graph.facebook.com/v19.0/${ad_id}?fields=name,campaign{id,name}&access_token=${profile.selected_page_token}`)
                const adDetails = await adRes.json()
                if (adDetails.name) {
                    campaignId = adDetails.campaign?.id || null
                    campaignName = adDetails.campaign?.name || 'Unknown Campaign'
                    adCampaignString = `${campaignName} / ${adDetails.name}`
                }
            } catch (e) {
                console.error("Could not fetch Ad metadata", e)
            }
          }

          // ASSIGNMENT LOGIC: Campaign Rule First, then Global Rule
          let assignedAgentId: string | null = null;
          
          // 1. Campaign-Specific Assignment
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
            .maybeSingle();

          if (existingLead) {
            console.log(`[Facebook Webhook] Lead ${leadgen_id} already exists in DB (by leadgen_id). Skipping.`);
            continue;
          }

          // Also check by phone number for this user to prevent duplicate people (Meta can send same person with new leadgen_id on resubmission)
          if (phone) {
            const { data: existingByPhone } = await supabaseAdmin
              .from('leads')
              .select('id')
              .eq('user_id', profile.id)
              .eq('phone', phone)
              .maybeSingle();

            if (existingByPhone) {
              console.log(`[Facebook Webhook] Lead with phone ${phone} already exists for user ${profile.id}. Skipping duplicate.`);
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
            custom_fields: customFields,
            pipeline_stage: 'New',
            ad_name: adCampaignString,
            assigned_to: assignedAgentId,
            campaign_id: campaignId,
            created_at: new Date().toISOString()
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

              if (recipientEmails.length > 0) {
                  const { sendFacebookLeadEmail } = await import('@/utils/email-helper');
                  console.log(`[Facebook Webhook] Sending lead notification emails to: ${recipientEmails.join(', ')}`);
                  await sendFacebookLeadEmail(recipientEmails, {
                      name,
                      email,
                      phone,
                      formName,
                      adName: adCampaignString,
                      customQuestions: customFields
                  });
              } else {
                  console.warn("[Facebook Webhook] No recipient emails resolved for profile ID:", profile.id);
              }
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

          // FIRE THE RICHER NOTIFICATION
          const cleanSource = adCampaignString.split(' / ')[0];
          
          await sendPushNotification(
              assignedAgentId || profile.id,
              "🔥 New Facebook Lead!",
              `${name} • ${phone} • ${cleanSource}`,
              `/dashboard/crm/${savedLead.id}` 
          )

          // Personalize welcome template campaign name based on matched property in active inventory
          let matchedPropertyTitle = '';
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
                      matchedPropertyTitle = matched.title;
                  }
              }
          } catch (propErr) {
              console.error("[Facebook Webhook] Property attribution matching failed:", propErr);
          }

          const targetCampaignName = matchedPropertyTitle || campaignName || 'our properties';

          // Trigger automated WhatsApp welcome drip campaign
          if (savedLead && phone) {
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