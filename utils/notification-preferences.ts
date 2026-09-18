import { createClient } from '@supabase/supabase-js'

export type NotificationChannel = 'push' | 'email' | 'whatsapp'

export type NotificationTypeKey =
  | 'fresh_lead'         // Fresh Lead Alert (Meta ads, 99acres, Housing, landing page)
  | 'lead_assigned'       // Lead Assigned or Transferred to agent
  | 'meeting_booked'      // Site visit, call, or appointment booked
  | 'expert_escalation'  // Hot lead, expert assistance needed, callback request
  | 'crm_reminder'        // Follow-up reminders, task due alarms
  | 'system_update'       // EOD report, broadcast completed, system announcements

export interface NotificationChannelSetting {
  push: boolean
  email: boolean
  whatsapp: boolean
}

export interface UserNotificationPreferences {
  fresh_lead: NotificationChannelSetting
  lead_assigned: NotificationChannelSetting
  meeting_booked: NotificationChannelSetting
  expert_escalation: NotificationChannelSetting
  crm_reminder: NotificationChannelSetting
  system_update: NotificationChannelSetting
}

export const NOTIFICATION_CATEGORIES: {
  key: NotificationTypeKey
  title: string
  description: string
  iconName: string
  badgeText: string
  accentColor: string
}[] = [
  {
    key: 'fresh_lead',
    title: 'Fresh Lead Alerts',
    description: 'Triggered when a brand-new lead arrives from Meta Ads, Landing Pages, 99acres, or Housing.com.',
    iconName: 'UserPlus',
    badgeText: 'New Lead',
    accentColor: 'blue'
  },
  {
    key: 'lead_assigned',
    title: 'Lead Assignments & Transfers',
    description: 'Triggered when a lead is assigned or transferred to you or a team member.',
    iconName: 'UserCheck',
    badgeText: 'Assignment',
    accentColor: 'indigo'
  },
  {
    key: 'meeting_booked',
    title: 'Site Visits & Meeting Bookings',
    description: 'Triggered when a prospect books a property visit, callback, or calendar appointment.',
    iconName: 'CalendarCheck',
    badgeText: 'Booking',
    accentColor: 'emerald'
  },
  {
    key: 'expert_escalation',
    title: 'Hot Leads & Expert Escalations',
    description: 'Triggered when an AI phone call or chat detects high interest, urgent questions, or expert request.',
    iconName: 'Flame',
    badgeText: 'Hot Priority',
    accentColor: 'rose'
  },
  {
    key: 'crm_reminder',
    title: 'Follow-up & Task Reminders',
    description: 'Scheduled CRM follow-up alarms, pending lead notifications, and daily task alerts.',
    iconName: 'Clock',
    badgeText: 'Reminders',
    accentColor: 'amber'
  },
  {
    key: 'system_update',
    title: 'System & Campaign Reports',
    description: 'EOD operational reports, WhatsApp broadcast completions, and AI video rendering updates.',
    iconName: 'Sparkles',
    badgeText: 'Reports',
    accentColor: 'purple'
  }
]

export const DEFAULT_ADMIN_PREFERENCES: UserNotificationPreferences = {
  fresh_lead: { push: true, email: true, whatsapp: true },
  lead_assigned: { push: true, email: false, whatsapp: false },
  meeting_booked: { push: true, email: true, whatsapp: true },
  expert_escalation: { push: true, email: true, whatsapp: true },
  crm_reminder: { push: true, email: false, whatsapp: false },
  system_update: { push: true, email: false, whatsapp: false }
}

export const DEFAULT_AGENT_PREFERENCES: UserNotificationPreferences = {
  fresh_lead: { push: true, email: false, whatsapp: false },
  lead_assigned: { push: true, email: true, whatsapp: false },
  meeting_booked: { push: true, email: true, whatsapp: false },
  expert_escalation: { push: true, email: true, whatsapp: false },
  crm_reminder: { push: true, email: false, whatsapp: false },
  system_update: { push: true, email: false, whatsapp: false }
}

export function isUserAdminRole(role?: string | null): boolean {
  if (!role) return false
  const clean = role.toLowerCase().trim()
  return clean === 'admin' || clean === 'super_admin' || clean === 'agency'
}

