import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendAdminMultiChannelNotification } from '@/utils/notification-helper'
import { triggerWelcomeDrip, sendInstantFormCatalogMessage } from '@/utils/whatsapp/drips'
import { triggerOutboundCall } from '@/utils/voice-helper'
import { matchesCampaignRule } from '@/utils/campaign-matcher'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch }
  }
)

function normalizeString(str: string): string {
  return (str || '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .toLowerCase()
    .replace(/\bhaymten\b/g, 'hampton')
    .replace(/\bhamyten\b/g, 'hampton')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getNextRoundRobinAgent(supabase: any, agentIds: string[]): Promise<string | null> {
  if (!agentIds || agentIds.length === 0) return null;
  if (agentIds.length === 1) return agentIds[0];

  const { data: lastLeads } = await supabase
    .from('leads')
    .select('assigned_to, created_at')
    .in('assigned_to', agentIds)
    .order('created_at', { ascending: false })
    .limit(100);

  const agentLastAssigned: Record<string, number> = agentIds.reduce((acc: any, id: string) => { acc[id] = 0; return acc; }, {});
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
    if (time === 0) return agentId;
    if (time < oldestTime) {
      oldestTime = time;
      selectedAgent = agentId;
    }
  }
  return selectedAgent;
}

export async function GET(request: Request) {
  return handleSync(request);
}

export async function POST(request: Request) {
  return handleSync(request);
}

async function handleSync(request: Request) {
  const diagnostics: Record<string, any> = {
    timestamp: new Date().toISOString(),
    profilesProcessed: 0,
    newLeadsInserted: 0,
    reopenedLeads: 0,
    errors: []
  };

  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

    if (process.env.CRON_SECRET && cronSecret && cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch all active profiles with connected Meta Pages
    const { data: profiles, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, business_name, selected_page_id, selected_page_token, facebook_token, enable_distribution, auto_call_new_leads')
      .not('selected_page_id', 'is', null)
      .not('selected_page_token', 'is', null);

    if (profileErr || !profiles || profiles.length === 0) {
      return NextResponse.json({ success: true, message: 'No profiles with connected pages found', diagnostics });
    }

    diagnostics.profilesProcessed = profiles.length;

    // Process profiles in parallel batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      const batch = profiles.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(async (profile) => {
        const pageId = profile.selected_page_id;
        const pageToken = profile.selected_page_token;
        if (!pageId || !pageToken) return;

        try {
          // Fetch Leadgen Forms for this Page (5s timeout)
          const formsRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?access_token=${pageToken}`, {
            signal: AbortSignal.timeout(6000)
          });
          if (!formsRes.ok) return;
          const formsData = await formsRes.json();
          const formsList = formsData.data || [];
          if (formsList.length === 0) return;

          // Fetch Automations, Group Distribution Rules, and DB Campaigns for this profile
          const [{ data: groupAutomations }, { data: campAutomations }, { data: userProps }, { data: dbUserCampaigns }] = await Promise.all([
            supabaseAdmin.from('automations').select('*').eq('user_id', profile.id).like('title', 'Group-Distribution:%').eq('is_active', true),
            supabaseAdmin.from('automations').select('*').eq('user_id', profile.id).like('title', 'Campaign-Assignment:%').eq('is_active', true),
            supabaseAdmin.from('properties').select('id, title, image_url, images').eq('user_id', profile.id),
            supabaseAdmin.from('campaigns').select('id, name').eq('user_id', profile.id)
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

          // Fetch Team Members for Round Robin
          let teamAgentIds: string[] = [];
          if (profile.enable_distribution) {
            const { data: teamData } = await supabaseAdmin
              .from('profiles')
              .select('id')
              .or(`agency_id.eq.${profile.id},parent_id.eq.${profile.id}`)
              .in('role', ['admin', 'agent'])
              .neq('id', profile.id);
            if (teamData && teamData.length > 0) {
              teamAgentIds = teamData.map(t => t.id);
            }
          }

          for (const form of formsList) {
            const formId = form.id;
            const formName = form.name || 'Meta Form';

            // Fetch recent 20 leads for this form (5s timeout)
            const leadsRes = await fetch(`https://graph.facebook.com/v20.0/${formId}/leads?fields=id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name&limit=20&access_token=${pageToken}`, {
              signal: AbortSignal.timeout(6000)
            });
            if (!leadsRes.ok) continue;
            const leadsData = await leadsRes.json();
            const fbLeads = leadsData.data || [];

            for (const fbLead of fbLeads) {
              const leadgenId = fbLead.id;
              if (!leadgenId) continue;

              // Check if already in DB by facebook_lead_id
              const { data: existingByFbId } = await supabaseAdmin
                .from('leads')
                .select('id')
                .eq('facebook_lead_id', leadgenId)
                .limit(1);

              if (existingByFbId && existingByFbId.length > 0) {
                continue; // Already processed
              }

              // Extract Name, Phone, Email, Custom Fields
              let name = '', phone = '', email = '';
              const customFields: Record<string, any> = {};
              let firstName = '', lastName = '';

              fbLead.field_data?.forEach((field: any) => {
                if (!field.name || !field.values || field.values.length === 0) return;
                const fieldName = field.name.toLowerCase();
                const fieldValue = field.values[0];

                if (fieldName.includes('full_name') || fieldName.includes('fullname') || fieldName === 'name' || fieldName.includes('your_name') || fieldName.includes('your name')) name = fieldValue;
                else if (fieldName.includes('first_name') || fieldName.includes('firstname') || fieldName.includes('first name')) firstName = fieldValue;
                else if (fieldName.includes('last_name') || fieldName.includes('lastname') || fieldName.includes('last name')) lastName = fieldValue;
                else if (fieldName.includes('email') || fieldName.includes('e-mail')) email = fieldValue;
                else if (fieldName.includes('phone') || fieldName.includes('mobile') || fieldName.includes('contact') || fieldName.includes('whatsapp') || fieldName.includes('tel')) phone = fieldValue;
                else customFields[field.name] = fieldValue;
              });

              if ((!name || name === 'Unknown') && (firstName || lastName)) {
                name = `${firstName} ${lastName}`.trim();
              }
              if (!name || name === 'Unknown') {
                name = email ? email.split('@')[0] : (phone || 'Lead');
              }

              const adCampaignString = fbLead.ad_name ? `${fbLead.campaign_name || formName} / ${fbLead.ad_name}` : (fbLead.campaign_name || formName);
              const campaignName = fbLead.campaign_name || '';
              const campaignId = fbLead.campaign_id || null;

              // Attribution & Property Matching
              let matchedPropertyId: string | null = null;
              let matchedPropertyTitle = '';
              if (userProps && userProps.length > 0) {
                const searchStr = `${campaignName} ${adCampaignString} ${formName}`.toLowerCase();
                const matched = userProps.find((p: any) => p.title && searchStr.includes(p.title.toLowerCase().trim()));
                if (matched) {
                  matchedPropertyId = matched.id;
                  matchedPropertyTitle = matched.title;
                }
              }

              customFields.meta_ad_origin = {
                ad_id: fbLead.ad_id || '',
                ad_name: fbLead.ad_name || formName,
                campaign_id: campaignId || '',
                campaign_name: campaignName || formName,
                headline: matchedPropertyTitle || adCampaignString,
                body: `Submitted via form: ${formName}`,
                image_url: '',
                video_url: '',
                source_url: fbLead.ad_id ? `https://www.facebook.com/ads/library/?id=${fbLead.ad_id}` : 'https://www.facebook.com/ads/library/',
                product_name: matchedPropertyTitle || null,
                product_id: matchedPropertyId || null
              };

              // Evaluate Assignment: Group-Distribution First, then Campaign-Assignment, then Round Robin
              let assignedAgentId: string | null = null;

              // 1. Group-Distribution
              if (groupAutomations && groupAutomations.length > 0) {
                for (const aut of groupAutomations) {
                  try {
                    const parsedGroup = JSON.parse(aut.description || '{}');
                    const groupCampaigns: string[] = Array.isArray(parsedGroup.campaigns) ? parsedGroup.campaigns : [];
                    const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];

                    if (groupMembers.length > 0 && groupCampaigns.length > 0) {
                      const leadCtx = {
                        campaignId,
                        campaignName,
                        adName: fbLead.ad_name,
                        formName,
                        adCampaignString
                      };
                      const matches = groupCampaigns.some(gc => matchesCampaignRule(gc, leadCtx, campaignsMap));

                      if (matches) {
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

                        parsedGroup.last_assigned_user_id = selectedMember.userId;
                        parsedGroup.last_assigned_user_name = selectedMember.name;
                        parsedGroup.last_assigned_at = new Date().toISOString();

                        await supabaseAdmin
                          .from('automations')
                          .update({ description: JSON.stringify(parsedGroup) })
                          .eq('id', aut.id);

                        break;
                      }
                    }
                  } catch (e) {}
                }
              }

              // 2. Campaign-Assignment Rule
              if (!assignedAgentId && campAutomations && campAutomations.length > 0) {
                const ruleTitle = `Campaign-Assignment: ${adCampaignString}`;
                const ruleTitleCamp = `Campaign-Assignment: ${campaignName}`;
                const matchedAut = campAutomations.find(a => a.title === ruleTitle || a.title === ruleTitleCamp);
                if (matchedAut) {
                  try {
                    const agentIds = JSON.parse(matchedAut.description || '[]');
                    if (agentIds && agentIds.length > 0) {
                      assignedAgentId = await getNextRoundRobinAgent(supabaseAdmin, agentIds);
                    }
                  } catch (e) {}
                }
              }

              // 3. Global Round Robin
              if (!assignedAgentId && teamAgentIds.length > 0) {
                assignedAgentId = await getNextRoundRobinAgent(supabaseAdmin, teamAgentIds);
              }

              // Check Duplicate Phone Number to Reopen Existing Lead
              const cleanPhoneDigits = phone ? phone.replace(/\D/g, '').slice(-10) : '';
              if (cleanPhoneDigits && cleanPhoneDigits.length >= 7) {
                const { data: existingByPhone } = await supabaseAdmin
                  .from('leads')
                  .select('id, name, email, pipeline_stage, custom_fields, reopened_count')
                  .eq('user_id', profile.id)
                  .or(`phone.eq.${phone},phone.ilike.%${cleanPhoneDigits}`)
                  .limit(1);

                if (existingByPhone && existingByPhone.length > 0) {
                  const existingLead = existingByPhone[0];
                  let cf = existingLead.custom_fields || {};
                  if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }
                  const reopenedCount = (existingLead.reopened_count || cf.reopened_count || 0) + 1;
                  cf.reopened_count = reopenedCount;
                  cf.last_reopened_at = new Date().toISOString();

                  await supabaseAdmin
                    .from('leads')
                    .update({ custom_fields: cf, updated_at: new Date().toISOString() })
                    .eq('id', existingLead.id);

                  const reopenDesc = `The lead was reopened from Meta Ads Sync\nLead Name : ${name || existingLead.name}\nContact no : ${phone}\nSource : Facebook Ads\nDetails : ${adCampaignString || formName}`;
                  await supabaseAdmin.from('lead_history').insert({
                    lead_id: existingLead.id,
                    action_type: 'REOPENED',
                    performed_by: 'System / Meta Sync Cron',
                    actor_name: 'Meta Ads Sync',
                    description: reopenDesc,
                    created_at: new Date().toISOString()
                  });

                  diagnostics.reopenedLeads++;
                  continue;
                }
              }

              // Insert New Lead
              const { data: savedLead, error: insertErr } = await supabaseAdmin.from('leads').insert({
                user_id: profile.id,
                name,
                phone,
                email,
                source: 'Facebook Ads',
                facebook_lead_id: leadgenId,
                facebook_created_at: fbLead.created_time,
                form_id: formId,
                form_name: formName,
                custom_fields: customFields,
                pipeline_stage: 'New',
                ad_name: adCampaignString,
                assigned_to: assignedAgentId,
                campaign_id: campaignId,
                property_id: matchedPropertyId || null,
                created_at: fbLead.created_time || new Date().toISOString()
              }).select().single();

              if (insertErr || !savedLead) {
                console.error('[Meta Leads Sync] Lead insert error:', insertErr);
                continue;
              }

              diagnostics.newLeadsInserted++;
              console.log(`[Meta Leads Sync] Inserted new lead: ${name} (${phone}) for user ${profile.business_name} (Assigned: ${assignedAgentId || 'Owner'})`);

              // Notifications (non-blocking)
              const cleanSource = (adCampaignString || 'Meta Ads').split(' / ')[0];
              sendAdminMultiChannelNotification({
                ownerUserId: profile.id,
                title: "🎯 New Facebook Lead!",
                body: `Lead: ${name}\nPhone: ${phone || 'N/A'}\nSource: ${cleanSource}`,
                url: `/dashboard/crm/${savedLead.id}`,
                type: 'new_lead'
              }).catch(() => {});

              if (assignedAgentId && assignedAgentId !== profile.id) {
                sendAdminMultiChannelNotification({
                  ownerUserId: assignedAgentId,
                  title: "🎯 Lead Assigned to You!",
                  body: `Lead: ${name}\nPhone: ${phone || 'N/A'}\nSource: ${cleanSource}`,
                  url: `/dashboard/crm/${savedLead.id}`,
                  type: 'new_lead'
                }).catch(() => {});
              }

              // Automated WhatsApp Welcome Drip & Instant Catalog (non-blocking)
              if (savedLead && phone) {
                const targetCampaignName = matchedPropertyTitle || campaignName || 'our properties';
                sendInstantFormCatalogMessage(
                  supabaseAdmin,
                  savedLead.id,
                  name,
                  phone,
                  profile.id,
                  targetCampaignName
                ).catch(() => {});

                triggerWelcomeDrip(
                  supabaseAdmin,
                  savedLead.id,
                  name,
                  phone,
                  profile.id,
                  targetCampaignName
                ).catch(() => {});
              }

              // Auto-calling if enabled (non-blocking)
              if (savedLead && phone && profile.auto_call_new_leads) {
                triggerOutboundCall(supabaseAdmin, savedLead.id, profile.id, true).catch(() => {});
              }
            }
          }
        } catch (profErr: any) {
          console.error(`[Meta Leads Sync] Error for profile ${profile.id}:`, profErr);
          diagnostics.errors.push(`Profile ${profile.id}: ${profErr.message || profErr}`);
        }
      }));
    }

    return NextResponse.json({ success: true, diagnostics });
  } catch (error: any) {
    console.error('[Meta Leads Sync Cron] Fatal Error:', error);
    diagnostics.fatalError = error.message;
    return NextResponse.json({ error: error.message, diagnostics }, { status: 500 });
  }
}
