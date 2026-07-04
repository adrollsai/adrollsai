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
                        const fromPhone = message.from; 
                        const messageText = message.text?.body || '';
                        
                        console.log(`💬 Received message from ${fromPhone}: "${messageText}"`);
                        if (!messageText) continue;
                        
                        const cleanFrom = fromPhone.replace(/\D/g, '');
                        
                        // Look up matched profile by personal notification number
                        const { data: profiles } = await supabaseAdmin
                            .from('profiles')
                            .select('id, role, business_name, whatsapp_personal_number, whatsapp_access_token, whatsapp_phone_number_id')
                            .not('whatsapp_personal_number', 'is', null);
                            
                        const matchedProfile = profiles?.find((p: any) => {
                            const cleanPersonal = p.whatsapp_personal_number.replace(/\D/g, '');
                            return cleanPersonal === cleanFrom || 
                                   (cleanPersonal.length >= 10 && cleanFrom.endsWith(cleanPersonal)) ||
                                   (cleanFrom.length >= 10 && cleanPersonal.endsWith(cleanFrom));
                        });
                        
                        if (matchedProfile) {
                            console.log(`🤖 MATCHED PROFILE: ${matchedProfile.business_name} (User: ${matchedProfile.id})`);
                            
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
                                .select('name, pipeline_stage, created_at')
                                .eq('user_id', matchedProfile.id);
                                
                            const { data: campaigns } = await supabaseAdmin
                                .from('campaign_jobs')
                                .select('status, created_at')
                                .eq('user_id', matchedProfile.id)
                                .limit(5);

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
                            leads?.forEach((l: any) => {
                                stageCounts[l.pipeline_stage] = (stageCounts[l.pipeline_stage] || 0) + 1;
                            });
                            
                            const recentLeadsText = leads
                                ?.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                                ?.slice(0, 5)
                                ?.map((l: any) => `- ${l.name} (Stage: ${l.pipeline_stage})`)
                                ?.join('\n') || 'None';
                                
                            const propertiesText = properties
                                ?.map((p: any) => `- Name: "${p.title}", Price: ${p.price || 'Not Set'}, Type: ${p.property_type || 'General'}, Status: ${p.status || 'Active'}`)
                                ?.join('\n') || 'No products in inventory';
                                
                            const campaignsText = campaigns
                                ?.map((c: any) => `- Created: ${new Date(c.created_at).toLocaleDateString()}, Status: ${c.status}`)
                                ?.join('\n') || 'No campaigns launched';
                                
                            const systemContext = `
Account Context for "${matchedProfile.business_name}" (Role: ${matchedProfile.role}):
- Business Name: ${matchedProfile.business_name}
- Total Products in Inventory: ${properties?.length || 0}
- Inventory Products:
${propertiesText}

- CRM Leads (Total: ${totalLeadsCount}):
  * Stage breakdown: ${JSON.stringify(stageCounts)}
  * Recent 5 Leads:
${recentLeadsText}

- Campaigns Launched:
${campaignsText}
${systemWideStats}
`;

                            const botPrompt = `You are "Nobogent AI Assistant", a smart personal assistant for the Nobogent CRM and ads dashboard.
You are communicating via WhatsApp with the business owner/user.

Here is the real-time data context from their account:
${systemContext}

The user's query: "${messageText}"

IMPORTANT RULES:
- Answer their query accurately using ONLY the data provided above. Do NOT invent, estimate, or hallucinate any fields (like quantity, stock count, revenue, etc.) that are not explicitly present in the context data.
- If a field is not available in the data, say "not available" instead of guessing.
- Keep formatting neat and clean for WhatsApp (use asterisks for bolding).
- Keep the response friendly but professional.
- Do NOT mention internal database names, table names, or ID strings.`;

                            let botResponseText = "Hello! I received your message, but I encountered an error while processing your request. Please try again.";
                            try {
                                const { generateKieChat } = await import('@/utils/external-apis');
                                botResponseText = await generateKieChat(botPrompt, "gemini-3.5-flash-preview");
                            } catch (llmErr: any) {
                                console.error("❌ Gemini response generation failed:", llmErr);
                                botResponseText = "Hi! I matched your number, but I had trouble fetching the Gemini AI response. Please check back shortly.";
                            }
                            
                            const recipientNumber = cleanFrom;
                            const whatsappToken = matchedProfile.whatsapp_access_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
                            const whatsappPhoneId = matchedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
                            
                            console.log(`🔐 Token resolution - DB Token exists: ${!!matchedProfile.whatsapp_access_token}, Env Token exists: ${!!process.env.DEV_WHATSAPP_ACCESS_TOKEN}`);
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
                        } else {
                            // Customer/Lead incoming message
                            console.log(`📬 Message from customer/lead: ${fromPhone}`);
                            const { data: leads } = await supabaseAdmin
                                .from('leads')
                                .select('id, user_id, name')
                                .ilike('phone', `%${cleanFrom.slice(-10)}%`);
                                
                            const matchedLead = leads?.[0];
                            if (matchedLead) {
                                let { data: chat } = await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .select('id')
                                    .eq('user_id', matchedLead.user_id)
                                    .eq('recipient_phone', cleanFrom)
                                    .maybeSingle();
                                    
                                if (!chat) {
                                    const { data: newChat } = await supabaseAdmin
                                        .from('whatsapp_chats')
                                        .insert({
                                            user_id: matchedLead.user_id,
                                            recipient_phone: cleanFrom,
                                            recipient_name: matchedLead.name,
                                            last_message_text: messageText,
                                            unread_count: 1
                                        })
                                        .select('id')
                                        .single();
                                    chat = newChat;
                                } else {
                                    await supabaseAdmin
                                        .from('whatsapp_chats')
                                        .update({
                                            last_message_text: messageText,
                                            unread_count: 1,
                                            updated_at: new Date().toISOString()
                                        })
                                        .eq('id', chat.id);
                                }
                                
                                if (chat) {
                                    await supabaseAdmin
                                        .from('whatsapp_messages')
                                        .insert({
                                            chat_id: chat.id,
                                            direction: 'inbound',
                                            message_text: messageText
                                        });
                                    
                                    try {
                                        await sendPushNotification(
                                            matchedLead.user_id,
                                            `New WhatsApp from ${matchedLead.name}`,
                                            messageText.substring(0, 100)
                                        );
                                    } catch (pushErr) {}
                                }
                            }
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
            .select('id, email, business_name, selected_page_token, pixel_id, enable_distribution')
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