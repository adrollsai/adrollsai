'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Clock, MessageCircle, CheckCircle2, RefreshCw, Send, Phone, UserPlus, X, ChevronDown, Loader2, History } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

const STAGES = ['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified']

function cleanTranscript(transcript: any[]) {
    if (!Array.isArray(transcript)) return []
    const merged: any[] = []
    let current: any = null
    for (const item of transcript) {
        if (!item || !item.message) continue
        const msg = item.message.trim()
        const role = item.role
        if (!current) {
            current = { role, message: msg }
        } else if (current.role === role) {
            if (/^[.,!?;:]/.test(msg)) {
                current.message += msg
            } else {
                current.message += ' ' + msg
            }
        } else {
            merged.push(current)
            current = { role, message: msg }
        }
    }
    if (current) merged.push(current)
    return merged
}

export default function LeadProfilePage() {
    const { id } = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const impersonateId = searchParams.get('impersonate')
    const supabase = createClient()

    const [lead, setLead] = useState<any>(null)
    const [nextLeadId, setNextLeadId] = useState<string | null>(null)
    const [isAddingCustomField, setIsAddingCustomField] = useState(false)
    const [newFieldKey, setNewFieldKey] = useState('')
    const [newFieldValue, setNewFieldValue] = useState('')
    const [leadHistory, setLeadHistory] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [remarkInput, setRemarkInput] = useState('')
    const [reminderDate, setReminderDate] = useState('')
    const [pixels, setPixels] = useState<any[]>([])
    const [isLoadingPixels, setIsLoadingPixels] = useState(false)
    const [isCalling, setIsCalling] = useState(false)
    const [showTranscript, setShowTranscript] = useState(false)

    // Call history states
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
    const [selectedHistoryCall, setSelectedHistoryCall] = useState<any>(null)
    const [isAllHistoryModalOpen, setIsAllHistoryModalOpen] = useState(false)

    // WhatsApp template states
    const [isSendTemplateOpen, setIsSendTemplateOpen] = useState(false)
    const [approvedTemplates, setApprovedTemplates] = useState<any[]>([])
    const [selectedTemplateName, setSelectedTemplateName] = useState('')
    const [selectedTemplateBody, setSelectedTemplateBody] = useState('')
    const [isSendingTemplate, setIsSendingTemplate] = useState(false)
 
    // Editing schedule states
    const [isEditingBooking, setIsEditingBooking] = useState(false)
    const [tempBookingTime, setTempBookingTime] = useState('')
    const [isEditingCallback, setIsEditingCallback] = useState(false)
    const [tempCallbackTime, setTempCallbackTime] = useState('')

    useEffect(() => {
        if (id) {
            fetchLeadData()
            fetchLeadHistory()
        }
    }, [id])

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
                const newHist = { id: Date.now(), action_type: 'REMARK', description: desc, created_at: new Date().toISOString() }
                setLeadHistory([newHist, ...leadHistory])
                updateLocalCRMCacheWithHistory(newHist)

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
                let errMsg = "Failed to send WhatsApp template."
                try {
                    const errData = await res.json()
                    if (errData && errData.error) {
                        errMsg = `Failed to send WhatsApp template: ${errData.error}`
                    }
                } catch (e) {}
                alert(errMsg)
            }
        } catch (err) {
            console.error("Error sending template:", err)
            alert("An error occurred while sending the WhatsApp template.")
        } finally {
            setIsSendingTemplate(false)
        }
    }

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
                const updatedLead = payload.new;
                let parsedCustomFields = updatedLead.custom_fields;
                if (parsedCustomFields && typeof parsedCustomFields === 'string') {
                    try {
                        while (typeof parsedCustomFields === 'string') {
                            parsedCustomFields = JSON.parse(parsedCustomFields);
                        }
                    } catch (e) {
                        parsedCustomFields = {};
                    }
                }
                updatedLead.custom_fields = parsedCustomFields;
                setLead(updatedLead)
                updateLocalCRMCache(updatedLead)
                fetchLeadHistory()
            })
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [id, supabase])

    // Polling fallback to check status when a call is in progress
    useEffect(() => {
        if (!id || lead?.voice_call_status !== 'calling') return

        const interval = setInterval(async () => {
            const { data } = await supabase
                .from('leads')
                .select('*')
                .eq('id', id)
                .single()

            if (data && data.voice_call_status !== 'calling') {
                let parsedCustomFields = data.custom_fields;
                if (parsedCustomFields && typeof parsedCustomFields === 'string') {
                    try {
                        while (typeof parsedCustomFields === 'string') {
                            parsedCustomFields = JSON.parse(parsedCustomFields);
                        }
                    } catch (e) {
                        parsedCustomFields = {};
                    }
                }
                data.custom_fields = parsedCustomFields;
                setLead(data)
                updateLocalCRMCache(data)
                fetchLeadHistory()
            }
        }, 4000)

        return () => clearInterval(interval)
    }, [id, lead?.voice_call_status, supabase])

    const fetchNextLeadId = async (currentLead: any) => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()

            const currentRole = profile?.role || 'admin'

            let query = supabase
                .from('leads')
                .select('id, created_at, facebook_created_at')
                .eq('pipeline_stage', currentLead.pipeline_stage)

            if (currentRole === 'super_admin') {
                query = query.eq('user_id', currentLead.user_id)
            } else if (currentRole === 'agency') {
                const urlParams = new URLSearchParams(window.location.search)
                const impId = urlParams.get('impersonate')
                if (impId) {
                    query = query.eq('user_id', impId)
                } else {
                    const { data: clientIds } = await supabase.from('profiles').select('id').eq('agency_id', user.id)
                    const allIds = [user.id, ...(clientIds?.map((c: any) => c.id) || [])]
                    query = query.in('user_id', allIds)
                }
            } else if (currentRole === 'admin' || currentRole === 'client') {
                query = query.eq('user_id', currentLead.user_id)
            } else {
                query = query.eq('assigned_to', user.id)
            }

            const { data: siblingData } = await query
            if (siblingData && siblingData.length > 0) {
                const siblingLeads = [...siblingData].sort((a: any, b: any) => {
                    const timeA = new Date(a.facebook_created_at || a.created_at).getTime()
                    const timeB = new Date(b.facebook_created_at || b.created_at).getTime()
                    return timeB - timeA
                })

                const currentIndex = siblingLeads.findIndex((l: any) => l.id === currentLead.id)
                if (currentIndex !== -1 && currentIndex + 1 < siblingLeads.length) {
                    setNextLeadId(siblingLeads[currentIndex + 1].id)
                } else if (siblingLeads.length > 1) {
                    setNextLeadId(siblingLeads[0].id) // Wrap around
                } else {
                    setNextLeadId(null)
                }
            } else {
                setNextLeadId(null)
            }
        } catch (e) {
            console.error("Failed to fetch sibling leads:", e)
        }
    }

    const handleNextLead = () => {
        if (nextLeadId) {
            router.push(`/dashboard/crm/${nextLeadId}${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
        }
    }

    const updateLocalCRMCache = async (updatedLead: any) => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()

            const currentRole = profile?.role || 'admin'
            
            const keysToTry = [
                `crm_cache_${user.id}`,
                `crm_cache_${updatedLead.user_id}`
            ]
            
            for (const key of keysToTry) {
                const cachedStr = localStorage.getItem(key)
                if (cachedStr) {
                    try {
                        const cached = JSON.parse(cachedStr)
                        if (Array.isArray(cached)) {
                            const idx = cached.findIndex((l: any) => l.id === updatedLead.id)
                            if (idx !== -1) {
                                cached[idx] = { ...cached[idx], ...updatedLead }
                                localStorage.setItem(key, JSON.stringify(cached))
                                console.log(`[CRM Cache] Updated lead ${updatedLead.id} in cache ${key}`)
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to parse cache for key ${key}:`, e)
                    }
                }
            }
        } catch (e) {
            console.error("Failed to update CRM local cache:", e)
        }
    }

    const updateLocalCRMCacheWithHistory = async (newHistoryItem: any) => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const keysToTry = [
                `crm_cache_${user.id}`,
                `crm_cache_${lead?.user_id}`
            ]

            for (const key of keysToTry) {
                const cachedStr = localStorage.getItem(key)
                if (cachedStr) {
                    try {
                        const cached = JSON.parse(cachedStr)
                        if (Array.isArray(cached)) {
                            const idx = cached.findIndex((l: any) => l.id === id)
                            if (idx !== -1) {
                                const currentHistory = cached[idx].lead_history || []
                                cached[idx].lead_history = [newHistoryItem, ...currentHistory]
                                localStorage.setItem(key, JSON.stringify(cached))
                                console.log(`[CRM Cache] Added history item to lead ${id} in cache ${key}`)
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to parse cache for key ${key}:`, e)
                    }
                }
            }
        } catch (e) {
            console.error("Failed to update CRM local cache history:", e)
        }
    }

    const fetchLeadData = async () => {
        setNextLeadId(null)
        const { data } = await supabase.from('leads').select('*').eq('id', id).single()
        if (data) {
            let parsedCustomFields = data.custom_fields;
            if (parsedCustomFields && typeof parsedCustomFields === 'string') {
                try {
                    while (typeof parsedCustomFields === 'string') {
                        parsedCustomFields = JSON.parse(parsedCustomFields);
                    }
                } catch (e) {
                    parsedCustomFields = {};
                }
            }
            data.custom_fields = parsedCustomFields;
            setLead(data)
            updateLocalCRMCache(data)
            fetchNextLeadId(data)
        }
        setLoading(false)
    }

    const fetchLeadHistory = async () => {
        const { data } = await supabase.from('lead_history').select('*').eq('lead_id', id).order('created_at', { ascending: false })
        if (data) setLeadHistory(data)
    }

    const handleAddCustomField = async () => {
        if (!newFieldKey.trim() || !newFieldValue.trim()) {
            return alert("Both field name and value are required")
        }

        let currentFields = lead.custom_fields || {}
        if (typeof currentFields === 'string') {
            try {
                currentFields = JSON.parse(currentFields)
            } catch (e) {
                currentFields = {}
            }
        }

        const updatedFields = {
            ...currentFields,
            [newFieldKey.trim()]: newFieldValue.trim()
        }

        setLead({ ...lead, custom_fields: updatedFields })

        const { error } = await supabase
            .from('leads')
            .update({ custom_fields: updatedFields })
            .eq('id', id)

        if (error) {
            toast.error("Failed to add custom field")
        } else {
            toast.success("Custom field added!")
            setIsAddingCustomField(false)
            setNewFieldKey('')
            setNewFieldValue('')
        }
    }

    const handleDeleteCustomField = async (keyToDelete: string) => {
        if (!confirm(`Are you sure you want to delete the field "${keyToDelete}"?`)) return

        let currentFields = lead.custom_fields || {}
        if (typeof currentFields === 'string') {
            try {
                currentFields = JSON.parse(currentFields)
            } catch (e) {
                currentFields = {}
            }
        }

        const updatedFields = { ...currentFields }
        delete updatedFields[keyToDelete]

        setLead({ ...lead, custom_fields: updatedFields })

        const { error } = await supabase
            .from('leads')
            .update({ custom_fields: updatedFields })
            .eq('id', id)

        if (error) {
            toast.error("Failed to delete custom field")
        } else {
            toast.success("Custom field deleted!")
        }
    }

    const handleToggleCallingEnabled = async (checked: boolean) => {
        if (!lead) return
        try {
            const { error } = await supabase
                .from('leads')
                .update({ calling_enabled: checked })
                .eq('id', lead.id)
            
            if (error) throw error
            
            const updatedLead = { ...lead, calling_enabled: checked }
            setLead(updatedLead)
            updateLocalCRMCache(updatedLead)
            toast.success(checked ? "Auto-calling enabled" : "Auto-calling stopped")
        } catch (e) {
            console.error("Failed to toggle calling:", e)
            toast.error("Failed to update calling settings")
        }
    }

    const toLocalDateTimeString = (utcStr: string) => {
        if (!utcStr) return ''
        const d = new Date(utcStr)
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const hours = String(d.getHours()).padStart(2, '0')
        const minutes = String(d.getMinutes()).padStart(2, '0')
        return `${year}-${month}-${day}T${hours}:${minutes}`
    }

    const handleDeleteCallback = async () => {
        if (!confirm("Are you sure you want to cancel the scheduled AI callback?")) return
        try {
            const { error } = await supabase
                .from('leads')
                .update({ 
                    voice_call_scheduled_at: null,
                    voice_call_status: 'completed'
                })
                .eq('id', id)
            if (error) throw error
            const nextLead = { ...lead, voice_call_scheduled_at: null, voice_call_status: 'completed' }
            setLead(nextLead)
            updateLocalCRMCache(nextLead)
            toast.success("Scheduled call cancelled")
        } catch (e) {
            console.error("Failed to delete callback:", e)
            toast.error("Failed to cancel scheduled call")
        }
    }

    const handleUpdateCallback = async (newTimeStr: string) => {
        if (!newTimeStr) return
        try {
            const localDate = new Date(newTimeStr)
            const utcIso = localDate.toISOString()
            const { error } = await supabase
                .from('leads')
                .update({ 
                    voice_call_scheduled_at: utcIso,
                    voice_call_status: 'scheduled_callback'
                })
                .eq('id', id)
            if (error) throw error
            const nextLead = { ...lead, voice_call_scheduled_at: utcIso, voice_call_status: 'scheduled_callback' }
            setLead(nextLead)
            updateLocalCRMCache(nextLead)
            toast.success("Scheduled call updated")
        } catch (e) {
            console.error("Failed to update callback:", e)
            toast.error("Failed to update scheduled call time")
        }
    }

    const handleDeleteBooking = async () => {
        if (!confirm("Are you sure you want to cancel this booking/appointment?")) return
        try {
            const { error } = await supabase
                .from('leads')
                .update({ 
                    booked_time: null,
                    meet_link: null,
                    google_calendar_event_id: null
                })
                .eq('id', id)
            if (error) throw error
            const nextLead = { 
                ...lead, 
                booked_time: null, 
                meet_link: null, 
                google_calendar_event_id: null 
            }
            setLead(nextLead)
            updateLocalCRMCache(nextLead)
            toast.success("Booking/Appointment cancelled")
        } catch (e) {
            console.error("Failed to delete booking:", e)
            toast.error("Failed to cancel booking")
        }
    }

    const handleUpdateBooking = async (newTimeStr: string) => {
        if (!newTimeStr) return
        try {
            const localDate = new Date(newTimeStr)
            const utcIso = localDate.toISOString()
            const { error } = await supabase
                .from('leads')
                .update({ 
                    booked_time: utcIso 
                })
                .eq('id', id)
            if (error) throw error
            const nextLead = { ...lead, booked_time: utcIso }
            setLead(nextLead)
            updateLocalCRMCache(nextLead)
            toast.success("Booking/Appointment time updated")
        } catch (e) {
            console.error("Failed to update booking:", e)
            toast.error("Failed to update booking time")
        }
    }

    const updateStage = async (newStage: string) => {
        const nextLead = { ...lead, pipeline_stage: newStage }
        setLead(nextLead)
        updateLocalCRMCache(nextLead)
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
        const newHist = { id: Date.now(), action_type: 'REMARK', description: text, created_at: new Date().toISOString() }
        setLeadHistory([newHist, ...leadHistory])
        updateLocalCRMCacheWithHistory(newHist)
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

        const desc = `Follow-up set for ${localDateObj.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`

        setLeadHistory([{ id: Date.now(), action_type: 'REMINDER_SET', description: desc, created_at: new Date().toISOString() }, ...leadHistory])

        // Update local state with the precise UTC string
        const nextLead = { ...lead, next_followup: utcIsoString }
        setLead(nextLead)
        updateLocalCRMCache(nextLead)
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
        const nextLead = { ...lead, notes: newNotes }
        setLead(nextLead)
        updateLocalCRMCache(nextLead)
        await supabase.from('leads').update({ notes: newNotes }).eq('id', id)
    }

    const handleTriggerCall = async () => {
        setIsCalling(true)
        try {
            const res = await fetch(`/api/voice/call${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId: id })
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Outbound voice call initiated successfully! 🎙️')
                fetchLeadData()
            } else {
                toast.error(data.error || 'Failed to initiate call.')
            }
        } catch (err: any) {
            toast.error(err.message || 'An error occurred triggering call.')
        } finally {
            setIsCalling(false)
        }
    }

    const handleFieldUpdate = async (field: string, value: any) => {
        const nextLead = { ...lead, [field]: value }
        setLead(nextLead)
        updateLocalCRMCache(nextLead)
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
            <div className="p-5 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sticky top-0 z-10">
                <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                    <button onClick={() => router.push(impersonateId ? `/dashboard/crm?impersonate=${impersonateId}` : '/dashboard/crm')} className="p-2 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors shrink-0">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-bold text-slate-900 break-words sm:truncate leading-tight">{lead.name}</h2>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                            <p className="text-xs font-medium text-slate-500 break-all">{lead.phone} {lead.email ? `• ${lead.email}` : ''}</p>
                            <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md border border-blue-200 shrink-0">
                                {lead.pipeline_stage || 'New'}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded-md shrink-0">
                                📅 Created: {new Date(lead.facebook_created_at || lead.created_at).toLocaleString([], {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit'})}
                            </span>
                            {lead.booked_time && (
                                <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1 shadow-sm shrink-0">
                                    📆 Booked: {new Date(lead.booked_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                {(lead.phone || nextLeadId) && (
                    <div className="flex gap-2 w-full sm:w-auto justify-end sm:justify-start pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 items-center">
                        {nextLeadId && (
                            <button 
                                onClick={handleNextLead} 
                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shrink-0 transition-colors shadow-sm active:scale-95"
                                title="Go to next lead in this stage"
                            >
                                Next Lead →
                            </button>
                        )}
                        {lead.phone && (
                            <>
                                <button onClick={downloadVCard} className="p-3 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-full shadow-sm transition-colors" title="Save to Contacts">
                                    <UserPlus size={18} />
                                </button>
                                <button onClick={() => setIsSendTemplateOpen(true)} className="p-3 bg-[#25D366] text-white hover:bg-[#22c35e] rounded-full shadow-sm transition-colors flex items-center gap-1.5 px-4 font-bold text-xs animate-pulse" title="Send WhatsApp Template">
                                    <MessageCircle size={18} />
                                    <span>Send Template</span>
                                </button>
                                <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="p-3 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366] hover:text-white rounded-full shadow-sm transition-colors" title="Direct WhatsApp Chat"><MessageCircle size={18} /></a>
                                <a href={`tel:${lead.phone}`} className="p-3 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-full shadow-sm transition-colors" title="Call Lead"><Phone size={18} /></a>
                            </>
                        )}
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
                            {isEditingBooking ? (
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3 ml-2">
                                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Change Appointment Time</span>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <input 
                                            type="datetime-local" 
                                            defaultValue={toLocalDateTimeString(lead.booked_time)} 
                                            onChange={(e) => setTempBookingTime(e.target.value)}
                                            className="bg-white border border-slate-200/80 p-2 rounded-lg text-xs font-bold outline-none"
                                        />
                                        <button 
                                            onClick={async () => {
                                                const timeToSave = tempBookingTime || toLocalDateTimeString(lead.booked_time)
                                                await handleUpdateBooking(timeToSave)
                                                setIsEditingBooking(false)
                                            }}
                                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black px-4.5 py-2 rounded-full transition-all shadow-sm"
                                        >
                                            Save
                                        </button>
                                        <button 
                                            onClick={() => setIsEditingBooking(false)}
                                            className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-black px-4.5 py-2 rounded-full transition-all shadow-sm"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                    <div>
                                        <span className="block text-xs font-medium text-slate-500">Scheduled Time</span>
                                        <span className="text-base font-extrabold text-slate-800">
                                            {new Date(lead.booked_time).toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        {lead.meet_link && (
                                            <div className="mt-2 flex flex-col gap-0.5">
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Google Meet Video Link</span>
                                                <a href={lead.meet_link} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline break-all flex items-center gap-1">
                                                    🎥 {lead.meet_link}
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col sm:items-end gap-2 shrink-0 w-full sm:w-auto">
                                        <span className="text-xs font-black bg-emerald-500 text-white px-3 py-1 rounded-full uppercase tracking-wider text-center shrink-0">
                                            Confirmed
                                        </span>
                                        <div className="flex gap-2 mt-1 justify-end shrink-0">
                                            <button 
                                                onClick={() => {
                                                    setTempBookingTime(toLocalDateTimeString(lead.booked_time))
                                                    setIsEditingBooking(true)
                                                }}
                                                className="text-xs font-bold text-indigo-600 hover:text-indigo-850 underline transition-colors shrink-0"
                                            >
                                                Reschedule
                                            </button>
                                            <span className="text-slate-300 shrink-0">|</span>
                                            <button 
                                                onClick={handleDeleteBooking}
                                                className="text-xs font-bold text-red-500 hover:text-red-750 underline transition-colors shrink-0"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Qualification & Custom Fields Card */}
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <CheckCircle2 size={14} className="text-emerald-500" /> Qualification Details
                            </h3>
                            {!isAddingCustomField && (
                                <button 
                                    onClick={() => setIsAddingCustomField(true)}
                                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black px-3.5 py-1.5 rounded-full transition-all active:scale-95 shadow-sm"
                                >
                                    + Add Custom Field
                                </button>
                            )}
                        </div>

                        {/* Inline Add Field Form */}
                        {isAddingCustomField && (
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 space-y-3 animate-in slide-in-from-top-2 duration-200">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Field Name</label>
                                        <input 
                                            type="text" 
                                            value={newFieldKey}
                                            onChange={(e) => setNewFieldKey(e.target.value)}
                                            placeholder="e.g. City, Preferred Location"
                                            className="w-full bg-white border border-slate-200/80 p-2 py-1.5 rounded-lg text-xs font-semibold outline-none focus:border-blue-400"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Value</label>
                                        <input 
                                            type="text" 
                                            value={newFieldValue}
                                            onChange={(e) => setNewFieldValue(e.target.value)}
                                            placeholder="e.g. Delhi, 3 BHK"
                                            className="w-full bg-white border border-slate-200/80 p-2 py-1.5 rounded-lg text-xs font-semibold outline-none focus:border-blue-400"
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2 pt-1">
                                    <button 
                                        onClick={() => { setIsAddingCustomField(false); setNewFieldKey(''); setNewFieldValue(''); }}
                                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-black rounded-lg transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={handleAddCustomField}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black rounded-lg transition-all"
                                    >
                                        Add Field
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Custom Fields Grid */}
                        {(() => {
                            let customFields = lead.custom_fields || {};
                            if (customFields && typeof customFields === 'string') {
                                try {
                                    while (typeof customFields === 'string') {
                                        customFields = JSON.parse(customFields);
                                    }
                                } catch (e) {
                                    customFields = {};
                                }
                            }
                            const entries = Object.entries(customFields);
                            if (entries.length === 0) {
                                return (
                                    <div className="text-center py-6 text-xs text-slate-400 font-medium">
                                        No custom fields added yet.
                                    </div>
                                );
                            }
                            return (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {entries.map(([key, value]) => (
                                        <div key={key} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex justify-between items-start group">
                                            <div className="min-w-0 flex-1">
                                                <span className="block text-[9px] font-bold text-slate-400 uppercase mb-1">{key.replace(/_/g, ' ')}</span>
                                                <span className="text-xs font-bold text-slate-700 break-words whitespace-normal">{String(value)}</span>
                                            </div>
                                            <button 
                                                onClick={() => handleDeleteCustomField(key)}
                                                className="text-slate-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2"
                                                title="Delete custom field"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>

                    {/* Voice Agent Call Details Card */}
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                🎙️ Voice Agent Call Details
                            </h3>
                            {lead.phone && (
                                <div className="flex gap-2">
                                    {leadHistory.some(h => h.description && h.description.startsWith('🎙️ CALL_JSON:')) && (
                                        <button 
                                            onClick={() => setIsAllHistoryModalOpen(true)}
                                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black px-4.5 py-2 rounded-full transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
                                        >
                                            <History size={12} /> Call History
                                        </button>
                                    )}
                                    <button 
                                        onClick={handleTriggerCall}
                                        disabled={isCalling || lead.voice_call_status === 'calling'}
                                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-black px-4 py-2 rounded-full transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
                                    >
                                        {isCalling || lead.voice_call_status === 'calling' ? (
                                            <>
                                                <Loader2 size={12} className="animate-spin text-white" /> Calling...
                                            </>
                                        ) : (
                                            <>
                                                <Phone size={12} /> Call via AI
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                                <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Call Status</span>
                                <span className={`font-black uppercase tracking-wider ${
                                    lead.voice_call_status === 'completed' ? 'text-emerald-600' : 
                                    lead.voice_call_status === 'calling' ? 'text-indigo-600 animate-pulse' : 
                                    lead.voice_call_status === 'scheduled_retry' ? 'text-amber-500 animate-pulse' :
                                    lead.voice_call_status === 'scheduled_callback' ? 'text-blue-500 animate-pulse' :
                                    ['failed', 'failed_max_retries'].includes(lead.voice_call_status || '') ? 'text-red-500' : 
                                    'text-slate-500'
                                }`}>
                                    ● {(lead.voice_call_status || 'not_called').replace(/_/g, ' ')}
                                </span>
                            </div>

                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50 flex justify-between items-center">
                                <div>
                                    <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Calling Queue</span>
                                    <span className={`font-black uppercase tracking-wider ${lead.calling_enabled !== false ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {lead.calling_enabled !== false ? 'Active' : 'Stopped'}
                                    </span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={lead.calling_enabled !== false} 
                                        onChange={(e) => handleToggleCallingEnabled(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                                </label>
                            </div>

                            {lead.voice_call_scheduled_at && (
                                <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-100 relative overflow-hidden flex flex-col justify-between min-h-[90px]">
                                    {isEditingCallback ? (
                                        <div className="space-y-1.5 w-full">
                                            <span className="block text-[9px] font-bold text-amber-800 uppercase tracking-wider">Change Callback Time</span>
                                            <div className="flex flex-col gap-1 w-full">
                                                <input 
                                                    type="datetime-local" 
                                                    defaultValue={toLocalDateTimeString(lead.voice_call_scheduled_at)} 
                                                    onChange={(e) => setTempCallbackTime(e.target.value)}
                                                    className="bg-white border border-amber-200 p-1 py-0.5 rounded text-[11px] font-bold outline-none w-full"
                                                />
                                                <div className="flex gap-1.5 mt-0.5">
                                                    <button 
                                                        onClick={async () => {
                                                            const timeToSave = tempCallbackTime || toLocalDateTimeString(lead.voice_call_scheduled_at)
                                                            await handleUpdateCallback(timeToSave)
                                                            setIsEditingCallback(false)
                                                        }}
                                                        className="bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-bold px-2 py-1 rounded"
                                                    >
                                                        Save
                                                    </button>
                                                    <button 
                                                        onClick={() => setIsEditingCallback(false)}
                                                        className="bg-amber-100 hover:bg-amber-200 text-amber-900 text-[9px] font-bold px-2 py-1 rounded"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col justify-between h-full w-full">
                                            <div>
                                                <span className="block text-[9px] font-bold text-amber-800 uppercase tracking-wider mb-1">Scheduled Callback</span>
                                                <span className="font-extrabold text-amber-950 block">
                                                    {new Date(lead.voice_call_scheduled_at).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
                                                </span>
                                            </div>
                                            <div className="flex gap-2 mt-1.5">
                                                <button 
                                                    onClick={() => {
                                                        setTempCallbackTime(toLocalDateTimeString(lead.voice_call_scheduled_at))
                                                        setIsEditingCallback(true)
                                                    }}
                                                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-850 underline transition-colors"
                                                >
                                                    Reschedule
                                                </button>
                                                <span className="text-amber-200">|</span>
                                                <button 
                                                    onClick={handleDeleteCallback}
                                                    className="text-[10px] font-bold text-red-500 hover:text-red-750 underline transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {lead.voice_call_summary && (
                            <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                                <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Call AI Summary</span>
                                <p className="text-xs font-semibold text-slate-700 leading-relaxed">
                                    {lead.voice_call_summary}
                                </p>
                            </div>
                        )}

                        {lead.voice_recording_url && (
                            <div className="space-y-1.5">
                                <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-1">Listen to Call Recording</span>
                                <audio controls src={lead.voice_recording_url} className="w-full h-9 rounded-lg outline-none" />
                            </div>
                        )}

                        {lead.voice_call_transcript && Array.isArray(lead.voice_call_transcript) && lead.voice_call_transcript.length > 0 && (
                            <div className="pt-3 border-t border-slate-100">
                                <button 
                                    type="button"
                                    onClick={() => setShowTranscript(!showTranscript)}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1.5 transition-colors"
                                >
                                    💬 {showTranscript ? 'Hide' : 'View'} full transcript ({lead.voice_call_transcript.length} messages)
                                </button>
                                {showTranscript && (
                                    <div className="mt-3 p-4 bg-slate-50 border border-slate-100/50 rounded-2xl max-h-60 overflow-y-auto space-y-3.5 custom-scrollbar">
                                        {cleanTranscript(lead.voice_call_transcript).map((msg: any, index: number) => (
                                            <div key={index} className={`flex flex-col ${msg.role === 'agent' ? 'items-start' : 'items-end'}`}>
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                                                    {msg.role === 'agent' ? 'AI Voice Agent' : 'Lead'}
                                                </span>
                                                <span className={`text-xs p-3 rounded-2xl max-w-[85%] font-semibold leading-relaxed ${msg.role === 'agent' ? 'bg-white text-slate-800 border border-slate-200/50 rounded-tl-none' : 'bg-indigo-600 text-white rounded-tr-none shadow-sm'}`}>
                                                    {msg.message}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
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
                            <Clock size={12} className="text-amber-500" /> Set Follow-up Reminder
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
                                    const isWhatsApp = item.action_type === 'WHATSAPP_CHAT'

                                    // WhatsApp chat bubble rendering
                                    if (isWhatsApp && item.description?.startsWith('💬 WA_JSON:')) {
                                        try {
                                            const parsed = JSON.parse(item.description.replace('💬 WA_JSON:', ''))
                                            return (
                                                <div key={item.id} className="relative flex items-start gap-4">
                                                    <div className="flex items-center justify-center w-11 h-11 rounded-full border-[3px] border-white shrink-0 z-10 shadow-sm bg-emerald-100 text-emerald-600">
                                                        <MessageCircle size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0 bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200/60 mt-0.5">
                                                        <div className="flex items-center justify-between mb-2.5">
                                                            <div className="font-bold text-xs text-emerald-700 flex items-center gap-1.5">
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.638l4.685-1.322A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.16 0-4.163-.67-5.813-1.813l-.406-.264-2.809.793.828-2.652-.287-.44A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                                                                WhatsApp Chat
                                                            </div>
                                                            <time className="text-[10px] font-bold text-emerald-500 bg-white px-1.5 py-0.5 rounded-md border border-emerald-100 shrink-0">{new Date(item.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</time>
                                                        </div>
                                                        <div className="space-y-2">
                                                            {/* User message bubble */}
                                                            <div className="flex justify-end">
                                                                <div className="bg-slate-200/80 text-slate-800 px-3 py-2 rounded-2xl rounded-tr-md max-w-[85%] text-[11px] leading-relaxed font-medium shadow-sm">
                                                                    {parsed.user_msg}
                                                                </div>
                                                            </div>
                                                            {/* Bot reply bubble */}
                                                            <div className="flex justify-start">
                                                                <div className="bg-emerald-500 text-white px-3 py-2 rounded-2xl rounded-tl-md max-w-[85%] text-[11px] leading-relaxed font-medium shadow-sm">
                                                                    {parsed.bot_reply}
                                                                </div>
                                                            </div>
                                                            {/* Booking badge */}
                                                            {parsed.booking_time && (
                                                                <div className="flex items-center gap-1.5 bg-emerald-600/10 border border-emerald-200 rounded-xl px-3 py-1.5 mt-1 w-fit">
                                                                    <Clock size={12} className="text-emerald-600" />
                                                                    <span className="text-[10px] font-extrabold text-emerald-700">
                                                                        📅 Booked: {new Date(parsed.booking_time).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        } catch (e) {
                                            // fallthrough to default rendering
                                        }
                                    }

                                    return (
                                        <div key={item.id} className="relative flex items-start gap-4">
                                            <div className={`flex items-center justify-center w-11 h-11 rounded-full border-[3px] border-white shrink-0 z-10 shadow-sm ${isRemark ? 'bg-blue-100 text-blue-600' : isReminder ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
                                                {isRemark ? <MessageCircle size={16} /> : isReminder ? <Clock size={16} /> : <CheckCircle2 size={16} />}
                                            </div>
                                            <div className="flex-1 min-w-0 bg-slate-50 p-4 rounded-2xl border border-slate-100 mt-0.5">
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <div className="font-bold text-xs text-slate-900 capitalize truncate pr-2">{item.action_type.replace('_', ' ')}</div>
                                                    <time className="text-[10px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded-md border border-slate-100 shrink-0">{new Date(item.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</time>
                                                </div>
                                                <div className="text-xs text-slate-600 leading-relaxed break-words font-medium">
                                                    {(() => {
                                                        if (item.description && item.description.startsWith('🎙️ CALL_JSON:')) {
                                                            try {
                                                                const parsed = JSON.parse(item.description.replace('🎙️ CALL_JSON:', ''))
                                                                return (
                                                                    <div className="space-y-2">
                                                                        <span className="font-extrabold text-indigo-600 block">🎙️ AI Voice Call Summary:</span>
                                                                        <p className="font-semibold text-slate-700">{parsed.summary}</p>
                                                                        {parsed.recording_url && (
                                                                            <div className="my-1.5">
                                                                                <audio controls src={parsed.recording_url} className="w-full h-8 outline-none" />
                                                                            </div>
                                                                        )}
                                                                        <button 
                                                                            onClick={() => {
                                                                                setSelectedHistoryCall(parsed)
                                                                                setIsHistoryModalOpen(true)
                                                                            }}
                                                                            className="text-xs text-indigo-600 hover:text-indigo-800 font-extrabold flex items-center gap-1 mt-1 underline transition-colors"
                                                                        >
                                                                            Listen & View Transcript
                                                                        </button>
                                                                    </div>
                                                                )
                                                            } catch (e) {
                                                                return item.description
                                                            }
                                                        }
                                                        return item.description
                                                    })()}
                                                </div>
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

            {/* SINGLE CALL HISTORY LOG DETAIL MODAL */}
            {isHistoryModalOpen && selectedHistoryCall && (
                <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-2xl rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden max-h-[85vh]">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                🎙️ Call Record Detail
                            </h2>
                            <button onClick={() => setIsHistoryModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                        </div>

                        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                            {/* Summary */}
                            <div className="bg-slate-50 p-4.5 rounded-2xl border border-slate-100">
                                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">AI Summary</span>
                                <p className="text-xs font-semibold text-slate-700 leading-relaxed">{selectedHistoryCall.summary}</p>
                            </div>

                            {/* Audio Player */}
                            {selectedHistoryCall.recording_url && (
                                <div className="space-y-2">
                                    <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Call Recording</span>
                                    <audio controls src={selectedHistoryCall.recording_url} className="w-full h-10 rounded-xl outline-none" />
                                </div>
                            )}

                            {/* Transcript */}
                            {selectedHistoryCall.transcript && Array.isArray(selectedHistoryCall.transcript) && selectedHistoryCall.transcript.length > 0 ? (
                                <div className="space-y-3">
                                    <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Conversation Transcript</span>
                                    <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-2xl space-y-3.5 max-h-[35vh] overflow-y-auto custom-scrollbar">
                                        {selectedHistoryCall.transcript.map((t: any, idx: number) => {
                                            const isAgent = t.role === 'agent'
                                            return (
                                                <div key={idx} className={`flex ${isAgent ? 'justify-start' : 'justify-end'}`}>
                                                    <div className={`max-w-[80%] p-3.5 rounded-2xl text-xs leading-relaxed font-semibold ${isAgent ? 'bg-white text-slate-800 border border-slate-100' : 'bg-indigo-600 text-white'}`}>
                                                        <span className="block text-[8px] font-bold uppercase opacity-60 mb-1">{isAgent ? 'Agent' : 'Lead'}</span>
                                                        {t.message || t.text || ''}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center text-xs font-bold text-slate-400 py-6">No transcript details available for this call.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ALL CALL HISTORY LIST MODAL */}
            {isAllHistoryModalOpen && (
                <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-xl rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden max-h-[80vh]">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                📜 Call History Log
                            </h2>
                            <button onClick={() => setIsAllHistoryModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
                            {leadHistory
                                .filter(h => h.description && h.description.startsWith('🎙️ CALL_JSON:'))
                                .map((item) => {
                                    let parsed: any = {}
                                    try {
                                        parsed = JSON.parse(item.description.replace('🎙️ CALL_JSON:', ''))
                                    } catch (e) {
                                        return null
                                    }
                                    return (
                                        <div key={item.id} className="bg-slate-50 p-4.5 rounded-2xl border border-slate-200/60 flex flex-col gap-3">
                                            <div className="flex justify-between items-center">
                                                <time className="text-[10px] font-bold text-slate-400 bg-white px-2 py-0.5 rounded-md border border-slate-150">{new Date(item.created_at || Date.now()).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</time>
                                                <button 
                                                    onClick={() => {
                                                        setSelectedHistoryCall(parsed)
                                                        setIsHistoryModalOpen(true)
                                                    }}
                                                    className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-[10px] font-black px-3.5 py-1.5 rounded-lg transition-all"
                                                >
                                                    Open Details
                                                </button>
                                            </div>
                                            <p className="text-xs font-semibold text-slate-700 leading-relaxed">{parsed.summary}</p>
                                            {parsed.recording_url && (
                                                <div className="mt-2">
                                                    <audio controls src={parsed.recording_url} className="w-full h-8 outline-none" />
                                                </div>
                                            )}
                                        </div>
                                    )
                                })
                            }
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}