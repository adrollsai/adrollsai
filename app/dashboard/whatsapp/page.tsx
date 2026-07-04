'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, UserPlus, CalendarClock, BellRing, LucideIcon, Send, Inbox, User, Loader2, ArrowLeft } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

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
}

type Message = {
  id: string
  chat_id: string
  direction: 'inbound' | 'outbound'
  message_text: string
  created_at: string
}

export default function AutomationPage() {
  const supabase = createClient()
  
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Cache chats updates
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('wa_cached_chats', JSON.stringify(chats))
    }
  }, [chats])

  // Fetch chats on mount
  useEffect(() => {
    fetchChats()
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
    } else {
      setMessages([])
    }
  }, [selectedChatId])

  // Cache messages updates
  useEffect(() => {
    if (selectedChatId && messages.length > 0) {
      localStorage.setItem(`wa_cached_msgs_${selectedChatId}`, JSON.stringify(messages))
    }
  }, [selectedChatId, messages])

  // Realtime Messages Subscription
  useEffect(() => {
    if (!selectedChatId) return

    const channel = supabase
      .channel(`chat-realtime-${selectedChatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `chat_id=eq.${selectedChatId}`
        },
        (payload) => {
          const newMsg = payload.new as Message
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev
            return [...prev, newMsg]
          })
          // Keep sidebar updated
          fetchChats()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedChatId])

  // Scroll messages list to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchChats = async () => {
    setLoadingChats(true)
    try {
      const res = await fetch('/api/whatsapp/chat')
      const data = await res.json()
      if (data.success) {
        setChats(data.chats || [])
      }
    } catch (e) {
      console.error(e)
    }
    setLoadingChats(false)
  }

  const fetchMessages = async (chatId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/whatsapp/chat?chatId=${chatId}`)
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

  const handleSendMessage = async () => {
    if (!selectedChatId || !newMessageText.trim() || sendingMessage) return
    setSendingMessage(true)
    try {
      const res = await fetch('/api/whatsapp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: selectedChatId, messageText: newMessageText })
      })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, data.message])
        setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, last_message_text: newMessageText, updated_at: new Date().toISOString() } : c))
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
    setSendingMessage(true)

    const templateName = selectedTemplate === 'custom' ? customTemplateName.trim() : selectedTemplate
    const language = selectedTemplate === 'custom' ? customTemplateLang.trim() : 'en_US'

    if (!templateName) {
      alert("Please enter a valid template name.")
      setSendingMessage(false)
      return
    }

    try {
      const res = await fetch('/api/whatsapp/chat', {
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">WhatsApp Portal</h1>
          <p className="text-slate-500 text-xs mt-1">Live customer and bot conversations</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-[2rem] shadow-xl overflow-hidden h-[600px] flex">
          
          {/* Chats Sidebar */}
          <div className="w-1/3 border-r border-slate-100 flex flex-col bg-slate-50/50">
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
          <div className="flex-1 flex flex-col bg-slate-50/20">
            {selectedChat ? (
              <>
                {/* Chat Pane Header */}
                <div className="p-4 border-b border-slate-100 bg-white flex justify-between items-center shadow-sm">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setSelectedChatId(null)}
                      className="sm:hidden p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <div>
                      <h3 className="text-xs font-black text-slate-800">{selectedChat.recipient_name || selectedChat.recipient_phone}</h3>
                      <p className="text-[9px] font-bold text-emerald-600 mt-0.5">● Connected to {selectedChat.recipient_phone}</p>
                    </div>
                  </div>
                </div>

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
                            <p className="whitespace-pre-wrap">{m.message_text}</p>
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
                        onClick={handleSendMessage}
                        disabled={!newMessageText.trim() || sendingMessage}
                        className="p-2.5 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-colors shadow-sm shrink-0"
                      >
                        {sendingMessage ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                      </button>
                    </div>
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

    </div>
  )
}