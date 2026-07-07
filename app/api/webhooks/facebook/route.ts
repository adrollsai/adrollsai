import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'
import { sendCAPIEvent } from '@/utils/external-apis'
import { triggerWelcomeDrip } from '@/utils/whatsapp/drips'

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
                        const messageText = message.text?.body || '';
                        
                        console.log(`💬 Received message from ${fromPhone}: "${messageText}"`);
                        if (!messageText) continue;
                        
                        const cleanFrom = fromPhone.replace(/\D/g, '');
                        
                        // Look up matched profile by personal notification number
                        const { data: profiles } = await supabaseAdmin
                            .from('profiles')
                            .select('id, role, parent_id, agency_id, business_name, whatsapp_personal_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token, ad_account_id')
                            .not('whatsapp_personal_number', 'is', null);
                            
                        const matchedProfile = profiles?.find((p: any) => {
                            const cleanPersonal = p.whatsapp_personal_number.replace(/\D/g, '');
                            return cleanPersonal === cleanFrom || 
                                   (cleanPersonal.length >= 10 && cleanFrom.endsWith(cleanPersonal)) ||
                                   (cleanFrom.length >= 10 && cleanPersonal.endsWith(cleanFrom));
                        });
                        
                        if (matchedProfile) {
                            console.log(`🤖 MATCHED PROFILE: ${matchedProfile.business_name} (User: ${matchedProfile.id})`);
                            
                            // Process in background to immediately return 200 OK to Meta and prevent webhook timeout retries
                            (async () => {
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
                                            await supabaseAdmin
                                                .from('whatsapp_messages')
                                                .insert({
                                                    chat_id: ownerChat.id,
                                                    direction: 'inbound',
                                                    message_text: messageText
                                                });
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
                                        
                                    const { data: leads } = await supabaseAdmin
                                        .from('leads')
                                        .select('name, pipeline_stage, created_at, campaign_id')
                                        .eq('user_id', matchedProfile.id);
                                        
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

The user's query: "${messageText}"

IMPORTANT RULES:
- Always use "Dashboard Results" as the primary campaign result/lead count (this matches the Meta Ads Manager results column). Do NOT sum the metrics inside "Actions Breakdown" unless explicitly asked to provide other specific events breakdown. Use "Dashboard Results" directly for any questions about campaign results or lead counts!
- Answer their query accurately using ONLY the data provided above. Do NOT invent, estimate, or hallucinate any fields (like quantity, stock count, revenue, etc.) that are not explicitly present in the context data.
- If a field is not available in the data, say "not available" instead of guessing.
- Keep formatting neat and clean for WhatsApp (use asterisks for bolding).
- Keep the response friendly but professional.
- Do NOT mention internal database names, table names, or ID strings.
- Identify campaign conversions/results based on their Conversions/Actions metric:
  * For website lead campaigns: look for "offsite_conversion.fb_pixel_lead" or similar event value.
  * For instant form lead campaigns: look for "lead" or "results.lead" event value.
  * For click-to-WhatsApp/messaging campaigns: look for messaging actions (e.g. "onsite_conversion.messaging_first_reply", "onsite_conversion.messaging_conversation_started_7d") value.
  * If a campaign lists "None" or has no conversions under the requested type, state "0" or "None".`;

                                    let botResponseText = "Hello! I received your message, but I encountered an error while processing your request. Please try again.";
                                    try {
                                        const { generateKieChat } = await import('@/utils/external-apis');
                                        botResponseText = await generateKieChat(botPrompt, "gemini-3.5-flash-preview");
                                    } catch (llmErr: any) {
                                        console.error("❌ Gemini response generation failed:", llmErr);
                                        botResponseText = "Hi! I matched your number, but I had trouble fetching the Gemini AI response. Please check back shortly.";
                                    }
                                    
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
                            (async () => {
                                try {
                                    // 1. Resolve owning user from the WABA phone_number_id in webhook metadata
                                    const wabaPhoneId = val.metadata?.phone_number_id || '';
                                    let ownerUserId: string | null = null;
                                    let ownerWaToken: string | null = null;
                                    let ownerWaPhoneId: string | null = null;

                                    if (wabaPhoneId) {
                                        const { data: ownerProfile } = await supabaseAdmin
                                            .from('profiles')
                                            .select('id, whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name')
                                            .eq('whatsapp_phone_number_id', wabaPhoneId)
                                            .maybeSingle();
                                        if (ownerProfile) {
                                            ownerUserId = ownerProfile.id;
                                            ownerWaToken = ownerProfile.whatsapp_access_token || ownerProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || null;
                                            ownerWaPhoneId = ownerProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || null;
                                        }
                                    }

                                    // Fallback: try matching via existing leads phone
                                    if (!ownerUserId) {
                                        const { data: matchedLeads } = await supabaseAdmin
                                            .from('leads')
                                            .select('id, user_id, name')
                                            .ilike('phone', `%${cleanFrom.slice(-10)}%`)
                                            .limit(1);
                                        if (matchedLeads?.[0]) {
                                            ownerUserId = matchedLeads[0].user_id;
                                            const { data: fallbackProfile } = await supabaseAdmin
                                                .from('profiles')
                                                .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
                                                .eq('id', ownerUserId)
                                                .single();
                                            if (fallbackProfile) {
                                                ownerWaToken = fallbackProfile.whatsapp_access_token || fallbackProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || null;
                                                ownerWaPhoneId = fallbackProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || null;
                                            }
                                        }
                                    }

                                    if (!ownerUserId || !ownerWaToken || !ownerWaPhoneId) {
                                        console.log(`[Flow] Could not resolve owner for phone ${cleanFrom}. Skipping.`);
                                        return;
                                    }

                                    // 2. Find or create chat record
                                    let { data: chat } = await supabaseAdmin
                                        .from('whatsapp_chats')
                                        .select('id, recipient_name, current_flow_id, current_question_index, flow_answers, flow_completed, lead_id')
                                        .eq('user_id', ownerUserId)
                                        .eq('recipient_phone', cleanFrom)
                                        .maybeSingle();

                                    if (!chat) {
                                        const { data: newChat } = await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .insert({
                                                user_id: ownerUserId,
                                                recipient_phone: cleanFrom,
                                                recipient_name: null,
                                                last_message_text: messageText,
                                                unread_count: 1,
                                                current_flow_id: null,
                                                current_question_index: 0,
                                                flow_answers: {},
                                                flow_completed: false
                                            })
                                            .select('id, recipient_name, current_flow_id, current_question_index, flow_answers, flow_completed, lead_id')
                                            .single();
                                        chat = newChat;
                                    } else {
                                        await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .update({
                                                last_message_text: messageText,
                                                unread_count: (chat as any).flow_completed ? 1 : 0,
                                                updated_at: new Date().toISOString()
                                            })
                                            .eq('id', chat.id);
                                    }

                                    if (!chat) {
                                        console.error(`[Flow] Failed to create/find chat for ${cleanFrom}`);
                                        return;
                                    }

                                    // Log inbound message
                                    await supabaseAdmin
                                        .from('whatsapp_messages')
                                        .insert({
                                            chat_id: chat.id,
                                            direction: 'inbound',
                                            message_text: messageText
                                        });

                                    // Helper: send WhatsApp text message
                                    const sendWAMessage = async (text: string) => {
                                        try {
                                            const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`;
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
                                                    type: 'text',
                                                    text: { body: text }
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
                                        // Check if we already asked for the name by looking at outbound messages
                                        const { count: outboundCount } = await supabaseAdmin
                                            .from('whatsapp_messages')
                                            .select('id', { count: 'exact', head: true })
                                            .eq('chat_id', chat.id)
                                            .eq('direction', 'outbound');

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

                                        // Save the name
                                        await supabaseAdmin
                                            .from('whatsapp_chats')
                                            .update({ recipient_name: providedName })
                                            .eq('id', chat.id);

                                        chat.recipient_name = providedName;
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

                                        if (selectedFlow && selectedFlow.questions && selectedFlow.questions.length > 0) {
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
                                            await sendWAMessage(`Thank you, ${providedName}! 🙏\n\n${firstQ.question}`);
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
                                                    name: providedName,
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
                                                    await triggerWelcomeDrip(supabaseAdmin, newLead.id, providedName, cleanFrom, ownerUserId!, 'All');
                                                } catch (dripErr) {
                                                    console.error('[Flow] Welcome drip trigger failed:', dripErr);
                                                }
                                            }

                                            await sendWAMessage(`Thank you, ${providedName}! 🙏 We've received your message. Our team will get back to you shortly.`);

                                            try {
                                                await sendPushNotification(ownerUserId!, `New WhatsApp Lead: ${providedName}`, `Phone: ${cleanFrom}`);
                                            } catch (pushErr) {}
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

                                            await sendWAMessage(`Thank you for your responses, ${leadName}! ✅ Our team will reach out to you very soon. Feel free to ask any questions in the meantime!`);

                                            // Send push notification
                                            try {
                                                await sendPushNotification(ownerUserId!, `✅ New Qualified WhatsApp Lead: ${leadName}`, `Phone: ${cleanFrom} | Answers: ${Object.values(currentAnswers).join(', ').substring(0, 100)}`);
                                            } catch (pushErr) {}

                                            // Trigger welcome drip
                                            if (newLead) {
                                                try {
                                                    await triggerWelcomeDrip(supabaseAdmin, newLead.id, leadName, cleanFrom, ownerUserId!, 'All');
                                                } catch (dripErr) {
                                                    console.error('[Flow] Welcome drip trigger failed:', dripErr);
                                                }
                                            }
                                        }
                                        return;
                                    }

                                    // STEP C: Flow completed or no flow — normal message, just log it
                                    await supabaseAdmin
                                        .from('whatsapp_chats')
                                        .update({ unread_count: 1, updated_at: new Date().toISOString() })
                                        .eq('id', chat.id);

                                    try {
                                        await sendPushNotification(
                                            ownerUserId!,
                                            `New WhatsApp from ${chat.recipient_name || cleanFrom}`,
                                            messageText.substring(0, 100)
                                        );
                                    } catch (pushErr) {}

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
          } catch (emailErr) {
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

          // Trigger automated WhatsApp welcome drip campaign
          if (savedLead && phone) {
              triggerWelcomeDrip(
                  supabaseAdmin,
                  savedLead.id,
                  name,
                  phone,
                  profile.id,
                  adCampaignString || 'All'
              ).catch(err => {
                  console.error('[DRIP TRIGGER] Facebook lead welcome drip failed:', err);
              });
          }

          // Trigger automated Voice Dialing if enabled
          if (savedLead && phone && profile.auto_call_new_leads) {
              (async () => {
                  try {
                      // Fetch credentials
                      const { data: voiceProfile } = await supabaseAdmin
                          .from('profiles')
                          .select('elevenlabs_api_key, elevenlabs_agent_id, voice_twilio_sid, voice_twilio_token, voice_twilio_number')
                          .eq('id', profile.id)
                          .single();

                      const twilioSid = process.env.MASTER_TWILIO_SID || voiceProfile?.voice_twilio_sid || process.env.DEV_TWILIO_SID;
                      const twilioToken = process.env.MASTER_TWILIO_TOKEN || voiceProfile?.voice_twilio_token || process.env.DEV_TWILIO_TOKEN;
                      const voiceNumber = voiceProfile?.voice_twilio_number || process.env.MASTER_TWILIO_NUMBER;

                      if (twilioSid && twilioToken && voiceNumber) {
                          let cleanPhone = phone.replace(/\D/g, '');
                          if (!cleanPhone.startsWith('+')) {
                              if (cleanPhone.length === 10) {
                                  cleanPhone = '+91' + cleanPhone;
                              } else {
                                  cleanPhone = '+' + cleanPhone;
                              }
                          }

                          await supabaseAdmin
                              .from('leads')
                              .update({ voice_call_status: 'calling' })
                              .eq('id', savedLead.id);

                          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
                          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`;
                          const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');

                          const params = new URLSearchParams();
                          params.append('Url', `${appUrl}/api/voice/twiml?leadId=${savedLead.id}&profileId=${profile.id}`);
                          params.append('To', cleanPhone);
                          params.append('From', voiceNumber.trim());
                          params.append('StatusCallback', `${appUrl}/api/voice/status-callback?leadId=${savedLead.id}`);

                          const twilioRes = await fetch(twilioUrl, {
                              method: 'POST',
                              headers: {
                                  'Authorization': `Basic ${twilioAuth}`,
                                  'Content-Type': 'application/x-www-form-urlencoded'
                              },
                              body: params
                          });
                          
                          if (!twilioRes.ok) {
                              const errData = await twilioRes.json();
                              console.error('[AUTO CALL] Auto Twilio Call failed:', errData);
                              await supabaseAdmin
                                  .from('leads')
                                  .update({ voice_call_status: 'failed' })
                                  .eq('id', savedLead.id);
                          } else {
                              console.log(`[AUTO CALL] Auto Voice Call initiated successfully for lead: ${savedLead.id}`);
                          }
                      }
                  } catch (callErr: any) {
                      console.error('[AUTO CALL] Auto calling exception:', callErr);
                  }
              })();
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