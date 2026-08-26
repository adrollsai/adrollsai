'use client'

import React, { useState, useEffect } from 'react'
import { X, Calendar, User, Building2, PhoneCall, CheckSquare, Clock, Tag, Sparkles, Loader2, AlertCircle } from 'lucide-react'
import { getPropertyTags } from '@/utils/property-tags'
import { getPropertyDisplayLabel } from '@/utils/property-helper'
import { createClient } from '@/utils/supabase/client'
import { categorizeLeadStage } from '@/utils/pipeline-stages'

export const isNotInterestedOrLostStage = (stage?: string | null): boolean => {
  if (!stage) return false
  const cat = categorizeLeadStage(stage)
  if (cat === 'not_interested' || cat === 'trash') return true
  const norm = stage.toLowerCase().trim()
  return (
    norm === 'dealer' ||
    norm === 'lost/ni' ||
    norm === 'lost' ||
    norm === 'plan postponed' ||
    norm === 'already purchased' ||
    norm === 'different requirement' ||
    norm === 'unqualified' ||
    norm.includes('not interested') ||
    norm.includes('lost') ||
    norm.includes('junk') ||
    norm.includes('dealer') ||
    norm.includes('postponed') ||
    norm.includes('purchased') ||
    norm.includes('fake') ||
    norm.includes('wrong')
  )
}

interface UpdateFollowupModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  lead: any
  properties?: any[]
  teamMembers?: any[]
}

const STAGES = [
  'New Lead',
  'Requirement Taken',
  'Visit Planned',
  'Visit Done',
  'Revisit Done',
  'Meeting Planned',
  'Meeting Done',
  'Never Picked',
  'Negotiation',
  'Deal/Token',
  'Dealer',
  'Plan Postponed',
  'Already Purchased',
  'Lost/NI',
  'Different Requirement',
  'Appointment Booked'
]

const FOLLOWUP_TYPES = ['Call', 'Visit', 'Revisit', 'Closing Meeting', 'Home Meeting', 'WhatsApp', 'Email']
const NEXT_ACTION_TYPES = ['Call', 'Visit', 'Revisit', 'Closing Meeting', 'Home Meeting']
const CLIENT_STATUSES = ['Hot', 'Warm', 'Cold']
const BUDGET_OPTIONS = [
  'Under 50 Lakhs',
  '50 Lakhs - 1 Crore',
  '1 Crore - 2 Crore',
  '2 Crore - 5 Crore',
  '5 Crore+'
]

