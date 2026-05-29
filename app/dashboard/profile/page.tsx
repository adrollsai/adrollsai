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
  User,
  Video,
  BarChart3
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import PushManager from '@/components/PushManager'

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
      if (!res.ok) throw new Error(data.error || 'Failed to initialize domain')

      onDomainUpdate() // Refresh parent to show verification box
      toast.success("Domain initialized. Please follow verification steps.")
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!userId) return
    setLoading(true)
    setErrorMessage('')

    try {
      const res = await fetch('/api/domains/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, userId, type })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      onDomainUpdate()
      toast.success("Domain Verified & Connected! ✨")
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
      toast.success("Domain Unlinked Successfully.")
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
          disabled={verifyStatus === 'verified' || loading}
          className="w-full bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-blue-100 shadow-sm transition-all disabled:opacity-60"
        />

        {verifyStatus === 'verified' ? (
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
            {loading ? <Loader2 size={18} className="animate-spin" /> : verifyStatus === 'pending' ? 'Update Domain' : 'Connect'}
          </button>
        )}
      </div>

      {/* PENDING VERIFICATION STATE */}
      {verifyStatus === 'pending' && verifyToken && (
        <div className="mt-5 bg-white p-5 rounded-3xl border border-amber-200 shadow-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-amber-700 font-bold text-sm mb-4">
            <AlertCircle size={18} /> Domain Verification Required
          </div>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            To prevent hijacking, please add this <strong>TXT Record</strong> to your DNS settings at your domain registrar:
          </p>

          <div className="space-y-3 mb-5">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 relative group">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Host / Name</label>
              <div className="flex justify-between items-center">
                <code className="text-xs font-mono text-slate-700">@</code>
                <button onClick={() => copyToClipboard('@')} className="text-blue-500 hover:text-blue-700"><Copy size={14} /></button>
              </div>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 relative group">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Value / TXT Content</label>
              <div className="flex justify-between items-center gap-2">
                <code className="text-[10px] font-mono text-slate-700 break-all">{verifyToken}</code>
                <button onClick={() => copyToClipboard(verifyToken)} className="text-blue-500 hover:text-blue-700 shrink-0"><Copy size={14} /></button>
              </div>
            </div>
          </div>

          <button
            onClick={handleVerify}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-500/20"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} Verify TXT Record
          </button>
          <p className="text-[10px] text-slate-400 mt-3 text-center">DNS propagation can take a few minutes to reflect.</p>
        </div>
      )}

      {/* VERIFIED STATE */}
      {verifyStatus === 'verified' && (
        <div className="mt-4 bg-white p-5 rounded-3xl border border-green-200 shadow-sm animate-in fade-in slide-in-from-top-2">
          <p className="text-sm font-bold text-green-700 flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} /> Domain Verified & Linked!
          </p>
          <div className="space-y-1 text-xs text-slate-600 font-medium ml-1">
            <p>• Point your A Record to <span className="font-mono font-bold">76.76.21.21</span></p>
            <p>• SSL Status: <span className="text-green-600 font-bold">Active</span></p>
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

const normalizeVideoClientSide = (file: File, onProgress: (progress: number) => void): Promise<File> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.src = URL.createObjectURL(file)
    video.muted = true
    video.playsInline = true
    video.crossOrigin = "anonymous"

    video.onloadedmetadata = () => {
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        const ratio = width / height
        const pixelCount = width * height

        // Target Kie.ai Seedance 2.0 specs
        let targetWidth = width
        let targetHeight = height

        if (pixelCount < 409600) {
          if (width < height) {
            // Vertical 9:16
            targetWidth = 720
            targetHeight = Math.round(720 / ratio)
          } else if (width > height) {
            // Landscape
            targetHeight = 720
            targetWidth = Math.round(720 * ratio)
          } else {
            // Square
            targetWidth = 640
            targetHeight = 640
          }

          // Even dimensions required for H.264
          targetWidth = Math.round(targetWidth / 2) * 2
          targetHeight = Math.round(targetHeight / 2) * 2
        }

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error("Could not create canvas 2D context")
        }

        const stream = canvas.captureStream(30)
        
        let audioTrack: MediaStreamTrack | null = null
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
          const dest = audioContext.createMediaStreamDestination()
          const source = audioContext.createMediaElementSource(video)
          source.connect(dest)
          source.connect(audioContext.destination)
          if (dest.stream.getAudioTracks().length > 0) {
            audioTrack = dest.stream.getAudioTracks()[0]
            stream.addTrack(audioTrack)
          }
        } catch (e) {
          console.log("No audio or audio routing failed (CORS/No Audio):", e)
        }

        let mimeType = 'video/webm'
        if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) {
          mimeType = 'video/mp4;codecs=h264'
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4'
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
          mimeType = 'video/webm;codecs=vp9'
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
          mimeType = 'video/webm'
        }

        const mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 2500000
        })
        const chunks: Blob[] = []
        
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data)
        }

        mediaRecorder.onstop = () => {
          try {
            video.pause()
            URL.revokeObjectURL(video.src)
            const blob = new Blob(chunks, { type: mimeType })
            const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
            const processedFile = new File(
              [blob], 
              file.name.replace(/\.[^/.]+$/, "") + `_normalized.${ext}`, 
              { type: mimeType }
            )
            resolve(processedFile)
          } catch (err) {
            reject(err)
          }
        }

        video.playbackRate = 1.5 // Speed up browser rendering by 50%
        video.play()
        mediaRecorder.start()

        const drawLoop = () => {
          if (video.paused || video.ended) {
            mediaRecorder.stop()
            return
          }
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
          const progress = Math.min(Math.round((video.currentTime / video.duration) * 100), 99)
          onProgress(progress)
          requestAnimationFrame(drawLoop)
        }

        video.onplay = () => {
          requestAnimationFrame(drawLoop)
        }
      } catch (err) {
        reject(err)
      }
    }

    video.onerror = () => {
      reject(new Error("Failed to load video metadata"))
    }
  })
}

