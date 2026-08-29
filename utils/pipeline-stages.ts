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

export const DEFAULT_PIPELINE_STAGES: PipelineStageConfig[] = [
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
    description: 'Lead contacted and communication initiated'
  },
  {
    id: 'requirement_taken',
    name: 'Requirement Taken',
    category: 'ongoing',
    color: 'indigo',
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-800',
    enableCapi: false,
    capiEventName: 'Contact',
    description: 'Customer contacted and preferences recorded'
  },
  {
    id: 'visit_planned',
    name: 'Visit Planned',
    category: 'ongoing',
    color: 'purple',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-800',
    enableCapi: true,
    capiEventName: 'Schedule',
    description: 'Site visit or property viewing scheduled'
  },
  {
    id: 'visit_done',
    name: 'Visit Done',
    category: 'ongoing',
    color: 'emerald',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    enableCapi: true,
    capiEventName: 'Visit Done',
    description: 'Customer completed physical site visit'
  },
  {
    id: 'revisit_done',
    name: 'Revisit Done',
    category: 'ongoing',
    color: 'teal',
    badgeBg: 'bg-teal-100',
    badgeText: 'text-teal-800',
    enableCapi: false,
    capiEventName: 'Revisit Done',
    description: 'Customer completed second / follow-up visit'
  },
  {
    id: 'meeting_planned',
    name: 'Meeting Planned',
    category: 'ongoing',
    color: 'cyan',
    badgeBg: 'bg-cyan-100',
    badgeText: 'text-cyan-800',
    enableCapi: true,
    capiEventName: 'Schedule',
    description: 'Face-to-face or virtual meeting planned'
  },
  {
    id: 'meeting_done',
    name: 'Meeting Done',
    category: 'ongoing',
    color: 'sky',
    badgeBg: 'bg-sky-100',
    badgeText: 'text-sky-800',
    enableCapi: false,
    capiEventName: 'Meeting Done',
    description: 'Meeting completed successfully'
  },
  {
    id: 'never_picked',
    name: 'Never Picked',
    category: 'ongoing',
    color: 'amber',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-800',
    enableCapi: false,
    capiEventName: 'Never Picked',
    description: 'Calls unanswered / queued for retry'
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
    description: 'Pricing, discount or inventory negotiation'
  },
  {
    id: 'deal_token',
    name: 'Deal/Token',
    category: 'ongoing',
    color: 'emerald',
    badgeBg: 'bg-emerald-200',
    badgeText: 'text-emerald-900',
    enableCapi: true,
    capiEventName: 'Purchase',
    description: 'Booking amount / token paid or deal closed'
  },
  {
    id: 'dealer',
    name: 'Dealer',
    category: 'not_interested',
    color: 'slate',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-800',
    enableCapi: false,
    capiEventName: 'Dealer',
    description: 'Broker / channel partner / agent lead'
  },
  {
    id: 'plan_postponed',
    name: 'Plan Postponed',
    category: 'not_interested',
    color: 'slate',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    enableCapi: false,
    capiEventName: 'Plan Postponed',
    description: 'Client postponed purchase decision'
  },
  {
    id: 'already_purchased',
    name: 'Already Purchased',
    category: 'not_interested',
    color: 'slate',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    enableCapi: false,
    capiEventName: 'Already Purchased',
    description: 'Client already purchased elsewhere'
  },
  {
    id: 'lost_ni',
    name: 'Lost/NI',
    category: 'not_interested',
    color: 'rose',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-800',
    enableCapi: false,
    capiEventName: 'Lost/NI',
    description: 'Not interested / lost lead'
  }
]

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

  // 3. Check for Not Interested / Lost heuristic
  if (
    normalized.includes('lost') ||
    normalized.includes('ni') ||
    normalized.includes('not interested') ||
    normalized.includes('not_interested') ||
    normalized.includes('junk') ||
    normalized.includes('unqualified') ||
    normalized.includes('dealer') ||
    normalized.includes('postponed') ||
    normalized.includes('already purchased') ||
    normalized.includes('different requirement') ||
    normalized.includes('wrong number') ||
    normalized.includes('fake')
  ) {
    return 'not_interested'
  }

  // 4. Check for Fresh (New Lead, Fresh, New, Unprocessed, Uncontacted)
  if (
    normalized === 'new' ||
    normalized === 'new lead' ||
    normalized === 'unprocessed' ||
    normalized === 'fresh' ||
    normalized === 'fresh lead' ||
    normalized === 'uncontacted'
  ) {
    return hasDnpOrActiveFollowup ? 'ongoing' : 'fresh'
  }

  // 5. Default to Ongoing for any other stage (Requirement Taken, Visit Planned, Meeting Done, etc.)
  return 'ongoing'
}

