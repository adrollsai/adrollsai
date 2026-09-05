'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, History, Clock, User, Phone, MessageSquare, AlertCircle, RefreshCw, FileText, ExternalLink, Package } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import LeadScoreBadge from '@/components/LeadScoreBadge'
import { getLeadFollowupCount } from '@/utils/lead-helpers'

interface LeadHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  lead: any
  viewerRole?: string
  teamMembers?: any[]
}

// Module-level caches for instantaneous rendering
const globalProfilesCache = new Map<string, string>()
const leadHistoryCache = new Map<string, { items: any[]; timestamp: number }>()

export default function LeadHistoryModal({ isOpen, onClose, lead, viewerRole, teamMembers }: LeadHistoryModalProps) {
  const router = useRouter()
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const [profilesMap, setProfilesMap] = useState<Map<string, string>>(new Map(globalProfilesCache))

  // Ingest teamMembers into profile cache immediately
  useEffect(() => {
    if (teamMembers && Array.isArray(teamMembers) && teamMembers.length > 0) {
      teamMembers.forEach(m => {
        const name = m.name || m.full_name || m.business_name || (m.email ? m.email.split('@')[0] : '')
        if (m.id && name) {
          globalProfilesCache.set(m.id, name)
        }
      })
      setProfilesMap(new Map(globalProfilesCache))
    }
  }, [teamMembers])

  useEffect(() => {
    if (isOpen && lead?.id) {
      // Check cache for instant display
      const cached = leadHistoryCache.get(lead.id)
      if (cached && cached.items && cached.items.length > 2 && (Date.now() - cached.timestamp < 30000)) {
        setHistoryItems(cached.items)
        setLoading(false)
        // Background refresh only if cache is older than 20 seconds
        if (Date.now() - cached.timestamp > 20000) {
          fetchHistory(true)
        }
      } else {
        fetchHistory(false)
      }
    }
  }, [isOpen, lead?.id])

  const fetchHistory = async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) setLoading(true)
    try {
      const { data, error: histErr } = await supabase
        .from('lead_history')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(100)
      
      if (histErr) {
        console.error("Failed to query lead_history:", histErr)
      }

      let items: any[] = data ? [...data] : []

      // Admin / Agency / Super Admin role retains 100% full history access
      const isAdmin = viewerRole === 'super_admin' || viewerRole === 'agency' || viewerRole === 'admin'
      
      let cf: any = lead.custom_fields
      if (typeof cf === 'string') {
        try { cf = JSON.parse(cf) } catch (e) { cf = null }
      }

      // Helper to parse date from historical remark text (e.g. "Call Not Picked on 09/08/2026 01:45 pm" or "3/9/2026, 2:30:54 pm")
      const parseActionDateFromDesc = (text: string, fallback: string) => {
        if (!text) return fallback
        const match = text.match(/(?:(?:Call on|Call Not Picked on|Recorded on|Date\s*:|[\-\(])\s*)?([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})(?:[,\s]+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*(am|pm)?)?/i)
        if (match) {
          const day = parseInt(match[1], 10)
          const month = parseInt(match[2], 10) - 1
          let year = parseInt(match[3], 10)
          if (year < 100) year += 2000
          let hour = match[4] ? parseInt(match[4], 10) : 12
          let min = match[5] ? parseInt(match[5], 10) : 0
          const ampm = match[7]?.toLowerCase()
          if (ampm === 'pm' && hour < 12) hour += 12
          if (ampm === 'am' && hour === 12) hour = 0
          const d = new Date(Date.UTC(year, month, day, hour - 5, min - 30))
          if (!isNaN(d.getTime())) return d.toISOString()
        }
        return fallback
      }

      // 1. Ingest all followups & remarks recorded in lead.notes (for imported/historical leads)
      if (lead.notes && typeof lead.notes === 'string') {
        // Split by delimiter headers ([📝...], [⚠️...], [🔄...], [Last Remarks], [Opening Remarks], etc.) or horizontal divider lines
        const rawEntries = lead.notes.trim().split(/(?:---+|\n+(?=\[(?:📝|⚠️|🔄|Last Remarks|Opening Remarks|Followups Taken|Merged|Call|Visit|Transfer|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})))/)
        for (let i = 0; i < rawEntries.length; i++) {
          const entry = rawEntries[i].trim()
          if (!entry || entry.length < 5) continue
          const lower = entry.toLowerCase()

          if (
            lower.startsWith('[opening remarks]') ||
            lower.startsWith('advertisment') ||
            lower.startsWith('ad name') ||
            lower.startsWith('[followups taken]') ||
            lower.startsWith('lead created from')
          ) {
            continue
          }

          let remarkBody = entry
          if (entry.includes(']:')) {
            remarkBody = entry.split(']:').slice(1).join(']:').trim()
          }
          remarkBody = remarkBody.replace(/^Stage:\s*[^.]+\.\s*/i, '').trim()
          remarkBody = remarkBody.replace(/^Next action scheduled for[^.]+\.\s*/i, '').trim()

          const searchSnippet = (remarkBody || entry).slice(0, 30).toLowerCase().trim()
          const dateStr = parseActionDateFromDesc(entry, lead.created_at || new Date().toISOString())
          const noteTime = new Date(dateStr).getTime()

          const alreadyPresent = items.some(it => {
            const itDesc = (it.description || '').toLowerCase()
            if (searchSnippet && searchSnippet.length >= 8 && itDesc.includes(searchSnippet)) return true
            const itTime = new Date(it.created_at).getTime()
            if (Math.abs(itTime - noteTime) < 120000) {
              if (lower.includes('dnp') && (itDesc.includes('dnp') || itDesc.includes('not picked'))) return true
              if (lower.includes('followup') && itDesc.includes('followup')) return true
            }
            return false
          })

          if (!alreadyPresent) {
            let actorName = lead.user_name || undefined
            const byMatch = entry.match(/\bby\s+([A-Za-z0-9\s._-]+?)(?:\:|\]|\.|\s-\s|\n|$)/i)
            if (byMatch && byMatch[1]) {
              const rawName = byMatch[1].trim()
              if (rawName && !rawName.toLowerCase().includes('agent') && !rawName.toLowerCase().includes('system')) {
                actorName = rawName
              }
            }

            let actionType = 'FOLLOWUP'
            if (lower.includes('call not picked') || lower.includes('dnp')) actionType = 'DNP'
            else if (lower.includes('visit')) actionType = 'SITE_VISIT'
            else if (lower.includes('meeting')) actionType = 'MEETING'
            else if (lower.includes('transferred')) actionType = 'TRANSFER'

            items.push({
              id: `note_entry_${i}`,
              lead_id: lead.id,
              action_type: actionType,
              description: entry,
              actor_name: actorName,
              user_id: lead.assigned_to || lead.user_id,
              created_at: dateStr
            })
          }
        }
      }

      // Collect user_ids not yet in profile cache
      const userIds = new Set<string>()
      if (lead.assigned_to && !globalProfilesCache.has(lead.assigned_to)) userIds.add(lead.assigned_to)
      if (lead.user_id && !globalProfilesCache.has(lead.user_id)) userIds.add(lead.user_id)
      items.forEach(item => {
        if (item.user_id && !globalProfilesCache.has(item.user_id)) userIds.add(item.user_id)
      })

      if (userIds.size > 0) {
        try {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, full_name, business_name, email')
            .in('id', Array.from(userIds))

          if (profs && profs.length > 0) {
            profs.forEach(p => {
              const name = p.full_name?.trim() || p.business_name?.trim() || (p.email ? p.email.split('@')[0] : '')
              if (name) globalProfilesCache.set(p.id, name)
            })
            setProfilesMap(new Map(globalProfilesCache))
          }
        } catch (e) {
          console.error("Failed to resolve actor profiles:", e)
        }
      } else {
        setProfilesMap(new Map(globalProfilesCache))
      }

      const cutoff = cf?.history_visible_from
      const cutoffTime = cutoff ? new Date(cutoff).getTime() : null

      // 2. Ensure imported/existing last remarks are included as distinct timeline cards (only if admin or post-cutoff)
      const lastRemark = (cf?.last_followup_remark || cf?.last_remark || '').trim()
      if (lastRemark) {
        const exists = items.some(item => (item.description || '').includes(lastRemark))
        if (!exists) {
          const actionDateStr = parseActionDateFromDesc(lastRemark, cf?.last_followup_at || lead.last_call_at || lead.created_at)
          const actionTime = new Date(actionDateStr).getTime()
          const isPostCutoff = !cutoffTime || isNaN(cutoffTime) || actionTime >= cutoffTime

          if (isAdmin || isPostCutoff) {
            items.push({
              id: 'synthetic_last_remark',
              lead_id: lead.id,
              action_type: lastRemark.toLowerCase().includes('dnp') || lastRemark.toLowerCase().includes('not picked') ? 'DNP' : 'LAST_FOLLOWUP_REMARK',
              description: lastRemark,
              details: null,
              actor_name: lead.user_name || undefined,
              user_id: lead.assigned_to || lead.user_id,
              created_at: actionDateStr
            })
          }
        }
      }

      // 3. Reconcile total followup count with detailed records (for leads with prior followups from previous CRM/Workveu)
      const totalRecordedFollowups = getLeadFollowupCount(lead)
      const detailedFollowupItems = items.filter(it => 
        it.action_type !== 'LEAD_CREATED' && 
        it.action_type !== 'LEAD_IMPORT' && 
        it.action_type !== 'REOPENED' && 
        it.action_type !== 'ASSIGNED' &&
        it.id !== 'foundational_lead_created'
      )
      const missingPriorCount = totalRecordedFollowups - detailedFollowupItems.length

      if (missingPriorCount > 0) {
        const leadCreationTime = new Date(lead.created_at || Date.now()).getTime()
        const priorDate = new Date(leadCreationTime + 60000).toISOString()

        items.push({
          id: 'prior_crm_followups_summary',
          lead_id: lead.id,
          action_type: 'PRIOR_FOLLOWUPS_SUMMARY',
          description: `📦 ${missingPriorCount} earlier followup${missingPriorCount === 1 ? '' : 's'} were completed in the previous CRM prior to migration.\n\nTotal Followups: ${totalRecordedFollowups}. The previous CRM export retained the aggregate followup count (${totalRecordedFollowups}) along with the opening and latest discussion remarks shown in this timeline.`,
          details: null,
          actor_name: 'Previous CRM Import',
          user_id: lead.assigned_to || lead.user_id,
          created_at: priorDate,
          prior_count: missingPriorCount,
          total_count: totalRecordedFollowups
        })
      }

      // 4. ALWAYS guarantee the foundational Lead Created / Registration card at the bottom of the timeline
      const hasCreationEvent = items.some(item => 
        item.action_type === 'LEAD_CREATED' || 
        item.action_type === 'LEAD_IMPORT' || 
        item.id === 'foundational_lead_created' ||
        (item.description && item.description.includes('Lead Created from'))
      )

      if (!hasCreationEvent) {
        let creationDesc = `Lead Created from ${lead.source || 'Facebook'}\n`
        creationDesc += `Lead Name : ${lead.name || 'N/A'}\n`
        creationDesc += `Contact no : ${lead.phone || 'N/A'}\n`
        if (lead.email) creationDesc += `Email : ${lead.email}\n`
        creationDesc += `Lead Source : ${lead.source || 'Facebook'}\n`
        creationDesc += `Source Details : ${lead.ad_name || lead.form_name || lead.campaign_name || 'Meta Ad'}\n`
        creationDesc += `Stage : ${(lead.pipeline_stage && lead.pipeline_stage !== 'Ongoing') ? lead.pipeline_stage : (lead.status && lead.status !== 'Ongoing' ? lead.status : 'New Lead')}`
        
        if (cf?.opening_comments) {
          creationDesc += `\n\n📋 Opening Remarks / Ad Answers :\n${cf.opening_comments}`
        }

        items.push({
          id: 'foundational_lead_created',
          lead_id: lead.id,
          action_type: 'LEAD_CREATED',
          description: creationDesc,
          details: null,
          actor_name: 'System / Meta Ad',
          user_id: lead.assigned_to || lead.user_id,
          created_at: lead.created_at || new Date().toISOString()
        })
      }

      // Sort chronological descending (newest on top, initial creation at the bottom)
      items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

      if (cutoffTime && !isAdmin) {
        items = items.filter(item => {
          const isSystem = item.action_type === 'REOPENED' || 
                           item.action_type === 'LEAD_CREATED' || 
                           item.action_type === 'SYSTEM' || 
                           item.id === 'foundational_lead_created' ||
                           (item.description && (item.description.includes('Lead Source :') || item.description.includes('Facebook Ad Submission') || item.description.includes('Source Details :')))
          if (isSystem) return true
          return new Date(item.created_at).getTime() >= cutoffTime
        })
      }

      leadHistoryCache.set(lead.id, { items, timestamp: Date.now() })
      setHistoryItems(items)
    } catch (err) {
      console.error("Failed to fetch lead history timeline:", err)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !lead) return null

  // Format date/time
  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleString([], {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    } catch (e) {
      return dateStr
    }
  }

  // Extract initial for avatar
  const getInitial = (nameStr: string) => {
    if (!nameStr) return 'L'
    return nameStr.trim().charAt(0).toUpperCase()
  }

  const totalRecordedFollowups = lead ? getLeadFollowupCount(lead) : 0

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <History size={20} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2 flex-wrap">
                <span>Timeline History for {lead.name || 'Lead'}</span>
                <LeadScoreBadge lead={lead} size="sm" showDetails />
                <span className="px-2 py-0.5 text-[11px] font-black rounded-md bg-blue-100 text-blue-800 border border-blue-200 shrink-0 inline-flex items-center gap-1 shadow-xs">
                  💬 {totalRecordedFollowups} Followup{totalRecordedFollowups === 1 ? '' : 's'}
                </span>
                {(() => {
                  let cf = lead.custom_fields
                  if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
                  const stage = (lead.status || lead.pipeline_stage || '').toLowerCase()
                  const isVisited = cf?.has_visited === true || cf?.visited === true || (!stage.includes('planned') && !stage.includes('scheduled') && (stage.includes('visit done') || stage.includes('visited') || stage.includes('revisit done') || stage.includes('appointment done') || stage.includes('site visit done')))
                  if (isVisited) {
                    return (
                      <span className="px-2 py-0.5 text-[10px] font-black rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0 inline-flex items-center gap-1 shadow-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Visited
                      </span>
                    )
                  }
                  return null
                })()}
              </h3>
              <p className="text-slate-500 text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>{lead.phone || 'No Phone'}</span>
                <span>•</span>
                <span>Stage: <strong className="font-semibold text-blue-600">{(lead.pipeline_stage && lead.pipeline_stage !== 'Ongoing') ? lead.pipeline_stage : (lead.status && lead.status !== 'Ongoing' ? lead.status : 'Requirement Taken')}</strong></span>
                {(() => {
                  const rep = (lead.assigned_to && profilesMap.get(lead.assigned_to)) || (lead.user_id && profilesMap.get(lead.user_id)) || lead.user_name
                  if (rep && rep !== 'Agent') {
                    return (
                      <>
                        <span>•</span>
                        <span>Rep: <strong className="text-slate-700 font-semibold">{rep}</strong></span>
                      </>
                    )
                  }
                  return null
                })()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {lead?.id && (
              <button
                onClick={() => {
                  onClose()
                  router.push(`/dashboard/crm/${lead.id}`)
                }}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Open Full Lead View in CRM"
              >
                <ExternalLink size={14} />
                <span>Full Preview</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body: Timeline Items */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
              <RefreshCw size={18} className="animate-spin text-blue-600" />
              <span className="text-xs font-semibold">Loading timeline records...</span>
            </div>
          ) : historyItems.length === 0 ? (
            /* Synthetic / Initial Creation Item if no DB history yet */
            <div className="relative pl-8 border-l-2 border-emerald-500/40 space-y-6 my-4">
              <div className="relative">
                <span className="absolute -left-[39px] top-1 w-3.5 h-3.5 rounded-full border-2 border-emerald-500 bg-white" />
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center border border-amber-300">
                    {getInitial(lead.user_name || 'System')}
                  </div>
                  <span className="font-bold text-xs text-slate-700">{lead.user_name || 'System / Agent'}</span>
                  <span className="text-xs text-slate-400">{formatDateTime(lead.created_at)}</span>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl space-y-1.5 text-xs text-slate-700 font-medium">
                  <p className="font-extrabold text-sm text-slate-900">Lead Created from {lead.source || 'Facebook'}</p>
                  <div><strong>Lead Name :</strong> {lead.name || 'N/A'}</div>
                  <div><strong>Contact no :</strong> {lead.phone || 'N/A'}</div>
                  {lead.email && <div><strong>Email :</strong> {lead.email}</div>}
                  <div><strong>Lead Source :</strong> {lead.source || 'Facebook'}</div>
                  <div><strong>Source Details :</strong> {lead.ad_name || lead.form_name || lead.campaign_name || 'Meta Ad'}</div>
                  <div><strong>Stage :</strong> {(lead.pipeline_stage && lead.pipeline_stage !== 'Ongoing') ? lead.pipeline_stage : (lead.status && lead.status !== 'Ongoing' ? lead.status : 'New Lead')}</div>
                  {(() => {
                    let cf: any = lead.custom_fields
                    if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) { cf = null } }
                    if (cf?.opening_comments) {
                      return (
                        <div className="mt-2 pt-2 border-t border-slate-200">
                          <strong className="text-slate-900 block mb-0.5">📋 Ad Requirements / Answers :</strong>
                          <p className="whitespace-pre-wrap font-semibold text-slate-800 bg-white p-2 rounded-xl border border-slate-200/60">{cf.opening_comments}</p>
                        </div>
                      )
                    }
                    return null
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative pl-8 border-l-2 border-emerald-500/40 space-y-6 my-4">
              {historyItems.map((item, idx) => {
                const resolveDisplayActionType = (it: any): string => {
                  const raw = (it.action_type || it.title || '').trim()
                  const desc = (it.description || '').toLowerCase()

                  if (raw === 'STATUS_CHANGE') {
                    if (desc.includes('followup')) return 'FOLLOWUP'
                    return 'STAGE UPDATE'
                  }
                  if (raw === 'REMARK') {
                    if (desc.includes('call not picked') || desc.includes('dnp')) return 'CALL NOT PICKED (DNP)'
                    if (desc.includes('followup')) return 'FOLLOWUP'
                    if (desc.includes('whatsapp')) return 'WHATSAPP'
                    if (desc.includes('call initiated')) return 'OUTBOUND CALL'
                    return 'REMARK / FOLLOWUP'
                  }
                  if (raw === 'DNP' || raw === 'CALL_NOT_PICKED') return 'CALL NOT PICKED (DNP)'
                  if (raw === 'TRANSFER') return 'LEAD TRANSFERRED'
                  if (raw === 'CALL' || raw === 'CALL_FEEDBACK') return 'CALL LOG'
                  if (raw === 'LEAD_CREATED') return 'LEAD CREATED'
                  if (raw === 'SITE_VISIT') return 'SITE VISIT'
                  if (raw === 'MEETING') return 'MEETING'
                  if (raw === 'FOLLOWUP') return 'FOLLOWUP'
                  if (raw === 'PRIOR_FOLLOWUPS_SUMMARY') return 'PREVIOUS CRM FOLLOWUPS'
                  return raw || 'Followup Event'
                }

                const resolveActorName = (it: any): string => {
                  if (it.actor_name && it.actor_name !== 'Agent') return it.actor_name
                  if (it.performed_by && it.performed_by !== 'Agent') return it.performed_by

                  const desc = it.description || ''
                  if (it.action_type === 'REOPENED' || desc.includes('Facebook Ad Submission') || desc.includes('Lead Created from')) {
                    return 'System / Meta Ad'
                  }
                  if (desc.includes('WhatsApp welcome') || desc.includes('Video Welcome') || desc.includes('Instant WhatsApp')) {
                    return 'Automated System'
                  }

                  if (it.user_id && profilesMap.has(it.user_id)) return profilesMap.get(it.user_id)!

                  const bracketMatch = desc.match(/\[[^\]]+?\bby\s+([^\]]+)\]/i)
                  if (bracketMatch && bracketMatch[1]) {
                    const rawName = bracketMatch[1].trim()
                    if (rawName && !rawName.toLowerCase().includes('agent') && !rawName.toLowerCase().includes('system')) {
                      return rawName
                    }
                  }
                  const byMatch = desc.match(/\bby\s+([A-Za-z0-9\s._-]+?)(?:\:|\.|\s-\s|\n|$)/i)
                  if (byMatch && byMatch[1]) {
                    const rawName = byMatch[1].trim()
                    if (rawName && rawName.length < 30 && !rawName.toLowerCase().includes('agent') && !rawName.toLowerCase().includes('system') && !rawName.toLowerCase().includes('facebook')) {
                      return rawName
                    }
                  }

                  if (lead.assigned_to && profilesMap.has(lead.assigned_to)) {
                    return profilesMap.get(lead.assigned_to)!
                  }

                  if (lead.user_id && profilesMap.has(lead.user_id)) {
                    return profilesMap.get(lead.user_id)!
                  }

                  return lead.user_name || 'Agent'
                }

                const actorName = resolveActorName(item)
                const urlMatch = item.description?.match(/(https?:\/\/[^\s]+\.(mp3|m4a|wav|aac|ogg|3gp)|https?:\/\/[^\s]+\/call-recordings\/[^\s]+)/i)
                const recordingUrl = item.metadata?.recording_url || item.recording_url || (urlMatch ? urlMatch[0] : null)
                const displayActionType = resolveDisplayActionType(item)

                const cleanedDescription = (item.description || '')
                  .replace(/Status:\s*Ongoing/g, 'Stage: Requirement Taken')
                  .replace(/Stage:\s*Ongoing/g, 'Stage: Requirement Taken')
                  .replace(/Lead Status\s*:\s*Ongoing/g, 'Stage: Requirement Taken')

                if (item.action_type === 'PRIOR_FOLLOWUPS_SUMMARY') {
                  return (
                    <div key={item.id || idx} className="relative">
                      {/* Circle Bullet on Timeline */}
                      <span className="absolute -left-[39px] top-1 w-3.5 h-3.5 rounded-full border-2 border-indigo-500 bg-white" />

                      {/* Actor Header */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center border border-indigo-300">
                          <Package size={14} />
                        </div>
                        <span className="font-bold text-xs text-indigo-950">Previous CRM Import</span>
                        <span className="text-xs text-slate-400">{formatDateTime(item.created_at)}</span>
                      </div>

                      {/* Event Detail Card */}
                      <div className="bg-indigo-50/70 border border-indigo-200/80 p-4 rounded-2xl space-y-2 text-xs text-slate-700 font-medium leading-relaxed">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <p className="font-extrabold text-sm text-indigo-950 flex items-center gap-2">
                            <span>📦 Previous CRM Followups Summary</span>
                          </p>
                          <span className="px-2.5 py-0.5 text-[11px] font-black rounded-lg bg-indigo-600 text-white shadow-xs">
                            {item.prior_count || 1} Earlier Followup{(item.prior_count || 1) === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="p-3 bg-white rounded-xl border border-indigo-100/80 shadow-2xs space-y-1.5 text-slate-700">
                          <p className="font-bold text-indigo-950">
                            {item.prior_count} earlier followups were logged in the previous CRM prior to migration.
                          </p>
                          <p className="text-slate-500 text-[11px] leading-normal">
                            This lead was imported with an aggregate count of <strong>{item.total_count} total followups</strong>. The initial lead creation and the latest recorded conversation remarks are detailed below and above.
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={item.id || idx} className="relative">
                    {/* Circle Bullet on Timeline */}
                    <span className="absolute -left-[39px] top-1 w-3.5 h-3.5 rounded-full border-2 border-emerald-500 bg-white" />

                    {/* Actor Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center border border-amber-300">
                        {getInitial(actorName)}
                      </div>
                      <span className="font-bold text-xs text-slate-800">{actorName}</span>
                      <span className="text-xs text-slate-400">{formatDateTime(item.created_at)}</span>
                    </div>

                    {/* Event Detail Card */}
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1.5 text-xs text-slate-700 font-medium leading-relaxed">
                      <p className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <span>{displayActionType}</span>
                      </p>

                      {cleanedDescription && (() => {
                        if (cleanedDescription.startsWith('💬 WA_JSON:')) {
                          try {
                            const parsed = JSON.parse(cleanedDescription.replace('💬 WA_JSON:', ''))
                            return (
                              <div className="mt-2 pt-2 border-t border-slate-200/80 space-y-2">
                                <span className="block text-[11px] font-extrabold uppercase text-emerald-600 tracking-wider">
                                  💬 WhatsApp Chat:
                                </span>
                                <div className="space-y-2 bg-emerald-50/50 p-3 rounded-xl border border-emerald-200/60">
                                  {parsed.user_msg && (
                                    <div className="flex justify-end">
                                      <div className="bg-slate-200 text-slate-800 px-3 py-1.5 rounded-2xl rounded-tr-xs text-xs font-medium max-w-[85%]">
                                        {parsed.user_msg}
                                      </div>
                                    </div>
                                  )}
                                  {parsed.bot_reply && (
                                    <div className="flex justify-start">
                                      <div className="bg-emerald-600 text-white px-3 py-1.5 rounded-2xl rounded-tl-xs text-xs font-medium max-w-[85%]">
                                        {parsed.bot_reply}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          } catch (e) {}
                        }

                        if (cleanedDescription.startsWith('💬 WA_TEMPLATE:')) {
                          try {
                            const parsed = JSON.parse(cleanedDescription.replace('💬 WA_TEMPLATE:', ''))
                            return (
                              <div className="mt-2 pt-2 border-t border-slate-200/80 space-y-1.5">
                                <span className="block text-[11px] font-extrabold uppercase text-emerald-600 tracking-wider">
                                  💬 WhatsApp Template ({parsed.template_name}):
                                </span>
                                <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-200/60 text-xs text-slate-800 whitespace-pre-wrap font-medium">
                                  {parsed.body_text}
                                </div>
                              </div>
                            )
                          } catch (e) {}
                        }

                        if (cleanedDescription.startsWith('🎙️ CALL_JSON:')) {
                          try {
                            const parsed = JSON.parse(cleanedDescription.replace('🎙️ CALL_JSON:', ''))
                            return (
                              <div className="mt-2 pt-2 border-t border-slate-200/80 space-y-1.5">
                                <span className="block text-[11px] font-extrabold uppercase text-indigo-600 tracking-wider">
                                  🎙️ AI Voice Call Summary:
                                </span>
                                <p className="text-slate-800 text-xs font-semibold bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-200/60">
                                  {parsed.summary}
                                </p>
                              </div>
                            )
                          } catch (e) {}
                        }

                        return (
                          <div className="mt-2 pt-2 border-t border-slate-200/80">
                            <span className="block text-[11px] font-extrabold uppercase text-slate-500 tracking-wider mb-1">
                              Remark / Details:
                            </span>
                            <p className="text-slate-800 text-xs font-semibold leading-relaxed whitespace-pre-wrap bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                              {cleanedDescription}
                            </p>
                          </div>
                        )
                      })()}

                      {/* Call Audio Recording Player */}
                      {recordingUrl && (
                        <div className="mt-2.5 p-2 bg-white rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2 mb-1.5 text-[11px] font-bold text-blue-700">
                            <Phone size={14} />
                            <span>Human Call Recording</span>
                          </div>
                          <audio controls className="w-full h-8">
                            <source src={recordingUrl} type="audio/mpeg" />
                            Your browser does not support audio playback.
                          </audio>
                        </div>
                      )}

                      {/* Structured Details */}
                      {item.details && typeof item.details === 'object' && (
                        <div className="space-y-1 pt-1 border-t border-slate-200/60 mt-2">
                          {Object.entries(item.details).map(([k, v]) => (
                            <div key={k}>
                              <strong className="capitalize">{k.replace(/_/g, ' ')} :</strong> {String(v)}
                            </div>
                          ))}
                        </div>
                      )}

                      {!item.details && !recordingUrl && !item.description?.includes('Lead Name :') && (
                        <div className="space-y-0.5 pt-1 text-slate-600">
                          <div><strong>Lead Name :</strong> {lead.name || 'N/A'}</div>
                          <div><strong>Contact no :</strong> {lead.phone || 'N/A'}</div>
                          <div><strong>Stage :</strong> {(item.new_stage && item.new_stage !== 'Ongoing') ? item.new_stage : (lead.pipeline_stage && lead.pipeline_stage !== 'Ongoing') ? lead.pipeline_stage : 'Requirement Taken'}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  )
}
