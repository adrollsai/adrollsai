'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, UserPlus, CalendarClock, BellRing, LucideIcon, Send, Inbox, User, Loader2, ArrowLeft, ChevronDown, ChevronUp, Pencil, Save, FileText, X, Package, RefreshCw, CreditCard, Target } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

// Map String names to Actual Icons
const iconMap: Record<string, LucideIcon> = {
  'UserPlus': UserPlus,
  'CalendarClock': CalendarClock,
  'BellRing': BellRing,
  'MessageCircle': MessageCircle
}

type Automation = {
  id: string
  title: string
  description: string
  icon_name: string
  is_active: boolean
  stats: string
}

type Chat = {
  id: string
  recipient_phone: string
  recipient_name?: string
  last_message_text?: string
  unread_count: number
  updated_at: string
  lead_id?: string | null
  flow_completed?: boolean
  flow_answers?: any
}

type Message = {
  id: string
  chat_id: string
  direction: 'inbound' | 'outbound'
  message_text: string
  created_at: string
  media_url?: string | null
  media_type?: string | null
}

export default function AutomationPage() {
  const supabase = createClient()
  
  // Get impersonate ID from URL for super-admin sub-account viewing
  const getImpersonateId = () => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('impersonate')
  }
  const buildApiUrl = (base: string, extraParams?: Record<string, string>) => {
    const impersonateId = getImpersonateId()
    const params = new URLSearchParams()
    if (impersonateId) params.set('impersonate', impersonateId)
    if (extraParams) Object.entries(extraParams).forEach(([k, v]) => params.set(k, v))
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }
  
  // Live Chat Inbox states (Cached in localStorage)
  const [chats, setChats] = useState<Chat[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('wa_cached_chats')
      if (cached) return JSON.parse(cached)
    }
    return []
  })
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessageText, setNewMessageText] = useState('')
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('hello_world')
  const [customTemplateName, setCustomTemplateName] = useState('')
  const [customTemplateLang, setCustomTemplateLang] = useState('en_US')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [showTemplateInput, setShowTemplateInput] = useState(false)
  const [sendingProducts, setSendingProducts] = useState(false)
  type Property = {
    id: string
    title: string
    price?: string
    address?: string
    configurations?: string
  }
  const [properties, setProperties] = useState<Property[]>([])
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [loadingProperties, setLoadingProperties] = useState(false)
  const [activeMediaModal, setActiveMediaModal] = useState<any>(null)

  type MetaTemplate = {
    name: string
    status: string
    category: string
    language: string
    components: any[]
  }
  const [templates, setTemplates] = useState<MetaTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // Admin & Billing Check states
  const [isAdmin, setIsAdmin] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [billingStatus, setBillingStatus] = useState<any>(null)
  const [loadingBilling, setLoadingBilling] = useState(false)
  
  // Lead info panel
  type LeadInfo = {
    id: string
    name: string
    phone: string
    email: string
    pipeline_stage: string
    remarks: string
    custom_fields: Record<string, any>
    source: string
    created_at: string
    ad_name?: string
    campaign_id?: string
  }
  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(null)
  const [showLeadPanel, setShowLeadPanel] = useState(false)
  const [editingLead, setEditingLead] = useState(false)
  const [leadEditForm, setLeadEditForm] = useState({ name: '', email: '', pipeline_stage: '', remarks: '' })
  const [savingLead, setSavingLead] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Cache chats updates
  useEffect(() => {
    if (chats.length > 0) {
      try {
        localStorage.setItem('wa_cached_chats', JSON.stringify(chats))
      } catch (e) {
        console.error('[WhatsApp Cache] Error caching chats:', e)
      }
    }
  }, [chats])

  const fetchProfileAndBilling = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')

        let targetId = user.id
        const { data: authProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        const isAuthAdmin = ['super_admin', 'agency', 'admin'].includes(authProfile?.role || '')
        if (impersonateId && isAuthAdmin) {
          targetId = impersonateId
        }

        const { data: prof } = await supabase.from('profiles').select('*').eq('id', targetId).single()
        if (prof) {
          setProfile(prof)
          const adminRoles = ['super_admin', 'agency', 'admin']
          const isUserAdmin = adminRoles.includes(prof.role || '')
          setIsAdmin(isUserAdmin)

          // If they are an admin, fetch the WhatsApp Business Account billing/TOS status
          if (isUserAdmin) {
            setLoadingBilling(true)
            try {
              const res = await fetch(`/api/whatsapp/status${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
              if (res.ok) {
                const billData = await res.json()
                setBillingStatus(billData)
              }
            } catch (billingErr) {
              console.error("Failed to fetch WABA billing status:", billingErr)
            } finally {
              setLoadingBilling(false)
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to load profile/billing:", err)
    }
  }

  // Fetch chats, templates and properties on mount
  useEffect(() => {
    fetchChats()
    fetchTemplates()
    fetchProperties()
    fetchProfileAndBilling()
  }, [])

  // Fetch messages (and load cache first) when a chat is selected
  useEffect(() => {
    if (selectedChatId) {
      if (typeof window !== 'undefined') {
        const cached = localStorage.getItem(`wa_cached_msgs_${selectedChatId}`)
        if (cached) {
          setMessages(JSON.parse(cached))
        }
      }
      fetchMessages(selectedChatId)
      // Fetch lead info if chat has a lead_id
      const chat = chats.find(c => c.id === selectedChatId)
      if (chat?.lead_id) {
        fetchLeadInfo(chat.lead_id)
      } else if (chat) {
        setLeadInfo({
          id: '',
          name: chat.recipient_name || '',
          phone: chat.recipient_phone || '',
          email: '',
          pipeline_stage: 'New',
          remarks: '',
          custom_fields: {},
          source: 'WhatsApp',
          created_at: new Date().toISOString()
        })
        setLeadEditForm({
          name: chat.recipient_name || '',
          email: '',
          pipeline_stage: 'New',
          remarks: ''
        })
      } else {
        setLeadInfo(null)
      }
    } else {
      setMessages([])
      setLeadInfo(null)
      setShowLeadPanel(false)
    }
  }, [selectedChatId])

  // Cache messages updates
  useEffect(() => {
    if (selectedChatId && messages.length > 0) {
      try {
        localStorage.setItem(`wa_cached_msgs_${selectedChatId}`, JSON.stringify(messages))
      } catch (e) {
        console.error(`[WhatsApp Cache] Error caching messages for ${selectedChatId}:`, e)
      }
    }
  }, [selectedChatId, messages])

  // Realtime Chats & Messages Subscriptions
  const selectedChatIdRef = useRef<string | null>(null)
  
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId
  }, [selectedChatId])

  useEffect(() => {
    // 1. Global subscription to whatsapp_chats
    const chatsChannel = supabase
      .channel('whatsapp-chats-global-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_chats'
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newChat = payload.new as Chat
            setChats(prev => {
              if (prev.some(c => c.id === newChat.id)) return prev
              return [newChat, ...prev].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            })
          } else if (payload.eventType === 'UPDATE') {
            const updatedChat = payload.new as Chat
            setChats(prev => {
              const idx = prev.findIndex(c => c.id === updatedChat.id)
              if (idx === -1) {
                return [updatedChat, ...prev].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
              }
              const nextChats = [...prev]
              nextChats[idx] = { ...nextChats[idx], ...updatedChat }
              return nextChats.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            })
          } else if (payload.eventType === 'DELETE') {
            const deletedChat = payload.old as Chat
            setChats(prev => prev.filter(c => c.id !== deletedChat.id))
          }
        }
      )
      .subscribe()

    // 2. Global subscription to whatsapp_messages to stream active chat messages in real time
    const messagesChannel = supabase
      .channel('whatsapp-messages-global-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages'
        },
        (payload) => {
          const newMsg = payload.new as Message
          if (selectedChatIdRef.current && newMsg.chat_id === selectedChatIdRef.current) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev
              return [...prev, newMsg]
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(chatsChannel)
      supabase.removeChannel(messagesChannel)
    }
  }, [])

  // Scroll messages list to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchChats = async () => {
    setLoadingChats(true)
    try {
      const res = await fetch(buildApiUrl('/api/whatsapp/chat'))
      const data = await res.json()
      if (data.success) {
        setChats(data.chats || [])
      }
    } catch (e) {
      console.error(e)
    }
    setLoadingChats(false)
  }

  const fetchTemplates = async () => {
    setLoadingTemplates(true)
    try {
      const res = await fetch(buildApiUrl('/api/whatsapp/templates'))
      const data = await res.json()
      if (data.success) {
        setTemplates(data.templates || [])
      }
    } catch (e) {
      console.error('Failed to fetch Meta templates:', e)
    } finally {
      setLoadingTemplates(false)
    }
  }

  const fetchProperties = async () => {
    setLoadingProperties(true)
    try {
      const res = await fetch(buildApiUrl('/api/whatsapp/send-products'))
      const data = await res.json()
      if (data.success) {
        setProperties(data.properties || [])
        if (data.properties && data.properties.length > 0) {
          setSelectedPropertyId(data.properties[0].id)
        }
      }
    } catch (e) {
      console.error('Failed to fetch properties:', e)
    } finally {
      setLoadingProperties(false)
    }
  }

  const fetchMessages = async (chatId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(buildApiUrl('/api/whatsapp/chat', { chatId }))
      const data = await res.json()
      if (data.success) {
        setMessages(data.messages || [])
        // Mark as read in list
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c))
      }
    } catch (e) {
      console.error(e)
    }
    setLoadingMessages(false)
  }

  const fetchLeadInfo = async (leadId: string) => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, name, phone, email, pipeline_stage, notes, custom_fields, source, created_at')
        .eq('id', leadId)
        .single()
      if (data && !error) {
        setLeadInfo({
          ...data,
          remarks: (data as any).notes || ''
        } as unknown as LeadInfo)
        setLeadEditForm({
          name: data.name || '',
          email: data.email || '',
          pipeline_stage: data.pipeline_stage || 'New',
          remarks: (data as any).notes || ''
        })
      }
    } catch (e) {
      console.error('Failed to fetch lead info:', e)
    }
  }

  const saveLeadInfo = async () => {
    if (!leadInfo) return
    setSavingLead(true)
    try {
      if (leadInfo.id) {
        const { error } = await supabase
          .from('leads')
          .update({
            name: leadEditForm.name,
            email: leadEditForm.email,
            pipeline_stage: leadEditForm.pipeline_stage,
            notes: leadEditForm.remarks
          })
          .eq('id', leadInfo.id)
        if (error) throw error
        setLeadInfo({ ...leadInfo, ...leadEditForm })
        setEditingLead(false)
        toast.success('Lead info updated!')
        // Also update the chat name if it changed
        if (leadEditForm.name !== leadInfo.name && selectedChatId) {
          await supabase
            .from('whatsapp_chats')
            .update({ recipient_name: leadEditForm.name })
            .eq('id', selectedChatId)
          setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, recipient_name: leadEditForm.name } : c))
        }
      } else {
        if (!leadEditForm.name.trim()) {
          toast.error("Name is required to save lead in CRM.")
          setSavingLead(false)
          return
        }

        // 1. Create lead in CRM
        const { data: newLead, error: insertError } = await supabase
          .from('leads')
          .insert({
            user_id: profile?.id,
            name: leadEditForm.name.trim(),
            email: leadEditForm.email.trim(),
            phone: leadInfo.phone,
            pipeline_stage: leadEditForm.pipeline_stage || 'New',
            notes: leadEditForm.remarks,
            source: 'WhatsApp'
          })
          .select()
          .single()

        if (insertError) throw insertError

        // 2. Associate the new lead's ID with the whatsapp_chat record
        if (selectedChatId) {
          const { error: chatUpdateErr } = await supabase
            .from('whatsapp_chats')
            .update({ 
              lead_id: newLead.id,
              recipient_name: leadEditForm.name.trim() 
            })
            .eq('id', selectedChatId)

          if (chatUpdateErr) throw chatUpdateErr

          setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, lead_id: newLead.id, recipient_name: leadEditForm.name.trim() } : c))
        }

        // 3. Back-populate whatsapp chat messages to lead_history for this new lead
        if (selectedChatId) {
          try {
            const { data: messages } = await supabase
              .from('whatsapp_messages')
              .select('*')
              .eq('chat_id', selectedChatId)
              .order('created_at', { ascending: true })

            if (messages && messages.length > 0) {
              const historyItems: any[] = []
              let i = 0
              while (i < messages.length) {
                const current = messages[i]
                if (current.direction === 'inbound') {
                  const user_msg = current.message_text
                  let bot_reply = ''
                  const nextMsg = messages[i + 1]
                  if (nextMsg && nextMsg.direction === 'outbound') {
                    bot_reply = nextMsg.message_text
                    i += 2
                  } else {
                    i += 1
                  }
                  
                  historyItems.push({
                    lead_id: newLead.id,
                    action_type: 'WHATSAPP_CHAT',
                    description: `💬 WA_JSON:${JSON.stringify({ user_msg, bot_reply, booking_time: null })}`,
                    created_at: current.created_at
                  })
                } else {
                  historyItems.push({
                    lead_id: newLead.id,
                    action_type: 'WHATSAPP_CHAT',
                    description: `💬 WA_JSON:${JSON.stringify({ user_msg: '', bot_reply: current.message_text, booking_time: null })}`,
                    created_at: current.created_at
                  })
                  i += 1
                }
              }

              if (historyItems.length > 0) {
                await supabase.from('lead_history').insert(historyItems)
              }
            }
          } catch (historyErr) {
            console.error("Failed to backpopulate lead history:", historyErr)
          }
        }

        setLeadInfo({
          ...newLead,
          remarks: newLead.notes || ''
        } as any)
        setEditingLead(false)
        toast.success('Lead created and linked to chat!')
      }
    } catch (e: any) {
      toast.error('Failed to save lead: ' + (e.message || ''))
    }
    setSavingLead(false)
  }

  const toggleAiStatus = async (chatToToggle: Chat, enable: boolean) => {
    try {
      const currentAnswers = chatToToggle.flow_answers || {}
      const updatedAnswers = {
        ...currentAnswers,
        ai_disabled: !enable,
        ai_paused_until: enable ? null : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      }
      
      setChats(prev => prev.map(c => c.id === chatToToggle.id ? { ...c, flow_answers: updatedAnswers } : c))
      
      const { error } = await supabase
        .from('whatsapp_chats')
        .update({ flow_answers: updatedAnswers, updated_at: new Date().toISOString() })
        .eq('id', chatToToggle.id)
        
      if (error) throw error
      toast.success(enable ? '🤖 AI Bot resumed for this chat!' : '⏸️ AI Bot paused for 2 hours for human agent chat.')
    } catch (e: any) {
      toast.error('Failed to update AI Bot status: ' + e.message)
    }
  }

  const handleSendMessage = async () => {
    if (!selectedChatId || !newMessageText.trim() || sendingMessage) return
    setSendingMessage(true)
    try {
      const res = await fetch(buildApiUrl('/api/whatsapp/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: selectedChatId, messageText: newMessageText })
      })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, data.message])
        setChats(prev => prev.map(c => {
          if (c.id === selectedChatId) {
            const currentAns = c.flow_answers || {};
            const updatedAns = { ...currentAns, ai_disabled: true, ai_paused_until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() };
            return { ...c, last_message_text: newMessageText, flow_answers: updatedAns, updated_at: new Date().toISOString() };
          }
          return c;
        }))
        setNewMessageText('')
      } else {
        alert("Failed to send message: " + data.error)
      }
    } catch (e) {
      console.error(e)
      alert("Error sending message.")
    }
    setSendingMessage(false)
  }

  const handleSendTemplate = async () => {
    if (!selectedChatId || sendingMessage) return

    if (isAdmin && billingStatus) {
      if (billingStatus.tos_accepted === false) {
        alert(`Cannot send template: You must accept the WhatsApp Payments Terms of Service first.\n\nUse the link in the billing bar at the top or click here: ${billingStatus.pending_tos_url || 'https://fb.me/2bcZ0cOTE9VAxqQ'}`)
        return
      }
      if (billingStatus.has_payment_method === false) {
        alert("Cannot send template: Your WhatsApp Business Account is missing a valid payment method. Please connect a payment method first in your Meta Business Suite.")
        return
      }
    }

    setSendingMessage(true)

    const templateName = selectedTemplate === 'custom' ? customTemplateName.trim() : selectedTemplate
    const language = selectedTemplate === 'custom' ? customTemplateLang.trim() : 'en_US'

    if (!templateName) {
      alert("Please enter a valid template name.")
      setSendingMessage(false)
      return
    }

    try {
      const res = await fetch(buildApiUrl('/api/whatsapp/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: selectedChatId,
          templateName,
          language
        })
      })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, data.message])
        setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, last_message_text: `Sent Template: ${templateName}`, updated_at: new Date().toISOString() } : c))
        setCustomTemplateName('')
      } else {
        alert("Failed to send template: " + data.error)
      }
    } catch (e) {
      console.error(e)
      alert("Error sending template message.")
    }
    setSendingMessage(false)
  }

  const handleSendProducts = async () => {
    if (!selectedChatId || !selectedPropertyId || sendingProducts) return
    setSendingProducts(true)
    try {
      const res = await fetch(buildApiUrl('/api/whatsapp/send-products'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: selectedChatId, propertyId: selectedPropertyId })
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`📦 Sent product successfully!`)
        // Refresh messages to show the new product messages
        fetchMessages(selectedChatId)
        setShowProductDropdown(false)
      } else {
        toast.error('Failed to send product: ' + (data.error || 'Unknown error'))
      }
    } catch (e) {
      console.error(e)
      toast.error('Error sending product.')
    }
    setSendingProducts(false)
  }

  const selectedChat = chats.find(c => c.id === selectedChatId)
  
  const lastInboundMessage = [...messages].reverse().find(m => m.direction === 'inbound')
  const isWindowActive = (() => {
    if (!lastInboundMessage) return false
    const lastInboundTime = new Date(lastInboundMessage.created_at).getTime()
    const now = Date.now()
    const elapsedMs = now - lastInboundTime
    const hours = elapsedMs / (1000 * 60 * 60)
    return hours < 24
  })()

  return (
    <div className="p-5 mx-auto min-h-screen pb-24 max-w-5xl">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">WhatsApp Portal</h1>
          <p className="text-slate-500 text-xs mt-1">Live customer and bot conversations</p>
        </div>

        {/* Billing Info (Admins Only) */}
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3 bg-white p-2 px-3 border border-slate-200/80 rounded-2xl shadow-sm text-xs">
            {loadingBilling ? (
              <div className="text-slate-400 font-semibold flex items-center gap-1.5 py-0.5">
                <Loader2 size={12} className="animate-spin text-indigo-600" />
                <span>Checking WABA status...</span>
              </div>
            ) : billingStatus && billingStatus.success !== false ? (
              <>
                {/* WABA Name & Currency */}
                <div className="flex items-center gap-1.5 pr-3 border-r border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">WABA:</span>
                  <span className="font-extrabold text-slate-800">
                    {billingStatus.waba_name || 'Connected'} ({billingStatus.currency || 'INR'})
                  </span>
                </div>

                {/* TOS Status */}
                <div className="flex items-center gap-1.5 pr-3 border-r border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">TOS Status:</span>
                  {billingStatus.tos_accepted ? (
                    <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-150 px-2 py-0.5 rounded-full uppercase tracking-wider">Accepted</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-black bg-amber-50 text-amber-600 border border-amber-150 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">Pending TOS</span>
                      {billingStatus.pending_tos_url && (
                        <a 
                          href={billingStatus.pending_tos_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline hover:underline transition-colors shrink-0"
                        >
                          Accept Terms ↗
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* WABA Payment Configuration */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Payment Method:</span>
                  {billingStatus.has_payment_method ? (
                    <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-150 px-2 py-0.5 rounded-full uppercase tracking-wider">Connected</span>
                  ) : (
                    <span className="text-[10px] font-black bg-rose-50 text-rose-600 border border-rose-150 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">Missing Method</span>
                  )}
                </div>

                {/* Force Refresh */}
                <button 
                  onClick={fetchProfileAndBilling}
                  title="Refresh WABA Status"
                  className="p-1 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-600 transition-colors ml-1"
                >
                  <RefreshCw size={12} />
                </button>
              </>
            ) : (
              <div className="text-slate-400 font-semibold py-0.5 flex flex-wrap items-center gap-2">
                <span>{billingStatus?.error || 'WABA Status Check Failed'}</span>
                {billingStatus?.pending_tos_url && (
                  <a 
                    href={billingStatus.pending_tos_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-blue-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    Accept Payments TOS ↗
                  </a>
                )}
                <button onClick={fetchProfileAndBilling} className="text-indigo-600 hover:underline font-bold ml-1">Retry</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200/80 rounded-[2rem] shadow-xl overflow-hidden h-[600px] flex">
          
          {/* Chats Sidebar */}
          <div className={`${selectedChatId ? 'hidden md:flex' : 'flex'} w-full md:w-1/3 border-r border-slate-100 flex-col bg-slate-50/50`}>
            <div className="p-4 border-b border-slate-100 bg-white flex justify-between items-center">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Active Chats</span>
              <button 
                onClick={fetchChats}
                className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded-lg font-bold hover:bg-slate-200 transition-colors"
              >
                Refresh
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loadingChats ? (
                <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5"><Loader2 className="animate-spin text-blue-600" size={14} /> Loading Inbox...</div>
              ) : chats.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2 mt-10">
                  <Inbox size={24} className="text-slate-300" />
                  <span>No active conversations yet</span>
                </div>
              ) : (
                chats.map((c) => {
                  const isSelected = c.id === selectedChatId
                  return (
                    <div 
                      key={c.id}
                      onClick={() => setSelectedChatId(c.id)}
                      className={`p-3.5 flex items-center gap-3 cursor-pointer transition-all hover:bg-slate-100/50 ${isSelected ? 'bg-white shadow-sm ring-1 ring-blue-500/10' : ''}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-black text-sm uppercase flex-shrink-0 border border-blue-100">
                        {c.recipient_name ? c.recipient_name.slice(0,2) : <User size={16} />}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-xs font-bold text-slate-800 truncate">{c.recipient_name || c.recipient_phone}</span>
                          <span className="text-[9px] text-slate-400 font-medium">{new Date(c.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate leading-relaxed">
                          {c.last_message_text || 'No messages yet'}
                        </p>
                      </div>

                      {c.unread_count > 0 && (
                        <span className="w-5 h-5 rounded-full bg-emerald-500 text-white font-black text-[9px] flex items-center justify-center shadow-sm">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Chat Pane */}
          <div className={`${selectedChatId ? 'flex' : 'hidden md:flex'} flex-grow flex-shrink flex-col bg-slate-50/20 h-full min-w-0`}>
            {selectedChat ? (
              <>
                {/* Chat Pane Header */}
                <div className="p-4 border-b border-slate-100 bg-white flex justify-between items-center shadow-sm">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setSelectedChatId(null)}
                      className="md:hidden p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <div>
                      <h3 className="text-xs font-black text-slate-800">{selectedChat.recipient_name || selectedChat.recipient_phone}</h3>
                      <p className="text-[9px] font-bold text-emerald-600 mt-0.5">● Connected to {selectedChat.recipient_phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* AI Bot Toggle Button */}
                    {(() => {
                      const flowAns = selectedChat.flow_answers || {};
                      const isPaused = (() => {
                        if (!flowAns.ai_disabled) return false;
                        if (flowAns.ai_paused_until) {
                          return Date.now() < new Date(flowAns.ai_paused_until).getTime();
                        }
                        return true;
                      })();

                      return isPaused ? (
                        <button
                          onClick={() => toggleAiStatus(selectedChat, true)}
                          className="flex items-center gap-1.5 text-[10px] font-black bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-full transition-all shadow-xs cursor-pointer"
                          title="AI Bot is paused for human agent chat. Click to resume AI Bot."
                        >
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          ⏸️ AI Bot: PAUSED (Click to Resume)
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleAiStatus(selectedChat, false)}
                          className="flex items-center gap-1.5 text-[10px] font-black bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-full transition-all shadow-xs cursor-pointer"
                          title="AI Bot is active. Click to pause AI for human agent chat."
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          🤖 AI Bot: ACTIVE
                        </button>
                      );
                    })()}

                    {leadInfo && (
                      <button
                        onClick={() => setShowLeadPanel(!showLeadPanel)}
                        className="flex items-center gap-1.5 text-[10px] font-bold bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full hover:bg-blue-100 transition-colors border border-blue-100 cursor-pointer"
                      >
                        <User size={12} /> Lead Info
                        {showLeadPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsible Lead Info Panel */}
                {showLeadPanel && leadInfo && (
                  <div className="bg-blue-50/40 border-b border-blue-100 p-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">CRM Lead Details</span>
                      <div className="flex gap-2">
                        {editingLead ? (
                          <>
                            <button onClick={() => setEditingLead(false)} className="text-[10px] font-bold text-slate-500 hover:text-slate-700"><X size={12} /></button>
                            <button onClick={saveLeadInfo} disabled={savingLead} className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-700">
                              {savingLead ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setEditingLead(true)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700">
                            <Pencil size={10} /> Edit
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {editingLead ? (
                        <>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase">Name</label>
                            <input type="text" value={leadEditForm.name} onChange={(e) => setLeadEditForm({...leadEditForm, name: e.target.value})} className="w-full bg-white border border-slate-200 py-1.5 px-2.5 rounded-lg text-[11px] font-bold outline-none focus:border-blue-400" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase">Email</label>
                            <input type="email" value={leadEditForm.email} onChange={(e) => setLeadEditForm({...leadEditForm, email: e.target.value})} className="w-full bg-white border border-slate-200 py-1.5 px-2.5 rounded-lg text-[11px] font-bold outline-none focus:border-blue-400" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase">Stage</label>
                            <select value={leadEditForm.pipeline_stage} onChange={(e) => setLeadEditForm({...leadEditForm, pipeline_stage: e.target.value})} className="w-full bg-white border border-slate-200 py-1.5 px-2.5 rounded-lg text-[11px] font-bold outline-none cursor-pointer">
                              {['New', 'Contacted', 'Qualified', 'Negotiation', 'Won', 'Lost'].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase">Remarks</label>
                            <input type="text" value={leadEditForm.remarks} onChange={(e) => setLeadEditForm({...leadEditForm, remarks: e.target.value})} placeholder="Add a note..." className="w-full bg-white border border-slate-200 py-1.5 px-2.5 rounded-lg text-[11px] font-bold outline-none focus:border-blue-400" />
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Meta Ad Origin & Inventory Mapping Section */}
                          {(() => {
                            const origin = leadInfo.custom_fields?.meta_ad_origin || selectedChat?.flow_answers?.meta_ad_origin;
                            const adName = origin?.ad_name || leadInfo.ad_name;
                            const campaign = origin?.campaign_name || leadInfo.campaign_id;
                            const adset = origin?.adset_name;
                            const headline = origin?.headline;
                            const imageUrl = origin?.image_url;
                            const videoUrl = origin?.video_url;
                            const bodyText = origin?.body;
                            const productName = origin?.product_name || null;

                            const getLiveAdUrl = () => {
                              if (!origin) return 'https://www.facebook.com/ads/library/';
                              const rawUrl = origin.source_url;
                              const adId = origin.ad_id || origin.source_id;
                              if (rawUrl && rawUrl !== 'https://facebook.com' && rawUrl !== 'https://facebook.com/' && !rawUrl.endsWith('facebook.com')) {
                                return rawUrl;
                              }
                              if (adId) {
                                return `https://www.facebook.com/ads/library/?id=${adId}`;
                              }
                              return 'https://www.facebook.com/ads/library/';
                            };

                            if (!origin && !adName && !campaign) return null;

                            return (
                              <div className="col-span-2 my-1 p-3.5 bg-gradient-to-r from-indigo-50/90 via-blue-50/80 to-slate-50 border border-indigo-150 rounded-2xl shadow-xs space-y-2.5">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-700 uppercase tracking-wider">
                                    <Target size={13} className="text-indigo-500" /> Meta Ad Origin & Inventory Mapping
                                  </div>
                                </div>

                                {(imageUrl || videoUrl || bodyText) && (
                                  <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-indigo-100/70 shadow-xs">
                                    {(imageUrl || videoUrl) && (
                                      <div 
                                        onClick={() => setActiveMediaModal({ origin })}
                                        className="relative group cursor-pointer shrink-0 rounded-lg overflow-hidden border border-slate-200 shadow-xs w-16 h-16 bg-slate-900 flex items-center justify-center"
                                        title="Click to enlarge creative"
                                      >
                                        {videoUrl ? (
                                          <>
                                            <video src={videoUrl} className="w-full h-full object-cover opacity-90" />
                                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                              <span className="p-1 bg-white/90 rounded-full text-indigo-700 shadow-md text-[10px] font-black">▶</span>
                                            </div>
                                          </>
                                        ) : (
                                          <>
                                            <img src={imageUrl} alt="Ad Creative Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                                              <span className="opacity-0 group-hover:opacity-100 text-white font-extrabold text-[8px] bg-indigo-600/90 px-1 py-0.5 rounded shadow-xs">🔍 Zoom</span>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1 text-[10px]">
                                      <div className="flex justify-between items-start">
                                        <span className="font-extrabold text-indigo-950 block truncate text-[11px] max-w-[170px]">{headline || adName}</span>
                                        {(imageUrl || videoUrl) && (
                                          <button 
                                            onClick={() => setActiveMediaModal({ origin })}
                                            className="text-[9px] font-extrabold text-indigo-600 hover:text-indigo-800 underline ml-1 shrink-0"
                                          >
                                            🔍 Enlarge
                                          </button>
                                        )}
                                      </div>
                                      {bodyText && <p className="text-slate-500 line-clamp-2 text-[9px] mt-0.5 leading-snug">{bodyText}</p>}
                                    </div>
                                  </div>
                                )}

                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                  {adName && <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Ad Name</span><span className="font-extrabold text-indigo-950 truncate block">{adName}</span></div>}
                                  {adset && <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Ad Set</span><span className="font-extrabold text-slate-800 truncate block">{adset}</span></div>}
                                  {campaign && <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Campaign</span><span className="font-extrabold text-slate-800 truncate block">{campaign}</span></div>}
                                  {headline && <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Headline</span><span className="font-extrabold text-slate-800 truncate block">{headline}</span></div>}
                                </div>

                                {productName && (
                                  <div className="flex items-center gap-2 bg-emerald-50/90 border border-emerald-200/80 p-2 rounded-xl text-[10px]">
                                    <span className="p-1 bg-emerald-500 text-white rounded-md font-black shrink-0 text-[10px]">📦</span>
                                    <div className="min-w-0 flex-1">
                                      <span className="text-[8px] font-black text-emerald-700 uppercase block tracking-wider">Mapped Inventory Product</span>
                                      <span className="font-extrabold text-emerald-950 text-[11px] truncate block">{productName}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          <div><span className="text-[8px] font-black text-slate-400 uppercase block">Name</span><span className="text-[11px] font-bold text-slate-800">{leadInfo.name}</span></div>
                          <div><span className="text-[8px] font-black text-slate-400 uppercase block">Phone</span><span className="text-[11px] font-bold text-slate-800">{leadInfo.phone}</span></div>
                          <div><span className="text-[8px] font-black text-slate-400 uppercase block">Email</span><span className="text-[11px] font-bold text-slate-800">{leadInfo.email || '—'}</span></div>
                          <div><span className="text-[8px] font-black text-slate-400 uppercase block">Stage</span><span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${leadInfo.pipeline_stage === 'Won' ? 'bg-emerald-100 text-emerald-700' : leadInfo.pipeline_stage === 'Lost' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{leadInfo.pipeline_stage}</span></div>
                          <div className="col-span-2"><span className="text-[8px] font-black text-slate-400 uppercase block">Source</span><span className="text-[11px] font-bold text-slate-800">{leadInfo.source}</span></div>

                          {/* Structured Remarks & Call Logs */}
                          {leadInfo.remarks && (
                            <div className="col-span-2 mt-2 pt-2 border-t border-blue-100">
                              <span className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Activity & Call Logs</span>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {leadInfo.remarks.split(/\[(?=[\w\s⚠️🎙️💬]+\]:)/g).filter(Boolean).map((logItem, idx) => {
                                  const trimmed = logItem.trim();
                                  if (!trimmed) return null;
                                  const fullItem = trimmed.startsWith('[') ? trimmed : `[${trimmed}`;
                                  return (
                                    <div key={idx} className="text-[10px] bg-white border border-slate-200/80 p-2 rounded-lg text-slate-700 leading-relaxed font-medium">
                                      {fullItem}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {leadInfo.custom_fields && Object.keys(leadInfo.custom_fields).filter(k => k !== 'meta_ad_origin').length > 0 && (
                            <div className="col-span-2 mt-1 pt-2 border-t border-blue-100">
                              <span className="text-[8px] font-black text-slate-400 uppercase block mb-1">Flow Answers</span>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(leadInfo.custom_fields).filter(([k]) => k !== 'meta_ad_origin').map(([k, v]) => (
                                  <span key={k} className="text-[9px] bg-white border border-slate-200 px-2 py-1 rounded-lg font-bold text-slate-700">
                                    <span className="text-slate-400">{k}:</span> {String(v)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Messages View */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f0f2f5]/40 scrollbar-thin">
                  {loadingMessages ? (
                    <div className="text-center text-xs text-slate-400 flex items-center justify-center gap-1.5 h-full"><Loader2 className="animate-spin text-blue-600" size={14} /> Loading messages...</div>
                  ) : messages.length === 0 ? (
                    <div className="text-center text-xs text-slate-400 py-10 mt-10">No messages in this conversation.</div>
                  ) : (
                    messages.map((m) => {
                      const isOutbound = m.direction === 'outbound'
                      return (
                        <div 
                          key={m.id}
                          className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`
                            max-w-[70%] p-3 rounded-2xl text-xs shadow-sm leading-relaxed
                            ${isOutbound 
                              ? 'bg-emerald-500 text-white rounded-tr-none' 
                              : 'bg-white text-slate-800 rounded-tl-none border border-slate-100'
                            }
                          `}>
                            {/* Render media if present */}
                            {m.media_url && (m.media_type === 'image' || m.media_type === 'sticker') && (
                              <img 
                                src={`/api/whatsapp/media-proxy?url=${encodeURIComponent(m.media_url)}`}
                                alt="Shared image" 
                                className="rounded-lg mb-2 max-w-full max-h-60 object-contain cursor-pointer"
                                onClick={() => window.open(`/api/whatsapp/media-proxy?url=${encodeURIComponent(m.media_url!)}`, '_blank')}
                                loading="lazy"
                              />
                            )}
                            {m.media_url && m.media_type === 'video' && (
                              <video 
                                src={`/api/whatsapp/media-proxy?url=${encodeURIComponent(m.media_url)}`}
                                controls 
                                className="rounded-lg mb-2 max-w-full max-h-60"
                                preload="metadata"
                              />
                            )}
                            {m.media_url && m.media_type === 'audio' && (
                              <audio 
                                src={`/api/whatsapp/media-proxy?url=${encodeURIComponent(m.media_url)}`}
                                controls 
                                className="mb-2 max-w-full"
                                preload="metadata"
                              />
                            )}
                            {m.media_url && m.media_type === 'document' && (
                              <a 
                                href={`/api/whatsapp/media-proxy?url=${encodeURIComponent(m.media_url)}`}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className={`flex items-center gap-2 mb-2 p-2 rounded-lg text-xs font-medium ${isOutbound ? 'bg-emerald-600/30 text-white' : 'bg-slate-100 text-blue-600'}`}
                              >
                                📄 View Document
                              </a>
                            )}
                            {m.message_text && !(['[image]', '[video]', '[audio]', '[sticker]', '[document]'].includes(m.message_text?.toLowerCase())) && (
                              <p className="whitespace-pre-wrap">{m.message_text}</p>
                            )}
                            {(!m.message_text || ['[image]', '[video]', '[audio]', '[sticker]', '[document]'].includes(m.message_text?.toLowerCase())) && !m.media_url && (
                              <p className="whitespace-pre-wrap italic opacity-60">{m.message_text || '[media]'}</p>
                            )}
                            <span className={`text-[8px] block text-right mt-1.5 font-medium ${isOutbound ? 'text-emerald-100' : 'text-slate-400'}`}>
                              {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* 24h Window Notice */}
                {!isWindowActive && (
                  <div className="bg-amber-50 border-t border-b border-amber-100 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-slate-700">
                    <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                      ⚠️ 24h Customer Service Window Closed
                    </span>
                    <span className="text-[9px] text-slate-500 font-medium">To resume this chat, send a pre-approved WhatsApp template.</span>
                  </div>
                )}

                {/* Message Entry Input */}
                <div className="p-3 border-t border-slate-100 bg-white flex flex-col gap-3">
                  {isWindowActive ? (
                    <>
                      <div className="flex gap-2 items-center w-full">
                        <input 
                          type="text"
                          value={newMessageText}
                          onChange={(e) => setNewMessageText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage() }}
                          placeholder="Type a WhatsApp message..."
                          className="flex-1 bg-slate-50 border border-slate-200/80 px-4 py-2.5 rounded-full text-xs font-medium outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-slate-800"
                        />
                        <button
                          onClick={() => { setShowProductDropdown(!showProductDropdown); setShowTemplateInput(false); }}
                          disabled={sendingProducts}
                          className={`p-2.5 rounded-full transition-colors shadow-sm shrink-0 ${showProductDropdown ? 'bg-violet-500 text-white' : 'bg-violet-100 text-violet-600 hover:bg-violet-200'} disabled:opacity-50`}
                          title="Select & Send Product Details"
                        >
                          {sendingProducts ? <Loader2 className="animate-spin" size={16} /> : <Package size={16} />}
                        </button>
                        <button
                          onClick={() => { setShowTemplateInput(!showTemplateInput); setShowProductDropdown(false); }}
                          className={`p-2.5 rounded-full transition-colors shadow-sm shrink-0 ${showTemplateInput ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                          title="Send Template Message"
                        >
                          <FileText size={16} />
                        </button>
                        <button
                          onClick={handleSendMessage}
                          disabled={!newMessageText.trim() || sendingMessage}
                          className="p-2.5 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-colors shadow-sm shrink-0"
                        >
                          {sendingMessage ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                        </button>
                      </div>
                      {showProductDropdown && (
                        <div className="flex flex-col sm:flex-row gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                          <div className="flex-1">
                            <select 
                              value={selectedPropertyId}
                              onChange={(e) => setSelectedPropertyId(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-violet-500/20 text-slate-800 cursor-pointer"
                            >
                              {properties.length === 0 ? (
                                <option value="">No products found in inventory</option>
                              ) : (
                                properties.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.title} {p.price ? `(${p.price})` : ''}
                                  </option>
                                ))
                              )}
                            </select>
                          </div>
                          <button
                            onClick={handleSendProducts}
                            disabled={sendingProducts || !selectedPropertyId}
                            className="py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                          >
                            {sendingProducts ? <Loader2 className="animate-spin" size={14} /> : <Package size={12} />}
                            Send Product
                          </button>
                        </div>
                      )}
                      {showTemplateInput && (
                        <div className="flex flex-col sm:flex-row gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                          <div className="flex-1">
                            <select 
                              value={selectedTemplate}
                              onChange={(e) => setSelectedTemplate(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 cursor-pointer"
                            >
                              <option value="hello_world">Welcome (hello_world)</option>
                              {templates.filter(t => t.status === 'APPROVED').map(t => (
                                <option key={t.name} value={t.name}>{t.name} ({t.category})</option>
                              ))}
                              <option value="custom">Custom Template...</option>
                            </select>
                          </div>
                          {selectedTemplate === 'custom' && (
                            <input 
                              type="text"
                              value={customTemplateName}
                              onChange={(e) => setCustomTemplateName(e.target.value)}
                              placeholder="Template name"
                              className="flex-1 bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800"
                            />
                          )}
                          <button
                            onClick={handleSendTemplate}
                            disabled={sendingMessage || (selectedTemplate === 'custom' && !customTemplateName.trim())}
                            className="py-2.5 px-4 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                          >
                            {sendingMessage ? <Loader2 className="animate-spin" size={14} /> : <Send size={12} />}
                            Send Template
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col gap-2.5 w-full">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1">
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Select Template</label>
                          <select 
                            value={selectedTemplate}
                            onChange={(e) => setSelectedTemplate(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 cursor-pointer"
                          >
                            <option value="hello_world">Welcome (hello_world)</option>
                            {templates.filter(t => t.status === 'APPROVED').map(t => (
                              <option key={t.name} value={t.name}>{t.name} ({t.category})</option>
                            ))}
                            <option value="custom">Custom Template...</option>
                          </select>
                        </div>
                        {selectedTemplate === 'custom' && (
                          <>
                            <div className="flex-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Template Name</label>
                              <input 
                                type="text"
                                value={customTemplateName}
                                onChange={(e) => setCustomTemplateName(e.target.value)}
                                placeholder="e.g. follow_up_offer"
                                className="w-full bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800"
                              />
                            </div>
                            <div className="w-24">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Language</label>
                              <input 
                                type="text"
                                value={customTemplateLang}
                                onChange={(e) => setCustomTemplateLang(e.target.value)}
                                placeholder="en_US"
                                className="w-full bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800"
                              />
                            </div>
                          </>
                        )}
                      </div>
                      <button
                        onClick={handleSendTemplate}
                        disabled={sendingMessage || (selectedTemplate === 'custom' && !customTemplateName.trim())}
                        className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                      >
                        {sendingMessage ? <Loader2 className="animate-spin" size={16} /> : <Send size={14} />}
                        Send WhatsApp Template Message
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 gap-3">
                <div className="w-16 h-16 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300">
                  <MessageCircle size={32} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Select a Conversation</h3>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">Choose a contact from the sidebar list to see the conversation history and send replies via WhatsApp API.</p>
                </div>
              </div>
            )}
        </div>
      </div>

      {/* Enlargeable Ad Creative & Product Lightbox Modal */}
      {activeMediaModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative space-y-4 max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-slate-800 pb-3.5">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-indigo-600 rounded-xl text-sm font-black text-white shadow-md">🎯</span>
                <div>
                  <h3 className="font-extrabold text-base text-white">Meta Ad Creative & Product Mapping</h3>
                  <p className="text-[11px] text-slate-400">View enlarged media or open live Meta ad post</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeMediaModal.liveAdUrl && (
                  <a 
                    href={activeMediaModal.liveAdUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md active:scale-95"
                  >
                    🔗 Open Live Ad on Meta
                  </a>
                )}
                <button 
                  onClick={() => setActiveMediaModal(null)} 
                  className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-base font-extrabold transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Media Player / Photo */}
            <div className="bg-black rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center min-h-[260px] max-h-[62vh] shadow-inner">
              {activeMediaModal.origin?.video_url ? (
                <video 
                  src={activeMediaModal.origin.video_url} 
                  controls 
                  autoPlay 
                  className="w-full max-h-[60vh] object-contain rounded-xl"
                />
              ) : activeMediaModal.origin?.image_url ? (
                <img 
                  src={activeMediaModal.origin.image_url} 
                  alt="Enlarged Creative" 
                  className="w-full max-h-[60vh] object-contain rounded-xl"
                />
              ) : (
                <div className="text-slate-500 text-xs py-10 font-semibold">No visual media creative thumbnail available</div>
              )}
            </div>

            {/* Complete Ad Copy & Info Card */}
            <div className="space-y-3 bg-slate-800/80 p-4 rounded-2xl border border-slate-700/80">
              <div>
                <span className="text-[9px] font-black uppercase text-indigo-400 tracking-wider block">Ad Headline</span>
                <h4 className="font-extrabold text-sm text-white">{activeMediaModal.origin?.headline || activeMediaModal.origin?.ad_name}</h4>
              </div>
              {activeMediaModal.origin?.body && (
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Ad Copy (Primary Text)</span>
                  <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed mt-1">{activeMediaModal.origin.body}</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-700/80 text-[10px]">
                <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Ad Name</span><span className="font-bold text-slate-200 truncate block">{activeMediaModal.origin?.ad_name || 'N/A'}</span></div>
                <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Ad Set</span><span className="font-bold text-slate-200 truncate block">{activeMediaModal.origin?.adset_name || 'N/A'}</span></div>
                <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Campaign</span><span className="font-bold text-slate-200 truncate block">{activeMediaModal.origin?.campaign_name || 'N/A'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}