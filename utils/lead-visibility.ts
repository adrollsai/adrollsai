/**
 * Lead history & pending-action visibility.
 *
 * Product rule (this is the whole reason this module exists):
 *
 *   1. Lead history is **never deleted**. Not on transfer, not ever.
 *   2. When a lead is transferred, the sender may choose to hide the previous
 *      history from the receiving teammate. That is a *visibility cutoff*, not a
 *      deletion: a `history_visible_from` timestamp is stamped on the lead and
 *      anything older than it is hidden **from non-admin viewers only**.
 *   3. Admins (`super_admin`, `agency`, `admin`) always see the complete
 *      history, including everything before the cutoff.
 *   4. The lead **source** (where the lead came from — Meta form, ad, campaign,
 *      CSV import, manual entry) is always visible to everyone, even when the
 *      rest of the history is hidden. An agent must always be able to see what
 *      the lead is and where it came from in order to work it.
 *   5. Pending / scheduled actions (next follow-up, booked time, next action
 *      notes) follow the same rule via `pending_actions_hidden`: hidden from the
 *      receiving teammate, always visible to admins, and never destroyed.
 *
 * Every surface that renders history (list "last remark", lead detail timeline,
 * history modal) must use these helpers so the three of them cannot disagree.
 */

/** Roles that always see everything. Mirrors `LeadHistoryModal`'s long-standing definition. */
const ADMIN_ROLES = new Set(['super_admin', 'agency', 'admin'])

/** Roles that are restricted by the transfer cutoff. */
const RESTRICTED_ROLES = new Set(['agent', 'team_member'])

export function isLeadAdminViewer(role?: string | null): boolean {
  return ADMIN_ROLES.has(String(role || '').toLowerCase())
}

/**
 * True when this viewer must not see history recorded before the transfer cutoff.
 *
 * Explicitly *not* restricted: admin/agency/super_admin (always full access).
 * `client` sub-accounts are treated like admins here — they own the workspace
 * data and the CRM has never hidden history from them.
 */
export function isHistoryRestrictedForViewer(role?: string | null): boolean {
  const r = String(role || '').toLowerCase()
  if (ADMIN_ROLES.has(r)) return false
  if (r === 'client') return false
  if (RESTRICTED_ROLES.has(r)) return true
  // Unknown/empty role: behave like the safer default used across the CRM.
  return false
}

/** The visibility cutoff stamped on a lead at transfer time, in epoch ms (or null). */
export function getHistoryCutoffMs(lead: any): number | null {
  const cf = parseCustomFields(lead?.custom_fields)
  const raw = cf?.history_visible_from
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * History entries that must stay visible regardless of the cutoff:
 * where the lead came from, and the fact that it was created/reopened.
 */
export function isAlwaysVisibleHistoryItem(item: any): boolean {
  const type = String(item?.action_type || '').toUpperCase()
  if (type === 'LEAD_CREATED' || type === 'REOPENED' || type === 'SYSTEM' || type === 'TRANSFER') return true
  if (item?.id === 'foundational_lead_created') return true

  const desc = typeof item?.description === 'string' ? item.description : ''
  if (!desc) return false
  return (
    desc.includes('Lead Source :') ||
    desc.includes('Source Details :') ||
    desc.includes('Facebook Ad Submission') ||
    /^\s*source\b/i.test(desc)
  )
}

/** True when this specific history entry must be hidden from this viewer. */
export function isHistoryItemHidden(item: any, lead: any, role?: string | null): boolean {
  if (!isHistoryRestrictedForViewer(role)) return false
  const cutoff = getHistoryCutoffMs(lead)
  if (cutoff === null) return false
  if (isAlwaysVisibleHistoryItem(item)) return false
  const at = item?.created_at ? new Date(item.created_at).getTime() : NaN
  // Entries with no usable timestamp are kept rather than silently dropped.
  if (Number.isNaN(at)) return false
  return at < cutoff
}

/** Filter a history list for a viewer. Order is preserved. */
export function filterHistoryForViewer<T>(items: T[], lead: any, role?: string | null): T[] {
  if (!isHistoryRestrictedForViewer(role)) return items
  const cutoff = getHistoryCutoffMs(lead)
  if (cutoff === null) return items
  return items.filter(item => !isHistoryItemHidden(item, lead, role))
}

/**
 * Pending / scheduled actions hidden from the receiving teammate.
 * Data is kept intact on the lead; only the presentation is suppressed.
 */
export function arePendingActionsHiddenFromViewer(lead: any, role?: string | null): boolean {
  if (!isHistoryRestrictedForViewer(role)) return false
  const cf = parseCustomFields(lead?.custom_fields)
  return cf?.pending_actions_hidden === true
}

/** The lead's next scheduled action, or null when it is hidden from this viewer. */
export function getVisibleNextAction(lead: any, role?: string | null) {
  if (!lead) return null
  if (arePendingActionsHiddenFromViewer(lead, role)) return null
  const cf = parseCustomFields(lead?.custom_fields)
  return {
    date: lead.next_followup || cf?.next_action_date || lead.next_action_date || null,
    type: lead.next_action_type || cf?.next_action_type || cf?.last_followup_type || 'Call',
    remarks:
      lead.next_action_remarks ||
      cf?.next_remarks ||
      cf?.next_action_remark ||
      cf?.next_action_remarks ||
      lead.last_followup_remark ||
      null,
  }
}

/** `custom_fields` is a jsonb column that is sometimes stored as a JSON string. */
export function parseCustomFields(raw: any): any {
  let cf = raw
  let guard = 0
  while (typeof cf === 'string' && guard < 5) {
    try {
      cf = JSON.parse(cf)
    } catch {
      return {}
    }
    guard++
  }
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return {}
  return cf
}
