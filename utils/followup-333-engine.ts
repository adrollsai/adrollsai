import { createClient } from '@supabase/supabase-js'
import { callGemini } from '@/utils/external-apis'
import { triggerOutboundCall } from '@/utils/voice-helper'

export interface FollowupLeadContext {
  id: string
  user_id: string
  name?: string | null
  phone?: string | null
  email?: string | null
  source?: string | null
  ad_name?: string | null
  form_name?: string | null
  status?: string | null
  pipeline_stage?: string | null
  booked_time?: string | null
  calling_enabled?: boolean | null
  whatsapp_enabled?: boolean | null
  custom_fields?: any
  created_at: string
}

export interface BusinessProfileContext {
  id: string
  business_name?: string | null
  business_info?: string | null
  custom_domain?: string | null
  whatsapp_access_token?: string | null
  whatsapp_phone_number_id?: string | null
  whatsapp_catalogue_button_text?: string | null
  whatsapp_buttons?: any[]
  auto_call_new_leads?: boolean | null
  voice_twilio_number?: string | null
  voice_twilio_sid?: string | null
}

/**
 * Universal 3-3-3 Follow-Up Timeline (3 Hours -> 3 Days -> 3 Weeks -> 3 Months)
 * 
 * Phase 1: First 3 Hours (Day 1)
 *  - Stage 1: T+1 Hour (Friendly Value / Catalog / Info Share)
 *  - Stage 2: T+3 Hours (Inquiry Check-in & Voice Retry if DNP)
 * 
 * Phase 2: Next 3 Days (Days 2 to 4)
 *  - Stage 3: Day 2 (~24-30h) (Universal Value, Pricing & Package Options)
 *  - Stage 4: Day 3 (~48-54h) (Social Proof, Case Studies & Client Results)
 *  - Stage 5: Day 4 (~72-80h) (Direct Consultation / Strategy Session / Visit Proposal)
 * 
 * Phase 3: Next 3 Weeks (Days 7, 14, 21)
 *  - Stage 6: Week 1 (Day 7) (New Updates, Inventory & Service Highlights)
 *  - Stage 7: Week 2 (Day 14) (Needs Re-assessment & Alternative Options)
 *  - Stage 8: Week 3 (Day 21) (Priority Status & Re-engagement Check)
 * 
 * Phase 4: Next 3 Months (Days 30, 60, 90)
 *  - Stage 9: Month 1 (Day 30) (Monthly Update & Seasonal Offer Check-in)
 *  - Stage 10: Month 2 (Day 60) (Reactivation & Needs Check)
 *  - Stage 11: Month 3 (Day 90) (Respectful Breakup & File Close Message)
 */

export const STAGE_MILESTONES = [
  { stage: 1, name: '1h_checkin', minHours: 1, maxHours: 3, phase: 'Phase 1: Hour 1 (Day 1)' },
  { stage: 2, name: '3h_checkin', minHours: 3, maxHours: 18, phase: 'Phase 1: Hour 3 (Day 1)' },
  { stage: 3, name: 'day2_value', minHours: 24, maxHours: 42, phase: 'Phase 2: Day 2' },
  { stage: 4, name: 'day3_social_proof', minHours: 48, maxHours: 66, phase: 'Phase 2: Day 3' },
  { stage: 5, name: 'day4_consultation', minHours: 72, maxHours: 120, phase: 'Phase 2: Day 4' },
  { stage: 6, name: 'week1_update', minHours: 168, maxHours: 288, phase: 'Phase 3: Week 1 (Day 7)' },
  { stage: 7, name: 'week2_recheck', minHours: 336, maxHours: 480, phase: 'Phase 3: Week 2 (Day 14)' },
  { stage: 8, name: 'week3_priority', minHours: 504, maxHours: 672, phase: 'Phase 3: Week 3 (Day 21)' },
  { stage: 9, name: 'month1_update', minHours: 720, maxHours: 1200, phase: 'Phase 4: Month 1 (Day 30)' },
  { stage: 10, name: 'month2_reactivation', minHours: 1440, maxHours: 1920, phase: 'Phase 4: Month 2 (Day 60)' },
  { stage: 11, name: 'month3_breakup', minHours: 2160, maxHours: 2640, phase: 'Phase 4: Month 3 (Day 90)' }
]

/**
 * Universal AI Clause & Parameter Generator for WhatsApp Follow-Up
 * 100% Industry-Agnostic: Works for Real Estate, Healthcare, SaaS, Agencies, E-Commerce, etc.
 */
