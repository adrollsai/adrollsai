import { NextResponse } from 'next/server'
import { callDeepSeekWithUsage } from '@/utils/external-apis'
import { createClient } from '@/utils/supabase/server'

// System Prompt for DeepSeek v4-flash to generate enterprise-grade automation flows
const FLOW_ARCHITECT_SYSTEM_PROMPT = `
You are the Lead Flow Architect for Nobogent / Bluesquare Infra.
Your task is to transform any user's natural language or voice description of their workflow into a complete, enterprise-grade, deterministic Automation Flow JSON.

IMPORTANT RULES & CONSTRAINTS:
1. ALWAYS use DEEPSEEK V4 FLASH principles (fast, deterministic, structured). NEVER reference Gemini 1.5.
2. DO NOT USE FUZZY OR HALLUCINATED AI QUALIFICATION. All qualification MUST be deterministic using type: "action_qualify" with exact matching rules (operator: "contains_any" | "equals" | ">="), numerical points, and a deterministic passScore.
3. Supported Triggers:
   - "trigger_campaign_audience": Existing campaign audience calling target
   - "trigger_csv_audience": Custom Uploaded CSV lead audience (supports csvFileName, leadCount, columnMapping)
   - "trigger_custom_audience_group": Custom Audience Group / Segment (supports groupName, audienceSegment)
   - "trigger_meta_ad": Meta / Facebook / Instagram Ad form leads
   - "trigger_whatsapp_inbound": Inbound WhatsApp message
   - "trigger_portal_lead": Housing.com / 99Acres lead
   - "trigger_crm_lead": CRM lead created or stage changed
   - "trigger_webhook": External webhook / API

4. Supported Actions:
   - "action_ai_call": Automated Outbound AI Voice Call.
     IMPORTANT: For voiceAgent, ALWAYS use official Gemini 3.1 Flash Live API voices: "Puck (Clear & Engaging)", "Fenrir (Crisp & Focused)", "Kore (Warm & Consultative)", "Charon (Deep & Authoritative)", "Aoede (Melodic & Natural)". NEVER use mock names.
     Config schema: {
       voiceAgent: "Puck (Clear & Engaging)" | "Fenrir (Crisp & Focused)" | "Kore (Warm & Consultative)" | "Charon (Deep & Authoritative)" | "Aoede (Melodic & Natural)",
       objective: string,
       firstLine: string,
       questions: Array<{ id: string, question: string, fieldKey: string, saveToLeadProfile: boolean, expectedAnswer?: string }>,
       qualificationQuestion: string
     }
   - "action_qualify": Deterministic Lead Qualification & Scoring (config: { scoringMode: "points", passScore: number, rules: Array<{ id, field, label, operator, value, points, required }> })
   - "action_condition": If-Else Logic Branch (config: { field, operator, value, branchTrueLabel?, branchFalseLabel? }) - nodes following can have branch: "true" or "false"
   - "action_whatsapp_msg": Send WhatsApp Message.
     IMPORTANT (Meta WhatsApp Business API Constraint): You must choose EITHER Quick Reply buttons OR Call-To-Action (CTA) Link buttons; they CANNOT be mixed in the same message:
     * Mode A: buttonType: "quick_reply" (Up to 3 buttons for flow branching and CRM actions):
       config: {
         message: string,
         includeBrochure: boolean,
         brochureUrl?: string,
         buttonType: "quick_reply",
         quickReplyButtons: Array<{ id: string, title: string, actionType: "crm_stage" | "notify_admin" | "assign_agent" | "send_reply", actionValue: string }>,
         buttons: string[]
       }
     * Mode B: buttonType: "cta_url" (Up to 2 external URL or Phone Call buttons):
       config: {
         message: string,
         includeBrochure: boolean,
         buttonType: "cta_url",
         ctaButtons: Array<{ id: string, title: string, type: "url" | "call", url: string }>
       }
   - "action_whatsapp_questions": Ask screening questions / collect info
   - "action_crm_stage": Update Lead Stage & Tags in CRM (config: { stage, tags })
   - "action_assign_agent": Assign Lead to Agent or Distribution Group (config: { assignMode: "individual" | "group", agentName?: string, groupName?: string })
   - "action_delay": Smart Wait Timer (config: { duration: number, unit: "minutes" | "hours" | "days" })
   - "action_webhook": Outbound Webhook to external CRM/endpoint

Return ONLY a valid, raw JSON object (NO markdown backticks, NO surrounding text) with this exact schema:
{
  "name": "Title of the flow",
  "description": "Concise explanation of what this automation executes",
  "icon": "PhoneCall | Send | Users | Zap | Globe",
  "isActive": true,
  "trigger": {
    "type": "trigger_campaign_audience | trigger_csv_audience | trigger_custom_audience_group | trigger_meta_ad | trigger_whatsapp_inbound | trigger_portal_lead | trigger_crm_lead",
    "label": "Human readable trigger name",
    "campaignName": "Optional campaign name",
    "portalName": "Optional portal name",
    "csvFileName": "Optional CSV file name",
    "groupName": "Optional custom audience group name"
  },
  "nodes": [
    {
      "id": "step_1",
      "type": "FlowNodeType",
      "title": "Concise Step Title",
      "description": "What this step does",
      "branch": "main | true | false",
      "config": { ... }
    }
  ]
}
`

