'use client'

import { useState } from 'react'
import { 
  Phone, X, CheckCircle2, Clock, 
  AlertCircle, MessageSquare, ThumbsUp, XCircle, Calendar, Loader2 
} from 'lucide-react'
import { toast } from 'sonner'

interface CallFeedbackModalProps {
  isOpen: boolean
  lead: {
    id: string
    name: string
    phone?: string
    pipeline_stage?: string
    dnp_count?: number
  } | null
  onClose: () => void
  onSuccess: (updatedData?: any) => void
  currentUserId?: string | null
}

const OUTCOMES = [
  {
    id: 'CONNECTED',
    label: 'Connected / Spoke',
    icon: ThumbsUp,
    color: 'emerald',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    description: 'Call answered, spoke with lead',
    suggestedStage: 'Contacted'
  },
  {
    id: 'DNP',
    label: 'Did Not Pick (DNP)',
    icon: XCircle,
    color: 'rose',
    badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
    description: 'No answer / Switched off / Busy',
    isDnp: true
  },
  {
    id: 'CALLBACK',
    label: 'Call Back Later',
    icon: Calendar,
    color: 'amber',
    badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    description: 'Customer asked to call back',
    requiresDate: true
  },
  {
    id: 'APPOINTMENT',
    label: 'Appointment / Interested',
    icon: CheckCircle2,
    color: 'blue',
    badgeClass: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    description: 'High intent / Booked visit',
    suggestedStage: 'Appointment booked'
  },
  {
    id: 'UNQUALIFIED',
    label: 'Not Interested / Wrong No',
    icon: AlertCircle,
    color: 'slate',
    badgeClass: 'bg-slate-500/10 text-slate-600 border-slate-500/30',
    description: 'Not looking or fake number',
    suggestedStage: 'Unqualified'
  }
]

export default function CallFeedbackModal({
  isOpen,
  lead,
  onClose,
  onSuccess,
  currentUserId
}: CallFeedbackModalProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<string>('CONNECTED')
  const [stageOverride, setStageOverride] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [followupDate, setFollowupDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen || !lead) return null

  const selectedOutcomeObj = OUTCOMES.find(o => o.id === selectedOutcome)

  const handleSubmit = async () => {
    if (!selectedOutcome) {
      toast.error('Please select a call outcome')
      return
    }

    setIsSubmitting(true)
    try {
      const isDnp = selectedOutcome === 'DNP'
      const targetStage = stageOverride || selectedOutcomeObj?.suggestedStage || lead.pipeline_stage

      const res = await fetch('/api/crm/lead-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          actionType: isDnp ? 'DNP' : 'CALL_FEEDBACK',
          outcome: selectedOutcome,
          description: `📞 Call Feedback: ${selectedOutcomeObj?.label || selectedOutcome}${notes ? ` - ${notes}` : ''}`,
          nextFollowup: followupDate || null,
          updateStage: targetStage !== lead.pipeline_stage ? targetStage : null,
          incrementDnp: isDnp,
          userId: currentUserId
        })
      })

      const data = await res.json()
      if (data.success) {
        toast.success(isDnp ? 'DNP logged successfully' : 'Call feedback saved!')
        onSuccess(data.lead)
        onClose()
      } else {
        toast.error(data.error || 'Failed to save call feedback')
      }
    } catch (err: any) {
      console.error('Call feedback error:', err)
      toast.error('Error saving call feedback')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center border border-emerald-500/20 shadow-sm shrink-0">
              <Phone className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base leading-tight">
                Call Logged: <span className="text-emerald-600 dark:text-emerald-400">{lead.name}</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {lead.phone || 'No phone'} • Select outcome below
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar">
          
          {/* Outcome Selection Cards */}
          <div>
            <label className="block text-[11px] font-black tracking-wider text-slate-400 uppercase mb-2.5">
              Call Outcome <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {OUTCOMES.map((outcome) => {
                const IconComponent = outcome.icon
                const isSelected = selectedOutcome === outcome.id
                return (
                  <button
                    key={outcome.id}
                    type="button"
                    onClick={() => {
                      setSelectedOutcome(outcome.id)
                      if (outcome.suggestedStage) {
                        setStageOverride(outcome.suggestedStage)
                      }
                    }}
                    className={`p-3.5 rounded-2xl border text-left transition-all relative flex items-start gap-3 ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10 shadow-sm ring-2 ring-emerald-500/20'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className={`p-2 rounded-xl border shrink-0 ${outcome.badgeClass}`}>
                      <IconComponent size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-extrabold text-xs text-slate-900 dark:text-white flex items-center gap-1">
                        {outcome.label}
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed mt-0.5">
                        {outcome.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Follow-up Date (If Callback or Scheduled) */}
          {(selectedOutcome === 'CALLBACK' || followupDate) && (
            <div className="p-4 rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 space-y-2 animate-in fade-in">
              <label className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Clock size={14} /> Schedule Follow-up Reminder
              </label>
              <input
                type="datetime-local"
                value={followupDate}
                onChange={(e) => setFollowupDate(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-amber-500/30 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
          )}

          {/* Pipeline Stage Suggestion */}
          <div>
            <label className="block text-[11px] font-black tracking-wider text-slate-400 uppercase mb-1.5">
              Update Lead Stage (Optional)
            </label>
            <select
              value={stageOverride || lead.pipeline_stage || 'New'}
              onChange={(e) => setStageOverride(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 dark:text-white outline-none"
            >
              {['New Lead', 'Contacted', 'Appointment Booked', 'Visit Planned', 'Visit Done', 'Revisit Done', 'Negotiation', 'Deal/Token', 'Lost/NI'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Call Remarks / Notes */}
          <div>
            <label className="block text-[11px] font-black tracking-wider text-slate-400 uppercase mb-1.5">
              Call Notes / Key Details
            </label>
            <div className="relative">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Interested in 3BHK, budget 1.5Cr, call back Saturday..."
                rows={3}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <MessageSquare size={14} className="absolute right-3.5 bottom-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
          >
            Skip Logging
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Saving...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} /> Save Call Log
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}
