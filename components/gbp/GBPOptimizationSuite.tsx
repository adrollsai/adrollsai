'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  MapPin,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Share2,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  Calendar,
  MessageSquare,
  Star,
  RefreshCw,
  Plus,
  Send,
  Loader2,
  Building,
  Phone,
  Globe,
  Tag,
  ShieldCheck,
  HelpCircle,
  Clock,
  ArrowRight,
  Info,
  ChevronRight,
  UserCheck,
  FileText,
  Sliders,
  Eye,
  Trash2,
  HeartHandshake,
  Download,
  Camera,
  UploadCloud,
  Code,
  Search,
  Compass,
  CheckCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { GBPOptimizationProfile, GBPPost, ReviewFeedback } from '@/utils/gbp-suite-storage'

interface GBPOptimizationSuiteProps {
  currentUserId?: string
}

export default function GBPOptimizationSuite({ currentUserId }: GBPOptimizationSuiteProps) {
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<GBPOptimizationProfile | null>(null)
  const [reviewPageUrl, setReviewPageUrl] = useState<string>('')
  const [stats, setStats] = useState<{
    totalPosts: number
    publishedPosts: number
    totalFeedbacks: number
    avgRating: number
  }>({ totalPosts: 0, publishedPosts: 0, totalFeedbacks: 0, avgRating: 5 })

  const [activeTab, setActiveTab] = useState<'overview' | 'shortcomings' | 'posts' | 'geotag' | 'website' | 'reviews' | 'qa'>('overview')
  const [copiedLink, setCopiedLink] = useState(false)
  const [isImpersonating, setIsImpersonating] = useState(false)

  // Geo-Tagging State
  const [geotagRawBase64, setGeotagRawBase64] = useState<string | null>(null)
  const [geotagImagePreview, setGeotagImagePreview] = useState<string | null>(null)
  const [geotagLat, setGeotagLat] = useState<number | string>(18.5204)
  const [geotagLng, setGeotagLng] = useState<number | string>(73.8567)
  const [geotagKeywords, setGeotagKeywords] = useState<string>('')
  const [geotagDescription, setGeotagDescription] = useState<string>('')
  const [geotaggingLoading, setGeotaggingLoading] = useState(false)
  const [geotagResult, setGeotagResult] = useState<any | null>(null)

  // Website SEO Scanner State
  const [scanUrl, setScanUrl] = useState<string>('')
  const [scanningWebsite, setScanningWebsite] = useState(false)
  const [websiteAuditResult, setWebsiteAuditResult] = useState<any | null>(null)
  const [copiedSchema, setCopiedSchema] = useState(false)

  // AI Optimization modal & state
  const [optimizingAi, setOptimizingAi] = useState(false)
  const [aiResultModalOpen, setAiResultModalOpen] = useState(false)
  const [aiResults, setAiResults] = useState<any>(null)
  const [applyingAiField, setApplyingAiField] = useState<string | null>(null)

  // Posts State
  const [posts, setPosts] = useState<GBPPost[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [showNewPostModal, setShowNewPostModal] = useState(false)
  const [creatingPost, setCreatingPost] = useState(false)
  const [newPost, setNewPost] = useState<{
    postType: 'STANDARD' | 'EVENT' | 'OFFER'
    content: string
    title: string
    ctaType: string
    ctaUrl: string
    mediaUrl: string
    couponCode: string
    offerStart: string
    offerEnd: string
  }>({
    postType: 'STANDARD',
    content: '',
    title: '',
    ctaType: 'BOOK',
    ctaUrl: '',
    mediaUrl: '',
    couponCode: '',
    offerStart: '',
    offerEnd: ''
  })

  // Private Review Feedbacks (< 4 stars)
  const [feedbacks, setFeedbacks] = useState<ReviewFeedback[]>([])
  const [loadingFeedbacks, setLoadingFeedbacks] = useState(false)

  // Profile Edit State
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    business_name: '',
    location_address: '',
    phone: '',
    website_url: '',
    primary_category: '',
    additional_categories: '',
    description: '',
    google_review_url: '',
    target_keywords: '',
    custom_domain: ''
  })

  // Handlers for Geo-Tagging
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (JPEG, PNG, or WebP)')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setGeotagRawBase64(result)
      setGeotagImagePreview(result)
      setGeotagResult(null)
    }
    reader.readAsDataURL(file)
  }

  const handleGeotagImage = async () => {
    if (!geotagRawBase64) {
      toast.error('Please select or upload an image first')
      return
    }
    if (!geotagLat || !geotagLng) {
      toast.error('Please enter valid latitude and longitude coordinates')
      return
    }

    setGeotaggingLoading(true)
    try {
      const url = `/api/gbp/geotag${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: geotagRawBase64,
          latitude: Number(geotagLat),
          longitude: Number(geotagLng),
          businessName: profile?.business_name,
          keywords: geotagKeywords || (profile?.target_keywords ? profile.target_keywords.join(', ') : ''),
          description: geotagDescription || profile?.description || ''
        })
      })
      const data = await res.json()
      if (data.success) {
        setGeotagResult(data)
        toast.success('Image successfully geo-tagged with verified EXIF GPS metadata! 📍')
      } else {
        toast.error(data.error || 'Failed to geo-tag image')
      }
    } catch (err: any) {
      toast.error('Geo-tagging error: ' + err.message)
    } finally {
      setGeotaggingLoading(false)
    }
  }

  const handleDownloadGeotaggedImage = () => {
    if (!geotagResult?.geotaggedImageBase64) return
    const a = document.createElement('a')
    a.href = geotagResult.geotaggedImageBase64
    a.download = geotagResult.filename || 'geotagged_gbp_photo.jpg'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success('Downloaded geo-tagged JPG! Ready to upload to Google Maps.')
  }

  const handleAttachGeotagToPost = () => {
    if (!geotagResult?.geotaggedImageBase64) return
    setNewPost(prev => ({
      ...prev,
      mediaUrl: geotagResult.geotaggedImageBase64
    }))
    setActiveTab('posts')
    setShowNewPostModal(true)
    toast.success('Geo-tagged photo attached to Google Post! 📸')
  }

  // Handlers for Website SEO Scanner
  const handleScanWebsite = async (urlToScan?: string) => {
    const target = urlToScan || scanUrl || profile?.website_url
    if (!target) {
      toast.error('Please enter a website URL to scan')
      return
    }

    setScanningWebsite(true)
    try {
      const url = `/api/gbp/website-audit${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: target,
          businessName: profile?.business_name,
          phone: profile?.phone,
          address: profile?.location_address,
          targetKeywords: profile?.target_keywords || []
        })
      })
      const data = await res.json()
      if (data.success) {
        setWebsiteAuditResult(data)
        toast.success(`Website SEO scan complete! Score: ${data.overallScore}/100 🌐`)
      } else {
        toast.error(data.error || 'Failed to scan website')
      }
    } catch (err: any) {
      toast.error('Scan error: ' + err.message)
    } finally {
      setScanningWebsite(false)
    }
  }

  const copySchemaCode = () => {
    if (!websiteAuditResult?.generatedSchemaScript) return
    navigator.clipboard.writeText(websiteAuditResult.generatedSchemaScript)
    setCopiedSchema(true)
    toast.success('Schema.org JSON-LD copied to clipboard!')
    setTimeout(() => setCopiedSchema(false), 2500)
  }

  // Fetch initial profile
  const fetchSuiteData = async () => {
    setLoading(true)
    try {
      const url = `/api/gbp/suite${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url)
      const data = await res.json()

      if (data.success && data.profile) {
        setProfile(data.profile)
        setReviewPageUrl(data.reviewPageUrl || '')
        setIsImpersonating(!!data.isImpersonating)
        if (data.stats) {
          setStats(data.stats)
        }
        setProfileForm({
          business_name: data.profile.business_name || '',
          location_address: data.profile.location_address || '',
          phone: data.profile.phone || '',
          website_url: data.profile.website_url || '',
          primary_category: data.profile.primary_category || '',
          additional_categories: Array.isArray(data.profile.additional_categories) ? data.profile.additional_categories.join(', ') : '',
          description: data.profile.description || '',
          google_review_url: data.profile.google_review_url || '',
          target_keywords: Array.isArray(data.profile.target_keywords) ? data.profile.target_keywords.join(', ') : '',
          custom_domain: data.profile.custom_domain || ''
        })
      } else {
        toast.error(data.error || 'Failed to load GBP Suite details')
      }
    } catch (err: any) {
      toast.error('Network error loading GBP Suite: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // Fetch posts
  const fetchPosts = async () => {
    setLoadingPosts(true)
    try {
      const url = `/api/gbp/posts${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.success) {
        setPosts(data.posts || [])
      }
    } catch (err) {
      console.error('Error fetching posts:', err)
    } finally {
      setLoadingPosts(false)
    }
  }

  // Fetch feedbacks
  const fetchFeedbacks = async () => {
    setLoadingFeedbacks(true)
    try {
      const url = `/api/review/feedback${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.success) {
        setFeedbacks(data.feedbacks || [])
      }
    } catch (err) {
      console.error('Error fetching feedbacks:', err)
    } finally {
      setLoadingFeedbacks(false)
    }
  }

  useEffect(() => {
    fetchSuiteData()
    fetchPosts()
    fetchFeedbacks()
  }, [impersonateId])

  // Optimize with AI trigger
  const handleOptimizeWithAi = async (applyDirectly = false) => {
    setOptimizingAi(true)
    try {
      const url = `/api/gbp/optimize-ai${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile,
          applyDirectly
        })
      })
      const data = await res.json()

      if (data.success && data.aiOptimization) {
        setAiResults(data.aiOptimization)
        setAiResultModalOpen(true)
        if (data.applied && data.updatedProfile) {
          setProfile(data.updatedProfile)
          toast.success('AI Optimizations automatically applied to your profile! 🚀')
        } else {
          toast.success('AI Local Ranking Blueprint generated! Review suggestions below.')
        }
      } else {
        toast.error(data.error || 'AI Optimization failed')
      }
    } catch (err: any) {
      toast.error('Error during AI Optimization: ' + err.message)
    } finally {
      setOptimizingAi(false)
    }
  }

  // Apply specific AI suggestion
  const applySingleAiField = async (field: 'description' | 'categories' | 'keywords') => {
    if (!aiResults || !profile) return
    setApplyingAiField(field)
    try {
      const updatePayload: Partial<GBPOptimizationProfile> = {}
      if (field === 'description') {
        updatePayload.description = aiResults.optimizedDescription
      } else if (field === 'categories') {
        if (aiResults.primaryCategoryRecommendation) {
          updatePayload.primary_category = aiResults.primaryCategoryRecommendation
        }
        if (Array.isArray(aiResults.additionalCategoriesRecommendations)) {
          updatePayload.additional_categories = aiResults.additionalCategoriesRecommendations
        }
      } else if (field === 'keywords') {
        if (Array.isArray(aiResults.highIntentKeywords)) {
          updatePayload.target_keywords = aiResults.highIntentKeywords
        }
      }

      const url = `/api/gbp/suite${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload)
      })
      const data = await res.json()
      if (data.success && data.profile) {
        setProfile(data.profile)
        toast.success(`Successfully applied AI ${field} to profile! ✨`)
      }
    } catch (err: any) {
      toast.error('Error applying suggestion: ' + err.message)
    } finally {
      setApplyingAiField(null)
    }
  }

  // Save manual profile edits
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const payload = {
        business_name: profileForm.business_name,
        location_address: profileForm.location_address,
        phone: profileForm.phone,
        website_url: profileForm.website_url,
        primary_category: profileForm.primary_category,
        additional_categories: profileForm.additional_categories.split(',').map(s => s.trim()).filter(Boolean),
        description: profileForm.description,
        google_review_url: profileForm.google_review_url,
        target_keywords: profileForm.target_keywords.split(',').map(s => s.trim()).filter(Boolean),
        custom_domain: profileForm.custom_domain
      }

      const url = `/api/gbp/suite${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (data.success && data.profile) {
        setProfile(data.profile)
        setIsEditingProfile(false)
        toast.success('Google Business Profile details updated! ✅')
      } else {
        toast.error(data.error || 'Failed to save changes')
      }
    } catch (err: any) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setSavingProfile(false)
    }
  }

  // Handle Create Post
  const handleCreatePost = async (publishNow = true) => {
    if (!newPost.content.trim()) {
      toast.error('Please write some content for the Google post')
      return
    }
    setCreatingPost(true)
    try {
      const url = `/api/gbp/posts${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newPost,
          publishNow
        })
      })
      const data = await res.json()
      if (data.success && data.post) {
        setPosts(prev => [data.post, ...prev])
        setShowNewPostModal(false)
        setNewPost({
          postType: 'STANDARD',
          content: '',
          title: '',
          ctaType: 'BOOK',
          ctaUrl: profile?.website_url || '',
          mediaUrl: '',
          couponCode: '',
          offerStart: '',
          offerEnd: ''
        })
        toast.success(publishNow ? 'Post published to Google Business Profile! 🚀' : 'Post saved as draft!')
      } else {
        toast.error(data.error || 'Failed to create post')
      }
    } catch (err: any) {
      toast.error('Post creation error: ' + err.message)
    } finally {
      setCreatingPost(false)
    }
  }

  // Publish ready AI Post directly
  const handlePublishAiPost = async (readyPost: any) => {
    try {
      const url = `/api/gbp/posts${impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postType: readyPost.postType || 'STANDARD',
          title: readyPost.title || '',
          content: readyPost.content,
          ctaType: readyPost.ctaType || 'LEARN_MORE',
          ctaUrl: profile?.website_url || profile?.google_review_url || '',
          publishNow: true
        })
      })
      const data = await res.json()
      if (data.success) {
        fetchPosts()
        toast.success('AI Post published directly to Google! 🎉')
      }
    } catch (err: any) {
      toast.error('Failed to publish post: ' + err.message)
    }
  }

  // Copy review link
  const copyReviewLink = () => {
    if (!reviewPageUrl) return
    navigator.clipboard.writeText(reviewPageUrl)
    setCopiedLink(true)
    toast.success('Smart Review link copied to clipboard!')
    setTimeout(() => setCopiedLink(false), 2500)
  }

  // Health Score Color
  const healthScore = profile?.health_score || 50
  const scoreColor = healthScore >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
    healthScore >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-rose-600 bg-rose-50 border-rose-200'

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        <p className="text-sm font-semibold text-slate-500">Loading Google Business Profile Suite...</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-32 animate-in fade-in duration-300">
      
      {/* Impersonation Banner */}
      {isImpersonating && (
        <div className="mb-6 p-4 bg-gradient-to-r from-purple-900 to-indigo-900 text-white rounded-2xl shadow-lg border border-purple-400/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-800/80 rounded-xl">
              <UserCheck className="w-5 h-5 text-purple-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-extrabold tracking-wider bg-purple-500/40 text-purple-100 px-2.5 py-0.5 rounded-full">
                  Impersonation Mode Active
                </span>
                <span className="text-xs text-purple-200 font-medium">Agency / Super Admin View</span>
              </div>
              <p className="text-sm font-bold mt-0.5">
                Optimizing Google Business Profile for: <span className="text-purple-100 underline decoration-purple-400">{profile?.business_name || 'Client Account'}</span>
              </p>
            </div>
          </div>
          <span className="text-xs text-purple-200 bg-white/10 px-3 py-1.5 rounded-xl font-medium">
            Changes will directly apply to client's listing
          </span>
        </div>
      )}

      {/* Main Suite Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-sm mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-blue-100/40 via-indigo-50/20 to-transparent rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                <MapPin className="w-3.5 h-3.5" /> Google Business Profile Suite
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                <CheckCircle2 className="w-3 h-3" /> Live Optimization Active
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              {profile?.business_name || 'My Google Business Profile'}
            </h1>

            <p className="text-sm text-slate-600 leading-relaxed">
              Complete local SEO command center. Fix map ranking shortcomings, publish high-converting Google posts, automate 5-star Google reviews, and outrank competitors with real-time AI optimization.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-500 font-medium">
              {profile?.location_address && (
                <span className="flex items-center gap-1.5 truncate max-w-md">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {profile.location_address}
                </span>
              )}
              {profile?.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" /> {profile.phone}
                </span>
              )}
              {profile?.website_url && (
                <a href={profile.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                  <Globe className="w-3.5 h-3.5" /> Website <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          </div>

          {/* Quick Metrics & Optimize AI Action */}
          <div className="flex flex-col sm:flex-row items-stretch lg:items-center gap-4 shrink-0">
            {/* Health Score Pill */}
            <div className={`p-4 rounded-2xl border ${scoreColor} flex items-center gap-3.5 shadow-xs`}>
              <div className="relative flex items-center justify-center">
                <span className="text-2xl font-black">{healthScore}%</span>
              </div>
              <div className="space-y-0.5">
                <div className="text-[11px] font-extrabold uppercase tracking-wider">GBP Health Score</div>
                <div className="text-xs font-medium opacity-90">
                  {healthScore >= 80 ? 'Optimized for Top 3' : healthScore >= 60 ? 'Good • Needs Polish' : 'Needs Optimization'}
                </div>
              </div>
            </div>

            {/* AI Optimization Main CTA */}
            <button
              onClick={() => handleOptimizeWithAi(false)}
              disabled={optimizingAi}
              className="px-6 py-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-black text-sm shadow-md hover:shadow-xl active:scale-98 transition-all flex items-center justify-center gap-2.5 cursor-pointer group"
            >
              {optimizingAi ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Analyzing Map Competitors...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300 group-hover:rotate-12 transition-transform" />
                  <span>Optimize with AI</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick Review Gating Live URL Bar */}
        {reviewPageUrl && (
          <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50/70 p-4 rounded-2xl">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-100/70 text-amber-700 rounded-xl">
                <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-slate-800">Your Smart Review Gating Link:</span>
                <p className="text-xs text-slate-500 font-mono select-all truncate max-w-sm sm:max-w-md">
                  {reviewPageUrl}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end md:self-auto">
              <button
                onClick={copyReviewLink}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? 'Copied!' : 'Copy Link'}
              </button>
              <a
                href={reviewPageUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" /> Preview Page
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6 scrollbar-none border-b border-slate-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" /> Overview & Profile
        </button>
        <button
          onClick={() => setActiveTab('shortcomings')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'shortcomings'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Shortcomings Checklist
          {profile?.shortcomings && profile.shortcomings.filter(s => s.status !== 'pass').length > 0 && (
            <span className="px-1.5 py-0.2 bg-amber-500 text-white text-[10px] rounded-full">
              {profile.shortcomings.filter(s => s.status !== 'pass').length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('posts')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'posts'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" /> Google Posts Studio
          {posts.length > 0 && (
            <span className="px-1.5 py-0.2 bg-slate-200 text-slate-800 text-[10px] rounded-full">
              {posts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => {
            setActiveTab('geotag')
            if (profile?.latitude) setGeotagLat(profile.latitude)
            if (profile?.longitude) setGeotagLng(profile.longitude)
            if (profile?.target_keywords) setGeotagKeywords(profile.target_keywords.join(', '))
          }}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'geotag'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Camera className="w-3.5 h-3.5" /> Geo-Tag Photos
          <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">EXIF GPS</span>
        </button>
        <button
          onClick={() => {
            setActiveTab('website')
            if (profile?.website_url && !scanUrl) {
              setScanUrl(profile.website_url)
            }
          }}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'website'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Globe className="w-3.5 h-3.5" /> Website SEO Scanner
          {websiteAuditResult && (
            <span className={`px-1.5 py-0.2 text-[10px] font-bold rounded-full ${
              websiteAuditResult.overallScore >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {websiteAuditResult.overallScore}%
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('reviews')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'reviews'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Star className="w-3.5 h-3.5" /> Review Gating & Complaints
          {feedbacks.length > 0 && (
            <span className="px-1.5 py-0.2 bg-rose-500 text-white text-[10px] rounded-full">
              {feedbacks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('qa')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'qa'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" /> Google Maps Q&A
        </button>
      </div>

      {/* TAB 1: OVERVIEW & PROFILE EDITOR */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Profile Information & AI Optimizations */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">Google Business Listing Information</h2>
                  <p className="text-xs text-slate-500">Core business metadata indexed by Google Local Search algorithms</p>
                </div>
                <button
                  onClick={() => setIsEditingProfile(!isEditingProfile)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  {isEditingProfile ? 'Cancel Editing' : 'Edit Profile'}
                </button>
              </div>

              {isEditingProfile ? (
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-black uppercase text-slate-500">Business Name</label>
                      <input
                        type="text"
                        value={profileForm.business_name}
                        onChange={e => setProfileForm({ ...profileForm, business_name: e.target.value })}
                        required
                        className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-black uppercase text-slate-500">Primary Google Category</label>
                      <input
                        type="text"
                        value={profileForm.primary_category}
                        onChange={e => setProfileForm({ ...profileForm, primary_category: e.target.value })}
                        placeholder="e.g. Real Estate Agency, Dental Clinic, Cafe"
                        className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-black uppercase text-slate-500">Full Physical Address</label>
                    <input
                      type="text"
                      value={profileForm.location_address}
                      onChange={e => setProfileForm({ ...profileForm, location_address: e.target.value })}
                      placeholder="Street, City, State, ZIP code"
                      className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-black uppercase text-slate-500">Public Phone Number</label>
                      <input
                        type="tel"
                        value={profileForm.phone}
                        onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })}
                        className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-black uppercase text-slate-500">Website URL</label>
                      <input
                        type="url"
                        value={profileForm.website_url}
                        onChange={e => setProfileForm({ ...profileForm, website_url: e.target.value })}
                        placeholder="https://yourwebsite.com"
                        className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-black uppercase text-slate-500">Google Review Page URL (Target for 4+ Star ratings)</label>
                    <input
                      type="url"
                      value={profileForm.google_review_url}
                      onChange={e => setProfileForm({ ...profileForm, google_review_url: e.target.value })}
                      placeholder="https://g.page/r/.../review or https://search.google.com/local/writereview?placeid=..."
                      className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                      Visitors giving 4 or 5 stars will automatically be sent to this link.
                    </span>
                  </div>

                  <div>
                    <label className="text-[11px] font-black uppercase text-slate-500">Google Business Profile Description (Max 750 characters)</label>
                    <textarea
                      rows={4}
                      maxLength={750}
                      value={profileForm.description}
                      onChange={e => setProfileForm({ ...profileForm, description: e.target.value })}
                      placeholder="Describe your services, local community, and key offerings..."
                      className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>Include targeted local neighborhood keywords</span>
                      <span>{profileForm.description.length} / 750 chars</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-black uppercase text-slate-500">Additional Secondary Categories (comma separated)</label>
                    <input
                      type="text"
                      value={profileForm.additional_categories}
                      onChange={e => setProfileForm({ ...profileForm, additional_categories: e.target.value })}
                      placeholder="e.g. Commercial real estate agency, Property management company"
                      className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-black uppercase text-slate-500">Target Keywords (comma separated)</label>
                    <input
                      type="text"
                      value={profileForm.target_keywords}
                      onChange={e => setProfileForm({ ...profileForm, target_keywords: e.target.value })}
                      placeholder="e.g. best property dealer near me, luxury flats baner"
                      className="w-full mt-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="pt-2 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(false)}
                      className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
                    >
                      {savingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Save Profile
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl">
                    <div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Primary Category</span>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">
                        {profile?.primary_category || <span className="text-amber-600">Not Specified</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Public Phone</span>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">
                        {profile?.phone || <span className="text-amber-600">No Phone</span>}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Business Description</span>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      {profile?.description || <span className="text-slate-400 italic">No description provided yet. Click "Optimize with AI" to generate a high-ranking 750-character SEO description!</span>}
                    </p>
                    <div className="mt-2 text-[10px] text-slate-400 font-medium">
                      Length: {profile?.description?.length || 0} / 750 characters
                    </div>
                  </div>

                  {profile?.additional_categories && profile.additional_categories.length > 0 && (
                    <div className="bg-slate-50 p-4 rounded-2xl">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Secondary Categories</span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {profile.additional_categories.map((cat, idx) => (
                          <span key={idx} className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {profile?.target_keywords && profile.target_keywords.length > 0 && (
                    <div className="bg-slate-50 p-4 rounded-2xl">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Targeted Local Keywords</span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {profile.target_keywords.map((kw, idx) => (
                          <span key={idx} className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-semibold rounded-lg">
                            #{kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick AI Summary Card */}
            {profile?.ai_audit_summary && (
              <div className="bg-gradient-to-br from-indigo-50/70 via-blue-50/50 to-white border border-indigo-100 rounded-3xl p-6 shadow-xs">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950">AI Local SEO Intelligence Analysis</h3>
                </div>
                <p className="text-xs text-indigo-900 leading-relaxed font-medium">
                  {profile.ai_audit_summary}
                </p>
              </div>
            )}
          </div>

          {/* Right Col: High-Impact Manual Actions & Fast Stats */}
          <div className="space-y-6">
            {/* Quick Stat Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Google Posts</span>
                <p className="text-2xl font-black text-slate-900 mt-1">{stats.totalPosts}</p>
                <span className="text-[10px] text-emerald-600 font-semibold">{stats.publishedPosts} active</span>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Prevented Bad Reviews</span>
                <p className="text-2xl font-black text-rose-600 mt-1">{stats.totalFeedbacks}</p>
                <span className="text-[10px] text-slate-500 font-semibold">Handled privately</span>
              </div>
            </div>

            {/* Step-by-Step Physical / Manual Action Steps */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-600" /> Action Steps to Rank #1
                </h3>
                <span className="text-[10px] text-slate-400 font-semibold">Priority Checklist</span>
              </div>

              <div className="space-y-3">
                {(profile?.manual_action_steps && profile.manual_action_steps.length > 0 ? profile.manual_action_steps : [
                  {
                    title: 'Upload 10+ Geo-Tagged Storefront Photos',
                    priority: 'HIGH',
                    impact: 'Boosts Local Pack Visibility by 35%',
                    instructions: 'Take real photos from outside with your smartphone (GPS enabled), including interior, exterior, team, and customer entrance.'
                  },
                  {
                    title: 'Seed 5 High-Intent Q&A FAQs on Google Maps',
                    priority: 'MEDIUM',
                    impact: 'Captures "Near Me" voice and search queries',
                    instructions: 'Navigate to your Google Maps listing as a user, post common pricing/timings questions, and answer them with your official business account.'
                  },
                  {
                    title: 'Post 1 Google Update Every Week',
                    priority: 'HIGH',
                    impact: 'Signals fresh activity to Google Search crawlers',
                    instructions: 'Use the Google Posts Studio tab below to publish weekly promotions, new inventory arrivals, or client case studies.'
                  }
                ]).map((step, idx) => (
                  <div key={idx} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 hover:border-blue-200 transition-all space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">{step.title}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
                        step.priority === 'HIGH' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {step.priority}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-normal">{step.instructions}</p>
                    <div className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" /> {step.impact}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SHORTCOMINGS CHECKLIST */}
      {activeTab === 'shortcomings' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 mb-6">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Google Business Profile Shortcomings</h2>
                <p className="text-xs text-slate-500">
                  Every issue below negatively impacts your Google Maps 3-Pack local ranking. Fix them to climb to #1.
                </p>
              </div>
              <button
                onClick={() => handleOptimizeWithAi(false)}
                disabled={optimizingAi}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" /> AI Fix Suggestions
              </button>
            </div>

            <div className="space-y-3">
              {profile?.shortcomings && profile.shortcomings.length > 0 ? (
                profile.shortcomings.map(item => (
                  <div
                    key={item.id}
                    className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      item.status === 'pass'
                        ? 'bg-emerald-50/40 border-emerald-100 text-emerald-950'
                        : item.severity === 'high'
                        ? 'bg-rose-50/50 border-rose-200 text-rose-950'
                        : 'bg-amber-50/50 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="mt-0.5">
                        {item.status === 'pass' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        ) : item.severity === 'high' ? (
                          <AlertTriangle className="w-5 h-5 text-rose-600" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold">{item.title}</span>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                            item.status === 'pass'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.severity === 'high'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {item.status === 'pass' ? 'RESOLVED' : `${item.severity} priority`}
                          </span>
                        </div>
                        <p className="text-xs opacity-90 leading-relaxed">{item.description}</p>
                        <p className="text-[11px] font-semibold text-blue-700 pt-0.5">
                          💡 How to fix: {item.recommendation}
                        </p>
                      </div>
                    </div>

                    {item.status !== 'pass' && (
                      <button
                        onClick={() => {
                          if (item.id === 'google_review_url' || item.id === 'description' || item.id === 'additional_categories') {
                            setActiveTab('overview')
                            setIsEditingProfile(true)
                          } else if (item.id === 'recent_post') {
                            setActiveTab('posts')
                            setShowNewPostModal(true)
                          } else {
                            handleOptimizeWithAi(false)
                          }
                        }}
                        className="px-3.5 py-2 bg-white text-slate-800 hover:bg-slate-100 border border-slate-200 text-xs font-bold rounded-xl shadow-2xs self-start sm:self-center shrink-0 cursor-pointer"
                      >
                        Fix Now →
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                  <p className="text-sm font-bold text-slate-700">No shortcomings found!</p>
                  <p className="text-xs text-slate-500 mt-1">Your profile meets standard Google Business Profile requirements.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: GOOGLE POSTS STUDIO */}
      {activeTab === 'posts' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 mb-6">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Google Business Profile Posts Studio</h2>
                <p className="text-xs text-slate-500">
                  Publish updates, special discount offers, and events straight to Google Search & Maps
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNewPostModal(true)}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Create New Google Post
                </button>
              </div>
            </div>

            {/* Ready AI Posts Generator Suggestion */}
            {aiResults?.readyPosts && aiResults.readyPosts.length > 0 && (
              <div className="mb-6 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-blue-950">AI Generated Posts (Ready to Publish in 1 Click)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {aiResults.readyPosts.map((rPost: any, idx: number) => (
                    <div key={idx} className="bg-white p-4 rounded-xl border border-blue-100 shadow-2xs space-y-2 flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                          {rPost.postType || 'UPDATE'}
                        </span>
                        {rPost.title && <h4 className="text-xs font-bold text-slate-900 mt-1">{rPost.title}</h4>}
                        <p className="text-xs text-slate-600 mt-1 line-clamp-3">{rPost.content}</p>
                      </div>
                      <button
                        onClick={() => handlePublishAiPost(rPost)}
                        className="w-full mt-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                      >
                        <Send className="w-3 h-3" /> Publish to Google Now
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Posts History */}
            {loadingPosts ? (
              <div className="py-12 flex justify-center items-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : posts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {posts.map(post => (
                  <div key={post.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700">
                          {post.post_type}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          post.status === 'PUBLISHED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {post.status}
                        </span>
                      </div>
                      {post.title && <h3 className="text-xs font-extrabold text-slate-900 mt-2">{post.title}</h3>}
                      <p className="text-xs text-slate-700 mt-1.5 leading-relaxed whitespace-pre-wrap">{post.content}</p>
                    </div>

                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                      <span>CTA: {post.cta_type || 'None'}</span>
                      <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <Calendar className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-700">No Google Posts Yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Google rewards businesses that post updates at least once every 7 days with higher local map placement.
                </p>
                <button
                  onClick={() => setShowNewPostModal(true)}
                  className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl cursor-pointer"
                >
                  Write Your First Post
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: GEOTAG PHOTOS STUDIO */}
      {activeTab === 'geotag' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 mb-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                    <Camera className="w-5 h-5" />
                  </span>
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">EXIF Geo-Tagging Image Studio</h2>
                </div>
                <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
                  Google Maps search algorithms inspect the hidden EXIF GPS tags inside uploaded photos to verify physical presence. Embed your exact latitude and longitude into photos before publishing to boost local 3-pack rankings.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-[10px] font-black uppercase px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full flex items-center gap-1.5">
                  <CheckCircle className="w-3 h-3" /> Sharp 16-Bit EXIF Engine Active
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column: Image Upload & Geo Parameters */}
              <div className="lg:col-span-6 space-y-5">
                {/* File Dropzone */}
                <div>
                  <label className="text-[11px] font-black uppercase text-slate-500 block mb-1.5">
                    1. Upload Photo (Storefront, Office, Team, or Work)
                  </label>
                  <label className="relative border-2 border-dashed border-slate-200 hover:border-emerald-400 bg-slate-50/60 hover:bg-emerald-50/20 rounded-2xl p-6 flex flex-col items-center justify-center gap-2.5 cursor-pointer transition-all">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="p-3 bg-white text-slate-600 rounded-2xl shadow-xs border border-slate-200">
                      <UploadCloud className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div className="text-center space-y-0.5">
                      <p className="text-xs font-bold text-slate-800">
                        {geotagImagePreview ? 'Change Selected Photo' : 'Click or drag photo here'}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium">Supports JPG, PNG, and WebP (up to 20MB)</p>
                    </div>
                  </label>
                </div>

                {/* Coordinates Configurator */}
                <div className="space-y-3 bg-slate-50/70 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase text-slate-600 flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-emerald-600" /> 2. Target GPS Coordinates
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (profile?.latitude && profile?.longitude) {
                          setGeotagLat(profile.latitude)
                          setGeotagLng(profile.longitude)
                          toast.success('Coordinates set from your Google Business Profile!')
                        } else {
                          toast.info('Using default local coordinates for your area.')
                        }
                      }}
                      className="text-[10px] font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Use Profile Location
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-extrabold text-slate-500">Latitude (North/South)</label>
                      <input
                        type="number"
                        step="any"
                        value={geotagLat}
                        onChange={e => setGeotagLat(e.target.value)}
                        placeholder="e.g. 18.5204"
                        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-extrabold text-slate-500">Longitude (East/West)</label>
                      <input
                        type="number"
                        step="any"
                        value={geotagLng}
                        onChange={e => setGeotagLng(e.target.value)}
                        placeholder="e.g. 73.8567"
                        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Local SEO Keywords Tagging */}
                <div>
                  <label className="text-[11px] font-black uppercase text-slate-500 block mb-1">
                    3. Target Local Keywords (Embedded in EXIF Metadata)
                  </label>
                  <input
                    type="text"
                    value={geotagKeywords}
                    onChange={e => setGeotagKeywords(e.target.value)}
                    placeholder="e.g. best property dealer near me, luxury apartments"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Google Image Search indexes these EXIF keywords for localized search intent.
                  </span>
                </div>

                {/* Submit Action */}
                <button
                  type="button"
                  onClick={handleGeotagImage}
                  disabled={geotaggingLoading || !geotagRawBase64}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {geotaggingLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Embedding EXIF GPS Data...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      <span>Inject EXIF GPS & Tag Photo</span>
                    </>
                  )}
                </button>
              </div>

              {/* Right Column: Live Photo Preview & EXIF Verification Card */}
              <div className="lg:col-span-6 space-y-4">
                <span className="text-[11px] font-black uppercase text-slate-500 block">
                  Photo Preview & Verified EXIF Tagging Status
                </span>

                {geotagImagePreview ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
                    <div className="relative rounded-xl overflow-hidden max-h-72 bg-black flex items-center justify-center">
                      <img
                        src={geotagResult?.geotaggedImageBase64 || geotagImagePreview}
                        alt="Preview"
                        className="object-contain max-h-72 w-full"
                      />
                      {geotagResult && (
                        <div className="absolute top-2.5 left-2.5 bg-emerald-950/80 backdrop-blur-xs text-emerald-200 border border-emerald-400/40 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-sm">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> EXIF GPS Verified
                        </div>
                      )}
                    </div>

                    {geotagResult ? (
                      <div className="space-y-3 pt-1">
                        <div className="p-3.5 rounded-xl bg-white border border-emerald-100 space-y-2">
                          <div className="flex items-center justify-between text-xs font-extrabold text-slate-800">
                            <span>Embedded GPS Coordinates</span>
                            <span className="text-emerald-700 font-mono">
                              {geotagResult.coordinates.latitude.toFixed(5)}° {geotagResult.coordinates.latRef}, {geotagResult.coordinates.longitude.toFixed(5)}° {geotagResult.coordinates.lngRef}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                            <span>Camera DMS: {geotagResult.coordinates.latDms}</span>
                            <span>•</span>
                            <span>Altitude: {geotagResult.coordinates.altitude}m</span>
                            <span>•</span>
                            <span>Size: {(geotagResult.sizeBytes / 1024).toFixed(1)} KB</span>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleDownloadGeotaggedImage}
                            className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Download className="w-3.5 h-3.5" /> Download Geo-Tagged JPG
                          </button>
                          <button
                            type="button"
                            onClick={handleAttachGeotagToPost}
                            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Send className="w-3.5 h-3.5" /> Attach to Google Post
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic text-center py-2">
                        Photo selected. Click "Inject EXIF GPS & Tag Photo" to embed verified location metadata.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="border border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 bg-slate-50/50">
                    <Camera className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-bold text-slate-600">No Image Uploaded Yet</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Select any photo from your office, clinic, or job site on the left to get started.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: WEBSITE SEO & GOOGLE RANKING SCANNER */}
      {activeTab === 'website' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 mb-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                    <Globe className="w-5 h-5" />
                  </span>
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">Website Local SEO & Google 3-Pack Scanner</h2>
                </div>
                <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
                  Google relies heavily on your website's signals (NAP consistency, Schema.org LocalBusiness markup, and title tag city keywords) to rank your business in the Google Maps 3-Pack. Scan your website below to identify gaps.
                </p>
              </div>
            </div>

            {/* URL Input Bar */}
            <div className="flex flex-col sm:flex-row items-stretch gap-3 mb-8">
              <div className="relative flex-1">
                <Globe className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={scanUrl}
                  onChange={e => setScanUrl(e.target.value)}
                  placeholder="https://yourwebsite.com"
                  className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                />
              </div>
              <button
                type="button"
                onClick={() => handleScanWebsite()}
                disabled={scanningWebsite}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white font-extrabold text-xs rounded-2xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                {scanningWebsite ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Analyzing Ranking Signals...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Scan Website Now</span>
                  </>
                )}
              </button>
            </div>

            {/* Audit Results View */}
            {websiteAuditResult ? (
              <div className="space-y-8 animate-in fade-in duration-300">
                {/* Score Summary Grid */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {/* Big Overall Score Card */}
                  <div className="md:col-span-1 p-5 rounded-3xl bg-slate-900 text-white flex flex-col items-center justify-center text-center shadow-sm">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">SEO Score</span>
                    <span className="text-4xl font-black mt-1 text-emerald-400">{websiteAuditResult.overallScore}%</span>
                    <span className={`mt-2 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                      websiteAuditResult.overallScore >= 80 ? 'bg-emerald-500/20 text-emerald-300' :
                      websiteAuditResult.overallScore >= 60 ? 'bg-amber-500/20 text-amber-300' :
                      'bg-rose-500/20 text-rose-300'
                    }`}>
                      {websiteAuditResult.overallScore >= 80 ? 'Top 3 Ready' : websiteAuditResult.overallScore >= 60 ? 'Needs Work' : 'Critical Issues'}
                    </span>
                  </div>

                  {/* 4 Category Subscores */}
                  <div className="md:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Meta Tags</span>
                      <p className="text-xl font-black text-slate-900">{websiteAuditResult.breakdown.metaScore}%</p>
                      <span className="text-[10px] text-slate-500">Title & Description</span>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Local Signals</span>
                      <p className="text-xl font-black text-slate-900">{websiteAuditResult.breakdown.localNapScore}%</p>
                      <span className="text-[10px] text-slate-500">NAP & Schema</span>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Headings</span>
                      <p className="text-xl font-black text-slate-900">{websiteAuditResult.breakdown.contentScore}%</p>
                      <span className="text-[10px] text-slate-500">H1, H2 & Media</span>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Keywords</span>
                      <p className="text-xl font-black text-slate-900">{websiteAuditResult.breakdown.keywordSynergyScore}%</p>
                      <span className="text-[10px] text-slate-500">GBP Match</span>
                    </div>
                  </div>
                </div>

                {/* NAP Consistency Comparison Matrix */}
                <div className="bg-slate-50/70 border border-slate-200/80 rounded-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/60">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" /> NAP Consistency Check (Google Maps #1 Trust Metric)
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Google compares website data against your Google Business Profile to verify credibility.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-2xl bg-white border border-slate-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Business Phone</span>
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-xs font-bold text-slate-800">{profile?.phone || 'No Phone'}</span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          websiteAuditResult.localSignals.phonePresent ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {websiteAuditResult.localSignals.phonePresent ? 'MATCH' : 'MISMATCH'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white border border-slate-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Location City</span>
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-xs font-bold text-slate-800 truncate max-w-[130px]">{profile?.location_address || 'Address'}</span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          websiteAuditResult.localSignals.addressPresent ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {websiteAuditResult.localSignals.addressPresent ? 'MATCH' : 'MISMATCH'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white border border-slate-100 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Google Maps Embed</span>
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-xs font-bold text-slate-800">Map Iframe</span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          websiteAuditResult.localSignals.hasMapEmbed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {websiteAuditResult.localSignals.hasMapEmbed ? 'DETECTED' : 'MISSING'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Keywords Synergy Matrix (GBP vs Website) */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                        <TrendingUp className="w-4 h-4 text-blue-600" /> Keywords Synergy Matrix (GBP vs Website)
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Cross-analyzing keywords on your Google Business Profile with actual occurrences on your website
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {websiteAuditResult.keywordsSynergy.map((kwItem: any, idx: number) => (
                      <div key={idx} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-extrabold text-slate-900">#{kwItem.keyword}</span>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              kwItem.status === 'strong' ? 'bg-emerald-100 text-emerald-800' :
                              kwItem.status === 'moderate' ? 'bg-amber-100 text-amber-800' :
                              'bg-rose-100 text-rose-800'
                            }`}>
                              {kwItem.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 font-medium">{kwItem.recommendation}</p>
                        </div>
                        <div className="text-[11px] font-bold text-slate-500 self-start sm:self-center shrink-0">
                          {kwItem.occurrences}x on page {kwItem.inTitle && '• In Title'} {kwItem.inH1 && '• In H1'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Schema.org LocalBusiness Markup Card */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                        <Code className="w-4 h-4 text-purple-600" /> Recommended Schema.org LocalBusiness Markup
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Copy and paste this JSON-LD script tag directly into your website's &lt;head&gt; tag for immediate ranking boost
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copySchemaCode}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs cursor-pointer self-start sm:self-auto shrink-0"
                    >
                      {copiedSchema ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSchema ? 'Copied Schema Code!' : 'Copy Schema Code'}
                    </button>
                  </div>

                  <pre className="p-4 bg-slate-950 text-emerald-400 rounded-2xl text-[11px] font-mono overflow-x-auto max-h-56">
                    {websiteAuditResult.generatedSchemaScript}
                  </pre>
                </div>

                {/* Issues & Opportunities Checklist */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                      Website SEO Issues & Opportunities ({websiteAuditResult.checklist.length})
                    </h3>
                  </div>

                  <div className="space-y-3">
                    {websiteAuditResult.checklist.map((item: any) => (
                      <div
                        key={item.id}
                        className={`p-4 rounded-2xl border transition-all space-y-1.5 ${
                          item.status === 'pass' ? 'bg-emerald-50/40 border-emerald-100 text-emerald-950' :
                          item.severity === 'high' ? 'bg-rose-50/40 border-rose-200 text-rose-950' :
                          'bg-amber-50/40 border-amber-200 text-amber-950'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black">{item.title}</span>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                            item.status === 'pass' ? 'bg-emerald-100 text-emerald-800' :
                            item.severity === 'high' ? 'bg-rose-100 text-rose-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {item.status === 'pass' ? 'PASSED' : `${item.severity} severity`}
                          </span>
                        </div>
                        <p className="text-xs opacity-90 leading-relaxed">{item.description}</p>
                        <p className="text-[11px] font-bold text-blue-700 pt-0.5">
                          💡 Action: {item.action}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 bg-slate-50/50">
                <Globe className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-bold text-slate-600">No Website Scanned Yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Enter your business website URL above and click "Scan Website Now" to perform a deep local SEO audit.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: REVIEW GATING & SMART FEEDBACK */}
      {activeTab === 'reviews' && (
        <div className="space-y-6">
          {/* Smart Review Gating Information & QR Code */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                    <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                  </span>
                  <h2 className="text-base font-extrabold text-slate-900">Smart Review Gating Engine</h2>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  How it protects your reputation: When customers click your review link, ratings of <strong>4 or 5 stars</strong> are sent directly to your official Google Review page to submit. Ratings of <strong>1, 2, or 3 stars</strong> are intercepted privately here on your dashboard so you can resolve complaints before they become permanent 1-star public Google reviews.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={copyReviewLink}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedLink ? 'Copied Review Link!' : 'Copy Review Link'}
                  </button>
                  <a
                    href={reviewPageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open Review Page
                  </a>
                </div>
              </div>

              {/* QR Code Card */}
              {reviewPageUrl && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center gap-2 shrink-0">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(reviewPageUrl)}`}
                    alt="Review QR Code"
                    className="w-28 h-28 rounded-lg bg-white p-1 border border-slate-200"
                  />
                  <span className="text-[10px] font-black uppercase text-slate-500">Scan For Google Review</span>
                  <a
                    href={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(reviewPageUrl)}`}
                    download="google-review-qr.png"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Download className="w-2.5 h-2.5" /> Download QR For Stand
                  </a>
                </div>
              )}
            </div>

            {/* Intercepted Bad Feedbacks Log (< 4 Stars) */}
            <div className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <HeartHandshake className="w-4 h-4 text-rose-500" /> Intercepted Private Complaints ({feedbacks.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Customers who rated under 4 stars. Follow up to resolve their issue before they post publicly.
                  </p>
                </div>
                <button
                  onClick={fetchFeedbacks}
                  className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100"
                  title="Refresh Complaints"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {loadingFeedbacks ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : feedbacks.length > 0 ? (
                <div className="space-y-3">
                  {feedbacks.map(fb => (
                    <div key={fb.id} className="p-4 rounded-2xl bg-rose-50/40 border border-rose-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-slate-900">{fb.customer_name || 'Anonymous Customer'}</span>
                          <span className="flex items-center text-amber-500 text-xs font-bold">
                            {Array.from({ length: fb.rating }).map((_, i) => (
                              <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
                            ))}
                            <span className="ml-1 text-[11px] text-slate-600">({fb.rating}/5)</span>
                          </span>
                        </div>
                        {fb.feedback_text && (
                          <p className="text-xs text-slate-700 italic bg-white/80 p-2.5 rounded-xl border border-rose-100/60">
                            "{fb.feedback_text}"
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-1">
                          {fb.customer_phone && <span>📞 {fb.customer_phone}</span>}
                          {fb.customer_email && <span>✉️ {fb.customer_email}</span>}
                          <span>📅 {new Date(fb.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {fb.customer_phone && (
                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                          <a
                            href={`https://wa.me/${fb.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${fb.customer_name || ''}, thank you for your recent feedback regarding your experience with ${profile?.business_name || 'us'}. We take your satisfaction seriously and would love to make it right.`)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1 shadow-2xs"
                          >
                            <MessageSquare className="w-3 h-3" /> WhatsApp
                          </a>
                          <a
                            href={`tel:${fb.customer_phone}`}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center gap-1 shadow-2xs"
                          >
                            <Phone className="w-3 h-3" /> Call Customer
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1.5" />
                  <p className="text-xs font-bold text-slate-700">Zero Unresolved Grievances</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Any low star feedback submitted on your review page will appear here instantly for rapid resolution.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: GOOGLE MAPS Q&A */}
      {activeTab === 'qa' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 mb-6">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Google Maps Q&A Optimization</h2>
                <p className="text-xs text-slate-500">
                  Seed targeted FAQs directly onto your Google Maps listing to capture conversational search traffic
                </p>
              </div>
              <button
                onClick={() => handleOptimizeWithAi(false)}
                disabled={optimizingAi}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" /> Generate Fresh Q&A Pairs
              </button>
            </div>

            <div className="space-y-4">
              {(aiResults?.seedQaPairs || [
                {
                  question: `What are your consultation or booking hours at ${profile?.business_name || 'your business'}?`,
                  answer: `We are open Monday through Saturday from 9:30 AM to 7:00 PM. You can also book a dedicated appointment directly through our website or phone number.`
                },
                {
                  question: `Do you offer services in the nearby surrounding neighborhoods?`,
                  answer: `Yes! While based at ${profile?.location_address || 'our primary location'}, we actively serve clients across the entire local metropolitan area.`
                },
                {
                  question: `How can I request pricing or an initial quote?`,
                  answer: `You can give our office a call at ${profile?.phone || 'our phone number'} or visit our website to get a prompt, transparent estimate.`
                }
              ]).map((qa: any, idx: number) => (
                <div key={idx} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-black rounded-md">Q</span>
                    <h4 className="text-xs font-extrabold text-slate-900">{qa.question}</h4>
                  </div>
                  <div className="flex items-start gap-2.5 pl-6">
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-md">A</span>
                    <p className="text-xs text-slate-700 leading-relaxed font-medium">{qa.answer}</p>
                  </div>
                  <div className="pl-6 pt-1 flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`Question: ${qa.question}\nAnswer: ${qa.answer}`)
                        toast.success('Q&A pair copied! Paste into Google Maps.')
                      }}
                      className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-2.5 h-2.5" /> Copy Q&A Pair
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE NEW GOOGLE POST */}
      {showNewPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" /> New Google Business Post
              </h3>
              <button onClick={() => setShowNewPostModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500">Post Type</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(['STANDARD', 'OFFER', 'EVENT'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setNewPost({ ...newPost, postType: type })}
                      className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                        newPost.postType === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {newPost.postType !== 'STANDARD' && (
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500">Post Title</label>
                  <input
                    type="text"
                    value={newPost.title}
                    onChange={e => setNewPost({ ...newPost, title: e.target.value })}
                    placeholder="e.g. 20% Off Weekend Special"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] font-black uppercase text-slate-500">Post Content / Details</label>
                <textarea
                  rows={4}
                  value={newPost.content}
                  onChange={e => setNewPost({ ...newPost, content: e.target.value })}
                  placeholder="Share news, updates, or current promotions with local customers on Google..."
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500">Call to Action (CTA)</label>
                  <select
                    value={newPost.ctaType}
                    onChange={e => setNewPost({ ...newPost, ctaType: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="BOOK">Book Appointment</option>
                    <option value="CALL">Call Now</option>
                    <option value="LEARN_MORE">Learn More</option>
                    <option value="SIGN_UP">Sign Up</option>
                    <option value="ORDER">Order Online</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500">Target Button URL</label>
                  <input
                    type="url"
                    value={newPost.ctaUrl}
                    onChange={e => setNewPost({ ...newPost, ctaUrl: e.target.value })}
                    placeholder={profile?.website_url || 'https://yourwebsite.com'}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-500">Photo / Image URL (Optional)</label>
                <input
                  type="url"
                  value={newPost.mediaUrl}
                  onChange={e => setNewPost({ ...newPost, mediaUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewPostModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCreatePost(false)}
                disabled={creatingPost}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl"
              >
                Save Draft
              </button>
              <button
                type="button"
                onClick={() => handleCreatePost(true)}
                disabled={creatingPost}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                {creatingPost ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Publish to Google
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AI OPTIMIZATION RESULTS BLUEPRINT */}
      {aiResultModalOpen && aiResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">AI Local SEO Ranking Optimization</h3>
                  <p className="text-xs text-slate-500">Customized for {profile?.business_name} & your local market</p>
                </div>
              </div>
              <button
                onClick={() => setAiResultModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Optimized Description */}
            <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase text-slate-600 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600" /> AI-Crafted 750-Character Description
                </span>
                <button
                  onClick={() => applySingleAiField('description')}
                  disabled={applyingAiField === 'description'}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer shadow-2xs"
                >
                  {applyingAiField === 'description' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Apply To Profile
                </button>
              </div>
              <p className="text-xs text-slate-800 leading-relaxed font-medium bg-white p-3 rounded-xl border border-slate-100">
                {aiResults.optimizedDescription}
              </p>
            </div>

            {/* Categories */}
            <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase text-slate-600 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-indigo-600" /> Recommended Google Categories
                </span>
                <button
                  onClick={() => applySingleAiField('categories')}
                  disabled={applyingAiField === 'categories'}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer shadow-2xs"
                >
                  {applyingAiField === 'categories' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Apply Categories
                </button>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-100 space-y-2 text-xs">
                <div>
                  <span className="font-extrabold text-slate-500 text-[10px] uppercase">Primary:</span>{' '}
                  <span className="font-bold text-slate-900">{aiResults.primaryCategoryRecommendation}</span>
                </div>
                {aiResults.additionalCategoriesRecommendations && (
                  <div>
                    <span className="font-extrabold text-slate-500 text-[10px] uppercase">Secondary:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {aiResults.additionalCategoriesRecommendations.map((cat: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 font-medium rounded-md text-[11px]">
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* High-Intent Keywords */}
            {aiResults.highIntentKeywords && (
              <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase text-slate-600 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> High-Intent Keywords To Embed
                  </span>
                  <button
                    onClick={() => applySingleAiField('keywords')}
                    disabled={applyingAiField === 'keywords'}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer shadow-2xs"
                  >
                    {applyingAiField === 'keywords' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Save Keywords
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 bg-white p-3 rounded-xl border border-slate-100">
                  {aiResults.highIntentKeywords.map((kw: string, i: number) => (
                    <span key={i} className="px-2.5 py-1 bg-emerald-50 text-emerald-800 font-semibold rounded-lg text-xs border border-emerald-100">
                      #{kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setAiResultModalOpen(false)}
                className="px-6 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Done Reviewing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