/**
 * Helper to get clean display badge styles for any stage
 */
export function getStageBadgeStyle(stageName?: string | null, customStages: PipelineStageConfig[] = DEFAULT_PIPELINE_STAGES) {
  if (!stageName) return { badgeBg: 'bg-blue-100', badgeText: 'text-blue-800' }
  const normalized = stageName.trim().toLowerCase()
  const matched = customStages.find(s => s.name.trim().toLowerCase() === normalized)
  if (matched?.badgeBg && matched?.badgeText) {
    return { badgeBg: matched.badgeBg, badgeText: matched.badgeText }
  }

  const category = categorizeLeadStage(stageName, customStages)
  if (category === 'fresh') return { badgeBg: 'bg-blue-100', badgeText: 'text-blue-800' }
  if (category === 'not_interested') return { badgeBg: 'bg-rose-100', badgeText: 'text-rose-800' }
  if (category === 'trash') return { badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' }
  return { badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-800' }
}

/**
 * Extract configured stages from a Supabase profile record.
 * Merges custom pipeline stages with DEFAULT_PIPELINE_STAGES so standard stages are never lost.
 */
export function extractStagesFromProfile(profile?: any): PipelineStageConfig[] {
  if (!profile) return DEFAULT_PIPELINE_STAGES

  let loadedStages: PipelineStageConfig[] | null = null

  if (profile.custom_pipeline_stages && Array.isArray(profile.custom_pipeline_stages) && profile.custom_pipeline_stages.length > 0) {
    loadedStages = profile.custom_pipeline_stages
  } else if (profile.badges && Array.isArray(profile.badges)) {
    const stageBadge = profile.badges.find((b: string) => typeof b === 'string' && b.startsWith('__PIPELINE_STAGES__:'))
    if (stageBadge) {
      try {
        const jsonStr = stageBadge.replace('__PIPELINE_STAGES__:', '')
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed) && parsed.length > 0) {
          loadedStages = parsed
        }
      } catch (e) {
        console.error('[extractStagesFromProfile] Failed to parse stages from badges:', e)
      }
    }
  }

  if (!loadedStages || loadedStages.length === 0) {
    return DEFAULT_PIPELINE_STAGES
  }

  // Merge loaded stages with default stages to ensure standard categories (fresh, ongoing, not_interested) are always available
  const stageMap = new Map<string, PipelineStageConfig>()
  
  // Add defaults first
  DEFAULT_PIPELINE_STAGES.forEach(s => stageMap.set(s.name.toLowerCase().trim(), s))
  
  // Override or add custom stages
  loadedStages.forEach(s => {
    if (s && s.name) {
      stageMap.set(s.name.toLowerCase().trim(), s)
    }
  })

  return Array.from(stageMap.values())
}

/**
 * Encode pipeline stages into badges array
 */
export function encodeStagesToBadges(currentBadges: string[] | null | undefined, stages: PipelineStageConfig[]): string[] {
  const existing = Array.isArray(currentBadges) ? currentBadges.filter(b => typeof b === 'string' && !b.startsWith('__PIPELINE_STAGES__:')) : []
  const newBadge = `__PIPELINE_STAGES__:${JSON.stringify(stages)}`
  return [...existing, newBadge]
}


