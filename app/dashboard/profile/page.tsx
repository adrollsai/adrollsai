'use client'

import { useState, useEffect, useRef } from 'react'
import {
  CreditCard,
  LogOut,
  ChevronRight,
  Save,
  Upload,
  Loader2,
  Facebook,
  CheckCircle,
  Instagram,
  Target,
  Globe,
  CheckCircle2,
  AlertCircle,
  FileText,
  Shield,
  RefreshCw,
  Copy,
  Linkedin,
  Users,
  User,
  Building2,
  Video,
  BarChart3,
  Mic,
  Phone,
  Info,
  Sparkles,
  Eye,
  Trash2,
  Plus,
  ImageIcon,
  Calendar,
  Plug,
  MessageCircle,
  Share2,
  Zap,
  Mail,
  ExternalLink,
  Coins
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import WhatsAppSettings from '@/components/WhatsAppSettings'
import VoiceAgentSettings from '@/components/VoiceAgentSettings'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import PushManager from '@/components/PushManager'
import { uploadToR2 } from '@/utils/upload-helper'

type FBPage = {
  id: string
  name: string
  access_token: string
  category: string
}

type AdAccount = {
  id: string
  name: string
}

type Pixel = {
  id: string
  name: string
}


// --- DOMAIN MANAGER COMPONENT ---
function DomainManager({
  initialDomain,
  verifyToken,
  verifyStatus,
  userId,
  onDomainUpdate,
  type = 'catalogue',
  label = 'Custom Domain (Optional)'
}: {
  initialDomain: string,
  verifyToken: string | null,
  verifyStatus: string | null,
  userId: string | null,
  onDomainUpdate: () => void,
  type?: 'catalogue' | 'platform',
  label?: string
}) {
  const [domain, setDomain] = useState(initialDomain || '')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (initialDomain) setDomain(initialDomain)
  }, [initialDomain])

  const handleConnect = async () => {
    if (!domain || !userId) return
    setLoading(true)
    setErrorMessage('')

    try {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
      setDomain(cleanDomain)

      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: cleanDomain, userId, type })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to link domain')

      onDomainUpdate()
      toast.success("Domain connected successfully! ✨")
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleUnlink = async () => {
    if (!confirm(`Are you sure you want to unlink ${domain}? Your custom landing page will stop working immediately.`)) return;

    setLoading(true)
    try {
      const res = await fetch('/api/domains', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, userId, type })
      })

      if (!res.ok) throw new Error('Failed to unlink domain')

      setDomain('')
      onDomainUpdate()
      toast.success("Domain unlinked successfully.")
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard")
  }

  // Determine if it is a subdomain or apex domain
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();
  const parts = cleanDomain.split('.');
  const isSubdomain = parts.length > 2 && parts[0] !== 'www';
  const subdomainPrefix = isSubdomain ? parts.slice(0, -2).join('.') : '';

  return (
    <div className="bg-blue-50/60 p-5 rounded-3xl border border-blue-100/50 mt-4 transition-all">
      <label className="text-xs font-bold text-blue-800 ml-1 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
        <Globe size={14} /> {label}
      </label>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="www.yourdomain.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={!!initialDomain || loading}
          className="w-full bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-blue-100 shadow-sm transition-all disabled:opacity-60"
        />

        {initialDomain ? (
          <button
            onClick={handleUnlink}
            disabled={loading}
            className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-6 py-3.5 rounded-2xl sm:rounded-full text-sm font-bold active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Unlink'}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={loading || !domain}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3.5 rounded-2xl sm:rounded-full text-sm font-bold whitespace-nowrap active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Connect'}
          </button>
        )}
      </div>

      {/* VERIFIED DNS RECORD INSTRUCTIONS STATE */}
      {verifyStatus === 'verified' && (
        <div className="mt-5 bg-white p-5 rounded-3xl border border-green-200 shadow-sm animate-in fade-in slide-in-from-top-2">
          <p className="text-sm font-bold text-green-700 flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} /> Domain Linked!
          </p>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed font-medium">
            {isSubdomain ? (
              <span>
                To configure your subdomain (<strong>{cleanDomain}</strong>), log in to your DNS provider (e.g., Cloudflare, GoDaddy, Namecheap) and create a new <strong>CNAME</strong> record:
              </span>
            ) : (
              <span>
                To configure your root domain (<strong>{cleanDomain}</strong>), log in to your DNS provider (e.g., Cloudflare, GoDaddy, Namecheap) and add the following two records (an <strong>A</strong> record and a <strong>CNAME</strong> record):
              </span>
            )}
          </p>
          
          <div className="space-y-4">
            {isSubdomain ? (
              <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase font-black tracking-wider text-[10px]">
                      <th className="p-3">Type</th>
                      <th className="p-3">Name / Host</th>
                      <th className="p-3">Value / Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50 text-slate-700 font-medium">
                      <td className="p-3 font-bold text-blue-600">CNAME</td>
                      <td className="p-3 font-mono bg-slate-50/50">{subdomainPrefix}</td>
                      <td className="p-3 flex items-center justify-between gap-2">
                        <code className="font-mono text-slate-900 bg-slate-50 px-2 py-0.5 rounded">cname.vercel-dns.com</code>
                        <button onClick={() => copyToClipboard('cname.vercel-dns.com')} className="text-blue-500 hover:text-blue-700"><Copy size={14} /></button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase font-black tracking-wider text-[10px]">
                      <th className="p-3">Type</th>
                      <th className="p-3">Name / Host</th>
                      <th className="p-3">Value / Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50 text-slate-700 font-medium">
                      <td className="p-3 font-bold text-blue-600">A</td>
                      <td className="p-3 font-mono bg-slate-50/50">@</td>
                      <td className="p-3 flex items-center justify-between gap-2">
                        <code className="font-mono text-slate-900 bg-slate-50 px-2 py-0.5 rounded">76.76.21.21</code>
                        <button onClick={() => copyToClipboard('76.76.21.21')} className="text-blue-500 hover:text-blue-700"><Copy size={14} /></button>
                      </td>
                    </tr>
                    <tr className="text-slate-700 font-medium">
                      <td className="p-3 font-bold text-blue-600">CNAME</td>
                      <td className="p-3 font-mono bg-slate-50/50">www</td>
                      <td className="p-3 flex items-center justify-between gap-2">
                        <code className="font-mono text-slate-900 bg-slate-50 px-2 py-0.5 rounded">cname.vercel-dns.com</code>
                        <button onClick={() => copyToClipboard('cname.vercel-dns.com')} className="text-blue-500 hover:text-blue-700"><Copy size={14} /></button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            
            <div className="bg-blue-50/40 border border-blue-100/50 p-3 rounded-2xl flex items-start gap-2">
              <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
              <p className="text-[10px] text-blue-800 leading-normal font-medium">
                Note: DNS changes can take anywhere from a few minutes to 24 hours to propagate globally. SSL certificates will configure automatically once the DNS is resolved.
              </p>
            </div>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mt-3 bg-red-50 p-3 rounded-2xl border border-red-100">
          <p className="text-xs font-bold text-red-600 flex items-center gap-1.5"><AlertCircle size={14} /> {errorMessage}</p>
        </div>
      )}
    </div>
  )
}