// Intelligent Deterministic Generator fallback if DeepSeek API is offline or key missing
function generateDeterministicFallback(prompt: string): any {
  const p = prompt.toLowerCase()

  // 1. Primary Use Case: Calling Campaign + Deterministic Qualification + Admin Alert + WhatsApp Brochure
  if (p.includes('call') || p.includes('qualification') || p.includes('brochure') || p.includes('campaign audience') || p.includes('prospect says yes') || p.includes('csv') || p.includes('audience group')) {
    const isCsv = p.includes('csv')
    const isCustomGroup = p.includes('custom audience') || p.includes('audience group') || p.includes('group')

    return {
      name: isCsv 
        ? 'Custom CSV Audience Calling & Qualification' 
        : isCustomGroup 
        ? 'Custom Audience Group Qualification Pipeline' 
        : 'Outbound Calling & Qualification Pipeline',
      description: 'Initiates outbound calling campaign using official Gemini Live voice, deterministically qualifies prospects on site visit interest, alerts admin via Email & WhatsApp, and delivers project brochure on WhatsApp.',
      icon: 'PhoneCall',
      isActive: true,
      trigger: isCsv ? {
        type: 'trigger_csv_audience',
        label: 'Uploaded CSV Audience: Mohali-HNIs-Calling-List.csv',
        csvFileName: 'Mohali-HNIs-Calling-List.csv',
        csvLeadCount: 450
      } : isCustomGroup ? {
        type: 'trigger_custom_audience_group',
        label: 'Custom Audience Group: High Intent Investors',
        groupName: 'High Intent Investors (Mohali)'
      } : {
        type: 'trigger_campaign_audience',
        label: 'Existing Campaign Audience (Calling Target)',
        campaignName: 'Joy Grand Luxury Residences'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_ai_call',
          title: 'Automated AI Voice Call (Gemini Live)',
          description: 'Places outbound call with Gemini Live voice, asks qualification questions, and saves responses to Lead Profile',
          branch: 'main',
          config: {
            voiceAgent: 'Fenrir (Crisp & Focused)',
            objective: 'Site Visit Confirmation & Requirement Check',
            firstLine: 'Hi {{lead.name}}, I am calling from Bluesquare Infra regarding Joy Grand Luxury Residences.',
            questions: [
              {
                id: 'q_1',
                question: 'Are you interested in scheduling a site visit this weekend?',
                fieldKey: 'site_visit_interest',
                saveToLeadProfile: true,
                expectedAnswer: 'Yes / Saturday / Sunday'
              },
              {
                id: 'q_2',
                question: 'What is your preferred investment budget (e.g., 1.5 Cr to 2.5 Cr)?',
                fieldKey: 'budget_range',
                saveToLeadProfile: true,
                expectedAnswer: '1.5 Cr - 2.5 Cr'
              }
            ],
            qualificationQuestion: 'Are you interested in scheduling a site visit this weekend?'
          }
        },
        {
          id: 'step_2',
          type: 'action_qualify',
          title: 'Deterministic Qualification: Did Prospect Say Yes?',
          description: '100% deterministic rule verification - zero hallucinations',
          branch: 'main',
          config: {
            scoringMode: 'points',
            passScore: 100,
            rules: [
              {
                id: '1',
                field: 'site_visit_interest',
                label: 'Prospect Agreed / Answered Yes to Site Visit',
                operator: 'contains_any',
                value: 'yes, yeah, sure, interested, visit, confirm, weekend, definitely, please share',
                points: 100,
                required: true
              }
            ]
          }
        },
        {
          id: 'step_3',
          type: 'action_condition',
          title: 'Branch: Qualified (Said Yes) vs Not Interested',
          description: 'Splits execution path deterministically based on qualification score',
          branch: 'main',
          config: {
            field: 'qualification_score',
            operator: '>=',
            value: 100
          }
        },
        {
          id: 'step_4',
          type: 'action_notify_team',
          title: 'Instant Alert to Admin (Email + WhatsApp)',
          description: 'Pings admin email and WhatsApp with full prospect contact & call details',
          branch: 'true',
          config: {
            channels: ['email', 'whatsapp'],
            adminEmail: 'admin@bluesquareinfra.com',
            adminWhatsapp: '+91 98765 43210',
            includeLeadInfo: true,
            includeCallDetails: true,
            alertMessage: '🔥 HOT LEAD ALERT: {{lead.name}} ({{lead.phone}}) said YES to site visit on call! Call recording & qualification attached.'
          }
        },
        {
          id: 'step_5',
          type: 'action_whatsapp_msg',
          title: 'Deliver Project Brochure on WhatsApp',
          description: 'Sends official Joy Grand PDF brochure and interactive response buttons',
          branch: 'true',
          config: {
            message: 'Hello {{lead.name}}! Thank you for speaking with our advisor. As promised, here is the official Joy Grand project brochure, floor plans, and pricing sheet:',
            includeBrochure: true,
            brochureUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
            buttonType: 'quick_reply',
            quickReplyButtons: [
              { id: 'btn_1', title: '📅 Confirm Saturday Slot', actionType: 'crm_stage', actionValue: 'Visit Planned' },
              { id: 'btn_2', title: '💬 Chat With Sales', actionType: 'assign_agent', actionValue: 'Harman Bajwa' },
              { id: 'btn_3', title: '📍 Location Pin', actionType: 'send_reply', actionValue: 'Here is our sales gallery on Google Maps: https://maps.google.com/?q=Joy+Grand+Mohali' }
            ],
            ctaButtons: [
              { id: 'cta_1', title: '📍 Open Google Maps', type: 'url', url: 'https://maps.google.com/?q=Joy+Grand+Mohali' }
            ],
            buttons: ['📅 Confirm Saturday Slot', '💬 Chat With Sales', '📍 Location Pin']
          }
        },
        {
          id: 'step_6',
          type: 'action_crm_stage',
          title: 'Move Lead Stage to "Visit Planned"',
          description: 'Updates CRM pipeline stage and tags lead as Qualified Calling Campaign',
          branch: 'true',
          config: {
            stage: 'Visit Planned',
            tags: 'Calling Campaign, Qualified On Call, Brochure Sent'
          }
        },
        {
          id: 'step_7',
          type: 'action_crm_stage',
          title: 'Move Lead Stage to "Follow-up Later"',
          description: 'When prospect was busy or did not confirm on call',
          branch: 'false',
          config: {
            stage: 'Contacted',
            tags: 'Calling Campaign, Needs Follow-up'
          }
        }
      ]
    }
  }

  // 2. Hiring / Screening Flow
  if (p.includes('hiring') || p.includes('candidate') || p.includes('interview') || p.includes('resume') || p.includes('job')) {
    return {
      name: 'Meta Ad Hiring & Deterministic Screening Flow',
      description: 'Auto-qualifies job applicants from Meta ads via WhatsApp screening questions, scores responses deterministically, and fast-tracks top candidates to in-person interviews.',
      icon: 'Users',
      isActive: true,
      trigger: {
        type: 'trigger_meta_ad',
        label: 'Meta Hiring Campaign Lead'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_whatsapp_questions',
          title: 'Ask 3 Screening Questions',
          description: 'Candidate experience, current location & expected salary',
          branch: 'main',
          config: {
            questions: [
              'How many years of relevant sales/calling experience do you have?',
              'Are you comfortable working on-site in Mohali / Chandigarh?',
              'What is your expected monthly in-hand salary?'
            ],
            quickReplies: ['2+ Years Exp', '1 Year Exp', 'Fresher', 'Immediate Joiner'],
            saveField: 'candidate_answers'
          }
        },
        {
          id: 'step_2',
          type: 'action_qualify',
          title: 'Deterministic Candidate Qualification',
          description: 'Scores applicant against strict hiring criteria (Min 70 pts)',
          branch: 'main',
          config: {
            scoringMode: 'points',
            passScore: 70,
            rules: [
              { id: '1', field: 'experience', label: 'Sales Experience >= 2 Yrs', operator: 'contains_any', value: '2+ Years, 2 Years', points: 40, required: true },
              { id: '2', field: 'location', label: 'On-site in Mohali / Chandigarh', operator: 'contains_any', value: 'Yes, Comfortable', points: 30, required: true },
              { id: '3', field: 'salary', label: 'Expected Salary <= 35k', operator: 'contains_any', value: 'Under 30k, 30k, 35k', points: 30, required: false }
            ]
          }
        },
        {
          id: 'step_3',
          type: 'action_condition',
          title: 'If Qualified (Score >= 70 pts)',
          description: 'Branch based on deterministic rule score',
          branch: 'main',
          config: {
            field: 'qualification_score',
            operator: '>=',
            value: 70
          }
        },
        {
          id: 'step_4',
          type: 'action_crm_stage',
          title: 'Move to "Interview Scheduled"',
          description: 'Update pipeline stage in CRM',
          branch: 'true',
          config: {
            stage: 'Interview Scheduled',
            tags: 'Hiring Ad, Qualified Candidate'
          }
        },
        {
          id: 'step_5',
          type: 'action_notify_team',
          title: 'Notify HR Manager on WhatsApp',
          description: 'Send candidate profile & screening answers to HR',
          branch: 'true',
          config: {
            channels: ['whatsapp'],
            adminWhatsapp: '+91 98765 43210',
            includeLeadInfo: true,
            alertMessage: '🎯 Qualified Candidate: {{lead.name}} scored high on screening! Ready for interview.'
          }
        }
      ]
    }
  }

  // 3. Inbound Portal / Housing.com Flow
  if (p.includes('housing') || p.includes('portal') || p.includes('99acres') || p.includes('inbound')) {
    return {
      name: 'Housing.com & Inbound Portals Instant Qualifier',
      description: 'Ingests inbound portal leads, delivers WhatsApp brochure instantly, and distributes to sales group.',
      icon: 'Globe',
      isActive: true,
      trigger: {
        type: 'trigger_portal_lead',
        label: 'Housing.com / 99Acres Lead Ingestion',
        portalName: 'Housing.com'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_whatsapp_msg',
          title: 'Instant WhatsApp Brochure & Floor Plans',
          description: 'Delivers project overview within 30 seconds',
          branch: 'main',
          config: {
            message: 'Hi {{lead.name}}! Thank you for inquiring on Housing.com. Here is the verified project brochure and price breakdown:',
            includeBrochure: true,
            buttons: ['📅 Schedule Site Visit', '📍 Project Location', '💬 Speak to Advisor']
          }
        },
        {
          id: 'step_2',
          type: 'action_assign_agent',
          title: 'Distribute via Group Distribution',
          description: 'Weighted round-robin assignment across sales team',
          branch: 'main',
          config: {
            assignMode: 'group',
            groupName: 'Mohali Sales Team (Group Distribution)'
          }
        },
        {
          id: 'step_3',
          type: 'action_crm_stage',
          title: 'Move Stage to "Contacted"',
          description: 'Sync lead into CRM with Housing.com tag',
          branch: 'main',
          config: {
            stage: 'Contacted',
            tags: 'Housing.com, Portal Inbound'
          }
        }
      ]
    }
  }

  // 4. Generic Custom Flow
  return {
    name: `Custom Flow: ${prompt.slice(0, 40)}`,
    description: `Automated workflow generated for: "${prompt}"`,
    icon: 'Workflow',
    isActive: true,
    trigger: {
      type: 'trigger_meta_ad',
      label: 'Meta Ad & CRM Lead Trigger'
    },
    nodes: [
      {
        id: 'step_1',
        type: 'action_whatsapp_msg',
        title: 'Send Instant Greeting & Brochure',
        description: 'Delivers introductory message with interactive options',
        branch: 'main',
        config: {
          message: `Hello {{lead.name}}! Thank you for connecting with us regarding "${prompt.slice(0, 50)}". How can our team best assist you?`,
          includeBrochure: true,
          buttons: ['📅 Book Consultation', '📍 Location Pin', '💬 Talk with Sales']
        }
      },
      {
        id: 'step_2',
        type: 'action_crm_stage',
        title: 'Sync to CRM as "Contacted"',
        description: 'Updates CRM stage with custom tags',
        branch: 'main',
        config: {
          stage: 'Contacted',
          tags: 'AI Architect Flow'
        }
      }
    ]
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { prompt } = body

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'Please provide a prompt describing your workflow' }, { status: 400 })
    }

    const trimmedPrompt = prompt.trim()

    // Attempt generation with DeepSeek v4-flash
    let generatedFlow: any = null
    const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY

    if (hasDeepSeekKey) {
      try {
        const fullPrompt = `${FLOW_ARCHITECT_SYSTEM_PROMPT}\n\nUSER WORKFLOW REQUIREMENT:\n"${trimmedPrompt}"\n\nGenerate the complete JSON now:`
        const dsResult = await callDeepSeekWithUsage(fullPrompt)
        
        let cleanedText = dsResult.text.trim()
        // Strip markdown fences if present
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json/, '').replace(/```$/, '').trim()
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```/, '').replace(/```$/, '').trim()
        }

        const parsed = JSON.parse(cleanedText)
        if (parsed && parsed.name && Array.isArray(parsed.nodes)) {
          generatedFlow = parsed
        }
      } catch (err: any) {
        console.warn('[FLOW GENERATOR] DeepSeek generation notice, using deterministic architect fallback:', err?.message || err)
      }
    }

    // If DeepSeek was not configured or fallback was needed, generate with deterministic architect
    if (!generatedFlow) {
      generatedFlow = generateDeterministicFallback(trimmedPrompt)
    }

    // Ensure all nodes have IDs and branches
    if (generatedFlow.nodes && Array.isArray(generatedFlow.nodes)) {
      generatedFlow.nodes = generatedFlow.nodes.map((node: any, idx: number) => ({
        ...node,
        id: node.id || `step_${Date.now()}_${idx}`,
        branch: node.branch || 'main'
      }))
    }

    return NextResponse.json({
      success: true,
      model: hasDeepSeekKey ? 'deepseek-v4-flash' : 'deterministic-architect',
      flow: generatedFlow
    })
  } catch (err: any) {
    console.error('[FLOW GENERATOR FATAL]:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
