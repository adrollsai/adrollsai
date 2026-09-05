import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendAdminMultiChannelNotification } from '@/utils/notification-helper'
import { triggerWelcomeDrip, sendInstantFormCatalogMessage } from '@/utils/whatsapp/drips'
import { triggerOutboundCall } from '@/utils/voice-helper'
import { matchesCampaignRule } from '@/utils/campaign-matcher'
import { ensureMetaPageSubscribed } from '@/utils/meta-subscription'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch }
  }
)

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
    formsScanned: 0,
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
      .select('id, email, business_name, selected_page_id, selected_page_token, facebook_token, ad_account_id, enable_distribution, auto_call_new_leads, agency_id, parent_id')
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
        // Strictly sync ONLY the page explicitly connected to this profile
        const pagesMap = new Map<string, string>();
        if (profile.selected_page_id && (profile.selected_page_token || profile.facebook_token)) {
          pagesMap.set(profile.selected_page_id, profile.selected_page_token || profile.facebook_token);
        }

        if (pagesMap.size === 0) return;

        // Auto-heal page webhook subscription on Meta with token refresh
        await ensureMetaPageSubscribed(supabaseAdmin, profile).catch(() => {});

        try {
          // 1. Fetch Leadgen Forms across ALL user pages with full pagination
          const formsList: any[] = [];
          for (const [pId, pToken] of pagesMap.entries()) {
            let formsUrl: string | null = `https://graph.facebook.com/v20.0/${pId}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${pToken}`;
            while (formsUrl && formsList.length < 500) {
              try {
                const formsRes: any = await fetch(formsUrl, { signal: AbortSignal.timeout(8000) });
                if (!formsRes.ok) break;
                const formsData: any = await formsRes.json();
                if (formsData.data && formsData.data.length > 0) {
                  formsList.push(...formsData.data.map((f: any) => ({ ...f, _pageToken: pToken })));
                }
                formsUrl = formsData.paging?.next || null;
              } catch (e) {
                break;
              }
            }
          }

          diagnostics.formsScanned += formsList.length;

          // 2. Fetch Automations, Group Distribution Rules, and DB Campaigns for this profile
          const targetOwnerIds = [profile.id, profile.agency_id, profile.parent_id].filter(Boolean);
          const [{ data: groupAutomations }, { data: campAutomations }, { data: userProps }, { data: dbUserCampaigns }] = await Promise.all([
            supabaseAdmin.from('automations').select('*').in('user_id', targetOwnerIds).like('title', 'Group-Distribution:%').eq('is_active', true),
            supabaseAdmin.from('automations').select('*').in('user_id', targetOwnerIds).like('title', 'Campaign-Assignment:%').eq('is_active', true),
            supabaseAdmin.from('properties').select('id, title, image_url, images').in('user_id', targetOwnerIds),
            supabaseAdmin.from('campaigns').select('id, name').in('user_id', targetOwnerIds)
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

          // 3. Fetch Team Members for Round Robin
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

          // 4. Also collect any active ads directly from Ad Account if available
          const activeAdForms = new Set<string>();
          if (profile.ad_account_id && profile.facebook_token) {
            try {
              const adRes = await fetch(`https://graph.facebook.com/v20.0/${profile.ad_account_id}/ads?fields=id,name,status,effective_status,campaign_id,campaign{id,name}&effective_status=['ACTIVE']&limit=50&access_token=${profile.facebook_token}`, {
                signal: AbortSignal.timeout(6000)
              });
              if (adRes.ok) {
                const adData = await adRes.json();
                if (adData.data) {
                  // Direct fetch for leads from active ads
                  for (const ad of adData.data) {
                    try {
                      const adLeadsRes = await fetch(`https://graph.facebook.com/v20.0/${ad.id}/leads?fields=id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name&limit=25&access_token=${profile.facebook_token}`, {
                        signal: AbortSignal.timeout(6000)
                      });
                      if (adLeadsRes.ok) {
                        const adLeadsData = await adLeadsRes.json();
                        if (adLeadsData.data && adLeadsData.data.length > 0) {
                          await processFbLeadsBatch(adLeadsData.data, ad.name, ad.campaign?.name || '', ad.campaign_id || ad.campaign?.id || null);
                        }
                      }
                    } catch (e) {}
                  }
                }
              }
            } catch (adErr) {}
          }

          // 5. Helper to process any batch of Meta leads
          async function processFbLeadsBatch(fbLeads: any[], fallbackFormOrAdName: string, fallbackCampName = '', fallbackCampId: string | null = null, formIdParam?: string) {
            if (!fbLeads || fbLeads.length === 0) return;

            // Batch check which leads already exist in DB by facebook_lead_id
            const leadIds = fbLeads.map((l: any) => l.id).filter(Boolean);
            const { data: existingRecords } = await supabaseAdmin
              .from('leads')
              .select('facebook_lead_id')
              .in('facebook_lead_id', leadIds);
            const existingLeadIdSet = new Set(existingRecords?.map((r: any) => r.facebook_lead_id) || []);

            for (const fbLead of fbLeads) {
              const leadgenId = fbLead.id;
              if (!leadgenId) continue;

              // Check if already in DB by facebook_lead_id
              if (existingLeadIdSet.has(leadgenId)) {
                continue; // Already processed
              }

              // Extract Name, Phone, Email, Custom Fields
              let name = '', phone = '', email = '', city = '';
              const customFields: Record<string, any> = {};
              let firstName = '', lastName = '';

              fbLead.field_data?.forEach((field: any) => {
                if (!field.name || !field.values || field.values.length === 0) return;
                const fieldName = field.name.toLowerCase().trim();
                const fieldValue = (typeof field.values[0] === 'string' ? field.values[0] : String(field.values[0] || '')).trim();
                if (!fieldValue) return;

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
                  name = fieldValue;
                } else if (
                  fieldName.includes('first_name') || 
                  fieldName.includes('firstname') || 
                  fieldName.includes('first name') || 
                  fieldName === 'fname'
                ) {
                  firstName = fieldValue;
                } else if (
                  fieldName.includes('last_name') || 
                  fieldName.includes('lastname') || 
                  fieldName.includes('last name') || 
                  fieldName === 'lname'
                ) {
                  lastName = fieldValue;
                } else if (fieldName.includes('email') || fieldName.includes('e-mail')) {
                  email = fieldValue;
                } else if (
                  fieldName.includes('phone') || 
                  fieldName.includes('mobile') || 
                  fieldName.includes('contact') || 
                  fieldName.includes('whatsapp') || 
                  fieldName.includes('tel')
                ) {
                  phone = fieldValue;
                } else if (fieldName === 'city') {
                  city = fieldValue;
                } else {
                  customFields[field.name] = fieldValue;
                }
              });

              if ((!name || name.toLowerCase() === 'unknown' || name.toLowerCase() === 'lead') && (firstName || lastName)) {
                name = `${firstName} ${lastName}`.trim();
              }

              // Check customFields for first_name / full_name
              if (!name || name.toLowerCase() === 'unknown' || name.toLowerCase() === 'lead') {
                const cfFirst = customFields['first_name'] || customFields['firstName'] || customFields['First Name'] || '';
                const cfLast = customFields['last_name'] || customFields['lastName'] || customFields['Last Name'] || '';
                const cfFull = customFields['full_name'] || customFields['fullName'] || customFields['Full Name'] || customFields['name'] || customFields['Name'] || '';
                if (cfFull) {
                  name = cfFull.trim();
                } else if (cfFirst || cfLast) {
                  name = `${cfFirst} ${cfLast}`.trim();
                }
              }

              if (!name || name.toLowerCase() === 'unknown' || name.toLowerCase() === 'lead') {
                if (email) {
                  const emailUser = email.split('@')[0].replace(/[._-]/g, ' ');
                  name = emailUser.charAt(0).toUpperCase() + emailUser.slice(1);
                } else if (phone) {
                  name = `Lead (${phone})`;
                } else {
                  name = `Meta Lead #${leadgenId.slice(-4)}`;
                }
              }

              const formName = fbLead.form_name || fallbackFormOrAdName || 'Meta Form';
              const campaignName = fbLead.campaign_name || fallbackCampName || '';
              const campaignId = fbLead.campaign_id || fallbackCampId || null;
              const adName = fbLead.ad_name || '';
              const adCampaignString = adName ? `${campaignName || formName} / ${adName}` : (campaignName || formName);
              const formId = fbLead.form_id || formIdParam || null;

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
                ad_name: adName || formName,
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
              if (city) customFields.city = city;

              // Evaluate Assignment: Group-Distribution First, then Campaign-Assignment, then Round Robin
              let assignedAgentId: string | null = null;

              // 1. Group-Distribution
              if (groupAutomations && groupAutomations.length > 0) {
                for (const aut of groupAutomations) {
                  try {
                    const parsedGroup = JSON.parse(aut.description || '{}');
                    const groupCampaigns: string[] = Array.isArray(parsedGroup.campaigns) ? parsedGroup.campaigns : [];
                    const groupCampaignIds: string[] = Array.isArray(parsedGroup.campaign_ids) ? parsedGroup.campaign_ids : [];
                    const groupFormIds: string[] = Array.isArray(parsedGroup.form_ids) ? parsedGroup.form_ids : [];
                    const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];

                    if (groupMembers.length > 0 && (groupCampaigns.length > 0 || groupCampaignIds.length > 0 || groupFormIds.length > 0)) {
                      const leadCtx = {
                        campaignId,
                        campaignName,
                        adName,
                        formName,
                        formId,
                        adCampaignString
                      };

                      // 1. Exact ID match (Highest deterministic priority)
                      const matchesById = (campaignId && groupCampaignIds.includes(String(campaignId))) ||
                                          (formId && groupFormIds.includes(String(formId)));

                      // 2. Fallback to name rule matcher
                      const matchesByRule = groupCampaigns.length > 0 && groupCampaigns.some(gc => matchesCampaignRule(gc, leadCtx, campaignsMap));

                      if (matchesById || matchesByRule) {
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

                        const updatedGroupJson = JSON.stringify(parsedGroup);
                        aut.description = updatedGroupJson;

                        await supabaseAdmin
                          .from('automations')
                          .update({ description: updatedGroupJson })
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
                const ruleTitleForm = `Campaign-Assignment: ${formName}`;
                const matchedAut = campAutomations.find(a => a.title === ruleTitle || a.title === ruleTitleCamp || a.title === ruleTitleForm);
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

              // Check Duplicate Phone Number across entire workspace to Reopen Existing Lead
              const workspaceTeamIds = [profile.id, ...(teamAgentIds || [])];
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
                    continue;
                  }

                  const reopenedCount = (existingLead.reopened_count || cf.reopened_count || 0) + 1;
                  const previousSources: string[] = Array.isArray(cf.reopened_sources) ? cf.reopened_sources : [];
                  const updatedSources = [...previousSources, currentSourceId];

                  cf = {
                    ...cf,
                    reopened_count: reopenedCount,
                    reopened_sources: updatedSources,
                    last_reopened_at: new Date().toISOString(),
                    last_reopened_source: currentSourceId
                  };

                  const updateLeadData: Record<string, any> = {
                    custom_fields: cf,
                    reopened_count: reopenedCount
                  };
                  if (leadgenId && !existingLead.facebook_lead_id) {
                    updateLeadData.facebook_lead_id = leadgenId;
                  }
                  if (adCampaignString && !existingLead.ad_name) {
                    updateLeadData.ad_name = adCampaignString;
                  }
                  if (formName && !existingLead.form_name) {
                    updateLeadData.form_name = formName;
                  }

                  await supabaseAdmin
                    .from('leads')
                    .update(updateLeadData)
                    .eq('id', existingLead.id);

                  const reopenDesc = `The lead was reopened from Meta Ads Sync\nLead Name : ${name || existingLead.name}\nContact no : ${phone}\nSource : Facebook Ads\nDetails : ${adCampaignString || formName}`;
                  await supabaseAdmin.from('lead_history').insert({
                    lead_id: existingLead.id,
                    user_id: existingLead.assigned_to || existingLead.user_id,
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
                pipeline_stage: 'New Lead',
                status: 'New Lead',
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

          // 6. Iterate through active leadgen forms (newest forms first)
          const formsToScan = formsList
            .filter((f: any) => f.status === 'ACTIVE' || !f.status)
            .sort((a: any, b: any) => new Date(b.created_time || 0).getTime() - new Date(a.created_time || 0).getTime());
          for (const form of formsToScan) {
            const formId = form.id;
            const formName = form.name || 'Meta Form';

            const formToken = form._pageToken || profile.selected_page_token || profile.facebook_token;
            try {
              const leadsRes = await fetch(`https://graph.facebook.com/v20.0/${formId}/leads?fields=id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name&limit=30&access_token=${formToken}`, {
                signal: AbortSignal.timeout(6000)
              });
              if (!leadsRes.ok) continue;
              const leadsData = await leadsRes.json();
              const fbLeads = leadsData.data || [];
              if (fbLeads.length > 0) {
                await processFbLeadsBatch(fbLeads, formName, '', null, formId);
              }
            } catch (e) {}
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
