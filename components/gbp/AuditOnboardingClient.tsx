'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Search,
  MapPin,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Star,
  Layers,
  Zap,
  Phone,
  Mail,
  User,
  Building,
  Check,
  Plus,
  X
} from 'lucide-react'
import { GBPAuditCampaign } from '@/utils/gbp-audit-storage'
import { extractCityFromAddress, cleanBusinessCategory } from '@/utils/gbp-address-parser'
import { toast } from 'sonner'

interface AuditOnboardingClientProps {
  campaign: GBPAuditCampaign
}

interface PlaceResult {
  placeId: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  rating: number | null
  reviewsCount: number | null
  category: string
  photosCount: number | null
  phone?: string
  website?: string
}

export default function AuditOnboardingClient({ campaign }: AuditOnboardingClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null)

  // Custom business input fallback
  const [businessName, setBusinessName] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [primaryCategory, setPrimaryCategory] = useState('Local Business')

  // Target Keywords
  const [keywords, setKeywords] = useState<string[]>([
    'business near me',
    'best rated service',
    'top company'
  ])
  const [newKeyword, setNewKeyword] = useState('')
  const [isGeneratingKeywords, setIsGeneratingKeywords] = useState(false)

  // Contact Info
  const [leadName, setLeadName] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [leadPhone, setLeadPhone] = useState('')

  // Progress scanning state
  const [isScanning, setIsScanning] = useState(false)
  const [scanStepIndex, setScanStepIndex] = useState(0)
  const [googleConnectedUser, setGoogleConnectedUser] = useState<{ email: string; name: string } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const scanSteps = [
    'Verifying Google Business Profile attributes & completeness...',
    'Scanning Google Maps Local 3-Pack competitors...',
    'Calculating 49 GPS Geo-Grid ranking checkpoints...',
    'Generating Gemini AI competitive gap analysis & revenue model...'
  ]

  const loadIntelligentKeywords = async (cat: string, addr: string, busName: string) => {
    setIsGeneratingKeywords(true)
    try {
      const cleanCat = cleanBusinessCategory(cat, busName)
      const city = extractCityFromAddress(addr) || ''
      const res = await fetch(`/api/gbp/places/search?mode=keywords&category=${encodeURIComponent(cleanCat)}&city=${encodeURIComponent(city)}&business=${encodeURIComponent(busName)}`)
      const data = await res.json()
      if (data.keywords && data.keywords.length > 0) {
        setKeywords(data.keywords)
      }
    } catch (err) {
      console.warn('[Keywords] Auto-suggest error:', err)
    } finally {
      setIsGeneratingKeywords(false)
    }
  }

  // Handle Google OAuth return callback with real Google data
  useEffect(() => {
    const connected = searchParams.get('connected')
    const email = searchParams.get('email')
    const name = searchParams.get('name')
    const business = searchParams.get('business')
    const address = searchParams.get('address')
    const placeId = searchParams.get('placeId')
    const lat = searchParams.get('lat')
    const lng = searchParams.get('lng')
    const rating = searchParams.get('rating')
    const reviewsCount = searchParams.get('reviewsCount')
    const photosCount = searchParams.get('photosCount')
    const category = searchParams.get('category')
    const phone = searchParams.get('phone')
    const website = searchParams.get('website')
    const hasGbp = searchParams.get('hasGbp')

    if (connected === 'true') {
      if (email) setLeadEmail(email)
      if (name) setLeadName(name)
      if (phone) setLeadPhone(phone)
      if (email || name) setGoogleConnectedUser({ email: email || '', name: name || '' })

      const resolvedName = business || name || email?.split('@')[0] || ''
      const hasResolvedPlace = Boolean(placeId || address || (hasGbp === 'true' && resolvedName))

      // Case A: Google account has no managed business location and auto-search couldn't find a direct place
      if (!hasResolvedPlace) {
        toast.info(`Google Account Connected (${email || name})! Please confirm your business name.`)
        if (resolvedName) {
          setSearchQuery(resolvedName)
        }
        setTimeout(() => {
          searchInputRef.current?.focus()
        }, 500)
        return
      }

      // Case B: Business location was resolved directly or via Places API
      const cat = cleanBusinessCategory(category || 'Local Business', resolvedName)
      const city = extractCityFromAddress(address || '') || 'local area'
      setBusinessName(resolvedName)
      setBusinessAddress(address || '')
      setPrimaryCategory(cat)

      const parsedLat = lat ? parseFloat(lat) : null
      const parsedLng = lng ? parseFloat(lng) : null
      const parsedRating = rating ? parseFloat(rating) : null
      const parsedReviews = reviewsCount ? parseInt(reviewsCount, 10) : null
      const parsedPhotos = photosCount ? parseInt(photosCount, 10) : null

      setSelectedPlace({
        placeId: placeId || 'google_oauth_connected',
        name: resolvedName,
        address: address || '',
        latitude: parsedLat,
        longitude: parsedLng,
        rating: parsedRating,
        reviewsCount: parsedReviews,
        category: cat,
        photosCount: parsedPhotos,
        phone: phone || '',
        website: website || ''
      })

      // Tailor keywords according to real category & city
      const lowerCat = cat.toLowerCase()
      setKeywords([
        `${lowerCat} near me`,
        `best ${lowerCat} in ${city}`,
        `top rated ${lowerCat}`
      ])

      // Fetch AI-enhanced intelligent keywords
      loadIntelligentKeywords(cat, address || '', resolvedName)

      setStep(2)
      toast.success(`Google Account Connected: ${resolvedName}!`)
    }
  }, [searchParams])

  // Search autocomplete debounce
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(`/api/gbp/places/search?q=${encodeURIComponent(searchQuery)}`)
        const data = await res.json()
        if (data.results) {
          setSearchResults(data.results)
        }
      } catch (err) {
        console.warn('Place search failed:', err)
      } finally {
        setIsSearching(false)
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleSelectPlace = (place: PlaceResult) => {
    const cat = cleanBusinessCategory(place.category, place.name)
    const city = extractCityFromAddress(place.address) || 'local area'
    setSelectedPlace(place)
    setBusinessName(place.name)
    setBusinessAddress(place.address)
    setPrimaryCategory(cat)

    // Suggest customized keywords based on category and city
    const lowerCat = cat.toLowerCase()
    setKeywords([
      `${lowerCat} near me`,
      `best ${lowerCat} in ${city}`,
      `top rated ${lowerCat}`
    ])

    // Fetch AI-enhanced intelligent keywords in the background
    loadIntelligentKeywords(cat, place.address, place.name)

    setStep(2)
  }

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return
    if (keywords.length >= 6) {
      toast.error('You can add up to 6 target keywords')
      return
    }
    setKeywords([...keywords, newKeyword.trim()])
    setNewKeyword('')
  }

  const handleRemoveKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index))
  }

  const handleConnectGoogle = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    window.location.href = `/api/auth/google/gbp?campaign=${encodeURIComponent(campaign.slug)}`
  }

  const handleStartAudit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!businessName) {
      toast.error('Please enter your business name')
      return
    }

    setIsScanning(true)
    setScanStepIndex(0)

    // Simulate animated scanning steps
    const stepInterval = setInterval(() => {
      setScanStepIndex(prev => {
        if (prev < scanSteps.length - 1) return prev + 1
        return prev
      })
    }, 900)

    try {
      const res = await fetch('/api/gbp/audit/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName,
          address: businessAddress || selectedPlace?.address || 'Local Region',
          placeId: selectedPlace?.placeId,
          latitude: selectedPlace?.latitude ?? null,
          longitude: selectedPlace?.longitude ?? null,
          rating: selectedPlace?.rating ?? null,
          reviewsCount: selectedPlace?.reviewsCount ?? null,
          photosCount: selectedPlace?.photosCount ?? null,
          phone: selectedPlace?.phone || leadPhone,
          website: selectedPlace?.website,
          primaryCategory,
          targetKeywords: keywords,
          leadName,
          leadEmail: leadEmail || googleConnectedUser?.email,
          leadPhone,
          isOwnerVerified: Boolean(googleConnectedUser?.email),
          googleEmail: googleConnectedUser?.email || '',
          campaignSlug: campaign.slug,
          currency: campaign.target_industry === 'US' ? 'USD' : 'INR'
        })
      })

      const data = await res.json()
      clearInterval(stepInterval)

      if (data.reportUrl) {
        toast.success('Audit complete! Redirecting to report...')
        router.push(data.reportUrl)
      } else {
        throw new Error(data.error || 'Failed to generate audit report')
      }
    } catch (err: any) {
      clearInterval(stepInterval)
      setIsScanning(false)
      toast.error(err.message || 'Error running audit')
    }
  }

  const brandColor = campaign.brand_color || '#2563EB'

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 text-white flex flex-col justify-between selection:bg-blue-600 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-white/10 px-6 py-4 backdrop-blur-md bg-slate-950/60 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {campaign.logo_url ? (
              <img src={campaign.logo_url} alt={campaign.agency_name} className="h-8 max-w-[140px] object-contain" />
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base shadow-lg"
                  style={{ backgroundColor: brandColor }}
                >
                  {campaign.agency_name.charAt(0)}
                </div>
                <span className="font-black text-xl tracking-tight">{campaign.agency_name}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Free 60s Local SEO Audit
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto px-4 py-10 sm:py-16 w-full flex-1 flex flex-col justify-center">
        {/* Full-Screen Scanning Modal Overlay */}
        {isScanning ? (
          <div className="bg-slate-900/90 backdrop-blur-2xl rounded-3xl p-8 sm:p-12 border border-white/10 shadow-2xl text-center max-w-xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
            <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin"></div>
              <Sparkles size={36} className="text-blue-400 animate-pulse" />
            </div>

            <div className="space-y-3">
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                Analyzing Google Business Profile
              </h2>
              <p className="text-sm text-slate-300 font-medium">
                {scanSteps[scanStepIndex]}
              </p>
            </div>

            {/* Step Checkmarks */}
            <div className="space-y-2 text-left max-w-md mx-auto pt-2">
              {scanSteps.map((s, idx) => {
                const isPassed = scanStepIndex > idx
                const isCurrent = scanStepIndex === idx
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 text-xs font-bold transition-colors ${
                      isPassed ? 'text-emerald-400' : isCurrent ? 'text-blue-400' : 'text-slate-600'
                    }`}
                  >
                    {isPassed ? (
                      <CheckCircle2 size={16} className="shrink-0" />
                    ) : isCurrent ? (
                      <Loader2 size={16} className="shrink-0 animate-spin" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-700 shrink-0" />
                    )}
                    <span>{s}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Hero Heading */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-black uppercase tracking-wider border border-blue-500/20">
                <Layers size={14} /> Powered by Nobogent Local AI
              </div>
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white max-w-2xl mx-auto leading-tight">
                {campaign.hero_title || 'Free Google Business Profile Audit & Rank Heatmap'}
              </h1>
              <p className="text-slate-300 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
                {campaign.hero_subtitle || 'Discover why competitors outrank you on Google Maps, find your missing revenue, and get an AI action plan in 60 seconds.'}
              </p>
            </div>

            {/* Interactive Card */}
            <div className="bg-slate-900/80 backdrop-blur-xl rounded-3xl p-6 sm:p-10 border border-white/10 shadow-2xl space-y-8">
              {/* Step Tabs */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4 text-xs font-bold">
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                    step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    1
                  </span>
                  <span className={step >= 1 ? 'text-white' : 'text-slate-500'}>Find Business</span>
                </div>
                <div className="w-8 h-px bg-white/10 hidden sm:block"></div>
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                    step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    2
                  </span>
                  <span className={step >= 2 ? 'text-white' : 'text-slate-500'}>Target Keywords</span>
                </div>
                <div className="w-8 h-px bg-white/10 hidden sm:block"></div>
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                    step >= 3 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    3
                  </span>
                  <span className={step >= 3 ? 'text-white' : 'text-slate-500'}>Get Audit</span>
                </div>
              </div>

              {/* STEP 1: Find Business / Connect Google */}
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in">
                  <div>
                    <h3 className="text-lg font-black text-white">Select Your Google Business Profile</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Search your business name to perform an instant live scan, or connect directly with Google.
                    </p>
                  </div>

                  {/* Connect with Google Option */}
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                          />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Connect Google Business Profile</h4>
                        <p className="text-xs text-slate-400">1-click direct API authorization for deep profile audit</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleConnectGoogle}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-black text-xs transition-all shadow-md shrink-0 flex items-center justify-center gap-2"
                    >
                      <span>Connect with Google</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>

                  <div className="relative flex items-center justify-center">
                    <div className="border-t border-white/10 w-full"></div>
                    <span className="bg-slate-900 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Or search by business name
                    </span>
                  </div>

                  {/* Connected Google Account Notice if no GBP listing was auto-returned */}
                  {googleConnectedUser && (
                    <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3 animate-in fade-in">
                      <div className="w-8 h-8 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center font-black shrink-0 mt-0.5">
                        <Check size={16} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black uppercase text-emerald-400">Google Account Connected</span>
                          <span className="text-xs text-slate-300 font-bold">({googleConnectedUser.email})</span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          Signed in as <strong>{googleConnectedUser.name}</strong>. Google did not detect an active Business Profile managed under this email. <strong>Search your business name below</strong> to link it and generate your verified audit:
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Autocomplete Search Bar */}
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Type your business name (e.g. Adrolls AI, DLF Cyber City, Starbucks)..."
                        className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm font-medium transition-colors ring-2 ring-blue-500/30"
                      />
                      {isSearching && (
                        <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-blue-400" size={18} />
                      )}
                    </div>

                    {/* Results Dropdown */}
                    {searchResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-2 bg-slate-900/95 backdrop-blur-md rounded-2xl border border-white/15 shadow-2xl overflow-hidden z-20 divide-y divide-white/5 max-h-72 overflow-y-auto">
                        {searchResults.map((item) => (
                          <div
                            key={item.placeId}
                            onClick={() => handleSelectPlace(item)}
                            className="p-3.5 hover:bg-white/10 cursor-pointer transition-colors flex items-start gap-3"
                          >
                            <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                              <MapPin size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h5 className="text-sm font-bold text-white truncate">{item.name}</h5>
                                <span className="text-xs text-amber-400 font-bold flex items-center gap-1 shrink-0 ml-2">
                                  <Star size={12} className="fill-amber-400" /> {item.rating}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 truncate mt-0.5">{item.address}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: Keywords & Category Selection */}
              {step === 2 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-black text-white">Target Keywords &amp; Service Radius</h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Select the local keywords you want to scan rankings for across your geo-grid.
                      </p>
                    </div>
                    <button
                      onClick={() => setStep(1)}
                      className="text-xs text-blue-400 hover:underline font-bold"
                    >
                      Change Business
                    </button>
                  </div>

                  {/* Selected Business Card */}
                  <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shrink-0">
                        <Building size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-white">{businessName}</h4>
                        <p className="text-xs text-slate-300">{businessAddress}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Niche:</span>
                      <input
                        type="text"
                        value={primaryCategory}
                        onChange={(e) => setPrimaryCategory(e.target.value)}
                        placeholder="Business Category..."
                        className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-blue-300 text-xs font-bold focus:outline-none focus:border-blue-400 min-w-[200px]"
                      />
                    </div>
                  </div>

                  {/* Keyword Pills */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-300 block uppercase tracking-wider">
                        Geo-Grid Target Keywords ({keywords.length}/6)
                      </label>
                      <button
                        type="button"
                        disabled={isGeneratingKeywords}
                        onClick={() => loadIntelligentKeywords(primaryCategory, businessAddress, businessName)}
                        className="text-[11px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {isGeneratingKeywords ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            <span>Analyzing Keywords...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={12} />
                            <span>Regenerate with AI</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {keywords.map((kw, i) => (
                        <div
                          key={i}
                          className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-bold text-white flex items-center gap-2 group"
                        >
                          <span>📍 {kw}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveKeyword(i)}
                            className="text-slate-400 hover:text-white"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add Custom Keyword */}
                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddKeyword())}
                        placeholder="Add custom keyword (e.g. emergency dentist, top coffee shop, criminal lawyer)..."
                        className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white placeholder-slate-500 text-xs font-medium focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddKeyword}
                        className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 font-black text-sm text-white shadow-xl transition-all flex items-center justify-center gap-2"
                  >
                    <span>Proceed to Delivery &amp; Scan</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}

              {/* STEP 3: Lead Capture & Run Scan */}
              {step === 3 && (
                <form onSubmit={handleStartAudit} className="space-y-6 animate-in fade-in">
                  <div>
                    <h3 className="text-lg font-black text-white">Where should we deliver your full report?</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Your audit report will generate live on screen and be saved to your unique shareable link.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-300 block">Your Name</label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="text"
                          required
                          value={leadName}
                          onChange={(e) => setLeadName(e.target.value)}
                          placeholder="John Doe"
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-slate-500 text-xs font-medium focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-300 block">Work Email</label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="email"
                          required
                          value={leadEmail}
                          onChange={(e) => setLeadEmail(e.target.value)}
                          placeholder="john@mybusiness.com"
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-slate-500 text-xs font-medium focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="text-xs font-bold text-slate-300 block">WhatsApp / Phone Number</label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="tel"
                          required
                          value={leadPhone}
                          onChange={(e) => setLeadPhone(e.target.value)}
                          placeholder="+91 98765 43210"
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-slate-500 text-xs font-medium focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="px-5 py-3 rounded-xl border border-white/15 text-slate-300 hover:bg-white/5 text-xs font-bold transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={isScanning}
                      className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:brightness-110 font-black text-sm text-white shadow-xl transition-all flex items-center justify-center gap-2"
                    >
                      <Sparkles size={16} />
                      <span>Run Free AI Audit Now (60s)</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Trust Footnotes */}
            <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400 font-semibold">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-emerald-400" /> 100% Free
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-emerald-400" /> No Credit Card Required
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-emerald-400" /> 49 Geo-Grid Checkpoints
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-emerald-400" /> Gemini AI Powered
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-slate-500">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} {campaign.agency_name}. All rights reserved.</p>
          <p className="text-slate-600">White-label Google Business Profile Growth Engine powered by Nobogent</p>
        </div>
      </footer>
    </div>
  )
}
