'use client'

import React, { useState, useEffect } from 'react'
import { X, History, Clock, User, Phone, MessageSquare, AlertCircle, RefreshCw, FileText } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import LeadScoreBadge from '@/components/LeadScoreBadge'

interface LeadHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  lead: any
  viewerRole?: string
}

export default function LeadHistoryModal({ isOpen, onClose, lead, viewerRole }: LeadHistoryModalProps) {
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const [profilesMap, setProfilesMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (isOpen && lead?.id) {
      fetchHistory()
    }
  }, [isOpen, lead?.id])

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('lead_history')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
      
      let items = data || []

      // Admin / Agency / Super Admin role retains 100% full history access
      const isAdmin = viewerRole === 'super_admin' || viewerRole === 'agency' || viewerRole === 'admin'
      
      let cf: any = lead.custom_fields
      if (typeof cf === 'string') {
        try { cf = JSON.parse(cf) } catch (e) { cf = null }
      }

      // Collect user_ids to resolve real agent names
      const userIds = new Set<string>()
      if (lead.assigned_to) userIds.add(lead.assigned_to)
      if (lead.user_id) userIds.add(lead.user_id)
      items.forEach(item => {
        if (item.user_id) userIds.add(item.user_id)
      })

      if (userIds.size > 0) {
        try {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, full_name, business_name, email')
            .in('id', Array.from(userIds))

          if (profs && profs.length > 0) {
            const pMap = new Map<string, string>()
            profs.forEach(p => {
              const name = p.full_name?.trim() || p.business_name?.trim() || (p.email ? p.email.split('@')[0] : '')
              if (name) pMap.set(p.id, name)
            })
            setProfilesMap(pMap)
          }
        } catch (e) {
          console.error("Failed to resolve actor profiles:", e)
        }
      }

      // Ensure initial / imported last remark is included in timeline if missing
      const lastRemark = (cf?.last_followup_remark || cf?.opening_comments || lead.notes || lead.summary || '').trim()
      if (lastRemark) {
        const exists = items.some(item => (item.description || '').includes(lastRemark))
        if (!exists) {
          items.push({
            id: 'synthetic_last_remark',
            lead_id: lead.id,
            action_type: 'LAST_FOLLOWUP_REMARK',
            description: lastRemark,
            actor_name: lead.user_name || undefined,
            user_id: lead.assigned_to || lead.user_id,
            created_at: cf?.last_followup_at || lead.last_call_at || lead.created_at
          })
          items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        }
      }

      const cutoff = cf?.history_visible_from
      if (cutoff && !isAdmin) {
        const cutoffDate = new Date(cutoff)
        items = items.filter(item => {
          const isSystem = item.action_type === 'REOPENED' || 
                           item.action_type === 'LEAD_CREATED' || 
                           item.action_type === 'SYSTEM' || 
                           (item.description && (item.description.includes('Lead Source :') || item.description.includes('Facebook Ad Submission') || item.description.includes('Source Details :')))
          if (isSystem) return true
          return new Date(item.created_at) >= cutoffDate
        })
      }

      setHistoryItems(items)
    } catch (err) {
      console.error("Failed to fetch lead history timeline:", err)
    } finally {
      setLoading(false)
    }
  }

  const [uploadingRecording, setUploadingRecording] = useState(false)

  const handleUploadRecording = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !lead?.id) return

    setUploadingRecording(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('leadId', lead.id)
      formData.append('phoneNumber', lead.phone || '')

      const res = await fetch('/api/crm/call-recordings', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()
      if (data.success) {
        fetchHistory()
      } else {
        console.error('Failed to upload call recording:', data.error)
      }
    } catch (err: any) {
      console.error('Upload failed:', err)
    } finally {
      setUploadingRecording(false)
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
              </h3>
              <p className="text-slate-500 text-xs mt-0.5">
                {lead.phone || 'No Phone'} • Stage: <span className="font-semibold text-blue-600">{(lead.pipeline_stage && lead.pipeline_stage !== 'Ongoing') ? lead.pipeline_stage : (lead.status && lead.status !== 'Ongoing' ? lead.status : 'Requirement Taken')}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl cursor-pointer border border-blue-200 transition-colors flex items-center gap-1.5">
              <Phone size={14} />
              <span>{uploadingRecording ? 'Uploading...' : 'Attach Recording'}</span>
              <input 
                type="file" 
                accept="audio/*" 
                onChange={handleUploadRecording} 
                disabled={uploadingRecording} 
                className="hidden" 
              />
            </label>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
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
                const resolveActorName = (it: any): string => {
                  if (it.actor_name && it.actor_name !== 'Agent') return it.actor_name;
                  if (it.performed_by && it.performed_by !== 'Agent') return it.performed_by;
                  if (it.user_id && profilesMap.has(it.user_id)) return profilesMap.get(it.user_id)!;

                  const desc = it.description || ''
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

                  if (it.action_type === 'REOPENED' || desc.includes('Facebook Ad Submission')) {
                    return 'Meta Ads System'
                  }

                  if (lead.assigned_to && profilesMap.has(lead.assigned_to)) {
                    return profilesMap.get(lead.assigned_to)!
                  }

                  if (lead.user_id && profilesMap.has(lead.user_id)) {
                    return profilesMap.get(lead.user_id)!
                  }

                  return lead.user_name || 'Agent'
                }

                const actorName = resolveActorName(item);
                const urlMatch = item.description?.match(/(https?:\/\/[^\s]+\.(mp3|m4a|wav|aac|ogg|3gp)|https?:\/\/[^\s]+\/call-recordings\/[^\s]+)/i)
                const recordingUrl = item.metadata?.recording_url || item.recording_url || (urlMatch ? urlMatch[0] : null);
                const displayActionType = item.action_type === 'STATUS_CHANGE'
                  ? 'STAGE UPDATE'
                  : item.action_type === 'FOLLOWUP'
                  ? 'FOLLOWUP'
                  : item.action_type || item.title || 'Followup Event';

                const cleanedDescription = (item.description || '')
                  .replace(/Status:\s*Ongoing/g, 'Stage: Requirement Taken')
                  .replace(/Stage:\s*Ongoing/g, 'Stage: Requirement Taken')
                  .replace(/Lead Status\s*:\s*Ongoing/g, 'Stage: Requirement Taken');

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

                      {!item.details && !recordingUrl && (
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
