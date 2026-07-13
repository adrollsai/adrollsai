'use client'

import { useState, useEffect } from 'react'
import { 
  MessageCircle, 
  CalendarClock, 
  BellRing, 
  ArrowLeft, 
  Loader2, 
  Info, 
  Copy, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  Plus,
  Send,
  Trash2,
  Clock,
  ChevronDown,
  Layers,
  Settings,
  ListChecks,
  GripVertical,
  Pencil,
  Link2
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

// Map template icon names to actual Lucide Icon components
const iconMap: Record<string, any> = {
  'MessageCircle': MessageCircle,
  'CalendarClock': CalendarClock,
  'BellRing': BellRing
}

type WhatsAppFlow = {
  id: string
  title: string
  description: string
  icon_name: string
  is_active: boolean
  template_name: string
  template_body: string
  delay_minutes: number
  campaign_name?: string
  variables_mapping?: Record<string, string>
  header_media_url?: string
}

type MetaTemplate = {
  name: string
  status: string
  category: string
  language: string
  components: any[]
}

type BroadcastCampaign = {
  id: string
  title: string
  template_name: string
  recipient_stage: string
  recipient_property_id: string | null
  scheduled_at: string | null
  sent_at: string | null
  status: string
  created_at: string
  stats?: { total: number; sent: number; failed: number }
}

interface WhatsAppSettingsProps {
  userId: string | null
  onBack: () => void
}

export default function WhatsAppSettings({ userId, onBack }: WhatsAppSettingsProps) {
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<'drips' | 'templates' | 'broadcasts' | 'qualification'>('drips')
  
  // Qualification Flows state
  type QuestionFlow = {
    id: string
    name: string
    questions: { question: string; field_name: string }[]
    is_active: boolean
    linked_campaign_id: string | null
    created_at: string
  }
  const [questionFlows, setQuestionFlows] = useState<QuestionFlow[]>([])
  const [isCreateQFlowOpen, setIsCreateQFlowOpen] = useState(false)
  const [editingQFlowId, setEditingQFlowId] = useState<string | null>(null)
  const [qFlowForm, setQFlowForm] = useState({
    name: '',
    questions: [{ question: '', field_name: '' }] as { question: string; field_name: string }[],
    linked_campaign_id: '',
    is_active: false
  })
  
  // Data lists
  const [flows, setFlows] = useState<WhatsAppFlow[]>([])
  const [templates, setTemplates] = useState<MetaTemplate[]>([])
  const [broadcasts, setBroadcasts] = useState<BroadcastCampaign[]>([])
  const [properties, setProperties] = useState<{ id: string; title: string }[]>([])
  
  // Loading states
  const [loading, setLoading] = useState(true)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false)
  
  // Meta credentials state
  const [whatsappConnected, setWhatsappConnected] = useState(false)
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [whatsappWabaId, setWhatsappWabaId] = useState('')
  const [whatsappPhoneId, setWhatsappPhoneId] = useState('')
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  // Custom catalogue button text state
  const [catalogueButtonText, setCatalogueButtonText] = useState('View Products')
  const [whatsappButtons, setWhatsappButtons] = useState<{ text: string; url: string }[]>([
    { text: 'View Products', url: '' }
  ])
  const [savingButtonText, setSavingButtonText] = useState(false)

  // WhatsApp API Business Profile state
  const [waProfile, setWaProfile] = useState<any>({
    about: '',
    address: '',
    description: '',
    email: '',
    vertical: 'OTHER',
    websites: [''],
    profile_picture_url: ''
  })
  const [loadingWaProfile, setLoadingWaProfile] = useState(false)
  const [savingWaProfile, setSavingWaProfile] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const fetchWaProfile = async () => {
    try {
      setLoadingWaProfile(true)
      const res = await fetch('/api/whatsapp/profile')
      const data = await res.json()
      if (data.success && data.profile) {
        setWaProfile({
          about: data.profile.about || '',
          address: data.profile.address || '',
          description: data.profile.description || '',
          email: data.profile.email || '',
          vertical: data.profile.vertical || 'OTHER',
          websites: data.profile.websites || [''],
          profile_picture_url: data.profile.profile_picture_url || ''
        })
      }
    } catch (e) {
      console.error('Failed to fetch WA profile:', e)
    } finally {
      setLoadingWaProfile(false)
    }
  }

  const handleUpdateWaProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSavingWaProfile(true)
      const res = await fetch('/api/whatsapp/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(waProfile)
      })
      const data = await res.json()
      if (data.success) {
        toast.success("WhatsApp profile updated successfully! ✨")
        fetchWaProfile()
      } else {
        toast.error(data.error || "Failed to update profile.")
      }
    } catch (err: any) {
      toast.error("Failed to save changes.")
    } finally {
      setSavingWaProfile(false)
    }
  }

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error("Please upload an image file.")
      return
    }

    try {
      setUploadingPhoto(true)
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/whatsapp/profile', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()
      if (res.ok && data.success) {
        toast.success("Profile photo updated successfully! 📸")
        fetchWaProfile()
      } else {
        toast.error(data.error || "Failed to upload profile photo.")
      }
    } catch (err) {
      toast.error("Failed to upload photo.")
    } finally {
      setUploadingPhoto(false)
    }
  }

  // Modals & New Form states
  // Modals & New Form states
  const [isCreateFlowOpen, setIsCreateFlowOpen] = useState(false)
  const [newFlow, setNewFlow] = useState({
    title: '',
    description: '',
    template_name: '',
    template_body: '',
    delay_minutes: 2,
    campaign_name: 'All',
    variables_mapping: {} as Record<string, string>,
    header_media_url: ''
  })
  const [campaigns, setCampaigns] = useState<string[]>([])
  const [templateQuery, setTemplateQuery] = useState('')
  const [filteredTemplates, setFilteredTemplates] = useState<any[]>([])
  
  const [isCreateTemplateOpen, setIsCreateTemplateOpen] = useState(false)
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: 'MARKETING',
    bodyText: ''
  })
  const [submittingTemplate, setSubmittingTemplate] = useState(false)

  const [isCreateBroadcastOpen, setIsCreateBroadcastOpen] = useState(false)
  const [newBroadcast, setNewBroadcast] = useState({
    title: '',
    templateName: '',
    recipientStage: 'All',
    recipientPropertyId: '',
    scheduledAt: ''
  })
  const [submittingBroadcast, setSubmittingBroadcast] = useState(false)

  // Fetch initial profile & properties
  const fetchData = async () => {
    if (!userId) return

    try {
      // Fetch properties
      const { data: propData } = await supabase
        .from('properties')
        .select('id, title')
        .eq('user_id', userId)
      if (propData) setProperties(propData)

      // Fetch unique campaigns from leads
      const { data: leadCampaigns } = await supabase
        .from('leads')
        .select('ad_name')
        .eq('user_id', userId)

      const uniqueCamps = new Set<string>()
      if (leadCampaigns) {
        leadCampaigns.forEach((l: any) => {
          if (l.ad_name) uniqueCamps.add(l.ad_name)
        })
      }
      setCampaigns(Array.from(uniqueCamps))

      // Fetch profile credentials
      const { data: profileData } = await supabase
        .from('profiles')
        .select('whatsapp_access_token, whatsapp_phone_number, whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_catalogue_button_text, whatsapp_buttons')
        .eq('id', userId)
        .single()

      if (profileData) {
        const isConnected = !!profileData.whatsapp_access_token
        setWhatsappConnected(isConnected)
        setWhatsappNumber(profileData.whatsapp_phone_number || '')
        setWhatsappWabaId(profileData.whatsapp_waba_id || '')
        setWhatsappPhoneId(profileData.whatsapp_phone_number_id || '')
        setCatalogueButtonText(profileData.whatsapp_catalogue_button_text || 'View Products')
        
        if (profileData.whatsapp_buttons && Array.isArray(profileData.whatsapp_buttons) && profileData.whatsapp_buttons.length > 0) {
          setWhatsappButtons(profileData.whatsapp_buttons)
        } else {
          setWhatsappButtons([
            { text: profileData.whatsapp_catalogue_button_text || 'View Products', url: '' }
          ])
        }
        
        if (isConnected) {
          fetchWaProfile()
        }
      }

      // Fetch flows
      await fetchFlows()

      // Fetch qualification flows
      try {
        const qfRes = await fetch('/api/whatsapp/question-flows')
        const qfData = await qfRes.json()
        if (qfData.success) setQuestionFlows(qfData.flows || [])
      } catch (e) {
        console.error('Failed to fetch question flows:', e)
      }

      // Fetch Meta approved templates
      await fetchTemplates()
    } catch (err: any) {
      console.error('[WHATSAPP SETTINGS] Init Fetch Error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch flows from CRUD API
  const fetchFlows = async () => {
    try {
      const res = await fetch('/api/whatsapp/flows')
      const data = await res.json()
      if (data.success) {
        setFlows(data.flows)
      }
    } catch (e) {
      console.error('Failed to fetch custom flows:', e)
    }
  }

  // Fetch templates from Meta API
  const fetchTemplates = async () => {
    setLoadingTemplates(true)
    try {
      const res = await fetch('/api/whatsapp/templates')
      const data = await res.json()
      if (data.success) {
        setTemplates(data.templates)
        if (data.warning) {
          toast.warning(data.warning)
        }
      }
    } catch (e) {
      console.error('Failed to fetch Meta templates:', e)
    } finally {
      setLoadingTemplates(false)
    }
  }

  const handleSelectTemplate = (template: any) => {
    const bodyComponent = template.components?.find((c: any) => c.type === 'BODY');
    const bodyText = bodyComponent?.text || '';
    
    const headerComponent = template.components?.find((c: any) => c.type === 'HEADER');
    const hasMediaHeader = headerComponent?.format === 'IMAGE' || headerComponent?.format === 'VIDEO';
    
    const matches = bodyText.match(/{{\s*(\d+)\s*}}/g) || [];
    const vars = Array.from(new Set(matches.map((m: string) => m.replace(/\D/g, '')))) as string[];
    
    const initialMapping: Record<string, string> = {};
    vars.forEach((v: string) => {
      if (v === '1') initialMapping[v] = 'lead_name';
      else if (v === '2') initialMapping[v] = 'campaign_name';
      else if (v === '3') initialMapping[v] = 'company_name';
      else initialMapping[v] = 'custom_text';
    });

    setNewFlow({
      ...newFlow,
      template_name: template.name,
      template_body: bodyText,
      variables_mapping: initialMapping,
      header_media_url: hasMediaHeader ? (newFlow.header_media_url || '') : ''
    });
    setTemplateQuery(template.name);
    setFilteredTemplates([]);
  };

  // Fetch broadcasts from scheduler API
  const fetchBroadcasts = async () => {
    setLoadingBroadcasts(true)
    try {
      const res = await fetch(`/api/whatsapp/broadcasts?impersonate=${userId || ''}`)
      const data = await res.json()
      if (data.success) {
        setBroadcasts(data.broadcasts)
      }
    } catch (e) {
      console.error('Failed to fetch broadcasts:', e)
    } finally {
      setLoadingBroadcasts(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [userId])

  // Refetch lists depending on active tab
  useEffect(() => {
    if (activeTab === 'templates') fetchTemplates()
    if (activeTab === 'broadcasts') fetchBroadcasts()
    if (activeTab === 'drips') fetchFlows()
  }, [activeTab])

  // Facebook SDK Load (Standard Onboarding)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script')
      js.id = 'facebook-jssdk'
      js.src = 'https://connect.facebook.net/en_US/sdk.js'
      const fjs = document.getElementsByTagName('script')[0]
      if (fjs && fjs.parentNode) {
        fjs.parentNode.insertBefore(js, fjs)
      } else {
        document.head.appendChild(js)
      }
    }
    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v20.0'
      })
    }
  }, [])

  const handleWhatsAppConnect = () => {
    if (!(window as any).FB) {
      toast.error("Facebook SDK is loading. Try again in a moment.")
      return
    }

    setIsConnecting(true)
    let code: string | null = null
    let metadata: { wabaId?: string; phone_number_id?: string } | null = null
    let submitted = false

    const checkAndSubmit = async (forceSubmit = false) => {
      if (submitted) return
      if (code && (metadata || forceSubmit)) {
        submitted = true
        window.removeEventListener('message', messageListener)
        const finalMetadata = metadata || {}
        try {
          const res = await fetch('/api/whatsapp/onboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              wabaId: finalMetadata.wabaId,
              phone_number_id: finalMetadata.phone_number_id
            })
          })

          const result = await res.json()
          if (res.ok) {
            setWhatsappConnected(true)
            setWhatsappNumber(result.phone || 'Connected')
            setWhatsappWabaId(result.wabaId || finalMetadata.wabaId || '')
            setWhatsappPhoneId(result.phone_number_id || finalMetadata.phone_number_id || '')
            toast.success("WhatsApp Business connected! ✨")
            fetchData()
          } else {
            toast.error(`Onboarding failed: ${result.error}`)
            submitted = false
          }
        } catch (err: any) {
          toast.error("Onboarding failed completely.")
          submitted = false
        } finally {
          setIsConnecting(false)
        }
      }
    }

    const messageListener = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return
      try {
        const data = JSON.parse(event.data)
        let wabaId = ''
        let phone_number_id = ''
        if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
          wabaId = data.data?.waba_id || ''
          phone_number_id = data.data?.phone_number_id || ''
        } else if (data.action === 'whatsapp-embedded-signup-complete') {
          wabaId = data.payload?.wabaId || ''
          phone_number_id = data.payload?.phone_number_id || ''
        }
        if (wabaId || phone_number_id) {
          metadata = { wabaId, phone_number_id }
          checkAndSubmit()
        }
      } catch (e) {}
    }

    window.addEventListener('message', messageListener);

    (window as any).FB.login((response: any) => {
      if (response.authResponse) {
        code = response.authResponse.code
        checkAndSubmit()
        setTimeout(() => checkAndSubmit(true), 4000)
      } else {
        window.removeEventListener('message', messageListener)
        setIsConnecting(false)
      }
    }, {
      config_id: process.env.NEXT_PUBLIC_FACEBOOK_LOGIN_CONFIG_ID || '4311232925804423',
      response_type: 'code',
      override_default_response_type: true
    })
  }

  const handleDisconnect = async () => {
    if (!userId) return
    if (!confirm("Are you sure you want to disconnect WhatsApp? Drips will stop triggering.")) return

    setIsDisconnecting(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          whatsapp_access_token: null,
          whatsapp_waba_id: null,
          whatsapp_phone_number_id: null,
          whatsapp_phone_number: null,
          whatsapp_connected_at: null
        })
        .eq('id', userId)

      if (error) throw error
      setWhatsappConnected(false)
      setWhatsappNumber('')
      setWhatsappWabaId('')
      setWhatsappPhoneId('')
      toast.success("Disconnected successfully.")
    } catch (err: any) {
      toast.error("Disconnection failed.")
    } finally {
      setIsDisconnecting(false)
    }
  }

  // Toggle drip campaign active state
  const toggleFlow = async (id: string, currentStatus: boolean) => {
    setFlows(prev => prev.map(f => f.id === id ? { ...f, is_active: !currentStatus } : f))
    try {
      const res = await fetch('/api/whatsapp/flows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !currentStatus })
      })
      if (!res.ok) throw new Error()
      toast.success(`Flow updated successfully!`)
    } catch {
      toast.error("Failed to toggle flow state")
      setFlows(prev => prev.map(f => f.id === id ? { ...f, is_active: currentStatus } : f))
    }
  }

  // Update drip delay minutes
  const handleSaveDelay = async (id: string, newDelay: number) => {
    try {
      const res = await fetch('/api/whatsapp/flows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, delay_minutes: newDelay })
      })
      if (res.ok) {
        toast.success("Timing delay updated!")
        setFlows(prev => prev.map(f => f.id === id ? { ...f, delay_minutes: newDelay } : f))
      }
    } catch {
      toast.error("Failed to update timing delay")
    }
  }

  // Update drip campaign mapping
  const updateFlowCampaign = async (id: string, campaignName: string) => {
    try {
      const res = await fetch('/api/whatsapp/flows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, campaign_name: campaignName })
      })
      if (res.ok) {
        toast.success("Campaign association updated!")
        await fetchFlows()
      }
    } catch {
      toast.error("Failed to update campaign mapping")
    }
  }

  // Create custom flow
  const handleCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/whatsapp/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newFlow,
          campaign_name: newFlow.campaign_name || 'All',
          variables_mapping: newFlow.variables_mapping,
          header_media_url: newFlow.header_media_url || null
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success("Custom Flow created!")
        setIsCreateFlowOpen(false)
        setNewFlow({ 
          title: '', 
          description: '', 
          template_name: '', 
          template_body: '', 
          delay_minutes: 2, 
          campaign_name: 'All',
          variables_mapping: {},
          header_media_url: ''
        })
        setTemplateQuery('')
        await fetchFlows()
      } else {
        toast.error(data.error || "Failed to create flow")
      }
    } catch {
      toast.error("Failed to create custom flow")
    }
  }

  // Delete custom flow
  const handleDeleteFlow = async (id: string) => {
    if (!confirm("Are you sure you want to delete this custom flow?")) return
    try {
      const res = await fetch(`/api/whatsapp/flows?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success("Flow deleted")
        await fetchFlows()
      }
    } catch {
      toast.error("Failed to delete flow")
    }
  }

  // Submit template to Meta for approval
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingTemplate(true)
    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTemplate)
      })
      const data = await res.json()
      if (data.success) {
        toast.success("Template submitted to Meta successfully! 🎉")
        setIsCreateTemplateOpen(false)
        setNewTemplate({ name: '', category: 'MARKETING', bodyText: '' })
        await fetchTemplates()
      } else {
        toast.error(data.error || "Submission failed.")
      }
    } catch {
      toast.error("Failed to submit template.")
    } finally {
      setSubmittingTemplate(false)
    }
  }

  // Trigger broadcast campaign
  const handleCreateBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingBroadcast(true)
    try {
      const res = await fetch('/api/whatsapp/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newBroadcast,
          recipientPropertyId: newBroadcast.recipientPropertyId || null,
          scheduledAt: newBroadcast.scheduledAt || null,
          impersonateId: userId
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message || "Broadcast campaign scheduled successfully!")
        setIsCreateBroadcastOpen(false)
        setNewBroadcast({ title: '', templateName: '', recipientStage: 'All', recipientPropertyId: '', scheduledAt: '' })
        await fetchBroadcasts()
      } else {
        toast.error(data.error || "Failed to create campaign")
      }
    } catch {
      toast.error("Failed to create campaign")
    } finally {
      setSubmittingBroadcast(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard!")
  }

  const handleSaveCatalogueButtons = async () => {
    if (!userId) return
    
    if (whatsappButtons.length === 0) {
      toast.error("You must have at least one button!")
      return
    }
    
    // Validate buttons
    for (let i = 0; i < whatsappButtons.length; i++) {
      const btn = whatsappButtons[i];
      if (!btn.text.trim()) {
        toast.error(`Button ${i + 1} display text cannot be empty!`)
        return
      }
      if (btn.text.length > 20) {
        toast.error(`Button ${i + 1} display text cannot exceed 20 characters!`)
        return
      }
      if (btn.url.trim() && !btn.url.startsWith('http://') && !btn.url.startsWith('https://')) {
        toast.error(`Button ${i + 1} URL must start with http:// or https://`)
        return
      }
    }
    
    setSavingButtonText(true)
    try {
      const primaryText = whatsappButtons[0].text.trim()
      const { error } = await supabase
        .from('profiles')
        .update({
          whatsapp_catalogue_button_text: primaryText,
          whatsapp_buttons: whatsappButtons.map(btn => ({
            text: btn.text.trim(),
            url: btn.url.trim()
          }))
        })
        .eq('id', userId)

      if (error) throw error
      setCatalogueButtonText(primaryText)
      toast.success("WhatsApp action buttons saved successfully! 🚀")
    } catch (err: any) {
      toast.error("Failed to save buttons: " + err.message)
    } finally {
      setSavingButtonText(false)
    }
  }

  // Render template preview bubble
  const renderMockBubble = (templateBody: string, title: string, mapping: Record<string, string> = {}, headerUrl: string = '') => {
    let replacedText = templateBody || '';

    const displayMap: Record<string, string> = {
      lead_name: '[Lead Name]',
      lead_phone: '[Lead Phone]',
      campaign_name: '[Campaign Name]',
      company_name: '[Business Name]'
    };

    const maxVarIndex = 20;
    for (let i = 1; i <= maxVarIndex; i++) {
      const variablePlaceholder = `{{${i}}}`;
      if (replacedText.includes(variablePlaceholder)) {
        const field = mapping[String(i)];
        let replacement = `[Var ${i}]`;
        if (field) {
          replacement = displayMap[field] || field;
        } else {
          if (i === 1) replacement = '[Lead Name]';
          else if (i === 2) replacement = '[Campaign Name]';
          else if (i === 3) replacement = '[Business Name]';
        }
        replacedText = replacedText.replaceAll(variablePlaceholder, replacement);
      }
    }

    return (
      <div className="bg-[#E2F4C5] text-slate-800 p-4 rounded-3xl rounded-tr-none max-w-[95%] self-end text-[11px] sm:text-xs leading-relaxed font-medium shadow-sm ml-auto border border-emerald-100/50 relative flex flex-col gap-2.5">
        {headerUrl && (
          <div className="w-full h-28 rounded-2xl overflow-hidden relative border border-slate-200/50 bg-white">
            <img src={headerUrl} alt="Header Preview" className="w-full h-full object-cover" onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=400&q=80';
            }} />
          </div>
        )}
        <p className="whitespace-pre-wrap">{replacedText}</p>
        <span className="text-[9px] text-emerald-700/80 font-black float-right uppercase self-end tracking-wider">Preview</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-slate-300" size={32} />
        <p className="text-sm font-medium animate-pulse">Syncing WhatsApp settings...</p>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 mb-6 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors uppercase tracking-wider bg-white px-4 py-2.5 rounded-full shadow-sm border border-slate-200"
      >
        <ArrowLeft size={14} /> Back to Settings
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        
        {/* Left Column: Connection Status & Developer Sandbox */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Connection Card */}
          <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center gap-4 mb-6">
              <div className={`p-3.5 rounded-2xl flex items-center justify-center shadow-sm ${whatsappConnected ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                <MessageCircle size={24} />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-slate-950">WhatsApp Connection</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-medium leading-normal">
                  Connect your business line to configure auto drip agents
                </p>
              </div>
            </div>

            {whatsappConnected ? (
              <div className="space-y-4">
                <div className="bg-emerald-50/40 border border-emerald-100 rounded-3xl p-4 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-emerald-100/50">
                    <span className="text-[10px] text-emerald-800 font-bold uppercase tracking-wider">Status</span>
                    <span className="text-xs text-emerald-600 font-black flex items-center gap-1">● Connected</span>
                  </div>
                  {whatsappNumber && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Number</span>
                      <span className="font-bold text-slate-700">{whatsappNumber}</span>
                    </div>
                  )}
                  {whatsappWabaId && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">WABA ID</span>
                      <div className="flex items-center gap-1 font-mono text-[9px] bg-slate-100 px-1.5 py-0.5 rounded">
                        <span>{whatsappWabaId}</span>
                        <button onClick={() => copyToClipboard(whatsappWabaId)} className="text-slate-400 hover:text-slate-600"><Copy size={10} /></button>
                      </div>
                    </div>
                  )}
                  {whatsappPhoneId && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Phone ID</span>
                      <div className="flex items-center gap-1 font-mono text-[9px] bg-slate-100 px-1.5 py-0.5 rounded">
                        <span>{whatsappPhoneId}</span>
                        <button onClick={() => copyToClipboard(whatsappPhoneId)} className="text-slate-400 hover:text-slate-600"><Copy size={10} /></button>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="w-full py-3.5 px-4 rounded-full border border-red-100 text-red-600 hover:bg-red-50 text-xs font-bold transition-all flex items-center justify-center gap-2"
                >
                  {isDisconnecting && <Loader2 size={12} className="animate-spin" />}
                  Disconnect Integration
                </button>
              </div>
            ) : (
              <button
                onClick={handleWhatsAppConnect}
                disabled={isConnecting}
                className="w-full py-3.5 px-4 rounded-full bg-slate-950 text-white hover:bg-slate-900 text-xs font-black transition-all flex items-center justify-center gap-2 shadow-md"
              >
                {isConnecting ? <Loader2 size={14} className="animate-spin text-white" /> : <MessageCircle size={14} />}
                Connect business account
              </button>
            )}
          </div>

          {/* WhatsApp API Business Profile Card */}
          {whatsappConnected && (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm hover:shadow-md transition-all space-y-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center text-slate-800 shadow-sm">
                  <Settings size={20} />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-slate-950">WhatsApp API Profile</h4>
                  <p className="text-[10px] text-slate-500 font-medium">Manage your WhatsApp Business Profile info</p>
                </div>
              </div>

              {loadingWaProfile ? (
                <div className="flex flex-col items-center justify-center py-6 text-slate-400 gap-2">
                  <Loader2 className="animate-spin text-slate-300" size={20} />
                  <span className="text-[10px] font-bold">Syncing profile info...</span>
                </div>
              ) : (
                <form onSubmit={handleUpdateWaProfile} className="space-y-3.5">
                  
                  {/* Profile Photo */}
                  <div className="flex items-center gap-4 bg-slate-50/50 p-3 rounded-2xl border border-slate-100">
                    <div className="relative w-12 h-12 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                      {waProfile.profile_picture_url ? (
                        <img src={waProfile.profile_picture_url} alt="Profile Photo" className="w-full h-full object-cover animate-in fade-in" />
                      ) : (
                        <MessageCircle size={20} className="text-slate-400" />
                      )}
                      {uploadingPhoto && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Loader2 size={14} className="animate-spin text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-[10px] font-black text-slate-800">Profile Photo</div>
                      <label className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 text-[9px] font-black cursor-pointer transition-colors shadow-sm">
                        <Pencil size={10} /> {waProfile.profile_picture_url ? 'Change Photo' : 'Upload Photo'}
                        <input type="file" accept="image/jpeg,image/png" onChange={handleUploadPhoto} className="hidden" />
                      </label>
                    </div>
                  </div>

                  {/* Status / About */}
                  <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1 ml-0.5">Status / About Text</label>
                    <input 
                      type="text" 
                      value={waProfile.about} 
                      onChange={(e) => setWaProfile({ ...waProfile, about: e.target.value })}
                      placeholder="e.g. Hello! We are available on WhatsApp."
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/20 font-medium"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1 ml-0.5">Business Description</label>
                    <textarea 
                      value={waProfile.description} 
                      onChange={(e) => setWaProfile({ ...waProfile, description: e.target.value })}
                      placeholder="About your business..."
                      rows={3}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/20 font-medium resize-none"
                    />
                  </div>

                  {/* Address */}
                  <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1 ml-0.5">Business Address</label>
                    <input 
                      type="text" 
                      value={waProfile.address} 
                      onChange={(e) => setWaProfile({ ...waProfile, address: e.target.value })}
                      placeholder="e.g. 123 Main St, New York, NY"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/20 font-medium"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1 ml-0.5">Business Email</label>
                    <input 
                      type="email" 
                      value={waProfile.email} 
                      onChange={(e) => setWaProfile({ ...waProfile, email: e.target.value })}
                      placeholder="e.g. info@mybusiness.com"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/20 font-medium"
                    />
                  </div>

                  {/* Websites */}
                  <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1 ml-0.5">Websites</label>
                    {waProfile.websites.map((web: string, idx: number) => (
                      <div key={idx} className="flex gap-1.5 items-center mb-1">
                        <input 
                          type="text" 
                          value={web} 
                          onChange={(e) => {
                            const newWebs = [...waProfile.websites]
                            newWebs[idx] = e.target.value
                            setWaProfile({ ...waProfile, websites: newWebs })
                          }}
                          placeholder="e.g. https://www.mybusiness.com"
                          className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/20 font-medium"
                        />
                        {waProfile.websites.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => {
                              const newWebs = waProfile.websites.filter((_: any, i: number) => i !== idx)
                              setWaProfile({ ...waProfile, websites: newWebs })
                            }}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {waProfile.websites.length < 2 && (
                      <button 
                        type="button" 
                        onClick={() => setWaProfile({ ...waProfile, websites: [...waProfile.websites, ''] })}
                        className="mt-1 flex items-center gap-1 text-[9px] font-black text-slate-600 hover:text-slate-950 uppercase tracking-wider cursor-pointer"
                      >
                        <Plus size={10} /> Add Website
                      </button>
                    )}
                  </div>

                  {/* Vertical */}
                  <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1 ml-0.5">Business Category</label>
                    <select 
                      value={waProfile.vertical}
                      onChange={(e) => setWaProfile({ ...waProfile, vertical: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/20 font-bold"
                    >
                      <option value="OTHER">Other / General</option>
                      <option value="AUTO">Automotive</option>
                      <option value="BEAUTY">Beauty & Spa</option>
                      <option value="APPAREL">Apparel & Fashion</option>
                      <option value="EDU">Education</option>
                      <option value="ENTERTAIN">Entertainment & Recreation</option>
                      <option value="EVENT">Event Planning & Services</option>
                      <option value="FINANCE">Finance & Banking</option>
                      <option value="GROCERY">Grocery & Food Retail</option>
                      <option value="GOVT">Government</option>
                      <option value="HOTEL">Hotels & Lodging</option>
                      <option value="HEALTH">Healthcare & Medical</option>
                      <option value="NONPROFIT">Non-Profit Organization</option>
                      <option value="PROF_SERVICES">Professional Services (e.g. Real Estate)</option>
                      <option value="RETAIL">Retail Store</option>
                      <option value="TRAVEL">Travel & Tourism</option>
                      <option value="RESTAURANT">Restaurant & Catering</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={savingWaProfile}
                    className="w-full mt-2 py-3 px-4 rounded-full bg-slate-950 text-white hover:bg-slate-900 text-xs font-black transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {savingWaProfile ? <Loader2 size={12} className="animate-spin text-white" /> : 'Save Profile Changes'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Action Buttons Settings Card */}
          {whatsappConnected && (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm hover:shadow-md transition-all space-y-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm animate-pulse">
                  <MessageCircle size={20} />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-slate-950">WhatsApp Buttons</h4>
                  <p className="text-[10px] text-slate-500 font-medium">Configure interactive CTA buttons (up to 3)</p>
                </div>
              </div>

              <div className="space-y-4">
                {whatsappButtons.map((btn, index) => (
                  <div key={index} className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 space-y-3 relative group">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        Button {index + 1} {index === 0 ? "(Primary)" : ""}
                      </span>
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setWhatsappButtons(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="text-red-500 hover:text-red-700 transition-colors p-1 rounded-lg hover:bg-red-50 cursor-pointer"
                          title="Remove Button"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Button Display Text
                        </label>
                        <input
                          type="text"
                          value={btn.text}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val.length <= 20) {
                              setWhatsappButtons(prev => prev.map((b, i) => i === index ? { ...b, text: val } : b));
                            } else {
                              toast.error("Button text cannot exceed 20 characters!");
                            }
                          }}
                          placeholder="e.g. View Products"
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-white font-bold text-slate-800"
                        />
                        <div className="flex justify-between mt-1 text-[8px] text-slate-400 font-semibold px-0.5">
                          <span>Max 20 characters</span>
                          <span className={btn.text.length > 18 ? "text-red-500" : ""}>{btn.text.length}/20</span>
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Button Destination Link (URL)
                        </label>
                        <input
                          type="text"
                          value={btn.url}
                          onChange={(e) => {
                            const val = e.target.value;
                            setWhatsappButtons(prev => prev.map((b, i) => i === index ? { ...b, url: val } : b));
                          }}
                          placeholder={index === 0 ? "Shared Catalogue Link (Default)" : "https://your-custom-link.com"}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-900 bg-white font-bold text-slate-800"
                        />
                        {index === 0 && !btn.url && (
                          <p className="text-[8px] text-emerald-600 font-semibold mt-1 px-0.5">
                            Active default link: Shared Business Catalogue
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {whatsappButtons.length < 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      setWhatsappButtons(prev => [...prev, { text: '', url: '' }]);
                    }}
                    className="w-full py-2 px-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 text-slate-500 hover:text-slate-700 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus size={14} /> Add Action Button ({3 - whatsappButtons.length} remaining)
                  </button>
                )}

                <button
                  onClick={handleSaveCatalogueButtons}
                  disabled={savingButtonText}
                  className="w-full py-2.5 px-4 rounded-full bg-slate-950 text-white hover:bg-slate-900 text-xs font-black transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-50"
                >
                  {savingButtonText ? <Loader2 size={12} className="animate-spin text-white" /> : 'Save Buttons Configuration'}
                </button>
              </div>
            </div>
          )}

          {/* Sandbox Testing Guide Banner */}
          <div className="bg-indigo-50/60 border border-indigo-100 rounded-[2rem] p-6 shadow-sm">
            <h4 className="font-extrabold text-sm text-indigo-900 flex items-center gap-2 mb-2">
              <HelpCircle size={16} className="text-indigo-600" /> Developer Sandbox Guide
            </h4>
            <p className="text-[11px] text-indigo-950 leading-relaxed font-semibold opacity-90">
              When in Sandbox Mode:
            </p>
            <ul className="space-y-2 mt-2 text-[10px] text-indigo-900 font-bold list-decimal pl-4">
              <li>Must register and verify recipients on Meta console first.</li>
              <li>Only standard mock templates deliver instantly without prior Meta review.</li>
            </ul>
          </div>

        </div>

        {/* Right Column: Tabbed Settings Control */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Tabs Navigation Header */}
          <div className="bg-white border border-slate-200 rounded-3xl p-2 flex gap-1 shadow-sm">
            {(['drips', 'templates', 'broadcasts', 'qualification'] as const).map(tabId => {
              const label = tabId === 'drips' ? 'Drips' : tabId === 'templates' ? 'Templates' : tabId === 'broadcasts' ? 'Broadcasts' : 'Flows';
              const Icon = tabId === 'drips' ? MessageCircle : tabId === 'templates' ? CheckCircle2 : tabId === 'broadcasts' ? Send : ListChecks;
              const active = activeTab === tabId;
              return (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId)}
                  className={`flex-1 py-3 px-4 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <Icon size={14} />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              )
            })}
          </div>

          {/* TAB CONTENT: DRIP AUTOMATIONS */}
          {activeTab === 'drips' && (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">Follow-up Drip Campaigns</h3>
                  <p className="text-xs text-slate-500 font-medium">Automatic campaigns triggered when new leads are registered</p>
                </div>
                <button 
                  onClick={() => setIsCreateFlowOpen(!isCreateFlowOpen)}
                  className="bg-slate-950 hover:bg-slate-900 text-white rounded-full p-2.5 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Plus size={14} /> Create Drip
                </button>
              </div>

              {/* Create Custom Flow Form */}
              {isCreateFlowOpen && (
                <form onSubmit={handleCreateFlow} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-widest">New Follow-up Drip Setup</span>
                    <button type="button" onClick={() => setIsCreateFlowOpen(false)} className="text-xs text-red-500 font-bold hover:underline">Cancel</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Flow Name / Title</label>
                      <input 
                        type="text" 
                        value={newFlow.title}
                        onChange={(e) => setNewFlow({ ...newFlow, title: e.target.value })}
                        placeholder="e.g. Instant Lead Welcome" 
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Mapped Facebook Campaign</label>
                      <select 
                        value={newFlow.campaign_name}
                        onChange={(e) => setNewFlow({ ...newFlow, campaign_name: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none cursor-pointer"
                      >
                        <option value="All">All Campaigns</option>
                        {campaigns.map((camp, i) => <option key={i} value={camp}>{camp}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Internal Description</label>
                    <input 
                      type="text" 
                      value={newFlow.description}
                      onChange={(e) => setNewFlow({ ...newFlow, description: e.target.value })}
                      placeholder="e.g. Triggered immediately after lead capture on real estate landing page" 
                      className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5 relative">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Meta Approved Template Name</label>
                      <input 
                        type="text" 
                        value={templateQuery}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTemplateQuery(val);
                          setNewFlow({ ...newFlow, template_name: val });
                          if (val.trim()) {
                            const filtered = templates.filter(t => t.name.toLowerCase().includes(val.toLowerCase()));
                            setFilteredTemplates(filtered);
                          } else {
                            setFilteredTemplates([]);
                          }
                        }}
                        onFocus={() => {
                          if (templates.length > 0) {
                            setFilteredTemplates(templates);
                          }
                        }}
                        placeholder="Type to search or select a template..." 
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all font-mono"
                        required
                      />
                      {filteredTemplates.length > 0 && (
                        <div className="absolute left-0 right-0 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl mt-1 max-h-48 overflow-y-auto custom-scrollbar">
                          {filteredTemplates.map(t => (
                            <button
                              key={t.name}
                              type="button"
                              onClick={() => handleSelectTemplate(t)}
                              className="w-full px-4 py-2 text-left text-[11px] font-bold hover:bg-slate-50 transition-colors flex items-center justify-between"
                            >
                              <span className="font-mono text-slate-700 truncate mr-2">{t.name}</span>
                              <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase shrink-0 ${t.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                                {t.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Auto Trigger Delay Time</label>
                      <div className="flex items-center bg-white border border-slate-200 rounded-xl px-4 py-2.5">
                        <input 
                          type="number" 
                          value={newFlow.delay_minutes}
                          onChange={(e) => setNewFlow({ ...newFlow, delay_minutes: parseInt(e.target.value) || 0 })}
                          min={0}
                          className="w-12 text-center text-xs font-bold outline-none border-none mr-2"
                        />
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Minutes</span>
                      </div>
                    </div>
                  </div>

                  {/* Header Media URL */}
                  {(() => {
                    const selectedTemplate = templates.find(t => t.name === newFlow.template_name);
                    const headerComponent = selectedTemplate?.components?.find((c: any) => c.type === 'HEADER');
                    const isMedia = headerComponent?.format === 'IMAGE' || headerComponent?.format === 'VIDEO';
                    if (isMedia) {
                      return (
                        <div className="space-y-1.5 animate-in fade-in duration-200">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Header Image / Media URL (Optional)</label>
                          <input 
                            type="url" 
                            value={newFlow.header_media_url}
                            onChange={(e) => setNewFlow({ ...newFlow, header_media_url: e.target.value })}
                            placeholder="e.g. https://yourdomain.com/hero-image.jpg" 
                            className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all"
                          />
                          <span className="text-[9px] text-slate-400 block ml-1 font-semibold leading-normal">This template supports a header media parameter. Provide an image URL to include it.</span>
                        </div>
                      )
                    }
                    return null;
                  })()}

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Template Content Body</label>
                    <textarea 
                      value={newFlow.template_body}
                      onChange={(e) => setNewFlow({ ...newFlow, template_body: e.target.value })}
                      placeholder="Select a template above or paste template content..." 
                      rows={3}
                      className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all resize-none"
                      required
                    />
                  </div>

                  {/* Dynamic Parameter Mappings block */}
                  {(() => {
                    const matches = (newFlow.template_body || '').match(/{{\s*(\d+)\s*}}/g) || [];
                    const variables = Array.from(new Set(matches.map((m: string) => m.replace(/\D/g, '')))).sort((a, b) => parseInt(a) - parseInt(b));
                    if (variables.length === 0) return null;
                    return (
                      <div className="space-y-3 pt-2">
                        <span className="text-[10px] font-black text-slate-500 block uppercase tracking-widest ml-1">Map Template Variables</span>
                        <div className="grid grid-cols-1 gap-3">
                          {variables.map((v) => {
                            const currentVal = newFlow.variables_mapping[v] || '';
                            const isStandard = ['lead_name', 'lead_phone', 'campaign_name', 'company_name'].includes(currentVal);
                            return (
                              <div key={v} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2.5">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] font-black text-slate-700">Variable <code>{"{{" + v + "}}"}</code> maps to:</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <select
                                    value={isStandard ? currentVal : (currentVal ? 'custom_text' : '')}
                                    onChange={(e) => {
                                      const selectVal = e.target.value;
                                      const updatedMapping = { ...newFlow.variables_mapping };
                                      if (selectVal === 'custom_text') {
                                        updatedMapping[v] = ''; // empty custom text initially
                                      } else {
                                        updatedMapping[v] = selectVal;
                                      }
                                      setNewFlow({ ...newFlow, variables_mapping: updatedMapping });
                                    }}
                                    className="w-full bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl text-xs font-bold outline-none cursor-pointer"
                                  >
                                    <option value="">Choose Mapping...</option>
                                    <option value="lead_name">Lead Name</option>
                                    <option value="lead_phone">Lead Phone</option>
                                    <option value="campaign_name">Campaign Name</option>
                                    <option value="company_name">Company Name (Your Business Name)</option>
                                    <option value="custom_text">Static Custom Text</option>
                                  </select>

                                  {(!isStandard || currentVal === 'custom_text') && (
                                    <input
                                      type="text"
                                      value={isStandard ? '' : currentVal}
                                      onChange={(e) => {
                                        const updatedMapping = { ...newFlow.variables_mapping };
                                        updatedMapping[v] = e.target.value;
                                        setNewFlow({ ...newFlow, variables_mapping: updatedMapping });
                                      }}
                                      placeholder="Type static custom text here..."
                                      className="w-full bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                                      required
                                    />
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  <button 
                    type="submit"
                    className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm transition-all"
                  >
                    Save & Enable Drip Flow
                  </button>
                </form>
              )}

              {flows.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-medium text-xs flex flex-col items-center justify-center gap-2 border border-dashed border-slate-200 rounded-3xl">
                  <AlertCircle size={28} className="text-slate-300" />
                  <p>No follow-up flows found. Submit custom templates or toggle default ones.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {flows.map(flow => {
                    const IconComponent = iconMap[flow.icon_name] || MessageCircle
                    return (
                      <div 
                        key={flow.id} 
                        className={`p-5 rounded-3xl border transition-all duration-300 flex flex-col gap-4 relative overflow-hidden ${
                          flow.is_active 
                            ? 'bg-white border-blue-200 shadow-md ring-2 ring-blue-500/5' 
                            : 'bg-slate-50/80 border-slate-100 opacity-90'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex gap-3">
                            <div className={`p-3 rounded-2xl flex items-center justify-center border shadow-sm transition-all ${
                              flow.is_active ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-200 text-slate-400 border-slate-300'
                            }`}>
                              <IconComponent size={20} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className={`font-black text-sm ${flow.is_active ? 'text-slate-900' : 'text-slate-500'}`}>
                                  {flow.title}
                                </h4>
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${flow.campaign_name && flow.campaign_name !== 'All' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                                  Campaign: {flow.campaign_name || 'All'}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 font-medium max-w-sm mt-0.5">{flow.description}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2.5">
                            {/* Toggle switch */}
                            <button 
                              onClick={() => toggleFlow(flow.id, flow.is_active)}
                              className={`w-11 h-6 rounded-full flex items-center transition-all duration-300 px-0.5 shadow-inner cursor-pointer ${
                                flow.is_active ? 'bg-slate-950' : 'bg-slate-300'
                              }`}
                            >
                              <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
                                flow.is_active ? 'translate-x-5' : 'translate-x-0'
                              }`} />
                            </button>
                            <button 
                              onClick={() => handleDeleteFlow(flow.id)} 
                              className="text-slate-300 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors"
                              title="Delete Flow"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {renderMockBubble(flow.template_body, flow.title, flow.variables_mapping || {}, flow.header_media_url || '')}

                        {/* Configurations row */}
                        <div className="flex flex-wrap items-center justify-between gap-4 pt-3.5 border-t border-slate-100">
                          {/* Campaign Selector */}
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Campaign Map:</span>
                            <select 
                              value={flow.campaign_name || 'All'} 
                              onChange={(e) => updateFlowCampaign(flow.id, e.target.value)}
                              className="bg-slate-50 hover:bg-slate-100 border border-slate-200/60 text-slate-700 text-[10px] font-bold rounded-lg py-1 px-2 outline-none cursor-pointer transition-colors"
                            >
                              <option value="All">All Campaigns</option>
                              {campaigns.map((camp, i) => <option key={i} value={camp}>{camp}</option>)}
                            </select>
                          </div>

                          <DelayInput 
                            initialDelay={flow.delay_minutes} 
                            onSave={(newDelay) => handleSaveDelay(flow.id, newDelay)} 
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT: TEMPLATE APPROVALS */}
          {activeTab === 'templates' && (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">Meta Template Approvals</h3>
                  <p className="text-xs text-slate-500 font-medium">Verify verification states or register new message templates directly</p>
                </div>
                <button 
                  onClick={() => setIsCreateTemplateOpen(!isCreateTemplateOpen)}
                  className="bg-slate-950 hover:bg-slate-900 text-white rounded-full p-2.5 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm animate-pulse"
                >
                  <Plus size={14} /> Register Template
                </button>
              </div>

              {isCreateTemplateOpen && (
                <form onSubmit={handleCreateTemplate} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-widest">Register New WhatsApp Template</span>
                    <button type="button" onClick={() => setIsCreateTemplateOpen(false)} className="text-xs text-red-500 font-bold hover:underline">Cancel</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Template Name</label>
                      <input 
                        type="text" 
                        value={newTemplate.name}
                        onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                        placeholder="e.g. project_visit_invite" 
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-mono outline-none focus:border-blue-400"
                        required
                      />
                      <span className="text-[9px] text-slate-400 block ml-1 font-semibold leading-normal">Use lowercase letters, numbers, and underscores only.</span>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Template Category</label>
                      <select 
                        value={newTemplate.category}
                        onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none cursor-pointer"
                      >
                        <option value="MARKETING">Marketing Campaign</option>
                        <option value="UTILITY">Utility / Reminders</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Body Text Content</label>
                    <textarea 
                      value={newTemplate.bodyText}
                      onChange={(e) => setNewTemplate({ ...newTemplate, bodyText: e.target.value })}
                      placeholder="Hi {{1}}, thanks for booking a site visit to {{2}} tomorrow at {{3}}." 
                      rows={4}
                      className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all resize-none"
                      required
                    />
                    <span className="text-[9px] text-slate-400 block ml-1 font-semibold leading-normal">{"Include placeholders like {{1}} for variables. Values are mapped dynamically on send."}</span>
                  </div>
                  <button 
                    type="submit"
                    disabled={submittingTemplate}
                    className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submittingTemplate && <Loader2 size={12} className="animate-spin" />}
                    Submit for Approval
                  </button>
                </form>
              )}

              {loadingTemplates ? (
                <div className="py-12 flex justify-center"><Loader2 size={24} className="animate-spin text-slate-300" /></div>
              ) : templates.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-medium text-xs flex flex-col items-center justify-center gap-2 border border-dashed border-slate-200 rounded-3xl">
                  <AlertCircle size={28} className="text-slate-300" />
                  <p>No Meta templates found. Connect credentials or submit a new one.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templates.map(t => {
                    const isApproved = t.status === 'APPROVED';
                    const isPending = t.status === 'PENDING';
                    const isRejected = t.status === 'REJECTED';
                    const bodyText = t.components?.find((c: any) => c.type === 'BODY')?.text || '';
                    return (
                      <div key={t.name} className="border border-slate-100 rounded-3xl p-4 bg-slate-50 flex flex-col justify-between gap-3 relative shadow-sm">
                        <div>
                          <div className="flex justify-between items-start gap-2 mb-2">
                            <span className="font-mono text-xs font-black text-slate-800 truncate pr-2" title={t.name}>{t.name}</span>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                              isApproved ? 'bg-emerald-100 text-emerald-700' : isPending ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {t.status}
                            </span>
                          </div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t.category} • {t.language}</p>
                          <p className="text-[11px] font-medium text-slate-600 leading-normal line-clamp-3 bg-white p-2 rounded-xl border border-slate-200/50">{bodyText}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT: BULK BROADCASTS */}
          {activeTab === 'broadcasts' && (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">Broadcast Campaigns</h3>
                  <p className="text-xs text-slate-500 font-medium">Send templates manual bursts or schedule broadcasts to lead segments</p>
                </div>
                <button 
                  onClick={() => setIsCreateBroadcastOpen(!isCreateBroadcastOpen)}
                  className="bg-slate-950 hover:bg-slate-900 text-white rounded-full p-2.5 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Plus size={14} /> New Broadcast
                </button>
              </div>

              {isCreateBroadcastOpen && (
                <form onSubmit={handleCreateBroadcast} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-widest">New Broadcast Configuration</span>
                    <button type="button" onClick={() => setIsCreateBroadcastOpen(false)} className="text-xs text-red-500 font-bold hover:underline">Cancel</button>
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Campaign Title (Internal Reference)</label>
                    <input 
                      type="text" 
                      value={newBroadcast.title}
                      onChange={(e) => setNewBroadcast({ ...newBroadcast, title: e.target.value })}
                      placeholder="e.g. Summer Launch Alert - Phase 2" 
                      className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Target Template</label>
                      <select 
                        value={newBroadcast.templateName}
                        onChange={(e) => setNewBroadcast({ ...newBroadcast, templateName: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none cursor-pointer"
                        required
                      >
                        <option value="">Select an approved template</option>
                        {templates.map(t => (
                          <option key={t.name} value={t.name}>{t.name} ({t.status})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Scheduler (Leave blank for Send Now)</label>
                      <input 
                        type="datetime-local" 
                        value={newBroadcast.scheduledAt}
                        onChange={(e) => setNewBroadcast({ ...newBroadcast, scheduledAt: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Target Pipeline Stage</label>
                      <select 
                        value={newBroadcast.recipientStage}
                        onChange={(e) => setNewBroadcast({ ...newBroadcast, recipientStage: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none cursor-pointer"
                      >
                        <option value="All">All Leads (No stage filter)</option>
                        <option value="New">New</option>
                        <option value="Contacted">Contacted</option>
                        <option value="Qualified">Qualified</option>
                        <option value="Appointment booked">Appointment booked</option>
                        <option value="Appointment done">Appointment done</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Target Project Interest</label>
                      <select 
                        value={newBroadcast.recipientPropertyId}
                        onChange={(e) => setNewBroadcast({ ...newBroadcast, recipientPropertyId: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none cursor-pointer"
                      >
                        <option value="">All Leads (No project filter)</option>
                        {properties.map(p => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={submittingBroadcast}
                    className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submittingBroadcast && <Loader2 size={12} className="animate-spin" />}
                    {newBroadcast.scheduledAt ? 'Schedule Broadcast' : 'Launch Broadcast Blast Now'}
                  </button>
                </form>
              )}

              {loadingBroadcasts ? (
                <div className="py-12 flex justify-center"><Loader2 size={24} className="animate-spin text-slate-300" /></div>
              ) : broadcasts.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-medium text-xs flex flex-col items-center justify-center gap-2 border border-dashed border-slate-200 rounded-3xl">
                  <AlertCircle size={28} className="text-slate-300" />
                  <p>No broadcast campaigns found. Create one to send template blasts.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {broadcasts.map(b => {
                    const stats = b.stats || { total: 0, sent: 0, failed: 0 }
                    const percent = stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0
                    return (
                      <div key={b.id} className="border border-slate-100 rounded-3xl p-5 bg-slate-50 space-y-3 shadow-sm">
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <h4 className="font-extrabold text-sm text-slate-900">{b.title}</h4>
                            <p className="text-[10px] text-slate-400 font-black uppercase mt-1">
                              Template: {b.template_name} • Audience: Stage ({b.recipient_stage})
                            </p>
                          </div>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                            b.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : b.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {b.status}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        {stats.total > 0 && (
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-[10px] font-bold text-slate-500">
                              <span>Delivery status: {stats.sent} / {stats.total} Sent</span>
                              <span>{percent}% Complete</span>
                            </div>
                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                              <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${percent}%` }} />
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                          <span>Created at: {new Date(b.created_at).toLocaleDateString()}</span>
                          {b.sent_at && <span>Executed: {new Date(b.sent_at).toLocaleTimeString()}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT: QUALIFICATION FLOWS */}
          {activeTab === 'qualification' && (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">Qualification Flows</h3>
                  <p className="text-xs text-slate-500 font-medium">Automated question sequences for new WhatsApp leads</p>
                </div>
                <button 
                  onClick={() => {
                    setIsCreateQFlowOpen(!isCreateQFlowOpen)
                    setEditingQFlowId(null)
                    setQFlowForm({ name: '', questions: [{ question: '', field_name: '' }], linked_campaign_id: '', is_active: false })
                  }}
                  className="bg-slate-950 hover:bg-slate-900 text-white rounded-full p-2.5 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Plus size={14} /> New Flow
                </button>
              </div>

              {/* Info Banner */}
              <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4">
                <p className="text-[11px] text-blue-900 font-bold leading-relaxed">
                  💡 When someone messages your WhatsApp number, they'll first be asked for their name. 
                  If an active flow exists, they'll go through the qualification questions. 
                  After completion, a lead is automatically created in your CRM.
                </p>
              </div>

              {/* Create / Edit Flow Form */}
              {isCreateQFlowOpen && (
                <form onSubmit={async (e) => {
                  e.preventDefault()
                  const validQuestions = qFlowForm.questions.filter(q => q.question.trim() && q.field_name.trim())
                  if (!qFlowForm.name.trim() || validQuestions.length === 0) {
                    toast.error('Please provide a flow name and at least one question.')
                    return
                  }
                  try {
                    const payload = {
                      ...( editingQFlowId ? { id: editingQFlowId } : {}),
                      name: qFlowForm.name,
                      questions: validQuestions,
                      linked_campaign_id: qFlowForm.linked_campaign_id || null,
                      is_active: qFlowForm.is_active
                    }
                    const res = await fetch('/api/whatsapp/question-flows', {
                      method: editingQFlowId ? 'PUT' : 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                    })
                    const data = await res.json()
                    if (data.success) {
                      toast.success(editingQFlowId ? 'Flow updated!' : 'Flow created!')
                      setIsCreateQFlowOpen(false)
                      setEditingQFlowId(null)
                      setQFlowForm({ name: '', questions: [{ question: '', field_name: '' }], linked_campaign_id: '', is_active: false })
                      // Refresh flows
                      const refreshRes = await fetch('/api/whatsapp/question-flows')
                      const refreshData = await refreshRes.json()
                      if (refreshData.success) setQuestionFlows(refreshData.flows)
                    } else {
                      toast.error(data.error || 'Failed to save flow')
                    }
                  } catch {
                    toast.error('Failed to save flow')
                  }
                }} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-widest">{editingQFlowId ? 'Edit Flow' : 'New Qualification Flow'}</span>
                    <button type="button" onClick={() => { setIsCreateQFlowOpen(false); setEditingQFlowId(null) }} className="text-xs text-red-500 font-bold hover:underline">Cancel</button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Flow Name</label>
                      <input 
                        type="text" 
                        value={qFlowForm.name}
                        onChange={(e) => setQFlowForm({ ...qFlowForm, name: e.target.value })}
                        placeholder="e.g. Real Estate Qualification" 
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all"
                        required
                      />
                    </div>
                    <div className="space-y-1.5 min-w-0">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Link to Campaign (Optional)</label>
                      <div className="flex items-center gap-2 min-w-0">
                        <Link2 size={14} className="text-slate-400 shrink-0" />
                        <select 
                          value={qFlowForm.linked_campaign_id}
                          onChange={(e) => setQFlowForm({ ...qFlowForm, linked_campaign_id: e.target.value })}
                          className="flex-1 w-full min-w-0 bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none cursor-pointer truncate"
                        >
                          <option value="">No Campaign (Default Flow)</option>
                          {campaigns.map((camp, i) => <option key={i} value={camp}>{camp}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Dynamic Questions Builder */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Questions</label>
                      <button 
                        type="button" 
                        onClick={() => setQFlowForm({ ...qFlowForm, questions: [...qFlowForm.questions, { question: '', field_name: '' }] })}
                        className="text-[10px] font-black text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Plus size={12} /> Add Question
                      </button>
                    </div>

                    {qFlowForm.questions.map((q, idx) => (
                      <div key={idx} className="flex gap-2 items-start bg-white border border-slate-200/70 rounded-2xl p-3 group">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black mt-1 shrink-0">{idx + 1}</div>
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input 
                            type="text" 
                            value={q.question}
                            onChange={(e) => {
                              const updated = [...qFlowForm.questions]
                              updated[idx].question = e.target.value
                              setQFlowForm({ ...qFlowForm, questions: updated })
                            }}
                            placeholder="Question text (e.g. What's your budget?)" 
                            className="bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl text-xs font-medium outline-none focus:border-blue-400 transition-all"
                          />
                          <input 
                            type="text" 
                            value={q.field_name}
                            onChange={(e) => {
                              const updated = [...qFlowForm.questions]
                              updated[idx].field_name = e.target.value.replace(/\s/g, '_').toLowerCase()
                              setQFlowForm({ ...qFlowForm, questions: updated })
                            }}
                            placeholder="Field name (e.g. budget)" 
                            className="bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl text-xs font-mono font-medium outline-none focus:border-blue-400 transition-all"
                          />
                        </div>
                        {qFlowForm.questions.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => {
                              const updated = qFlowForm.questions.filter((_, i) => i !== idx)
                              setQFlowForm({ ...qFlowForm, questions: updated })
                            }}
                            className="text-red-400 hover:text-red-600 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Activate Toggle */}
                  <label className="flex items-center gap-3 cursor-pointer bg-emerald-50/50 border border-emerald-100 rounded-2xl p-3">
                    <input 
                      type="checkbox" 
                      checked={qFlowForm.is_active}
                      onChange={(e) => setQFlowForm({ ...qFlowForm, is_active: e.target.checked })}
                      className="w-4 h-4 rounded accent-emerald-600"
                    />
                    <span className="text-xs font-bold text-emerald-800">Activate this flow immediately</span>
                    <span className="text-[9px] text-emerald-600 font-medium">(activating will deactivate other flows)</span>
                  </label>

                  <button type="submit" className="w-full bg-slate-950 text-white text-xs font-black py-3 rounded-2xl hover:bg-slate-900 transition-all shadow-sm">
                    {editingQFlowId ? 'Update Flow' : 'Create Flow'}
                  </button>
                </form>
              )}

              {/* Flow List */}
              {questionFlows.length === 0 && !isCreateQFlowOpen ? (
                <div className="text-center py-12 text-slate-400">
                  <ListChecks size={40} className="mx-auto mb-3 text-slate-200" />
                  <p className="text-xs font-bold">No qualification flows yet</p>
                  <p className="text-[10px] font-medium mt-1">Create your first flow to start qualifying WhatsApp leads automatically.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {questionFlows.map(flow => (
                    <div key={flow.id} className={`border rounded-2xl p-4 transition-all ${flow.is_active ? 'bg-emerald-50/30 border-emerald-200 shadow-sm' : 'bg-white border-slate-200'}`}>
                      <div className="flex justify-between items-start gap-3 min-w-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="text-sm font-extrabold text-slate-900 truncate">{flow.name}</h4>
                            {flow.is_active && (
                              <span className="text-[8px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">Active</span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 font-medium break-all">
                            {flow.questions.length} question{flow.questions.length !== 1 ? 's' : ''}
                            {flow.linked_campaign_id && <span className="ml-2 block sm:inline font-bold text-blue-600">• Linked to: <span className="break-all">{flow.linked_campaign_id}</span></span>}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {flow.questions.map((q, qi) => (
                              <span key={qi} className="text-[9px] bg-slate-100 text-slate-600 px-2 py-1 rounded-lg font-bold">{q.field_name}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Toggle Active */}
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/whatsapp/question-flows', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ id: flow.id, is_active: !flow.is_active })
                                })
                                const data = await res.json()
                                if (data.success) {
                                  toast.success(flow.is_active ? 'Flow deactivated' : 'Flow activated!')
                                  const refreshRes = await fetch('/api/whatsapp/question-flows')
                                  const refreshData = await refreshRes.json()
                                  if (refreshData.success) setQuestionFlows(refreshData.flows)
                                }
                              } catch { toast.error('Failed to toggle flow') }
                            }}
                            className={`w-10 h-5 rounded-full transition-all relative cursor-pointer ${flow.is_active ? 'bg-emerald-500' : 'bg-slate-200'}`}
                          >
                            <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${flow.is_active ? 'left-5' : 'left-0.5'}`} />
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => {
                              setEditingQFlowId(flow.id)
                              setQFlowForm({
                                name: flow.name,
                                questions: flow.questions.length > 0 ? flow.questions : [{ question: '', field_name: '' }],
                                linked_campaign_id: flow.linked_campaign_id || '',
                                is_active: flow.is_active
                              })
                              setIsCreateQFlowOpen(true)
                            }}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={async () => {
                              if (!confirm('Delete this flow? This cannot be undone.')) return
                              try {
                                const res = await fetch(`/api/whatsapp/question-flows?id=${flow.id}`, { method: 'DELETE' })
                                if (res.ok) {
                                  toast.success('Flow deleted')
                                  setQuestionFlows(prev => prev.filter(f => f.id !== flow.id))
                                }
                              } catch { toast.error('Failed to delete flow') }
                            }}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Timing delay input sub-component
interface DelayInputProps {
  initialDelay: number
  onSave: (newDelay: number) => void
}

function DelayInput({ initialDelay, onSave }: DelayInputProps) {
  const [val, setVal] = useState(initialDelay.toString())

  useEffect(() => {
    setVal(initialDelay.toString())
  }, [initialDelay])

  const handleBlur = () => {
    const parsed = parseInt(val)
    if (isNaN(parsed) || parsed < 0) {
      setVal(initialDelay.toString())
    } else if (parsed !== initialDelay) {
      onSave(parsed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200/60 py-1.5 px-3 rounded-2xl">
      <span>Trigger Delay:</span>
      <input 
        type="number" 
        value={val}
        min={0}
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-10 text-center bg-white border border-slate-200 rounded-lg py-0.5 text-slate-800 font-extrabold focus:border-blue-500 outline-none transition-all"
      />
      <span className="text-slate-400">minutes</span>
    </div>
  )
}

// Credentials manual setup sub-form
interface DevOverrideFormProps {
  userId: string | null
  onSave: () => void
}

function DevOverrideForm({ userId, onSave }: DevOverrideFormProps) {
  const supabase = createClient()
  const [token, setToken] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [phoneId, setPhoneId] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return

    if (!token.trim() || !wabaId.trim() || !phoneId.trim() || !phoneNumber.trim()) {
      toast.error("All fields are required")
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          whatsapp_access_token: token.trim(),
          whatsapp_waba_id: wabaId.trim(),
          whatsapp_phone_number_id: phoneId.trim(),
          whatsapp_phone_number: phoneNumber.trim(),
          whatsapp_connected_at: new Date().toISOString()
        })
        .eq('id', userId)

      if (error) throw error

      toast.success("Sandbox credentials saved! ✨")
      onSave()
      setToken('')
      setWabaId('')
      setPhoneId('')
      setPhoneNumber('')
    } catch (err: any) {
      toast.error(`Override failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 bg-white border border-slate-200/60 p-4 rounded-2xl">
      <div className="space-y-1">
        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block ml-0.5">Temporary Access Token</label>
        <textarea 
          rows={2}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="EAAMa..."
          className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 py-1.5 px-3 rounded-xl text-xs font-mono outline-none text-slate-800 focus:border-indigo-500 transition-all resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block ml-0.5">WABA ID</label>
          <input 
            type="text" 
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            placeholder="177739..."
            className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 py-1.5 px-3 rounded-xl text-xs font-mono outline-none text-slate-800 focus:border-indigo-500 transition-all"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block ml-0.5">Phone ID</label>
          <input 
            type="text" 
            value={phoneId}
            onChange={(e) => setPhoneId(e.target.value)}
            placeholder="114095..."
            className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 py-1.5 px-3 rounded-xl text-xs font-mono outline-none text-slate-800 focus:border-indigo-500 transition-all"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block ml-0.5">Sender Number</label>
        <input 
          type="text" 
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+1 555 663 3659"
          className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 py-1.5 px-3 rounded-xl text-xs font-bold outline-none text-slate-800 focus:border-indigo-500 transition-all"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 active:scale-95"
      >
        {loading && <Loader2 size={12} className="animate-spin" />}
        Save Sandbox Credentials
      </button>
    </form>
  )
}
