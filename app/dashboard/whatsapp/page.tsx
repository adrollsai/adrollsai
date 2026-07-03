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
  const [activeTab, setActiveTab] = useState<'automations' | 'chat'>('automations')
  
  // Settings & Automations states
  const [flows, setFlows] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [whatsappConnected, setWhatsappConnected] = useState(false)
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [whatsappWabaId, setWhatsappWabaId] = useState('')
  const [whatsappPhoneId, setWhatsappPhoneId] = useState('')

  // Live Chat Inbox states
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessageText, setNewMessageText] = useState('')
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch automations and WABA configs on load
  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch automations
      const { data: flowData } = await supabase
        .from('automations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })

      if (flowData) setFlows(flowData)

      // Fetch profile data
      const { data: profileData } = await supabase
        .from('profiles')
        .select('whatsapp_access_token, whatsapp_phone_number, whatsapp_waba_id, whatsapp_phone_number_id')
        .eq('id', user.id)
        .single()

      if (profileData) {
        setWhatsappConnected(!!profileData.whatsapp_access_token)
        setWhatsappNumber(profileData.whatsapp_phone_number || '')
        setWhatsappWabaId(profileData.whatsapp_waba_id || '')
        setWhatsappPhoneId(profileData.whatsapp_phone_number_id || '')
      }

      setLoading(false)
    }
    fetchData()
  }, [])

  // Fetch chats when switching to chat tab
  useEffect(() => {
    if (activeTab === 'chat') {
      fetchChats()
    }
  }, [activeTab])

  // Fetch messages when a chat is selected
  useEffect(() => {
    if (selectedChatId) {
      fetchMessages(selectedChatId)
    } else {
      setMessages([])
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

  // Load Facebook SDK
  useEffect(() => {
    if (typeof window === 'undefined') return;

    (function (d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0] as any;
      if (d.getElementById(id)) return;
      js = d.createElement(s) as any; js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'facebook-jssdk'));

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v20.0'
      });
    };
  }, []);

  const handleWhatsAppConnect = () => {
    if (!(window as any).FB) {
      alert("Facebook SDK is still loading. Please wait a moment and try again.");
      return;
    }

    let code: string | null = null;
    let metadata: { wabaId?: string; phone_number_id?: string } | null = null;
    let submitted = false;

    const checkAndSubmit = async (force = false) => {
      if (submitted) return;

      if (code && (metadata || force)) {
        submitted = true;
        window.removeEventListener('message', messageListener);

        const finalMetadata = metadata || {};
        try {
          const res = await fetch('/api/whatsapp/onboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              wabaId: finalMetadata.wabaId,
              phone_number_id: finalMetadata.phone_number_id
            })
          });

          const result = await res.json();
          if (res.ok) {
            setWhatsappConnected(true);
            setWhatsappNumber(result.phone || 'Connected');
            setWhatsappWabaId(result.wabaId || finalMetadata.wabaId || '');
            setWhatsappPhoneId(result.phone_number_id || finalMetadata.phone_number_id || '');
            alert("WhatsApp API connected successfully!");
          } else {
            alert(`Onboarding failed: ${result.error}`);
            submitted = false;
          }
        } catch (err: any) {
          console.error(err);
          alert("Failed to complete onboarding.");
          submitted = false;
        }
      }
    };

    const messageListener = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') {
        return;
      }

      try {
        const data = JSON.parse(event.data);
        let wabaId = '';
        let phone_number_id = '';

        if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
          wabaId = data.data?.waba_id || '';
          phone_number_id = data.data?.phone_number_id || '';
        } else if (data.action === 'whatsapp-embedded-signup-complete') {
          wabaId = data.payload?.wabaId || '';
          phone_number_id = data.payload?.phone_number_id || '';
        }

        if (wabaId || phone_number_id) {
          metadata = { wabaId, phone_number_id };
          checkAndSubmit();
        }
      } catch (e) {}
    };

    window.addEventListener('message', messageListener);

    (window as any).FB.login((response: any) => {
      if (response.authResponse) {
        code = response.authResponse.code;
        checkAndSubmit();
        setTimeout(() => {
          checkAndSubmit(true);
        }, 1500);
      } else {
        window.removeEventListener('message', messageListener);
      }
    }, {
      config_id: process.env.NEXT_PUBLIC_FACEBOOK_LOGIN_CONFIG_ID || '4311232925804423',
      response_type: 'code',
      override_default_response_type: true
    });
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect WhatsApp API? Your automations will stop working.")) {
      return;
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({
        whatsapp_access_token: null,
        whatsapp_waba_id: null,
        whatsapp_phone_number_id: null,
        whatsapp_phone_number: null,
        whatsapp_connected_at: null
      })
      .eq('id', user.id);

    if (!error) {
      setWhatsappConnected(false);
      setWhatsappNumber('');
      setWhatsappWabaId('');
      setWhatsappPhoneId('');
      alert("WhatsApp API disconnected.");
    } else {
      alert("Failed to disconnect: " + error.message);
    }
  };

  const toggleFlow = async (id: string, currentStatus: boolean) => {
    setFlows(flows.map(f => f.id === id ? { ...f, is_active: !currentStatus } : f))
    const { error } = await supabase
      .from('automations')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (error) {
      setFlows(flows.map(f => f.id === id ? { ...f, is_active: currentStatus } : f))
    }
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 className="animate-spin text-blue-600" size={16} /> Loading Automations...</div>

  const selectedChat = chats.find(c => c.id === selectedChatId)

  return (
    <div className={`p-5 mx-auto min-h-screen pb-24 transition-all duration-300 ${activeTab === 'chat' ? 'max-w-5xl' : 'max-w-md'}`}>
      
      {/* Header & Tabs */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">WhatsApp Portal</h1>
          <p className="text-slate-500 text-xs mt-1">Manage automations & live conversations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-2xl mb-6">
        <button 
          onClick={() => setActiveTab('automations')}
          className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${activeTab === 'automations' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Settings & Automations
        </button>
        <button 
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${activeTab === 'chat' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Conversations Inbox
        </button>
      </div>

      {/* TAB 1: AUTOMATIONS & CONNECTION */}
      {activeTab === 'automations' && (
        <div className="space-y-6">
          {/* WhatsApp Connection Status Card */}
          <div className="bg-white border border-slate-100 rounded-[1.5rem] p-4 shadow-md shadow-slate-100/50 mb-6 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2.5 rounded-xl flex items-center justify-center ${whatsappConnected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                <MessageCircle size={20} />
              </div>
              <div>
                <h2 className="font-bold text-sm text-slate-800">WhatsApp API Integration</h2>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">Connect your business number to automate customer follow-ups</p>
              </div>
            </div>

            {whatsappConnected ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-emerald-50/50 border border-emerald-100/50 p-3 rounded-2xl">
                  <div>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Status</p>
                    <p className="text-xs text-emerald-600 font-bold mt-0.5">● Connected</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Number</p>
                    <p className="text-xs text-slate-700 font-semibold mt-0.5">{whatsappNumber || 'N/A'}</p>
                  </div>
                </div>
                
                <button
                  onClick={() => handleDisconnect()}
                  className="w-full py-2.5 px-4 rounded-xl border border-rose-100 text-rose-600 hover:bg-rose-50/50 text-xs font-semibold transition-all text-center"
                >
                  Disconnect WhatsApp API
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleWhatsAppConnect()}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-semibold transition-all text-center flex items-center justify-center gap-2 shadow-sm"
              >
                <MessageCircle size={16} />
                Connect WhatsApp API
              </button>
            )}
          </div>

          {/* Automations List */}
          <div className="space-y-3">
            {flows.map((flow) => {
              const IconComponent = iconMap[flow.icon_name] || MessageCircle
              return (
                <div 
                  key={flow.id}
                  className={`relative p-4 rounded-[1.5rem] border transition-all duration-300 ${flow.is_active ? 'bg-white border-blue-100 shadow-md shadow-blue-50/50' : 'bg-slate-50 border-slate-100 opacity-80'}`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex gap-3">
                      <div className={`p-2.5 rounded-xl flex items-center justify-center transition-colors ${flow.is_active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
                        <IconComponent size={20} />
                      </div>
                      <div>
                        <h3 className={`font-bold text-sm ${flow.is_active ? 'text-slate-800' : 'text-slate-500'}`}>
                          {flow.title}
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5 max-w-[200px] leading-relaxed">
                          {flow.description}
                        </p>
                      </div>
                    </div>

                    <button 
                      onClick={() => toggleFlow(flow.id, flow.is_active)}
                      className={`w-10 h-6 rounded-full flex items-center transition-all duration-300 px-0.5 ${flow.is_active ? 'bg-slate-900' : 'bg-slate-300'}`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${flow.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-slate-100/50">
                    <span className={`text-[10px] font-bold ${flow.is_active ? 'text-green-600' : 'text-slate-400'}`}>
                      {flow.is_active ? '● Active' : '○ Inactive'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {flow.stats}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* TAB 2: LIVE CHAT INBOX */}
      {activeTab === 'chat' && (
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
                          className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} animate-in fade-in duration-200`}
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

                {/* Message Entry Input */}
                <div className="p-3 border-t border-slate-100 bg-white flex gap-2 items-center">
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
                    className="p-2.5 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-colors shadow-sm"
                  >
                    {sendingMessage ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  </button>
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
      )}

    </div>
  )
}