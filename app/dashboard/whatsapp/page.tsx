'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, UserPlus, CalendarClock, BellRing, LucideIcon, LogIn, Send, FlaskConical } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Script from 'next/script'
import { useRouter } from 'next/navigation'

// 1. Map String names to Actual Icons
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

declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: any;
  }
}

export default function AutomationPage() {
  const supabase = createClient()
  const router = useRouter()
  
  const [flows, setFlows] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  
  // Test Lab State
  const [testPhone, setTestPhone] = useState('')
  const [testMessage, setTestMessage] = useState('Hello from AdRolls! 🚀')
  const [sendingTest, setSendingTest] = useState(false)

  const onboardingData = useRef<{ waba_id?: string; phone_number_id?: string }>({})

  // 2. Fetch Data (Profile + Automations)
  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('whatsapp_business_account_id')
        .eq('id', user.id)
        .single()

      if (profile?.whatsapp_business_account_id) {
        setIsConnected(true)
        const { data: flowsData } = await supabase
          .from('automations')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })
        
        if (flowsData) setFlows(flowsData)
      } else {
        setIsConnected(false)
      }
      setLoading(false)
    }
    fetchData()
  }, [])

  // 3. Send Test Message Function
  const handleSendTest = async () => {
    if (!testPhone) {
        alert("Please enter a phone number with country code (e.g., 15550001234)")
        return
    }
    setSendingTest(true)
    try {
        const res = await fetch('/api/whatsapp/test-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: testPhone, message: testMessage })
        })
        const data = await res.json()
        
        if (res.ok) {
            alert("✅ Message Sent!")
        } else {
            alert("❌ Failed: " + (data.error || "Unknown Error"))
        }
    } catch (e) {
        alert("Network Error")
    } finally {
        setSendingTest(false)
    }
  }

  // 4. Toggle Function
  const toggleFlow = async (id: string, currentStatus: boolean) => {
    setFlows(flows.map(f => f.id === id ? { ...f, is_active: !currentStatus } : f))

    const { error } = await supabase
      .from('automations')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (error) {
      console.error('Error updating automation:', error)
      setFlows(flows.map(f => f.id === id ? { ...f, is_active: currentStatus } : f))
    }
  }

  // 5. WhatsApp Onboarding Logic
  const launchWhatsAppSignup = () => {
    setIsConnecting(true)
    if (!window.FB) {
        console.error("Facebook SDK not loaded")
        setIsConnecting(false)
        return
    }
    onboardingData.current = {}
    window.FB.login((response: any) => {
      const handleResponse = async () => {
        if (response.authResponse?.code) {
          const code = response.authResponse.code;
          console.log("Got Auth Code via Config ID, waiting for WABA data...", code);
          await new Promise(r => setTimeout(r, 1500));
          await finalizeConnection(code);
        } else {
          console.log('User cancelled login or did not fully authorize.');
          setIsConnecting(false)
        }
      };
      handleResponse();
    }, {
      config_id: '1385279906478644', 
      response_type: 'code',
      override_default_response_type: true
    });
  }

  const finalizeConnection = async (code: string) => {
    let retries = 0;
    while ((!onboardingData.current.waba_id || !onboardingData.current.phone_number_id) && retries < 5) {
        console.log("Waiting for WABA event data...");
        await new Promise(r => setTimeout(r, 1000));
        retries++;
    }
    const { waba_id, phone_number_id } = onboardingData.current;
    try {
        const res = await fetch('/api/whatsapp/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code, 
                waba_id: waba_id || '', 
                phone_number_id: phone_number_id || ''
            })
        })
        if (res.ok) {
            window.location.reload()
        } else {
            console.error("Failed to connect")
            setIsConnecting(false)
        }
    } catch (e) {
        console.error("Connection Error", e)
        setIsConnecting(false)
    }
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH') {
            const { waba_id, phone_number_id } = data.data;
            onboardingData.current = { waba_id, phone_number_id };
          } else if (data.event === 'CANCEL') {
            setIsConnecting(false)
          }
        }
      } catch (e) {}
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);


  if (loading) return <div className="p-10 text-center text-slate-400 text-sm">Loading agents...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen">
      <Script
        id="fb-sdk"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.fbAsyncInit = function() {
              FB.init({
                appId      : '${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}',
                cookie     : true,
                xfbml      : true,
                version    : 'v19.0'
              });
            };
          `,
        }}
      />
      <Script async defer crossOrigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js" />

      {/* Header */}
      <div className="mb-6 flex justify-between items-end">
        <div>
            <h1 className="text-2xl font-bold text-slate-900">Automation</h1>
            <p className="text-slate-500 text-xs mt-1">Control your WhatsApp agents</p>
        </div>
        {isConnected && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-bold border border-green-100">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Connected
            </div>
        )}
      </div>

      {!isConnected ? (
        // --- ONBOARDING VIEW ---
        <div className="flex flex-col items-center justify-center p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center mt-10">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
            <MessageCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Connect WhatsApp</h2>
          <p className="text-slate-500 text-xs mb-6 max-w-[240px] mx-auto">
            Link your WhatsApp Business Account to start running automated agents.
          </p>
          <button 
            onClick={launchWhatsAppSignup}
            disabled={isConnecting}
            className="flex items-center gap-2 bg-[#1877F2] hover:bg-[#166fe5] text-white px-6 py-3 rounded-full text-sm font-medium transition-all shadow-lg shadow-blue-100 disabled:opacity-70"
          >
            {isConnecting ? (
              <span>Connecting...</span>
            ) : (
              <>
                <LogIn size={16} />
                <span>Continue with Facebook</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-6 mb-24">
          
          {/* 1. TEST LAB SECTION (Added for you) */}
          <div className="bg-white p-5 rounded-[1.5rem] border border-indigo-100 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <FlaskConical size={18} className="text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-sm">Test Lab</h3>
            </div>
            
            <div className="space-y-3">
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">To Phone Number</label>
                    <input 
                        type="text" 
                        placeholder="e.g. 15551234567"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <p className="text-[10px] text-slate-400 mt-1 ml-1">
                        Must include country code (e.g., 1 for US, 91 for India). No '+' symbol.
                    </p>
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Message</label>
                    <input 
                        type="text" 
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                </div>
                <button 
                    onClick={handleSendTest}
                    disabled={sendingTest}
                    className="w-full mt-2 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-70"
                >
                    {sendingTest ? "Sending..." : (
                        <>
                            <Send size={16} /> Send Test Message
                        </>
                    )}
                </button>
            </div>
            <div className="mt-4 p-3 bg-indigo-50 rounded-xl text-[11px] text-indigo-800 leading-relaxed">
                <strong>Tip:</strong> If sending to a real phone (not a test user), you must <strong>reply</strong> to the business number first from your phone to open the 24h session window.
            </div>
          </div>

          {/* 2. AGENTS LIST (Existing) */}
          <h3 className="font-bold text-slate-900 text-lg px-1">Your Agents</h3>
          {flows.length === 0 && (
            <div className="flex flex-col items-center justify-center p-10 bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-200 text-center">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 text-slate-400">
                    <MessageCircle size={24} />
                </div>
                <h3 className="text-slate-900 font-semibold text-sm">No Active Agents</h3>
                <p className="text-slate-500 text-xs mt-1 max-w-[200px] leading-relaxed">
                    Create your first automation agent to get started.
                </p>
            </div>
          )}
          {flows.map((flow) => {
            const IconComponent = iconMap[flow.icon_name] || MessageCircle
            return (
              <div key={flow.id} className={`relative p-4 rounded-[1.5rem] border transition-all duration-300 ${flow.is_active ? 'bg-white border-blue-100 shadow-md shadow-blue-50/50' : 'bg-slate-50 border-slate-100 opacity-80'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex gap-3">
                    <div className={`p-2.5 rounded-xl flex items-center justify-center transition-colors ${flow.is_active ? 'bg-primary text-primary-text' : 'bg-slate-200 text-slate-400'}`}>
                      <IconComponent size={20} />
                    </div>
                    <div>
                      <h3 className={`font-bold text-sm ${flow.is_active ? 'text-slate-800' : 'text-slate-500'}`}>{flow.title}</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5 max-w-[140px] leading-relaxed">{flow.description}</p>
                    </div>
                  </div>
                  <button onClick={() => toggleFlow(flow.id, flow.is_active)} className={`w-10 h-6 rounded-full flex items-center transition-all duration-300 px-0.5 ${flow.is_active ? 'bg-slate-900' : 'bg-slate-300'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${flow.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-slate-100/50">
                  <span className={`text-[10px] font-bold ${flow.is_active ? 'text-green-600' : 'text-slate-400'}`}>{flow.is_active ? '● Active' : '○ Inactive'}</span>
                  <span className="text-[10px] text-slate-400 font-medium">{flow.stats}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}