export async function generate333FollowupParams(
  lead: FollowupLeadContext,
  profile: BusinessProfileContext,
  stage: number,
  chatHistory = '',
  propertiesText = ''
): Promise<{
  name: string
  businessName: string
  topic: string
  aiClause: string
  freeFormText: string
}> {
  const name = (lead.name && lead.name.trim() !== 'Customer' && lead.name.trim().length > 1) 
    ? lead.name.trim() 
    : 'there'
  
  const businessName = profile.business_name || 'our team'
  
  let topicFallback = 'your inquiry'
  if (lead.ad_name) {
    topicFallback = `your inquiry on ${lead.ad_name}`
  } else if (lead.custom_fields?.meta_ad_origin?.headline) {
    topicFallback = `your inquiry on ${lead.custom_fields.meta_ad_origin.headline}`
  }

  // Universal Fallback Clauses (Industry-Agnostic)
  const stageFallbacks: Record<number, { clause: string; freeForm: string }> = {
    1: {
      clause: 'I wanted to share our complete details and brochure with you.',
      freeForm: `Hi ${name}! Just sharing our complete details and overview for ${businessName}. Let me know if you have any questions!`
    },
    2: {
      clause: 'I wanted to check if you had any questions regarding our offerings.',
      freeForm: `Hi ${name}, checking in to see if you had any specific questions regarding ${businessName}. Happy to help!`
    },
    3: {
      clause: 'We have updated pricing, package details, and options available for you.',
      freeForm: `Hi ${name}, we just released updated pricing and package options for ${businessName}. Would you like me to send them over?`
    },
    4: {
      clause: 'Our clients have been seeing fantastic results with our latest offerings.',
      freeForm: `Hi ${name}, wanted to share some recent client results and walkthroughs from ${businessName}. Shall I send the link?`
    },
    5: {
      clause: 'Our specialist has open consultation and discovery call slots available this week.',
      freeForm: `Hi ${name}, would you like to schedule a quick 10-minute consultation or discovery session this week with our specialist?`
    },
    6: {
      clause: 'We just released our latest updates and new available options.',
      freeForm: `Hi ${name}, wanted to share our latest offerings and updates for ${businessName}. Let me know if you would like to review!`
    },
    7: {
      clause: 'I wanted to check if your requirements have evolved or if you would like alternative options.',
      freeForm: `Hi ${name}, are you still exploring options with ${businessName}, or shall I share some alternatives that match your preference?`
    },
    8: {
      clause: 'I wanted to check if you would like us to prioritize your inquiry with our team.',
      freeForm: `Hi ${name}, checking in to see if you need any further assistance with your inquiry at ${businessName}.`
    },
    9: {
      clause: 'We have exciting new updates and seasonal packages released this month.',
      freeForm: `Hi ${name}, hope you are doing well! We have new updates and exclusive options available this month at ${businessName}.`
    },
    10: {
      clause: 'I wanted to reconnect and see if you are looking to move forward with your requirements.',
      freeForm: `Hi ${name}, re-checking if you are still looking for solutions regarding ${businessName}, or if your timeline has shifted?`
    },
    11: {
      clause: 'We haven\'t heard back, so I wanted to check if we should keep your inquiry active.',
      freeForm: `Hi ${name}, assuming you are all sorted for now! Should we close your inquiry with ${businessName}, or are you still exploring?`
    }
  }

  const defaultStage = stageFallbacks[stage] || stageFallbacks[1]

  try {
    const prompt = `
You are an expert AI follow-up assistant for "${businessName}".
Business Information: ${profile.business_info || 'Professional services and solutions.'}
Catalog / Offerings: ${propertiesText || 'N/A'}
Lead Name: "${name}"
Lead Inquiry Context: "${lead.ad_name || lead.source || 'General Inquiry'}"
Lead Metadata: ${JSON.stringify(lead.custom_fields || {})}
Recent Conversation History:
${chatHistory || 'No prior chat history.'}

Follow-up Goal (Milestone Stage: ${stage}):
${stage <= 2 ? 'Friendly value drop & inquiry check-in' : stage <= 5 ? 'Value, pricing options, and consultation invite' : stage <= 8 ? 'Re-assessment and alternative options' : 'Long-tail monthly reactivation or respectful breakup'}

Guidelines:
1. NEVER mention real estate, property, floor plans, or apartments UNLESS the business specifically sells real estate.
2. Adapt dynamically to the business's industry (${profile.business_name || 'our company'}).
3. Output strict JSON with:
   - "topic": Short inquiry topic phrase (e.g. "your inquiry", max 6 words).
   - "ai_clause": A natural, professional single sentence providing relevant value for this milestone (Max 18 words).
   - "free_form": A warm, complete WhatsApp message under 35 words.

Output JSON only:
{
  "topic": "...",
  "ai_clause": "...",
  "free_form": "..."
}
`
    const aiRes = await callGemini(prompt)
    const cleanJson = aiRes.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleanJson)

    return {
      name,
      businessName,
      topic: parsed.topic || topicFallback,
      aiClause: parsed.ai_clause || defaultStage.clause,
      freeFormText: parsed.free_form || defaultStage.freeForm
    }
  } catch (err) {
    console.warn('[3-3-3 Follow-Up] Gemini clause generation fallback:', err)
    return {
      name,
      businessName,
      topic: topicFallback,
      aiClause: defaultStage.clause,
      freeFormText: defaultStage.freeForm
    }
  }
}