export default function ProfilePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<'main' | 'whatsapp' | 'voice' | 'calendar' | 'flagged' | 'legal'>('main')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [role, setRole] = useState<'super_admin' | 'agency' | 'client' | 'admin' | 'agent'>('agent')
  const [authRole, setAuthRole] = useState<string | null>(null)
  const [authUserName, setAuthUserName] = useState<string | null>(null)

  const [bookingEnabled, setBookingEnabled] = useState(false)
  const [flaggedCount, setFlaggedCount] = useState(0)
  const [flaggedQuestions, setFlaggedQuestions] = useState<any[]>([])
  const [loadingFlagged, setLoadingFlagged] = useState(false)
  const [enableEodReport, setEnableEodReport] = useState(true)
  const [credits, setCredits] = useState<number>(0)
  const [selectedTextLlm, setSelectedTextLlm] = useState('gemini')

  const isAdminLike = ['super_admin', 'agency', 'admin', 'client', 'agent'].includes(authRole || role)

  // Actions
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [isConnectingFb, setIsConnectingFb] = useState(false) // Added connection loading state
  // Connections
  const [isFacebookConnected, setIsFacebookConnected] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  // --- LINKEDIN STATE ---
  const [isLinkedinConnected, setIsLinkedinConnected] = useState(false)
  const [linkedinName, setLinkedinName] = useState('')
  const [isConnectingLinkedin, setIsConnectingLinkedin] = useState(false)
  const [linkedinPages, setLinkedinPages] = useState<{ id: string; name: string }[]>([])
  const [selectedLinkedinUrn, setSelectedLinkedinUrn] = useState<string | null>(null)
  const [isLoadingLinkedinPages, setIsLoadingLinkedinPages] = useState(false)
  const [linkedinScopeWarning, setLinkedinScopeWarning] = useState(false)

  // --- GOOGLE CALENDAR STATE ---
  const [isGoogleConnected, setIsGoogleConnected] = useState(false)
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false)
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = useState(false)
  const [googleBookingDuration, setGoogleBookingDuration] = useState(30)
  const [googleBookingStart, setGoogleBookingStart] = useState("09:00")
  const [googleBookingEnd, setGoogleBookingEnd] = useState("17:00")
  const [isSavingGoogleSettings, setIsSavingGoogleSettings] = useState(false)
  const [googleCalendars, setGoogleCalendars] = useState<any[]>([])
  const [googleCalendarId, setGoogleCalendarId] = useState("primary")
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false)


  const [facebookToken, setFacebookToken] = useState<string | null>(null);

  const [fbPages, setFbPages] = useState<FBPage[]>([])
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([])
  const [pixels, setPixels] = useState<Pixel[]>([])

  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string>('')
  const [selectedPixelId, setSelectedPixelId] = useState<string>('')

  const [isLoadingPages, setIsLoadingPages] = useState(false)
  const [isLoadingAdAccounts, setIsLoadingAdAccounts] = useState(false)
  const [isLoadingPixels, setIsLoadingPixels] = useState(false)
  const [isCreatingPixel, setIsCreatingPixel] = useState(false)

  // Profile Data
  const [domainData, setDomainData] = useState({
    domain: '',
    token: null as string | null,
    status: null as string | null
  })

  const [whitelabelDomainData, setWhitelabelDomainData] = useState({
    domain: '',
    token: null as string | null,
    status: null as string | null
  })

  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    businessInfo: '',
    color: '#D0E8FF',
    contact: '',
    address: '',
    logoUrl: '',
    avatarUrl: '',
    avatarAudioUrl: '',
    characterUrl: '',
    characterAudioUrl: '',
    facebookUrl: '',
    instagramUrl: '',
    customPrompt: '',
    currency: 'INR',
    industry: '',
    whatsappPersonalNumber: '',
    email: ''
  })

  const [personalFullName, setPersonalFullName] = useState('')
  const [personalAvatarUrl, setPersonalAvatarUrl] = useState('')
  const [uploadingPersonalAvatar, setUploadingPersonalAvatar] = useState(false)
  const [isSavingPersonalDetails, setIsSavingPersonalDetails] = useState(false)
  const personalAvatarInputRef = useRef<HTMLInputElement>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- HELPERS ---
  const isValidFacebookToken = (token: string) => token && token.startsWith('EAA')

  const updateLocalCache = (updates: any) => {
    const effectiveUserId = targetUserId || userId;
    if (!effectiveUserId) return;
    const cacheKey = `profile_cache_${effectiveUserId}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        localStorage.setItem(cacheKey, JSON.stringify({ ...parsed, ...updates }));
      }
    } catch (e) {
      console.error(`[Profile Cache] Error updating cache for key "${cacheKey}":`, e);
    }
  }

  // 1. Fetch Pages
  const fetchPages = async () => {
    setIsLoadingPages(true)
    try {
      const res = await fetch(`/api/facebook/pages${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
      const data = await res.json()
      if (data.pages && Array.isArray(data.pages)) {
        setFbPages(data.pages)
      } else {
        setFbPages([])
      }
    } catch (e) {
      console.error("Error fetching pages:", e)
      setFbPages([])
    } finally {
      setIsLoadingPages(false)
    }
  }

  // 1.5 Fetch LinkedIn Pages
  const fetchLinkedinPages = async () => {
    setIsLoadingLinkedinPages(true)
    setLinkedinScopeWarning(false)
    try {
      const res = await fetch(`/api/linkedin/pages${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
      if (res.status === 403) {
        setLinkedinScopeWarning(true)
        setLinkedinPages([])
        return
      }
      const data = await res.json()
      if (res.ok && data.pages) {
        setLinkedinPages(data.pages)
      } else {
        setLinkedinPages([])
      }
    } catch (e) {
      console.error("Error fetching LinkedIn pages:", e)
      setLinkedinPages([])
    } finally {
      setIsLoadingLinkedinPages(false)
    }
  }

  const handleLinkedinPageSelect = async (urn: string | null) => {
    const effectiveUserId = targetUserId || userId;
    if (!effectiveUserId) return

    setSelectedLinkedinUrn(urn)

    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId: effectiveUserId,
        updates: {
          linkedin_urn: urn
        }
      })
    })
    const resData = await res.json()
    if (resData.error) {
      toast.error(`Failed to save LinkedIn page selection: ${resData.error}`)
      return
    }

    toast.success(urn ? "Connected to LinkedIn Company Page!" : "Connected to LinkedIn Personal Profile!", {
      description: urn ? "Posts will now be published to this page." : "Posts will now be published to your profile."
    })
    
    updateLocalCache({ linkedin_urn: urn })
  }

  // 2. Fetch Ad Accounts
  const fetchAdAccounts = async (token: string) => {
    setIsLoadingAdAccounts(true);
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name&access_token=${token}`);
      const data = await res.json();
      const formattedAccounts = data.data?.map((acc: any) => ({
        id: acc.id,
        name: acc.name,
      })) || [];

      if (formattedAccounts.length > 0) {
        setAdAccounts(formattedAccounts);
      } else {
        setAdAccounts([]);
      }
    } catch (e) {
      console.error("Network error fetching ad accounts:", e);
      setAdAccounts([]);
    } finally {
      setIsLoadingAdAccounts(false);
    }
  }

  // 3. Fetch Pixels
  const fetchPixels = async (adAccountId: string) => {
    setIsLoadingPixels(true)
    try {
      const res = await fetch('/api/facebook/pixels', {
        method: 'POST',
        body: JSON.stringify({ adAccountId, impersonateId })
      })
      const data = await res.json()
      if (data.pixels) {
        setPixels(data.pixels)
        if (data.pixels.length === 1 && !selectedPixelId) {
          handlePixelSelect(data.pixels[0].id)
        }
      } else {
        setPixels([])
      }
    } catch (e) {
      setPixels([])
    }
    finally { setIsLoadingPixels(false) }
  }

  const handleCreatePixel = async () => {
      if (!selectedAdAccountId) {
          toast.error("Please connect and select an Ad Account first.")
          return
      }
      
      const pixelName = prompt("Enter Pixel Name:", "AdRolls Pixel")
      if (!pixelName) return

      setIsCreatingPixel(true)
      try {
          const res = await fetch('/api/meta-ads/create-pixel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  adAccountId: selectedAdAccountId,
                  pixelName,
                  impersonateId
              })
          })
          const data = await res.json()

          if (data.error) {
              toast.error(`Failed to create pixel: ${data.error}`)
          } else {
              toast.success("Meta Pixel created successfully!")
              setSelectedPixelId(data.pixelId)
              updateLocalCache({ pixel_id: data.pixelId })
              fetchPixels(selectedAdAccountId)
          }
      } catch (err: any) {
          toast.error(`Error: ${err.message}`)
      } finally {
          setIsCreatingPixel(false)
      }
  }

  // --- SELECTION HANDLERS ---
  const handlePageSelect = async (pageId: string) => {
    const effectiveUserId = targetUserId || userId;
    const page = fbPages.find(p => p.id === pageId)
    if (!page || !effectiveUserId) return

    setSelectedPageId(pageId)

    // 1. Save to DB
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId: effectiveUserId,
        updates: {
          selected_page_id: page.id,
          selected_page_name: page.name,
          selected_page_token: page.access_token
        }
      })
    })
    const resData = await res.json()
    if (resData.error) {
      toast.error(`Failed to save page selection: ${resData.error}`)
      return
    }

    // 2. TRIGGER WEBHOOK SUBSCRIPTION (Fixes "No app associated" error)
    try {
      const subRes = await fetch('/api/facebook/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: page.id, pageToken: page.access_token })
      })
      const subData = await subRes.json()
      if (!subRes.ok) {
        throw new Error(subData.error || 'Failed to subscribe page webhooks')
      }
      toast.success(`Connected to ${page.name}!`, {
        description: "Real-time leads are now enabled for this page."
      })
    } catch (e: any) {
      console.error("Auto-subscription failed:", e)
      toast.error("Connected with warnings", {
        description: e.message || "CRM saving works, but real-time notifications might need a manual refresh."
      })
    }

    updateLocalCache({ selected_page_id: page.id, selected_page_name: page.name, selected_page_token: page.access_token })
  }

  const handleAdAccountSelect = async (adAccountId: string) => {
    const effectiveUserId = targetUserId || userId;
    if (!effectiveUserId) return

    setSelectedAdAccountId(adAccountId)
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId: effectiveUserId,
        updates: {
          ad_account_id: adAccountId,
        }
      })
    })
    const resData = await res.json()
    if (resData.error) {
      toast.error(`Failed to save ad account: ${resData.error}`)
      return
    }

    updateLocalCache({ ad_account_id: adAccountId })
    fetchPixels(adAccountId)
  }

  const handlePixelSelect = async (pixelId: string) => {
    const effectiveUserId = targetUserId || userId;
    if (!effectiveUserId) return
    setSelectedPixelId(pixelId)
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId: effectiveUserId,
        updates: {
          pixel_id: pixelId,
        }
      })
    })
    const resData = await res.json()
    if (resData.error) {
      toast.error(`Failed to save pixel: ${resData.error}`)
      return
    }
    updateLocalCache({ pixel_id: pixelId })
  }

  // --- CORE: Fetch Profile ---
  const fetchProfile = async (force = false) => {
    try {
      if (!force && !userId) setLoading(true)
      if (force) setIsRefreshing(true)

      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user

      if (!user) {
        router.push('/')
        return
      }
      setUserId(user.id)

      // Get AUTH user role first
      const { data: authProfile } = await supabase.from('profiles').select('role, agency_id, parent_id, business_name, full_name, avatar_url').eq('id', user.id).single()
      const currentAuthRole = authProfile?.role || 'admin'
      setAuthRole(currentAuthRole)
      setAuthUserName(authProfile?.business_name || null)
      setPersonalFullName(authProfile?.full_name || '')
      setPersonalAvatarUrl(authProfile?.avatar_url || '')

      // Resolve Target User ID
      let tUserId = user.id

      // 1. Staff (Admin/Agent) automatically see their Agency's profile
      if (['admin', 'agent'].includes(currentAuthRole) && (authProfile?.agency_id || authProfile?.parent_id)) {
          tUserId = (authProfile?.agency_id || authProfile?.parent_id) as string
      }
      
      // 2. Impersonation (Super Admin or Agency viewing a client)
      if (impersonateId && (['super_admin', 'agency', 'admin', 'agent'].includes(currentAuthRole))) {
          if (currentAuthRole !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', authProfile?.agency_id || user.id)
                .single()
              if (subAccount) tUserId = impersonateId
          } else {
              tUserId = impersonateId
          }
      }
      setTargetUserId(tUserId)

      let profileData = null

      const { data } = await supabase
        .from('profiles')
        .select('*, facebook_token, selected_page_id, ad_account_id, pixel_id, custom_domain, domain_verify_token, domain_verify_status, whitelabel_domain, whitelabel_verify_token, whitelabel_verify_status, role, custom_prompt')
        .eq('id', tUserId)
        .single()

      profileData = data

      if (profileData) {
        setRole(profileData.role as any || 'admin')
        setCredits(profileData.credits || 0)
        setSelectedTextLlm(profileData.selected_text_llm || 'gemini')
        setAcceptedTerms(profileData.accepted_terms || false)

        setDomainData({
          domain: profileData.custom_domain || '',
          token: profileData.domain_verify_token,
          status: profileData.domain_verify_status
        })

        setWhitelabelDomainData({
          domain: profileData.whitelabel_domain || '',
          token: profileData.whitelabel_verify_token,
          status: profileData.whitelabel_verify_status
        })

        setFormData({
          businessName: profileData.business_name || '',
          mission: profileData.mission_statement || '',
          businessInfo: profileData.business_info || '',
          color: profileData.brand_color || '#D0E8FF',
          contact: profileData.contact_number || '',
          address: profileData.address || '',
          logoUrl: profileData.logo_url || '',
          avatarUrl: profileData.avatar_url || '',
          avatarAudioUrl: profileData.avatar_audio_url || '',
          characterUrl: profileData.character_url || '',
          characterAudioUrl: profileData.character_audio_url || '',
          facebookUrl: profileData.facebook_url || '',
          instagramUrl: profileData.instagram_url || '',
          customPrompt: profileData.custom_prompt || '',
          currency: profileData.currency || 'INR',
          industry: profileData.industry || '',
          whatsappPersonalNumber: profileData.whatsapp_personal_number || '',
          email: profileData.email || ''
        })

        if (profileData.facebook_token && isValidFacebookToken(profileData.facebook_token)) {
          setIsFacebookConnected(true)
          setFacebookToken(profileData.facebook_token);
          if (profileData.selected_page_id) setSelectedPageId(profileData.selected_page_id)
          else fetchPages()

          if (profileData.ad_account_id) {
            setSelectedAdAccountId(profileData.ad_account_id)
            fetchPixels(profileData.ad_account_id)
          }
          if (profileData.pixel_id) {
            setSelectedPixelId(profileData.pixel_id)
          }

          fetchAdAccounts(profileData.facebook_token);
        } else {
          setIsFacebookConnected(false)
          setFacebookToken(null);
          setAdAccounts([]);
          setPixels([]);
        }

        // Handle LinkedIn Status
        if (profileData.linkedin_token) {
          setIsLinkedinConnected(true)
          setLinkedinName(profileData.linkedin_name || 'Connected Account')
          setSelectedLinkedinUrn(profileData.linkedin_urn || null)
          fetchLinkedinPages()
        } else {
          setIsLinkedinConnected(false)
          setLinkedinName('')
          setSelectedLinkedinUrn(null)
          setLinkedinPages([])
        }

        // Handle Google & Booking Status
        setBookingEnabled(profileData.google_booking_enabled || false)
        setGoogleBookingDuration(profileData.google_booking_duration || 30)
        setGoogleCalendarId(profileData.google_calendar_id || 'primary')
        const hours = profileData.google_booking_hours || { start: '09:00', end: '17:00' }
        setGoogleBookingStart(hours.start || '09:00')
        setGoogleBookingEnd(hours.end || '17:00')
        setEnableEodReport(profileData.enable_eod_report !== false)

        if (profileData.google_refresh_token) {
          setIsGoogleConnected(true)
        } else {
          setIsGoogleConnected(false)
        }
      }

    } catch (error) {
      console.error("Load error:", error)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    fetchProfile(false)
  }, [router, supabase])

  // --- ACTIONS ---

  const handleConnectLinkedin = async (type: 'personal' | 'company' = 'personal') => {
    setIsConnectingLinkedin(true)
    try {
      // Redirect to our LinkedIn Auth API
      const imp = impersonateId ? `&impersonate=${impersonateId}` : ''
      window.location.href = `/api/auth/linkedin?type=${type}${imp}`
    } catch (err) {
      toast.error('Failed to initiate LinkedIn connection')
      setIsConnectingLinkedin(false)
    }
  }

  const handleDisconnectLinkedin = async () => {
    if (!confirm('Are you sure you want to unlink your LinkedIn account?')) return
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const effectiveUserId = targetUserId || user.id;

      const { error } = await supabase
        .from('profiles')
        .update({ 
          linkedin_token: null, 
          linkedin_id: null,
          linkedin_name: null,
          linkedin_urn: null
        })
        .eq('id', effectiveUserId)

      if (error) throw error
      
      setIsLinkedinConnected(false)
      setLinkedinName('')
      setSelectedLinkedinUrn(null)
      setLinkedinPages([])
      setLinkedinScopeWarning(false)
      toast.success('LinkedIn unlinked successfully')
      updateLocalCache({
        linkedin_token: null,
        linkedin_id: null,
        linkedin_name: null,
        linkedin_urn: null
      })
    } catch (err: any) {
      toast.error('Failed to unlink LinkedIn', { description: err.message })
    }
  }

  const handleConnectGoogle = () => {
    setIsConnectingGoogle(true)
    const effectiveUserId = targetUserId || userId;
    window.location.href = `/api/auth/google/signin?userId=${effectiveUserId}`
  }

  const handleDisconnectGoogle = async () => {
    if (!confirm("Disconnect Google Calendar?")) return
    setIsDisconnectingGoogle(true)
    const effectiveUserId = targetUserId || userId;
    try {
      if (effectiveUserId) {
        const res = await fetch('/api/profile/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUserId: effectiveUserId,
            updates: {
              google_refresh_token: null,
              google_booking_enabled: false
            }
          })
        })
        const resData = await res.json()
        if (!res.ok || resData.error) throw new Error(resData.error || 'Failed to update')
        setIsGoogleConnected(false)
        updateLocalCache({ google_refresh_token: null, google_booking_enabled: false })
        toast.success("Google Calendar disconnected successfully.")
      }
    } catch (e: any) {
      toast.error("Failed to disconnect: " + e.message)
    } finally {
      setIsDisconnectingGoogle(false)
    }
  }

  const fetchGoogleCalendars = async (uId: string) => {
    setIsLoadingCalendars(true)
    try {
      const res = await fetch(`/api/profile/calendars?userId=${uId}`)
      const data = await res.json()
      if (res.ok && data.calendars) {
        setGoogleCalendars(data.calendars)
      } else {
        console.error("Calendars API error:", data.error)
        const isTokenErr = data.error && (
          data.error.toLowerCase().includes('expired') || 
          data.error.toLowerCase().includes('revoked') || 
          data.error.toLowerCase().includes('invalid_grant')
        )
        if (isTokenErr) {
          toast.error("Google Calendar connection has expired or been revoked. Please reconnect.", {
            duration: 5000
          })
          setIsGoogleConnected(false)
          // Automatically unlink the Google account in the database
          await fetch('/api/profile/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetUserId: uId,
              updates: {
                google_refresh_token: null,
                google_booking_enabled: false
              }
            })
          })
          updateLocalCache({ google_refresh_token: null, google_booking_enabled: false })
        } else {
          toast.error(`Calendars error: ${data.error || 'Failed to fetch calendar list'}`)
        }
      }
    } catch (err) {
      console.error("Failed to load calendars:", err)
    } finally {
      setIsLoadingCalendars(false)
    }
  }

  useEffect(() => {
    const effectiveUserId = targetUserId || userId;
    if (isGoogleConnected && effectiveUserId) {
      fetchGoogleCalendars(effectiveUserId)
    }
  }, [isGoogleConnected, targetUserId, userId])

  const fetchFlaggedQuestions = async (uId: string) => {
    setLoadingFlagged(true)
    try {
      const imp = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/questions/list${imp}`)
      const resData = await res.json()
      
      if (res.ok && resData.flaggedQuestions) {
        const data = resData.flaggedQuestions
        setFlaggedQuestions(data)
        setFlaggedCount(data.length)

        // Automatically trigger enrichment for questions missing language/translation metadata
        data.forEach((fq: any) => {
          if (!fq.language) {
            fetch('/api/questions/enrich', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ questionId: fq.id })
            })
            .then(res => res.json())
            .then(enrichData => {
              if (enrichData.success) {
                setFlaggedQuestions(prev => prev.map(item => {
                  if (item.id === fq.id) {
                    return { ...item, language: enrichData.language, translation: enrichData.translation }
                  }
                  return item
                }))
              }
            })
            .catch(err => console.error('Enrichment call failed:', err))
          }
        })
      } else {
        console.error("Failed to load flagged questions API error:", resData.error)
        setFlaggedQuestions([])
        setFlaggedCount(0)
      }
    } catch (err) {
      console.error("Failed to load flagged questions:", err)
      setFlaggedQuestions([])
      setFlaggedCount(0)
    } finally {
      setLoadingFlagged(false)
    }
  }


  useEffect(() => {
    const effectiveUserId = targetUserId || userId;
    if (effectiveUserId) {
      fetchFlaggedQuestions(effectiveUserId)
    }
  }, [targetUserId, userId])

  const handleSaveGoogleSettings = async () => {
    setIsSavingGoogleSettings(true)
    const effectiveUserId = targetUserId || userId;
    try {
      if (effectiveUserId) {
        const { error } = await supabase.from('profiles').update({
          google_booking_enabled: bookingEnabled,
          google_booking_duration: googleBookingDuration,
          google_booking_hours: { start: googleBookingStart, end: googleBookingEnd },
          google_calendar_id: googleCalendarId
        }).eq('id', effectiveUserId)
        if (error) throw error
        updateLocalCache({
          google_booking_enabled: bookingEnabled,
          google_booking_duration: googleBookingDuration,
          google_booking_hours: { start: googleBookingStart, end: googleBookingEnd },
          google_calendar_id: googleCalendarId
        })
        toast.success("Calendar booking settings saved successfully!")
      }
    } catch (e: any) {
      toast.error("Failed to save settings: " + e.message)
    } finally {
      setIsSavingGoogleSettings(false)
    }
  }

  const handleConnectFacebook = async () => {
    setIsConnectingFb(true)
    // EMERGENCY BYPASS: Use custom route to avoid Supabase Auth email errors
    // This acquires the marketing token without requiring a unique email match
    window.location.href = `/api/facebook/connect${impersonateId ? `?impersonate=${impersonateId}` : ''}`
  }

  const handleDisconnectFacebook = async () => {
    if (!confirm("Disconnect Facebook?")) return
    setIsDisconnecting(true)

    const effectiveUserId = targetUserId || userId;
    try {
      if (effectiveUserId) {
        // 1. Clear profile table
        await supabase.from('profiles').update({
          facebook_token: null, selected_page_id: null, selected_page_name: null, selected_page_token: null,
          ad_account_id: null, pixel_id: null
        }).eq('id', effectiveUserId)

        // 2. Unlink from Supabase Auth identities so re-linking triggers a fresh token flow
        const { data: { user } } = await supabase.auth.getUser()
        if (user?.identities) {
          const fbIdentity = user.identities.find(id => id.provider === 'facebook')
          if (fbIdentity) {
            const { error: unlinkError } = await supabase.auth.unlinkIdentity(fbIdentity)
            if (unlinkError) console.error("Error unlinking Facebook identity:", unlinkError)
          }
        }

        updateLocalCache({
          facebook_token: null, selected_page_id: null, selected_page_name: null, selected_page_token: null,
          ad_account_id: null, pixel_id: null
        })
      }
      setIsFacebookConnected(false)
      setFacebookToken(null)
      setFbPages([])
      setAdAccounts([])
      setPixels([])
      setSelectedPageId('')
      setSelectedAdAccountId('')
      setSelectedPixelId('')
      toast.success("Facebook disconnected successfully.")
    } catch (error: any) {
      console.error("Disconnect error:", error)
      toast.error("Failed to disconnect: " + error.message)
    } finally {
      setIsDisconnecting(false)
    }
  }

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      setUploadingLogo(true)
      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) return

      const file = event.target.files[0]
      const fileExt = file.name.split('.').pop()
      const fileName = `${effectiveUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })

      const publicUrl = await uploadToR2(renamedFile, 'logos')

      setFormData(prev => ({ ...prev, logoUrl: publicUrl }))
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: effectiveUserId,
          updates: {
            logo_url: publicUrl,
          }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)
      updateLocalCache({ logo_url: publicUrl })

    } catch (error: any) {
      console.error("Logo upload error:", error)
      alert('Error uploading logo: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingLogo(false)
    }
  }

  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      
      const file = event.target.files[0]
      if (file.size > 15 * 1024 * 1024) {
        alert("File size exceeds 15MB limit.")
        return
      }

      setUploadingAvatar(true)

      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) return

      const fileExt = file.name.split('.').pop()
      const fileName = `avatar-${effectiveUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })

      const publicUrl = await uploadToR2(renamedFile, 'logos')

      setFormData(prev => ({ ...prev, avatarUrl: publicUrl }))
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: effectiveUserId,
          updates: {
            avatar_url: publicUrl,
          }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)
      updateLocalCache({ avatar_url: publicUrl })
      toast.success("Avatar photo uploaded successfully!")

    } catch (error: any) {
      console.error("Avatar upload error:", error)
      alert('Error uploading avatar photo: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const [uploadingCharacter, setUploadingCharacter] = useState(false)
  const characterInputRef = useRef<HTMLInputElement>(null)

  const handleCharacterUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      
      const file = event.target.files[0]
      if (file.size > 50 * 1024 * 1024) {
        alert("File size exceeds 50MB limit.")
        return
      }

      setUploadingCharacter(true)

      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) return

      const fileExt = file.name.split('.').pop()
      const fileName = `character-${effectiveUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })

      const publicUrl = await uploadToR2(renamedFile, 'logos')

      setFormData(prev => ({ ...prev, characterUrl: publicUrl }))
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: effectiveUserId,
          updates: {
            character_url: publicUrl,
          }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)
      updateLocalCache({ character_url: publicUrl })
      toast.success("Character reference video uploaded successfully!")

    } catch (error: any) {
      console.error("Character upload error:", error)
      alert('Error uploading character video: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingCharacter(false)
    }
  }

  const [uploadingAudio, setUploadingAudio] = useState(false)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      
      const file = event.target.files[0]
      if (file.size > 15 * 1024 * 1024) {
        alert("File size exceeds 15MB limit.")
        return
      }

      setUploadingAudio(true)

      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) return

      const fileExt = file.name.split('.').pop()
      const fileName = `voice-sample-${effectiveUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })

      const publicUrl = await uploadToR2(renamedFile, 'logos')

      setFormData(prev => ({ ...prev, characterAudioUrl: publicUrl }))
      
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: effectiveUserId,
          updates: {
            character_audio_url: publicUrl,
          }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)
      updateLocalCache({ character_audio_url: publicUrl })
      toast.success("Voice sample uploaded successfully!")

    } catch (error: any) {
      console.error("Voice upload error:", error)
      alert('Error uploading voice sample: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingAudio(false)
    }
  }

  const [uploadingAvatarAudio, setUploadingAvatarAudio] = useState(false)
  const avatarAudioInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      
      const file = event.target.files[0]
      if (file.size > 15 * 1024 * 1024) {
        alert("File size exceeds 15MB limit.")
        return
      }

      setUploadingAvatarAudio(true)

      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) return

      const fileExt = file.name.split('.').pop()
      const fileName = `avatar-voice-sample-${effectiveUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })

      const publicUrl = await uploadToR2(renamedFile, 'logos')

      setFormData(prev => ({ ...prev, avatarAudioUrl: publicUrl }))
      
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: effectiveUserId,
          updates: {
            avatar_audio_url: publicUrl,
          }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)
      updateLocalCache({ avatar_audio_url: publicUrl })
      toast.success("Avatar voice sample uploaded successfully!")

    } catch (error: any) {
      console.error("Avatar voice upload error:", error)
      alert('Error uploading avatar voice sample: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingAvatarAudio(false)
    }
  }

  const handleRemoveAsset = async (field: 'logoUrl' | 'avatarUrl' | 'avatarAudioUrl' | 'characterUrl' | 'characterAudioUrl') => {
    try {
      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) return;

      const dbFields = {
        logoUrl: 'logo_url',
        avatarUrl: 'avatar_url',
        avatarAudioUrl: 'avatar_audio_url',
        characterUrl: 'character_url',
        characterAudioUrl: 'character_audio_url'
      };

      const dbFieldName = dbFields[field];

      setFormData(prev => ({ ...prev, [field]: '' }));

      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: effectiveUserId,
          updates: {
            [dbFieldName]: null,
          }
        })
      });
      updateLocalCache({ [dbFieldName]: null });
      toast.success("Asset removed successfully!");
    } catch (error: any) {
      console.error("Remove asset error:", error);
      alert('Error removing asset: ' + (error.message || JSON.stringify(error)));
    }
  }

  const handlePersonalAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      
      const file = event.target.files[0]
      if (file.size > 15 * 1024 * 1024) {
        alert("File size exceeds 15MB limit.")
        return
      }

      setUploadingPersonalAvatar(true)

      const fileExt = file.name.split('.').pop()
      const fileName = `personal-avatar-${userId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })

      const publicUrl = await uploadToR2(renamedFile, 'logos')

      setPersonalAvatarUrl(publicUrl)
      
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          updates: {
            avatar_url: publicUrl,
          }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)
      toast.success("Personal profile photo uploaded successfully!")

    } catch (error: any) {
      console.error("Personal avatar upload error:", error)
      alert('Error uploading photo: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingPersonalAvatar(false)
    }
  }

  const handleSavePersonalDetails = async () => {
    setIsSavingPersonalDetails(true)
    try {
      if (!userId) return

      const updates = {
        full_name: personalFullName
      }

      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          updates
        })
      })
      const resData = await res.json()

      if (resData.error) {
        alert(`Error saving personal details: ${resData.error}`)
      } else {
        toast.success("Personal Details Saved! ✨")
      }
    } catch (e: any) {
      toast.error("Failed to save: " + e.message)
    } finally {
      setIsSavingPersonalDetails(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    const effectiveUserId = targetUserId || userId;
    if (!effectiveUserId) return

    const updates = {
      business_name: formData.businessName,
      mission_statement: formData.mission,
      business_info: formData.businessInfo,
      brand_color: formData.color,
      contact_number: formData.contact,
      address: formData.address,
      logo_url: formData.logoUrl,
      avatar_url: formData.avatarUrl,
      avatar_audio_url: formData.avatarAudioUrl,
      character_url: formData.characterUrl,
      character_audio_url: formData.characterAudioUrl,
      facebook_url: isAdminLike ? formData.facebookUrl : undefined,
      instagram_url: isAdminLike ? formData.instagramUrl : undefined,
      custom_prompt: formData.customPrompt,
      currency: formData.currency,
      whatsapp_personal_number: formData.whatsappPersonalNumber,
      selected_text_llm: selectedTextLlm
    }

    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId: effectiveUserId,
        updates
      })
    })
    const resData = await res.json()

    if (resData.error) {
      alert(`Error saving: ${resData.error}`)
    } else {
      toast.success("Profile Information Saved!")
      updateLocalCache(updates)
    }
    setIsSaving(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400 gap-4">
      <Loader2 className="animate-spin text-slate-300" size={32} />
      <p className="text-sm font-medium animate-pulse">Loading workspace...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">

      {/* FIXED REFRESH BUTTON */}
      <button
        onClick={() => fetchProfile(true)}
        className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
        title="Refresh Profile"
      >
        <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">

        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-8 ml-1">
          {activeSection === 'whatsapp' ? 'WhatsApp Automation' : activeSection === 'voice' ? 'Voice Agent' : activeSection === 'calendar' ? 'Calendar Settings' : activeSection === 'flagged' ? 'Flagged Questions' : activeSection === 'legal' ? 'Terms & Privacy Compliance' : 'Workspace Settings'}
        </h1>

        {activeSection === 'whatsapp' ? (
          <WhatsAppSettings 
            userId={targetUserId || userId || ''} 
            onBack={() => setActiveSection('main')} 
          />
        ) : activeSection === 'voice' ? (
          <VoiceAgentSettings 
            userId={targetUserId || userId || ''} 
            onBack={() => setActiveSection('main')} 
          />
        ) : activeSection === 'calendar' ? (
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200/60 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="bg-red-100 text-red-600 p-3 rounded-2xl">
                  <Calendar size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Calendar & Booking Settings</h2>
                  <p className="text-xs text-slate-500 font-medium">Set slot durations and availability for appointment bookings.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a 
                  href={
                    domainData.domain 
                      ? `https://${domainData.domain}/booking/preview`
                      : `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${targetUserId || userId}/booking/preview`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-red-50 text-red-600 hover:bg-red-100/70 border border-red-150 px-4 py-2 rounded-full text-xs font-extrabold transition-all shadow-sm active:scale-95 flex items-center gap-1.5"
                >
                  <span>Preview Booking Page</span>
                  <ExternalLink size={12} className="stroke-[2.5px]" />
                </a>
                <button 
                  onClick={() => setActiveSection('main')}
                  className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest px-2"
                >
                  Back
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {/* Enable Booking Toggle */}
              <div className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100">
                <div>
                  <h4 className="font-bold text-sm text-slate-800">Enable Slots Booking</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs font-medium">Allow AI Voice and WhatsApp agents to book meetings with leads.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={bookingEnabled} 
                    onChange={(e) => setBookingEnabled(e.target.checked)}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                </label>
              </div>

              {/* Google Calendar Connection Status */}
              <div className="p-6 rounded-3xl border border-slate-150 bg-white/50 backdrop-blur-md space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-red-100 text-red-600 p-2.5 rounded-full">
                      <Plug size={18} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">Google Calendar Sync</h4>
                      <p className="text-xs text-slate-500 font-medium">{isGoogleConnected ? 'Syncing active' : 'Sync schedule to prevent double-booking'}</p>
                    </div>
                  </div>
                  {isGoogleConnected ? (
                    <button 
                      onClick={handleDisconnectGoogle} 
                      disabled={isDisconnectingGoogle} 
                      className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-full font-bold transition-all"
                    >
                      {isDisconnectingGoogle ? '...' : 'Disconnect'}
                    </button>
                  ) : (
                    <button 
                      onClick={handleConnectGoogle} 
                      disabled={isConnectingGoogle} 
                      className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-full text-xs font-bold shadow-sm transition-all"
                    >
                      {isConnectingGoogle ? 'Connecting...' : 'Connect Google'}
                    </button>
                  )}
                </div>

                {isGoogleConnected && (
                  <div className="pt-2 animate-in fade-in slide-in-from-top-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block font-black">Target Calendar</label>
                    {isLoadingCalendars ? (
                      <div className="text-xs text-slate-400 py-2.5 font-medium">Syncing calendar lists...</div>
                    ) : (
                      <select
                        value={googleCalendarId}
                        onChange={(e) => setGoogleCalendarId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-2xl text-xs font-bold outline-none cursor-pointer text-slate-800 focus:border-red-500 transition-all"
                      >
                        <option value="primary">Primary Calendar (Default)</option>
                        {googleCalendars
                          .filter(c => c.id !== 'primary')
                          .map(c => (
                            <option key={c.id} value={c.id}>
                              {c.summary}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Slot Config fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 block mb-2 font-black">Meeting Call Duration</label>
                  <select
                    value={googleBookingDuration}
                    onChange={(e) => setGoogleBookingDuration(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 py-3.5 px-4 rounded-2xl text-xs font-bold outline-none cursor-pointer text-slate-800 focus:border-red-500 transition-all"
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 block mb-2 font-black">Start Hours</label>
                    <input
                      type="time"
                      value={googleBookingStart}
                      onChange={(e) => setGoogleBookingStart(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 py-3 px-3 rounded-2xl text-xs font-bold outline-none text-slate-800 focus:border-red-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 block mb-2 font-black">End Hours</label>
                    <input
                      type="time"
                      value={googleBookingEnd}
                      onChange={(e) => setGoogleBookingEnd(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 py-3 px-3 rounded-2xl text-xs font-bold outline-none text-slate-800 focus:border-red-500 transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button 
              onClick={handleSaveGoogleSettings}
              disabled={isSavingGoogleSettings}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm py-4 rounded-[1.5rem] sm:rounded-full shadow-lg shadow-slate-950/10 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
            >
              {isSavingGoogleSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {isSavingGoogleSettings ? 'Saving...' : 'Save Calendar Settings'}
            </button>
          </div>
        ) : activeSection === 'legal' ? (
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200/60 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="bg-red-100 text-red-600 p-3 rounded-2xl">
                  <Shield size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Legal Agreements</h2>
                  <p className="text-xs text-slate-500 font-medium">Review and agree to the latest compliance agreements.</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveSection('main')}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest px-2"
              >
                Back
              </button>
            </div>

            <div className="space-y-6">
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="font-bold text-sm text-slate-800">Compliance & Privacy Consent</h3>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  By accepting these terms, you acknowledge and agree that Nobogent AI relies on third-party services (Meta, Twilio, and ElevenLabs). Any ad campaign spend will be billed directly to you by Meta Platforms, and virtual phone number calls are subject to standard telecom compliance guidelines. Please review our full policies for details.
                </p>
                <div className="flex gap-4 text-xs font-bold text-blue-600">
                  <a href="/terms-and-conditions" target="_blank" className="hover:underline">Terms & Conditions</a>
                  <span>•</span>
                  <a href="/privacy-policy" target="_blank" className="hover:underline">Privacy Policy</a>
                </div>
              </div>

              <div className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="pr-4">
                  <h4 className="font-bold text-sm text-slate-800">I Accept the Agreements</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs font-medium">I accept the Terms & Conditions and Privacy Policy for using Nobogent AI.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input 
                    type="checkbox" 
                    checked={acceptedTerms} 
                    onChange={async (e) => {
                      const val = e.target.checked;
                      setAcceptedTerms(val);
                      try {
                        const effectiveUserId = targetUserId || userId;
                        const res = await fetch('/api/profile/update', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            targetUserId: effectiveUserId,
                            updates: { accepted_terms: val }
                          })
                        });
                        const resData = await res.json();
                        if (resData.error) throw new Error(resData.error);
                        
                        updateLocalCache({ accepted_terms: val });
                        toast.success("Legal agreement preference updated!");
                      } catch (err: any) {
                        toast.error("Failed to update agreement: " + err.message);
                      }
                    }}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>
        ) : activeSection === 'flagged' ? (
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200/60 max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="bg-amber-100 text-amber-600 p-3 rounded-2xl">
                  <AlertCircle size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Flagged Questions</h2>
                  <p className="text-xs text-slate-500 font-medium">Questions the AI could not answer. Update your Business Info context with these answers to train the AI.</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveSection('main')}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
              >
                Back
              </button>
            </div>

            {loadingFlagged ? (
              <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-slate-300" /></div>
            ) : flaggedQuestions.length === 0 ? (
              <div className="text-center py-16 space-y-4">
                <div className="bg-slate-50 text-slate-400 p-4 rounded-full inline-block">
                  <CheckCircle size={32} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">All Questions Resolved!</h4>
                  <p className="text-xs text-slate-500 mt-1">Your AI bot has been answering everything successfully.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {flaggedQuestions.map((fq) => (
                  <div key={fq.id} className="p-5 bg-slate-50 border border-slate-100 rounded-3xl space-y-3 shadow-sm transition-all hover:bg-slate-50/80">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1">
                        <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          {fq.channel === 'whatsapp' ? (
                            <>
                              <MessageCircle size={10} className="text-emerald-500" /> WhatsApp
                            </>
                          ) : (
                            <>
                              <Phone size={10} className="text-indigo-500" /> Voice Call
                            </>
                          )}
                          • {new Date(fq.created_at).toLocaleDateString()}
                        </span>
                        <h4 className="text-sm font-semibold text-slate-800">"{fq.question}"</h4>

                        {/* Lead / Prospect Context */}
                        {(() => {
                          const lead = Array.isArray(fq.leads) ? fq.leads[0] : fq.leads;
                          if (!lead) return null;
                          const property = Array.isArray(lead.properties) ? lead.properties[0] : lead.properties;
                          return (
                            <div className="bg-slate-100/60 rounded-2xl p-3 mt-2 text-xs text-slate-600 space-y-1 font-medium border border-slate-200/20 max-w-xl">
                              <div>
                                <span className="font-bold text-slate-500 uppercase tracking-wider text-[9px] mr-1">Prospect:</span>
                                <span className="text-slate-800 font-semibold">{lead.name || 'Unknown'}</span>
                                {lead.phone && <span className="text-slate-500 ml-1">({lead.phone})</span>}
                                {lead.email && <span className="text-slate-500 ml-1.5">• {lead.email}</span>}
                              </div>
                              {property && property.title && (
                                <div>
                                  <span className="font-bold text-slate-500 uppercase tracking-wider text-[9px] mr-1">Interested Product:</span>
                                  <span className="text-indigo-600 font-bold">{property.title}</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Audio Call Recording */}
                        {(() => {
                          const lead = Array.isArray(fq.leads) ? fq.leads[0] : fq.leads;
                          if (lead && lead.voice_recording_url) {
                            return (
                              <div className="mt-2.5 pt-2 pb-1 bg-indigo-50/40 rounded-2xl p-3 border border-indigo-100/30 max-w-xl">
                                <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1 flex items-center gap-1.5 font-sans">
                                  <Mic size={10} className="text-indigo-600 animate-pulse" /> Listen to Call Recording
                                </span>
                                <audio 
                                  controls 
                                  src={lead.voice_recording_url} 
                                  className="w-full h-8 outline-none rounded-lg" 
                                />
                              </div>
                            );
                          }
                          return null;
                        })()}

                        <div className="flex flex-wrap gap-2 items-center mt-2">
                          {fq.language ? (
                            <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-200/50">
                              Language: <span className="text-slate-800 font-extrabold">{fq.language}</span>
                            </span>
                          ) : (
                            <span className="bg-slate-50 text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-200/30 flex items-center gap-1.5">
                              <Loader2 size={10} className="animate-spin text-slate-300" /> Detecting language...
                            </span>
                          )}
                          {fq.translation && fq.translation !== fq.question && (
                            <span className="bg-indigo-50 text-indigo-600 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-100/80">
                              Translation: <span className="text-indigo-900 font-medium">"{fq.translation}"</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/questions/resolve', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ questionId: fq.id })
                            })
                            const resData = await res.json()
                            if (res.ok && resData.success) {
                              toast.success("Question dismissed")
                              fetchFlaggedQuestions(targetUserId || userId || '')
                            } else {
                              throw new Error(resData.error || 'Failed to dismiss')
                            }
                          } catch (err: any) {
                            toast.error(err.message || "Failed to dismiss")
                          }
                        }}
                        className="text-[10px] bg-white border border-slate-200 text-slate-500 hover:text-slate-700 font-bold px-3 py-1.5 rounded-full active:scale-95 transition-all shadow-xs"
                      >
                        Dismiss
                      </button>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex gap-2">
                      <button
                        onClick={async () => {
                          const answer = prompt(`Write your answer for: "${fq.question}"\n\nThis answer will be appended to your Business Info (AI Context) and a callback will be triggered immediately.`);
                          if (answer) {
                            try {
                              const res = await fetch('/api/questions/resolve', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ questionId: fq.id, answer })
                              });
                              const data = await res.json();
                              if (res.ok && data.success) {
                                toast.success("Question resolved and outbound call triggered! 📞");
                                fetchFlaggedQuestions(targetUserId || userId || '');
                                
                                // Update local form and cache
                                const updatedInfo = `${formData.businessInfo}\n\nQ: ${fq.question}\nA: ${answer}`;
                                setFormData(prev => ({ ...prev, businessInfo: updatedInfo }));
                                updateLocalCache({ business_info: updatedInfo });
                              } else {
                                throw new Error(data.error || 'Failed to resolve flagged question');
                              }
                            } catch (err: any) {
                              toast.error(err.message || 'An error occurred while resolving question');
                            }
                          }
                        }}
                        className="text-[10px] bg-purple-50 text-purple-600 hover:bg-purple-100 font-bold px-3 py-1.5 rounded-full active:scale-95 transition-all flex items-center gap-1.5"
                      >
                        <Sparkles size={11} /> Save Answer to AI Context
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

          <div className="lg:col-span-7 space-y-6">

            {/* Nobo Credits Balance Card */}
            <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white rounded-[2rem] p-6 shadow-md relative overflow-hidden flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_50%)]" />
              <div className="relative z-10 flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-2xl border border-white/10">
                  <Coins size={22} className="text-yellow-300" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest block">Nobo Credits Balance</span>
                  <h3 className="text-2xl font-black tracking-tight mt-0.5">
                    {(['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com'].includes(formData.email)) ? '∞' : `${credits.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Credits`}
                  </h3>
                </div>
              </div>
              <div className="relative z-10 flex gap-3 w-full sm:w-auto shrink-0 mt-3 sm:mt-0">
                <button
                  onClick={() => router.push('/dashboard/usage')}
                  className="w-full sm:w-auto text-center px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-xs font-bold text-white transition-all active:scale-95 cursor-pointer shadow-sm"
                >
                  View Ledger
                </button>
                <button
                  onClick={() => router.push('/dashboard/billing')}
                  className="w-full sm:w-auto text-center px-4 py-2 bg-white text-indigo-600 hover:bg-indigo-50 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
                >
                  Buy Packages
                </button>
              </div>
            </div>

            {/* Header Identity Card */}
            <div className="bg-white rounded-[2rem] p-8 sm:p-10 shadow-sm border border-slate-200/60 flex flex-col gap-8 transition-all hover:shadow-md">
              <div className="flex flex-col sm:flex-row items-start justify-between gap-6 pb-6 border-b border-slate-100">
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    {formData.businessName || (isAdminLike ? 'Your Business' : 'Your Name')}
                  </h2>
                  <p className="text-slate-500 text-sm leading-relaxed max-w-xl">
                    Personalize your workspace branding, presenter profiles, and voice assets. Branding set here reflects on your landing pages and generated creatives.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {authUserName && authRole === 'agent' && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full border border-blue-100">
                        <Shield size={14} />
                        <span className="text-[11px] font-bold uppercase tracking-wider">Logged in as: {authUserName}</span>
                      </div>
                    )}
                    {formData.industry && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">
                        <Sparkles size={14} className="text-indigo-500" />
                        <span className="text-[11px] font-bold uppercase tracking-wider">Industry: {formData.industry.replace(/_/g, ' ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {authRole !== 'agent' && (
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Workspace & Presenter Assets</h3>
                  <div className="flex flex-wrap gap-4 items-center justify-start">
                    {/* Logo Upload */}
                    <div
                      onClick={() => !uploadingLogo && !formData.logoUrl && fileInputRef.current?.click()}
                      className="w-24 h-24 bg-slate-50/80 rounded-full flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 transition-all shadow-sm"
                      title="Upload Brand Logo"
                    >
                      {uploadingLogo ? (
                        <Loader2 className="animate-spin text-slate-400" size={24} />
                      ) : formData.logoUrl ? (
                        <div className="relative w-full h-full group">
                          <img src={formData.logoUrl} alt="Logo" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity gap-2 bg-black/40">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                              className="bg-white/95 p-1.5 rounded-full text-slate-700 hover:text-blue-600 hover:scale-105 transition-all shadow-md"
                              title="Change Logo"
                            >
                              <Upload size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveAsset('logoUrl'); }}
                              className="bg-red-500/95 p-1.5 rounded-full text-white hover:bg-red-600 hover:scale-105 transition-all shadow-md"
                              title="Remove Logo"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-blue-500 transition-colors">
                          <Upload size={20} />
                          <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Logo</span>
                        </div>
                      )}
                      <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
                    </div>

                    {/* Avatar Photo Upload */}
                    <div
                      onClick={() => !uploadingAvatar && !formData.avatarUrl && avatarInputRef.current?.click()}
                      className="w-24 h-24 bg-slate-50/80 rounded-[1.25rem] flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50 transition-all shadow-sm"
                      title="Upload Static Avatar Photo"
                    >
                      {uploadingAvatar ? (
                        <div className="flex flex-col items-center justify-center p-2 text-center">
                          <Loader2 className="animate-spin text-indigo-600 mb-1" size={20} />
                          <span className="text-[8px] font-black text-slate-400">Uploading...</span>
                        </div>
                      ) : formData.avatarUrl ? (
                        <div className="relative w-full h-full group">
                          <img src={formData.avatarUrl} alt="Avatar" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity gap-2 bg-black/40">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); avatarInputRef.current?.click(); }}
                              className="bg-white/95 p-1.5 rounded-full text-slate-700 hover:text-indigo-600 hover:scale-105 transition-all shadow-md"
                              title="Change Avatar"
                            >
                              <Upload size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveAsset('avatarUrl'); }}
                              className="bg-red-500/95 p-1.5 rounded-full text-white hover:bg-red-600 hover:scale-105 transition-all shadow-md"
                              title="Remove Avatar"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-indigo-500 transition-colors">
                          <User size={20} />
                          <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Avatar</span>
                        </div>
                      )}
                      <input type="file" ref={avatarInputRef} onChange={handleAvatarUpload} accept="image/*" className="hidden" />
                    </div>

                    {/* Avatar Voice Audio Upload */}
                    <div
                      onClick={() => !uploadingAvatarAudio && !formData.avatarAudioUrl && avatarAudioInputRef.current?.click()}
                      className="w-24 h-24 bg-slate-50/80 rounded-[1.25rem] flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50 transition-all shadow-sm"
                      title="Upload Avatar Voice Sample (Upto 15s MP3/WAV)"
                    >
                      {uploadingAvatarAudio ? (
                        <div className="flex flex-col items-center justify-center p-2 text-center animate-pulse">
                          <Loader2 className="animate-spin text-indigo-600 mb-1" size={20} />
                          <span className="text-[8px] font-black text-slate-400">Uploading...</span>
                        </div>
                      ) : formData.avatarAudioUrl ? (
                        <div className="flex flex-col items-center gap-1.5 p-3 text-center text-indigo-600 bg-indigo-50/30 w-full h-full justify-center relative group">
                          <Mic size={24} className="animate-bounce" />
                          <span className="text-[8px] font-black uppercase tracking-wider leading-none">Voice (Avatar)</span>
                          <span className="text-[7px] text-slate-400 truncate max-w-full">
                            {formData.avatarAudioUrl.split('/').pop()?.slice(-15)}
                          </span>
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity gap-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); avatarAudioInputRef.current?.click(); }}
                              className="bg-white/95 p-1.5 rounded-full text-slate-700 hover:text-indigo-600 hover:scale-105 transition-all shadow-md"
                              title="Change Voice"
                            >
                              <Upload size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveAsset('avatarAudioUrl'); }}
                              className="bg-red-500/95 p-1.5 rounded-full text-white hover:bg-red-600 hover:scale-105 transition-all shadow-md"
                              title="Remove Voice"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-indigo-500 transition-colors">
                          <Mic size={20} />
                          <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Voice (Avatar)</span>
                        </div>
                      )}
                      <input type="file" ref={avatarAudioInputRef} onChange={handleAvatarAudioUpload} accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav" className="hidden" />
                    </div>

                    {/* Character Upload */}
                    <div
                      onClick={() => !uploadingCharacter && !formData.characterUrl && characterInputRef.current?.click()}
                      className="w-24 h-24 bg-slate-50/80 rounded-[1.25rem] flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-purple-500 hover:bg-purple-50 transition-all shadow-sm"
                      title="Upload Custom Video Character Reference"
                    >
                      {uploadingCharacter ? (
                        <div className="flex flex-col items-center justify-center p-2 text-center">
                          <Loader2 className="animate-spin text-purple-600 mb-1" size={20} />
                          <span className="text-[8px] font-black text-slate-400">Uploading...</span>
                        </div>
                      ) : formData.characterUrl ? (
                        <div className="relative w-full h-full group">
                          {(/\.(mp4|webm)/i.test(formData.characterUrl) || formData.characterUrl.includes('video')) ? (
                            <video src={formData.characterUrl} muted loop playsInline autoPlay className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                          ) : (
                            <img src={formData.characterUrl} alt="Character" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                          )}
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity gap-2 bg-black/40">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); characterInputRef.current?.click(); }}
                              className="bg-white/95 p-1.5 rounded-full text-slate-700 hover:text-purple-600 hover:scale-105 transition-all shadow-md"
                              title="Change Video"
                            >
                              <Upload size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveAsset('characterUrl'); }}
                              className="bg-red-500/95 p-1.5 rounded-full text-white hover:bg-red-600 hover:scale-105 transition-all shadow-md"
                              title="Remove Video"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-purple-500 transition-colors">
                          <Video size={20} />
                          <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Video (Ref)</span>
                        </div>
                      )}
                      <input type="file" ref={characterInputRef} onChange={handleCharacterUpload} accept="video/*" className="hidden" />
                    </div>
 
                    {/* Voice Audio Upload */}
                    <div
                      onClick={() => !uploadingAudio && !formData.characterAudioUrl && audioInputRef.current?.click()}
                      className="w-24 h-24 bg-slate-50/80 rounded-[1.25rem] flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 transition-all shadow-sm"
                      title="Upload Video Voice Sample (Upto 15s MP3/WAV)"
                    >
                      {uploadingAudio ? (
                        <div className="flex flex-col items-center justify-center p-2 text-center animate-pulse">
                          <Loader2 className="animate-spin text-emerald-600 mb-1" size={20} />
                          <span className="text-[8px] font-black text-slate-400">Uploading...</span>
                        </div>
                      ) : formData.characterAudioUrl ? (
                        <div className="flex flex-col items-center gap-1.5 p-3 text-center text-emerald-600 bg-emerald-50/30 w-full h-full justify-center relative group">
                          <Mic size={24} className="animate-bounce" />
                          <span className="text-[8px] font-black uppercase tracking-wider leading-none">Voice (Video)</span>
                          <span className="text-[7px] text-slate-400 truncate max-w-full">
                            {formData.characterAudioUrl.split('/').pop()?.slice(-15)}
                          </span>
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity gap-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); audioInputRef.current?.click(); }}
                              className="bg-white/95 p-1.5 rounded-full text-slate-700 hover:text-emerald-600 hover:scale-105 transition-all shadow-md"
                              title="Change Voice"
                            >
                              <Upload size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveAsset('characterAudioUrl'); }}
                              className="bg-red-500/95 p-1.5 rounded-full text-white hover:bg-red-600 hover:scale-105 transition-all shadow-md"
                              title="Remove Voice"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-emerald-500 transition-colors">
                          <Mic size={20} />
                          <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Voice (Video)</span>
                        </div>
                      )}
                      <input type="file" ref={audioInputRef} onChange={handleAudioUpload} accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav" className="hidden" />
                    </div>
                  </div>
                </div>
              )}
                    </div>

            {/* Personal Profile Details Card */}
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-200/60 space-y-6 transition-all hover:shadow-md">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-2">
                <div className="bg-indigo-100 text-indigo-600 p-2.5 rounded-full">
                  <User size={20} />
                </div>
                <h3 className="font-bold text-lg text-slate-800">Personal Profile Details</h3>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* Personal Photo Upload */}
                <div
                  onClick={() => !uploadingPersonalAvatar && personalAvatarInputRef.current?.click()}
                  className="w-24 h-24 bg-slate-50/80 rounded-full flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50 transition-all shadow-sm"
                  title="Upload Profile Photo"
                >
                  {uploadingPersonalAvatar ? (
                    <div className="flex flex-col items-center justify-center p-2 text-center">
                      <Loader2 className="animate-spin text-indigo-600 mb-1" size={20} />
                      <span className="text-[8px] font-black text-slate-400">Uploading...</span>
                    </div>
                  ) : personalAvatarUrl ? (
                    <div className="relative w-full h-full group">
                      <img src={personalAvatarUrl} alt="Avatar" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 gap-2">
                        <button
                          type="button"
                          className="bg-white/95 p-1.5 rounded-full text-slate-700 hover:text-indigo-600 shadow-md"
                          onClick={(e) => { e.stopPropagation(); personalAvatarInputRef.current?.click(); }}
                        >
                          <Upload size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-indigo-500 transition-colors">
                      <Upload size={20} />
                      <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Photo</span>
                    </div>
                  )}
                  <input type="file" ref={personalAvatarInputRef} onChange={handlePersonalAvatarUpload} accept="image/*" className="hidden" />
                </div>

                <div className="flex-1 w-full space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Your Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. John Doe"
                      value={personalFullName}
                      onChange={(e) => setPersonalFullName(e.target.value)}
                      className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-indigo-500/20 outline-none border border-slate-200/60 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <button
                    onClick={handleSavePersonalDetails}
                    disabled={isSavingPersonalDetails}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 px-5 rounded-full transition-all shadow-sm active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSavingPersonalDetails ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save Personal Details
                  </button>
                </div>
              </div>
            </div>

            {/* Business Profile Form Card */}
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-200/60 space-y-6 transition-all hover:shadow-md">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-2">
                <div className="bg-blue-100 text-blue-600 p-2.5 rounded-full">
                  <FileText size={20} />
                </div>
                <h3 className="font-bold text-lg text-slate-800">Profile Details</h3>
              </div>

              <div className="space-y-5">
                {authRole === 'agent' && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-2xl text-xs font-bold leading-relaxed mb-2">
                    ⚠️ You are viewing your Agency's profile branding. Editing profile details is disabled for Agent accounts.
                  </div>
                )}

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">
                    {isAdminLike ? 'Business Name' : 'Full Name'}
                  </label>
                  <input
                    type="text"
                    value={formData.businessName}
                    onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Business Currency</label>
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-bold focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    <option value="INR">INR (₹) - Indian Rupee</option>
                    <option value="CAD">CAD ($) - Canadian Dollar</option>
                    <option value="USD">USD ($) - US Dollar</option>
                    <option value="GBP">GBP (£) - British Pound</option>
                    <option value="EUR">EUR (€) - Euro</option>
                    <option value="AED">AED (د.إ) - UAE Dirham</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Contact Number</label>
                  <input
                    type="tel"
                    value={formData.contact}
                    onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <MessageCircle size={14} className="text-[#25D366]" />
                      WhatsApp Number (for AI Bot)
                    </span>
                  </label>
                  <input
                    type="tel"
                    value={formData.whatsappPersonalNumber}
                    onChange={(e) => setFormData({ ...formData, whatsappPersonalNumber: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="e.g. +91 82888 35235"
                  />
                  <p className="text-[10px] text-slate-400 font-medium mt-1.5 ml-2">Messages from this number to your WABA will get AI-powered responses with your account data.</p>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="Enter business address to show on your public catalog"
                  />
                </div>

                {isAdminLike && (
                  <div className="pt-4 mt-2">
                    <label className="text-xs font-bold text-slate-500 ml-2 block mb-3 uppercase tracking-wider">Public Social Links</label>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-[#1877F2]/10 text-[#1877F2] p-3 rounded-2xl shrink-0">
                          <Facebook size={20} />
                        </div>
                        <input
                          type="text"
                          placeholder="https://facebook.com/..."
                          value={formData.facebookUrl}
                          onChange={(e) => setFormData({ ...formData, facebookUrl: e.target.value })}
                          disabled={authRole === 'agent'}
                          className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="bg-[#E1306C]/10 text-[#E1306C] p-3 rounded-2xl shrink-0">
                          <Instagram size={20} />
                        </div>
                        <input
                          type="text"
                          placeholder="https://instagram.com/..."
                          value={formData.instagramUrl}
                          onChange={(e) => setFormData({ ...formData, instagramUrl: e.target.value })}
                          disabled={authRole === 'agent'}
                          className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 mt-2 uppercase tracking-wider">Business Description (Shown on Catalogue Page)</label>
                  <textarea
                    rows={3}
                    value={formData.mission}
                    onChange={(e) => setFormData({ ...formData, mission: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 px-5 rounded-3xl text-slate-800 text-sm font-medium resize-none focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="Provide a description about your business to showcase on your public catalog..."
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-purple-600 ml-2 block mb-2 mt-2 uppercase tracking-wider flex items-center gap-2">
                    <Target size={14} /> Business Info (AI Context)
                  </label>
                  <textarea
                    rows={4}
                    value={formData.businessInfo}
                    onChange={(e) => setFormData({ ...formData, businessInfo: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-purple-50/30 hover:bg-purple-50/50 focus:bg-white py-4 px-5 rounded-3xl text-slate-800 text-sm font-medium resize-none focus:ring-4 focus:ring-blue-500/20 outline-none border border-purple-200 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="Provide full context about your business, target audience, pricing models, and key selling propositions. This information is fetched by the LLMs to write highly relevant ad scripts."
                  />
                  <p className="text-[10px] text-slate-400 mt-2 ml-3 font-medium">
                    This private context is exclusively used by AI models to write personalized concepts and dialogue scripts.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-bold text-blue-600 ml-2 block mb-2 mt-2 uppercase tracking-wider flex items-center gap-2">
                    <Target size={14} /> Custom Image/Video Generation Prompt
                  </label>
                  <textarea
                    rows={4}
                    value={formData.customPrompt}
                    onChange={(e) => setFormData({ ...formData, customPrompt: e.target.value })}
                    disabled={authRole === 'agent'}
                    className="w-full bg-blue-50/30 hover:bg-blue-50/50 focus:bg-white py-4 px-5 rounded-3xl text-slate-800 text-sm font-medium resize-none focus:ring-4 focus:ring-blue-500/20 outline-none border border-blue-200 focus:border-blue-400 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="e.g. 'Cinematic lighting, hyper-realistic, professional photography style, vibrant colors...'"
                  />
                  <p className="text-[10px] text-slate-400 mt-2 ml-3 font-medium">
                    This detailed style guide will be prioritized in all AI creative generations.
                  </p>
                </div>
 
                {/* Super Admin Model Toggle */}
                {(authRole === 'super_admin' || role === 'super_admin') && (
                  <div className="pt-4 border-t border-slate-100 mt-4 space-y-4">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-150">
                      <div>
                        <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                          <Sparkles size={16} className="text-blue-600" />
                          Super Admin: Default Text LLM Model
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm font-medium">
                          Switch between Gemini 3.5 Flash and DeepSeek v4-flash for all text-only tasks.
                        </p>
                      </div>
                      <div className="flex bg-slate-200 p-1 rounded-xl shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedTextLlm('gemini')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
                            selectedTextLlm === 'gemini' 
                              ? 'bg-blue-600 text-white shadow-sm' 
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Gemini 3.5 Flash
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedTextLlm('deepseek')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
                            selectedTextLlm === 'deepseek' 
                              ? 'bg-blue-600 text-white shadow-sm' 
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          DeepSeek v4-flash
                        </button>
                      </div>
                    </div>
                  </div>
                )}
 
                {/* Custom Domains Section */}
                {isAdminLike && (
                  <div className="space-y-4 pt-4 border-t border-slate-100 mt-4">
                    <DomainManager
                      initialDomain={domainData.domain}
                      verifyToken={domainData.token}
                      verifyStatus={domainData.status}
                      userId={targetUserId || userId}
                      onDomainUpdate={() => fetchProfile(true)}
                      type="catalogue"
                      label="Custom Landing Page Domain"
                    />

                    {role === 'agency' && (
                      <DomainManager
                        initialDomain={whitelabelDomainData.domain}
                        verifyToken={whitelabelDomainData.token}
                        verifyStatus={whitelabelDomainData.status}
                        userId={targetUserId || userId}
                        onDomainUpdate={() => fetchProfile(true)}
                        type="platform"
                        label="White-Label Platform Domain (Agency Only)"
                      />
                    )}
                  </div>
                )}
              </div>

              {authRole !== 'agent' && (
                <button
                  onClick={handleSave}
                  disabled={isSaving || uploadingLogo}
                  className="w-full mt-6 bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] sm:rounded-full text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-70 disabled:scale-100"
                >
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {isSaving ? 'Saving Changes...' : 'Save Profile Details'}
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-[2rem] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              <PushManager variant="inline" ownerId={targetUserId || userId || undefined} />
            </div>

            {/* Email Notification Settings Card */}
            {isAdminLike && authRole !== 'agent' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md">
                <div className="p-6 sm:p-7 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="bg-blue-100 text-blue-600 p-3 rounded-full shadow-md shadow-blue-500/5">
                        <Mail size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-slate-900">Email Reports</h4>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          Daily summaries of your operations
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div className="pr-4">
                      <span className="text-xs font-bold text-slate-700 block">Daily EOD Report Email</span>
                      <span className="text-[10px] text-slate-400 font-medium">Send daily EOD metrics and leads analysis.</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input 
                        type="checkbox" 
                        checked={enableEodReport} 
                        onChange={async (e) => {
                          const val = e.target.checked
                          setEnableEodReport(val)
                          try {
                            const { error } = await supabase
                              .from('profiles')
                              .update({ enable_eod_report: val })
                              .eq('id', targetUserId || userId)
                            if (error) throw error
                            updateLocalCache({ enable_eod_report: val })
                            toast.success("EOD report settings updated!")
                          } catch (err: any) {
                            toast.error("Failed to save settings: " + err.message)
                          }
                        }}
                        className="sr-only peer" 
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {isAdminLike && authRole !== 'agent' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md">
                <div className="p-6 sm:p-7">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3.5">
                      <div className="bg-[#1877F2] p-3 rounded-full text-white shadow-md shadow-[#1877F2]/20">
                        <Facebook size={20} fill="white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-slate-900">Meta Integrations</h4>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          {isFacebookConnected ? 'Connected & Active' : 'Link ad accounts & pages'}
                        </p>
                      </div>
                    </div>
                    {isFacebookConnected ? (
                      <button onClick={handleDisconnectFacebook} disabled={isDisconnecting} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-full font-bold transition-colors">
                        {isDisconnecting ? '...' : 'Unlink'}
                      </button>
                    ) : (
                      <button
                        onClick={handleConnectFacebook}
                        disabled={isConnectingFb}
                        className="bg-[#1877F2] hover:bg-[#166FE5] text-white px-5 py-2 rounded-full text-xs font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isConnectingFb ? <Loader2 size={14} className="animate-spin" /> : null}
                        {isConnectingFb ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>

                  {isFacebookConnected && (
                    <div className="space-y-4 pt-4 border-t border-slate-100 mt-2">
                      <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-100">
                        <div className="flex justify-between items-center mb-3 px-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Linked Page</label>
                          <button onClick={fetchPages} className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-colors">Refresh List</button>
                        </div>
                        {isLoadingPages ? (
                          <div className="flex items-center gap-2 text-xs text-slate-500 py-3 px-2 font-medium">
                            <Loader2 size={16} className="animate-spin text-blue-500" /> Syncing pages...
                          </div>
                        ) : fbPages.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {fbPages.map(page => (
                              <button key={page.id} onClick={() => handlePageSelect(page.id)} className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${selectedPageId === page.id ? 'bg-white shadow-sm border border-blue-200 ring-2 ring-blue-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}>
                                <div className="flex flex-col truncate pr-3">
                                  <span className={`text-sm font-bold truncate ${selectedPageId === page.id ? 'text-blue-900' : 'text-slate-600'}`}>{page.name}</span>
                                  <span className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {page.id}</span>
                                </div>
                                {selectedPageId === page.id && <CheckCircle size={18} className="text-blue-600 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="py-3 px-2">
                            <p className="text-sm text-slate-500 mb-2 font-medium">No pages found.</p>
                            <button onClick={handleConnectFacebook} className="text-xs text-blue-600 font-bold hover:underline">Update Permissions</button>
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-100">
                        <div className="flex justify-between items-center mb-3 px-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ad Account</label>
                          <button onClick={() => facebookToken && fetchAdAccounts(facebookToken)} className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-colors">Refresh List</button>
                        </div>
                        {isLoadingAdAccounts ? (
                          <div className="flex items-center gap-2 text-xs text-slate-500 py-3 px-2 font-medium">
                            <Loader2 size={16} className="animate-spin text-blue-500" /> Syncing accounts...
                          </div>
                        ) : adAccounts.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {adAccounts.map(account => (
                              <button key={account.id} onClick={() => handleAdAccountSelect(account.id)} className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${selectedAdAccountId === account.id ? 'bg-white shadow-sm border border-emerald-200 ring-2 ring-emerald-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}>
                                <div className="flex flex-col truncate pr-3">
                                  <span className={`text-sm font-bold truncate ${selectedAdAccountId === account.id ? 'text-emerald-900' : 'text-slate-600'}`}>{account.name}</span>
                                  <span className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {account.id}</span>
                                </div>
                                {selectedAdAccountId === account.id && <CheckCircle size={18} className="text-emerald-600 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="py-3 px-2">
                            <p className="text-sm text-slate-500 mb-2 font-medium">No Ad Accounts found.</p>
                            <button onClick={handleConnectFacebook} className="text-xs text-blue-600 font-bold hover:underline">Update Permissions</button>
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-100">
                        <div className="flex justify-between items-center mb-3 px-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data Pixel</label>
                          <div className="flex items-center gap-3">
                            {selectedAdAccountId && (
                              <button 
                                onClick={handleCreatePixel} 
                                disabled={isCreatingPixel}
                                className="text-[10px] text-purple-600 hover:text-purple-700 font-bold uppercase tracking-wider transition-all disabled:opacity-50 flex items-center gap-1 active:scale-95"
                              >
                                {isCreatingPixel ? (
                                  <>
                                    <Loader2 size={10} className="animate-spin text-purple-600" /> Creating...
                                  </>
                                ) : (
                                  <>
                                    <Plus size={12} className="text-purple-600" /> Auto-Create Pixel
                                  </>
                                )}
                              </button>
                            )}
                            <button onClick={() => selectedAdAccountId && fetchPixels(selectedAdAccountId)} className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-colors">Refresh List</button>
                          </div>
                        </div>

                        {!selectedAdAccountId ? (
                          <div className="py-3 px-2"><p className="text-sm text-slate-500 font-medium">Select an Ad Account first.</p></div>
                        ) : isLoadingPixels ? (
                          <div className="flex items-center gap-2 text-xs text-slate-500 py-3 px-2 font-medium">
                            <Loader2 size={16} className="animate-spin text-blue-500" /> Searching pixels...
                          </div>
                        ) : pixels.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {pixels.map(pixel => (
                              <button key={pixel.id} onClick={() => handlePixelSelect(pixel.id)} className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${selectedPixelId === pixel.id ? 'bg-white shadow-sm border border-purple-200 ring-2 ring-purple-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}>
                                <div className="flex items-center gap-3 truncate pr-3">
                                  <Target size={16} className={selectedPixelId === pixel.id ? 'text-purple-600 shrink-0' : 'text-slate-400 shrink-0'} />
                                  <div className="flex flex-col truncate">
                                    <span className={`text-sm font-bold truncate ${selectedPixelId === pixel.id ? 'text-purple-900' : 'text-slate-600'}`}>{pixel.name}</span>
                                    <span className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {pixel.id}</span>
                                  </div>
                                </div>
                                {selectedPixelId === pixel.id && <CheckCircle size={18} className="text-purple-600 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="py-3 px-2"><p className="text-sm text-slate-500 font-medium">No Pixels found for this account.</p></div>
                        )}
                      </div>

                      {/* Custom Audiences Management */}
                      <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-100 mt-4">
                        <div className="flex justify-between items-center mb-2 px-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Custom Audiences</label>
                        </div>
                        <div className="py-2 px-1 flex flex-col gap-3 text-left">
                          <p className="text-xs text-slate-500 leading-relaxed font-medium">
                            Create, upload, and manage custom audience segments directly inside Meta Ads Manager.
                          </p>
                          <button
                            onClick={() => router.push(`/dashboard/profile/audiences${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
                            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3 px-5 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-sm"
                          >
                            <Users size={14} /> Manage Custom Audiences
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {false && isAdminLike && authRole !== 'agent' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md mb-6">
                <div className="p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="bg-[#0A66C2] p-3 rounded-full text-white shadow-md shadow-[#0A66C2]/20">
                        <Linkedin size={20} fill="white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-slate-900">LinkedIn Integration</h4>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          {isLinkedinConnected ? `Connected as ${linkedinName}` : 'Share professional updates'}
                        </p>
                      </div>
                    </div>
                    {isLinkedinConnected ? (
                      <button onClick={handleDisconnectLinkedin} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-full font-bold transition-colors">
                        Unlink
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnectLinkedin('personal')}
                        disabled={isConnectingLinkedin}
                        className="bg-[#0A66C2] hover:bg-[#084d91] text-white px-5 py-2 rounded-full text-xs font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isConnectingLinkedin ? <Loader2 size={14} className="animate-spin" /> : null}
                        {isConnectingLinkedin ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>

                  {isLinkedinConnected && (
                    <>
                      {linkedinScopeWarning ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-4 text-amber-800 text-xs font-medium space-y-2.5">
                          <p className="leading-relaxed">To post to your LinkedIn company pages, you need to reconnect LinkedIn to grant page administrator permissions.</p>
                          <button onClick={() => handleConnectLinkedin('company')} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl transition-all shadow-sm active:scale-95">
                            Reconnect LinkedIn (Company Pages)
                          </button>
                        </div>
                      ) : (
                        <div className="border-t border-slate-100 mt-5 pt-5">
                          <div className="flex justify-between items-center mb-3 px-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Posting Destination</label>
                            <div className="flex items-center gap-3">
                              <button onClick={() => handleConnectLinkedin('company')} className="text-[10px] text-purple-600 hover:text-[#084d91] font-bold uppercase tracking-wider transition-colors">Link Company Pages</button>
                              <button onClick={fetchLinkedinPages} className="text-[10px] text-[#0A66C2] hover:text-[#084d91] font-bold uppercase tracking-wider transition-colors">Refresh List</button>
                            </div>
                          </div>

                          {isLoadingLinkedinPages ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500 py-3 px-2 font-medium">
                              <Loader2 size={16} className="animate-spin text-[#0A66C2]" /> Loading destinations...
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                              {/* Option 1: Personal Profile */}
                              <button 
                                onClick={() => handleLinkedinPageSelect(null)} 
                                className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${!selectedLinkedinUrn ? 'bg-white shadow-sm border border-blue-200 ring-2 ring-blue-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}
                              >
                                <div className="flex items-center gap-3 truncate pr-3">
                                  <User size={16} className={!selectedLinkedinUrn ? 'text-[#0A66C2] shrink-0' : 'text-slate-400 shrink-0'} />
                                  <span className={`text-sm font-bold truncate ${!selectedLinkedinUrn ? 'text-blue-900' : 'text-slate-600'}`}>
                                    Personal Profile ({linkedinName})
                                  </span>
                                </div>
                                {!selectedLinkedinUrn && <CheckCircle size={18} className="text-[#0A66C2] shrink-0" />}
                              </button>

                              {/* Option 2..N: Company Pages */}
                              {linkedinPages.map(page => (
                                <button 
                                  key={page.id} 
                                  onClick={() => handleLinkedinPageSelect(page.id)} 
                                  className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${selectedLinkedinUrn === page.id ? 'bg-white shadow-sm border border-blue-200 ring-2 ring-blue-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}
                                >
                                  <div className="flex items-center gap-3 truncate pr-3">
                                    <Building2 size={16} className={selectedLinkedinUrn === page.id ? 'text-[#0A66C2] shrink-0' : 'text-slate-400 shrink-0'} />
                                    <span className={`text-sm font-bold truncate ${selectedLinkedinUrn === page.id ? 'text-blue-900' : 'text-slate-600'}`}>
                                      {page.name}
                                    </span>
                                  </div>
                                  {selectedLinkedinUrn === page.id && <CheckCircle size={18} className="text-[#0A66C2] shrink-0" />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {isAdminLike && authRole !== 'agent' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md mb-6">
                <div className="p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="bg-red-100 text-red-600 p-3 rounded-full shadow-md shadow-red-500/10">
                        <Calendar size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-slate-900">Google Calendar</h4>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          {isGoogleConnected ? 'Connected & Active' : 'Sync schedule to book leads'}
                        </p>
                      </div>
                    </div>
                    {isGoogleConnected ? (
                      <button onClick={handleDisconnectGoogle} disabled={isDisconnectingGoogle} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-full font-bold transition-colors">
                        {isDisconnectingGoogle ? '...' : 'Unlink'}
                      </button>
                    ) : (
                      <button
                        onClick={handleConnectGoogle}
                        disabled={isConnectingGoogle}
                        className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-full text-xs font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isConnectingGoogle ? <Loader2 size={14} className="animate-spin" /> : null}
                        {isConnectingGoogle ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>

                  {isGoogleConnected && (
                    <div className="space-y-4 pt-4 border-t border-slate-100 mt-4">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 block mb-1.5 font-black">Target Google Calendar</label>
                        {isLoadingCalendars ? (
                          <div className="text-xs text-slate-400 py-2.5 pl-2 font-medium">Loading calendars...</div>
                        ) : (
                          <select
                            value={googleCalendarId}
                            onChange={(e) => setGoogleCalendarId(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 py-2.5 px-4 rounded-2xl text-xs font-bold outline-none cursor-pointer text-slate-800 focus:border-red-500 transition-all"
                          >
                            <option value="primary">Primary Calendar (Default)</option>
                            {googleCalendars
                              .filter(c => c.id !== 'primary')
                              .map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.summary}
                                </option>
                              ))}
                          </select>
                        )}
                        <p className="text-[10px] text-slate-400 mt-1 ml-1 leading-relaxed">
                          New appointment events will be created and checked for availability on this calendar.
                        </p>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 block mb-1.5 font-black">Slot Duration</label>
                        <select
                          value={googleBookingDuration}
                          onChange={(e) => setGoogleBookingDuration(Number(e.target.value))}
                          className="w-full bg-slate-50 border border-slate-200 py-2.5 px-4 rounded-2xl text-xs font-bold outline-none cursor-pointer text-slate-800 focus:border-red-500 transition-all"
                        >
                          <option value={15}>15 Minutes</option>
                          <option value={30}>30 Minutes</option>
                          <option value={45}>45 Minutes</option>
                          <option value={60}>60 Minutes</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 block mb-1.5 font-black">Start Time</label>
                          <input
                            type="time"
                            value={googleBookingStart}
                            onChange={(e) => setGoogleBookingStart(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 py-2 px-3 rounded-2xl text-xs font-bold outline-none text-slate-800 focus:border-red-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 block mb-1.5 font-black">End Time</label>
                          <input
                            type="time"
                            value={googleBookingEnd}
                            onChange={(e) => setGoogleBookingEnd(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 py-2 px-3 rounded-2xl text-xs font-bold outline-none text-slate-800 focus:border-red-500 transition-all"
                          />
                        </div>
                      </div>

                      <button
                        onClick={handleSaveGoogleSettings}
                        disabled={isSavingGoogleSettings}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-5 rounded-full transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                      >
                        {isSavingGoogleSettings ? <Loader2 size={14} className="animate-spin" /> : null}
                        {isSavingGoogleSettings ? 'Saving...' : 'Save Calendar Settings'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}


            {isAdminLike && authRole !== 'agent' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md">
                <button 
                  onClick={() => router.push(`/dashboard/billing${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-100 text-blue-600 p-3 rounded-2xl">
                      <CreditCard size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">Subscription & Billing</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => router.push(`/dashboard/usage${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-indigo-100 text-indigo-600 p-3 rounded-2xl">
                      <BarChart3 size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">Track Usage & Quotas</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                {/* Team Management - Only for Admins / Super Admins / Agencies */}
                {['super_admin', 'agency', 'admin'].includes(authRole || role) && (
                  <button 
                    onClick={() => router.push(`/dashboard/team${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                    className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100"
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-emerald-50 text-emerald-600 p-3 rounded-2xl">
                        <Shield size={20} />
                      </div>
                      <span className="font-bold text-sm text-slate-900">Team Management</span>
                    </div>
                    <ChevronRight size={20} className="text-slate-400" />
                  </button>
                )}

                {/* Accounts Management - Only for Super Admin / Agency */}
                {['super_admin', 'agency'].includes(authRole || role) && (
                  <button 
                    onClick={() => router.push(`/dashboard/accounts${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                    className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100"
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-indigo-50 text-indigo-600 p-3 rounded-2xl">
                        <Share2 size={20} />
                      </div>
                      <span className="font-bold text-sm text-slate-900">Connected Accounts</span>
                    </div>
                    <ChevronRight size={20} className="text-slate-400" />
                  </button>
                )}

                {/* Landing Pages Manager - Available to all users */}
                <button 
                  onClick={() => router.push(`/dashboard/pages${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-50 text-blue-600 p-3 rounded-2xl">
                      <Globe size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">Landing Pages Manager</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => router.push(`/dashboard/plugins${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-amber-100 to-orange-100 text-orange-600 p-3 rounded-2xl">
                      <Plug size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">Plugins & Integrations</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => setActiveSection('whatsapp')} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-all border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-emerald-100 text-emerald-600 p-3 rounded-2xl">
                      <MessageCircle size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">WhatsApp Automation</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => setActiveSection('voice')} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-all border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-indigo-100 text-indigo-600 p-3 rounded-2xl">
                      <Phone size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">Voice Agent</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => setActiveSection('calendar')} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-all border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-red-50 text-red-600 p-3 rounded-2xl">
                      <Calendar size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">Calendar & Booking Settings</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => setActiveSection('legal')} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-all border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-50 text-blue-600 p-3 rounded-2xl relative">
                      <Shield size={20} />
                      {!acceptedTerms && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-4.5 h-4.5 flex items-center justify-center rounded-full font-bold">
                          !
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-sm text-slate-900">Terms & Conditions Compliance</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => router.push(`/dashboard/qualifying${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-all border-b border-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-purple-100 text-purple-600 p-3 rounded-2xl">
                      <Sparkles size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">AI Qualification Questions</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => setActiveSection('flagged')} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-amber-50 text-amber-600 p-3 rounded-2xl relative">
                      <AlertCircle size={20} />
                      {flaggedCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-4.5 h-4.5 flex items-center justify-center rounded-full font-bold">
                          {flaggedCount}
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-sm text-slate-900">Flagged Questions</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>
              </div>
            )}

            {/* REFERENCE LIBRARY LINK - all users except agent */}
            {authRole !== 'agent' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md">
                <button 
                  onClick={() => router.push(`/dashboard/reference-library${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                  className="w-full p-6 sm:p-7 flex items-center justify-between hover:bg-slate-50/50 transition-all group"
                >
                  <div className="flex items-center gap-4 text-left">
                    <div className="bg-purple-100 text-purple-600 p-3.5 rounded-2xl group-hover:scale-105 transition-transform">
                      <ImageIcon size={22} />
                    </div>
                    <div>
                      <h4 className="font-bold text-base text-slate-900 flex items-center gap-2">
                        Reference Library
                        {authRole === 'super_admin' && (
                          <span className="bg-purple-50 text-purple-600 text-[8px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider">Super Admin</span>
                        )}
                      </h4>
                      <p className="text-xs text-slate-500 font-medium mt-1">
                        {authRole === 'super_admin' 
                          ? "Manage global visual references for Premium & High Converting strategies"
                          : "Manage your personal visual references for Premium & High Converting strategies"
                        }
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            )}

            <div className="bg-white rounded-[2rem] shadow-sm border border-red-100 overflow-hidden transition-all hover:border-red-200 hover:shadow-md">
              <button
                onClick={handleSignOut}
                className="w-full p-5 flex items-center justify-between bg-red-50/30 hover:bg-red-50 group transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-red-100 text-red-500 p-3 rounded-2xl group-hover:scale-110 group-hover:bg-red-500 group-hover:text-white transition-all duration-300">
                    <LogOut size={20} />
                  </div>
                  <span className="font-bold text-sm text-red-600 group-hover:text-red-700 transition-colors">Sign Out Securely</span>
                </div>
              </button>
            </div>

            {/* Legal Links Footer for Compliance Approval */}
            <div className="pt-8 text-center flex items-center justify-center gap-5 text-[11px] text-slate-400 font-bold border-t border-slate-200/50 mt-8">
              <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">
                Privacy Policy
              </a>
              <span className="text-slate-300">•</span>
              <a href="/refund-policy" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">
                Refund Policy
              </a>
              <span className="text-slate-300">•</span>
              <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">
                Terms of Service
              </a>
            </div>

          </div>
        </div>
        )}
      </div>

      {uploadingCharacter && (
        <div className="fixed inset-0 z-[20000] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white max-w-md w-full rounded-[2rem] p-8 shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-5">
            <Loader2 className="animate-spin text-purple-600 w-16 h-16" strokeWidth={2.5} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Uploading Reference Video</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                We are uploading your reference video directly to the secure storage bucket. Please don't close this tab.
              </p>
            </div>
          </div>
        </div>
      )}

      {uploadingAvatar && (
        <div className="fixed inset-0 z-[20000] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white max-w-md w-full rounded-[2rem] p-8 shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-5">
            <Loader2 className="animate-spin text-indigo-600 w-16 h-16" strokeWidth={2.5} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Uploading Avatar Photo</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                We are uploading your avatar photo and analyzing its physical characteristics using AI. Please don't close this tab.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}