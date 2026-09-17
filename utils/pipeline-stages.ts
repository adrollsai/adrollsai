export interface PipelineStageConfig {
  id: string
  name: string
  category: 'fresh' | 'ongoing' | 'not_interested' | 'trash'
  color?: string
  badgeBg?: string
  badgeText?: string
  enableCapi?: boolean
  capiEventName?: string
  isCustom?: boolean
  description?: string
}

/**
 * Universal default pipeline stages (Industry-agnostic for any business, agency, or service).
 */
export const UNIVERSAL_STAGES: PipelineStageConfig[] = [
  {
    id: 'new_lead',
    name: 'New Lead',
    category: 'fresh',
    color: 'blue',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-800',
    enableCapi: false,
    capiEventName: 'Lead',
    description: 'Incoming unprocessed fresh leads'
  },
  {
    id: 'contacted',
    name: 'Contacted',
    category: 'ongoing',
    color: 'sky',
    badgeBg: 'bg-sky-100',
    badgeText: 'text-sky-800',
    enableCapi: false,
    capiEventName: 'Contact',
    description: 'Initial outreach or call completed'
  },
  {
    id: 'qualified',
    name: 'Qualified',
    category: 'ongoing',
    color: 'indigo',
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-800',
    enableCapi: false,
    capiEventName: 'Contact',
    description: 'Requirements captured and budget verified'
  },
  {
    id: 'meeting_scheduled',
    name: 'Meeting Scheduled',
    category: 'ongoing',
    color: 'purple',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-800',
    enableCapi: true,
    capiEventName: 'Schedule',
    description: 'Consultation or demo appointment booked'
  },
  {
    id: 'meeting_done',
    name: 'Meeting Done',
    category: 'ongoing',
    color: 'emerald',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    enableCapi: true,
    capiEventName: 'Contact',
    description: 'Meeting or consultation successfully completed'
  },
  {
    id: 'proposal_sent',
    name: 'Proposal Sent',
    category: 'ongoing',
    color: 'amber',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-800',
    enableCapi: true,
    capiEventName: 'InitiateCheckout',
    description: 'Commercial quote or formal proposal submitted'
  },
  {
    id: 'negotiation',
    name: 'Negotiation',
    category: 'ongoing',
    color: 'orange',
    badgeBg: 'bg-orange-100',
    badgeText: 'text-orange-800',
    enableCapi: true,
    capiEventName: 'InitiateCheckout',
    description: 'Terms, deliverables, or pricing under discussion'
  },
  {
    id: 'deal_won',
    name: 'Deal Won',
    category: 'ongoing',
    color: 'emerald',
    badgeBg: 'bg-emerald-200',
    badgeText: 'text-emerald-900',
    enableCapi: true,
    capiEventName: 'Purchase',
    description: 'Customer agreement signed or payment received'
  },
  {
    id: 'follow_up_later',
    name: 'Follow Up Later',
    category: 'ongoing',
    color: 'teal',
    badgeBg: 'bg-teal-100',
    badgeText: 'text-teal-800',
    enableCapi: false,
    capiEventName: 'Contact',
    description: 'Decision pending future timeline or reminder set'
  },
  {
    id: 'unresponsive',
    name: 'Unresponsive',
    category: 'not_interested',
    color: 'slate',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    enableCapi: false,
    capiEventName: 'Contact',
    description: 'Multiple unanswered call/message attempts'
  },
  {
    id: 'lost_disqualified',
    name: 'Lost / Disqualified',
    category: 'not_interested',
    color: 'rose',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-800',
    enableCapi: false,
    capiEventName: 'Contact',
    description: 'Lead disqualified, not interested, or budget mismatch'
  }
]

/**
 * Opt-in Real Estate Industry Preset
 */
