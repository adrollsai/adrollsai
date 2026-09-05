'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { 
  Phone, 
  Loader2, 
  HelpCircle, 
  ArrowLeft, 
  Save, 
  ShieldCheck, 
  Settings, 
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Play,
  Users,
  ExternalLink,
  X,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Building2,
  User,
  Copy,
  Check,
  CreditCard,
  Zap,
  Radio,
  FileCheck,
  ChevronDown,
  Mail,
  Search,
  Lock,
  ChevronLeft,
  ChevronRight,
  Info
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import { type VobizAvailableNumber } from '@/utils/vobiz-catalog'

interface VoiceAgentSettingsProps {
  userId: string
  onBack: () => void
}

export default function VoiceAgentSettings({ userId, onBack }: VoiceAgentSettingsProps) {
  const supabase = createClient()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saasMode, setSaasMode] = useState(true)
  const [provisioning, setProvisioning] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [copiedNumber, setCopiedNumber] = useState(false)
  
  // Telephony & Provider Settings
  const [telephonyProvider, setTelephonyProvider] = useState<'vobiz' | 'twilio'>('twilio')
  const [vobizNumber, setVobizNumber] = useState<string>('')
  const [twilioNumber, setTwilioNumber] = useState<string>('')
  const [concurrencyLimit, setConcurrencyLimit] = useState<number>(3)
  const [credits, setCredits] = useState<number>(0)
  
  const [settings, setSettings] = useState({
    elevenlabs_api_key: '',
    elevenlabs_agent_id: '',
    voice_twilio_sid: '',
    voice_twilio_token: '',
    voice_twilio_number: '',
    auto_call_new_leads: false,
    voice_provider: 'gemini',
    voice_name: 'Aoede'
  })

  // KYC States
  const [kycStatus, setKycStatus] = useState<'not_submitted' | 'pending' | 'verified' | 'rejected'>('not_submitted')
  const [kycType, setKycType] = useState<'individual' | 'business'>('individual')
  const [kycData, setKycData] = useState<any>({})
  const [showKycModal, setShowKycModal] = useState(false)
  const [submittingKyc, setSubmittingKyc] = useState(false)
  const [sendingKycEmail, setSendingKycEmail] = useState(false)
  const [kycForm, setKycForm] = useState({
    name: '',
    email: '',
    phone: '',
    description: '',
    entityType: 'individual' as 'individual' | 'business'
  })

  // Lazy-loaded Number Catalog & Exploration
  const [showNumberCatalog, setShowNumberCatalog] = useState(false)
  const [selectedCatalogNumber, setSelectedCatalogNumber] = useState<string>('')
  const [claimedNumbers, setClaimedNumbers] = useState<string[]>([])
  const [catalogNumbers, setCatalogNumbers] = useState<(VobizAvailableNumber & { isClaimed?: boolean })[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [categoryCounts, setCategoryCounts] = useState({ all: 0, VIP: 0, easyRecall: 0, standard: 0 })
  const [numberSearchQuery, setNumberSearchQuery] = useState('')
  const [numberCategoryFilter, setNumberCategoryFilter] = useState<'all' | 'VIP' | 'Easy Recall' | 'Standard'>('all')
  const numbersPerPage = 8

  const [connected, setConnected] = useState(false)
  const [sources, setSources] = useState<string[]>(['Facebook', 'Manual', 'CSV Import', '99acres', 'Housing.com'])
  const [pipelineStages, setPipelineStages] = useState<string[]>(['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified'])
  const [metaCampaigns, setMetaCampaigns] = useState<string[]>([])
  const [csvAudiences, setCsvAudiences] = useState<string[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'connection' | 'campaigns'>('connection')
  const [activeCallLead, setActiveCallLead] = useState<any>(null)
  const [allLeads, setAllLeads] = useState<any[]>([])
  const [selectedCampaignForModal, setSelectedCampaignForModal] = useState<any>(null)

  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedMetaCampaigns, setSelectedMetaCampaigns] = useState<string[]>([])
  const [selectedCsvAudiences, setSelectedCsvAudiences] = useState<string[]>([])
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [targetAudienceType, setTargetAudienceType] = useState<'all' | 'custom'>('all')

  const [metaCampaignSearchQuery, setMetaCampaignSearchQuery] = useState('')
  const [csvAudienceSearchQuery, setCsvAudienceSearchQuery] = useState('')

  const [campaignForm, setCampaignForm] = useState({
    name: '',
    filterType: 'all', // 'all', 'source', 'stage'
    filterValue: '',
    facebookCampaign: '',
    customPrompt: '',
    voiceName: 'Aoede',
    greeting: ''
  })

  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [oldVoiceNumber, setOldVoiceNumber] = useState('')

  const isMasterNobogent = useMemo(() => {
    return userEmail.toLowerCase() === 'rchopra489@gmail.com'
  }, [userEmail])

  const isSubscriptionActive = useMemo(() => {
    const status = subscriptionStatus.toLowerCase()
    if (isMasterNobogent) return true
    return ['active', 'trialing', 'pro', 'growth'].includes(status)
  }, [subscriptionStatus, isMasterNobogent])

  const isKycVerified = useMemo(() => {
    if (isMasterNobogent) return true
    return kycStatus === 'verified'
  }, [isMasterNobogent, kycStatus])

  const effectiveKycEmail = useMemo(() => {
    if (kycData?.email) return kycData.email
    if (isMasterNobogent) return 'nobogent@gmail.com'
    return ''
  }, [kycData, isMasterNobogent])

  const effectiveKycName = useMemo(() => {
    if (kycData?.subAccountName) return kycData.subAccountName
    if (kycData?.fullName) return kycData.fullName
    if (kycData?.companyName) return kycData.companyName
    if (isMasterNobogent) return 'Nobogent'
    return ''
  }, [kycData, isMasterNobogent])

  const fetchLazyNumbers = async (pageToFetch = 1, append = false) => {
    if (pageToFetch === 1 && !append) {
      setCatalogLoading(true)
    } else {
      setCatalogLoadingMore(true)
    }

    try {
      const urlParams = new URLSearchParams()
      urlParams.set('page', String(pageToFetch))
      urlParams.set('limit', String(numbersPerPage))
      if (numberSearchQuery.trim()) {
        urlParams.set('search', numberSearchQuery.trim())
      }
      if (numberCategoryFilter !== 'all') {
        urlParams.set('category', numberCategoryFilter)
      }

      const res = await fetch(`/api/voice/numbers?${urlParams.toString()}`)
      const data = await res.json()
      if (data.success && Array.isArray(data.numbers)) {
        if (append) {
          setCatalogNumbers(prev => [...prev, ...data.numbers])
        } else {
          setCatalogNumbers(data.numbers)
        }
        setCatalogTotal(data.total || 0)
        setCatalogPage(pageToFetch)
        setCatalogHasMore(!!data.hasMore)
        if (data.categoryCounts) {
          setCategoryCounts(data.categoryCounts)
        }
      }
    } catch (err) {
      console.error('[LAZY NUMBERS FETCH ERROR]', err)
    } finally {
      setCatalogLoading(false)
      setCatalogLoadingMore(false)
    }
  }

  // Debounced lazy search / category filter
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLazyNumbers(1, false)
    }, 250)
    return () => clearTimeout(timer)
  }, [numberSearchQuery, numberCategoryFilter])

  const handleLoadMoreNumbers = () => {
    if (catalogLoadingMore || !catalogHasMore) return
    fetchLazyNumbers(catalogPage + 1, true)
  }

  const fetchCampaignsAndFilters = async () => {
    if (!userId) return
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const campsRes = await fetch(`/api/voice/campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
      const campsData = await campsRes.json()
      if (campsData.success && campsData.campaigns) {
        setCampaigns(campsData.campaigns)
      }

      let metaApiCampaignItems: string[] = []
      try {
        const metaRes = await fetch(`/api/meta-ads/campaigns${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
        const metaData = await metaRes.json()
        if (metaData.campaigns) {
          metaApiCampaignItems = metaData.campaigns
            .filter((c: any) => c.name && c.id)
            .map((c: any) => `${c.id}|${c.name}`)
        }
      } catch (err) {
        console.error("[META API CAMPAIGNS FETCH ERROR]", err)
      }

      const { data: leads, error: leadsErr } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', userId)

      if (!leadsErr && leads) {
        setAllLeads(leads)
        const uniqueSources = Array.from(new Set(leads.map(l => l.source).filter(Boolean))) as string[]
        const defaultSources = ['Facebook', 'Manual', 'CSV Import', '99acres', 'Housing.com']
        const allSources = Array.from(new Set([...defaultSources, ...uniqueSources]))

        const uniqueStages = Array.from(new Set(leads.map(l => l.pipeline_stage).filter(Boolean))) as string[]
        const defaultStages = ['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified']
        const allStages = Array.from(new Set([...defaultStages, ...uniqueStages]))

        const fbCampaignsFromLeads = Array.from(new Set(
          leads
            .filter(l => l.source?.toLowerCase()?.includes('facebook'))
            .map(l => l.campaign_id ? `${l.campaign_id}|${l.ad_name || l.campaign_name || l.campaign_id}` : (l.ad_name || l.campaign_name))
            .filter(Boolean)
        )) as string[]

        const fbCampaigns = Array.from(new Set([...metaApiCampaignItems, ...fbCampaignsFromLeads]))
        const csvAuds = Array.from(new Set(leads.map(l => l.csv_audience).filter(Boolean))) as string[]

        setSources(allSources)
        setPipelineStages(allStages)
        setMetaCampaigns(fbCampaigns)
        setCsvAudiences(csvAuds)
      }

      const { data: activeCallLeads } = await supabase
        .from('leads')
        .select('id, name, phone, voice_campaign_id')
        .eq('user_id', userId)
        .eq('voice_call_status', 'calling')
        .limit(1)

      if (activeCallLeads && activeCallLeads.length > 0) {
        setActiveCallLead(activeCallLeads[0])
      } else {
        setActiveCallLead(null)
      }
    } catch (err) {
      console.error('[CAMPAIGN DETAILS FETCH]', err)
    }
  }

  const playVoicePreview = (voiceName: string) => {
    if (typeof window === 'undefined') return

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }

    const audioUrl = `/voices/${voiceName.toLowerCase()}.wav`
    const audio = new Audio(audioUrl)
    audioRef.current = audio

    audio.play().catch(err => {
      console.error('[PLAY PREVIEW ERROR]', err)
      toast.error(`Failed to play preview for ${voiceName}`)
    })
  }

  const fetchSettings = async () => {
    setLoading(true)
    try {
      // 1. Fetch DB settings
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error

      let phoneNum = ''
      if (data) {
        let bi: any = {}
        try {
          bi = typeof data.business_info === 'string' ? JSON.parse(data.business_info) : (data.business_info || {})
        } catch (e) {}

        const rawVobiz = bi.voice_vobiz_number || data.voice_vobiz_number || ''
        const rawTwilio = data.voice_twilio_number || ''

        let vNum = ''
        let twNum = ''

        if (rawVobiz && rawVobiz.startsWith('+91')) {
          vNum = rawVobiz
        }
        if (rawTwilio) {
          if (rawTwilio.startsWith('+91')) {
            if (!vNum) vNum = rawTwilio
          } else {
            twNum = rawTwilio
          }
        }

        setVobizNumber(vNum)
        setTwilioNumber(twNum)

        phoneNum = twNum || vNum || ''
        setUserEmail(data.email || '')
        setSubscriptionStatus(data.subscription_status || '')
        setOldVoiceNumber(data.old_voice_twilio_number || '')
        
        const effectiveProvider = bi.voice_telephony_provider || data.voice_telephony_provider || (twNum && !vNum ? 'twilio' : (vNum ? 'vobiz' : 'twilio'))
        setTelephonyProvider(effectiveProvider)
        setConcurrencyLimit(data.voice_concurrency_limit || 3)
        setCredits(data.credits || 0)
        setKycStatus(data.email === 'rchopra489@gmail.com' ? 'verified' : (data.kyc_status || 'not_submitted'))
        setKycType(data.kyc_type || (data.email === 'rchopra489@gmail.com' ? 'business' : 'individual'))
        setKycData(data.kyc_data || (data.email === 'rchopra489@gmail.com' ? { email: 'nobogent@gmail.com', fullName: 'Nobogent', companyName: 'Nobogent' } : {}))

        setSettings({
          elevenlabs_api_key: data.elevenlabs_api_key || '',
          elevenlabs_agent_id: data.elevenlabs_agent_id || '',
          voice_twilio_sid: data.voice_twilio_sid || '',
          voice_twilio_token: data.voice_twilio_token || '',
          voice_twilio_number: twNum,
          auto_call_new_leads: !!data.auto_call_new_leads,
          voice_provider: data.voice_provider || 'gemini',
          voice_name: data.voice_name || 'Aoede'
        })
        setConnected(!!(data.voice_twilio_sid || phoneNum))
      }

      // 2. Fetch server voice & KYC status
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const res = await fetch(`/api/voice/settings${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
      const resData = await res.json()
      if (resData.success) {
        setSaasMode(resData.saasMode)
        if (resData.vobizNumber !== undefined) {
          setVobizNumber(resData.vobizNumber || '')
        }
        if (resData.twilioNumber !== undefined) {
          setTwilioNumber(resData.twilioNumber || '')
          if (resData.twilioNumber) {
            setSettings(prev => ({ ...prev, voice_twilio_number: resData.twilioNumber }))
          }
        }
        if (resData.telephonyProvider) {
          setTelephonyProvider(resData.telephonyProvider)
        }
        const hasActiveLine = resData.telephonyProvider === 'vobiz' ? !!resData.vobizNumber : !!(resData.twilioNumber || settings.voice_twilio_sid)
        setConnected(hasActiveLine)
        if (resData.concurrencyLimit) {
          setConcurrencyLimit(resData.concurrencyLimit)
        }
        if (resData.credits !== undefined) {
          setCredits(resData.credits)
        }
        if (resData.kycStatus) {
          setKycStatus(resData.kycStatus)
        }
        if (resData.kycType) {
          setKycType(resData.kycType)
        }
        if (resData.kycData) {
          setKycData(resData.kycData)
        }
        if (resData.claimedNumbers) {
          setClaimedNumbers(resData.claimedNumbers)
        }
      }
    } catch (err: any) {
      console.error('[VOICE SETTINGS] Fetch Error:', err)
      toast.error('Failed to load voice agent settings.')
    } finally {
      setLoading(false)
    }
  }

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingKyc(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const res = await fetch(`/api/voice/kyc${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kycForm)
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message || 'Sub-account created! A TRAI KYC verification link has been sent to your email.')
        setKycStatus(data.kyc?.status || 'pending')
        if (data.kyc?.data) setKycData(data.kyc.data)
        setShowKycModal(false)
        fetchSettings()
      } else {
        toast.error(data.error || 'KYC registration failed.')
      }
    } catch (err: any) {
      toast.error(err.message || 'Error submitting KYC.')
    } finally {
      setSubmittingKyc(false)
    }
  }

  const handleSendKycEmail = async () => {
    setSendingKycEmail(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const targetEmail = effectiveKycEmail || userEmail
      const res = await fetch(`/api/voice/kyc${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: kycData?.name || kycData?.fullName || userEmail,
          email: targetEmail,
          phone: kycData?.phone || '+919876543210',
          description: kycData?.description || 'AI Voice Calling Sub-account'
        })
      })
      const data = await res.json()
      toast.success(`TRAI KYC verification email sent to ${targetEmail}! Please complete the verification link.`)
      fetchSettings()
    } catch (err: any) {
      toast.error('Failed to dispatch KYC email.')
    } finally {
      setSendingKycEmail(false)
    }
  }

  const handleProvisionNumber = async (numberToAssign?: string) => {
    setProvisioning(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const res = await fetch(`/api/voice/provision${impersonateId ? `?impersonate=${impersonateId}` : ''}`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: numberToAssign || selectedCatalogNumber })
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Calling number assigned successfully: ${data.phoneNumber}! 🎙️`)
        setVobizNumber(data.phoneNumber)
        setTelephonyProvider('vobiz')
        setConnected(true)
        setShowNumberCatalog(false)
        fetchSettings()
      } else {
        if (data.requiresKyc) {
          setShowKycModal(true)
        }
        toast.error(data.error || 'Failed to provision calling number.')
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred.')
    } finally {
      setProvisioning(false)
    }
  }

  const handleDisconnectNumber = async () => {
    if (!confirm("Are you sure you want to disconnect your voice calling line? This will release the phone number.")) return
    setDisconnecting(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      
      const res = await fetch(`/api/voice/provision${impersonateId ? `?impersonate=${impersonateId}` : ''}`, { 
        method: 'DELETE'
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Voice line disconnected successfully! 🎙️')
        setVobizNumber('')
        setConnected(false)
        fetchSettings()
      } else {
        toast.error(data.error || 'Failed to disconnect voice line.')
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred while disconnecting.')
    } finally {
      setDisconnecting(false)
    }
  }

  const copyToClipboard = (text: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedNumber(true)
    toast.success('Phone number copied to clipboard!')
    setTimeout(() => setCopiedNumber(false), 2000)
  }

  useEffect(() => {
    if (userId) {
      fetchSettings()
    }
  }, [userId])

  useEffect(() => {
    let interval: any = null
    if (userId && activeTab === 'campaigns') {
      fetchCampaignsAndFilters()
      interval = setInterval(() => {
        fetchCampaignsAndFilters()
      }, 4000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [userId, activeTab])

  const filteredMetaCampaigns = useMemo(() => {
    if (!metaCampaignSearchQuery.trim()) return metaCampaigns
    return metaCampaigns.filter(c => c.toLowerCase().includes(metaCampaignSearchQuery.toLowerCase()))
  }, [metaCampaigns, metaCampaignSearchQuery])

  const filteredCsvAudiences = useMemo(() => {
    if (!csvAudienceSearchQuery.trim()) return csvAudiences
    return csvAudiences.filter(a => a.toLowerCase().includes(csvAudienceSearchQuery.toLowerCase()))
  }, [csvAudiences, csvAudienceSearchQuery])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const res = await fetch(`/api/voice/settings${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telephonyProvider,
          concurrencyLimit,
          auto_call_new_leads: settings.auto_call_new_leads,
          voice_provider: settings.voice_provider,
          voice_name: settings.voice_name,
          voice_twilio_sid: settings.voice_twilio_sid,
          voice_twilio_token: settings.voice_twilio_token,
          voice_twilio_number: settings.voice_twilio_number
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to save voice settings')
      }

      toast.success('Voice agent settings saved successfully! 🎙️')
      const isCustomConnected = telephonyProvider === 'vobiz' ? !!vobizNumber : !!(settings.voice_twilio_sid || settings.voice_twilio_number)
      setConnected(isCustomConnected)
      fetchSettings()
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-slate-300" size={32} />
        <p className="text-sm font-medium animate-pulse">Syncing Voice Agent settings & telephony...</p>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 pb-36 sm:pb-32">
      
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 mb-6 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors uppercase tracking-wider bg-white px-4 py-2.5 rounded-full shadow-sm border border-slate-200"
      >
        <ArrowLeft size={14} /> Back to Settings
      </button>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 bg-slate-100 p-1 rounded-full max-w-md border border-slate-200/50">
        <button
          onClick={() => setActiveTab('connection')}
          className={`flex-1 py-2.5 px-4 rounded-full text-xs font-black transition-all cursor-pointer ${activeTab === 'connection' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Telephony & Lines
        </button>
        <button
          onClick={() => {
            setActiveTab('campaigns')
            fetchCampaignsAndFilters()
          }}
          className={`flex-1 py-2.5 px-4 rounded-full text-xs font-black transition-all cursor-pointer ${activeTab === 'campaigns' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Voice Call Campaigns
        </button>
      </div>

      {activeTab === 'connection' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          
          {/* Left Column: Status, Credits, and Concurrency */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Status Card */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center gap-4 mb-6">
                <div className={`p-3.5 rounded-2xl flex items-center justify-center shadow-sm ${connected ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                  <Phone size={24} />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-950">AI Voice Telephony</h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium leading-normal">
                    {telephonyProvider === 'vobiz' ? 'Vobiz Indian Cloud Telephony' : 'Twilio Voice Gateway'}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-indigo-50/40 border border-indigo-100 rounded-3xl p-4 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-indigo-100/50">
                    <span className="text-[10px] text-indigo-800 font-bold uppercase tracking-wider">Telephony Provider</span>
                    <span className="text-xs font-black text-indigo-700 uppercase">
                      {telephonyProvider === 'vobiz' ? '⚡ Vobiz AI (16kHz PCM)' : 'Twilio Voice'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-indigo-100/50">
                    <span className="text-[10px] text-indigo-800 font-bold uppercase tracking-wider">Line Status</span>
                    <span className={`text-xs font-black flex items-center gap-1 ${
                      (telephonyProvider === 'vobiz' ? !!vobizNumber : !!(settings.voice_twilio_number || twilioNumber)) && isSubscriptionActive 
                        ? 'text-emerald-600' 
                        : !isSubscriptionActive 
                        ? 'text-amber-600' 
                        : 'text-slate-400'
                    }`}>
                      ● {(telephonyProvider === 'vobiz' ? !!vobizNumber : !!(settings.voice_twilio_number || twilioNumber)) && isSubscriptionActive 
                        ? 'Online & Ready' 
                        : !isSubscriptionActive 
                        ? 'Subscription Inactive' 
                        : (telephonyProvider === 'vobiz' ? 'No Vobiz DID Assigned' : 'No Twilio Number')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Caller ID</span>
                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                      <span className="font-mono">
                        {telephonyProvider === 'vobiz' 
                          ? (vobizNumber || 'None') 
                          : (settings.voice_twilio_number || twilioNumber || 'None')}
                      </span>
                      {((telephonyProvider === 'vobiz' && vobizNumber) || (telephonyProvider === 'twilio' && (settings.voice_twilio_number || twilioNumber))) && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(telephonyProvider === 'vobiz' ? vobizNumber : (settings.voice_twilio_number || twilioNumber))}
                          className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
                          title="Copy Caller ID"
                        >
                          {copiedNumber ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Credits Balance Card */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
                    <Zap size={16} />
                  </div>
                  <h4 className="font-extrabold text-sm text-slate-900">Nobo AI Credits</h4>
                </div>
                <a
                  href="/dashboard/billing"
                  className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-wider underline flex items-center gap-1"
                >
                  Recharge Credits <ExternalLink size={10} />
                </a>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Current Balance</span>
                  <span className="text-sm font-black text-slate-900 font-mono">⚡ {Number(credits || 0).toFixed(2)} Credits</span>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium pt-1 border-t border-slate-200/60">
                  <span>Call Rate:</span>
                  <span className="font-bold text-slate-700">5 Credits / min</span>
                </div>
              </div>

              {credits < 40 && (
                <div className="mt-3 bg-amber-50/80 border border-amber-200 rounded-2xl p-3 flex items-start gap-2.5">
                  <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-amber-900 font-medium leading-tight">
                    <strong>Low balance:</strong> Recharge your AI credits to prevent automated calls from pausing.
                  </div>
                </div>
              )}
            </div>



            {/* India Regulatory Guide Banner */}
            <div className="bg-amber-50/75 border border-amber-200 rounded-[2rem] p-6 shadow-sm">
              <h4 className="font-extrabold text-sm text-amber-900 flex items-center gap-2 mb-2">
                <HelpCircle size={16} className="text-amber-700" /> TRAI Telephony Compliance
              </h4>
              <p className="text-[11px] text-amber-950 leading-relaxed font-semibold opacity-90">
                All Vobiz virtual numbers are 100% TRAI compliant for commercial conversational AI. Calls are recorded and stream high-quality 16kHz linear audio.
              </p>
            </div>
          </div>

          {/* Right Column: Configuration, KYC, Number Assignment */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm">
              
              {/* Header with Provider Toggle */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-slate-100">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                    <Settings size={18} className="text-slate-500" /> Voice Agent Connection Settings
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 font-medium">Configure telephony provider, KYC verification, and calling line</p>
                </div>

                {/* Provider Selector Switch */}
                <div className="bg-slate-100 p-1 rounded-full flex items-center border border-slate-200/60">
                  <button
                    type="button"
                    onClick={() => setTelephonyProvider('vobiz')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all cursor-pointer ${telephonyProvider === 'vobiz' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    ⚡ Vobiz AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setTelephonyProvider('twilio')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all cursor-pointer ${telephonyProvider === 'twilio' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Twilio
                  </button>
                </div>
              </div>

              <form onSubmit={handleSave} className="space-y-6">

                {telephonyProvider === 'vobiz' ? (
                  /* VOBIZ TELEPHONY SECTION */
                  <div className="space-y-6">

                    {/* Step 1: KYC Verification Section */}
                    <div className="border border-slate-200/80 rounded-3xl p-5 sm:p-6 bg-slate-50/50 space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-2xl ${isKycVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            <FileCheck size={20} />
                          </div>
                          <div>
                            <h4 className="text-sm font-extrabold text-slate-900">Telecom KYC Verification</h4>
                            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                              Mandatory TRAI verification required before buying or assigning outbound numbers
                            </p>
                          </div>
                        </div>

                        {isKycVerified ? (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 shadow-2xs">
                            <CheckCircle2 size={12} /> KYC Verified
                          </span>
                        ) : (
                          <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 shadow-2xs">
                            <AlertCircle size={12} /> Action Required
                          </span>
                        )}
                      </div>

                      {isKycVerified ? (
                        <div className="bg-white border border-emerald-100 p-4 rounded-2xl flex items-center justify-between text-xs shadow-2xs">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                              {kycType === 'business' ? <Building2 size={16} /> : <User size={16} />}
                            </div>
                            <div className="space-y-0.5">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                                {kycType === 'business' ? 'Company KYC Profile' : 'Individual KYC Profile'}
                              </span>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900">
                                  {effectiveKycName || userEmail}
                                </span>
                              </div>
                              {effectiveKycEmail && (
                                <p className="text-[11px] text-slate-500 font-medium">
                                  Verified Email: <span className="font-semibold text-slate-800">{effectiveKycEmail}</span>
                                </p>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowKycModal(true)}
                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                          >
                            Update Details
                          </button>
                        </div>
                      ) : (kycStatus === 'pending' || kycData?.vobizSubAuthId) ? (
                        <div className="bg-white border border-amber-200 p-5 rounded-2xl space-y-4 shadow-2xs">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h5 className="font-extrabold text-xs text-amber-950">Sub-Account Active (KYC Verification Required)</h5>
                                <span className="text-[9px] font-black bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full uppercase">
                                  TRAI Pending
                                </span>
                              </div>
                              <p className="text-[11px] text-amber-900/80 font-medium max-w-lg leading-relaxed">
                                Vobiz sub-account is active <strong>({kycData?.vobizSubAuthId || 'SA_CU21FXWZ'})</strong>. Click <strong>Send KYC Email</strong> below to receive your TRAI verification link at <strong className="text-amber-950 underline">{effectiveKycEmail || userEmail}</strong> to unlock your virtual outbound line.
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={handleSendKycEmail}
                                disabled={sendingKycEmail}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black px-4 py-2.5 rounded-full shadow-sm active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                              >
                                {sendingKycEmail ? (
                                  <>
                                    <Loader2 size={13} className="animate-spin" /> Sending...
                                  </>
                                ) : (
                                  <>
                                    <Mail size={13} /> Send KYC Email
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowKycModal(true)}
                                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold px-3.5 py-2.5 rounded-full shadow-2xs active:scale-95 transition-all cursor-pointer"
                              >
                                Edit Info
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border border-amber-200 p-5 rounded-2xl space-y-3 text-center sm:text-left sm:flex sm:items-center sm:justify-between shadow-2xs">
                          <div>
                            <h5 className="font-extrabold text-xs text-amber-950">Telecom Subaccount Registration</h5>
                            <p className="text-[11px] text-amber-900/80 font-medium mt-0.5 max-w-md">
                              Register your business details to provision your Vobiz sub-account and receive your TRAI verification link.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowKycModal(true)}
                            className="mt-3 sm:mt-0 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black px-5 py-2.5 rounded-full shadow-sm active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                          >
                            Start Telecom KYC
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Step 2: Virtual Calling Line & Number Assignment */}
                    <div className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <div className="bg-indigo-100 text-indigo-700 p-2.5 rounded-2xl">
                            <Phone size={20} />
                          </div>
                          <div>
                            <h4 className="text-sm font-extrabold text-slate-900">Virtual Calling Line (Vobiz DID)</h4>
                            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                              Assigned Indian outbound number to place AI calls to your leads
                            </p>
                          </div>
                        </div>
                      </div>

                      {!isKycVerified ? (
                        <div className="bg-white border border-slate-200/80 p-5 sm:p-6 rounded-2xl shadow-sm text-center py-6 space-y-2">
                          <p className="text-xs text-amber-800 font-semibold max-w-md mx-auto">
                            Complete TRAI KYC verification above to unlock outbound virtual calling lines.
                          </p>
                        </div>
                      ) : !isSubscriptionActive ? (
                        <div className="bg-white border border-slate-200/80 p-5 sm:p-6 rounded-2xl shadow-sm text-center py-6 space-y-2">
                          <p className="text-xs text-amber-800 font-semibold max-w-md mx-auto">
                            Your subscription is currently inactive. Please ensure an active plan to connect your calling line.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Active Line Display if User Has Claimed a Number */}
                          {vobizNumber && (
                            <div className="bg-white border-2 border-emerald-300/80 p-5 rounded-2xl shadow-xs space-y-3">
                              <div className="flex items-center justify-between shadow-sm flex-wrap gap-3">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black text-emerald-800 uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                      Active Outbound Caller ID
                                    </span>
                                    <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                      1/1 Included Line Active
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2.5 mt-1.5">
                                    <span className="text-lg sm:text-xl font-extrabold text-slate-950 font-mono tracking-tight">{vobizNumber}</span>
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(vobizNumber)}
                                      className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
                                      title="Copy Number"
                                    >
                                      {copiedNumber ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                                    </button>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                                    ● Active Line
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleDisconnectNumber}
                                    disabled={disconnecting}
                                    className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 text-[10px] font-black px-3.5 py-1.5 rounded-full uppercase tracking-wider transition-all active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer"
                                    title="Disconnect voice line and release number to claim a different line"
                                  >
                                    {disconnecting ? <Loader2 size={12} className="animate-spin" /> : 'Disconnect'}
                                  </button>
                                </div>
                              </div>

                              {/* Quota & Rule Notice */}
                              <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-900">
                                <Info size={16} className="text-amber-700 shrink-0 mt-0.5" />
                                <div className="space-y-0.5">
                                  <p className="font-extrabold text-amber-950">
                                    1 Complimentary Calling Line Claimed (1/1 Quota Used)
                                  </p>
                                  <p className="text-amber-800/90 text-[11px] leading-relaxed font-medium">
                                    Your account includes 1 free dedicated 79-series outbound line. You cannot claim more numbers for free. If you want to switch to a different number, click <strong>Disconnect</strong> above to release this line and select another from the catalog below.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Interactive Number Catalog & Exploration */}
                          <div className="bg-white border border-slate-200/90 p-5 sm:p-6 rounded-2xl shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                              <div>
                                <h5 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                                  {vobizNumber ? 'Explore 79-Series Number Inventory' : 'Available 79-Series Calling Lines'}
                                </h5>
                                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                                  {vobizNumber 
                                    ? 'Browse our complete pool of numbers. Disconnect your active line above if you wish to claim a different number.'
                                    : 'Explore our complete pool of 80+ numbers below. Select and claim 1 free number for your account.'
                                  }
                                </p>
                              </div>
                              <span className={`self-start sm:self-auto text-[10px] font-extrabold px-3 py-1 rounded-full border shrink-0 ${
                                vobizNumber 
                                  ? 'text-amber-800 bg-amber-50 border-amber-200'
                                  : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                              }`}>
                                {vobizNumber ? 'Free Line Quota Active (1/1)' : '100% Included in Package (₹0)'}
                              </span>
                            </div>

                            {/* Search and Category Filter Toolbar */}
                            <div className="space-y-3">
                              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                {/* Search by Digits Input */}
                                <div className="relative flex-1">
                                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                  <input
                                    type="text"
                                    value={numberSearchQuery}
                                    onChange={(e) => setNumberSearchQuery(e.target.value)}
                                    placeholder="Search by digits (e.g. 71, 8800, 4912)..."
                                    className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                                  />
                                  {numberSearchQuery && (
                                    <button
                                      type="button"
                                      onClick={() => setNumberSearchQuery('')}
                                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                                    >
                                      <X size={13} />
                                    </button>
                                  )}
                                </div>

                                {/* Category Filters */}
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setNumberCategoryFilter('all')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                                      numberCategoryFilter === 'all'
                                        ? 'bg-indigo-600 text-white shadow-xs'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                                    }`}
                                  >
                                    All ({categoryCounts.all})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setNumberCategoryFilter('VIP')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                                      numberCategoryFilter === 'VIP'
                                        ? 'bg-amber-500 text-white shadow-xs'
                                        : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                                    }`}
                                  >
                                    ⭐ VIP ({categoryCounts.VIP})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setNumberCategoryFilter('Easy Recall')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                                      numberCategoryFilter === 'Easy Recall'
                                        ? 'bg-purple-600 text-white shadow-xs'
                                        : 'bg-purple-50 text-purple-800 border border-purple-200 hover:bg-purple-100'
                                    }`}
                                  >
                                    ✨ Easy Recall ({categoryCounts.easyRecall})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setNumberCategoryFilter('Standard')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                                      numberCategoryFilter === 'Standard'
                                        ? 'bg-slate-800 text-white shadow-xs'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                                    }`}
                                  >
                                    Standard ({categoryCounts.standard})
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Numbers List */}
                            <div className="space-y-2.5 pt-1">
                              {catalogLoading ? (
                                <div className="space-y-3 py-2">
                                  {[1, 2, 3].map((i) => (
                                    <div key={i} className="p-4 bg-slate-50/60 border border-slate-200/60 rounded-2xl animate-pulse flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-slate-200" />
                                        <div className="space-y-1.5">
                                          <div className="w-36 h-4 bg-slate-200 rounded" />
                                          <div className="w-48 h-3 bg-slate-100 rounded" />
                                        </div>
                                      </div>
                                      <div className="w-24 h-8 bg-slate-200 rounded-xl" />
                                    </div>
                                  ))}
                                </div>
                              ) : catalogNumbers.length === 0 ? (
                                <div className="text-center py-8 text-slate-400 space-y-2">
                                  <Phone size={28} className="mx-auto text-slate-300" />
                                  <p className="text-xs font-semibold text-slate-600">No calling lines match your search query &quot;{numberSearchQuery}&quot;.</p>
                                  <button
                                    type="button"
                                    onClick={() => { setNumberSearchQuery(''); setNumberCategoryFilter('all'); }}
                                    className="text-xs text-indigo-600 font-bold hover:underline"
                                  >
                                    Reset filters & view all {categoryCounts.all} numbers
                                  </button>
                                </div>
                              ) : (
                                catalogNumbers.map((num) => {
                                  const isCurrentlyActive = vobizNumber && (vobizNumber.replace(/\D/g, '') === num.phoneNumber.replace(/\D/g, ''))
                                  const isTakenByOther = !isCurrentlyActive && (num.isClaimed || claimedNumbers.some(c => c.replace(/\D/g, '') === num.phoneNumber.replace(/\D/g, '')) || false)
                                  const hasAlreadyClaimed = !!vobizNumber

                                  return (
                                    <div 
                                      key={num.phoneNumber}
                                      className={`p-3.5 sm:p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all group shadow-xs ${
                                        isCurrentlyActive 
                                          ? 'bg-emerald-50/70 border-2 border-emerald-400 shadow-emerald-100/50' 
                                          : isTakenByOther 
                                            ? 'bg-slate-50/50 border border-slate-200 opacity-60' 
                                            : 'bg-slate-50/80 hover:bg-indigo-50/40 border border-slate-200/90 hover:border-indigo-300'
                                      }`}
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                                          isCurrentlyActive 
                                            ? 'bg-emerald-100 text-emerald-700 border-emerald-300' 
                                            : 'bg-indigo-100 text-indigo-700 border-indigo-200/50'
                                        }`}>
                                          <Phone size={16} />
                                        </div>
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-extrabold text-base sm:text-lg text-slate-900 font-mono tracking-tight">
                                              {num.formattedNumber}
                                            </span>
                                            <span className="text-[10px] font-black px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full border border-indigo-200/60 shrink-0">
                                              79-Series Line
                                            </span>
                                            {num.category === 'VIP' && (
                                              <span className="text-[10px] font-black px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full border border-amber-300/60 shrink-0 flex items-center gap-1">
                                                ⭐ VIP / Golden
                                              </span>
                                            )}
                                            {num.category === 'Easy Recall' && (
                                              <span className="text-[10px] font-black px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full border border-purple-300/60 shrink-0">
                                                ✨ Easy Recall
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-medium flex-wrap">
                                            {isCurrentlyActive ? (
                                              <span className="flex items-center gap-1.5 text-emerald-700 font-black">
                                                <CheckCircle2 size={13} className="text-emerald-600" /> Your Active Calling Line
                                              </span>
                                            ) : isTakenByOther ? (
                                              <span className="flex items-center gap-1.5 text-slate-400 font-bold">
                                                <Lock size={11} /> Claimed by another account
                                              </span>
                                            ) : hasAlreadyClaimed ? (
                                              <span className="flex items-center gap-1.5 text-amber-700 font-bold">
                                                <Lock size={11} /> Limit reached (1 free line active)
                                              </span>
                                            ) : (
                                              <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
                                                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span> Ready to Claim
                                              </span>
                                            )}
                                            <span className="text-slate-300">•</span>
                                            <span>16kHz HD PCM</span>
                                            <span className="text-slate-300">•</span>
                                            <span className="text-indigo-600 font-semibold">Included in Package (₹0)</span>
                                          </div>
                                        </div>
                                      </div>

                                      {isCurrentlyActive ? (
                                        <span className="shrink-0 self-start sm:self-auto px-4 py-2 bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-black rounded-xl flex items-center gap-1.5">
                                          <CheckCircle2 size={13} /> Active Line
                                        </span>
                                      ) : isTakenByOther ? (
                                        <button
                                          type="button"
                                          disabled
                                          className="shrink-0 self-start sm:self-auto px-4 py-2 bg-slate-100 text-slate-400 border border-slate-200 text-xs font-bold rounded-xl cursor-not-allowed flex items-center gap-1.5"
                                        >
                                          <Lock size={12} /> Unavailable
                                        </button>
                                      ) : hasAlreadyClaimed ? (
                                        <button
                                          type="button"
                                          disabled
                                          title="You have already claimed your 1 free calling line. Disconnect your active line above if you wish to switch to this number."
                                          className="shrink-0 self-start sm:self-auto px-4 py-2 bg-slate-100 text-slate-400 border border-slate-200 text-xs font-bold rounded-xl cursor-not-allowed flex items-center gap-1.5 transition-all"
                                        >
                                          <Lock size={12} /> Limit Reached (1/1)
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleProvisionNumber(num.phoneNumber)}
                                          disabled={provisioning}
                                          className="shrink-0 self-start sm:self-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
                                        >
                                          {provisioning ? (
                                            <>
                                              <Loader2 size={13} className="animate-spin" /> Claiming...
                                            </>
                                          ) : (
                                            <>
                                              <Sparkles size={13} /> Claim Number
                                            </>
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  )
                                })
                              )}
                            </div>

                            {/* Lazy Loading "Load More" Controls */}
                            {catalogNumbers.length > 0 && (
                              <div className="flex flex-col items-center justify-center pt-4 border-t border-slate-100 gap-2">
                                <span className="text-xs text-slate-500 font-medium">
                                  Showing <span className="font-bold text-slate-800">{catalogNumbers.length}</span> of <span className="font-bold text-slate-900">{catalogTotal}</span> calling lines
                                </span>

                                {catalogHasMore ? (
                                  <button
                                    type="button"
                                    onClick={handleLoadMoreNumbers}
                                    disabled={catalogLoadingMore}
                                    className="px-5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-xl text-xs font-black transition-all active:scale-95 flex items-center gap-2 cursor-pointer shadow-2xs disabled:opacity-50"
                                  >
                                    {catalogLoadingMore ? (
                                      <>
                                        <Loader2 size={13} className="animate-spin" /> Loading more numbers...
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown size={14} /> Load More Numbers (+{Math.min(numbersPerPage, catalogTotal - catalogNumbers.length)})
                                      </>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-400 font-semibold bg-slate-50 px-3 py-1 rounded-full border border-slate-200/60">
                                    ✓ All {catalogTotal} available numbers loaded
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                ) : (
                  /* TWILIO CONFIGURATION SECTION */
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="bg-indigo-50/40 border border-indigo-100/50 rounded-2xl p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
                          <ShieldCheck size={14} className="text-indigo-600" /> Twilio Phone & Gateway Settings
                        </h4>
                        {(settings.voice_twilio_number || twilioNumber) && (
                          <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-2xs">
                            ● Active Twilio Line
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-indigo-800 leading-relaxed font-medium">
                        Configure your Twilio Account SID, Auth Token, and outbound calling number for international or custom telephony.
                      </p>
                    </div>

                    {/* Active Twilio Caller ID Banner */}
                    {(settings.voice_twilio_number || twilioNumber) && (
                      <div className="bg-white border border-slate-200/80 p-4.5 rounded-2xl flex items-center justify-between shadow-2xs flex-wrap gap-3">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Twilio Caller ID</span>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-base font-extrabold text-slate-900 font-mono">
                              {settings.voice_twilio_number || twilioNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(settings.voice_twilio_number || twilioNumber)}
                              className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
                              title="Copy Number"
                            >
                              {copiedNumber ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                            </button>
                          </div>
                        </div>
                        <span className="bg-emerald-50 text-emerald-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                          ● Connected
                        </span>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Twilio Account SID</label>
                          <input 
                            type="text" 
                            value={settings.voice_twilio_sid}
                            onChange={(e) => setSettings({ ...settings, voice_twilio_sid: e.target.value })}
                            placeholder="AC..."
                            className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-mono outline-none focus:border-indigo-400 transition-all"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Twilio Auth Token</label>
                          <input 
                            type="password" 
                            value={settings.voice_twilio_token}
                            onChange={(e) => setSettings({ ...settings, voice_twilio_token: e.target.value })}
                            placeholder="token..."
                            className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-mono outline-none focus:border-indigo-400 transition-all"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Outbound Caller ID (Twilio International / Local Number)</label>
                        <input 
                          type="text" 
                          value={settings.voice_twilio_number}
                          onChange={(e) => setSettings({ ...settings, voice_twilio_number: e.target.value })}
                          placeholder="e.g. +16592137728"
                          className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                        />
                        <span className="text-[9px] text-slate-400 block ml-1 font-semibold leading-normal">
                          Include international country prefix (e.g. +1 for US/Canada, +91 for India).
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <hr className="border-slate-100 my-2" />

                {/* Automation Toggle */}
                <div className="flex justify-between items-center bg-indigo-50/30 border border-indigo-100/50 rounded-2xl p-4">
                  <div>
                    <h4 className="text-xs font-extrabold text-slate-900">Auto Call New Leads</h4>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5">Triggers outbound agent dialer immediately when a new lead lands in CRM</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, auto_call_new_leads: !settings.auto_call_new_leads })}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {settings.auto_call_new_leads ? (
                      <ToggleRight className="w-10 h-10 text-indigo-600 cursor-pointer" />
                    ) : (
                      <ToggleLeft className="w-10 h-10 text-slate-300 cursor-pointer" />
                    )}
                  </button>
                </div>

                {/* Default Voice Selection and Previews */}
                <div className="space-y-4 border border-slate-100 bg-slate-50/30 p-4 rounded-2xl">
                  <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-600" /> Default Voice Agent Tone
                  </h4>
                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                    Choose the voice tone used universally for triggered calls (when new leads land in CRM, when dismissing flagged questions, or when manually dialing).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Select Voice</label>
                      <select 
                        value={settings.voice_name}
                        onChange={(e) => setSettings({ ...settings, voice_name: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all cursor-pointer shadow-xs"
                      >
                        <option value="Aoede">Aoede (Warm Female)</option>
                        <option value="Kore">Kore (Young Female)</option>
                        <option value="Charon">Charon (Warm Male)</option>
                        <option value="Fenrir">Fenrir (Deep Male)</option>
                        <option value="Puck">Puck (Energetic Male)</option>
                      </select>
                    </div>
                    <div className="flex flex-col justify-end space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Voice Preview</label>
                      <button
                        type="button"
                        onClick={() => playVoicePreview(settings.voice_name)}
                        className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs cursor-pointer"
                      >
                        <Play size={12} fill="currentColor" /> Play Voice Sample
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-3.5 bg-slate-950 hover:bg-slate-900 text-white rounded-full text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {saving ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-white" /> Saving Settings...
                      </>
                    ) : (
                      <>
                        <Save size={14} /> Save Configuration
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : (
        /* CAMPAIGNS TAB */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Create Campaign Form */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <h3 className="font-extrabold text-base text-slate-900 mb-4 pb-3 border-b border-slate-100 flex items-center gap-2">
              <Sparkles size={18} className="text-indigo-500" /> New Calling Campaign
            </h3>
            
            <form onSubmit={async (e) => {
              e.preventDefault()
              if (!campaignForm.name.trim()) return toast.error("Please enter a campaign name")
              
              setSaving(true)
              try {
                const urlParams = new URLSearchParams(window.location.search)
                const impersonateId = urlParams.get('impersonate')
                const res = await fetch(`/api/voice/campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: campaignForm.name,
                    audience_filter: {
                      sources: targetAudienceType === 'all' ? [] : selectedSources,
                      meta_campaigns: targetAudienceType === 'all' ? [] : selectedMetaCampaigns,
                      csv_audiences: targetAudienceType === 'all' ? [] : selectedCsvAudiences,
                      pipeline_stages: targetAudienceType === 'all' ? [] : selectedStages,
                      voice_name: campaignForm.voiceName,
                      greeting: campaignForm.greeting.trim() || null
                    },
                    custom_prompt: campaignForm.customPrompt
                  })
                })
                const resData = await res.json()

                if (!resData.success) throw new Error(resData.error || "Failed to create campaign")

                toast.success("Campaign created as draft!")
                setCampaignForm({ name: '', filterType: 'all', filterValue: '', facebookCampaign: '', customPrompt: '', voiceName: 'Aoede', greeting: '' })
                setSelectedSources([])
                setSelectedMetaCampaigns([])
                setSelectedCsvAudiences([])
                setSelectedStages([])
                setTargetAudienceType('all')
                fetchCampaignsAndFilters()
              } catch (err: any) {
                toast.error("Failed to create campaign: " + err.message)
              } finally {
                setSaving(false)
              }
            }} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Campaign Name</label>
                <input 
                  type="text" 
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  placeholder="e.g. July Follow-up Pitch"
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Target Audience Type</label>
                <select 
                  value={targetAudienceType}
                  onChange={(e) => setTargetAudienceType(e.target.value as 'all' | 'custom')}
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all cursor-pointer"
                >
                  <option value="all">All Contacts / Leads (No Filters)</option>
                  <option value="custom">Custom Multi-Filter Audience</option>
                </select>
              </div>

              {targetAudienceType === 'custom' && (
                <div className="space-y-4 border border-slate-100 bg-slate-50/50 p-4 rounded-2xl animate-in fade-in duration-200">
                  <span className="block text-[10px] font-black text-slate-400 uppercase border-b border-slate-100 pb-1.5">Configure Target Filters</span>
                  
                  {/* Lead Sources Checkboxes */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase block ml-1">1. Lead Sources</label>
                    <div className="grid grid-cols-2 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                      {sources.map(src => {
                        const isChecked = selectedSources.includes(src)
                        return (
                          <label key={src} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedSources(selectedSources.filter(s => s !== src))
                                } else {
                                  setSelectedSources([...selectedSources, src])
                                }
                              }}
                              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                            />
                            {src}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Meta Campaigns Checkboxes (if any exist) */}
                  {metaCampaigns.length > 0 && (
                    <div className="space-y-1.5 animate-in fade-in duration-200">
                      <label className="text-[10px] font-black text-slate-500 uppercase block ml-1 flex items-center justify-between">
                        <span>2. Meta Ads Campaigns</span>
                        <span className="text-[8px] text-slate-400 font-bold lowercase">Found: {filteredMetaCampaigns.length} / {metaCampaigns.length}</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="Search Meta Campaigns..." 
                        value={metaCampaignSearchQuery} 
                        onChange={(e) => setMetaCampaignSearchQuery(e.target.value)} 
                        className="w-full bg-white border border-slate-200/80 py-1.5 px-3 rounded-xl text-[11px] font-semibold outline-none focus:border-indigo-400 transition-all shadow-xs"
                      />
                      <div className="grid grid-cols-1 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                        {filteredMetaCampaigns.map(camp => {
                          const isChecked = selectedMetaCampaigns.includes(camp)
                          return (
                            <label key={camp} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans truncate" title={camp}>
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedMetaCampaigns(selectedMetaCampaigns.filter(c => c !== camp))
                                  } else {
                                    setSelectedMetaCampaigns([...selectedMetaCampaigns, camp])
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                              />
                              <span className="truncate">{camp.includes('|') ? camp.split('|')[1] : camp}</span>
                            </label>
                          )
                        })}
                        {filteredMetaCampaigns.length === 0 && (
                          <div className="text-[10px] text-slate-400 font-semibold italic text-center py-2">No campaigns found</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* CSV Audiences Checkboxes (if any exist) */}
                  {csvAudiences.length > 0 && (
                    <div className="space-y-1.5 animate-in fade-in duration-200">
                      <label className="text-[10px] font-black text-slate-500 uppercase block ml-1 flex items-center justify-between">
                        <span>3. CSV Uploaded Audiences</span>
                        <span className="text-[8px] text-slate-400 font-bold lowercase">Found: {filteredCsvAudiences.length} / {csvAudiences.length}</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="Search CSV Audiences..." 
                        value={csvAudienceSearchQuery} 
                        onChange={(e) => setCsvAudienceSearchQuery(e.target.value)} 
                        className="w-full bg-white border border-slate-200/80 py-1.5 px-3 rounded-xl text-[11px] font-semibold outline-none focus:border-indigo-400 transition-all shadow-xs"
                      />
                      <div className="grid grid-cols-1 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                        {filteredCsvAudiences.map(aud => {
                          const isChecked = selectedCsvAudiences.includes(aud)
                          return (
                            <label key={aud} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans truncate" title={aud}>
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedCsvAudiences(selectedCsvAudiences.filter(a => a !== aud))
                                  } else {
                                    setSelectedCsvAudiences([...selectedCsvAudiences, aud])
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                              />
                              <span className="truncate">{aud}</span>
                            </label>
                          )
                        })}
                        {filteredCsvAudiences.length === 0 && (
                          <div className="text-[10px] text-slate-400 font-semibold italic text-center py-2">No audiences found</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pipeline Stages Checkboxes */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase block ml-1">4. Pipeline Stages</label>
                    <div className="grid grid-cols-2 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                      {pipelineStages.map(stg => {
                        const isChecked = selectedStages.includes(stg)
                        return (
                          <label key={stg} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedStages(selectedStages.filter(s => s !== stg))
                                } else {
                                  setSelectedStages([...selectedStages, stg])
                                }
                              }}
                              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                            />
                            {stg}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase block ml-1 flex items-center justify-between">
                    <span>Voice Agent Tone</span>
                    <button
                      type="button"
                      onClick={() => playVoicePreview(campaignForm.voiceName)}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer active:scale-95 transition-all"
                    >
                      <Play size={10} fill="currentColor" /> Play Sample
                    </button>
                  </label>
                  <select 
                    value={campaignForm.voiceName}
                    onChange={(e) => setCampaignForm({ ...campaignForm, voiceName: e.target.value })}
                    className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all cursor-pointer"
                  >
                    <option value="Aoede">Aoede (Warm Female)</option>
                    <option value="Kore">Kore (Young Female)</option>
                    <option value="Charon">Charon (Warm Male)</option>
                    <option value="Fenrir">Fenrir (Deep Male)</option>
                    <option value="Puck">Puck (Energetic Male)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase block ml-1 flex items-center justify-between">
                    <span>Welcome Greeting</span>
                    <span className="text-[8px] text-slate-400 font-bold lowercase">Use {`{name}`} for lead</span>
                  </label>
                  <input 
                    type="text" 
                    value={campaignForm.greeting}
                    onChange={(e) => setCampaignForm({ ...campaignForm, greeting: e.target.value })}
                    placeholder="e.g. Hi {name} ji, kaise ho aap?"
                    className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase block ml-1 flex items-center justify-between">
                  <span>Custom Conversation Context & Pitch</span>
                  <span className="text-[8px] text-indigo-500 font-bold lowercase">Overrides Default Business Name & Info</span>
                </label>
                <textarea 
                  value={campaignForm.customPrompt}
                  onChange={(e) => setCampaignForm({ ...campaignForm, customPrompt: e.target.value })}
                  placeholder="e.g. You are an agent selling apartments. Do NOT mention any company name. Greet friendly in Hinglish. Try to schedule a walkthrough visit."
                  rows={4}
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-medium outline-none focus:border-indigo-400 transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-xs font-black shadow-sm transition-all cursor-pointer"
              >
                Create Campaign Draft
              </button>
            </form>
          </div>

          {/* Past Campaigns */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <h3 className="font-extrabold text-base text-slate-900 mb-4 pb-3 border-b border-slate-100 flex items-center gap-2">
              <Phone size={18} className="text-indigo-500" /> Active & Past Campaigns
            </h3>

            {campaigns.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs font-semibold">
                No campaigns created yet. Build a draft above to get started.
              </div>
            ) : (
              <div className="space-y-5">
                {campaigns.map((c) => {
                  const filter = c.audience_filter || {}
                  const getAudienceLabel = () => {
                    const parts: string[] = []
                    if (!filter.sources && !filter.pipeline_stages && !filter.meta_campaigns && !filter.csv_audiences) {
                      return 'All Leads'
                    }
                    if (filter.sources && filter.sources.length > 0) parts.push(`Sources: ${filter.sources.join(', ')}`)
                    if (filter.meta_campaigns && filter.meta_campaigns.length > 0) {
                      const cleanMeta = filter.meta_campaigns.map((m: string) => m.includes('|') ? m.split('|')[1] : m)
                      parts.push(`Campaigns: ${cleanMeta.join(', ')}`)
                    }
                    if (filter.csv_audiences && filter.csv_audiences.length > 0) parts.push(`CSV: ${filter.csv_audiences.join(', ')}`)
                    if (filter.pipeline_stages && filter.pipeline_stages.length > 0) parts.push(`Stages: ${filter.pipeline_stages.join(', ')}`)
                    return parts.length > 0 ? parts.join(' | ') : 'All Leads'
                  }

                  const rawCampaignLeads = allLeads.filter(l => l.voice_campaign_id === c.id)
                  const campaignLeadsMap = new Map<string, any>()
                  for (const lead of rawCampaignLeads) {
                    if (!lead.phone) continue
                    const norm = lead.phone.replace(/\D/g, '').slice(-10)
                    if (!norm || norm.length < 10 || /^0+$/.test(norm)) continue
                    if (!campaignLeadsMap.has(norm)) {
                      campaignLeadsMap.set(norm, lead)
                    }
                  }
                  const campaignLeads = Array.from(campaignLeadsMap.values())
                  const totalLeads = c.stats ? c.stats.total : campaignLeads.length
                  const completedLeads = c.stats ? c.stats.spoke : campaignLeads.filter(l => l.voice_call_status === 'completed').length
                  const failedLeads = c.stats ? c.stats.unreachable : campaignLeads.filter(l => ['failed', 'failed_max_retries'].includes(l.voice_call_status)).length
                  const callingLeads = c.stats ? c.stats.dialing : campaignLeads.filter(l => l.voice_call_status === 'calling').length
                  const pendingLeads = c.stats ? c.stats.queue : totalLeads - (completedLeads + failedLeads + callingLeads)
                  const progressPercent = totalLeads > 0 ? Math.round(((completedLeads + failedLeads) / totalLeads) * 100) : 0

                  return (
                    <div key={c.id} className="p-5 bg-slate-50/80 border border-slate-200/80 rounded-2xl flex flex-col gap-4 font-sans shadow-2xs hover:shadow-xs transition-all">
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h4 className="text-sm font-black text-slate-900">{c.name}</h4>
                          <span className={`text-[10px] font-black uppercase px-3 py-0.5 rounded-full border ${
                            c.status === 'running' 
                              ? 'bg-amber-50 text-amber-600 border-amber-200' 
                              : c.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                              : c.status === 'paused'
                              ? 'bg-amber-100 text-amber-800 border-amber-300'
                              : 'bg-slate-200/70 text-slate-600 border-slate-300/60'
                          }`}>
                            {c.status}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {c.status === 'draft' && (
                            <button
                              onClick={async () => {
                                const proceed = confirm(`Launch campaign "${c.name}"? This will place phone calls to all matching leads in the database.`)
                                if (!proceed) return
                                
                                try {
                                  toast.loading(`Starting campaign "${c.name}"...`)
                                  const urlParams = new URLSearchParams(window.location.search)
                                  const impersonateId = urlParams.get('impersonate')
                                  const res = await fetch(`/api/voice/campaign/start${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ campaignId: c.id })
                                  })
                                  const resData = await res.json()
                                  toast.dismiss()
                                  
                                  if (resData.success) {
                                    toast.success(`Campaign launched! Initiated calls to ${resData.totalLeads} leads. 🎙️`)
                                    fetchCampaignsAndFilters()
                                  } else {
                                    toast.error(resData.error || "Failed to start campaign")
                                  }
                                } catch (err: any) {
                                  toast.dismiss()
                                  toast.error("Error starting campaign: " + err.message)
                                }
                              }}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black px-4 py-2 rounded-full shadow-md active:scale-95 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                            >
                              <Phone size={13} />
                              <span>Launch Campaign</span>
                            </button>
                          )}

                          {c.status === 'running' && (
                            <button
                              onClick={async () => {
                                const proceed = confirm(`Pause campaign "${c.name}"? No further sequential calls will be placed.`)
                                if (!proceed) return

                                try {
                                  toast.loading(`Pausing campaign "${c.name}"...`)
                                  const urlParams = new URLSearchParams(window.location.search)
                                  const impersonateId = urlParams.get('impersonate')
                                  const res = await fetch(`/api/voice/campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ campaignId: c.id, status: 'paused' })
                                  })
                                  const resData = await res.json()
                                  toast.dismiss()

                                  if (resData.success) {
                                    toast.success(`Campaign paused!`)
                                    fetchCampaignsAndFilters()
                                  } else {
                                    toast.error(resData.error || "Failed to pause campaign")
                                  }
                                } catch (err: any) {
                                  toast.dismiss()
                                  toast.error("Error pausing campaign: " + err.message)
                                }
                              }}
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-4 py-2 rounded-full shadow-sm active:scale-95 transition-all cursor-pointer"
                            >
                              Pause Call
                            </button>
                          )}

                          {c.status === 'paused' && (
                            <button
                              onClick={async () => {
                                const proceed = confirm(`Resume campaign "${c.name}"?`)
                                if (!proceed) return

                                try {
                                  toast.loading(`Resuming campaign "${c.name}"...`)
                                  const urlParams = new URLSearchParams(window.location.search)
                                  const impersonateId = urlParams.get('impersonate')
                                  const res = await fetch(`/api/voice/campaign/start${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ campaignId: c.id })
                                  })
                                  const resData = await res.json()
                                  toast.dismiss()

                                  if (resData.success) {
                                    toast.success(`Campaign resumed!`)
                                    fetchCampaignsAndFilters()
                                  } else {
                                    toast.error(resData.error || "Failed to resume campaign")
                                  }
                                } catch (err: any) {
                                  toast.dismiss()
                                  toast.error("Error resuming campaign: " + err.message)
                                }
                              }}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black px-4 py-2 rounded-full shadow-sm active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                            >
                              <Play size={13} />
                              <span>Resume Call</span>
                            </button>
                          )}

                          <button
                            title="Delete Campaign"
                            onClick={async () => {
                              const proceed = confirm(`Are you sure you want to delete campaign "${c.name}"? This action cannot be undone.`)
                              if (!proceed) return

                              try {
                                toast.loading(`Deleting campaign "${c.name}"...`)
                                const urlParams = new URLSearchParams(window.location.search)
                                const impersonateId = urlParams.get('impersonate')
                                const res = await fetch(`/api/voice/campaign?id=${c.id}${impersonateId ? `&impersonate=${impersonateId}` : ''}`, {
                                  method: 'DELETE'
                                })
                                const resData = await res.json()
                                toast.dismiss()

                                if (resData.success) {
                                  toast.success(`Campaign deleted!`)
                                  fetchCampaignsAndFilters()
                                } else {
                                  toast.error(resData.error || "Failed to delete campaign")
                                }
                              } catch (err: any) {
                                toast.dismiss()
                                toast.error("Error deleting campaign: " + err.message)
                              }
                            }}
                            className="p-2 text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-full transition-all cursor-pointer shadow-2xs active:scale-95 ml-1"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 text-[9px] font-bold">
                        <span className="bg-slate-200/70 text-slate-700 px-2.5 py-1 rounded-md uppercase max-w-xs truncate inline-block" title={getAudienceLabel()}>
                          Audience: {getAudienceLabel()}
                        </span>
                        <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md uppercase">
                          🎙️ Voice: {filter.voice_name || 'Aoede'}
                        </span>
                        {filter.greeting && (
                          <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-md uppercase truncate max-w-xs" title={filter.greeting}>
                            💬 Greeting: "{filter.greeting}"
                          </span>
                        )}
                        <span className="text-slate-400 px-1 py-1 font-semibold">
                          Created: {new Date(c.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      {c.custom_prompt && (
                        <div className="space-y-1">
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Conversation Context & Pitch:</span>
                          <div className="bg-slate-900 text-slate-100 p-3.5 rounded-xl border border-slate-800 text-[11px] font-mono leading-relaxed max-h-32 overflow-y-auto custom-scrollbar whitespace-pre-wrap shadow-inner">
                            {c.custom_prompt}
                          </div>
                        </div>
                      )}

                      {totalLeads > 0 && (
                        <div className="space-y-2 border-t border-slate-200/60 pt-3">
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-[10px] font-black text-slate-600">
                              <span>PROGRESS: {progressPercent}%</span>
                              <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-mono text-[9px]">{completedLeads + failedLeads} / {totalLeads} CALLED</span>
                            </div>
                            <div className="w-full bg-slate-200/80 h-2.5 rounded-full overflow-hidden shadow-inner">
                              <div 
                                className="bg-indigo-600 h-full rounded-full transition-all duration-700 ease-out-back" 
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 text-[9px] font-extrabold pt-1">
                            <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-md border border-emerald-100 flex items-center gap-1">
                              ✅ Spoke: {completedLeads}
                            </span>
                            <span className="bg-rose-50 text-rose-700 px-2.5 py-1 rounded-md border border-rose-100 flex items-center gap-1">
                              ❌ Unreachable: {failedLeads}
                            </span>
                            {callingLeads > 0 && (
                              <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md border border-indigo-150 animate-pulse flex items-center gap-1">
                                📞 Dialing: {callingLeads}
                              </span>
                            )}
                            {pendingLeads > 0 && (
                              <span className="bg-slate-200/50 text-slate-600 px-2.5 py-1 rounded-md border border-slate-200 flex items-center gap-1">
                                ⏳ Queue: {pendingLeads}
                              </span>
                            )}
                          </div>

                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => setSelectedCampaignForModal(c)}
                              className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 text-indigo-700 border border-indigo-200/80 rounded-xl text-xs font-black transition-all shadow-xs active:scale-95 cursor-pointer"
                            >
                              <Users size={14} />
                              <span>View Campaign Leads ({totalLeads})</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {c.status === 'running' && activeCallLead && activeCallLead.voice_campaign_id === c.id ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between animate-pulse shadow-xs">
                          <span className="text-[11px] text-amber-900 font-bold flex items-center gap-1.5">
                            📞 Call in progress with <span className="underline">{activeCallLead.name}</span>
                          </span>
                          <span className="bg-amber-200 text-amber-800 text-[9px] font-black uppercase px-2 py-0.5 rounded">Dialing</span>
                        </div>
                      ) : c.status === 'running' && (
                        <div className="bg-slate-100/60 border border-slate-200/60 rounded-xl p-2.5 text-[10px] text-slate-500 font-semibold italic">
                          Preparing next sequential call...
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* KYC MODAL */}
      {showKycModal && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-3 sm:p-6 pb-28 sm:pb-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-xl max-h-[86vh] flex flex-col shadow-2xl overflow-hidden font-sans">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
                  <FileCheck size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">Telecom KYC Verification</h3>
                  <p className="text-xs text-slate-500 font-medium">Verify your identity to activate outbound Indian calling lines</p>
                </div>
              </div>
              <button
                onClick={() => setShowKycModal(false)}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-200/60 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleKycSubmit} className="p-6 overflow-y-auto space-y-4">
              
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block ml-1">
                  Representative / Business Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={kycForm.name}
                  onChange={(e) => setKycForm({ ...kycForm, name: e.target.value })}
                  placeholder="e.g. Khushi Ram Realtors or Rahul Sharma"
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block ml-1">
                  Official KYC Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={kycForm.email}
                  onChange={(e) => setKycForm({ ...kycForm, email: e.target.value })}
                  placeholder="e.g. contact@khushiramrealtor.com"
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                />
                <span className="text-[10px] text-slate-400 font-medium block ml-1">
                  TRAI KYC verification link will be sent to this email address.
                </span>
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block ml-1">
                  Contact Phone Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={kycForm.phone}
                  onChange={(e) => setKycForm({ ...kycForm, phone: e.target.value })}
                  placeholder="e.g. +919876543210"
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all font-mono"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block ml-1">
                  Business Description / Nature of Business
                </label>
                <input
                  type="text"
                  value={kycForm.description}
                  onChange={(e) => setKycForm({ ...kycForm, description: e.target.value })}
                  placeholder="e.g. Real Estate Advisory & Property Consultant"
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                />
              </div>

              {/* Entity Type Toggle */}
              <div className="space-y-1.5 pt-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block ml-1">Entity Type</label>
                <div className="grid grid-cols-2 gap-3 bg-slate-100 p-1 rounded-2xl border border-slate-200/60">
                  <button
                    type="button"
                    onClick={() => setKycForm({ ...kycForm, entityType: 'individual' })}
                    className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${kycForm.entityType === 'individual' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    <User size={13} /> Individual Realtor
                  </button>
                  <button
                    type="button"
                    onClick={() => setKycForm({ ...kycForm, entityType: 'business' })}
                    className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${kycForm.entityType === 'business' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    <Building2 size={13} /> Company / Agency
                  </button>
                </div>
              </div>

              <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-3.5 flex items-start gap-2">
                <ShieldCheck size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-indigo-950 font-medium leading-relaxed">
                  Your dedicated sub-account will be provisioned on Vobiz. A TRAI KYC verification email will be dispatched to your submitted email address.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowKycModal(false)}
                  className="py-3 px-5 rounded-full border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingKyc}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-xs font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {submittingKyc ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-white" /> Registering Subaccount...
                    </>
                  ) : (
                    'Register Subaccount & Send KYC Link'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Campaign Leads Modal Overlay */}
      {selectedCampaignForModal && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-3 sm:p-6 pb-28 sm:pb-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-4xl max-h-[86vh] flex flex-col shadow-2xl overflow-hidden font-sans">
            {(() => {
              const rawModalLeads = allLeads.filter(l => l.voice_campaign_id === selectedCampaignForModal.id)
              const modalLeadsMap = new Map<string, any>()
              for (const lead of rawModalLeads) {
                if (!lead.phone) continue
                const norm = lead.phone.replace(/\D/g, '').slice(-10)
                if (!norm || norm.length < 10 || /^0+$/.test(norm)) continue
                if (!modalLeadsMap.has(norm)) {
                  modalLeadsMap.set(norm, lead)
                }
              }
              const modalLeads = Array.from(modalLeadsMap.values())

              return (
                <>
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-extrabold text-base text-slate-900">{selectedCampaignForModal.name}</h3>
                        <span className="text-xs font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                          {modalLeads.length} Unique Leads Tagged
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 font-medium">
                        Click "Open Lead CRM Page" to see full history, conversation transcript, and listen to recorded voice calls.
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedCampaignForModal(null)}
                      className="p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-200/60 transition-colors cursor-pointer"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="p-6 overflow-y-auto flex-1 space-y-3">
                    {modalLeads.length === 0 ? (
                      <div className="text-center py-12 text-slate-400 text-xs font-semibold">
                        No unique leads currently tagged for this campaign.
                      </div>
                    ) : (
                      modalLeads.map((lead) => {
                        const impersonateId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('impersonate') : null
                        const crmUrl = `/dashboard/crm/${lead.id}${impersonateId ? `?impersonate=${impersonateId}` : ''}`
                        
                        let statusBadgeClass = 'bg-slate-100 text-slate-600 border-slate-200'
                        let statusText = lead.voice_call_status || 'not_called'
                        
                        if (lead.voice_call_status === 'completed') {
                          statusBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          statusText = '✅ Spoke / Completed'
                        } else if (['failed', 'failed_max_retries'].includes(lead.voice_call_status)) {
                          statusBadgeClass = 'bg-rose-50 text-rose-700 border-rose-200'
                          statusText = '❌ Unreachable / Failed'
                        } else if (lead.voice_call_status === 'calling') {
                          statusBadgeClass = 'bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse'
                          statusText = '📞 Dialing Now'
                        } else if (lead.voice_call_status === 'scheduled_retry') {
                          statusBadgeClass = 'bg-purple-50 text-purple-700 border-purple-200'
                          statusText = '🔄 Voicemail - Retry Scheduled'
                        } else if (lead.voice_call_status === 'scheduled_callback') {
                          statusBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200'
                          statusText = '🕒 Callback Scheduled'
                        }

                        return (
                          <div key={lead.id} className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-slate-300 transition-all">
                            <div className="space-y-1.5 flex-1 pr-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-extrabold text-sm text-slate-900">{lead.name || 'Unnamed Lead'}</span>
                                <span className="text-xs font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200/60">{lead.phone}</span>
                                <span className={`text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full border ${statusBadgeClass}`}>
                                  {statusText}
                                </span>
                              </div>
                              {lead.voice_call_summary ? (
                                <p className="text-xs text-slate-600 line-clamp-2 bg-white p-2.5 rounded-xl border border-slate-200/60 italic font-medium leading-relaxed">
                                  "{lead.voice_call_summary}"
                                </p>
                              ) : (
                                <p className="text-[11px] text-slate-400 italic">No call conversation recorded yet.</p>
                              )}
                            </div>

                            <a
                              href={crmUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition-all shadow-2xs shrink-0 active:scale-95 cursor-pointer"
                            >
                              <span>Open Lead CRM Page</span>
                              <ExternalLink size={13} className="text-slate-500" />
                            </a>
                          </div>
                        )
                      })
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