export default function ProfilePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [role, setRole] = useState<'super_admin' | 'agency' | 'client' | 'admin' | 'agent'>('agent')
  const [authRole, setAuthRole] = useState<string | null>(null)
  const [authUserName, setAuthUserName] = useState<string | null>(null)

  const isAdminLike = ['super_admin', 'agency', 'admin', 'client', 'agent'].includes(authRole || role)

  // Actions
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [isConnectingFb, setIsConnectingFb] = useState(false) // Added connection loading state
  const [isTestingPayment, setIsTestingPayment] = useState(false)
  const [processingProgress, setProcessingProgress] = useState(0)
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)

  // Connections
  const [isFacebookConnected, setIsFacebookConnected] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  // --- LINKEDIN STATE ---
  const [isLinkedinConnected, setIsLinkedinConnected] = useState(false)
  const [linkedinName, setLinkedinName] = useState('')
  const [isConnectingLinkedin, setIsConnectingLinkedin] = useState(false)

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
    characterUrl: '',
    facebookUrl: '',
    instagramUrl: '',
    customPrompt: '',
    currency: 'INR'
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- HELPERS ---
  const isValidFacebookToken = (token: string) => token && token.startsWith('EAA')

  const updateLocalCache = (updates: any) => {
    const effectiveUserId = targetUserId || userId;
    if (!effectiveUserId) return;
    const cacheKey = `profile_cache_${effectiveUserId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      localStorage.setItem(cacheKey, JSON.stringify({ ...parsed, ...updates }));
    }
  }

  const handleTestPayment = async () => {
    setIsTestingPayment(true)
    try {
      const res = await fetch('/api/payment/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: 'Early Bird Plan' })
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error(data.error || 'Failed to initiate test payment')
      }
    } catch (err: any) {
      toast.error("Test Payment Error", { description: err.message })
    } finally {
      setIsTestingPayment(false)
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
        body: JSON.stringify({ adAccountId })
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
      await fetch('/api/facebook/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: page.id, pageToken: page.access_token })
      })
      toast.success(`Connected to ${page.name}!`, {
        description: "Real-time leads are now enabled for this page."
      })
    } catch (e) {
      console.error("Auto-subscription failed:", e)
      toast.error("Connected with warnings", {
        description: "CRM saving works, but real-time notifications might need a manual refresh."
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
      const { data: authProfile } = await supabase.from('profiles').select('role, agency_id, parent_id, business_name').eq('id', user.id).single()
      const currentAuthRole = authProfile?.role || 'admin'
      setAuthRole(currentAuthRole)
      setAuthUserName(authProfile?.business_name || null)

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
          characterUrl: profileData.character_url || '',
          facebookUrl: profileData.facebook_url || '',
          instagramUrl: profileData.instagram_url || '',
          customPrompt: profileData.custom_prompt || '',
          currency: profileData.currency || 'INR'
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
        } else {
          setIsLinkedinConnected(false)
          setLinkedinName('')
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

  const handleConnectLinkedin = async () => {
    setIsConnectingLinkedin(true)
    try {
      // Redirect to our LinkedIn Auth API
      window.location.href = '/api/auth/linkedin'
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

      const { error } = await supabase
        .from('profiles')
        .update({ 
          linkedin_token: null, 
          linkedin_id: null,
          linkedin_name: null 
        })
        .eq('id', user.id)

      if (error) throw error
      
      setIsLinkedinConnected(false)
      setLinkedinName('')
      toast.success('LinkedIn unlinked successfully')
    } catch (err: any) {
      toast.error('Failed to unlink LinkedIn', { description: err.message })
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

      const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, file)
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName)

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

    } catch (error) {
      alert('Error uploading logo')
    } finally {
      setUploadingLogo(false)
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
      setIsProcessingVideo(true)
      setProcessingProgress(0)

      const effectiveUserId = targetUserId || userId;
      if (!effectiveUserId) return

      let processedFile = file
      try {
        processedFile = await normalizeVideoClientSide(file, (progress) => {
          setProcessingProgress(progress)
        })
      } catch (err) {
        console.error("Client-side upscaling failed, uploading original file:", err)
      } finally {
        setIsProcessingVideo(false)
        setProcessingProgress(0)
      }

      const fileExt = processedFile.name.split('.').pop()
      const fileName = `character-${effectiveUserId}-${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, processedFile)
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName)

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

    } catch (error) {
      alert('Error uploading character video')
    } finally {
      setUploadingCharacter(false)
      setIsProcessingVideo(false)
      setProcessingProgress(0)
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
      character_url: formData.characterUrl,
      facebook_url: isAdminLike ? formData.facebookUrl : undefined,
      instagram_url: isAdminLike ? formData.instagramUrl : undefined,
      custom_prompt: formData.customPrompt,
      currency: formData.currency
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

        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-8 ml-1">Workspace Settings</h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

          <div className="lg:col-span-7 space-y-6">

            {/* Header Identity Card */}
            <div className="bg-white rounded-[2rem] p-8 sm:p-10 shadow-sm border border-slate-200/60 flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left transition-all hover:shadow-md">
              <div className="flex flex-col sm:flex-row gap-4 shrink-0 items-center">
                {/* Logo Upload */}
                <div
                  onClick={() => !uploadingLogo && fileInputRef.current?.click()}
                  className="w-24 h-24 bg-slate-50/80 rounded-full flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 transition-all shadow-sm"
                  title="Upload Brand Logo"
                >
                  {uploadingLogo ? (
                    <Loader2 className="animate-spin text-slate-400" size={24} />
                  ) : formData.logoUrl ? (
                    <>
                      <img src={formData.logoUrl} alt="Logo" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Upload size={20} className="text-slate-800 drop-shadow-md" />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-blue-500 transition-colors">
                      <Upload size={20} />
                      <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Logo</span>
                    </div>
                  )}
                  <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
                </div>

                {/* Character Upload */}
                <div
                  onClick={() => !uploadingCharacter && characterInputRef.current?.click()}
                  className="w-24 h-24 bg-slate-50/80 rounded-[1.25rem] flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-purple-500 hover:bg-purple-50 transition-all shadow-sm"
                  title="Upload Custom Video Character"
                >
                  {uploadingCharacter ? (
                    <div className="flex flex-col items-center justify-center p-2 text-center">
                      <Loader2 className="animate-spin text-purple-600 mb-1" size={20} />
                      {processingProgress > 0 ? (
                        <span className="text-[8px] font-black text-purple-600">{processingProgress}%</span>
                      ) : (
                        <span className="text-[8px] font-black text-slate-400">Scaling...</span>
                      )}
                    </div>
                  ) : formData.characterUrl ? (
                    <>
                      {(/\.(mp4|webm)/i.test(formData.characterUrl) || formData.characterUrl.includes('video')) ? (
                        <video src={formData.characterUrl} muted loop playsInline autoPlay className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                      ) : (
                        <img src={formData.characterUrl} alt="Character" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Upload size={20} className="text-slate-800 drop-shadow-md" />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-purple-500 transition-colors">
                      <Video size={20} />
                      <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Video</span>
                    </div>
                  )}
                  <input type="file" ref={characterInputRef} onChange={handleCharacterUpload} accept="video/*" className="hidden" />
                </div>
              </div>
              <div className="flex-1 mt-2">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  {formData.businessName || (isAdminLike ? 'Your Business' : 'Your Name')}
                </h2>
                <p className="text-slate-500 text-sm leading-relaxed max-w-md">
                  Personalize your workspace. Branding set here reflects on your landing pages.
                </p>
                {authUserName && authRole === 'agent' && (
                  <div className="mt-4 flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full w-fit border border-blue-100">
                    <Shield size={14} />
                    <span className="text-[11px] font-bold uppercase tracking-wider">Logged in as: {authUserName}</span>
                  </div>
                )}
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
                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">
                    {isAdminLike ? 'Business Name' : 'Full Name'}
                  </label>
                  <input
                    type="text"
                    value={formData.businessName}
                    onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Business Currency</label>
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-bold focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all cursor-pointer"
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
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all"
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
                          className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all"
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
                          className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all"
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
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 px-5 rounded-3xl text-slate-800 text-sm font-medium resize-none focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all"
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
                    className="w-full bg-purple-50/30 hover:bg-purple-50/50 focus:bg-white py-4 px-5 rounded-3xl text-slate-800 text-sm font-medium resize-none focus:ring-4 focus:ring-blue-500/20 outline-none border border-purple-200 focus:border-blue-400 transition-all"
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
                    className="w-full bg-blue-50/30 hover:bg-blue-50/50 focus:bg-white py-4 px-5 rounded-3xl text-slate-800 text-sm font-medium resize-none focus:ring-4 focus:ring-blue-500/20 outline-none border border-blue-200 focus:border-blue-400 transition-all"
                    placeholder="e.g. 'Cinematic lighting, hyper-realistic, professional photography style, vibrant colors...'"
                  />
                  <p className="text-[10px] text-slate-400 mt-2 ml-3 font-medium">
                    This detailed style guide will be prioritized in all AI creative generations.
                  </p>
                </div>

                <div className="pb-2">
                  <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Brand Color</label>
                  <div className="flex items-center gap-3 bg-slate-50 hover:bg-slate-100/50 focus-within:bg-white p-2.5 rounded-2xl border border-slate-200/60 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/20 transition-all">
                    <div
                      className="w-8 h-8 rounded-xl shadow-inner border-2 border-white"
                      style={{ backgroundColor: formData.color }}
                    />
                    <input
                      type="text"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="bg-transparent font-mono text-sm w-full outline-none uppercase text-slate-700 font-medium px-2"
                    />
                  </div>
                </div>

                {/* DOMAIN MANAGER SECTION */}
                {isAdminLike && authRole !== 'agent' && (
                  <div className="pt-2 border-t border-slate-100 space-y-4">
                    <DomainManager
                      initialDomain={domainData.domain}
                      verifyToken={domainData.token}
                      verifyStatus={domainData.status}
                      userId={userId}
                      onDomainUpdate={fetchProfile}
                      type="catalogue"
                      label="Public Catalog Domain"
                    />

                    {(role === 'agency' || role === 'super_admin') && (
                      <DomainManager
                        initialDomain={whitelabelDomainData.domain}
                        verifyToken={whitelabelDomainData.token}
                        verifyStatus={whitelabelDomainData.status}
                        userId={userId}
                        onDomainUpdate={fetchProfile}
                        type="platform"
                        label="White-label Platform Domain"
                      />
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleSave}
                disabled={isSaving || uploadingLogo}
                className="w-full mt-6 bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] sm:rounded-full text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-70 disabled:scale-100"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {isSaving ? 'Saving Changes...' : 'Save Profile Details'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-[2rem] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              <PushManager variant="inline" ownerId={targetUserId || userId || undefined} />
            </div>

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
                                <span className={`text-sm font-bold truncate pr-3 ${selectedPageId === page.id ? 'text-blue-900' : 'text-slate-600'}`}>{page.name}</span>
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
                                <span className={`text-sm font-bold truncate pr-3 ${selectedAdAccountId === account.id ? 'text-emerald-900' : 'text-slate-600'}`}>{account.name}</span>
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
                          <button onClick={() => selectedAdAccountId && fetchPixels(selectedAdAccountId)} className="text-[10px] text-blue-600 font-bold uppercase tracking-wider transition-colors">Refresh List</button>
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
                                  <span className={`text-sm font-bold truncate ${selectedPixelId === pixel.id ? 'text-purple-900' : 'text-slate-600'}`}>{pixel.name}</span>
                                </div>
                                {selectedPixelId === pixel.id && <CheckCircle size={18} className="text-purple-600 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="py-3 px-2"><p className="text-sm text-slate-500 font-medium">No Pixels found for this account.</p></div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isAdminLike && authRole !== 'agent' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md mb-6">
                <div className="p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="bg-[#0A66C2] p-3 rounded-full text-white shadow-md shadow-[#0A66C2]/20">
                        <Linkedin size={20} fill="white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-slate-900">LinkedIn Profile</h4>
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
                        onClick={handleConnectLinkedin}
                        disabled={isConnectingLinkedin}
                        className="bg-[#0A66C2] hover:bg-[#084d91] text-white px-5 py-2 rounded-full text-xs font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isConnectingLinkedin ? <Loader2 size={14} className="animate-spin" /> : null}
                        {isConnectingLinkedin ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
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
                  <div className="flex items-center gap-2">
                    <span className="bg-blue-50 text-blue-600 text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-wider">Early Bird</span>
                    <ChevronRight size={20} className="text-slate-400" />
                  </div>
                </button>

                {/* TEST PAYMENT BUTTON */}
                <button
                  onClick={handleTestPayment}
                  disabled={isTestingPayment}
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-amber-50 transition-colors border-b border-slate-100 group"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-amber-100 text-amber-600 p-3 rounded-2xl group-hover:scale-110 transition-all">
                      {isTestingPayment ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                    </div>
                    <div className="text-left">
                      <span className="font-bold text-sm text-slate-900 block">Activate Live Account (₹1)</span>
                      <span className="text-[10px] text-blue-600 font-bold uppercase tracking-tight">Standard PG Checkout</span>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
                </button>

                <button 
                  onClick={() => router.push(`/dashboard/team${impersonateId ? `?impersonate=${impersonateId}` : ''}`)} 
                  className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-emerald-100 text-emerald-600 p-3 rounded-2xl">
                      <Shield size={20} />
                    </div>
                    <span className="font-bold text-sm text-slate-900">Team Management</span>
                  </div>
                  <ChevronRight size={20} className="text-slate-400" />
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

          </div>
        </div>
      </div>

      {isProcessingVideo && (
        <div className="fixed inset-0 z-[20000] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white max-w-md w-full rounded-[2rem] p-8 shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-5">
            <div className="relative">
              <Loader2 className="animate-spin text-purple-600 w-16 h-16" strokeWidth={2.5} />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-black text-purple-900">
                {processingProgress}%
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Optimizing Reference Video</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                We are upscaling and normalizing your video to the target Kie.ai Seedance 2.0 specifications right on your device.
              </p>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div 
                className="bg-gradient-to-r from-purple-600 to-indigo-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${processingProgress}%` }}
              />
            </div>
            <div className="bg-purple-50/60 border border-purple-100 p-4 rounded-2xl w-full">
              <span className="text-[10px] font-black text-purple-600 uppercase tracking-widest block mb-1">Important</span>
              <p className="text-[11px] text-purple-800 font-semibold leading-relaxed">
                Please do not leave this page or close your browser tab. The heavy lifting is being performed directly on your device.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}