export function getDefaultPreferences(isAdmin: boolean): UserNotificationPreferences {
  return JSON.parse(JSON.stringify(isAdmin ? DEFAULT_ADMIN_PREFERENCES : DEFAULT_AGENT_PREFERENCES))
}

/**
 * Normalizes user preferences by merging with default settings and enforcing role constraints
 */
export function normalizeUserPreferences(
  rawPreferences: any,
  isAdmin: boolean
): UserNotificationPreferences {
  const defaults = getDefaultPreferences(isAdmin)
  if (!rawPreferences || typeof rawPreferences !== 'object') {
    return defaults
  }

  const result: any = {}
  const keys: NotificationTypeKey[] = [
    'fresh_lead',
    'lead_assigned',
    'meeting_booked',
    'expert_escalation',
    'crm_reminder',
    'system_update'
  ]

  for (const key of keys) {
    const defaultSetting = defaults[key]
    const userSetting = rawPreferences[key] || {}

    result[key] = {
      push: typeof userSetting.push === 'boolean' ? userSetting.push : defaultSetting.push,
      email: typeof userSetting.email === 'boolean' ? userSetting.email : defaultSetting.email,
      // If user is not admin, whatsapp is strictly false at all times!
      whatsapp: isAdmin ? (typeof userSetting.whatsapp === 'boolean' ? userSetting.whatsapp : defaultSetting.whatsapp) : false
    }
  }

  return result as UserNotificationPreferences
}

/**
 * Maps raw notification event type and title to the unified preference category
 */
export function mapEventTypeToKey(type: string = '', title: string = ''): NotificationTypeKey {
  const t = (type || '').toLowerCase()
  const s = (title || '').toLowerCase()

  // 1. Fresh / New Lead
  if (
    t === 'fresh_lead' ||
    t === 'new_lead' ||
    t === 'lead_event' ||
    t === 'custom_lead' ||
    /new.*lead|fresh.*lead|inquiry/i.test(s)
  ) {
    return 'fresh_lead'
  }

  // 2. Lead Assigned / Transferred
  if (
    t.includes('assign') ||
    t.includes('transfer') ||
    /assigned|transferred/i.test(s)
  ) {
    return 'lead_assigned'
  }

  // 3. Meeting / Appointment Booked
  if (
    t.includes('meeting') ||
    t.includes('booking') ||
    t.includes('appointment') ||
    /booking|meeting|appointment|site visit/i.test(s)
  ) {
    return 'meeting_booked'
  }

  // 4. Hot Lead / Expert Escalation
  if (
    t.includes('expert') ||
    t.includes('escalat') ||
    t.includes('hot_lead') ||
    t.includes('interested') ||
    /expert|callback|urgent|hot lead|interested/i.test(s)
  ) {
    return 'expert_escalation'
  }

  // 5. Reminders / Followups
  if (
    t.includes('reminder') ||
    t.includes('followup') ||
    /reminder|follow-up|followup|alarm|⏰/i.test(s)
  ) {
    return 'crm_reminder'
  }

  // 6. System Updates
  return 'system_update'
}

let _supabaseAdminInstance: any = null
function getSupabaseAdmin() {
  if (!_supabaseAdminInstance) {
    _supabaseAdminInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _supabaseAdminInstance
}

/**
 * Fetches user notification preferences and admin status from profiles table
 */
export async function getUserNotificationPreferences(userId: string): Promise<{
  isAdmin: boolean
  preferences: UserNotificationPreferences
  profile: any
}> {
  try {
    const supabase = getSupabaseAdmin()
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, email, whatsapp_personal_number, contact_number, whatsapp_phone_number, notification_preferences')
      .eq('id', userId)
      .maybeSingle()

    const isAdmin = isUserAdminRole(profile?.role)
    const preferences = normalizeUserPreferences(profile?.notification_preferences, isAdmin)

    return { isAdmin, preferences, profile }
  } catch (err: any) {
    console.error('[getUserNotificationPreferences Error]:', err)
    return {
      isAdmin: false,
      preferences: DEFAULT_AGENT_PREFERENCES,
      profile: null
    }
  }
}