export default function UpdateFollowupModal({
  isOpen,
  onClose,
  onSuccess,
  lead,
  properties = [],
  teamMembers = []
}: UpdateFollowupModalProps) {
  const [isDnp, setIsDnp] = useState(false)
  const [followupType, setFollowupType] = useState('Call')
  const [followupDate, setFollowupDate] = useState('')
  const [leadStage, setLeadStage] = useState('New Lead')
  const [clientStatus, setClientStatus] = useState('Warm')
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [budget, setBudget] = useState('')
  const [remarks, setRemarks] = useState('')
  
  // Next Action fields
  const [nextActionDate, setNextActionDate] = useState('')
  const [nextActionType, setNextActionType] = useState('Call')
  const [assignedTo, setAssignedTo] = useState('')
  const [nextRemarks, setNextRemarks] = useState('')
  const [remindMe, setRemindMe] = useState(true)
  const [showNextActionForClosed, setShowNextActionForClosed] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localProperties, setLocalProperties] = useState<any[]>(properties)

  useEffect(() => {
    const loadProperties = async () => {
      // 1. If properties prop provided from parent, use it
      if (properties && properties.length > 0) {
        setLocalProperties(properties)
        return
      }

      // 2. Fetch properties via /api/inventory API route (bypasses browser RLS blocks)
      try {
        const res = await fetch('/api/inventory')
        const data = await res.json()
        if (data.success && Array.isArray(data.properties) && data.properties.length > 0) {
          setLocalProperties(data.properties)
          return
        }
      } catch (e) {}

      // 3. Fallback: Query Supabase directly
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('properties')
          .select('id, title, tags, configurations')
          .order('created_at', { ascending: false })

        if (data && data.length > 0) {
          setLocalProperties(data)
        }
      } catch (e) {
        console.error("UpdateFollowupModal property fetch error:", e)
      }
    }

    if (isOpen) {
      loadProperties()
    }
  }, [isOpen, properties])

  useEffect(() => {
    if (lead && isOpen) {
      setError(null)
      setIsDnp(false)
      setShowNextActionForClosed(false)
      const currentStage = lead.status || lead.pipeline_stage || 'New Lead'
      setLeadStage(currentStage)
      setClientStatus(lead.client_status || 'Warm')
      setSelectedPropertyId(lead.property_id || '')
      setBudget(lead.budget || '')
      setAssignedTo(lead.assigned_to || '')
      setRemarks('')
      setNextRemarks('')

      // Default dates
      const now = new Date()
      const formatLocalIso = (d: Date) => {
        const pad = (n: number) => n.toString().padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      }
      
      setFollowupDate(formatLocalIso(now))
      
      // Default next action date to tomorrow 11:00 AM
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(11, 0, 0, 0)
      setNextActionDate(formatLocalIso(tomorrow))
    }
  }, [lead, isOpen])

  if (!isOpen || !lead) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const isClosedStatus = isNotInterestedOrLostStage(leadStage)
    const shouldIncludeNextAction = !isClosedStatus || showNextActionForClosed

    try {
      const res = await fetch('/api/crm/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_followup',
          leadId: lead.id,
          isDnp,
          followupType,
          followupDate,
          leadStatus: isDnp ? (lead.status || lead.pipeline_stage || 'New Lead') : leadStage,
          pipelineStage: isDnp ? (lead.pipeline_stage || 'New Lead') : leadStage,
          clientStatus: isDnp ? lead.client_status : clientStatus,
          propertyId: selectedPropertyId || null,
          budget: budget || null,
          remarks: isDnp ? nextRemarks : remarks,
          nextActionDate: shouldIncludeNextAction && nextActionDate ? new Date(nextActionDate).toISOString() : null,
          nextActionType: shouldIncludeNextAction ? nextActionType : null,
          assignedTo: assignedTo || null,
          remindMe: shouldIncludeNextAction ? remindMe : false
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save followup')
      }

      if (onSuccess) onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred while saving.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200 pb-24 sm:pb-8">
      <div className="relative w-full max-w-3xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden my-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Update Followup</h3>
              <p className="text-xs text-slate-500">Lead: <span className="text-slate-800 font-bold">{lead.name || 'Unnamed Prospect'}</span> ({lead.phone || 'No Phone'})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          
          {error && (
            <div className="flex items-center space-x-2 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* DNP Checkbox Header Banner */}
          <div className={`p-4 rounded-2xl border transition-all ${isDnp ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
            <label className="flex items-center space-x-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isDnp}
                onChange={(e) => setIsDnp(e.target.checked)}
                className="w-5 h-5 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-bold text-slate-900">Call Not Picked (DNP)</span>
                <p className="text-xs text-slate-500">
                  {isDnp ? 'Check this if the client did not answer. Enables quick retry scheduling.' : 'Check if the lead did not answer the phone call.'}
                </p>
              </div>
            </label>
          </div>

          {/* Full Followup Section (Hidden if DNP is checked) */}
          {!isDnp ? (
            <div className="space-y-6">
              
              {/* Row 1: Followup Type, Date & Single Unified Lead Status / Stage */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Followup Type <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={followupType}
                    onChange={(e) => setFollowupType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                  >
                    {FOLLOWUP_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Followup Date & Time <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={followupDate}
                    onChange={(e) => setFollowupDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Lead Status / Stage <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={leadStage}
                    onChange={(e) => {
                      const newStage = e.target.value
                      setLeadStage(newStage)
                      if (isNotInterestedOrLostStage(newStage)) {
                        setShowNextActionForClosed(false)
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-extrabold text-blue-700 focus:outline-none focus:border-blue-500 focus:bg-white"
                  >
                    {STAGES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 2: Project, Budget, Client Status */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Primary Project</label>
                  <select
                    value={selectedPropertyId}
                    onChange={(e) => setSelectedPropertyId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                  >
                    <option value="">-- Choose Project --</option>
                    {localProperties.map(p => (
                      <option key={p.id} value={p.id}>
                        {getPropertyDisplayLabel(p)}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const selProp = localProperties.find(p => p.id === selectedPropertyId);
                    const tags = selProp ? getPropertyTags(selProp) : [];
                    if (tags.length === 0) return null;
                    return (
                      <p className="text-[11px] font-semibold text-blue-600 mt-1 truncate">
                        🏷️ Internal Tags: {tags.join(', ')}
                      </p>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Budget Range</label>
                  <select
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                  >
                    <option value="">-- Choose Budget --</option>
                    {BUDGET_OPTIONS.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Client Rating Status</label>
                  <div className="flex items-center space-x-2">
                    {CLIENT_STATUSES.map(cs => (
                      <button
                        type="button"
                        key={cs}
                        onClick={() => setClientStatus(cs)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                          clientStatus === cs
                            ? cs === 'Hot'
                              ? 'bg-rose-50 text-rose-600 border-rose-300'
                              : cs === 'Warm'
                              ? 'bg-amber-50 text-amber-600 border-amber-300'
                              : 'bg-blue-50 text-blue-600 border-blue-300'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {cs === 'Hot' ? '🔥 Hot' : cs === 'Warm' ? '⚡ Warm' : '❄️ Cold'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Followup Detail / Remarks */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Followup Detail & Key Discussion Points <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required={!isDnp}
                  placeholder="Enter notes on what was discussed during the call, client requirements, timeline, etc."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white resize-none"
                />
              </div>
            </div>
          ) : (
            /* DNP View Banner */
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center space-x-3 text-amber-900 text-sm">
              <PhoneCall className="w-5 h-5 text-amber-600 shrink-0" />
              <span>Call marked as <strong>Did Not Pick (DNP)</strong>. Schedule the next follow up attempt below.</span>
            </div>
          )}

          {/* Section: Next Action (Hidden by default for Not Interested/Lost/Dealer stages unless checkbox is checked) */}
          {(() => {
            const isClosedStatus = isNotInterestedOrLostStage(leadStage)
            
            if (isClosedStatus && !showNextActionForClosed) {
              return (
                <div className="pt-4 border-t border-slate-100">
                  <label className="flex items-center space-x-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl cursor-pointer select-none hover:bg-slate-100/80 transition-colors">
                    <input
                      type="checkbox"
                      checked={showNextActionForClosed}
                      onChange={(e) => setShowNextActionForClosed(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="text-xs font-extrabold text-slate-800">Add Next Action / Future Reminder (Optional)</span>
                      <p className="text-[11px] text-slate-500 font-medium">This lead is in a closed/not interested stage ({leadStage}). Next action is not required unless you check this.</p>
                    </div>
                  </label>
                </div>
              )
            }

            return (
              <div className="pt-4 border-t border-slate-100 space-y-4">
                {isClosedStatus && (
                  <div className="flex items-center justify-between pb-2">
                    <label className="flex items-center space-x-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showNextActionForClosed}
                        onChange={(e) => setShowNextActionForClosed(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-700">Add Next Action / Future Reminder</span>
                    </label>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-extrabold text-slate-900">Next Action Schedule</h4>
                  {isClosedStatus && (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">Optional</span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Next Action Date & Time {!isClosedStatus && <span className="text-rose-500">*</span>}
                    </label>
                    <input
                      type="datetime-local"
                      required={!isClosedStatus}
                      value={nextActionDate}
                      onChange={(e) => setNextActionDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Next Action {!isClosedStatus && <span className="text-rose-500">*</span>}
                    </label>
                    <select
                      value={nextActionType}
                      onChange={(e) => setNextActionType(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                    >
                      {NEXT_ACTION_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Assigned To</label>
                    <select
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                    >
                      <option value="">Me (Current User)</option>
                      {teamMembers.map(m => (
                        <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Next Action Remarks / Reminder Notes</label>
                  <input
                    type="text"
                    placeholder="e.g. Try calling again in the afternoon / send project brochure beforehand"
                    value={nextRemarks}
                    onChange={(e) => setNextRemarks(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="remindMe"
                    checked={remindMe}
                    onChange={(e) => setRemindMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="remindMe" className="text-xs font-semibold text-slate-700 cursor-pointer">
                    Send automated push reminder before next action time
                  </label>
                </div>
              </div>
            )
          })()}

          {/* Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center space-x-2 px-6 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-all shadow-md shadow-blue-600/20 active:scale-95"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <CheckSquare className="w-4 h-4" />
                  <span>Save Followup</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}
