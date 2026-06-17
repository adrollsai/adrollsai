'use client'

import { useState, useEffect } from 'react'
import { MessageCircle, UserPlus, CalendarClock, BellRing, LucideIcon } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

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

export default function AutomationPage() {
  const supabase = createClient()
  const [flows, setFlows] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)

  // WhatsApp connection states
  const [whatsappConnected, setWhatsappConnected] = useState(false)
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [whatsappWabaId, setWhatsappWabaId] = useState('')
  const [whatsappPhoneId, setWhatsappPhoneId] = useState('')

  // 2. Fetch Automations and Profile from DB
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

  // Load Facebook SDK
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Load SDK script
    (function (d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0] as any;
      if (d.getElementById(id)) return;
      js = d.createElement(s) as any; js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'facebook-jssdk'));

    // Initialize SDK
    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v20.0'
      });
    };
  }, []);

  // WhatsApp Connect Action
  const handleWhatsAppConnect = () => {
    if (!(window as any).FB) {
      alert("Facebook SDK is still loading. Please wait a moment and try again.");
      return;
    }

    let code: string | null = null;
    let metadata: { wabaId?: string; phone_number_id?: string } | null = null;
    let submitted = false;

    // Check if both elements are present, then submit to backend
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
            submitted = false; // Allow retry on failure
          }
        } catch (err: any) {
          console.error(err);
          alert("Failed to complete onboarding.");
          submitted = false; // Allow retry on failure
        }
      }
    };

    // Set up message listener for WABA/Phone IDs from Meta's popup
    const messageListener = (event: MessageEvent) => {
      // Allow both facebook.com and web.facebook.com origins
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
          console.log("Embedded Signup metadata received via postMessage:", { wabaId, phone_number_id });
          metadata = { wabaId, phone_number_id };
          checkAndSubmit();
        }
      } catch (e) {
        // Ignore non-JSON or other event messages
      }
    };

    window.addEventListener('message', messageListener);

    (window as any).FB.login((response: any) => {
      if (response.authResponse) {
        code = response.authResponse.code;
        console.log("Embedded Signup code received via FB.login:", code);
        
        // Wait up to 1.5 seconds for the postMessage event to deliver the metadata
        // If it doesn't arrive by then, submit using whatever metadata we might have.
        checkAndSubmit();
        setTimeout(() => {
          checkAndSubmit(true); // Force submit
        }, 1500);
      } else {
        console.log('User cancelled login or did not fully authorize.');
        window.removeEventListener('message', messageListener);
      }
    }, {
      config_id: process.env.NEXT_PUBLIC_FACEBOOK_LOGIN_CONFIG_ID || '4311232925804423',
      response_type: 'code',
      override_default_response_type: true
    });
  };

  // WhatsApp Disconnect Action
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

  // 3. Toggle Function (Updates DB immediately)
  const toggleFlow = async (id: string, currentStatus: boolean) => {
    // Optimistic UI Update
    setFlows(flows.map(f => f.id === id ? { ...f, is_active: !currentStatus } : f))

    // Send update to Supabase
    const { error } = await supabase
      .from('automations')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    // Revert switch if error
    if (error) {
      console.error('Error updating automation:', error)
      setFlows(flows.map(f => f.id === id ? { ...f, is_active: currentStatus } : f))
    }
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm">Loading agents...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen">
      
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Automation</h1>
        <p className="text-slate-500 text-xs mt-1">Control your WhatsApp agents</p>
      </div>

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
      <div className="space-y-3 mb-24">
        {flows.map((flow) => {
          const IconComponent = iconMap[flow.icon_name] || MessageCircle

          return (
            <div 
              key={flow.id}
              className={`
                relative p-4 rounded-[1.5rem] border transition-all duration-300
                ${flow.is_active 
                  ? 'bg-white border-blue-100 shadow-md shadow-blue-50/50' 
                  : 'bg-slate-50 border-slate-100 opacity-80'
                }
              `}
            >
              <div className="flex justify-between items-start mb-3">
                
                <div className="flex gap-3">
                  <div className={`
                    p-2.5 rounded-xl flex items-center justify-center transition-colors
                    ${flow.is_active ? 'bg-primary text-primary-text' : 'bg-slate-200 text-slate-400'}
                  `}>
                    <IconComponent size={20} />
                  </div>
                  <div>
                    <h3 className={`font-bold text-sm ${flow.is_active ? 'text-slate-800' : 'text-slate-500'}`}>
                      {flow.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5 max-w-[140px] leading-relaxed">
                      {flow.description}
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => toggleFlow(flow.id, flow.is_active)}
                  className={`
                    w-10 h-6 rounded-full flex items-center transition-all duration-300 px-0.5
                    ${flow.is_active ? 'bg-slate-900' : 'bg-slate-300'}
                  `}
                >
                  <div className={`
                    w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300
                    ${flow.is_active ? 'translate-x-4' : 'translate-x-0'}
                  `} />
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
  )
}