export const REAL_ESTATE_STAGES: PipelineStageConfig[] = [
  { id: 'new_lead', name: 'New Lead', category: 'fresh', color: 'blue', badgeBg: 'bg-blue-100', badgeText: 'text-blue-800', enableCapi: false, capiEventName: 'Lead' },
  { id: 'contacted', name: 'Contacted', category: 'ongoing', color: 'sky', badgeBg: 'bg-sky-100', badgeText: 'text-sky-800', enableCapi: false, capiEventName: 'Contact' },
  { id: 'requirement_taken', name: 'Requirement Taken', category: 'ongoing', color: 'indigo', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-800', enableCapi: false, capiEventName: 'Contact' },
  { id: 'visit_planned', name: 'Site Visit Planned', category: 'ongoing', color: 'purple', badgeBg: 'bg-purple-100', badgeText: 'text-purple-800', enableCapi: true, capiEventName: 'Schedule' },
  { id: 'visit_done', name: 'Site Visit Done', category: 'ongoing', color: 'emerald', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800', enableCapi: true, capiEventName: 'Contact' },
  { id: 'revisit_done', name: 'Revisit Done', category: 'ongoing', color: 'teal', badgeBg: 'bg-teal-100', badgeText: 'text-teal-800', enableCapi: false, capiEventName: 'Contact' },
  { id: 'negotiation', name: 'Negotiation', category: 'ongoing', color: 'orange', badgeBg: 'bg-orange-100', badgeText: 'text-orange-800', enableCapi: true, capiEventName: 'InitiateCheckout' },
  { id: 'deal_token', name: 'Deal / Token Paid', category: 'ongoing', color: 'emerald', badgeBg: 'bg-emerald-200', badgeText: 'text-emerald-900', enableCapi: true, capiEventName: 'Purchase' },
  { id: 'broker_channel_partner', name: 'Channel Partner / Broker', category: 'not_interested', color: 'slate', badgeBg: 'bg-slate-100', badgeText: 'text-slate-800', enableCapi: false },
  { id: 'lost_ni', name: 'Lost / Not Interested', category: 'not_interested', color: 'rose', badgeBg: 'bg-rose-100', badgeText: 'text-rose-800', enableCapi: false }
]

/**
 * Opt-in Healthcare & Clinical Clinic Industry Preset
 */
export const HEALTHCARE_STAGES: PipelineStageConfig[] = [
  { id: 'new_inquiry', name: 'New Patient Inquiry', category: 'fresh', color: 'blue', badgeBg: 'bg-blue-100', badgeText: 'text-blue-800', enableCapi: false, capiEventName: 'Lead' },
  { id: 'consultation_scheduled', name: 'Consultation Booked', category: 'ongoing', color: 'purple', badgeBg: 'bg-purple-100', badgeText: 'text-purple-800', enableCapi: true, capiEventName: 'Schedule' },
  { id: 'consultation_completed', name: 'Consultation Completed', category: 'ongoing', color: 'emerald', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800', enableCapi: true, capiEventName: 'Contact' },
  { id: 'treatment_proposed', name: 'Treatment Plan Proposed', category: 'ongoing', color: 'indigo', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-800', enableCapi: true, capiEventName: 'InitiateCheckout' },
  { id: 'treatment_started', name: 'Treatment In Progress', category: 'ongoing', color: 'teal', badgeBg: 'bg-teal-100', badgeText: 'text-teal-800', enableCapi: true, capiEventName: 'Purchase' },
  { id: 'no_show', name: 'No Show / Rescheduled', category: 'ongoing', color: 'amber', badgeBg: 'bg-amber-100', badgeText: 'text-amber-800', enableCapi: false },
  { id: 'discharged_lost', name: 'Declined / Out of Scope', category: 'not_interested', color: 'rose', badgeBg: 'bg-rose-100', badgeText: 'text-rose-800', enableCapi: false }
]

/**
 * Opt-in Automotive & Dealership Industry Preset
 */
export const AUTOMOTIVE_STAGES: PipelineStageConfig[] = [
  { id: 'new_lead', name: 'New Vehicle Inquiry', category: 'fresh', color: 'blue', badgeBg: 'bg-blue-100', badgeText: 'text-blue-800', enableCapi: false, capiEventName: 'Lead' },
  { id: 'contacted', name: 'Buyer Contacted', category: 'ongoing', color: 'sky', badgeBg: 'bg-sky-100', badgeText: 'text-sky-800', enableCapi: false, capiEventName: 'Contact' },
  { id: 'test_drive_booked', name: 'Test Drive Scheduled', category: 'ongoing', color: 'purple', badgeBg: 'bg-purple-100', badgeText: 'text-purple-800', enableCapi: true, capiEventName: 'Schedule' },
  { id: 'test_drive_done', name: 'Test Drive Completed', category: 'ongoing', color: 'emerald', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800', enableCapi: true, capiEventName: 'Contact' },
  { id: 'finance_discussion', name: 'Finance / Loan Application', category: 'ongoing', color: 'indigo', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-800', enableCapi: true, capiEventName: 'InitiateCheckout' },
  { id: 'booking_deposit', name: 'Booking Deposit Paid', category: 'ongoing', color: 'emerald', badgeBg: 'bg-emerald-200', badgeText: 'text-emerald-900', enableCapi: true, capiEventName: 'Purchase' },
  { id: 'delivered', name: 'Vehicle Delivered', category: 'ongoing', color: 'teal', badgeBg: 'bg-teal-100', badgeText: 'text-teal-800', enableCapi: true, capiEventName: 'Purchase' },
  { id: 'lost_sale', name: 'Lost Sale / Bought Other Model', category: 'not_interested', color: 'rose', badgeBg: 'bg-rose-100', badgeText: 'text-rose-800', enableCapi: false }
]

/**
 * Industry pipeline presets collection for 1-click loading.
 */
export const INDUSTRY_PIPELINE_PRESETS: Record<string, { label: string; icon: string; description: string; stages: PipelineStageConfig[] }> = {
  universal: {
    label: 'Universal Business',
    icon: '💼',
    description: 'Standard B2B / B2C sales pipeline for agencies, consultancies, services, and software.',
    stages: UNIVERSAL_STAGES
  },
  real_estate: {
    label: 'Real Estate & Properties',
    icon: '🏢',
    description: 'Designed for property developers, brokers, and realtors with site visit tracking.',
    stages: REAL_ESTATE_STAGES
  },
  healthcare: {
    label: 'Healthcare & Clinics',
    icon: '🩺',
    description: 'Patient consultation, appointment, and clinical treatment plan workflows.',
    stages: HEALTHCARE_STAGES
  },
  automotive: {
    label: 'Automotive & Dealerships',
    icon: '🚗',
    description: 'Showrooms, test drives, finance approval, and vehicle delivery tracking.',
    stages: AUTOMOTIVE_STAGES
  }
}

/**
 * Default pipeline stages out-of-the-box (generic).
 */
export const DEFAULT_PIPELINE_STAGES: PipelineStageConfig[] = UNIVERSAL_STAGES

export const STANDARD_STAGE_NAMES = DEFAULT_PIPELINE_STAGES.map(s => s.name)

/**
 * Categorize any raw lead stage/status or lead record into one of the 4 main buckets:
 * 'fresh' | 'ongoing' | 'not_interested' | 'trash'
 */
export function categorizeLeadStage(
  rawStageOrLead?: any,
  customStages: PipelineStageConfig[] = DEFAULT_PIPELINE_STAGES
): 'fresh' | 'ongoing' | 'not_interested' | 'trash' {
  if (!rawStageOrLead) return 'fresh'

  let stageStr = ''
  let cf: any = null
  let hasDnpOrActiveFollowup = false

  if (typeof rawStageOrLead === 'object' && rawStageOrLead !== null) {
    stageStr = (rawStageOrLead.pipeline_stage || rawStageOrLead.status || '').trim()
    cf = rawStageOrLead.custom_fields
    if (typeof cf === 'string') {
      try { while (typeof cf === 'string') cf = JSON.parse(cf) } catch (e) { cf = null }
    }
    if (!stageStr && cf) {
      stageStr = (cf.pipeline_stage || cf.status || cf.lead_status || cf.client_status || '').trim()
    }

    const dnpCount = rawStageOrLead.dnp_count || cf?.dnp_count || 0
    const isDnp = rawStageOrLead.last_call_dnp === true || cf?.last_call_dnp === true
    const hasNextFollowup = !!rawStageOrLead.next_followup || !!cf?.next_action_date

    if (dnpCount > 0 || isDnp || hasNextFollowup) {
      hasDnpOrActiveFollowup = true
    }
  } else if (typeof rawStageOrLead === 'string') {
    stageStr = rawStageOrLead.trim()
  }

  if (!stageStr) return 'fresh'
  const normalized = stageStr.toLowerCase()

  // 1. Check for Trash
  if (normalized === 'trash' || normalized === 'deleted' || normalized === 'archived') {
    return 'trash'
  }

  // 2. Match against configured customStages
  if (Array.isArray(customStages) && customStages.length > 0) {
    const matched = customStages.find(s => s.name.trim().toLowerCase() === normalized || s.id.toLowerCase() === normalized)
    if (matched) {
      if (matched.category === 'fresh') {
        return hasDnpOrActiveFollowup ? 'ongoing' : 'fresh'
      }
      return matched.category
    }
  }

  // 3. Check for Not Interested / Lost heuristic (including legacy terms)
  if (
    normalized.includes('lost') ||
    normalized.includes('ni') ||
    normalized.includes('not interested') ||
    normalized.includes('not_interested') ||
    normalized.includes('junk') ||
    normalized.includes('unqualified') ||
    normalized.includes('disqualified') ||
    normalized.includes('dealer') ||
    normalized.includes('broker') ||
    normalized.includes('postponed') ||
    normalized.includes('already purchased') ||
    normalized.includes('different requirement') ||
    normalized.includes('wrong number') ||
    normalized.includes('fake') ||
    normalized.includes('unresponsive')
  ) {
    return 'not_interested'
  }

  // 4. Check for Fresh (New Lead, Fresh, New, Unprocessed, Uncontacted)
  if (
    normalized === 'new' ||
    normalized === 'new lead' ||
    normalized === 'new inquiry' ||
    normalized === 'unprocessed' ||
    normalized === 'uncontacted' ||
    normalized === 'fresh'
  ) {
    return hasDnpOrActiveFollowup ? 'ongoing' : 'fresh'
  }

  // 5. Default fallback to ongoing (contacted, meeting, visit, qualified, proposal, deal, negotiation)
  return 'ongoing'
}

/**
 * Extracts custom pipeline stages from profile, falling back to badges or DEFAULT_PIPELINE_STAGES.
 */
export function extractStagesFromProfile(profile: any): PipelineStageConfig[] {
  if (!profile) return DEFAULT_PIPELINE_STAGES

  if (Array.isArray(profile.custom_pipeline_stages) && profile.custom_pipeline_stages.length > 0) {
    return profile.custom_pipeline_stages
  }

  if (Array.isArray(profile.badges)) {
    const stageBadge = profile.badges.find((b: any) => typeof b === 'string' && b.startsWith('__PIPELINE_STAGES__:'))
    if (stageBadge) {
      try {
        const parsed = JSON.parse(stageBadge.replace('__PIPELINE_STAGES__:', ''))
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      } catch (err) {
        console.warn('[pipeline-stages] Failed to parse stages from badge:', err)
      }
    }
  }

  return DEFAULT_PIPELINE_STAGES
}

/**
 * Encodes pipeline stages into badges array with prefix __PIPELINE_STAGES__:.
 */
export function encodeStagesToBadges(existingBadges: any, stages: PipelineStageConfig[]): string[] {
  const safeBadges: string[] = Array.isArray(existingBadges)
    ? existingBadges.filter((b: any) => typeof b === 'string' && !b.startsWith('__PIPELINE_STAGES__:'))
    : []

  safeBadges.push('__PIPELINE_STAGES__:' + JSON.stringify(stages))
  return safeBadges
}