/**
 * Main 3-3-3 Follow-Up Engine Executor
 * Evaluates active leads across 3 months, checks credentials, and dispatches WhatsApp & Voice touches gracefully.
 */
export async function run333FollowupEngine(supabaseAdmin: any): Promise<{
  scannedCount: number
  whatsappSentCount: number
  voiceScheduledCount: number
  skippedCount: number
}> {
  console.log('[3-3-3 Engine] Scanning leads across all workspaces for 3-3-3 follow-ups (up to 3 months)...')

  const ninetyFiveDaysAgo = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString()
  const now = Date.now()

  // 1. Fetch leads created in last 95 days who haven't completed or closed the pipeline
  const { data: activeLeads, error: leadsErr } = await supabaseAdmin
    .from('leads')
    .select('id, user_id, name, phone, email, source, ad_name, form_name, status, pipeline_stage, booked_time, calling_enabled, whatsapp_enabled, custom_fields, created_at')
    .gte('created_at', ninetyFiveDaysAgo)
    .not('pipeline_stage', 'in', '("Appointment Booked", "Won", "Deal/Token", "Lost/NI", "Different Requirement", "Dealer", "Already Purchased")')
    .is('booked_time', null)
    .order('created_at', { ascending: false })
    .limit(150)

  if (leadsErr || !activeLeads || activeLeads.length === 0) {
    return { scannedCount: 0, whatsappSentCount: 0, voiceScheduledCount: 0, skippedCount: 0 }
  }

  let whatsappSentCount = 0
  let voiceScheduledCount = 0
  let skippedCount = 0

  const profileCache = new Map<string, BusinessProfileContext>()
  const propertiesCache = new Map<string, string>()

  for (const lead of activeLeads) {
    try {
      const createdTime = new Date(lead.created_at).getTime()
      const hoursSinceCreation = (now - createdTime) / (60 * 60 * 1000)

      let customFields = lead.custom_fields || {}
      if (typeof customFields === 'string') {
        try { customFields = JSON.parse(customFields) } catch (e) { customFields = {} }
      }

      const completedStages: number[] = Array.isArray(customFields.followup_333_completed_stages)
        ? customFields.followup_333_completed_stages
        : []

      const lastSentTime = customFields.followup_333_last_sent_at
        ? new Date(customFields.followup_333_last_sent_at).getTime()
        : 0

      // Minimum 45-minute spacing between any automated follow-up touches
      if (now - lastSentTime < 45 * 60 * 1000) {
        skippedCount++
        continue
      }

      // Find the eligible milestone
      const eligibleMilestone = STAGE_MILESTONES.find(m => 
        hoursSinceCreation >= m.minHours && 
        hoursSinceCreation <= m.maxHours && 
        !completedStages.includes(m.stage)
      )

      if (!eligibleMilestone) {
        skippedCount++
        continue
      }

      // Fetch owner profile (with cache)
      let profile = profileCache.get(lead.user_id)
      if (!profile) {
        const { data: fetchedProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, business_name, business_info, custom_domain, whatsapp_access_token, whatsapp_phone_number_id, whatsapp_catalogue_button_text, whatsapp_buttons, auto_call_new_leads, voice_twilio_number, voice_twilio_sid')
          .eq('id', lead.user_id)
          .maybeSingle()
        if (fetchedProfile) {
          profile = fetchedProfile
          profileCache.set(lead.user_id, fetchedProfile)
        }
      }

      if (!profile) {
        skippedCount++
        continue
      }

      // Determine available channels
      const hasWhatsApp = !!(profile.whatsapp_access_token && profile.whatsapp_phone_number_id && lead.whatsapp_enabled !== false && lead.phone)
      const hasVoice = !!(profile.auto_call_new_leads && profile.voice_twilio_number && lead.calling_enabled !== false && lead.phone)

      if (!hasWhatsApp && !hasVoice) {
        skippedCount++
        continue
      }

      // Fetch active offerings/properties text for AI grounding
      let propertiesText = propertiesCache.get(lead.user_id)
      if (!propertiesText) {
        const { data: properties } = await supabaseAdmin
          .from('properties')
          .select('title, price, address, property_type, description')
          .eq('user_id', lead.user_id)
          .limit(5)

        propertiesText = 'No specific catalog items listed.'
        if (properties && properties.length > 0) {
          propertiesText = properties
            .map((p: any) => `- ${p.title} (${p.property_type || 'Offering'}): ${p.price || 'N/A'}`)
            .join('\n')
        }
        propertiesCache.set(lead.user_id, propertiesText || '')
      }

      // Fetch recent chat history to check recent replies
      let chatHistory = ''
      let recentInboundTime = 0
      let chatId: string | null = null

      if (hasWhatsApp) {
        const { data: chat } = await supabaseAdmin
          .from('whatsapp_chats')
          .select('id, updated_at')
          .eq('user_id', lead.user_id)
          .ilike('recipient_phone', `%${(lead.phone || '').slice(-10)}%`)
          .maybeSingle()

        if (chat) {
          chatId = chat.id
          const { data: messages } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('direction, message_text, created_at')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: false })
            .limit(10)

          if (messages && messages.length > 0) {
            const lastMessage = messages[0]
            const lastMsgTime = new Date(lastMessage.created_at).getTime()
            // Strict Guardrail: Skip if ANY message (inbound or outbound) occurred in last 2 hours
            if (now - lastMsgTime < 2 * 60 * 60 * 1000) {
              skippedCount++
              continue
            }

            const lastInbound = messages.find((m: any) => m.direction === 'inbound')
            if (lastInbound) {
              recentInboundTime = new Date(lastInbound.created_at).getTime()
              // Guardrail: If customer requested an expert or human agent within 24 hours, don't spam bot messages
              if (/connect|expert|call\s+me|speak\s+with|human|talk\s+to/i.test(lastInbound.message_text) && (now - recentInboundTime) < 24 * 60 * 60 * 1000) {
                skippedCount++
                continue
              }
            }

            chatHistory = [...messages]
              .reverse()
              .map((m: any) => `${m.direction === 'inbound' ? 'User' : 'Assistant'}: ${m.message_text}`)
              .join('\n')
          }
        }
      }

      // Check lead_history to ensure no touchpoint was recorded in last 2 hours
      const { data: recentHist } = await supabaseAdmin
        .from('lead_history')
        .select('created_at')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (recentHist && recentHist.length > 0) {
        const lastHistTime = new Date(recentHist[0].created_at).getTime()
        if (now - lastHistTime < 2 * 60 * 60 * 1000) {
          skippedCount++
          continue
        }
      }

      // Guardrail: Skip automated push if user replied in WhatsApp within last 2 hours
      if (recentInboundTime > 0 && (now - recentInboundTime) < 2 * 60 * 60 * 1000) {
        skippedCount++
        continue
      }

      const generated = await generate333FollowupParams(lead, profile, eligibleMilestone.stage, chatHistory, propertiesText)

      let whatsappDispatched = false
      let voiceDispatched = false

      // 1. Dispatch WhatsApp Touchpoint
      if (hasWhatsApp) {
        try {
          const cleanPhone = (lead.phone || '').replace(/\D/g, '')
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
          const catalogueLink = profile.custom_domain ? `https://${profile.custom_domain}` : `${appUrl}/shared/${lead.user_id}`
          const catalogueBtnText = profile.whatsapp_catalogue_button_text || 'See Details'

          let metaPayload: any = null
          let logMsg = ''

          // For Phase 1 (Hours 1 & 3), attempt Free-Form CTA if customer session active
          if (eligibleMilestone.stage <= 2) {
            metaPayload = {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: cleanPhone,
              type: 'interactive',
              interactive: {
                type: 'cta_url',
                body: { text: generated.freeFormText },
                action: {
                  name: 'cta_url',
                  parameters: {
                    display_text: catalogueBtnText,
                    url: catalogueLink
                  }
                }
              }
            }
            logMsg = generated.freeFormText
          } else {
            // Outside 24h window (Phase 2, 3, 4): Send Meta-approved Universal 4-variable Template
            const isBreakup = eligibleMilestone.stage === 11
            const templateName = isBreakup ? 'universal_breakup_followup' : 'universal_followup_v2'
            const templateParams = isBreakup
              ? [generated.name, generated.businessName, generated.topic]
              : [generated.name, generated.businessName, generated.topic, generated.aiClause]

            metaPayload = {
              messaging_product: 'whatsapp',
              to: cleanPhone,
              type: 'template',
              template: {
                name: templateName,
                language: { code: 'en_US' },
                components: [
                  {
                    type: 'body',
                    parameters: templateParams.map(val => ({ type: 'text', text: val }))
                  }
                ]
              }
            }
            logMsg = `[3-3-3 ${eligibleMilestone.phase}] ${generated.freeFormText}`
          }

          const metaUrl = `https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}/messages`
          let metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${profile.whatsapp_access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(metaPayload)
          })

          let sendData = await metaRes.json()

          // Fallback to Template if free-form failed due to 24h window
          if (sendData.error && eligibleMilestone.stage <= 2 && (sendData.error.code === 131047 || sendData.error.error_subcode === 2494010)) {
            const fallbackPayload = {
              messaging_product: 'whatsapp',
              to: cleanPhone,
              type: 'template',
              template: {
                name: 'universal_followup_v2',
                language: { code: 'en_US' },
                components: [
                  {
                    type: 'body',
                    parameters: [generated.name, generated.businessName, generated.topic, generated.aiClause].map(val => ({ type: 'text', text: val }))
                  }
                ]
              }
            }

            metaRes = await fetch(metaUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(fallbackPayload)
            })
            sendData = await metaRes.json()
            logMsg = `[3-3-3 Template] ${generated.aiClause}`
          }

          if (!sendData.error) {
            whatsappDispatched = true
            whatsappSentCount++

            if (chatId) {
              await supabaseAdmin.from('whatsapp_messages').insert({
                chat_id: chatId,
                direction: 'outbound',
                message_text: logMsg
              })
            }

            // Log timeline history in CRM
            await supabaseAdmin.from('lead_history').insert({
              lead_id: lead.id,
              action_type: 'REMARK',
              description: `📱 [3-3-3 WhatsApp: ${eligibleMilestone.phase}]: ${logMsg}`
            })
          } else {
            console.warn(`[3-3-3 WhatsApp] Meta send error for lead ${lead.id}:`, sendData.error.message)
          }
        } catch (waErr) {
          console.error(`[3-3-3 WhatsApp] Dispatch failed for lead ${lead.id}:`, waErr)
        }
      }

      // 2. Dispatch AI Voice Touchpoint (for stages 2, 3, 5, 7, 10 if voice active & lead unbooked)
      const voiceEligibleStages = [2, 3, 5, 7, 10]
      if (hasVoice && voiceEligibleStages.includes(eligibleMilestone.stage)) {
        try {
          const dnpCount = customFields.dnp_count || 0
          if (dnpCount < 5) {
            // Trigger outbound call with single-channel queue management
            const callRes = await triggerOutboundCall(supabaseAdmin, lead.id, lead.user_id, true)
            if (callRes.success) {
              voiceDispatched = true
              voiceScheduledCount++

              await supabaseAdmin.from('lead_history').insert({
                lead_id: lead.id,
                action_type: 'REMARK',
                description: `🎙️ [3-3-3 Voice: ${eligibleMilestone.phase}]: ${callRes.scheduled ? 'Queued outbound follow-up call on phone line' : 'Initiated outbound voice consultation'}`
              })
            }
          }
        } catch (vErr) {
          console.error(`[3-3-3 Voice] Dispatch failed for lead ${lead.id}:`, vErr)
        }
      }

      // 3. Mark Stage Completed in custom_fields
      if (whatsappDispatched || voiceDispatched) {
        const updatedCompletedStages = Array.from(new Set([...completedStages, eligibleMilestone.stage]))
        const updatedCustomFields = {
          ...customFields,
          followup_333_completed_stages: updatedCompletedStages,
          followup_333_last_sent_at: new Date().toISOString(),
          followup_333_last_milestone: eligibleMilestone.name
        }

        const { error: saveErr } = await supabaseAdmin.from('leads').update({
          custom_fields: updatedCustomFields
        }).eq('id', lead.id)

        if (saveErr) {
          console.error(`[3-3-3 Engine] Error saving milestone to lead ${lead.id}:`, saveErr)
        } else {
          console.log(`[3-3-3 Engine] Successfully recorded ${eligibleMilestone.phase} for lead ${lead.name || lead.phone} (WhatsApp: ${whatsappDispatched}, Voice: ${voiceDispatched})`)
        }
      }
    } catch (leadProcessErr) {
      console.error(`[3-3-3 Engine] Error processing lead ${lead.id}:`, leadProcessErr)
    }
  }

  return {
    scannedCount: activeLeads.length,
    whatsappSentCount,
    voiceScheduledCount,
    skippedCount
  }
}
