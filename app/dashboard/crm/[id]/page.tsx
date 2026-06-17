'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Clock, MessageCircle, CheckCircle2, RefreshCw, Send, Phone, UserPlus, X, ChevronDown, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const STAGES = ['New', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified']

export default function LeadProfilePage() {
  const { id } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  const [lead, setLead] = useState<any>(null)
  const [leadHistory, setLeadHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [remarkInput, setRemarkInput] = useState('')
  const [reminderDate, setReminderDate] = useState('')
  const [pixels, setPixels] = useState<any[]>([])
  const [isLoadingPixels, setIsLoadingPixels] = useState(false)

  // WhatsApp template states
  const [isSendTemplateOpen, setIsSendTemplateOpen] = useState(false)
  const [approvedTemplates, setApprovedTemplates] = useState<any[]>([])
  const [selectedTemplateName, setSelectedTemplateName] = useState('')
  const [selectedTemplateBody, setSelectedTemplateBody] = useState('')
  const [isSendingTemplate, setIsSendingTemplate] = useState(false)

  useEffect(() => {
    if (id) {
      fetchLeadData()
      fetchLeadHistory()
    }
  }, [id])

  useEffect(() => {
    if (lead?.user_id) {
      fetchPixelsForLead(lead.user_id)
    }
  }, [lead?.user_id])

  const fetchPixelsForLead = async (ownerUserId: string) => {
    setIsLoadingPixels(true)
    try {
      const { data: profile } = await supabase.from('profiles').select('ad_account_id').eq('id', ownerUserId).single()
      if (profile?.ad_account_id) {
        const res = await fetch('/api/facebook/pixels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adAccountId: profile.ad_account_id, impersonateId })
        })
        const data = await res.json()
        if (data.pixels) {
          setPixels(data.pixels)
        }
      }
    } catch (e) {
      console.error("Failed to fetch pixels for lead:", e)
    } finally {
      setIsLoadingPixels(false)
    }
  }

  // Realtime subscription to reflect bookings/updates instantly
  useEffect(() => {
    if (!id) return

    const channel = supabase.channel(`lead_detail_${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads', filter: `id=eq.${id}` }, (payload) => {
        setLead(payload.new)
        fetchLeadHistory()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, supabase])

  const fetchLeadData = async () => {
    const { data } = await supabase.from('leads').select('*').eq('id', id).single()
    if (data) setLead(data)
    setLoading(false)
  }

  const fetchLeadHistory = async () => {
    const { data } = await supabase.from('lead_history').select('*').eq('lead_id', id).order('created_at', { ascending: false })
    if (data) setLeadHistory(data)
  }

  const fetchApprovedTemplates = async () => {
    try {
      const res = await fetch('/api/whatsapp/templates')
      const data = await res.json()
      if (data.success) {
        setApprovedTemplates(data.templates || [])
      }
    } catch (e) {
      console.error("Failed to fetch templates:", e)
    }
  }

  useEffect(() => {
    if (isSendTemplateOpen) {
      fetchApprovedTemplates()
    }
  }, [isSendTemplateOpen])

  const handleSendTemplate = async () => {
    if (!selectedTemplateName) return alert("Please select a template")
    setIsSendingTemplate(true)

    const displayPhone = lead.phone || lead.custom_fields?.whatsapp_number || lead.custom_fields?.phone_number || '';
    if (!displayPhone) {
      setIsSendingTemplate(false)
      return alert("Lead does not have a phone number")
    }

    try {
      const res = await fetch('/api/whatsapp/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: displayPhone,
          templateName: selectedTemplateName,
          isSandboxTest: selectedTemplateName === 'hello_world'
        })
      })
      if (res.ok) {
        const desc = `💬 WhatsApp template sent: "${selectedTemplateName}"`
        setLeadHistory([{ id: Date.now(), action_type: 'REMARK', description: desc, created_at: new Date().toISOString() }, ...leadHistory])
        
        await fetch('/api/crm/lead-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: id,
            actionType: 'REMARK',
            description: desc
          })
        })
        
        setIsSendTemplateOpen(false)
        setSelectedTemplateName('')
        setSelectedTemplateBody('')
        alert("WhatsApp template sent successfully!")
      } else {
        alert("Failed to send WhatsApp template.")
      }
    } catch (err) {
      console.error("Error sending template:", err)
      alert("An error occurred while sending the WhatsApp template.")
    } finally {
      setIsSendingTemplate(false)
    }
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

  // --- CRITICAL TIMEZONE FIX APPLIED HERE ---
  const handleSetReminder = async () => {
    if (!reminderDate) return
    
    // 1. Create a true local Date object from the HTML input
    const localDateObj = new Date(reminderDate)
    
    // 2. Convert it to a strict UTC format so Supabase stores it perfectly
    const utcIsoString = localDateObj.toISOString()
    
    const desc = `Follow-up set for ${localDateObj.toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}`
    
    setLeadHistory([{ id: Date.now(), action_type: 'REMINDER_SET', description: desc, created_at: new Date().toISOString() }, ...leadHistory])
    
    // Update local state with the precise UTC string
    setLead({ ...lead, next_followup: utcIsoString })
    setReminderDate('')

    await fetch('/api/crm/lead-action', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
            leadId: id, 
            actionType: 'REMINDER_SET', 
            description: desc, 
            nextFollowup: utcIsoString // Send the strict UTC string to the database
        }) 
    })
  }

  const handleNotesChange = async (newNotes: string) => {
    setLead({ ...lead, notes: newNotes })
    await supabase.from('leads').update({ notes: newNotes }).eq('id', id)
  }

  const handleFieldUpdate = async (field: string, value: any) => {
    setLead({ ...lead, [field]: value })
    await supabase.from('leads').update({ [field]: value }).eq('id', id)
  }

  const downloadVCard = () => {
    if (!lead) return
    // Format name for VCF
    const vcfName = lead.name || 'Lead'
    const vcfPhone = lead.phone || ''
    
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${vcfName}
TEL;TYPE=CELL:${vcfPhone}
EMAIL:${lead.email || ''}
END:VCARD`
    
    const blob = new Blob([vcard], { type: 'text/vcard' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `${vcfName.replace(/\s+/g, '_')}.vcf`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  if (loading) return <div className="p-10 flex justify-center"><RefreshCw className="animate-spin text-slate-400" /></div>
  if (!lead) return <div className="p-10 text-center text-slate-500">Lead not found.</div>

  return (
    <div className="max-w-7xl mx-auto min-h-screen bg-[#F8FAFC] flex flex-col pb-safe pb-32">
        {/* Header */}
        <div className="p-5 bg-white border-b border-slate-200 flex items-center gap-3 sticky top-0 z-10">
            <button onClick={() => router.push(impersonateId ? `/dashboard/crm?impersonate=${impersonateId}` : '/dashboard/crm')} className="p-2 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                <ArrowLeft size={18} />
            </button>
            <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-slate-900 truncate">{lead.name}</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                    <p className="text-xs font-medium text-slate-500 truncate">{lead.phone} {lead.email ? `• ${lead.email}` : ''}</p>
                    <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md border border-blue-200">
                        {lead.pipeline_stage || 'New'}
                    </span>
                    {lead.booked_time && (
                        <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1 shadow-sm shrink-0">
                            📆 Booked: {new Date(lead.booked_time).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
                        </span>
                    )}
                </div>
            </div>
            {lead.phone && (
                <div className="flex gap-2">
                    <button onClick={downloadVCard} className="p-3 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-full shadow-sm transition-colors" title="Save to Contacts">
                        <UserPlus size={18}/>
                    </button>
                    <button onClick={() => setIsSendTemplateOpen(true)} className="p-3 bg-[#25D366] text-white hover:bg-[#22c35e] rounded-full shadow-sm transition-colors flex items-center gap-1.5 px-4 font-bold text-xs animate-pulse" title="Send WhatsApp Template">
                        <MessageCircle size={18}/>
                        <span>Send Template</span>
                    </button>
                    <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="p-3 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366] hover:text-white rounded-full shadow-sm transition-colors" title="Direct WhatsApp Chat"><MessageCircle size={18}/></a>
                    <a href={`tel:${lead.phone}`} className="p-3 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-full shadow-sm transition-colors" title="Call Lead"><Phone size={18}/></a>
                </div>
            )}
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 lg:p-8 flex-1 w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            
            {/* Left Column: Details */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-6">
            
            {/* Meta Card */}
            <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Lead Source</span>
                    <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md">{lead.source}</span>
                </div>
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Target Meta Pixel</span>
                    {isLoadingPixels ? (
                        <span className="text-[10px] text-slate-400 animate-pulse font-bold">Loading...</span>
                    ) : (
                        <select 
                            value={lead.pixel_id || ''} 
                            onChange={(e) => handleFieldUpdate('pixel_id', e.target.value || null)}
                            className="bg-purple-50 text-purple-700 text-xs font-bold rounded-md border border-purple-200 px-2 py-1 outline-none cursor-pointer"
                        >
                            <option value="">Profile Default</option>
                            {pixels.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    )}
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

            {/* Google Calendar Booking Details */}
            {lead.booked_time && (
                <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase ml-2 flex items-center gap-1.5 mb-2">
                        <span className="text-emerald-500 text-lg">📆</span> Google Calendar Booking
                    </h3>
                    <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <span className="block text-xs font-medium text-slate-500">Scheduled Time</span>
                            <span className="text-base font-extrabold text-slate-800">
                                {new Date(lead.booked_time).toLocaleString([], {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'})}
                            </span>
                        </div>
                        <span className="text-xs font-black bg-emerald-500 text-white px-3 py-1 rounded-full uppercase tracking-wider">
                            Confirmed
                        </span>
                    </div>
                </div>
            )}

            {/* Custom Qualification Questions */}
            {lead.custom_fields && Object.keys(lead.custom_fields).length > 0 && (
                <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                        <CheckCircle2 size={12} className="text-emerald-500"/> Qualification Details
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {Object.entries(lead.custom_fields).map(([key, value]) => (
                            <div key={key} className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                <span className="block text-[9px] font-bold text-slate-400 uppercase mb-1">{key.replace(/_/g, ' ')}</span>
                                <span className="text-xs font-bold text-slate-700">{String(value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Context & Tags */}
            <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">Priority Status</label>
                    <div className="flex flex-wrap gap-2">
                        {['Hot', 'Warm', 'Cold'].map(status => (
                            <button 
                                key={status} 
                                onClick={() => handleFieldUpdate('priority_status', status)} 
                                className={`py-1.5 px-3 rounded-xl text-xs font-bold border transition-all ${lead.priority_status === status ? (status === 'Hot' ? 'bg-red-500 text-white border-red-500' : status === 'Warm' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-500 text-white border-blue-500') : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1.5">Budget</label>
                        <input 
                            type="text" 
                            defaultValue={lead.budget || ''}
                            onBlur={(e) => handleFieldUpdate('budget', e.target.value)}
                            className="w-full bg-slate-50 p-2.5 rounded-xl text-sm border border-slate-100 outline-none focus:border-blue-300"
                            placeholder="e.g. 50L - 1Cr"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1.5">Timeline</label>
                        <input 
                            type="text" 
                            defaultValue={lead.timeline || ''}
                            onBlur={(e) => handleFieldUpdate('timeline', e.target.value)}
                            className="w-full bg-slate-50 p-2.5 rounded-xl text-sm border border-slate-100 outline-none focus:border-blue-300"
                            placeholder="e.g. 1 Month"
                        />
                    </div>
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
                    <button onClick={handleSetReminder} className="bg-amber-100 text-amber-700 px-5 rounded-xl text-xs font-bold shrink-0 hover:bg-amber-200 transition-colors">Set Alert</button>
                </div>
            </div>

            </div>
            
            {/* Right Column: Activity Log & Notes */}
            <div className="lg:col-span-5 xl:col-span-4 flex flex-col">
                <div className="bg-white rounded-2xl sm:rounded-[2rem] shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden sticky top-24">
                    {/* Activity Log Header */}
                    <div className="p-5 border-b border-slate-100 bg-white">
                        <h3 className="text-base font-bold text-slate-900">Activity Log</h3>
                    </div>
                    
                    {/* Timeline Log */}
                    <div className="p-5 flex-1 overflow-y-auto max-h-[50vh] lg:max-h-[calc(100vh-350px)] custom-scrollbar">
                        <div className="space-y-5 relative before:absolute before:inset-0 before:ml-[22px] before:-translate-x-px before:h-full before:w-[2px] before:bg-slate-200 before:rounded-full">
                            {leadHistory.map((item, index) => {
                                const isRemark = item.action_type === 'REMARK'
                                const isReminder = item.action_type === 'REMINDER_SET'
                                return (
                                    <div key={item.id} className="relative flex items-start gap-4">
                                        <div className={`flex items-center justify-center w-11 h-11 rounded-full border-[3px] border-white shrink-0 z-10 shadow-sm ${isRemark ? 'bg-blue-100 text-blue-600' : isReminder ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
                                            {isRemark ? <MessageCircle size={16}/> : isReminder ? <Clock size={16} /> : <CheckCircle2 size={16} />}
                                        </div>
                                        <div className="flex-1 min-w-0 bg-slate-50 p-4 rounded-2xl border border-slate-100 mt-0.5">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <div className="font-bold text-xs text-slate-900 capitalize truncate pr-2">{item.action_type.replace('_', ' ')}</div>
                                                <time className="text-[10px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded-md border border-slate-100 shrink-0">{new Date(item.created_at).toLocaleString([], {hour: '2-digit', minute:'2-digit', month: 'short', day: 'numeric'})}</time>
                                            </div>
                                            <div className="text-xs text-slate-600 leading-relaxed break-words font-medium">{item.description}</div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                    
                    {/* Note Footer */}
                    <div className="p-4 bg-white border-t border-slate-100 shrink-0 sticky bottom-0 z-10 pb-28 lg:pb-4">
                        <div className="flex gap-2">
                            <input type="text" value={remarkInput} onChange={e => setRemarkInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddRemark()} placeholder="Type a note or remark..." className="flex-1 bg-slate-50 hover:bg-slate-100 focus:bg-white border border-slate-200 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 rounded-full px-5 text-sm outline-none transition-all" />
                            <button onClick={handleAddRemark} disabled={!remarkInput.trim()} className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center disabled:opacity-50 hover:bg-slate-800 active:scale-95 transition-all shadow-md shrink-0"><Send size={18} className="ml-1 -mt-0.5" /></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

      {/* SEND WHATSAPP TEMPLATE MODAL */}
      {isSendTemplateOpen && (
          <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
              <div className="bg-white w-full max-w-md rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden">
                  <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
                      <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                          <MessageCircle size={22} className="text-[#25D366]" />
                          Send WhatsApp Template
                      </h2>
                      <button onClick={() => setIsSendTemplateOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                  </div>
                  
                  <div className="p-6 space-y-4">
                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Select WhatsApp Template</label>
                          <div className="relative">
                              <select 
                                  value={selectedTemplateName} 
                                  onChange={(e) => {
                                      const name = e.target.value;
                                      setSelectedTemplateName(name);
                                      const t = approvedTemplates.find(x => x.name === name);
                                      setSelectedTemplateBody(t?.components?.find((c: any) => c.type === 'BODY')?.text || '');
                                  }}
                                  className="w-full appearance-none bg-slate-50 border border-slate-100 py-3.5 px-5 rounded-2xl text-sm font-bold text-slate-900 focus:ring-4 focus:ring-blue-500/10 outline-none cursor-pointer"
                              >
                                  <option value="">Choose template...</option>
                                  {approvedTemplates.map(t => (
                                      <option key={t.name} value={t.name}>{t.name} ({t.status})</option>
                                  ))}
                              </select>
                              <ChevronDown size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>
                      </div>

                      {selectedTemplateBody && (
                          <div className="space-y-3">
                              <div className="space-y-1">
                                  <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Template Content</label>
                                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/50 text-xs text-slate-600 leading-relaxed font-semibold font-sans whitespace-pre-wrap">
                                      {selectedTemplateBody}
                                  </div>
                              </div>
                              <div className="bg-blue-50/50 border border-blue-100 p-3.5 rounded-2xl text-[10px] text-blue-800 leading-normal font-bold">
                                  ℹ️ Variables like lead name and company name are mapped automatically when sent to Meta.
                              </div>
                          </div>
                      )}

                      <button 
                          onClick={handleSendTemplate} 
                          disabled={isSendingTemplate || !selectedTemplateName} 
                          className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-50 disabled:scale-100 mt-2"
                      >
                          {isSendingTemplate ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} 
                          {isSendingTemplate ? 'Sending Message...' : 'Send Message'}
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  )
}