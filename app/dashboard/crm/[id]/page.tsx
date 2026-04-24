'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Clock, MessageCircle, CheckCircle2, RefreshCw, Send, Phone } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed']

export default function LeadProfilePage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()

  const [lead, setLead] = useState<any>(null)
  const [leadHistory, setLeadHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [remarkInput, setRemarkInput] = useState('')
  const [reminderDate, setReminderDate] = useState('')

  useEffect(() => {
    if (id) {
      fetchLeadData()
      fetchLeadHistory()
    }
  }, [id])

  const fetchLeadData = async () => {
    const { data } = await supabase.from('leads').select('*').eq('id', id).single()
    if (data) setLead(data)
    setLoading(false)
  }

  const fetchLeadHistory = async () => {
    const { data } = await supabase.from('lead_history').select('*').eq('lead_id', id).order('created_at', { ascending: false })
    if (data) setLeadHistory(data)
  }

  const updateStage = async (newStage: string) => {
    setLead({ ...lead, pipeline_stage: newStage })
    const desc = `Moved to ${newStage}`
    setLeadHistory([{ id: Date.now(), action_type: 'STATUS_CHANGE', description: desc, created_at: new Date().toISOString() }, ...leadHistory])

    await fetch('/api/crm/update-stage', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ leadId: id, newStage, notes: lead?.notes }) 
    })
    
    await fetch('/api/crm/lead-action', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ leadId: id, actionType: 'STATUS_CHANGE', description: desc }) 
    })
  }

  const handleAddRemark = async () => {
    if (!remarkInput.trim()) return
    const text = remarkInput
    setLeadHistory([{ id: Date.now(), action_type: 'REMARK', description: text, created_at: new Date().toISOString() }, ...leadHistory])
    setRemarkInput('')

    await fetch('/api/crm/lead-action', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ leadId: id, actionType: 'REMARK', description: text }) 
    })
  }

  const handleSetReminder = async () => {
    if (!reminderDate) return
    const desc = `Follow-up set for ${new Date(reminderDate).toLocaleString()}`
    
    setLeadHistory([{ id: Date.now(), action_type: 'REMINDER_SET', description: desc, created_at: new Date().toISOString() }, ...leadHistory])
    setLead({ ...lead, next_followup: reminderDate })
    setReminderDate('')

    await fetch('/api/crm/lead-action', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ leadId: id, actionType: 'REMINDER_SET', description: desc, nextFollowup: reminderDate }) 
    })
  }

  const handleNotesChange = async (newNotes: string) => {
    setLead({ ...lead, notes: newNotes })
    await supabase.from('leads').update({ notes: newNotes }).eq('id', id)
  }

  if (loading) return <div className="p-10 flex justify-center"><RefreshCw className="animate-spin text-slate-400" /></div>
  if (!lead) return <div className="p-10 text-center text-slate-500">Lead not found.</div>

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col pb-safe">
        {/* Header */}
        <div className="p-5 bg-white border-b border-slate-200 flex items-center gap-3 sticky top-0 z-10">
            <button onClick={() => router.push('/dashboard/crm')} className="p-2 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                <ArrowLeft size={18} />
            </button>
            <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-slate-900 truncate">{lead.name}</h2>
                <p className="text-xs font-medium text-slate-500 mt-0.5 truncate">{lead.phone} {lead.email ? `• ${lead.email}` : ''}</p>
            </div>
            <a href={`tel:${lead.phone}`} className="p-3 bg-blue-50 text-blue-600 rounded-full shadow-sm"><Phone size={18}/></a>
        </div>

        {/* Content Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-6">
            
            {/* Meta Card */}
            <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Lead Source</span>
                    <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md">{lead.source}</span>
                </div>
                {lead.ad_name && (
                    <p className="text-xs font-medium text-slate-600 mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                        <span className="font-bold text-slate-400 block mb-0.5 text-[10px] uppercase">Campaign / Ad</span>
                        {lead.ad_name}
                    </p>
                )}
                <div className="mt-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1.5 ml-1">Static Notes</label>
                    <textarea 
                        className="w-full bg-slate-50 p-3 rounded-xl text-sm border border-slate-100 outline-none resize-none" 
                        rows={2} 
                        defaultValue={lead.notes || ''}
                        onBlur={(e) => handleNotesChange(e.target.value)}
                    />
                </div>
            </div>

            {/* Stages */}
            <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">Pipeline Stage</label>
                <div className="flex flex-wrap gap-2">
                    {STAGES.map(stage => (
                        <button key={stage} onClick={() => updateStage(stage)} className={`py-2 px-3.5 rounded-xl text-xs font-bold border transition-all ${lead.pipeline_stage === stage ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200'}`}>
                            {stage}
                        </button>
                    ))}
                </div>
            </div>

            {/* Reminders */}
            <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-400" />
                <label className="text-[10px] font-bold text-slate-500 uppercase ml-2 flex items-center gap-1 mb-2">
                    <Clock size={12} className="text-amber-500"/> Set Follow-up Reminder
                </label>
                <div className="flex gap-2 w-full pl-1">
                    <input type="datetime-local" value={reminderDate} onChange={e => setReminderDate(e.target.value)} className="flex-1 min-w-0 bg-slate-50 p-2.5 rounded-xl text-sm border outline-none" />
                    <button onClick={handleSetReminder} className="bg-amber-100 text-amber-700 px-5 rounded-xl text-xs font-bold shrink-0">Set Alert</button>
                </div>
            </div>

            {/* Timeline Log */}
            <div className="pt-2">
                <h3 className="text-sm font-bold text-slate-900 mb-5 ml-1">Activity Log</h3>
                <div className="space-y-5 relative before:absolute before:inset-0 before:ml-[22px] before:-translate-x-px before:h-full before:w-[2px] before:bg-slate-200 before:rounded-full">
                    {leadHistory.map((item, index) => {
                        const isRemark = item.action_type === 'REMARK'
                        const isReminder = item.action_type === 'REMINDER_SET'
                        return (
                            <div key={item.id} className="relative flex items-start gap-4">
                                <div className={`flex items-center justify-center w-11 h-11 rounded-full border-[3px] border-slate-50 shrink-0 z-10 ${isRemark ? 'bg-blue-100 text-blue-600' : isReminder ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
                                    {isRemark ? <MessageCircle size={16}/> : isReminder ? <Clock size={16} /> : <CheckCircle2 size={16} />}
                                </div>
                                <div className="flex-1 min-w-0 bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mt-0.5">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="font-bold text-xs text-slate-900 capitalize">{item.action_type.replace('_', ' ')}</div>
                                        <time className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-md border">{new Date(item.created_at).toLocaleString([], {hour: '2-digit', minute:'2-digit', month: 'short', day: 'numeric'})}</time>
                                    </div>
                                    <div className="text-xs text-slate-600 leading-relaxed break-words font-medium">{item.description}</div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>

        {/* Note Footer */}
        <div className="p-4 bg-white border-t border-slate-200 shrink-0 sticky bottom-0">
            <div className="flex gap-2">
                <input type="text" value={remarkInput} onChange={e => setRemarkInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddRemark()} placeholder="Type a note or remark..." className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-5 text-sm outline-none" />
                <button onClick={handleAddRemark} disabled={!remarkInput.trim()} className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center disabled:opacity-50"><Send size={18} className="ml-1" /></button>
            </div>
        </div>
    </div>
  )
}