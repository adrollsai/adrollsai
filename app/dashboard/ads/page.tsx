'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, X, LayoutGrid, Zap, Sparkles, MapPin, RefreshCw, Loader2, CreditCard, Eye, MousePointerClick, Users, Image as ImageIcon, Upload, CheckCircle, Check, Settings2, PlusCircle, Maximize2, TrendingUp, ExternalLink, PlayCircle, PauseCircle, Video, XCircle, ArrowRight, Link2, Pencil, BarChart4, Trash2, Search } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import ImagePreviewModal from '@/components/ImagePreviewModal'
import { useRouter, useSearchParams } from 'next/navigation'
import { getLocalCache, setLocalCache, mergeCacheData, getMaxCreatedAt } from '@/utils/client-cache'
import LazyVideo from '@/components/LazyVideo'
import { uploadToR2 } from '@/utils/upload-helper'

type Property = { id: string; title: string; price: string; image_url: string; description?: string }
type Asset = { id: string; type: 'image' | 'video'; url: string; property_id?: string; master_creative_id?: string; caption?: string; status?: string; metadata?: any }
type Campaign = { id: string; name: string; status: string; objective: string }
type LocationOption = { key: string; name: string; type: string; region?: string; country_code?: string; }
type CustomQuestion = { label: string; type: 'SHORT_ANSWER' | 'MULTIPLE_CHOICE'; options?: string[]; disqualifyingOptions?: string[] }

type SelectedCreative = {
  uid: string;
  sourceType: 'inventory' | 'asset' | 'local';
  id?: string;
  url?: string;
  imageUrl?: string;
  image_url?: string;
  file?: File;
  previewUrl: string;
  name: string;
  type?: 'image' | 'video';
  thumbnailUrl?: string;
  mappedProductId?: string;
}

const GENDERS = ['All', 'Male', 'Female']

export default function AdsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null) 
  const optimizerFileInputRef = useRef<HTMLInputElement>(null)
  
  // Data States
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('')
  const [remarketSourceCampaign, setRemarketSourceCampaign] = useState<Campaign | null>(null)
  const [activeExplorerCampaign, setActiveExplorerCampaign] = useState<Campaign | null>(null)
  const [explorerData, setExplorerData] = useState<any>(null)
  const [loadingExplorer, setLoadingExplorer] = useState(false)
  const [expandedAdSets, setExpandedAdSets] = useState<string[]>([])
  const [editingNode, setEditingNode] = useState<{
    id: string;
    type: 'campaign' | 'adset' | 'ad';
    name: string;
    budget?: number;
    budgetType?: string;
    creative?: {
      id?: string;
      imageHash?: string;
      imageUrl?: string;
      isVideo?: boolean;
      videoSourceUrl?: string;
      primaryText?: string;
      headline?: string;
      description?: string;
      linkUrl?: string;
      leadFormId?: string;
      pageId?: string;
    };
    targeting?: {
      locations: {
        key: string;
        name: string;
        type: string;
        radius?: number;
        country_code?: string;
      }[];
    };
  } | null>(null)
  const [explorerAssetSelectorTarget, setExplorerAssetSelectorTarget] = useState<string | null>(null)
  const [adsetSearchText, setAdsetSearchText] = useState('')
  const [adsetSearchResults, setAdsetSearchResults] = useState<LocationOption[]>([])
  const [isSearchingAdsetLocation, setIsSearchingAdsetLocation] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [inlineLinkEdit, setInlineLinkEdit] = useState<{ adId: string; url: string; saving: boolean } | null>(null)
  const [selectedCreatives, setSelectedCreatives] = useState<SelectedCreative[]>([])
  const [showAssetSelector, setShowAssetSelector] = useState<{isOpen: boolean, type: 'library' | 'batch'}>({isOpen: false, type: 'library'})
  const [assetFilter, setAssetFilter] = useState<string>('All')
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [assets, setAssets] = useState<Asset[]>([]) 
  
  // Landing Page & Form builder states for campaigns
  const [landingPages, setLandingPages] = useState<any[]>([])
  const [forms, setForms] = useState<any[]>([])
  const [metaLeadForms, setMetaLeadForms] = useState<any[]>([])
  const [campaignType, setCampaignType] = useState<'instant_form' | 'website_conversion' | 'whatsapp_chat'>('instant_form')
  const [selectedLandingPageId, setSelectedLandingPageId] = useState<string>('')
  const [attachedFormName, setAttachedFormName] = useState<string>('')
  const [targetUserId, setTargetUserId] = useState<string>('')
  const [customDomain, setCustomDomain] = useState<string>('')
  const [pixels, setPixels] = useState<any[]>([])
  const [isLoadingPixels, setIsLoadingPixels] = useState(false)
  
  // Profile / Config States
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string | null>(null)
  const [facebookToken, setFacebookToken] = useState<string | null>(null)
  const [accountStatus, setAccountStatus] = useState<any>(null)
  const [checkingSanity, setCheckingSanity] = useState(false)
  const [isCreatingPixel, setIsCreatingPixel] = useState(false)
  const [currency, setCurrency] = useState('INR')
  const [pixelId, setPixelId] = useState<string | null>(null)


  // Ad Lead Form Edit/Creation States
  const [isCreatingNewAdForm, setIsCreatingNewAdForm] = useState(false)
  const [newAdFormName, setNewAdFormName] = useState('')
  const [adFormQuestions, setAdFormQuestions] = useState<any[]>([])
  const [availableWhatsAppNumbers, setAvailableWhatsAppNumbers] = useState<string[]>([])
  const [selectedWhatsAppNumber, setSelectedWhatsAppNumber] = useState<string>('')
  const [leadLandingType, setLeadLandingType] = useState<'website' | 'whatsapp'>('website')
  const [isAddingAdQuestion, setIsAddingAdQuestion] = useState(false)
  const [newAdQuestion, setNewAdQuestion] = useState<any>({ label: '', type: 'SHORT_ANSWER', options: [''] })
  const [isCreatingFormOnMeta, setIsCreatingFormOnMeta] = useState(false)
  const [expandedQuestionIndices, setExpandedQuestionIndices] = useState<Record<number, boolean>>({})

  // Location Search
  const [locationSearchText, setLocationSearchText] = useState('')
  const [locationResults, setLocationResults] = useState<LocationOption[]>([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)

  const [statsModal, setStatsModal] = useState<{ isOpen: boolean, campaign: Campaign | null, insights: any, loading: boolean }>({ isOpen: false, campaign: null, insights: null, loading: false })
  const [analysisModal, setAnalysisModal] = useState<{
    isOpen: boolean;
    campaign: Campaign | null;
    history: any[];
    selectedAnalysis: any | null;
    loadingHistory: boolean;
    generating: boolean;
  }>({
    isOpen: false,
    campaign: null,
    history: [],
    selectedAnalysis: null,
    loadingHistory: false,
    generating: false
  })
  const [statsDatePreset, setStatsDatePreset] = useState<string>('maximum')
  const [statsSince, setStatsSince] = useState<string>('')
  const [statsUntil, setStatsUntil] = useState<string>('')
  const [statsTab, setStatsTab] = useState<'overview' | 'daily' | 'creatives'>('overview')
  const [chartMetric, setChartMetric] = useState<'spend' | 'leads' | 'clicks'>('spend')
  const [campaignLeadCounts, setCampaignLeadCounts] = useState<Record<string, number>>({})
  
  const [orchestrator, setOrchestrator] = useState<{
    isOpen: boolean,
    mode: 'optimize' | 'remarketing' | null,
    campaign: Campaign | null,
    status: 'setup' | 'analyzing' | 'presenting' | 'generating' | 'reviewing' | 'picking' | 'pushing' | 'success' | 'error',
    step: 1 | 2 | 3 | 4, // 1: Strategy, 2: Assets, 3: Review, 4: Success
    logs: { id: number, text: string, type: 'system' | 'ai' | 'user' }[],
    variations: any[],
    selectedVariations: number[],
    winningImageUrls: string[],
    insight: string,
    leadFormId: string | null,
    batchId: string | null,
    generationCount: number,
    style: 'hyper' | 'organic',
    customInstructions: string,
    isManual?: boolean
  }>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('adrolls_orchestrator_cache');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return { 
                    isOpen: false, mode: null, campaign: null, status: 'setup', step: 1, logs: [], 
                    variations: parsed.variations || [], 
                    selectedVariations: parsed.selectedVariations || [], 
                    winningImageUrls: [], insight: '', leadFormId: null, batchId: null, 
                    generationCount: 5, style: 'hyper', customInstructions: '', isManual: false
                };
            } catch (e) {}
        }
    }
    return { isOpen: false, mode: null, campaign: null, status: 'setup', step: 1, logs: [], variations: [], selectedVariations: [], winningImageUrls: [], insight: '', leadFormId: null, batchId: null, generationCount: 5, style: 'hyper', customInstructions: '', isManual: false };
  });

  // Save orchestrator state to local storage whenever variations change
  useEffect(() => {
      if (orchestrator.variations.length > 0) {
          try {
              localStorage.setItem('adrolls_orchestrator_cache', JSON.stringify({
                  variations: orchestrator.variations,
                  selectedVariations: orchestrator.selectedVariations
              }));
          } catch (e) {
              console.error("[Ads Cache] Error caching orchestrator variations:", e);
          }
      }
  }, [orchestrator.variations, orchestrator.selectedVariations]);
  
  // Persist Orchestrator State
  useEffect(() => {
    const saved = localStorage.getItem('active_orchestrator_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.isOpen) {
          // Migration: Ensure winningImageUrls exists
          if (!parsed.winningImageUrls) parsed.winningImageUrls = [];
          setOrchestrator(prev => ({ ...prev, ...parsed }));
        }
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    try {
      if (orchestrator.isOpen) {
        localStorage.setItem('active_orchestrator_state', JSON.stringify(orchestrator));
      } else {
        localStorage.removeItem('active_orchestrator_state');
      }
    } catch (e) {
      console.error("[Ads Cache] Error persisting active orchestrator state:", e);
    }
  }, [orchestrator]);

  const [optimizedCampaigns, setOptimizedCampaigns] = useState<string[]>([])

  // Auto-Poll for background asset generation
  useEffect(() => {
    let interval: any;
    if (orchestrator.status === 'generating' && orchestrator.batchId) {
        interval = setInterval(async () => {
            console.log("[Orchestrator] Polling for assets in batch:", orchestrator.batchId);
            
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: batchAssets } = await supabase
                .from('assets')
                .select('*')
                .eq('user_id', user.id)
                .eq('master_creative_id', orchestrator.batchId)
                .order('created_at', { ascending: false });

            // If we found at least one asset, we can show them, 
            // but ideally we wait for at least the count the user requested.
            if (batchAssets && batchAssets.length >= orchestrator.selectedVariations.length) {
                console.log("[Orchestrator] Found all assets! Switching to picking.");
                // Match assets back to variations if possible, or just replace
                setOrchestrator(prev => ({ 
                    ...prev, 
                    status: 'picking', // Switch to picking state so they can review/regenerate copy
                    variations: batchAssets.map((a: any) => {
                        const parts = a.caption?.split('\n\n') || [];
                        return {
                            title: 'Generated Variation',
                            headline: parts[0] || 'AI Variation',
                            primary_text: parts[1] || '',
                            description: parts.slice(2).join('\n\n') || '',
                            image_url: a.url,
                            url: a.url,
                            caption: a.caption,
                            asset_id: a.id
                        };
                    }),
                    selectedVariations: batchAssets.map((_: any, i: number) => i),
                    logs: [...prev.logs, { id: Date.now(), text: "Assets generated! Now let's optimize the ad copy for these images.", type: 'system' }] 
                }));
                clearInterval(interval);
            }
        }, 10000); // Check every 10 seconds
    }
    return () => clearInterval(interval);
  }, [orchestrator.status, orchestrator.batchId, orchestrator.selectedVariations.length]);

  // Form States
  const [formQuestions, setFormQuestions] = useState<CustomQuestion[]>([])
  const [isAddingQuestion, setIsAddingQuestion] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [newQuestion, setNewQuestion] = useState<CustomQuestion>({ label: '', type: 'SHORT_ANSWER', options: [''] })

  // Meta Custom Audience States
  const [customAudiences, setCustomAudiences] = useState<any[]>([])
  const [isLoadingCustomAudiences, setIsLoadingCustomAudiences] = useState(false)
  const [runAsRemarketing, setRunAsRemarketing] = useState(false)
  const [selectedCustomAudienceIds, setSelectedCustomAudienceIds] = useState<string[]>([])

  useEffect(() => {
    if (isModalOpen && selectedAdAccountId) {
      const fetchCustomAudiences = async () => {
        setIsLoadingCustomAudiences(true)
        try {
          const urlParams = new URLSearchParams(window.location.search)
          const impersonateId = urlParams.get('impersonate')
          const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
          const res = await fetch(`/api/meta-ads/custom-audiences?${impParam}`)
          const data = await res.json()
          if (data.audiences) {
            setCustomAudiences(data.audiences)
          }
        } catch (e) {
          console.error("Failed to fetch custom audiences for modal", e)
        } finally {
          setIsLoadingCustomAudiences(false)
        }
      }
      fetchCustomAudiences()
    } else if (!isModalOpen) {
      setRunAsRemarketing(false)
      setSelectedCustomAudienceIds([])
    }
  }, [isModalOpen, selectedAdAccountId])

  const [adForm, setAdForm] = useState({
    metaLocations: [] as { location: LocationOption, radius: number }[],
    gender: 'All',
    ageMin: 18,
    ageMax: 65,
    dailyBudgetINR: 500,
    pageId: '', 
    linkUrl: 'https://adrolls.in', 
    optimizeForConversions: false,
    customInstructions: '',
  })

  // Mandatory Product Selection for Campaign Launch
  const [selectedProduct, setSelectedProduct] = useState<Property | null>(null)
  const [selectedProducts, setSelectedProducts] = useState<Property[]>([])
  // Job-based launch tracking
  const [launchJobId, setLaunchJobId] = useState<string | null>(null)
  const [launchJobStatus, setLaunchJobStatus] = useState<'idle' | 'queued' | 'processing' | 'completed' | 'failed'>('idle')

  // Poll for campaign job status
  useEffect(() => {
    if (!launchJobId || launchJobStatus === 'completed' || launchJobStatus === 'failed') return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/meta-ads/campaign-job-status?jobId=${launchJobId}`);
        const data = await res.json();
        if (data.status === 'completed') {
          clearInterval(poll);
          setLaunchJobStatus('completed');
          toast.success(data.message || 'Campaign launched successfully!');
          setLaunchJobId(null);
          fetchAdsData(true);
        } else if (data.status === 'failed') {
          clearInterval(poll);
          setLaunchJobStatus('failed');
          toast.error('Launch Failed: ' + (data.message || 'Unknown error'));
          setLaunchJobId(null);
        } else {
          setLaunchJobStatus(data.status === 'processing' ? 'processing' : 'queued');
        }
      } catch (e) {
        console.error('Job poll error:', e);
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [launchJobId, launchJobStatus]);

  // Helper: Fix R2 URL structure if bucket name is missing
  const fixR2Url = (url: string) => {
    if (!url) return ''
    if (url.includes('.r2.dev') && !url.includes('/adrolls-storage/')) {
        return url.replace('.r2.dev/', '.r2.dev/adrolls-storage/')
    }
    return url
  }

  const isVideoFile = (file: File) => file.type.startsWith('video/');

  const [previewImage, setPreviewImage] = useState<{ isOpen: boolean, url: string, title: string, type?: 'image' | 'video' }>({ isOpen: false, url: '', title: '' })

   const checkAccountStatus = async (accountId: string, pageId?: string) => {
      setCheckingSanity(true)
      try {
          const urlParams = new URLSearchParams(window.location.search)
          const impersonateId = urlParams.get('impersonate')
          const impParam = impersonateId ? `&impersonate=${impersonateId}` : ''
          const pageParam = pageId ? `&pageId=${pageId}` : ''
          const res = await fetch(`/api/meta-ads/check-account?adAccountId=${accountId}${pageParam}${impParam}`)
          const data = await res.json()
          setAccountStatus(data)
      } catch (e: any) { 
          console.error(e) 
      } finally {
          setCheckingSanity(false)
      }
  }

  const handleCreatePixel = async () => {
      if (!selectedAdAccountId) return
      
      const pixelName = prompt("Enter Pixel Name:", "AdRolls Pixel")
      if (!pixelName) return

      setIsCreatingPixel(true)
      try {
          const urlParams = new URLSearchParams(window.location.search)
          const impersonateId = urlParams.get('impersonate')
          
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
              setPixelId(data.pixelId)
              
              // Refresh pixel list
              setIsLoadingPixels(true)
              try {
                  const pixelRes = await fetch('/api/facebook/pixels', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ adAccountId: selectedAdAccountId, impersonateId })
                  })
                  const pixelData = await pixelRes.json()
                  if (pixelData.pixels) {
                      setPixels(pixelData.pixels)
                  }
              } catch (e) {
                  console.error(e)
              } finally {
                  setIsLoadingPixels(false)
              }
          }
      } catch (err: any) {
          toast.error(`Error: ${err.message}`)
      } finally {
          setIsCreatingPixel(false)
      }
  }

  // Auto-verify account sanity whenever ad account or page ID changes
  useEffect(() => {
      if (selectedAdAccountId) {
          checkAccountStatus(selectedAdAccountId, adForm.pageId)
      }
  }, [selectedAdAccountId, adForm.pageId])
  const fetchAdsData = async (force = false) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // Get profile for role check
      const { data: initialProfile, error: initialProfileErr } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (initialProfileErr) throw new Error("initialProfileErr: " + initialProfileErr.message)
      if (initialProfile?.role === 'agent') {
          router.push('/dashboard')
          return
      }

      // Resolve Target User ID
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const { data: profile, error: profileErr } = await supabase.from('profiles').select('facebook_token, ad_account_id, selected_page_id, role, parent_id, agency_id, custom_domain, business_name, currency, pixel_id, whatsapp_phone_number, contact_number').eq('id', user.id).single()
      if (profileErr) throw new Error("profileErr: " + profileErr.message)
      let targetUserId = user.id
      if (['admin', 'agent'].includes(profile?.role || '') && (profile?.parent_id || profile?.agency_id)) {
          targetUserId = (profile?.parent_id || profile?.agency_id) as string
      }

      if (impersonateId && (['super_admin', 'agency', 'admin', 'agent'].includes(profile?.role || ''))) {
          if (profile?.role !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', user.id)
                .single()
              if (subAccount) targetUserId = impersonateId
          } else {
              targetUserId = impersonateId
          }
      }

      // 2. Fetch TARGET Profile (If impersonating or staff, we need the parent's tokens)
      let targetProfile = profile
      if (targetUserId !== user.id) {
          const { data: tProf, error: tProfErr } = await supabase
            .from('profiles')
            .select('facebook_token, ad_account_id, selected_page_id, role, parent_id, agency_id, custom_domain, business_name, currency, pixel_id, whatsapp_phone_number, contact_number')
            .eq('id', targetUserId)
            .single()
          if (tProfErr) throw new Error("tProfErr: " + tProfErr.message)
          if (tProf) targetProfile = tProf
          console.log(`[ADS] Mirroring Agency: ${targetProfile?.business_name} (${targetUserId})`)
      }
      
      if (targetProfile) {
        setCurrency(targetProfile.currency || 'INR')
        const activeToken = targetProfile.facebook_token || profile?.facebook_token || null
        setFacebookToken(activeToken)
        setSelectedAdAccountId(targetProfile.ad_account_id)
        setPixelId(targetProfile.pixel_id || null)
        
        // Construct Catalogue URL
        const catalogueUrl = targetProfile.custom_domain 
          ? `https://${targetProfile.custom_domain}` 
          : `https://app.nobogent.com/shared/${targetUserId}`
          
        setAdForm(prev => ({
          ...prev, 
          pageId: targetProfile.selected_page_id || '',
          linkUrl: (!prev.linkUrl || prev.linkUrl === 'https://nobogent.com' || prev.linkUrl === 'https://adrolls.in' || prev.linkUrl === '') ? catalogueUrl : prev.linkUrl
        }))
        setCustomDomain(targetProfile.custom_domain || '')
        if (targetProfile.ad_account_id && !force) {
            checkAccountStatus(targetProfile.ad_account_id, targetProfile.selected_page_id)
        }
      }
      setTargetUserId(targetUserId)

      // Setup caching keys
      const campaignCacheKey = `ads_campaigns_cache_${targetUserId}`;
      const propCacheKey = `properties_cache_${targetUserId}`;
      const leadsCacheKey = `ads_leads_cache_${targetUserId}`;
      const pagesCacheKey = `landing_pages_cache_${targetUserId}`;
      const formsCacheKey = `qualification_forms_cache_${targetUserId}`;
      const assetsCacheKey = `assets_cache_${targetUserId}`;
      const metaFormsCacheKey = `meta_forms_cache_${targetUserId}`;

      const cachedCampaigns = force ? [] : getLocalCache<Campaign>(campaignCacheKey);
      const cachedProps = force ? [] : getLocalCache<Property>(propCacheKey);
      const cachedLeads = force ? [] : getLocalCache<any>(leadsCacheKey);
      const cachedPages = force ? [] : getLocalCache<any>(pagesCacheKey);
      const cachedForms = force ? [] : getLocalCache<any>(formsCacheKey);
      const cachedAssets = force ? [] : getLocalCache<Asset>(assetsCacheKey);
      const cachedMetaForms = force ? [] : getLocalCache<any>(metaFormsCacheKey);

      if (cachedCampaigns.length > 0 && campaigns.length === 0) {
          setCampaigns(cachedCampaigns);
          setProperties(cachedProps);
          setAssets(cachedAssets);
          setLandingPages(cachedPages);
          setForms(cachedForms);
          setMetaLeadForms(cachedMetaForms);

           const leadCounts: Record<string, number> = {};
           cachedLeads.forEach((l: any) => {
               if (l.campaign_id) leadCounts[l.campaign_id] = (leadCounts[l.campaign_id] || 0) + 1;
           });
           setCampaignLeadCounts(leadCounts);

          setLoading(false);
      } else if (campaigns.length === 0 && !force) {
          setLoading(true);
      }

      if (force) setIsRefreshing(true);

      // Extract unique connected WhatsApp/phone numbers
      const numbersSet = new Set<string>();
      if (targetUserId !== user.id) {
          if (targetProfile?.whatsapp_phone_number) numbersSet.add(targetProfile.whatsapp_phone_number);
          if (targetProfile?.contact_number) numbersSet.add(targetProfile.contact_number);
      } else {
          if (profile?.whatsapp_phone_number) numbersSet.add(profile.whatsapp_phone_number);
          if (profile?.contact_number) numbersSet.add(profile.contact_number);
      }

      const numbers = Array.from(numbersSet).filter(Boolean);
      setAvailableWhatsAppNumbers(numbers);
      if (numbers.length > 0) {
        setSelectedWhatsAppNumber(numbers[0]);
      }

      let newCampaigns: Campaign[] = cachedCampaigns;
      if (targetProfile?.ad_account_id) {
          if (force) checkAccountStatus(targetProfile.ad_account_id, targetProfile.selected_page_id)
          try {
              const res = await fetch(`/api/meta-ads/campaigns${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
              const data = await res.json()
              if (data.campaigns) {
                  newCampaigns = data.campaigns;
                  setLocalCache(campaignCacheKey, newCampaigns);
              }
          } catch (e: any) { 
              console.error("Failed to load campaigns", e) 
          }
      }

      const maxPropTime = getMaxCreatedAt(cachedProps as any[]);
      const maxPageTime = getMaxCreatedAt(cachedPages);
      const maxFormTime = getMaxCreatedAt(cachedForms);
      const maxAssetTime = getMaxCreatedAt(cachedAssets as any[]);

      const effectiveUserIds: string[] = [targetUserId];
      if (targetProfile?.parent_id) effectiveUserIds.push(targetProfile.parent_id);
      if (targetProfile?.agency_id) effectiveUserIds.push(targetProfile.agency_id);

      let propQuery = supabase.from('properties').select('id, title, price, image_url, description').in('user_id', effectiveUserIds);

      let pageQuery = supabase.from('landing_pages').select('*').in('user_id', effectiveUserIds);

      let formQuery = supabase.from('qualification_forms').select('*').in('user_id', effectiveUserIds);

      const [propsRes, leadsRes, pagesRes, formsRes, apiAssetsData, metaFormsData] = await Promise.all([
          propQuery.order('created_at', { ascending: false }),
          supabase.from('leads').select('campaign_id').in('user_id', effectiveUserIds),
          pageQuery.order('created_at', { ascending: false }),
          formQuery.order('created_at', { ascending: false }),
          fetch(`/api/assets${impersonateId ? `?impersonate=${impersonateId}` : ''}${maxAssetTime && !force ? `${impersonateId ? '&' : '?'}since=${encodeURIComponent(maxAssetTime)}` : ''}`).then(r => r.json()).catch(e => {
              console.error("Failed to load assets from API", e);
              return [];
          }),
          fetch(`/api/facebook/forms${impersonateId ? `?impersonate=${impersonateId}` : ''}`).then(r => r.json()).catch(e => {
              console.error("Failed to load Meta lead forms", e);
              return { forms: [] };
          })
      ])

      const mergedProps = propsRes.data || []

      const freshPages = pagesRes.data || []
      const mergedPages = force ? freshPages : mergeCacheData<any>(cachedPages, freshPages);

      const freshForms = formsRes.data || []
      const mergedForms = force ? freshForms : mergeCacheData<any>(cachedForms, freshForms);

      const freshAssets = (Array.isArray(apiAssetsData) ? apiAssetsData : []) as Asset[]
      const mergedAssets = force ? freshAssets : mergeCacheData<any>(cachedAssets, freshAssets);
      
      const leads = leadsRes.data || [];
      const leadCounts: Record<string, number> = {};
      leads.forEach(l => {
          if (l.campaign_id) leadCounts[l.campaign_id] = (leadCounts[l.campaign_id] || 0) + 1;
      });
      setCampaignLeadCounts(leadCounts);

      const freshMetaForms = metaFormsData?.forms || [];

      setCampaigns(newCampaigns)
      setProperties(mergedProps)
      setAssets(mergedAssets)
      setLandingPages(mergedPages)
      setForms(mergedForms)
      setMetaLeadForms(freshMetaForms)

      setLocalCache(propCacheKey, mergedProps);
      setLocalCache(leadsCacheKey, leads);
      setLocalCache(pagesCacheKey, mergedPages);
      setLocalCache(formsCacheKey, mergedForms);
      setLocalCache(assetsCacheKey, mergedAssets);
      setLocalCache(metaFormsCacheKey, freshMetaForms);

      // Fetch pixels if targetProfile has ad_account_id
      if (targetProfile?.ad_account_id) {
          setIsLoadingPixels(true);
          try {
              const res = await fetch('/api/facebook/pixels', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ adAccountId: targetProfile.ad_account_id, impersonateId })
              });
              const data = await res.json();
              if (data.pixels) {
                  setPixels(data.pixels);
              } else {
                  setPixels([]);
              }
          } catch (e) {
              console.error("Failed to fetch pixels:", e);
              setPixels([]);
          } finally {
              setIsLoadingPixels(false);
          }
      }

     } catch (error: any) {
        console.error("Fetch Error:", error)
     } finally {
       setLoading(false)
       setIsRefreshing(false)
     }
  }

  useEffect(() => { 
    fetchAdsData() 
    const saved = localStorage.getItem('optimized_campaign_ids')
    if (saved) setOptimizedCampaigns(JSON.parse(saved))
  }, [])

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
        if (locationSearchText.length > 2 && facebookToken) {
            setIsSearchingLocation(true)
            const res = await fetch(`/api/meta-ads/search-locations?q=${locationSearchText}&token=${facebookToken}`)
            const data = await res.json()
            setLocationResults(data.data || [])
            setIsSearchingLocation(false)
        } else {
            setLocationResults([])
        }
    }, 500)
    return () => clearTimeout(delayDebounceFn)
  }, [locationSearchText, facebookToken])

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
        if (adsetSearchText.length > 2 && facebookToken) {
            setIsSearchingAdsetLocation(true)
            const res = await fetch(`/api/meta-ads/search-locations?q=${adsetSearchText}&token=${facebookToken}`)
            const data = await res.json()
            setAdsetSearchResults(data.data || [])
            setIsSearchingAdsetLocation(false)
        } else {
            setAdsetSearchResults([])
        }
    }, 500)
    return () => clearTimeout(delayDebounceFn)
  }, [adsetSearchText, facebookToken])
  
  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      setTogglingId(id);
      const updatedCampaigns = campaigns.map(c => c.id === id ? { ...c, status: newStatus } : c);
      setCampaigns(updatedCampaigns);
      try {
          const urlParams = new URLSearchParams(window.location.search)
          const impersonateId = urlParams.get('impersonate')
          const res = await fetch(`/api/meta-ads/update-status${impersonateId ? `?impersonate=${impersonateId}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: id, newStatus }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
      } catch (error: any) {
          alert(`Failed to update status: ${error.message}`);
          setCampaigns(campaigns);
      } finally { setTogglingId(null); }
  }

  const handleDeleteCampaign = async (campaignId: string, campaignName: string) => {
      const confirmDelete = window.confirm(`Are you sure you want to permanently delete campaign "${campaignName}" on Meta? This action cannot be undone.`);
      if (!confirmDelete) return;

      setDeletingId(campaignId);
      
      const impersonateId = new URLSearchParams(window.location.search).get('impersonate');
      const deleteUrl = `/api/meta-ads/delete-campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

      try {
          const res = await fetch(deleteUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaignId })
          });
          const data = await res.json();
          if (res.ok && data.success) {
              toast.success('Campaign deleted successfully!');
              setCampaigns(prev => prev.filter(c => c.id !== campaignId));
          } else {
              throw new Error(data.error || 'Failed to delete campaign');
          }
      } catch (e: any) {
          toast.error('Deletion Failed', { description: e.message });
      } finally {
          setDeletingId(null);
      }
  }

  const fetchStats = async (campaign: Campaign, preset: string, since: string, until: string) => {
      setStatsModal(prev => ({ ...prev, loading: true }))
      try {
          const urlParams = new URLSearchParams()
          urlParams.append('campaignId', campaign.id)
          const urlParamsString = new URLSearchParams(window.location.search)
          const impersonateId = urlParamsString.get('impersonate')
          if (impersonateId) urlParams.append('impersonate', impersonateId)
          
          if (preset === 'custom') {
              if (since) urlParams.append('since', since)
              if (until) urlParams.append('until', until)
          } else {
              urlParams.append('datePreset', preset)
          }
          const res = await fetch(`/api/meta-ads/campaign-insights?${urlParams.toString()}`)
          if (!res.ok) {
              const errText = await res.text();
              console.error("[Campaign Insights HTTP Error]:", res.status, errText.substring(0, 300));
              throw new Error(`Failed to load insights (Status ${res.status})`);
          }
          const data = await res.json()
          if (data.error) throw new Error(data.error)
          setStatsModal({ isOpen: true, campaign, insights: data, loading: false })
      } catch(e: any) {
          toast.error(`Failed to load insights: ${e.message}`)
          setStatsModal(prev => ({ ...prev, loading: false }))
      }
  }

  const handleOpenStats = async (campaign: Campaign) => {
      setStatsDatePreset('maximum')
      setStatsSince('')
      setStatsUntil('')
      setStatsTab('overview')
      fetchStats(campaign, 'maximum', '', '')
  }

  const fetchAnalysisHistory = async (campaign: Campaign) => {
      setAnalysisModal(prev => ({ ...prev, loadingHistory: true }))
      try {
          const urlParams = new URLSearchParams()
          urlParams.append('campaignId', campaign.id)
          const urlParamsString = new URLSearchParams(window.location.search)
          const impersonateId = urlParamsString.get('impersonate')
          if (impersonateId) urlParams.append('impersonate', impersonateId)
          
          const res = await fetch(`/api/meta-ads/analyze-campaign?${urlParams.toString()}`)
          const data = await res.json()
          if (data.error) throw new Error(data.error)
          
          const history = data.history || []
          setAnalysisModal(prev => ({ 
              ...prev, 
              history, 
              selectedAnalysis: history.length > 0 ? history[0] : null,
              loadingHistory: false 
          }))
      } catch (e: any) {
          toast.error(`Failed to load analysis history: ${e.message}`)
          setAnalysisModal(prev => ({ ...prev, loadingHistory: false }))
      }
  }

  const handleOpenAnalysis = (campaign: Campaign) => {
      setAnalysisModal({
          isOpen: true,
          campaign,
          history: [],
          selectedAnalysis: null,
          loadingHistory: true,
          generating: false
      })
      fetchAnalysisHistory(campaign)
  }

  const handleRunLiveAnalysis = async () => {
      if (!analysisModal.campaign) return
      setAnalysisModal(prev => ({ ...prev, generating: true }))
      try {
          const urlParamsString = new URLSearchParams(window.location.search)
          const impersonateId = urlParamsString.get('impersonate')
          
          const res = await fetch(`/api/meta-ads/analyze-campaign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  campaignId: analysisModal.campaign.id,
                  impersonateId
              })
          })
          const data = await res.json()
          if (data.error) throw new Error(data.error)
          
          toast.success("AI Analysis generated successfully!")
          
          // Re-fetch history to include the new one
          fetchAnalysisHistory(analysisModal.campaign)
          setAnalysisModal(prev => ({ ...prev, generating: false }))
      } catch (e: any) {
          toast.error(`Analysis failed: ${e.message}`)
          setAnalysisModal(prev => ({ ...prev, generating: false }))
      }
  }

  const renderSVGChart = (dailyData: any[]) => {
      if (!dailyData || dailyData.length === 0) {
          return (
              <div className="flex items-center justify-center h-48 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs font-semibold">
                  Not enough performance data to plot trend line.
              </div>
          );
      }

      const getVal = (item: any) => {
          if (chartMetric === 'spend') return item.spend || 0;
          if (chartMetric === 'leads') return item.leads || 0;
          return item.clicks || 0;
      };

      const maxVal = Math.max(...dailyData.map(getVal), 1);
      const width = 600;
      const height = 180;
      const padding = 20;

      const points = dailyData.map((item, index) => {
          const x = padding + (index * (width - 2 * padding)) / Math.max(dailyData.length - 1, 1);
          const y = height - padding - (getVal(item) / maxVal) * (height - 2 * padding);
          return { x, y, item };
      });

      const pathD = points.length > 0 
          ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
          : '';

      const areaD = points.length > 0
          ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
          : '';

      return (
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200/60 relative">
              <div className="flex justify-between items-center mb-6">
                  <div>
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Performance Trend</h4>
                      <p className="text-sm font-bold text-slate-800 mt-1 capitalize">{chartMetric} over time</p>
                  </div>
                  <div className="flex bg-white p-1 rounded-xl border border-slate-200/60 shadow-sm">
                      {(['spend', 'leads', 'clicks'] as const).map(m => (
                          <button
                              key={m}
                              onClick={() => setChartMetric(m)}
                              className={`text-[10px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all ${chartMetric === m ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                          >
                              {m === 'spend' ? 'Spend' : m === 'leads' ? 'Leads' : 'Clicks'}
                          </button>
                      ))}
                  </div>
              </div>
              <div className="w-full overflow-hidden">
                  <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
                      <defs>
                          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
                              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.00" />
                          </linearGradient>
                      </defs>
                      {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                          const y = padding + ratio * (height - 2 * padding);
                          const gridVal = (maxVal - ratio * maxVal).toFixed(0);
                          return (
                              <g key={idx} className="opacity-30">
                                  <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4 4" />
                                  <text x={padding - 5} y={y + 4} fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="end">{gridVal}</text>
                              </g>
                          );
                      })}
                      {points.length > 1 && (
                          <>
                              <path d={areaD} fill="url(#chartGrad)" />
                              <path d={pathD} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-md" />
                              {points.map((p, idx) => (
                                  <g key={idx} className="group/dot cursor-pointer">
                                      <circle cx={p.x} cy={p.y} r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="2" className="transition-all group-hover/dot:r-6" />
                                      <title>{`${p.item.date}: ${getVal(p.item)}`}</title>
                                  </g>
                              ))}
                          </>
                      )}
                  </svg>
              </div>
          </div>
      );
  }

  const handleOptimize = (campaign: Campaign) => {
      setOrchestrator({
          isOpen: true,
          mode: 'optimize',
          campaign,
          status: 'picking',
          step: 2,
          logs: [{ id: Date.now(), text: `Select creatives and map to inventory products for ${campaign.name}`, type: 'system' }],
          variations: [],
          selectedVariations: [],
          winningImageUrls: [],
          insight: '',
          leadFormId: null,
          batchId: null,
          generationCount: 5,
          style: 'hyper',
          customInstructions: '',
          isManual: true
      });
  }

  const handleStartOptimization = async () => {
      if (!orchestrator.campaign) return;
      
      setOrchestrator(prev => ({ 
        ...prev, 
        status: 'analyzing',
        logs: [...prev.logs, { id: Date.now(), text: `Running Andromeda analysis...`, type: 'user' }]
      }));

      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const apiUrl = `/api/meta-ads/optimize-campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

      try {
          const res = await fetch(apiUrl, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                campaignId: orchestrator.campaign.id, 
                step: 'analyze',
                style: orchestrator.style,
                userInstructions: orchestrator.customInstructions
            }) 
          });
          const data = await res.json();
          if (data.status === 'success') {
              setOrchestrator(prev => ({
                  ...prev,
                   status: 'presenting',
                   insight: data.insight,
                   variations: data.variations || [],
                   selectedVariations: (data.variations || []).map((_: any, i: number) => i),
                   winningImageUrls: data.winningImageUrls || [],
                   leadFormId: data.leadFormId,
                   logs: [...prev.logs, { id: Date.now(), text: data.insight, type: 'ai' }, { id: Date.now()+1, text: `I've identified ${data.variations?.length} potential optimization angles. How many variations should I generate?`, type: 'system' }]
              }));
          } else {
               setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: data.message || "Failed to analyze.", type: 'system' }]}));
          }
      } catch (e) {
          setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Network error occurred.", type: 'system' }]}));
      }
  }

  const handleGenerateOptimization = async () => {
    if (!orchestrator.campaign) return;
    setOrchestrator(prev => ({...prev, status: 'generating', step: 2, logs: [...prev.logs, { id: Date.now(), text: `Generating ${prev.generationCount} optimization variations...`, type: 'user' }]}));
    const urlParams = new URLSearchParams(window.location.search)
    const impersonateId = urlParams.get('impersonate')
    const apiUrl = `/api/meta-ads/optimize-campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                campaignId: orchestrator.campaign!.id, 
                step: 'generate', 
                variations: orchestrator.variations.filter((_, i) => orchestrator.selectedVariations.includes(i)),
                winningImageUrls: orchestrator.winningImageUrls,
                count: orchestrator.generationCount,
                style: orchestrator.style,
                userInstructions: orchestrator.customInstructions
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            setOrchestrator(prev => ({ ...prev, batchId: data.batchId, logs: [...prev.logs, { id: Date.now(), text: "Creative generation started. Check library in 1-2 minutes.", type: 'system' }] }));
            
            const saved = [...optimizedCampaigns, orchestrator.campaign!.id];
            setOptimizedCampaigns(saved);
            localStorage.setItem('optimized_campaign_ids', JSON.stringify(saved));
        } else {
            setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: data.error || "Generation failed.", type: 'system' }]}));
        }
    } catch (e) {
        setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Network error.", type: 'system' }]}));
    }
  }

  const handleRemarketing = (campaign: Campaign) => {
      setRemarketSourceCampaign(campaign);
      setIsModalOpen(true);
  }

  const handleOpenExplorer = async (campaign: Campaign) => {
    setActiveExplorerCampaign(campaign)
    setLoadingExplorer(true)
    setExplorerData(null)
    setEditingNode(null)
    
    const urlParams = new URLSearchParams(window.location.search)
    const impersonateId = urlParams.get('impersonate')
    
    try {
      const res = await fetch(`/api/meta-ads/campaign-details?campaignId=${campaign.id}${impersonateId ? `&impersonate=${impersonateId}` : ''}`)
      const data = await res.json()
      if (res.ok && data.success) {
        setExplorerData(data)
        if (data.adsets?.length > 0) {
          setExpandedAdSets([data.adsets[0].id])
        }
      } else {
        toast.error(data.error || 'Failed to fetch campaign details.')
        setActiveExplorerCampaign(null)
      }
    } catch (e: any) {
      toast.error('Failed to load campaign data: ' + e.message)
      setActiveExplorerCampaign(null)
    } finally {
      setLoadingExplorer(false)
    }
  }

  const handleToggleNodeStatus = async (nodeId: string, currentStatus: string, type: 'campaign' | 'adset' | 'ad') => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    
    setExplorerData((prev: any) => {
      if (!prev) return prev
      if (type === 'campaign') {
        return { ...prev, campaign: { ...prev.campaign, status: newStatus } }
      }
      if (type === 'adset') {
        const updatedAdsets = prev.adsets.map((as: any) => as.id === nodeId ? { ...as, status: newStatus } : as)
        return { ...prev, adsets: updatedAdsets }
      }
      if (type === 'ad') {
        const updatedAdsets = prev.adsets.map((as: any) => {
          const updatedAds = as.ads.map((ad: any) => ad.id === nodeId ? { ...ad, status: newStatus } : ad)
          return { ...as, ads: updatedAds }
        })
        return { ...prev, adsets: updatedAdsets }
      }
      return prev
    })

    const urlParams = new URLSearchParams(window.location.search)
    const impersonateId = urlParams.get('impersonate')

    try {
      const res = await fetch(`/api/meta-ads/update-campaign-node${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, type, fields: { status: newStatus } })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`${type.toUpperCase()} status updated to ${newStatus}`)
      
      if (type === 'campaign') {
        setCampaigns(prev => prev.map(c => c.id === nodeId ? { ...c, status: newStatus } : c))
      }
    } catch (e: any) {
      toast.error('Failed to toggle status: ' + e.message)
      setExplorerData((prev: any) => {
        if (!prev) return prev
        if (type === 'campaign') {
          return { ...prev, campaign: { ...prev.campaign, status: currentStatus } }
        }
        if (type === 'adset') {
          const updatedAdsets = prev.adsets.map((as: any) => as.id === nodeId ? { ...as, status: currentStatus } : as)
          return { ...prev, adsets: updatedAdsets }
        }
        if (type === 'ad') {
          const updatedAdsets = prev.adsets.map((as: any) => {
            const updatedAds = as.ads.map((ad: any) => ad.id === nodeId ? { ...ad, status: currentStatus } : ad)
            return { ...as, ads: updatedAds }
          })
          return { ...prev, adsets: updatedAdsets }
        }
        return prev
      })
    }
  }

  const handleSaveNodeEdit = async () => {
    if (!editingNode || isSavingEdit) return
    setIsSavingEdit(true)
    
    const urlParams = new URLSearchParams(window.location.search)
    const impersonateId = urlParams.get('impersonate')

    const fields: any = { name: editingNode.name }
    if (editingNode.budget !== undefined && editingNode.budgetType !== 'none') {
      fields.budget = editingNode.budget
      fields.budgetType = editingNode.budgetType
    }
    if (editingNode.type === 'ad' && editingNode.creative) {
      fields.creative = editingNode.creative
    }
    if (editingNode.type === 'adset' && editingNode.targeting?.locations) {
      const geo: any = { countries: [] };
      editingNode.targeting.locations.forEach((loc: any) => {
        if (loc.type === 'city') {
          if (!geo.cities) geo.cities = [];
          geo.cities.push({ key: loc.key, radius: loc.radius || 20, distance_unit: 'kilometer' });
        } else if (loc.type === 'region') {
          if (!geo.regions) geo.regions = [];
          geo.regions.push({ key: loc.key });
        } else if (loc.type === 'country') {
          geo.countries.push(loc.country_code || loc.key);
        } else if (loc.type === 'zip') {
          if (!geo.zips) geo.zips = [];
          geo.zips.push({ key: loc.key });
        }
      });
      if (geo.countries.length === 0) delete geo.countries;
      fields.targeting = { geo_locations: geo };
    }

    try {
      const res = await fetch(`/api/meta-ads/update-campaign-node${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: editingNode.id, type: editingNode.type, fields })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      
      toast.success('Edits saved successfully!')
      
      setExplorerData((prev: any) => {
        if (!prev) return prev
        if (editingNode.type === 'campaign') {
          return { ...prev, campaign: { ...prev.campaign, name: editingNode.name, budget: editingNode.budget ?? prev.campaign.budget } }
        }
        if (editingNode.type === 'adset') {
          const updatedAdsets = prev.adsets.map((as: any) => as.id === editingNode.id ? { 
            ...as, 
            name: editingNode.name, 
            budget: editingNode.budget ?? as.budget,
            targeting: editingNode.targeting ? {
              geo_locations: {
                cities: editingNode.targeting.locations.filter((l: any) => l.type === 'city').map((l: any) => ({ key: l.key, name: l.name, radius: l.radius || 20 })),
                regions: editingNode.targeting.locations.filter((l: any) => l.type === 'region').map((l: any) => ({ key: l.key, name: l.name })),
                countries: editingNode.targeting.locations.filter((l: any) => l.type === 'country').map((l: any) => l.country_code || l.key),
                zips: editingNode.targeting.locations.filter((l: any) => l.type === 'zip').map((l: any) => ({ key: l.key }))
              }
            } : as.targeting
          } : as)
          return { ...prev, adsets: updatedAdsets }
        }
        if (editingNode.type === 'ad') {
          const updatedAdsets = prev.adsets.map((as: any) => {
            const updatedAds = as.ads.map((ad: any) => ad.id === editingNode.id ? { 
              ...ad, 
              name: editingNode.name,
              creative: {
                ...ad.creative,
                ...(editingNode.creative || {})
              }
            } : ad)
            return { ...as, ads: updatedAds }
          })
          return { ...prev, adsets: updatedAdsets }
        }
        return prev
      })

      if (editingNode.type === 'campaign') {
        setCampaigns(prev => prev.map(c => c.id === editingNode.id ? { ...c, name: editingNode.name } : c))
      }

      setEditingNode(null)
    } catch (e: any) {
      toast.error('Failed to save edits: ' + e.message)
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleRegenerateVariation = async (index: number) => {
      const v = orchestrator.variations[index];
      if (!v || !orchestrator.campaign) return;

      setOrchestrator(prev => ({ 
          ...prev, 
          status: 'analyzing',
          logs: [...prev.logs, { id: Date.now(), text: `Regenerating copy for variation ${index + 1}...`, type: 'system' }] 
      }));

      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const apiUrl = `/api/meta-ads/optimize-campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

      try {
          const res = await fetch(apiUrl, {
              method: 'POST',
              body: JSON.stringify({ 
                  campaignId: orchestrator.campaign?.id,
                  campaignName: orchestrator.campaign?.name,
                  step: 'generate-copy',
                  imageUrls: [v.image_url],
                  captions: [v.caption].filter(Boolean),
              })
          });
          const data = await res.json();
          if (data.variation) {
              setOrchestrator(prev => {
                  const newVars = [...prev.variations];
                  newVars[index] = { ...v, ...data.variation };
                  return { ...prev, variations: newVars, status: 'reviewing' };
              });
          }
      } catch (e) {
          setOrchestrator(prev => ({ ...prev, status: 'error' }));
      }
  };

  const handleApproveVariations = async () => {
      if (!orchestrator.campaign) return;

      if (orchestrator.status === 'presenting') {
          handleGenerateOptimization();
          return;
      }

      if (orchestrator.status === 'reviewing' || orchestrator.status === 'picking') {
          const impersonateId = new URLSearchParams(window.location.search).get('impersonate');
          const pushUrl = `/api/meta-ads/push-optimized-ads${impersonateId ? `?impersonate=${impersonateId}` : ''}`;
          
          setOrchestrator(prev => ({ ...prev, status: 'pushing', step: 3, logs: [...prev.logs, { id: Date.now(), text: `Pushing to Meta...`, type: 'user' }] }));
          
          try {
              const selectedAssets = orchestrator.variations.filter((_, i) => orchestrator.selectedVariations.includes(i));
              const res = await fetch(pushUrl, { 
                  method: 'POST', 
                  headers: { 'Content-Type': 'application/json' }, 
                  body: JSON.stringify({ 
                      campaignId: orchestrator.campaign.id, 
                      selectedAssets, 
                      leadFormId: orchestrator.leadFormId 
                  }) 
              });
              const data = await res.json();
              if (data.success) {
                  // Persist final edits to library
                  for (const v of selectedAssets) {
                      if (v.asset_id) {
                          // Fetch existing metadata to merge
                          const { data: assetData } = await supabase.from('assets').select('metadata').eq('id', v.asset_id).single();
                          const existingMetadata = assetData?.metadata || {};
                          const updatedMetadata = {
                              ...existingMetadata,
                              headline: v.headline || null,
                              primary_text: v.primary_text || null,
                              custom_instructions: orchestrator.customInstructions || null
                          };

                          await supabase.from('assets').update({ 
                              caption: v.caption || v.primary_text || null,
                              metadata: updatedMetadata 
                          }).eq('id', v.asset_id);

                          setAssets(curr => curr.map(asset => asset.id === v.asset_id ? { 
                              ...asset, 
                              caption: v.caption || v.primary_text || null,
                              metadata: updatedMetadata 
                          } : asset));
                      }
                  }
                  setOrchestrator(prev => ({ ...prev, status: 'success', step: 4, logs: [...prev.logs, { id: Date.now(), text: `Successfully pushed ${data.pushedCount} ads!`, type: 'system' }] }));
              } else {
                  setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: data.error || "Push failed.", type: 'system' }]}));
              }
          } catch (e) {
              setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Network error during push.", type: 'system' }]}));
          }
      }
  }

  const handleGenerateMoreCopy = async (instructions?: string) => {
      if (!orchestrator.campaign) return;
      
      const sourceAssets = orchestrator.variations.length > 0 ? orchestrator.variations : [];
      if (sourceAssets.length === 0) return;

      setOrchestrator(prev => ({ 
          ...prev, 
          status: 'analyzing', 
          logs: [...prev.logs, { id: Date.now(), text: instructions ? `Refining copy: ${instructions}` : "Generating more premium copy variations...", type: 'system' }] 
      }));

      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const apiUrl = `/api/meta-ads/optimize-campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

      try {
          const res = await fetch(apiUrl, {
              method: 'POST',
              body: JSON.stringify({ 
                  campaignId: orchestrator.campaign?.id,
                  campaignName: orchestrator.campaign?.name,
                  step: 'generate-copy',
                  imageUrls: sourceAssets.map(v => v.image_url),
                  captions: sourceAssets.map(v => v.caption).filter(Boolean),
                  userInstructions: instructions || ''
              })
          });
          const data = await res.json();
          if (data.variation) {
              const newVar = {
                  ...data.variation,
                  asset_id: sourceAssets[0]?.asset_id,
                  image_url: sourceAssets[0]?.image_url
              };
              setOrchestrator(prev => ({ 
                  ...prev, 
                  status: 'reviewing', 
                  step: 3,
                  variations: [...prev.variations, newVar],
                  selectedVariations: [...prev.selectedVariations, prev.variations.length],
                  logs: [...prev.logs, { id: Date.now(), text: "Added another premium variation.", type: 'ai' }] 
              }));
          }
      } catch (e) {
          setOrchestrator(prev => ({ ...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Failed to generate copy.", type: 'system' }] }));
      }
  };

  const handleAddPresetQuestion = (type: 'budget' | 'timeline' | 'type' | 'visit') => {
      if (type === 'budget') setFormQuestions(prev => [...prev, { label: "What is your budget?", type: "MULTIPLE_CHOICE", options: ["Less than 50L", "50L - 70L", "70L - 1 Cr", "1 Cr - 1.5 Cr", "1.5Cr - 2 Cr", "Above 2 Cr"], disqualifyingOptions: [] }]);
      else if (type === 'timeline') setFormQuestions(prev => [...prev, { label: "How soon do you want to buy?", type: "MULTIPLE_CHOICE", options: ["Immediately", "Within a month", "Within 3 months", "Just Looking (Disqualify)"], disqualifyingOptions: ["Just Looking (Disqualify)"] }]);
      else if (type === 'type') setFormQuestions(prev => [...prev, { label: "What are you looking for?", type: "MULTIPLE_CHOICE", options: ["Residential", "Commercial", "Plots", "Apartments", "Villa", "Kothi"], disqualifyingOptions: [] }]);
      else if (type === 'visit') setFormQuestions(prev => [...prev, { label: "What time would you like to visit?", type: "MULTIPLE_CHOICE", options: ["10 AM - 1 PM", "1 PM - 4 PM", "4 PM - 7 PM"], disqualifyingOptions: [] }]);
  }

  const handleLocalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if(e.target.files) {
      const files = Array.from(e.target.files)
      const newCreatives = files.map(file => ({ uid: Math.random().toString(36).substr(2, 9), sourceType: 'local' as const, file: file, previewUrl: URL.createObjectURL(file), name: file.name, type: file.type.startsWith('video/') ? 'video' as const : 'image' as const }))
      setSelectedCreatives(prev => [...prev, ...newCreatives])
    }
  }

  const handleOptimizerLocalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if(e.target.files) {
      const files = Array.from(e.target.files)
      const newVars = files.map(file => {
          const previewUrl = URL.createObjectURL(file);
          return {
              asset_id: null,
              type: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
              image_url: previewUrl,
              url: previewUrl,
              sourceType: 'local',
              file: file,
              headline: '',
              primary_text: '',
              description: '',
              caption: '',
              title: file.name
          };
      });
      setOrchestrator(prev => {
          const updated = [...prev.variations, ...newVars];
          return { ...prev, variations: updated, selectedVariations: updated.map((_, i) => i) };
      });
    }
  }

  const handleGenerateManualCopies = async () => {
      if (!orchestrator.campaign) return;
      
      const selectedCount = orchestrator.variations.length;
      if (selectedCount === 0) {
          toast.error("Please select or upload at least one creative.");
          return;
      }

      setOrchestrator(prev => ({ 
          ...prev, 
          status: 'generating',
          logs: [...prev.logs, { id: Date.now(), text: `Uploading assets and generating copywriting copies for ${selectedCount} creative(s)...`, type: 'system' }]
      }));

      try {
          const urlParams = new URLSearchParams(window.location.search);
          const impersonateId = urlParams.get('impersonate');
          
          // Resolve targetUserId
          const { data: { user } } = await supabase.auth.getUser();
          const { data: profile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user?.id).single();
          let tUserId = user?.id;
          if (['admin', 'agent'].includes(profile?.role || '') && (profile?.parent_id || profile?.agency_id)) {
              tUserId = (profile?.parent_id || profile?.agency_id) as string;
          }
          if (impersonateId) tUserId = impersonateId;

          const updatedVariations = [...orchestrator.variations];

          for (let i = 0; i < updatedVariations.length; i++) {
              const v = updatedVariations[i];
              let assetId = v.asset_id;
              let imageUrl = v.image_url;

              // 1. Upload local file if needed
              if (v.sourceType === 'local' && v.file) {
                  toast.info(`Uploading file ${v.title}...`);
                  const publicUrl = await uploadToR2(v.file, 'campaign_creatives');
                  
                  // Insert creative into assets table
                  const { data: newAsset, error: assetErr } = await supabase
                      .from('assets')
                      .insert({
                          url: publicUrl,
                          type: v.type || 'image',
                          user_id: tUserId,
                          status: 'Active',
                          property_id: v.mappedProductId || null,
                          metadata: {
                              custom_instructions: orchestrator.customInstructions || null
                          }
                      })
                      .select('id')
                      .single();
                      
                  if (assetErr || !newAsset) {
                      throw new Error(`Failed to save creative: ${assetErr?.message || 'unknown'}`);
                  }
                  
                  assetId = newAsset.id;
                  imageUrl = publicUrl;
                  
                  updatedVariations[i] = {
                      ...updatedVariations[i],
                      asset_id: assetId,
                      image_url: imageUrl,
                      url: imageUrl,
                      sourceType: 'asset'
                  };
              } else if (v.asset_id && v.mappedProductId) {
                  // If it's a library asset and mapping has changed, update it in the database
                  await supabase
                      .from('assets')
                      .update({ 
                          property_id: v.mappedProductId,
                          metadata: {
                              ...v.metadata,
                              custom_instructions: orchestrator.customInstructions || null
                          }
                      })
                      .eq('id', v.asset_id);
              }

              // 2. Call generate-copy API
              const copyRes = await fetch(`/api/meta-ads/optimize-campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      campaignId: orchestrator.campaign.id,
                      campaignName: orchestrator.campaign.name,
                      step: 'generate-copy',
                      imageUrls: [imageUrl],
                      propertyId: v.mappedProductId || undefined,
                      userInstructions: orchestrator.customInstructions
                  })
              });
              const copyData = await copyRes.json();
              if (copyData.status === 'success' && copyData.variation) {
                  updatedVariations[i] = {
                      ...updatedVariations[i],
                      headline: copyData.variation.headline || '',
                      primary_text: copyData.variation.primary_text || '',
                      description: copyData.variation.description || ''
                  };
              } else {
                  // Fallback if API fails
                  updatedVariations[i] = {
                      ...updatedVariations[i],
                      headline: orchestrator.campaign.name.substring(0, 40),
                      primary_text: 'Premium deal. Contact us for details!',
                      description: 'View pricing & details'
                  };
              }
          }

          setOrchestrator(prev => ({
              ...prev,
              variations: updatedVariations,
              selectedVariations: updatedVariations.map((_, idx) => idx),
              step: 3,
              status: 'reviewing',
              logs: [...prev.logs, { id: Date.now(), text: `Generated copywriting copies for ${selectedCount} variations.`, type: 'system' }]
          }));
      } catch (err: any) {
          toast.error("Failed to generate ad copywriting: " + err.message);
          setOrchestrator(prev => ({ ...prev, status: 'error' }));
      }
  }

  const removeCreative = (uid: string) => {
    setSelectedCreatives(prev => {
        const target = prev.find(p => p.uid === uid);
        if (target?.sourceType === 'local') URL.revokeObjectURL(target.previewUrl);
        return prev.filter(p => p.uid !== uid);
    })
  }

  // Generate ad copy deterministically from the selected product
  const generateAdCopy = (product: Property | null, businessName?: string, phone?: string) => {
    if (!product) return { primary_text: '', headline: '', description: '' };
    let primaryText = (product.description || 'Exclusive deal. Contact us for details.').substring(0, 400);
    if (phone) primaryText += `\n\n📞 ${phone}`;
    if (businessName) primaryText += `\n🏢 ${businessName}`;
    return {
      headline: (product.title || 'View Details').substring(0, 40),
      primary_text: primaryText,
      description: 'View pricing & details. Contact us today.'
    };
  };

  const handleLaunchCampaign = async () => {
    if (isSubmitting) return
    if (!adForm.pageId || !selectedAdAccountId) { alert("Missing Profile data."); return }
    
    const activeProducts = selectedProducts.length > 0 ? selectedProducts : (selectedProduct ? [selectedProduct] : []);
    if (activeProducts.length === 0) { alert("Please select at least one product from your inventory."); return; }
    if (selectedCreatives.length === 0) { alert("Select at least one creative."); return; }
    
    // If multiple products selected, verify mapping
    if (activeProducts.length > 1) {
        const hasUnmapped = selectedCreatives.some(c => !c.mappedProductId);
        if (hasUnmapped) {
            alert("Please map all selected creatives to a specific product.");
            return;
        }
    }
    
    if (adForm.metaLocations.length === 0 || adForm.dailyBudgetINR < 100) { alert("Set valid location and budget."); return }
    if (campaignType === 'whatsapp_chat' && !selectedWhatsAppNumber) {
        alert("Please select a connected WhatsApp number for the campaign.");
        return;
    }
    
    setIsSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('role, parent_id, agency_id, business_name, contact_number, whatsapp_phone_number').eq('id', user?.id).single();
    
    // Resolve targetUserId
    const urlParams = new URLSearchParams(window.location.search);
    const impersonateId = urlParams.get('impersonate');
    
    let tUserId = user?.id;
    if (['admin', 'agent'].includes(profile?.role || '') && (profile?.parent_id || profile?.agency_id)) {
        tUserId = (profile?.parent_id || profile?.agency_id) as string;
    }
    if (impersonateId) tUserId = impersonateId;

    let targetProfile = profile;
    if (tUserId !== user?.id) {
        const { data: tProf } = await supabase
          .from('profiles')
          .select('role, parent_id, agency_id, business_name, contact_number, whatsapp_phone_number')
          .eq('id', tUserId)
          .single();
        if (tProf) targetProfile = tProf;
    }

    const autoPrivacyUrl = `https://app.nobogent.com/privacy/${tUserId}`;

    // Resolve final follow-up link url
    let finalLinkUrl = adForm.linkUrl;
    if (campaignType === 'instant_form' && leadLandingType === 'whatsapp' && selectedWhatsAppNumber) {
        // Clean phone number (keep only digits)
        const cleanPhone = selectedWhatsAppNumber.replace(/[^0-9]/g, '');
        finalLinkUrl = `https://wa.me/${cleanPhone}`;
    } else if (campaignType === 'whatsapp_chat') {
        finalLinkUrl = `https://www.facebook.com/${adForm.pageId}`;
    }

    try {
      const finalAssetIds: string[] = [];
      const creativeUrls: string[] = [];
      const adCopies: any[] = [];
      
      const creativeProductIds: string[] = [];
      // Upload local files in-place and build copy mappings
      for (const c of selectedCreatives) {
          let assetId = c.id;
          let creativeUrl = c.url || c.imageUrl || c.image_url || '';

          if (c.sourceType === 'local' && c.file) {
              toast.info(`Uploading creative ${c.name}...`);
              const publicUrl = await uploadToR2(c.file, 'campaign_creatives');
              creativeUrl = publicUrl;
              // Insert asset record into Supabase
              const { data: newAsset, error: assetErr } = await supabase
                  .from('assets')
                  .insert({
                      url: publicUrl,
                      type: c.type || 'image',
                      user_id: tUserId,
                      status: 'Active',
                      property_id: c.mappedProductId || null,
                      metadata: {
                          custom_instructions: adForm.customInstructions || null
                      }
                  })
                  .select('id')
                  .single();
                  
              if (assetErr || !newAsset) {
                  throw new Error(`Failed to save uploaded creative database entry: ${assetErr?.message || 'unknown'}`);
              }
              assetId = newAsset.id;
          } else if (creativeUrl && (!assetId || !assetId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i))) {
              const { data: newAsset } = await supabase
                  .from('assets')
                  .insert({
                      url: creativeUrl,
                      type: c.type || 'image',
                      user_id: tUserId,
                      status: 'Active',
                      property_id: c.mappedProductId || null,
                      metadata: {
                          custom_instructions: adForm.customInstructions || null
                      }
                  })
                  .select('id')
                  .single();

              if (newAsset?.id) {
                  assetId = newAsset.id;
              }
          }
          
          if (assetId) {
              finalAssetIds.push(assetId);
          }
          if (creativeUrl) {
              creativeUrls.push(creativeUrl);
          }
          
          // Resolve mapped product for this creative
          const mappedProduct = activeProducts.find(ap => ap.id === c.mappedProductId) || activeProducts[0];
          creativeProductIds.push(mappedProduct.id);
          
          const copy = generateAdCopy(mappedProduct, targetProfile?.business_name, targetProfile?.contact_number);
          adCopies.push(copy);
      }

      const formPayload = new FormData();
      if (adForm.customInstructions) {
          formPayload.append('customInstructions', adForm.customInstructions);
      }
      formPayload.append('adAccountId', selectedAdAccountId);
      formPayload.append('facebookToken', facebookToken || '');
      formPayload.append('pageId', adForm.pageId);
      formPayload.append('metaLocations', JSON.stringify(adForm.metaLocations));
      formPayload.append('gender', adForm.gender);
      formPayload.append('dailyBudgetINR', adForm.dailyBudgetINR.toString()); 
      formPayload.append('linkUrl', finalLinkUrl);
      formPayload.append('privacyPolicyUrl', autoPrivacyUrl);
      formPayload.append('optimizeForConversions', adForm.optimizeForConversions.toString());
      formPayload.append('customQuestions', JSON.stringify(formQuestions));
      formPayload.append('campaignType', campaignType);
      formPayload.append('ageMin', adForm.ageMin.toString());
      formPayload.append('ageMax', adForm.ageMax.toString());
      
      formPayload.append('adCopy', JSON.stringify(adCopies[0] || generateAdCopy(activeProducts[0], targetProfile?.business_name, targetProfile?.contact_number)));
      formPayload.append('adCopies', JSON.stringify(adCopies));

      if (pixelId) {
          formPayload.append('pixelId', pixelId);
      }

      // Append all selected product IDs
      activeProducts.forEach(ap => {
          formPayload.append('inventoryIds', ap.id);
      });

      // Append all final asset IDs
      finalAssetIds.forEach(id => {
          formPayload.append('assetIds', id);
      });

      // Append all creative URLs
      creativeUrls.forEach(url => {
          formPayload.append('creativeUrls', url);
      });

      // Append mapped creative product IDs in order
      creativeProductIds.forEach(id => {
          formPayload.append('creativeProductIds', id);
      });

      if (campaignType === 'whatsapp_chat' && selectedWhatsAppNumber) {
          formPayload.append('whatsappNumber', selectedWhatsAppNumber);
      }

      if (runAsRemarketing && selectedCustomAudienceIds.length > 0) {
          formPayload.append('customAudienceIds', JSON.stringify(selectedCustomAudienceIds));
      }

      if (remarketSourceCampaign) {
        formPayload.append('sourceCampaignId', remarketSourceCampaign.id);
        formPayload.append('sourceCampaignName', remarketSourceCampaign.name);
      }

      const endpoint = remarketSourceCampaign 
        ? `/api/meta-ads/launch-remarketing${impersonateId ? `?impersonate=${impersonateId}` : ''}`
        : `/api/meta-ads/launch-campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

      const res = await fetch(endpoint, { method: 'POST', body: formPayload });
      const responseText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch (jsonErr) {
        if (res.status === 504) {
          toast.success('🚀 Campaign submitted! Processing in background...');
          setIsModalOpen(false);
          setRemarketSourceCampaign(null);
          setSelectedProduct(null);
          setSelectedProducts([]);
          setAdForm(prev => ({ ...prev, metaLocations: [], ageMin: 18, ageMax: 65 }));
          setSelectedCreatives([]);
          setFormQuestions([]);
          fetchAdsData(true);
          return;
        }
        throw new Error(`Server returned unexpected response (Status ${res.status}). Please try again.`);
      }
      if (res.ok) {
        if (data.jobId) {
          // Job-based async launch
          setLaunchJobId(data.jobId);
          setLaunchJobStatus('queued');
          toast.success('🚀 Campaign queued! Launching in background...');
          setIsModalOpen(false);
          setRemarketSourceCampaign(null);
          setSelectedProduct(null);
          setSelectedProducts([]);
          setAdForm(prev => ({ ...prev, metaLocations: [], ageMin: 18, ageMax: 65 }));
          setSelectedCreatives([]);
          setFormQuestions([]);
        } else {
          // Legacy direct response
          toast.success(data.message || 'Campaign launched!');
          setIsModalOpen(false);
          setRemarketSourceCampaign(null);
          setSelectedProduct(null);
          setSelectedProducts([]);
          setAdForm(prev => ({ ...prev, metaLocations: [], ageMin: 18, ageMax: 65 }));
          setSelectedCreatives([]);
          setFormQuestions([]);
          fetchAdsData(true);
        }
      } else {
        const metaError = data.metaError;
        const errorSubcode = data.error_subcode || metaError?.error_subcode;
        if (errorSubcode === 1815089) {
            if (confirm("Facebook Terms Not Accepted: You need to accept Facebook's Lead Generation Terms of Service for your Page before launching lead ads.\n\nWould you like to open the terms page now?")) {
                window.open(`https://www.facebook.com/ads/leadgen/tos/?page_id=${adForm.pageId}`, '_blank');
            }
        } else if (errorSubcode === 2663 || data.tosLink) {
            if (confirm("Facebook Custom Audience Terms Not Accepted: You need to accept Facebook's Custom Audience Terms of Service before launching retargeting campaigns.\n\nWould you like to open the terms page now?")) {
                window.open(data.tosLink || `https://www.facebook.com/customaudiences/app/tos/?act=${selectedAdAccountId.replace('act_', '')}`, '_blank');
            }
        } else {
            toast.error('Launch Failed: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (e: any) { toast.error('Launch Failed: ' + e.message); } 
    finally { setIsSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">
      <button onClick={() => fetchAdsData(true)} className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"><RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} /></button>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-8">
            <div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight ml-1">AI Ads Manager</h1>
                <p className="text-slate-500 text-sm mt-1 font-medium ml-1">Self-Optimizing Smart Campaigns</p>
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
                <button onClick={() => setIsModalOpen(true)} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-3.5 rounded-full shadow-md shadow-blue-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 font-bold"><Plus size={20} strokeWidth={3} /> <span className="hidden sm:inline">New Campaign</span></button>
            </div>
        </div>

        {/* META INTEGRATION HEALTH & FUNDS STATUS */}
        {selectedAdAccountId && (
          <div className="mb-8 bg-white border border-slate-200/60 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <CheckCircle size={18} className="text-emerald-500 animate-pulse" /> Meta Account Health & Funds
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Real-time status of your Meta Ads integration and billing configurations
                </p>
              </div>
              <div className="flex items-center gap-3 self-end md:self-auto">
                {checkingSanity ? (
                  <span className="text-xs font-bold text-slate-400 animate-pulse flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                    <Loader2 size={13} className="animate-spin text-blue-500" /> Verifying Meta Integration...
                  </span>
                ) : (
                  <button 
                    onClick={() => checkAccountStatus(selectedAdAccountId, adForm.pageId)}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50/80 px-3.5 py-1.5 rounded-full border border-blue-100 transition-all active:scale-95 flex items-center gap-1.5 bg-white shadow-sm font-semibold"
                  >
                    <RefreshCw size={12} className={checkingSanity ? "animate-spin" : ""} /> Force Check
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* 1. Available Funds */}
              <div className="bg-slate-50/80 border border-slate-200/50 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-300 transition-colors shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-blue-500/5 to-transparent rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform duration-500" />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Available Funds</span>
                  <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100/30">
                    <CreditCard size={16} />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-black text-slate-800 tracking-tight leading-none">
                    {checkingSanity ? (
                      <span className="text-slate-300 animate-pulse">Checking...</span>
                    ) : accountStatus?.prepaid_balance !== undefined && accountStatus?.prepaid_balance !== null ? (
                      `${(accountStatus.currency || currency) === 'INR' ? '₹' : (accountStatus.currency || currency) === 'AED' ? 'د.إ' : (accountStatus.currency || currency) === 'GBP' ? '£' : (accountStatus.currency || currency) === 'EUR' ? '€' : '$'}${accountStatus.prepaid_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    ) : accountStatus?.balance !== undefined && accountStatus?.balance !== null ? (
                      `${(accountStatus.currency || currency) === 'INR' ? '₹' : (accountStatus.currency || currency) === 'AED' ? 'د.إ' : (accountStatus.currency || currency) === 'GBP' ? '£' : (accountStatus.currency || currency) === 'EUR' ? '€' : '$'}${((accountStatus.balance / 100)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    ) : (
                      <span className="text-slate-400 text-sm font-semibold">Postpaid / Credit</span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium mt-2">
                    {accountStatus?.prepaid_balance !== undefined && accountStatus?.prepaid_balance !== null ? `Prepaid Balance (${accountStatus?.currency || currency})` : accountStatus?.balance !== undefined && accountStatus?.balance !== null ? `Unbilled Accrued Spend (${accountStatus?.currency || currency})` : 'Automatic Postpaid Billing'}
                  </p>
                </div>
              </div>

              {/* 2. Ad Account Status */}
              <div className="bg-slate-50/80 border border-slate-200/50 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-300 transition-colors shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-emerald-500/5 to-transparent rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform duration-500" />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Ad Account Status</span>
                  <div className={`p-2 rounded-xl border ${accountStatus?.account_status === 1 ? 'bg-emerald-50 text-emerald-600 border-emerald-100/30' : 'bg-rose-50 text-rose-600 border-rose-100/30'}`}>
                    <Zap size={16} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${accountStatus?.account_status === 1 ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
                    <div className="text-xl font-extrabold text-slate-800 leading-none">
                      {checkingSanity ? (
                        <span className="text-slate-300 animate-pulse">Checking...</span>
                      ) : accountStatus?.account_status === 1 ? (
                        'Active'
                      ) : (
                        'Inactive'
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium mt-2">
                    Meta Ad Account is {accountStatus?.account_status === 1 ? 'healthy & ready' : 'restricted/disabled'}
                  </p>
                </div>
              </div>

              {/* 3. Payment Method */}
              <div className="bg-slate-50/80 border border-slate-200/50 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-300 transition-colors shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-500/5 to-transparent rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform duration-500" />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Payment Details</span>
                  <div className={`p-2 rounded-xl border ${accountStatus?.has_payment_method ? 'bg-emerald-50 text-emerald-600 border-emerald-100/30' : 'bg-rose-50 text-rose-600 border-rose-100/30'}`}>
                    <CreditCard size={16} />
                  </div>
                </div>
                <div>
                  <div className="text-[15px] font-extrabold text-slate-800 leading-snug break-words">
                    {checkingSanity ? (
                      <span className="text-slate-300 animate-pulse">Checking...</span>
                    ) : accountStatus?.has_payment_method ? (
                      accountStatus?.funding_source_details?.display_string || 'Linked'
                    ) : (
                      'Missing Card'
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium mt-2">
                    {accountStatus?.has_payment_method ? 'Payment method linked to Ads account' : 'Funding source not found'}
                  </p>
                </div>
              </div>

              {/* 4. Lead Ads TOS */}
              <div className="bg-slate-50/80 border border-slate-200/50 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-300 transition-colors shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-purple-500/5 to-transparent rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform duration-500" />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Lead Ads TOS</span>
                  <div className={`p-2 rounded-xl border ${accountStatus?.leadgenTos?.leadgen_tos?.accepted ? 'bg-emerald-50 text-emerald-600 border-emerald-100/30' : 'bg-rose-50 text-rose-600 border-rose-100/30'}`}>
                    <Settings2 size={16} />
                  </div>
                </div>
                <div>
                  <div className="text-xl font-extrabold text-slate-800 leading-none">
                    {checkingSanity ? (
                      <span className="text-slate-300 animate-pulse">Checking...</span>
                    ) : accountStatus?.leadgenTos?.leadgen_tos?.accepted ? (
                      'Accepted'
                    ) : (
                      'Not Accepted'
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium mt-2">
                    Page Lead Gen Terms of Service
                  </p>
                </div>
              </div>
            </div>

            {/* Warnings / Error banner section */}
            {!checkingSanity && (
              <div className="mt-5 space-y-2.5">
                {accountStatus?.error && (
                  <div className="bg-rose-50 border border-rose-100/80 p-4 rounded-2xl text-xs text-rose-800 font-semibold leading-relaxed flex items-start gap-3 animate-in fade-in duration-300">
                    <XCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                    <div className="break-words max-w-full">
                      <span className="font-bold text-rose-900 block mb-0.5">Meta Verification Failed</span>
                      {accountStatus.error}
                    </div>
                  </div>
                )}
                {!accountStatus?.error && accountStatus?.account_status !== 1 && (
                  <div className="bg-rose-50/80 border border-rose-100/60 p-4 rounded-2xl text-xs text-rose-800 font-semibold leading-relaxed flex items-start gap-3">
                    <XCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-rose-900 block">Meta Ad Account is Inactive or Restricted</span>
                      Your Meta Ad Account status is disabled. Please resolve billing, review policy holds, or verify identity.
                      <a href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-rose-900 underline font-extrabold mt-1">Open Meta Ads Manager <ExternalLink size={12} /></a>
                    </div>
                  </div>
                )}
                {!accountStatus?.has_payment_method && (
                  <div className="bg-rose-50/80 border border-rose-100/60 p-4 rounded-2xl text-xs text-rose-800 font-semibold leading-relaxed flex items-start gap-3">
                    <XCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-rose-900 block">Missing Payment Method</span>
                      No payment card, PayPal, or ad credit is linked to this account. Campaigns cannot serve impressions without a active payment method.
                      <a href="https://adsmanager.facebook.com/ads/manager/billing/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-rose-900 underline font-extrabold mt-1">Link Payment Method in Meta Billing <ExternalLink size={12} /></a>
                    </div>
                  </div>
                )}
                {accountStatus?.leadgenTos?.leadgen_tos?.accepted !== true && (
                  <div className="bg-rose-50/80 border border-rose-100/60 p-4 rounded-2xl text-xs text-rose-800 font-semibold leading-relaxed flex items-start gap-3">
                    <XCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-rose-900 block">Page Lead Generation Terms Outstanding</span>
                      You must accept Facebook's Lead Generation Terms of Service for your connected Facebook Page before running lead-based campaigns.
                      <a href={`https://www.facebook.com/ads/leadgen/tos/?page_id=${adForm.pageId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-rose-900 underline font-extrabold mt-1">Review & Accept Terms on Facebook <ExternalLink size={12} /></a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* CAMPAIGN SEARCH BAR */}
        {!loading && campaigns.length > 0 && (
          <div className="mb-6 relative max-w-md">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              value={campaignSearchQuery}
              onChange={(e) => setCampaignSearchQuery(e.target.value)}
              placeholder="Search campaigns by name or objective..." 
              className="w-full bg-white border border-slate-200 py-3.5 pl-12 pr-4 rounded-[1.25rem] shadow-sm text-sm text-slate-700 font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all" 
            />
            {campaignSearchQuery && (
              <button 
                onClick={() => setCampaignSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {loading ? (
            <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 gap-4"><Loader2 size={32} className="animate-spin text-slate-300" /><p className="text-sm font-medium animate-pulse">Syncing with Meta...</p></div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6"> 
                {campaigns.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-[1.75rem] xs:rounded-[2.5rem] border border-slate-200/60 border-dashed"><LayoutGrid size={48} className="text-slate-200 mb-4" /><p className="text-base font-bold text-slate-600">No active campaigns</p><p className="text-sm mt-1">Tap 'New Campaign' to launch your first AI-optimized ad.</p></div>
                ) : (
                    [...campaigns]
                    .filter(c => {
                        const q = campaignSearchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (c.name || '').toLowerCase().includes(q) || (c.objective || '').toLowerCase().includes(q);
                    })
                    .sort((a, b) => {
                        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
                        if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
                        return 0;
                    }).map(campaign => (
                        <div key={campaign.id} className="bg-white p-6 rounded-[1.5rem] xs:rounded-[2rem] shadow-sm border border-slate-200/60 transition-all hover:shadow-lg hover:border-blue-200 flex flex-col h-full group">
                            <div className="flex justify-between items-start mb-4 gap-3">
                                <div onClick={() => handleOpenExplorer(campaign)} className="flex-1 min-w-0 cursor-pointer">
                                    <h3 className="text-sm sm:text-base font-bold text-slate-800 leading-tight group-hover:text-blue-600 transition-colors flex items-center gap-1.5 w-full">
                                        <span className="truncate flex-1">{campaign.name}</span>
                                        <ExternalLink size={12} className="text-slate-300 group-hover:text-blue-400 transition-colors shrink-0" />
                                    </h3>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${campaign.status === 'ACTIVE' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                                            {campaign.status === 'ACTIVE' ? <PlayCircle size={10}/> : <PauseCircle size={10}/>} {campaign.status}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {togglingId === campaign.id && <Loader2 size={14} className="animate-spin text-slate-400" />}
                                    <button onClick={() => handleToggleStatus(campaign.id, campaign.status)} className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${campaign.status === 'ACTIVE' ? 'bg-green-500 focus:ring-green-500' : 'bg-slate-200 focus:ring-slate-400'}`}><div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${campaign.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} /></button>
                                    <button 
                                        onClick={() => handleDeleteCampaign(campaign.id, campaign.name)}
                                        disabled={deletingId === campaign.id}
                                        className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                                        title="Delete Campaign"
                                    >
                                        {deletingId === campaign.id ? <Loader2 size={14} className="animate-spin text-red-500" /> : <Trash2 size={14} />}
                                    </button>
                                </div>
                            </div>
                            <div className="flex-grow"></div>
                            <div className="flex justify-between items-center text-xs text-slate-500 pt-4 border-t border-slate-100 gap-1.5 flex-wrap">
                                <button onClick={() => handleOpenStats(campaign)} className="flex items-center justify-center gap-1 text-xs font-bold text-slate-600 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 py-2 px-2.5 rounded-xl transition-colors"><TrendingUp size={14} /> Stats</button>
                                <button onClick={() => handleOpenAnalysis(campaign)} className="flex items-center justify-center gap-1 text-xs font-bold text-slate-600 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 py-2 px-2.5 rounded-xl transition-colors"><BarChart4 size={14} /> Analyse</button>
                                <button onClick={() => handleOptimize(campaign)} disabled={orchestrator.isOpen && orchestrator.mode === 'optimize'} className={`flex items-center justify-center gap-1 text-xs font-bold py-2 px-2.5 rounded-xl transition-all ${orchestrator.isOpen && orchestrator.campaign?.id === campaign.id && orchestrator.mode === 'optimize' ? 'bg-purple-100 text-purple-400 cursor-not-allowed' : optimizedCampaigns.includes(campaign.id) ? 'bg-purple-50 text-purple-600 border border-purple-100 hover:bg-purple-100' : campaign.status !== 'ACTIVE' ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'bg-purple-50 text-purple-600 hover:bg-purple-100 hover:text-purple-700 shadow-sm'}`}>
                                    <Sparkles size={14} /> 
                                    {orchestrator.isOpen && orchestrator.campaign?.id === campaign.id ? 'Optimizing...' : optimizedCampaigns.includes(campaign.id) ? 'Re-optimize' : 'Optimize'}
                                </button>
                                <a href={`https://adsmanager.facebook.com/ads/manager/account/campaigns/`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-xl transition-colors"><ExternalLink size={16} /></a>
                            </div>
                        </div>
                    ))
                )}
            </div>
        )}
      </div>
        {orchestrator.isOpen && (
          <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
              <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl rounded-[2.5rem] p-6 sm:p-10 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-8 overflow-hidden flex flex-col relative">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-purple-100 to-transparent rounded-bl-full opacity-50 pointer-events-none" />
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 relative z-10 shrink-0">
                      <div><h2 className="text-xl font-bold text-slate-900 leading-tight flex items-center gap-2"><Sparkles className="text-purple-500"/> AdRolls Strategist</h2><p className="text-xs font-medium text-slate-500 mt-1 uppercase tracking-widest">{orchestrator.mode === 'optimize' ? 'Andromeda Optimization' : 'Remarketing Engine'}</p></div>
                      <button onClick={() => setOrchestrator(prev => ({...prev, isOpen: false}))} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors shrink-0"><X size={18} /></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-6 relative z-10">
                      {/* STEP INDICATOR */}
                      <div className="flex items-center justify-between mb-8 px-2">
                          {[2, 3].map((s, idx) => (
                              <div key={s} className="flex items-center gap-2">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all ${orchestrator.step === s ? 'bg-purple-600 text-white shadow-lg ring-4 ring-purple-100' : orchestrator.step > s ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                      {orchestrator.step > s ? <CheckCircle size={14} /> : (idx + 1)}
                                  </div>
                                  <span className={`text-[10px] font-bold uppercase tracking-widest hidden xs:block ${orchestrator.step === s ? 'text-slate-900' : 'text-slate-400'}`}>
                                      {s === 2 ? 'Assets' : 'Review'}
                                  </span>
                                  {idx < 1 && <div className="w-16 sm:w-24 h-[2px] bg-slate-100 mx-2" />}
                              </div>
                          ))}
                      </div>

                      <div className="space-y-6">
                        {/* STEP 1: STRATEGY */}
                        {orchestrator.step === 1 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {orchestrator.status === 'analyzing' ? (
                                    <div className="flex flex-col items-center justify-center py-12 space-y-4 animate-in fade-in duration-500">
                                        <div className="relative">
                                            <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center">
                                                <Sparkles size={32} className="text-purple-600 animate-pulse" />
                                            </div>
                                            <div className="absolute inset-0 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                                        </div>
                                        <p className="text-sm font-bold text-slate-800 animate-pulse">Andromeda is thinking...</p>
                                        <div className="max-w-[240px] text-center">
                                            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest leading-loose">Analyzing past performance, competitor angles, and visual DNA...</p>
                                        </div>
                                    </div>
                                ) : orchestrator.status === 'presenting' ? (
                                    <div className="space-y-6">
                                        <div className="bg-purple-50 border border-purple-100 p-6 rounded-[2rem] relative overflow-hidden">
                                            <div className="absolute top-0 right-0 p-4 opacity-10"><Sparkles size={48} /></div>
                                            <p className="text-[10px] font-bold text-purple-600 uppercase tracking-widest mb-3 flex items-center gap-2"><Sparkles size={12} /> AI Strategy Insight</p>
                                            <p className="text-sm text-slate-800 font-medium leading-relaxed italic">"{orchestrator.insight}"</p>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center px-1">
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Select Angles to Generate:</p>
                                                <button 
                                                    onClick={handleStartOptimization} 
                                                    className="text-[10px] font-bold text-purple-600 uppercase tracking-widest hover:text-purple-800 transition-colors flex items-center gap-1"
                                                >
                                                    <RefreshCw size={10} /> Generate More
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-1 gap-3">
                                                {orchestrator.variations.map((v, i) => (
                                                    <div 
                                                        key={i} 
                                                        onClick={() => {
                                                            const isSelected = orchestrator.selectedVariations.includes(i);
                                                            setOrchestrator(prev => ({
                                                                ...prev,
                                                                selectedVariations: isSelected ? prev.selectedVariations.filter(idx => idx !== i) : [...prev.selectedVariations, i]
                                                            }));
                                                        }}
                                                        className={`p-4 rounded-2xl border-2 transition-all cursor-pointer ${orchestrator.selectedVariations.includes(i) ? 'border-purple-500 bg-purple-50/50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                                                    >
                                                        <div className="flex justify-between items-start gap-3">
                                                            <div className="flex-1">
                                                                <h4 className="text-xs font-bold text-slate-900 mb-1">{v.title}</h4>
                                                                <p className="text-[10px] text-slate-500 font-medium leading-relaxed">{v.image_prompt}</p>
                                                            </div>
                                                            {orchestrator.selectedVariations.includes(i) && <div className="bg-purple-600 text-white p-1 rounded-full"><Check size={10} /></div>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Visual Style</label>
                                                <div className="flex bg-slate-100 p-1 rounded-2xl">
                                                    {(['hyper', 'organic'] as const).map(s => (
                                                        <button 
                                                            key={s} 
                                                            onClick={() => setOrchestrator(prev => ({...prev, style: s}))}
                                                            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all ${orchestrator.style === s ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                                        >
                                                            {s}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Total Variations</label>
                                                <select 
                                                    value={orchestrator.generationCount}
                                                    onChange={(e) => setOrchestrator(prev => ({...prev, generationCount: parseInt(e.target.value)}))}
                                                    className="w-full bg-slate-100 text-slate-700 text-xs font-bold py-2.5 px-3 rounded-2xl outline-none focus:ring-2 focus:ring-purple-500/20 shadow-inner"
                                                >
                                                    {[3, 5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n} Variants</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        <button 
                                            onClick={() => setOrchestrator(prev => ({...prev, status: 'setup', insight: '', variations: [], selectedVariations: []}))}
                                            className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-widest py-2 hover:text-slate-600 transition-colors text-center"
                                        >
                                            ← Change Strategy
                                        </button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4">
                                        <button 
                                            onClick={handleStartOptimization}
                                            className="group relative bg-white border-2 border-slate-100 hover:border-purple-500 p-6 rounded-[2rem] text-left transition-all hover:shadow-xl overflow-hidden"
                                        >
                                            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-50 rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity" />
                                            <div className="bg-purple-100 w-12 h-12 rounded-2xl flex items-center justify-center text-purple-600 mb-4 group-hover:scale-110 transition-transform">
                                                <Sparkles size={24} />
                                            </div>
                                            <h3 className="text-lg font-black text-slate-900 mb-1">Deep AI Analysis</h3>
                                            <p className="text-xs text-slate-500 font-medium leading-relaxed">Let Andromeda analyze your campaign data and generate the highest performing angles automatically.</p>
                                            <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-purple-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                                                Start Analysis <Zap size={10} />
                                            </div>
                                        </button>

                                        <button 
                                            onClick={() => setOrchestrator(prev => ({ ...prev, step: 2, status: 'picking', isManual: true }))}
                                            className="group relative bg-white border-2 border-slate-100 hover:border-blue-500 p-6 rounded-[2rem] text-left transition-all hover:shadow-xl overflow-hidden"
                                        >
                                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity" />
                                            <div className="bg-blue-100 w-12 h-12 rounded-2xl flex items-center justify-center text-blue-600 mb-4 group-hover:scale-110 transition-transform">
                                                <Video size={24} />
                                            </div>
                                            <h3 className="text-lg font-black text-slate-900 mb-1">Manual Selection</h3>
                                            <p className="text-xs text-slate-500 font-medium leading-relaxed">Pick existing creatives from your library and publish them directly to the campaign.</p>
                                            <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                                                Open Library <Zap size={10} />
                                            </div>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* STEP 2: ASSET SELECTION */}
                        {orchestrator.step === 2 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                {orchestrator.status === 'generating' ? (
                                    <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
                                        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center relative">
                                            <Zap size={32} className="text-blue-600 animate-bounce" />
                                            <div className="absolute inset-0 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900">Crafting your new variations...</p>
                                            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-1">This takes about 1-2 minutes. They will appear in your library automatically.</p>
                                        </div>
                                        <div className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Background Progress</div>
                                            <div className="space-y-2">
                                                {orchestrator.logs.slice(-2).map(log => (
                                                    <div key={log.id} className="text-[10px] text-slate-500 font-medium flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-400" /> {log.text}</div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select from library:</p>
                                            <div className="flex gap-2">
                                                {['All', 'image', 'video'].map(f => (
                                                    <button key={f} type="button" onClick={() => setAssetFilter(f)} className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${assetFilter === f ? 'bg-purple-100 text-purple-600' : 'text-slate-400 hover:text-slate-600'}`}>{f}</button>
                                                ))}
                                            </div>
                                        </div>
                                        
                                        {/* Library Grid */}
                                        <div className="grid grid-cols-4 gap-3 max-h-48 overflow-y-auto p-1 border border-slate-100 rounded-2xl mb-4 bg-slate-50/50">
                                            {assets.filter(a => assetFilter === 'All' || a.type === assetFilter).map(a => {
                                                const isSelected = orchestrator.variations.some(v => v.asset_id === a.id);
                                                return (
                                                    <div key={a.id} onClick={() => {
                                                        setOrchestrator(prev => {
                                                            if (isSelected) {
                                                                return { ...prev, variations: prev.variations.filter(v => v.asset_id !== a.id), selectedVariations: prev.variations.filter(v => v.asset_id !== a.id).map((_, i) => i) };
                                                            }
                                                            
                                                            const rawCaption = a.caption || '';
                                                            const campaignName = orchestrator.campaign?.name || "";
                                                            const matchedProperty = properties.find(p => p.title && campaignName.toLowerCase().includes(p.title.toLowerCase()));
                                                            
                                                            let headline = matchedProperty ? matchedProperty.title : `${orchestrator.campaign?.name} - Exclusive Offer`;
                                                            let primaryText = matchedProperty ? matchedProperty.description : `Premium opportunities at ${orchestrator.campaign?.name}. Contact us today!`;
                                                            let description = "";

                                                            if (rawCaption.includes('\n\n')) {
                                                                const parts = rawCaption.split('\n\n');
                                                                headline = parts[0];
                                                                primaryText = parts[1] || "";
                                                                description = parts.slice(2).join('\n\n');
                                                            } else if (rawCaption.includes('\n')) {
                                                                const parts = rawCaption.split('\n');
                                                                headline = parts[0];
                                                                primaryText = parts.slice(1).join('\n');
                                                            } else if (rawCaption.length > 0) {
                                                                headline = rawCaption;
                                                            }

                                                            const newVar = { 
                                                                asset_id: a.id, 
                                                                type: a.type,
                                                                image_url: a.url, 
                                                                url: a.url,
                                                                headline: headline,
                                                                primary_text: primaryText,
                                                                description: description,
                                                                caption: a.caption,
                                                                title: 'Library Creative',
                                                                thumbnailUrl: a.metadata?.thumbnailUrl,
                                                                mappedProductId: a.property_id || ''
                                                            };
                                                            const newVariations = [...prev.variations, newVar];
                                                            return { ...prev, variations: newVariations, selectedVariations: newVariations.map((_, i) => i) };
                                                        });
                                                    }} className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${isSelected ? 'border-blue-500 shadow-md ring-2 ring-blue-500/20' : 'border-slate-100 hover:border-slate-200 bg-white'}`}>
                                                        {a.type === 'video' ? (
                                                            <LazyVideo
                                                                src={fixR2Url(a.url)}
                                                                poster={a.metadata?.thumbnailUrl ? fixR2Url(a.metadata.thumbnailUrl) : undefined}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <img src={fixR2Url(a.url)} className="w-full h-full object-cover" />
                                                        )}
                                                        {isSelected && <div className="absolute top-1 right-1 bg-blue-600 text-white p-0.5 rounded-full shadow-sm"><CheckCircle size={8} /></div>}
                                                        {a.caption && <div className="absolute top-1 left-1 bg-purple-600 text-white p-0.5 rounded-full shadow-sm animate-pulse"><Sparkles size={8} /></div>}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Upload In-place Custom Files */}
                                        <div className="mb-4">
                                            <input
                                                type="file"
                                                ref={optimizerFileInputRef}
                                                onChange={handleOptimizerLocalFiles}
                                                accept="image/*,video/*"
                                                className="hidden"
                                                multiple
                                            />
                                            <button
                                                type="button"
                                                onClick={() => optimizerFileInputRef.current?.click()}
                                                className="w-full py-3 border-2 border-dashed border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50 rounded-2xl text-xs font-bold text-slate-500 hover:text-blue-600 flex items-center justify-center gap-2 transition-all"
                                            >
                                                <Upload size={14} /> Upload Custom Files
                                            </button>
                                        </div>

                                        {/* Selected Assets and Mapping Dropdowns */}
                                        {orchestrator.variations.length > 0 && (
                                            <div className="border-t border-slate-100 pt-4">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Selected Creatives & Product Mappings ({orchestrator.variations.length})</p>
                                                <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                                                    {orchestrator.variations.map((v, idx) => {
                                                        const isVideo = v.type === 'video' || (typeof v.image_url === 'string' && v.image_url.toLowerCase().match(/\.(mp4|mov|avi|wmv)/));
                                                        return (
                                                            <div key={idx} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-slate-100/50 transition-colors">
                                                                <div className="relative w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex-shrink-0 overflow-hidden">
                                                                    {isVideo ? (
                                                                        <LazyVideo src={fixR2Url(v.image_url)} className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <img src={fixR2Url(v.image_url)} className="w-full h-full object-cover" />
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-[11px] font-bold text-slate-800 truncate">{v.title}</div>
                                                                    <div className="text-[9px] text-slate-400 capitalize">{v.sourceType || 'asset'} {v.type || 'image'}</div>
                                                                    
                                                                    <div className="mt-1">
                                                                        <select
                                                                            value={v.mappedProductId || ''}
                                                                            onChange={(e) => {
                                                                                const prodId = e.target.value;
                                                                                setOrchestrator(prev => {
                                                                                    const updated = [...prev.variations];
                                                                                    updated[idx] = { ...updated[idx], mappedProductId: prodId };
                                                                                    return { ...prev, variations: updated };
                                                                                });
                                                                            }}
                                                                            className="w-full max-w-[200px] bg-white border border-slate-200 text-slate-700 py-1.5 px-2 rounded-xl text-[9px] font-bold outline-none cursor-pointer hover:bg-slate-50 transition-all"
                                                                        >
                                                                            <option value="">-- Map to Product --</option>
                                                                            {properties.map(p => (
                                                                                <option key={p.id} value={p.id}>{p.title}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setOrchestrator(prev => {
                                                                            const updated = prev.variations.filter((_, i) => i !== idx);
                                                                            return { ...prev, variations: updated, selectedVariations: updated.map((_, i) => i) };
                                                                        });
                                                                    }}
                                                                    className="text-slate-400 hover:text-red-500 p-1.5 transition-colors bg-white rounded-full border border-slate-200/60 shadow-sm hover:border-red-100"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Gemini Custom Copywriting instructions field */}
                                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mt-4">
                                             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">AI Copywriting Instructions for Gemini</label>
                                             <textarea 
                                                 value={orchestrator.customInstructions}
                                                 onChange={(e) => setOrchestrator(prev => ({...prev, customInstructions: e.target.value}))}
                                                 placeholder="E.g. Focus on luxury amenities, professional copywriting tone..."
                                                 rows={2}
                                                 className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-purple-500/20 transition-all resize-none font-medium text-slate-700"
                                             />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* STEP 3: REVIEW & EDIT */}
                        {orchestrator.step === 3 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Refine Ad Copy & Headlines:</p>
                                <div className="space-y-4">
                                    {orchestrator.variations.map((v, i) => (
                                        <div key={i} className="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-sm hover:shadow-md transition-all">
                                            <div className="flex gap-4 items-start">
                                                <div className="w-20 h-20 rounded-2xl overflow-hidden border border-slate-100 shrink-0 shadow-inner">
                                                    {v.type === 'video' ? (
                                                        <LazyVideo 
                                                            src={fixR2Url(v.image_url)} 
                                                            poster={(v as any).thumbnailUrl ? fixR2Url((v as any).thumbnailUrl) : undefined} 
                                                            className="w-full h-full object-cover" 
                                                        />
                                                    ) : (
                                                        <img src={fixR2Url(v.image_url)} className="w-full h-full object-cover" />
                                                    )}
                                                </div>
                                                <div className="flex-1 space-y-4">
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex-1">
                                                            <p className="text-[9px] font-bold text-purple-600 uppercase tracking-widest mb-1">Headline</p>
                                                            <input 
                                                                type="text" 
                                                                value={v.headline} 
                                                                onChange={(e) => {
                                                                    setOrchestrator(prev => {
                                                                        const newVars = [...prev.variations];
                                                                        newVars[i].headline = e.target.value;
                                                                        return { ...prev, variations: newVars };
                                                                    });
                                                                }}
                                                                className="w-full text-sm font-black text-slate-900 bg-slate-50 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500/20" 
                                                            />
                                                        </div>
                                                        {true && (
                                                            <button 
                                                                onClick={() => handleRegenerateVariation(i)}
                                                                className="ml-2 bg-slate-100 p-2 rounded-xl text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-all"
                                                                title="Regenerate this variation"
                                                            >
                                                                <RefreshCw size={16} />
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div>
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Primary Text</p>
                                                        <textarea 
                                                            value={v.primary_text} 
                                                            onChange={(e) => {
                                                                setOrchestrator(prev => {
                                                                    const newVars = [...prev.variations];
                                                                    newVars[i].primary_text = e.target.value;
                                                                    return { ...prev, variations: newVars };
                                                                });
                                                            }}
                                                            rows={3} 
                                                            className="w-full text-xs text-slate-600 font-medium leading-relaxed bg-slate-50 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500/20 resize-none" 
                                                        />
                                                    </div>

                                                    <div>
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Description (Optional)</p>
                                                        <input 
                                                            type="text" 
                                                            value={v.description || ''} 
                                                            onChange={(e) => {
                                                                setOrchestrator(prev => {
                                                                    const newVars = [...prev.variations];
                                                                    newVars[i].description = e.target.value;
                                                                    return { ...prev, variations: newVars };
                                                                });
                                                            }}
                                                            className="w-full text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500/20" 
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* STEP 4: SUCCESS */}
                        {orchestrator.step === 4 && (
                            <div className="flex flex-col items-center justify-center py-12 text-center animate-in zoom-in-95 duration-500">
                                <div className="bg-green-100 w-24 h-24 rounded-full flex items-center justify-center text-green-600 mb-6 shadow-lg shadow-green-100 ring-8 ring-green-50 animate-bounce">
                                    <CheckCircle size={48} />
                                </div>
                                <h3 className="text-2xl font-black text-slate-900 mb-2">Campaign Deployed!</h3>
                                <p className="text-sm text-slate-500 font-medium max-w-[250px] mx-auto leading-relaxed">Your AI optimized variations are now LIVE on Meta. Head over to the Ads Manager to monitor performance.</p>
                            </div>
                        )}

                        {/* PROCESSING OVERLAYS */}
                        {orchestrator.status === 'analyzing' && (
                            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                                <Loader2 className="animate-spin text-purple-600" size={40} />
                                <div className="space-y-1">
                                    <p className="text-sm font-bold text-slate-900">Andromeda is working...</p>
                                    <p className="text-xs text-slate-500">Drafting premium copy variations for you.</p>
                                </div>
                            </div>
                        )}
                        {orchestrator.status === 'error' && (
                            <div className="bg-red-50 border border-red-100 p-4 rounded-2xl text-red-600 text-xs font-medium flex items-center gap-3">
                                <XCircle size={18} />
                                Something went wrong. Please try again.
                            </div>
                        )}
                      </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 relative z-20 shrink-0">
                      {/* STEP FOOTERS */}
                      {orchestrator.step === 1 && (
                          <div className="flex flex-col gap-3">
                              {orchestrator.status === 'presenting' ? (
                                  <button 
                                    onClick={handleGenerateOptimization}
                                    className="w-full bg-purple-600 text-white font-bold py-4 rounded-2xl hover:bg-purple-700 shadow-md transition-all flex items-center justify-center gap-2"
                                  >
                                      Generate {orchestrator.generationCount} Variations <ArrowRight size={18} />
                                  </button>
                              ) : (
                                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-2">
                                       <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Instructions for Gemini</label>
                                       <textarea 
                                           value={orchestrator.customInstructions}
                                           onChange={(e) => setOrchestrator(prev => ({...prev, customInstructions: e.target.value}))}
                                           placeholder="E.g. Focus on high ROI, use professional tone..."
                                           rows={2}
                                           className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-purple-500/20 transition-all resize-none"
                                       />
                                  </div>
                              )}
                          </div>
                      )}

                      {orchestrator.step === 2 && (
                          <div className="flex flex-col gap-3">
                              <button 
                                onClick={handleGenerateManualCopies}
                                disabled={orchestrator.variations.length === 0 || orchestrator.status === 'generating'}
                                className="w-full bg-purple-600 text-white font-bold py-4 rounded-2xl hover:bg-purple-700 shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                  {orchestrator.status === 'generating' ? <><Loader2 size={18} className="animate-spin" /> Generating Copy...</> : <><Sparkles size={18} /> Generate AI Copy & Review <ArrowRight size={18} /></>}
                              </button>
                          </div>
                      )}

                      {orchestrator.step === 3 && (
                          <div className="flex flex-col gap-3">
                              <button 
                                onClick={handleApproveVariations} 
                                disabled={orchestrator.selectedVariations.length === 0 || orchestrator.status === 'pushing'} 
                                className="w-full bg-green-600 text-white font-bold py-4 rounded-2xl hover:bg-green-700 shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                  {orchestrator.status === 'pushing' ? <><Loader2 size={18} className="animate-spin" /> Pushing...</> : <><Zap size={18} /> Push {orchestrator.selectedVariations.length} Selected LIVE</>}
                              </button>
                              <button onClick={() => setOrchestrator(prev => ({...prev, step: 2}))} className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-widest py-2 hover:text-slate-600 transition-colors text-center">← Change Asset Selection</button>
                          </div>
                      )}

                      {orchestrator.step === 4 && (
                          <button onClick={() => setOrchestrator(prev => ({...prev, isOpen: false}))} className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 shadow-md transition-all flex items-center justify-center gap-2">Done</button>
                      )}
                  </div>
              </div>
          </div>
      )}

      {activeExplorerCampaign && (
        <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-4xl h-[90vh] rounded-[2.5rem] p-6 sm:p-10 shadow-2xl flex flex-col overflow-hidden relative animate-in zoom-in-95 slide-in-from-bottom-8">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-50 to-transparent rounded-bl-full opacity-50 pointer-events-none" />
            
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 shrink-0 relative z-10">
              <div>
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <LayoutGrid className="text-blue-600 animate-pulse" /> Campaign Explorer & Editor
                </h2>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                  Facebook Meta Integration
                </p>
              </div>
              <button 
                onClick={() => { setActiveExplorerCampaign(null); setExplorerData(null); }} 
                className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {loadingExplorer ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400">
                <Loader2 size={36} className="animate-spin text-blue-600" />
                <p className="text-sm font-black animate-pulse">Syncing campaign hierarchy from Meta...</p>
              </div>
            ) : explorerData ? (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6 relative z-10">
                
                {/* 1. Campaign Settings / Edit */}
                <div className="bg-slate-50 border border-slate-200/60 p-6 rounded-[2rem] space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="flex-1">
                      {editingNode && editingNode.id === explorerData.campaign.id ? (
                        <div className="flex gap-2 items-center flex-wrap">
                          <input 
                            type="text" 
                            value={editingNode.name} 
                            onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })} 
                            className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold w-full max-w-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                          {explorerData.campaign.budgetType !== 'none' && (
                            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl shadow-inner">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Budget:</span>
                              <input 
                                type="number" 
                                value={editingNode.budget || 0} 
                                onChange={(e) => setEditingNode({ ...editingNode, budget: parseFloat(e.target.value) || 0 })} 
                                className="bg-transparent border-0 outline-none text-xs font-bold w-24"
                              />
                            </div>
                          )}
                          <button 
                            onClick={handleSaveNodeEdit} 
                            disabled={isSavingEdit}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-1 shadow-sm disabled:opacity-50"
                          >
                            {isSavingEdit ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                          </button>
                          <button 
                            onClick={() => setEditingNode(null)} 
                            className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 text-xs font-bold py-2 px-4 rounded-xl"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-black text-slate-900">{explorerData.campaign.name}</h3>
                          <button 
                            onClick={() => setEditingNode({ id: explorerData.campaign.id, type: 'campaign', name: explorerData.campaign.name, budget: explorerData.campaign.budget, budgetType: explorerData.campaign.budgetType })} 
                            className="text-slate-400 hover:text-blue-600 p-1"
                          >
                            <Settings2 size={14} />
                          </button>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Campaign ID: {explorerData.campaign.id}</p>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Budget */}
                      {explorerData.campaign.budgetType !== 'none' && (
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Advantage+ Budget</div>
                          <div className="text-sm font-black text-slate-800">
                            {currency === 'INR' ? '₹' : '$'}{explorerData.campaign.budget} / day
                          </div>
                        </div>
                      )}
                      
                      {/* Status */}
                      <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200/80 shadow-sm">
                        <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-md ${explorerData.campaign.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {explorerData.campaign.status}
                        </span>
                        <button 
                          onClick={() => handleToggleNodeStatus(explorerData.campaign.id, explorerData.campaign.status, 'campaign')}
                          className={`w-10 h-6 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${explorerData.campaign.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-200'}`}
                        >
                          <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-200 ${explorerData.campaign.status === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Metrics Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100 flex flex-col justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><CreditCard size={14} className="text-slate-400" /> Spend</span>
                    <span className="text-xl font-black text-slate-800">{currency === 'INR' ? '₹' : '$'}{explorerData.campaign.metrics.spend.toFixed(2)}</span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100 flex flex-col justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Eye size={14} className="text-slate-400" /> Impressions</span>
                    <span className="text-xl font-black text-slate-800">{explorerData.campaign.metrics.impressions.toLocaleString()}</span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100 flex flex-col justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><MousePointerClick size={14} className="text-slate-400" /> Clicks</span>
                    <span className="text-xl font-black text-slate-800">{explorerData.campaign.metrics.clicks.toLocaleString()} <span className="text-[10px] text-slate-400 font-semibold ml-1">({explorerData.campaign.metrics.ctr.toFixed(2)}% CTR)</span></span>
                  </div>
                  {(() => {
                    const c = explorerData.campaign as any;
                    const isWA = c?.objective === 'WHATSAPP' || 
                                 c?.objective === 'OUTCOME_ENGAGEMENT' || 
                                 c?.campaign_type === 'whatsapp_chat' || 
                                 c?.destination_type === 'WHATSAPP' ||
                                 explorerData.adsets?.some((as: any) => as.destination_type === 'WHATSAPP' || as.promoted_object?.whatsapp_phone_number || as.ads?.some((ad: any) => (ad.creative?.linkUrl || '').includes('whatsapp') || (ad.creative?.linkUrl || '').includes('wa.me')));
                    return (
                      <div className="bg-blue-50 p-4 rounded-[1.5rem] border border-blue-100 shadow-sm flex flex-col justify-between">
                        <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Users size={14} className="text-blue-400" /> {isWA ? 'WhatsApp Conversations' : 'Leads'}</span>
                        <div>
                          <span className="text-2xl font-black text-blue-700">{explorerData.campaign.metrics.leads}</span>
                          {explorerData.campaign.metrics.leads > 0 && (
                            <div className="text-[10px] text-blue-500 font-bold mt-1">
                              {currency === 'INR' ? '₹' : '$'}{explorerData.campaign.metrics.cpl.toFixed(2)} / {isWA ? 'conv' : 'lead'}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 3. Hierarchy Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest px-1">Ad Sets & Ads Hierarchy</h4>
                  
                  {explorerData.adsets.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
                      No Ad Sets found under this campaign.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {explorerData.adsets.map((adset: any) => {
                        const isExpanded = expandedAdSets.includes(adset.id);
                        return (
                          <div key={adset.id} className="bg-white border border-slate-200/60 rounded-[2rem] p-4 sm:p-6 shadow-sm space-y-4">
                            {/* Adset Row Header */}
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                              <div className="flex-1">
                                {editingNode && editingNode.id === adset.id ? (
                                  <div className="w-full bg-slate-50 border border-slate-200 rounded-[1.5rem] p-5 space-y-4 shadow-inner">
                                    <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                                      <h6 className="text-xs font-black text-slate-800">Edit Ad Set Settings</h6>
                                      <div className="flex gap-2">
                                        <button 
                                          onClick={handleSaveNodeEdit} 
                                          disabled={isSavingEdit}
                                          className="bg-green-600 hover:bg-green-700 text-white font-bold text-[10px] py-1.5 px-4 rounded-lg flex items-center gap-1 shadow-sm disabled:opacity-50"
                                        >
                                          {isSavingEdit ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save Changes
                                        </button>
                                        <button 
                                          onClick={() => { setEditingNode(null); setAdsetSearchText(''); setAdsetSearchResults([]); }} 
                                          className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 text-[10px] font-bold py-1.5 px-4 rounded-lg"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                                      {/* Col 1: Name and Budget */}
                                      <div className="space-y-3">
                                        <div>
                                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Ad Set Name</label>
                                          <input 
                                            type="text" 
                                            value={editingNode.name} 
                                            onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })} 
                                            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500/20"
                                          />
                                        </div>

                                        {adset.budgetType !== 'none' && (
                                          <div>
                                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Daily Budget ({currency === 'INR' ? '₹' : '$'})</label>
                                            <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-2 rounded-xl">
                                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Budget:</span>
                                              <input 
                                                type="number" 
                                                value={editingNode.budget || 0} 
                                                onChange={(e) => setEditingNode({ ...editingNode, budget: parseFloat(e.target.value) || 0 })} 
                                                className="bg-transparent border-0 outline-none text-xs font-bold w-full"
                                              />
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* Col 2: Locations Targeting */}
                                      <div className="space-y-3">
                                        <div>
                                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Target Locations</label>
                                          {/* Render list of active editing locations */}
                                          <div className="flex flex-wrap gap-1.5 mb-2 max-h-24 overflow-y-auto custom-scrollbar p-1 bg-white border border-slate-100 rounded-xl">
              {(editingNode.targeting?.locations || []).length === 0 ? (
                                              <span className="text-[10px] text-slate-400 italic p-1">No custom locations (Meta defaults)</span>
                                            ) : (
                                              editingNode.targeting?.locations.map((loc: any, idx: number) => (
                                                <div key={idx} className="bg-blue-50/50 py-1 px-2.5 rounded-lg border border-blue-150 flex items-center flex-wrap gap-1 text-[10px]">
                                                  <span className="font-bold text-blue-900 truncate max-w-[100px]">{loc.name}</span>
                                                  {loc.type === 'city' && (
                                                     <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-0.5 ml-1">
                                                       <span className="text-[9px] text-slate-400 font-bold">Radius:</span>
                                                       <input 
                                                         type="number" 
                                                         min={17} 
                                                         max={80} 
                                                         value={loc.radius || 20} 
                                                         onChange={(e) => {
                                                            const val = Math.min(80, Math.max(17, parseInt(e.target.value) || 17));
                                                            const updatedLocations = (editingNode?.targeting?.locations || []).map((item: any, i: number) => i === idx ? { ...item, radius: val } : item);
                                                            setEditingNode({
                                                              ...editingNode,
                                                              targeting: {
                                                                ...(editingNode?.targeting || {}),
                                                                locations: updatedLocations
                                                              }
                                                            });
                                                          }}
                                                         className="w-8 text-center font-extrabold text-[10px] text-blue-600 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                       />
                                                       <span className="text-[8px] text-slate-500 font-bold">km</span>
                                                     </div>
                                                   )}
                                                  <button 
                                                    onClick={() => setEditingNode({
                                                      ...editingNode,
                                                      targeting: {
                                                        locations: (editingNode.targeting?.locations || []).filter((_, i) => i !== idx)
                                                      }
                                                    })}
                                                    className="hover:text-red-500 text-slate-400 p-0.5"
                                                  >
                                                    <X size={10} />
                                                  </button>
                                                </div>
                                              ))
                                            )}
                                          </div>

                                          {/* Search Locations box inside editingNode */}
                                          <div className="relative">
                                            <input 
                                              type="text" 
                                              value={adsetSearchText}
                                              onChange={(e) => setAdsetSearchText(e.target.value)}
                                              className="w-full bg-white hover:bg-slate-50 py-2 pl-8 pr-8 rounded-xl text-xs outline-none border border-slate-200 transition-all" 
                                              placeholder="Search city to target..." 
                                            />
                                            <MapPin size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            {isSearchingAdsetLocation && <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />}
                                            
                                            {adsetSearchResults.length > 0 && (
                                              <div className="absolute z-[1010] w-full bg-white mt-1 rounded-xl shadow-xl border border-slate-100 max-h-40 overflow-y-auto custom-scrollbar">
                                                {adsetSearchResults.map(loc => (
                                                  <div 
                                                    key={loc.key} 
                                                    onClick={() => { 
                                                      let currentList = editingNode.targeting?.locations || [];
                                                      if (loc.key === '1021145') {
                                                        currentList = currentList.filter(l => l.key !== '1726');
                                                      } else if (loc.key === '1726') {
                                                        currentList = currentList.filter(l => l.key !== '1021145');
                                                      }
                                                      if (!currentList.some(l => l.key === loc.key)) {
                                                        setEditingNode({
                                                          ...editingNode,
                                                          targeting: {
                                                            locations: [...currentList, { key: loc.key, name: loc.name, type: loc.type, radius: 20, country_code: loc.country_code }]
                                                          }
                                                        });
                                                      }
                                                      setAdsetSearchText(''); 
                                                      setAdsetSearchResults([]); 
                                                    }} 
                                                    className="p-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 text-left"
                                                  >
                                                    <div className="text-xs font-bold text-slate-800">{loc.name}</div>
                                                    <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider mt-0.5">{loc.region ? `${loc.region}, ` : ''}{loc.country_code} ({loc.type})</div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h5 
                                      onClick={() => {
                                        setExpandedAdSets(prev => 
                                          isExpanded ? prev.filter(id => id !== adset.id) : [...prev, adset.id]
                                        );
                                      }}
                                      className="text-sm font-bold text-slate-800 cursor-pointer hover:text-blue-600 transition-colors flex items-center gap-1.5"
                                    >
                                      {adset.name}
                                      <span className="text-[10px] text-slate-400 font-bold transition-transform duration-200">
                                        {isExpanded ? '▲' : '▼'}
                                      </span>
                                    </h5>
                                    <button 
                                      onClick={() => {
                                        const parsedLocations: any[] = [];
                                        const geo = adset.targeting?.geo_locations;
                                        if (geo) {
                                          if (geo.cities) {
                                            geo.cities.forEach((c: any) => {
                                              parsedLocations.push({
                                                key: c.key,
                                                name: c.name || `City (Key: ${c.key})`,
                                                type: 'city',
                                                radius: c.radius || 20
                                              });
                                            });
                                          }
                                          if (geo.regions) {
                                            geo.regions.forEach((r: any) => {
                                              parsedLocations.push({
                                                key: r.key,
                                                name: r.name || `Region (Key: ${r.key})`,
                                                type: 'region'
                                              });
                                            });
                                          }
                                          if (geo.countries) {
                                            geo.countries.forEach((code: string) => {
                                              parsedLocations.push({
                                                key: code,
                                                name: code === 'IN' ? 'India' : code,
                                                type: 'country',
                                                country_code: code
                                              });
                                            });
                                          }
                                          if (geo.zips) {
                                            geo.zips.forEach((z: any) => {
                                              parsedLocations.push({
                                                key: z.key,
                                                name: `ZIP Code ${z.key}`,
                                                type: 'zip'
                                              });
                                            });
                                          }
                                        }
                                        
                                        setEditingNode({ 
                                          id: adset.id, 
                                          type: 'adset', 
                                          name: adset.name, 
                                          budget: adset.budget, 
                                          budgetType: adset.budgetType,
                                          targeting: { locations: parsedLocations }
                                        });
                                      }} 
                                      className="text-slate-400 hover:text-blue-600 p-0.5"
                                    >
                                      <Settings2 size={12} />
                                    </button>
                                  </div>
                                )}
                                <div className="flex items-center gap-3 mt-1.5">
                                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Ad Set ID: {adset.id}</span>
                                  <span className="text-[9px] text-slate-300">•</span>
                                  <span className="text-[9px] text-purple-600 font-bold uppercase tracking-wider">{adset.optimization_goal} ({adset.billing_event})</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-4 flex-wrap">
                                {/* Budget */}
                                {adset.budgetType !== 'none' && (
                                  <div className="text-right">
                                    <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Adset Budget</div>
                                    <div className="text-xs font-black text-slate-700">
                                      {currency === 'INR' ? '₹' : '$'}{adset.budget} / day
                                    </div>
                                  </div>
                                )}

                                {/* Status */}
                                <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-xl border border-slate-100 shadow-inner">
                                  <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded ${adset.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {adset.status}
                                  </span>
                                  <button 
                                    onClick={() => handleToggleNodeStatus(adset.id, adset.status, 'adset')}
                                    className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${adset.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-200'}`}
                                  >
                                    <div className={`w-4 h-4 bg-white rounded-full shadow transform transition-transform duration-200 ${adset.status === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0'}`} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Adset Metrics */}
                            <div className="grid grid-cols-4 gap-2 bg-slate-50/50 p-3.5 rounded-[1.5rem] border border-slate-100 text-center">
                              <div><div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Spend</div><div className="text-xs font-bold text-slate-700">{currency === 'INR' ? '₹' : '$'}{adset.metrics.spend.toFixed(1)}</div></div>
                              <div><div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Clicks</div><div className="text-xs font-bold text-slate-700">{adset.metrics.clicks} <span className="text-[8px] text-slate-400">({adset.metrics.ctr.toFixed(1)}%)</span></div></div>
                              {(() => {
                                const isWA = (explorerData.campaign as any)?.objective === 'WHATSAPP' || (explorerData.campaign as any)?.objective === 'OUTCOME_ENGAGEMENT' || (explorerData.campaign as any)?.campaign_type === 'whatsapp_chat' || (explorerData.campaign as any)?.destination_type === 'WHATSAPP';
                                return (
                                  <>
                                    <div><div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{isWA ? 'Conversations' : 'Leads'}</div><div className="text-xs font-bold text-blue-600">{adset.metrics.leads}</div></div>
                                    <div><div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{isWA ? 'Cost / Conv.' : 'CPL'}</div><div className="text-xs font-bold text-slate-700">{adset.metrics.leads > 0 ? `${currency === 'INR' ? '₹' : '$'}${adset.metrics.cpl.toFixed(1)}` : '—'}</div></div>
                                  </>
                                );
                              })()}
                            </div>

                            {/* Expandable Ads Section */}
                            {isExpanded && (
                              <div className="pt-2 pl-2 sm:pl-4 border-l-2 border-slate-100 space-y-3 animate-in slide-in-from-top-2 duration-300">
                                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Ads under this set ({adset.ads.length})</div>
                                
                                {adset.ads.length === 0 ? (
                                  <div className="text-center py-4 text-xs text-slate-400 bg-slate-50/30 rounded-xl border border-dashed border-slate-200">
                                    No ads found in this set.
                                  </div>
                                ) : (
                                  adset.ads.map((ad: any) => (
                                    <div key={ad.id} className="bg-slate-50/30 border border-slate-200/40 rounded-2xl p-4 hover:bg-slate-50 transition-colors">
                                      {editingNode && editingNode.id === ad.id ? (
                                        <div className="w-full space-y-4 py-2">
                                          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                                            <h6 className="text-xs font-black text-slate-800">Edit Ad Creative</h6>
                                            <div className="flex gap-2">
                                              <button 
                                                onClick={handleSaveNodeEdit} 
                                                disabled={isSavingEdit}
                                                className="bg-green-600 hover:bg-green-700 text-white font-bold text-[10px] py-1.5 px-4 rounded-lg flex items-center gap-1 shadow-sm disabled:opacity-50"
                                              >
                                                {isSavingEdit ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save Changes
                                              </button>
                                              <button 
                                                onClick={() => setEditingNode(null)} 
                                                className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 text-[10px] font-bold py-1.5 px-4 rounded-lg"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>

                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            {/* Column 1: Copy/Details */}
                                            <div className="md:col-span-2 space-y-3">
                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Ad Name</label>
                                                <input 
                                                  type="text" 
                                                  value={editingNode.name} 
                                                  onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })} 
                                                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500/20"
                                                />
                                              </div>

                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Headline</label>
                                                <input 
                                                  type="text" 
                                                  value={editingNode.creative?.headline || ''} 
                                                  onChange={(e) => setEditingNode({ 
                                                    ...editingNode, 
                                                    creative: { ...(editingNode.creative || {}), headline: e.target.value } 
                                                  })} 
                                                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500/20"
                                                  placeholder="E.g. Call to Action headline"
                                                />
                                              </div>

                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Primary Text (Ad Copy)</label>
                                                <textarea 
                                                  value={editingNode.creative?.primaryText || ''} 
                                                  onChange={(e) => setEditingNode({ 
                                                    ...editingNode, 
                                                    creative: { ...(editingNode.creative || {}), primaryText: e.target.value } 
                                                  })} 
                                                  rows={3}
                                                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                                                  placeholder="Write compelling ad copy here..."
                                                />
                                              </div>

                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Description (Optional)</label>
                                                <input 
                                                  type="text" 
                                                  value={editingNode.creative?.description || ''} 
                                                  onChange={(e) => setEditingNode({ 
                                                    ...editingNode, 
                                                    creative: { ...(editingNode.creative || {}), description: e.target.value } 
                                                  })} 
                                                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500/20"
                                                  placeholder="E.g. Subtle additional context"
                                                />
                                              </div>

                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1 flex items-center gap-1"><Link2 size={10} /> Website Link / Landing Page URL</label>
                                                <input 
                                                  type="url" 
                                                  value={editingNode.creative?.linkUrl || ''} 
                                                  onChange={(e) => setEditingNode({ 
                                                    ...editingNode, 
                                                    creative: { ...(editingNode.creative || {}), linkUrl: e.target.value } 
                                                  })} 
                                                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500/20"
                                                  placeholder="https://example.com/landing-page"
                                                />
                                                {editingNode.creative?.linkUrl && (
                                                  <a 
                                                    href={editingNode.creative.linkUrl} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold mt-1 inline-flex items-center gap-0.5"
                                                  >
                                                    <ExternalLink size={8} /> Open in new tab
                                                  </a>
                                                )}
                                              </div>

                                              {/* Meta Lead Form selection and creation */}
                                              <div className="border-t border-slate-100 pt-3 mt-3 space-y-3">
                                                <div className="flex items-center justify-between">
                                                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block flex items-center gap-1">
                                                    <Sparkles size={10} className="text-blue-500" /> Meta Lead Form
                                                  </label>
                                                  <button
                                                    type="button"
                                                    onClick={() => setIsCreatingNewAdForm(!isCreatingNewAdForm)}
                                                    className="text-[10px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-0.5"
                                                  >
                                                    {isCreatingNewAdForm ? 'Cancel New Form' : '+ Create Lead Form'}
                                                  </button>
                                                </div>

                                                {!isCreatingNewAdForm ? (
                                                  <div>
                                                    <select
                                                      value={editingNode.creative?.leadFormId || ''}
                                                      onChange={(e) => {
                                                        setExpandedQuestionIndices({});
                                                        setEditingNode({
                                                          ...editingNode,
                                                          creative: {
                                                            ...(editingNode.creative || {}),
                                                            leadFormId: e.target.value
                                                          }
                                                        });
                                                      }}
                                                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
                                                    >
                                                      <option value="">None (Use Website Link / Landing Page URL instead)</option>
                                                      {metaLeadForms.map((form: any) => (
                                                        <option key={form.id} value={form.id}>
                                                          {form.name} (ID: {form.id})
                                                        </option>
                                                      ))}
                                                    </select>
                                                    
                                                    {/* Questions preview block */}
                                                    {editingNode.creative?.leadFormId && (() => {
                                                      const selectedForm = metaLeadForms.find((f: any) => f.id === editingNode.creative?.leadFormId);
                                                      if (!selectedForm) return null;
                                                      
                                                      const getFriendlyLabel = (q: any) => {
                                                        if (q.label) return q.label;
                                                        switch (q.type) {
                                                          case 'FULL_NAME': return 'Full Name';
                                                          case 'EMAIL': return 'Email Address';
                                                          case 'PHONE': return 'Phone Number';
                                                          case 'CITY': return 'City';
                                                          case 'STATE': return 'State';
                                                          case 'COUNTRY': return 'Country';
                                                          case 'ZIP': return 'ZIP Code';
                                                          case 'COMPANY_NAME': return 'Company Name';
                                                          case 'JOB_TITLE': return 'Job Title';
                                                          default: return q.type || q.key || 'Question';
                                                        }
                                                      };

                                                      const questions = selectedForm.questions || [];
                                                      return (
                                                        <div className="mt-2 bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2 text-[11px]">
                                                          <div className="font-black text-slate-400 uppercase tracking-widest text-[8px] flex items-center gap-1">
                                                            <Eye size={10} className="text-blue-500" /> Lead Form Questions
                                                          </div>
                                                          {questions.length === 0 ? (
                                                            <div className="text-slate-400 italic">No questions found in this form.</div>
                                                          ) : (
                                                            <div className="flex flex-col gap-1.5">
                                                               {questions.map((q: any, idx: number) => {
                                                                 const isExpanded = !!expandedQuestionIndices[idx];
                                                                 const hasOptions = q.options && q.options.length > 0;
                                                                 return (
                                                                   <div key={idx} className="bg-white border border-slate-150 rounded-xl p-2.5 shadow-sm space-y-2">
                                                                     <div className="flex items-center justify-between gap-2">
                                                                       <span className="font-semibold text-slate-700 truncate max-w-[200px]" title={getFriendlyLabel(q)}>
                                                                         {getFriendlyLabel(q)}
                                                                       </span>
                                                                       <div className="flex items-center gap-1 shrink-0">
                                                                         <span className="text-[7px] bg-slate-100 text-slate-500 font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                                                                           {q.type === 'CUSTOM' ? (hasOptions ? 'MCQ' : 'Short') : 'Auto-fill'}
                                                                         </span>
                                                                         {hasOptions && (
                                                                           <button
                                                                             type="button"
                                                                             onClick={() => setExpandedQuestionIndices(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                                                             className={`bg-slate-50 hover:bg-blue-50 border rounded p-1 transition-colors ${isExpanded ? 'border-blue-200 text-blue-600 bg-blue-50/50' : 'border-slate-200 text-slate-400 hover:text-blue-500'}`}
                                                                             title={isExpanded ? "Hide Options" : "View Options"}
                                                                           >
                                                                             <Eye size={10} />
                                                                           </button>
                                                                         )}
                                                                       </div>
                                                                     </div>
                                                                     {isExpanded && hasOptions && (
                                                                       <div className="pt-2 border-t border-slate-100 pl-1 space-y-1.5">
                                                                         <div className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest block">MCQ Options</div>
                                                                         <div className="flex flex-wrap gap-1">
                                                                           {q.options.map((opt: any, oIdx: number) => {
                                                                             const optionVal = typeof opt === 'object' ? opt.value : opt;
                                                                             return (
                                                                               <span key={oIdx} className="text-[9px] bg-slate-50 text-slate-650 font-bold border border-slate-200 rounded px-1.5 py-0.5">
                                                                                 {optionVal}
                                                                               </span>
                                                                             );
                                                                           })}
                                                                         </div>
                                                                       </div>
                                                                     )}
                                                                   </div>
                                                                 );
                                                               })}
                                                             </div>
                                                          )}
                                                        </div>
                                                      );
                                                    })()}

                                                    <p className="text-[9px] text-slate-400 font-medium mt-1.5">
                                                      Select a Meta instant form for this ad creative. Creating a new form or changing it will update the Meta Ad Creative.
                                                    </p>
                                                  </div>
                                                ) : (
                                                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-3.5 text-xs text-slate-700">
                                                    <h6 className="font-extrabold text-[11px] text-slate-800 uppercase tracking-wide flex items-center gap-1 border-b border-slate-200 pb-1.5">
                                                      New Meta Lead Form Creator
                                                    </h6>
                                                    
                                                    {/* Form Name */}
                                                    <div className="space-y-1">
                                                      <label className="text-[9px] font-bold text-slate-500 uppercase">Form Name</label>
                                                      <input
                                                        type="text"
                                                        value={newAdFormName}
                                                        onChange={(e) => setNewAdFormName(e.target.value)}
                                                        placeholder="e.g. Realty Nation New Leads Form"
                                                        className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium w-full outline-none focus:ring-1 focus:ring-blue-500"
                                                      />
                                                    </div>

                                                    {/* Custom Questions List */}
                                                    <div className="space-y-2">
                                                      <label className="text-[9px] font-bold text-slate-500 uppercase block font-semibold">Custom Questions (Optional)</label>
                                                      
                                                      {adFormQuestions.length > 0 && (
                                                        <div className="space-y-1.5 max-h-40 overflow-y-auto mb-2 pr-1">
                                                          {adFormQuestions.map((q: any, qIdx: number) => (
                                                            <div key={qIdx} className="bg-white border border-slate-100 rounded-lg p-2 flex justify-between items-center shadow-sm">
                                                              <div>
                                                                <div className="text-[10px] font-bold text-slate-800">{q.label}</div>
                                                                <div className="flex gap-1.5 mt-0.5">
                                                                  <span className="text-[7.5px] bg-blue-50 text-blue-600 font-extrabold px-1.5 py-0.5 rounded-full uppercase">
                                                                    {q.type === 'MULTIPLE_CHOICE' ? 'Multiple Choice' : 'Short Answer'}
                                                                  </span>
                                                                  {q.type === 'MULTIPLE_CHOICE' && q.options?.map((o: string, oIdx: number) => (
                                                                    <span key={oIdx} className="text-[7.5px] bg-slate-50 text-slate-500 font-medium px-1.5 py-0.5 rounded-full">
                                                                      {o}
                                                                    </span>
                                                                  ))}
                                                                </div>
                                                              </div>
                                                              <button
                                                                type="button"
                                                                onClick={() => setAdFormQuestions((prev: any[]) => prev.filter((_, i: number) => i !== qIdx))}
                                                                className="text-slate-450 hover:text-red-500 p-1"
                                                              >
                                                                <X size={12} />
                                                              </button>
                                                            </div>
                                                          ))}
                                                        </div>
                                                      )}

                                                      {/* Add Question Button / Sub-form */}
                                                      {!isAddingAdQuestion ? (
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            setNewAdQuestion({ label: '', type: 'SHORT_ANSWER', options: [''] });
                                                            setIsAddingAdQuestion(true);
                                                          }}
                                                          className="w-full py-1.5 border border-dashed border-slate-350 hover:border-blue-500 hover:text-blue-600 text-slate-500 text-[10px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1 bg-white"
                                                        >
                                                          <PlusCircle size={11} /> Add Custom Question
                                                        </button>
                                                      ) : (
                                                        <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-2.5">
                                                          <div className="space-y-1">
                                                            <label className="text-[8px] font-black text-slate-400 uppercase">Question Text</label>
                                                            <input
                                                              type="text"
                                                              value={newAdQuestion.label}
                                                              onChange={(e) => setNewAdQuestion({ ...newAdQuestion, label: e.target.value })}
                                                              placeholder="e.g. When are you looking to buy?"
                                                              className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-[11px] font-medium w-full outline-none focus:bg-white focus:ring-1 focus:ring-blue-500"
                                                            />
                                                          </div>

                                                          <div className="space-y-1">
                                                            <label className="text-[8px] font-black text-slate-400 uppercase">Question Type</label>
                                                            <select
                                                              value={newAdQuestion.type}
                                                              onChange={(e) => setNewAdQuestion({ ...newAdQuestion, type: e.target.value as any, options: e.target.value === 'MULTIPLE_CHOICE' ? [''] : undefined })}
                                                              className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-[11px] font-medium w-full outline-none cursor-pointer focus:bg-white focus:ring-1 focus:ring-blue-500"
                                                            >
                                                              <option value="SHORT_ANSWER">Short Answer (Text)</option>
                                                              <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                                                            </select>
                                                          </div>

                                                          {newAdQuestion.type === 'MULTIPLE_CHOICE' && (
                                                            <div className="space-y-1.5 pl-1.5 border-l-2 border-slate-100">
                                                              <label className="text-[8px] font-black text-slate-400 uppercase block">Options</label>
                                                              {newAdQuestion.options.map((opt: string, oIdx: number) => (
                                                                <div key={oIdx} className="flex gap-1 items-center">
                                                                  <input
                                                                    type="text"
                                                                    value={opt}
                                                                    onChange={(e) => {
                                                                      const updated = [...newAdQuestion.options];
                                                                      updated[oIdx] = e.target.value;
                                                                      setNewAdQuestion({ ...newAdQuestion, options: updated });
                                                                    }}
                                                                    placeholder={`Option ${oIdx + 1}`}
                                                                    className="flex-1 bg-slate-50 border border-slate-250 rounded px-2 py-0.5 text-[10px] font-medium outline-none focus:bg-white focus:ring-1 focus:ring-blue-500"
                                                                  />
                                                                  <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                      const updated = newAdQuestion.options.filter((_: any, i: number) => i !== oIdx);
                                                                      setNewAdQuestion({ ...newAdQuestion, options: updated });
                                                                    }}
                                                                    className="text-slate-450 hover:text-red-500"
                                                                  >
                                                                    <X size={10} />
                                                                  </button>
                                                                </div>
                                                              ))}
                                                              <button
                                                                type="button"
                                                                onClick={() => setNewAdQuestion({ ...newAdQuestion, options: [...newAdQuestion.options, ''] })}
                                                                className="text-[9px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-0.5"
                                                              >
                                                                + Add Option
                                                              </button>
                                                            </div>
                                                          )}

                                                          <div className="flex gap-2 justify-end pt-1">
                                                            <button
                                                              type="button"
                                                              onClick={() => setIsAddingAdQuestion(false)}
                                                              className="border border-slate-200 hover:bg-slate-50 px-2.5 py-1 rounded text-[9px] font-bold text-slate-600"
                                                            >
                                                              Cancel
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => {
                                                                if (newAdQuestion.label.trim()) {
                                                                  setAdFormQuestions(prev => [...prev, newAdQuestion]);
                                                                  setIsAddingAdQuestion(false);
                                                                }
                                                              }}
                                                              className="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded text-[9px] font-bold"
                                                            >
                                                              Add Question
                                                            </button>
                                                          </div>
                                                        </div>
                                                      )}
                                                    </div>

                                                    {/* Submit Form on Meta button */}
                                                    <button
                                                      type="button"
                                                      disabled={isCreatingFormOnMeta}
                                                      onClick={async () => {
                                                        if (!newAdFormName.trim()) {
                                                          toast.error('Please enter a Form Name');
                                                          return;
                                                        }
                                                        setIsCreatingFormOnMeta(true);
                                                        try {
                                                          const pId = editingNode.creative?.pageId || adForm.pageId;
                                                          if (!pId) {
                                                            throw new Error("No Facebook Page connected or selected to host the lead form.");
                                                          }
                                                          const urlParams = new URLSearchParams(window.location.search);
                                                          const impersonateId = urlParams.get('impersonate');
                                                          const res = await fetch(`/api/facebook/forms${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                              pageId: pId,
                                                              name: newAdFormName.trim(),
                                                              customQuestions: adFormQuestions,
                                                              linkUrl: editingNode.creative?.linkUrl || 'https://adrolls.in'
                                                            })
                                                          });
                                                          const data = await res.json();
                                                          if (!res.ok) throw new Error(data.error || 'Failed to create form on Meta');
                                                          
                                                          toast.success('Lead Form created successfully on Meta!');
                                                          
                                                          // Append to forms dropdown list
                                                          const createdForm = { id: data.id, name: newAdFormName.trim() };
                                                          setMetaLeadForms((prev: any[]) => [...prev, createdForm]);
                                                          
                                                          // Automatically select it in the editingNode
                                                          setEditingNode({
                                                            ...editingNode,
                                                            creative: {
                                                              ...(editingNode.creative || {}),
                                                              leadFormId: data.id
                                                            }
                                                          });
                                                          
                                                          // Reset states
                                                          setNewAdFormName('');
                                                          setAdFormQuestions([]);
                                                          setIsCreatingNewAdForm(false);
                                                        } catch (err: any) {
                                                          toast.error(err.message);
                                                        } finally {
                                                          setIsCreatingFormOnMeta(false);
                                                        }
                                                      }}
                                                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded-lg text-[10px] uppercase tracking-wide flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                                                    >
                                                      {isCreatingFormOnMeta ? (
                                                        <>
                                                          <Loader2 size={11} className="animate-spin" /> Creating Form on Meta...
                                                        </>
                                                      ) : (
                                                        'Create & Select Form on Meta'
                                                      )}
                                                    </button>
                                                  </div>
                                                )}
                                              </div>
                                            </div>

                                            {/* Column 2: Creative Image */}
                                            <div className="flex flex-col items-center justify-center bg-slate-50 border border-slate-200/60 rounded-2xl p-4 space-y-3">
                                              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Creative Preview</div>
                                              <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-slate-200 shadow-inner bg-white flex items-center justify-center">
                                                {editingNode.creative?.imageUrl ? (
                                                  (ad.creative?.isVideo || /\.(mp4|webm|mov|ogg|m4v|3gp)/i.test((editingNode.creative.imageUrl || '').split('?')[0])) ? (
                                                    <video src={`${fixR2Url(editingNode.creative.imageUrl)}#t=0.1`} preload="metadata" className="w-full h-full object-cover" muted playsInline autoPlay loop />
                                                  ) : (
                                                    <img src={fixR2Url(editingNode.creative.imageUrl)} className="w-full h-full object-cover" />
                                                  )
                                                ) : (
                                                  <span className="text-[10px] text-slate-400 text-center px-1">No Image Selected</span>
                                                )}
                                              </div>
                                              <div className="flex gap-2 flex-wrap justify-center">
                                                <button 
                                                  type="button"
                                                  onClick={() => {
                                                    setExplorerAssetSelectorTarget(ad.id);
                                                    setShowAssetSelector({ isOpen: true, type: 'library' });
                                                  }}
                                                  className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold text-[10px] py-1.5 px-3 rounded-lg border border-blue-100 transition-colors flex items-center gap-1"
                                                >
                                                      <ImageIcon size={10} /> Change Image
                                                </button>
                                                {editingNode.creative?.imageUrl && (
                                                  <button 
                                                    type="button"
                                                    onClick={() => {
                                                      const hasVidSource = !!editingNode.creative!.videoSourceUrl;
                                                      const url = editingNode.creative!.videoSourceUrl || editingNode.creative!.imageUrl || '';
                                                      setPreviewImage({ isOpen: true, url, title: editingNode.name, type: hasVidSource ? 'video' : 'image' });
                                                    }}
                                                    className="bg-slate-150 hover:bg-slate-200 text-slate-700 font-bold text-[10px] py-1.5 px-3 rounded-lg border border-slate-200 transition-colors flex items-center gap-1"
                                                  >
                                                    <Maximize2 size={10} /> Large Preview
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                          {/* Ad Thumbnail Preview */}
                                          {ad.creative?.imageUrl && (
                                            <div 
                                              className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 shadow-inner bg-white shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-500/30 transition-all"
                                              onClick={() => {
                                                const url = ad.creative?.videoSourceUrl || ad.creative.imageUrl;
                                                const type = ad.creative?.videoSourceUrl ? 'video' : 'image';
                                                setPreviewImage({ isOpen: true, url, title: ad.name, type });
                                              }}
                                            >
                                              {ad.creative?.isVideo && ad.creative?.videoSourceUrl ? (
                                                <div className="relative w-full h-full">
                                                  <LazyVideo 
                                                      src={ad.creative.videoSourceUrl} 
                                                      poster={ad.creative.imageUrl ? fixR2Url(ad.creative.imageUrl) : undefined} 
                                                      className="w-full h-full object-cover" 
                                                  />
                                                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                    <PlayCircle size={16} className="text-white drop-shadow-md" />
                                                  </div>
                                                </div>
                                              ) : (
                                                <div className="relative w-full h-full">
                                                  <img src={fixR2Url(ad.creative.imageUrl)} className="w-full h-full object-cover" />
                                                  {ad.creative?.isVideo && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/15">
                                                      <PlayCircle size={16} className="text-white drop-shadow-md" />
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-bold text-slate-700">{ad.name}</span>
                                              <button 
                                                onClick={() => setEditingNode({ 
                                                  id: ad.id, 
                                                  type: 'ad', 
                                                  name: ad.name,
                                                  creative: {
                                                    id: ad.creative?.id || '',
                                                    imageHash: ad.creative?.imageHash || '',
                                                    imageUrl: ad.creative?.imageUrl || '',
                                                    isVideo: ad.creative?.isVideo || false,
                                                    videoSourceUrl: ad.creative?.videoSourceUrl || '',
                                                    primaryText: ad.creative?.primaryText || '',
                                                    headline: ad.creative?.headline || '',
                                                    description: ad.creative?.description || '',
                                                    linkUrl: ad.creative?.linkUrl || '',
                                                    leadFormId: ad.creative?.leadFormId || '',
                                                    pageId: ad.creative?.pageId || ''
                                                  }
                                                })} 
                                                className="text-slate-400 hover:text-blue-600 p-0.5"
                                              >
                                                <Settings2 size={10} />
                                              </button>
                                            </div>
                                            <div className="text-[8px] text-slate-400 font-bold uppercase tracking-wider mt-1">Ad ID: {ad.id}</div>
                                            {/* Inline Link Display & Quick Edit */}
                                            {ad.creative?.linkUrl && inlineLinkEdit?.adId !== ad.id && (
                                              <div className="flex items-center gap-1.5 mt-1.5">
                                                <Link2 size={9} className="text-slate-400 shrink-0" />
                                                <a 
                                                  href={ad.creative.linkUrl} 
                                                  target="_blank" 
                                                  rel="noopener noreferrer" 
                                                  className="text-[9px] text-blue-500 hover:text-blue-700 font-medium truncate max-w-[280px]" 
                                                  title={ad.creative.linkUrl}
                                                >
                                                  {ad.creative.linkUrl}
                                                </a>
                                                <button
                                                  onClick={() => setInlineLinkEdit({ adId: ad.id, url: ad.creative.linkUrl, saving: false })}
                                                  className="text-slate-400 hover:text-blue-600 p-0.5 shrink-0"
                                                  title="Edit website link"
                                                >
                                                  <Pencil size={9} />
                                                </button>
                                              </div>
                                            )}
                                            {!ad.creative?.linkUrl && inlineLinkEdit?.adId !== ad.id && (
                                              <button
                                                onClick={() => setInlineLinkEdit({ adId: ad.id, url: '', saving: false })}
                                                className="text-[9px] text-blue-500 hover:text-blue-700 font-medium mt-1.5 inline-flex items-center gap-1"
                                              >
                                                <Link2 size={9} /> Add website link
                                              </button>
                                            )}
                                            {/* Inline Link Editor */}
                                            {(() => {
                                              const editState = inlineLinkEdit;
                                              if (!editState || editState.adId !== ad.id) return null;
                                              return (
                                                <div className="flex items-center gap-1.5 mt-1.5">
                                                  <Link2 size={9} className="text-blue-500 shrink-0" />
                                                  <input
                                                    type="url"
                                                    value={editState.url}
                                                    onChange={(e) => setInlineLinkEdit({ ...editState, url: e.target.value })}
                                                    className="bg-white border border-blue-300 rounded-lg px-2 py-1 text-[10px] font-semibold flex-1 outline-none focus:ring-2 focus:ring-blue-500/20 min-w-0"
                                                    placeholder="https://example.com/landing-page"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Escape') setInlineLinkEdit(null);
                                                    }}
                                                  />
                                                  <button
                                                    disabled={editState.saving}
                                                    onClick={async () => {
                                                      setInlineLinkEdit({ ...editState, saving: true });
                                                      const urlParams = new URLSearchParams(window.location.search);
                                                      const impersonateId = urlParams.get('impersonate');
                                                      try {
                                                        const res = await fetch(`/api/meta-ads/update-campaign-node${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                                          method: 'POST',
                                                          headers: { 'Content-Type': 'application/json' },
                                                          body: JSON.stringify({
                                                            nodeId: ad.id,
                                                            type: 'ad',
                                                            fields: {
                                                              creative: {
                                                                id: ad.creative?.id || '',
                                                                imageHash: ad.creative?.imageHash || '',
                                                                imageUrl: ad.creative?.imageUrl || '',
                                                                primaryText: ad.creative?.primaryText || '',
                                                                headline: ad.creative?.headline || '',
                                                                description: ad.creative?.description || '',
                                                                linkUrl: editState.url,
                                                                leadFormId: ad.creative?.leadFormId || '',
                                                                pageId: ad.creative?.pageId || ''
                                                              }
                                                            }
                                                          })
                                                        });
                                                        const data = await res.json();
                                                        if (!res.ok) throw new Error(data.error);
                                                        toast.success('Website link updated!');
                                                        // Update explorer data locally
                                                        setExplorerData((prev: any) => {
                                                          if (!prev) return prev;
                                                          const updatedAdsets = prev.adsets.map((as: any) => ({
                                                            ...as,
                                                            ads: as.ads.map((a: any) => a.id === ad.id ? {
                                                              ...a,
                                                              creative: { ...a.creative, linkUrl: editState.url }
                                                            } : a)
                                                          }));
                                                          return { ...prev, adsets: updatedAdsets };
                                                        });
                                                        setInlineLinkEdit(null);
                                                      } catch (e: any) {
                                                        toast.error('Failed: ' + e.message);
                                                        setInlineLinkEdit({ ...editState, saving: false });
                                                      }
                                                    }}
                                                    className="bg-green-600 hover:bg-green-700 text-white font-bold text-[9px] py-1 px-2.5 rounded-lg flex items-center gap-0.5 disabled:opacity-50 shrink-0"
                                                  >
                                                    {editState.saving ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />} Save
                                                  </button>
                                                  <button
                                                    onClick={() => setInlineLinkEdit(null)}
                                                    className="text-slate-400 hover:text-slate-600 p-0.5 shrink-0"
                                                  >
                                                    <X size={10} />
                                                  </button>
                                                </div>
                                              );
                                            })()}
                                          </div>

                                          <div className="flex items-center gap-4 flex-wrap">
                                            {/* Ad metrics */}
                                            <div className="flex items-center gap-3 bg-white px-2.5 py-1 rounded-xl border border-slate-150 text-[9px] font-semibold text-slate-500">
                                              <span>Spend: {currency === 'INR' ? '₹' : '$'}{ad.metrics.spend.toFixed(0)}</span>
                                              <span className="text-slate-200">|</span>
                                              {(() => {
                                                const isWA = (explorerData.campaign as any)?.objective === 'WHATSAPP' || (explorerData.campaign as any)?.objective === 'OUTCOME_ENGAGEMENT' || (explorerData.campaign as any)?.campaign_type === 'whatsapp_chat' || (explorerData.campaign as any)?.destination_type === 'WHATSAPP';
                                                return <span>{isWA ? 'Conversations' : 'Leads'}: <b className="text-blue-600">{ad.metrics.leads}</b></span>;
                                              })()}
                                            </div>

                                            {/* Status */}
                                            <div className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded-lg border border-slate-150 shadow-sm">
                                              <span className={`text-[8px] uppercase font-black px-1 rounded ${ad.status === 'ACTIVE' ? 'bg-green-50 text-green-600' : 'bg-slate-150 text-slate-500'}`}>
                                                {ad.status}
                                              </span>
                                              <button 
                                                onClick={() => handleToggleNodeStatus(ad.id, ad.status, 'ad')}
                                                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors duration-205 ease-in-out ${ad.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-200'}`}
                                              >
                                                <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transform transition-transform duration-200 ${ad.status === 'ACTIVE' ? 'translate-x-3.5' : 'translate-x-0'}`} />
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-sm text-slate-400">Failed to load campaign structure.</div>
            )}

            <div className="pt-4 border-t border-slate-100 shrink-0 flex justify-end relative z-10">
              <button 
                onClick={() => { setActiveExplorerCampaign(null); setExplorerData(null); }} 
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-3.5 px-8 rounded-2xl shadow-md shadow-green-600/20 transition-all text-xs flex items-center gap-1.5"
              >
                <CheckCircle size={14} /> Submit Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {statsModal.isOpen && statsModal.campaign && (
          <div className="fixed inset-0 z-[999] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-4xl rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">
                  {/* Header */}
                  <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4 flex-shrink-0">
                      <div>
                          <div className="flex items-center gap-2">
                              <h2 className="text-xl font-bold text-slate-900 leading-tight pr-4 truncate max-w-[400px]">{statsModal.campaign.name}</h2>
                              <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ${statsModal.campaign.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{statsModal.campaign.status}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">Campaign ID: {statsModal.campaign.id}</p>
                      </div>
                      <button onClick={() => setStatsModal({ isOpen: false, campaign: null, insights: null, loading: false })} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                  </div>

                  {/* Date range filter bar */}
                  <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200/60 mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
                      <div className="flex flex-wrap gap-2">
                          {[
                              { label: 'All Time', value: 'maximum' },
                              { label: 'Today', value: 'today' },
                              { label: 'Yesterday', value: 'yesterday' },
                              { label: 'Last 7 Days', value: 'last_7d' },
                              { label: 'Last 30 Days', value: 'last_30d' },
                              { label: 'This Month', value: 'this_month' },
                              { label: 'Custom', value: 'custom' }
                          ].map(item => (
                              <button
                                  key={item.value}
                                  onClick={() => {
                                      setStatsDatePreset(item.value);
                                      if (item.value !== 'custom') {
                                          fetchStats(statsModal.campaign!, item.value, '', '');
                                      }
                                  }}
                                  className={`text-xs font-bold px-4 py-2 rounded-xl transition-all ${statsDatePreset === item.value ? 'bg-slate-900 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                              >
                                  {item.label}
                              </button>
                          ))}
                      </div>

                      {statsDatePreset === 'custom' && (
                          <div className="flex items-center gap-2 flex-wrap">
                              <input
                                  type="date"
                                  value={statsSince}
                                  onChange={(e) => setStatsSince(e.target.value)}
                                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500/20"
                              />
                              <span className="text-xs font-bold text-slate-400">to</span>
                              <input
                                  type="date"
                                  value={statsUntil}
                                  onChange={(e) => setStatsUntil(e.target.value)}
                                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500/20"
                              />
                              <button
                                  onClick={() => {
                                      if (!statsSince || !statsUntil) {
                                          toast.error("Please select start and end dates");
                                          return;
                                      }
                                      fetchStats(statsModal.campaign!, 'custom', statsSince, statsUntil);
                                  }}
                                  className="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-blue-700 transition-all shadow-md active:scale-95"
                              >
                                  Apply
                              </button>
                          </div>
                      )}
                  </div>

                  {statsModal.loading ? (
                      <div className="flex flex-col items-center justify-center py-20 flex-1">
                          <Loader2 className="animate-spin text-blue-500 mb-3" size={32} />
                          <p className="text-sm text-slate-500 font-medium">Fetching Meta Insights...</p>
                      </div>
                  ) : statsModal.insights ? (
                      <div className="space-y-8 flex-1">
                          {/* Tabs */}
                          <div className="flex border-b border-slate-100">
                              {[
                                  { id: 'overview', label: 'Overview & Trend' },
                                  { id: 'daily', label: 'Daily Log' },
                                  { id: 'creatives', label: 'Creative Performance' }
                              ].map(tab => (
                                  <button
                                      key={tab.id}
                                      onClick={() => setStatsTab(tab.id as any)}
                                      className={`text-sm font-bold px-6 py-3 border-b-2 transition-all ${statsTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                                  >
                                      {tab.label}
                                  </button>
                              ))}
                          </div>

                          {/* Tab Content */}
                          {statsTab === 'overview' && (
                              <div className="space-y-8">
                                  {/* Metric Cards Grid */}
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                      {/* Spend */}
                                      <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><CreditCard size={14}/> Spend</div>
                                          <div className="text-2xl font-black text-slate-800">{currency === 'INR' ? '₹' : '$'}{(statsModal.insights.summary?.spend || 0).toFixed(2)}</div>
                                      </div>

                                      {/* Views / Impressions */}
                                      <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><Eye size={14}/> Views (Impressions)</div>
                                          <div className="text-2xl font-black text-slate-800">{statsModal.insights.summary?.impressions?.toLocaleString() || '0'}</div>
                                      </div>

                                      {/* Clicks */}
                                      <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><MousePointerClick size={14}/> Clicks</div>
                                          <div className="text-2xl font-black text-slate-800">{statsModal.insights.summary?.clicks?.toLocaleString() || '0'}</div>
                                      </div>

                                      {/* Results (Leads / WhatsApp Conversations) */}
                                      {(() => {
                                          const camp = statsModal.campaign as any;
                                          const isWAStats = camp?.objective === 'WHATSAPP' || camp?.objective === 'OUTCOME_ENGAGEMENT' || camp?.campaign_type === 'whatsapp_chat' || camp?.destination_type === 'WHATSAPP';
                                          return (
                                              <div className="bg-blue-50 p-5 rounded-[1.5rem] border border-blue-100 shadow-sm hover:border-blue-200 transition-colors">
                                                  <div className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><Users size={14}/> {isWAStats ? 'WhatsApp Conversations' : 'Results (Leads)'}</div>
                                                  <div className="text-2xl font-black text-blue-700">{statsModal.insights.summary?.leads?.toLocaleString() || '0'}</div>
                                                  {statsModal.insights.summary?.leads > 0 && (
                                                      <div className="text-[9px] font-black text-blue-500/80 mt-1 uppercase tracking-wider">
                                                          {isWAStats ? 'Cost / Conv.: ' : 'CPL: '}{currency === 'INR' ? '₹' : '$'}{(statsModal.insights.summary.spend / statsModal.insights.summary.leads).toFixed(1)}
                                                      </div>
                                                  )}
                                              </div>
                                          );
                                      })()}

                                      {/* CTR */}
                                      <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-6 6m0 0l-3-3m3 3V9a9 9 0 1118 0v6" /></svg>
                                              Link CTR
                                          </div>
                                          <div className="text-2xl font-black text-slate-800">{(statsModal.insights.summary?.inlineLinkClickCtr || statsModal.insights.summary?.ctr || 0).toFixed(2)}%</div>
                                      </div>

                                      {/* CPC */}
                                      <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.529C10.518 16.15 11.22 16.5 12 16.5c1.657 0 3-1.343 3-3 0-1.657-1.343-3-3-3m-3-2.818A4 4 0 1112 3v3m0 0c-.82 0-1.522.35-2.121.782" /></svg>
                                              CPC
                                          </div>
                                          <div className="text-2xl font-black text-slate-800">{currency === 'INR' ? '₹' : '$'}{(statsModal.insights.summary?.cpc || 0).toFixed(2)}</div>
                                      </div>

                                      {/* CPM */}
                                      <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                              CPM
                                          </div>
                                          <div className="text-2xl font-black text-slate-800">{currency === 'INR' ? '₹' : '$'}{(statsModal.insights.summary?.cpm || 0).toFixed(2)}</div>
                                      </div>

                                      {/* Landing Page Views */}
                                      <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.905 0-5.64-.78-8.006-2.14M19.843 7.582A8.997 8.997 0 0112 12a8.997 8.997 0 01-7.843-4.418" /></svg>
                                              Landing Page Views
                                          </div>
                                          <div className="text-2xl font-black text-slate-800">{statsModal.insights.summary?.landingPageViews?.toLocaleString() || '0'}</div>
                                      </div>
                                  </div>

                                  {/* Trend Visualization Chart */}
                                  {renderSVGChart(statsModal.insights.dailyBreakdown)}
                              </div>
                          )}

                          {statsTab === 'daily' && (
                              <div className="bg-white rounded-3xl border border-slate-200/60 overflow-hidden shadow-sm">
                                  <div className="overflow-x-auto">
                                      <table className="w-full text-left border-collapse">
                                          <thead>
                                              <tr className="bg-slate-50 border-b border-slate-100 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                                  <th className="p-4 pl-6">Date</th>
                                                  <th className="p-4">Spend</th>
                                                  <th className="p-4">Impressions</th>
                                                  <th className="p-4">Clicks</th>
                                                  <th className="p-4">CTR</th>
                                                  <th className="p-4">CPM</th>
                                                  <th className="p-4">Leads</th>
                                                  <th className="p-4 pr-6">Page Views</th>
                                              </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                                              {statsModal.insights.dailyBreakdown?.length > 0 ? (
                                                  statsModal.insights.dailyBreakdown.map((day: any, idx: number) => (
                                                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                                          <td className="p-4 pl-6 font-bold">{new Date(day.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                                          <td className="p-4 text-slate-900">{currency === 'INR' ? '₹' : '$'}{day.spend.toFixed(2)}</td>
                                                          <td className="p-4 text-slate-600">{day.impressions.toLocaleString()}</td>
                                                          <td className="p-4 text-slate-600">{day.clicks.toLocaleString()}</td>
                                                          <td className="p-4">{(day.inlineLinkClickCtr || day.ctr || 0).toFixed(2)}%</td>
                                                          <td className="p-4">{currency === 'INR' ? '₹' : '$'}{day.cpm.toFixed(2)}</td>
                                                          <td className="p-4 text-blue-600 font-bold">{day.leads.toLocaleString()}</td>
                                                          <td className="p-4 pr-6 text-slate-600">{day.landingPageViews.toLocaleString()}</td>
                                                      </tr>
                                                  ))
                                              ) : (
                                                  <tr>
                                                      <td colSpan={8} className="p-10 text-center text-slate-400 font-bold">No daily logs available.</td>
                                                  </tr>
                                              )}
                                          </tbody>
                                      </table>
                                  </div>
                              </div>
                          )}

                          {statsTab === 'creatives' && (
                              <div className="space-y-6">
                                  <div className="bg-white rounded-3xl border border-slate-200/60 overflow-hidden shadow-sm">
                                      <div className="overflow-x-auto">
                                          <table className="w-full text-left border-collapse">
                                              <thead>
                                                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                                      <th className="p-4 pl-6">Creative</th>
                                                      <th className="p-4">Ad Name</th>
                                                      <th className="p-4">Spend</th>
                                                      <th className="p-4">Clicks</th>
                                                      <th className="p-4">CTR</th>
                                                      <th className="p-4">CPM</th>
                                                      <th className="p-4">Leads</th>
                                                      <th className="p-4 pr-6">Cost Per Lead</th>
                                                  </tr>
                                              </thead>
                                              <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                                                  {statsModal.insights.creativeInsights?.length > 0 ? (
                                                      statsModal.insights.creativeInsights.map((ad: any, idx: number) => (
                                                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                                              <td className="p-4 pl-6">
                                                                  <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 shadow-inner">
                                                                      {ad.thumbnail ? (
                                                                          ad.thumbnail.includes('.mp4') || ad.thumbnail.includes('.mov') ? (
                                                                              <div className="relative w-full h-full">
                                                                                  <LazyVideo 
                                                                                      src={ad.thumbnail} 
                                                                                      className="w-full h-full object-cover" 
                                                                                  />
                                                                                  <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                                                                                      <PlayCircle size={14} className="text-white" />
                                                                                  </div>
                                                                              </div>
                                                                          ) : (
                                                                              <img src={ad.thumbnail} className="w-full h-full object-cover" />
                                                                          )
                                                                      ) : (
                                                                          <ImageIcon size={16} className="text-slate-400" />
                                                                      )}
                                                                  </div>
                                                              </td>
                                                              <td className="p-4 font-bold max-w-[200px] truncate" title={ad.adName}>{ad.adName}</td>
                                                              <td className="p-4 text-slate-900">{currency === 'INR' ? '₹' : '$'}{ad.spend.toFixed(2)}</td>
                                                              <td className="p-4 text-slate-600">{ad.clicks.toLocaleString()}</td>
                                                              <td className="p-4">{(ad.inlineLinkClickCtr || ad.ctr || 0).toFixed(2)}%</td>
                                                              <td className="p-4">{currency === 'INR' ? '₹' : '$'}{ad.cpm.toFixed(2)}</td>
                                                              <td className="p-4 text-blue-600 font-bold">{ad.leads.toLocaleString()}</td>
                                                              <td className="p-4 pr-6 text-slate-900 font-bold">
                                                                  {ad.leads > 0 ? (
                                                                      <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg border border-blue-100">
                                                                          {currency === 'INR' ? '₹' : '$'}{(ad.spend / ad.leads).toFixed(1)}
                                                                      </span>
                                                                  ) : (
                                                                      <span className="text-slate-400">-</span>
                                                                  )}
                                                              </td>
                                                          </tr>
                                                      ))
                                                  ) : (
                                                      <tr>
                                                          <td colSpan={8} className="p-10 text-center text-slate-400 font-bold">No creative metrics available yet.</td>
                                                      </tr>
                                                  )}
                                              </tbody>
                                          </table>
                                      </div>
                                  </div>
                              </div>
                          )}
                      </div>
                  ) : (
                      <div className="py-20 text-center text-sm font-medium text-slate-500 bg-slate-50 rounded-[2rem] border border-dashed border-slate-200">No performance data available for this range.</div>
                  )}
              </div>
          </div>
      )}

      {/* Campaign AI Analysis Modal */}
      {analysisModal.isOpen && analysisModal.campaign && (
          <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="bg-white w-full max-w-4xl rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-hidden flex flex-col relative">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-indigo-100/50 to-transparent rounded-bl-full opacity-50 pointer-events-none" />
                  
                  {/* Header */}
                  <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4 shrink-0 relative z-10">
                      <div>
                          <div className="flex items-center gap-2">
                              <h2 className="text-xl font-bold text-slate-900 leading-tight pr-4 truncate max-w-[400px] flex items-center gap-2">
                                  <Sparkles size={20} className="text-indigo-500 animate-pulse" /> Campaign Diagnosis & AI Strategist
                              </h2>
                              <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ${analysisModal.campaign.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{analysisModal.campaign.status}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">{analysisModal.campaign.name}</p>
                      </div>
                      <button onClick={() => setAnalysisModal(prev => ({ ...prev, isOpen: false, campaign: null, history: [], selectedAnalysis: null }))} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                  </div>

                  {/* Body Content */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6 relative z-10">
                      {analysisModal.loadingHistory ? (
                          <div className="flex flex-col items-center justify-center py-20">
                              <Loader2 className="animate-spin text-indigo-500 mb-3" size={32} />
                              <p className="text-sm text-slate-500 font-medium animate-pulse">Loading diagnostics history...</p>
                          </div>
                      ) : (
                          <div className="space-y-6">
                              {/* History Selector and Live Run Button */}
                              <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200/60 flex flex-col md:flex-row gap-4 items-center justify-between">
                                  <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Select Analysis Date:</span>
                                      {analysisModal.history.length > 0 ? (
                                          <select
                                              value={analysisModal.selectedAnalysis?.id || ''}
                                              onChange={(e) => {
                                                  const selected = analysisModal.history.find(h => h.id === e.target.value);
                                                  setAnalysisModal(prev => ({ ...prev, selectedAnalysis: selected || null }));
                                              }}
                                              className="bg-white border border-slate-200 text-slate-700 text-xs font-bold py-2 px-3 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm"
                                          >
                                              {analysisModal.history.map((h: any) => (
                                                  <option key={h.id} value={h.id}>
                                                      {new Date(h.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                                                  </option>
                                              ))}
                                          </select>
                                      ) : (
                                          <span className="text-xs font-bold text-slate-400 italic">No analysis logs yet.</span>
                                      )}
                                  </div>

                                  <button
                                      onClick={handleRunLiveAnalysis}
                                      disabled={analysisModal.generating}
                                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 px-6 rounded-2xl flex items-center gap-1.5 shadow-md shadow-indigo-600/10 active:scale-95 disabled:opacity-50 transition-all"
                                  >
                                      {analysisModal.generating ? (
                                          <>
                                              <Loader2 size={14} className="animate-spin" /> Analyzing Performance...
                                          </>
                                      ) : (
                                          <>
                                              <RefreshCw size={14} /> Run Live AI Diagnostic
                                          </>
                                      )}
                                  </button>
                              </div>

                              {/* Selected Analysis Display */}
                              {analysisModal.generating ? (
                                  <div className="flex flex-col items-center justify-center py-20 bg-indigo-50/20 rounded-[2rem] border border-dashed border-indigo-100">
                                      <Loader2 className="animate-spin text-indigo-600 mb-4" size={40} />
                                      <p className="text-sm font-black text-indigo-950 animate-pulse">Running live Andromeda diagnostic...</p>
                                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5 max-w-[320px] text-center leading-relaxed">Reading Meta Insights, evaluating adset bidding and target city segments, assessing visual creative weighting...</p>
                                  </div>
                              ) : analysisModal.selectedAnalysis ? (
                                  <div className="space-y-6">
                                      {/* Analysis Metric Summary Card */}
                                      <div className="bg-slate-50 border border-slate-200/60 p-5 rounded-[2rem] grid grid-cols-2 md:grid-cols-4 gap-4">
                                          <div className="text-center md:text-left">
                                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Campaign Spend</span>
                                              <p className="text-lg font-black text-slate-800 mt-1">{currency === 'INR' ? '₹' : '$'}{(analysisModal.selectedAnalysis.metrics?.spend || 0).toFixed(2)}</p>
                                          </div>
                                          <div className="text-center md:text-left border-l border-slate-200/60 pl-2">
                                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">CTR (Click-Through)</span>
                                              <p className="text-lg font-black text-slate-800 mt-1">{(analysisModal.selectedAnalysis.metrics?.ctr || 0).toFixed(2)}%</p>
                                          </div>
                                          <div className="text-center md:text-left border-l border-slate-200/60 pl-2">
                                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Leads (Meta / CRM)</span>
                                              <p className="text-lg font-black text-slate-800 mt-1">
                                                  {analysisModal.selectedAnalysis.metrics?.leads || 0} / {analysisModal.selectedAnalysis.metrics?.crmLeads || 0}
                                              </p>
                                          </div>
                                          <div className="text-center md:text-left border-l border-slate-200/60 pl-2">
                                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Cost Per Lead (CPL)</span>
                                              <p className="text-lg font-black text-slate-800 mt-1">{currency === 'INR' ? '₹' : '$'}{(analysisModal.selectedAnalysis.metrics?.cpl || 0).toFixed(2)}</p>
                                          </div>
                                      </div>

                                      {/* Detailed Analysis Text */}
                                      <div className="space-y-2">
                                          <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">Performance Evaluation</h4>
                                          <div className="bg-white border border-slate-200/60 p-6 rounded-[2rem] text-sm text-slate-700 leading-relaxed font-medium">
                                              {analysisModal.selectedAnalysis.analysis_text}
                                          </div>
                                      </div>

                                      {/* Practical Actions */}
                                      <div className="space-y-3">
                                          <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">AI Actionable Steps & Recommendations</h4>
                                          <div className="space-y-3">
                                              {Array.isArray(analysisModal.selectedAnalysis.recommendations) && analysisModal.selectedAnalysis.recommendations.length > 0 ? (
                                                  analysisModal.selectedAnalysis.recommendations.map((rec: any, idx: number) => (
                                                      <div key={idx} className={`p-5 rounded-[1.75rem] border flex items-start gap-4 transition-colors ${rec.priority === 'high' ? 'bg-rose-50/50 border-rose-100 text-rose-950' : rec.priority === 'medium' ? 'bg-amber-50/50 border-amber-100 text-amber-950' : 'bg-slate-50 border-slate-200 text-slate-800'}`}>
                                                          <div className={`p-2 rounded-xl shrink-0 mt-0.5 ${rec.priority === 'high' ? 'bg-rose-100 text-rose-600' : rec.priority === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-slate-200 text-slate-500'}`}>
                                                              <CheckCircle size={16} />
                                                          </div>
                                                          <div>
                                                              <div className="flex items-center gap-2">
                                                                  <h5 className="font-bold text-sm leading-snug">{rec.title}</h5>
                                                                  <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${rec.priority === 'high' ? 'bg-rose-100 text-rose-700' : rec.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                                                                      {rec.priority} Priority
                                                                  </span>
                                                              </div>
                                                              <p className="text-xs mt-1.5 font-medium leading-relaxed opacity-90">{rec.description}</p>
                                                          </div>
                                                      </div>
                                                  ))
                                              ) : (
                                                  <div className="text-center py-6 text-xs text-slate-400 bg-slate-50 border border-slate-200 border-dashed rounded-2xl">
                                                      No specific recommendations found.
                                                  </div>
                                              )}
                                          </div>
                                      </div>
                                  </div>
                              ) : (
                                  <div className="text-center py-16 bg-slate-50 border border-slate-200 border-dashed rounded-[2rem]">
                                      <p className="text-sm text-slate-500 font-bold mb-2">No Campaign Diagnosis logs found.</p>
                                      <p className="text-xs text-slate-400 max-w-[280px] mx-auto leading-relaxed mb-4">Click "Run Live AI Diagnostic" to evaluate this campaign's real-time metrics and targeting.</p>
                                  </div>
                              )}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
      
      {isModalOpen && (
        <div className="fixed inset-0 z-[999] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-2xl rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-6 bg-white border-b border-slate-100 flex-shrink-0">
              <h2 className="text-xl font-bold text-slate-900">
                {remarketSourceCampaign ? 'AI Retargeting Launchpad' : 'AI Launchpad'}
              </h2>
              <button 
                onClick={() => { setIsModalOpen(false); setRemarketSourceCampaign(null); }} 
                className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-8">
              
              {remarketSourceCampaign && (
                <div className="bg-blue-50 border border-blue-100 p-5 rounded-[2rem] flex items-start gap-3">
                  <Sparkles size={20} className="text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold text-blue-900">Retargeting CRM Qualified Leads</h3>
                    <p className="text-[11px] text-blue-700 mt-1 font-medium">
                      This campaign will retarget all leads in your CRM at the Qualified, Appointment Booked, Appointment Done, or Closed stages.
                    </p>
                  </div>
                </div>
              )}

              {/* MANDATORY: Select Products from Inventory (Multi-Product Select support) */}
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 p-5 rounded-[2rem] border border-amber-200/60">
                <label className="text-xs font-bold text-amber-800 uppercase tracking-widest flex items-center gap-2 mb-3"><Zap size={16} className="text-amber-600" /> Select Products for Campaign *</label>
                <p className="text-[11px] text-amber-700 font-medium mb-3">Choose one or more products this campaign is for. Creatives will be mapped to their corresponding product context.</p>
                
                <div className="max-h-48 overflow-y-auto space-y-2 pr-2 scrollbar-thin">
                  {properties.map(p => {
                    const isSelected = selectedProducts.some(sp => sp.id === p.id);
                    return (
                      <div 
                        key={p.id} 
                        onClick={() => {
                          if (isSelected) {
                            const updated = selectedProducts.filter(sp => sp.id !== p.id);
                            setSelectedProducts(updated);
                            // Also update legacy selectedProduct fallback if it matches
                            if (selectedProduct?.id === p.id) {
                              setSelectedProduct(updated[0] || null);
                            }
                          } else {
                            const updated = [...selectedProducts, p];
                            setSelectedProducts(updated);
                            if (!selectedProduct) setSelectedProduct(p);
                          }
                        }}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer bg-white ${isSelected ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-slate-200 hover:border-amber-300'}`}
                      >
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          readOnly
                          className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4 border-slate-300 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-slate-800 truncate">{p.title}</div>
                          {p.price && <div className="text-[10px] text-amber-600 font-bold">{p.price}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selectedProducts.length > 0 && (
                  <div className="mt-3 bg-white border border-amber-100 p-4 rounded-2xl">
                    <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1.5">Selected Products ({selectedProducts.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedProducts.map(p => (
                        <span key={p.id} className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-[10px] font-bold px-2.5 py-1 rounded-full border border-amber-200">
                          {p.title.substring(0, 25)}{p.title.length > 25 ? '...' : ''}
                          <button onClick={(e) => {
                            e.stopPropagation();
                            const updated = selectedProducts.filter(sp => sp.id !== p.id);
                            setSelectedProducts(updated);
                            if (selectedProduct?.id === p.id) {
                              setSelectedProduct(updated[0] || null);
                            }
                          }} className="hover:text-amber-950 font-black">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-50/50 p-5 rounded-[2rem] border border-slate-100">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4"><ImageIcon size={16} /> Mix & Match Creatives</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <button onClick={() => setShowAssetSelector({isOpen: true, type: 'library'})} className="bg-white border border-slate-200 py-3 px-4 rounded-2xl text-sm font-medium hover:bg-blue-50 transition-all">+ Library Assets</button>
                    <button onClick={() => setShowAssetSelector({isOpen: true, type: 'batch'})} className="bg-blue-600 text-white py-3 px-4 rounded-2xl text-sm font-bold shadow-md">Campaign Ready Group</button>
                </div>
                <input type="file" ref={fileInputRef} onChange={handleLocalFiles} accept="image/*,video/*" className="hidden" multiple />
                <button onClick={() => fileInputRef.current?.click()} className="w-full mb-4 py-3.5 border-2 border-dashed border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50 rounded-2xl text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center justify-center gap-2 transition-all"><Upload size={18} /> Upload Custom Files</button>
                <div className="mb-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">AI Copywriting Instructions (Optional)</label>
                    <textarea 
                        value={adForm.customInstructions || ''}
                        onChange={(e) => setAdForm(prev => ({...prev, customInstructions: e.target.value}))}
                        placeholder="E.g. Focus on key property highlights, call to action, professional tone..."
                        rows={2}
                        className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none font-medium text-slate-700"
                    />
                </div>
                {selectedCreatives.length > 0 && (
                  <div className="space-y-3 mt-2 max-h-60 overflow-y-auto pr-1">
                    {selectedCreatives.map((c) => {
                      const isVideo = (c.sourceType === 'local' && c.file && isVideoFile(c.file)) || c.type === 'video';
                      return (
                        <div 
                          key={c.uid} 
                          className="flex items-center gap-3 p-3 rounded-2xl bg-white shadow-sm border border-slate-100/80 hover:border-slate-200/80 transition-all animate-in fade-in duration-200"
                        >
                          <div 
                            className="relative w-14 h-14 rounded-xl bg-slate-50 border border-slate-100 flex-shrink-0 group cursor-pointer overflow-hidden"
                            onClick={() => setPreviewImage({ isOpen: true, url: c.previewUrl, title: c.name, type: isVideo ? 'video' : 'image' })}
                          >
                            {isVideo ? (
                              <LazyVideo 
                                  src={fixR2Url(c.previewUrl)} 
                                  poster={c.thumbnailUrl ? fixR2Url(c.thumbnailUrl) : undefined} 
                                  className="w-full h-full object-cover" 
                              />
                            ) : (
                              <img src={fixR2Url(c.previewUrl)} className="w-full h-full object-cover" />
                            )}
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Maximize2 size={12} className="text-white"/>
                            </div>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-bold text-slate-800 truncate">{c.name}</div>
                            <div className="text-[9px] text-slate-400 capitalize">{c.sourceType} {c.type || 'creative'}</div>
                            
                            {properties.length > 0 && (
                              <div className="mt-1">
                                <select
                                  value={c.mappedProductId || ''}
                                  onChange={(e) => {
                                    const prodId = e.target.value;
                                    setSelectedCreatives(prev => prev.map(item => item.uid === c.uid ? { ...item, mappedProductId: prodId } : item));
                                  }}
                                  className="w-full max-w-[220px] bg-slate-50 border border-slate-200 text-slate-700 py-1.5 px-2 rounded-xl text-[10px] font-bold outline-none cursor-pointer hover:bg-slate-100 transition-all"
                                >
                                  <option value="">-- Map to Product --</option>
                                  {properties.map(p => (
                                    <option key={p.id} value={p.id}>{p.title}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          <button 
                            onClick={(e) => { e.stopPropagation(); removeCreative(c.uid); }} 
                            className="bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full p-2 border border-slate-100 transition-all"
                          >
                            <X size={14}/>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4 border-b border-slate-100 pb-2">Campaign Settings</label>
                  <div className="space-y-4">
                      <div>
                          <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Campaign Destination Type</label>
                          <div className="flex bg-slate-100 p-1 rounded-2xl">
                              <button 
                                  type="button"
                                  onClick={() => setCampaignType('instant_form')}
                                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${campaignType === 'instant_form' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                              >
                                  Instant Form
                              </button>
                              <button 
                                  type="button"
                                  onClick={() => setCampaignType('website_conversion')}
                                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${campaignType === 'website_conversion' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                              >
                                  Website
                              </button>
                              <button 
                                  type="button"
                                  onClick={() => setCampaignType('whatsapp_chat')}
                                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${campaignType === 'whatsapp_chat' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                              >
                                  WhatsApp Chat
                              </button>
                          </div>
                      </div>

                      {campaignType === 'whatsapp_chat' && (
                          <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100/60 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                              <div>
                                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider font-semibold">Select Connected WhatsApp Number</label>
                                  {availableWhatsAppNumbers.length > 0 ? (
                                      <select 
                                          value={selectedWhatsAppNumber} 
                                          onChange={(e) => setSelectedWhatsAppNumber(e.target.value)}
                                          className="w-full bg-white py-3 px-4 rounded-2xl text-slate-800 text-sm font-semibold outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200 transition-all cursor-pointer"
                                      >
                                          <option value="">-- Select WhatsApp Number --</option>
                                          {availableWhatsAppNumbers.map(num => (
                                              <option key={num} value={num}>{num}</option>
                                          ))}
                                      </select>
                                  ) : (
                                      <div className="text-xs text-rose-600 font-semibold p-2 bg-rose-50 rounded-xl border border-rose-100">
                                          ⚠️ No connected WhatsApp number found. Please connect your WABA in Profile settings.
                                      </div>
                                  )}
                              </div>
                          </div>
                      )}

                      {campaignType === 'instant_form' && (
                          <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100/60 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                              <div>
                                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">After Form Submission, Land Lead On</label>
                                  <div className="flex bg-slate-100 p-1 rounded-2xl">
                                      <button 
                                          type="button"
                                          onClick={() => setLeadLandingType('website')}
                                          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${leadLandingType === 'website' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                      >
                                          Website
                                      </button>
                                      <button 
                                          type="button"
                                          disabled={availableWhatsAppNumbers.length === 0}
                                          onClick={() => setLeadLandingType('whatsapp')}
                                          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${availableWhatsAppNumbers.length === 0 ? 'opacity-50 cursor-not-allowed text-slate-300' : leadLandingType === 'whatsapp' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                      >
                                          WhatsApp {availableWhatsAppNumbers.length === 0 && '(None Connected)'}
                                      </button>
                                  </div>
                              </div>

                              {leadLandingType === 'whatsapp' && availableWhatsAppNumbers.length > 0 && (
                                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider font-semibold">Select Connected WhatsApp Number</label>
                                      <select 
                                          value={selectedWhatsAppNumber} 
                                          onChange={(e) => setSelectedWhatsAppNumber(e.target.value)}
                                          className="w-full bg-white py-3 px-4 rounded-2xl text-slate-800 text-sm font-semibold outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200 transition-all cursor-pointer"
                                      >
                                          {availableWhatsAppNumbers.map(num => (
                                              <option key={num} value={num}>{num}</option>
                                          ))}
                                      </select>
                                  </div>
                              )}
                          </div>
                      )}

                      {campaignType === 'website_conversion' && (
                          <div className="space-y-4">
                              <div>
                                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Select Target Landing Page</label>
                                  <select 
                                      value={selectedLandingPageId} 
                                      onChange={(e) => {
                                          const pageId = e.target.value;
                                          setSelectedLandingPageId(pageId);
                                          const page = landingPages.find(p => p.id === pageId);
                                          if (page) {
                                              const domainBase = customDomain || `app.nobogent.com/shared/${targetUserId}`;
                                              const fullUrl = `https://${domainBase}/${page.slug}`;
                                              setAdForm(prev => ({ ...prev, linkUrl: fullUrl }));
                                              
                                              const form = forms.find(f => f.id === page.form_id);
                                              setAttachedFormName(form ? form.name : 'Default Form (Name, WhatsApp, City)');

                                              // Auto-select the page's pixel if it is configured
                                              if (page.pixel_id) {
                                                  setPixelId(page.pixel_id);
                                              }
                                          } else {
                                              setAdForm(prev => ({ ...prev, linkUrl: '' }));
                                              setAttachedFormName('');
                                          }
                                      }}
                                      className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-slate-800 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer"
                                  >
                                      <option value="">-- Choose a Landing Page --</option>
                                      {landingPages.map(p => (
                                          <option key={p.id} value={p.id}>/{p.slug || p.product_name || p.title}</option>
                                      ))}
                                  </select>
                              </div>
                              {selectedLandingPageId && (() => {
                                  const page = landingPages.find(p => p.id === selectedLandingPageId);
                                  if (!page) return null;
                                  if (page.pixel_id) {
                                      const connectedPixel = pixels.find(px => px.id === page.pixel_id);
                                      return (
                                          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-xs text-emerald-800 font-semibold leading-relaxed">
                                              🎯 Connected Pixel with Page: <strong>{connectedPixel ? connectedPixel.name : 'Custom Pixel'} ({page.pixel_id})</strong>
                                          </div>
                                      );
                                  } else {
                                      return (
                                          <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl text-xs text-slate-600 font-semibold leading-relaxed animate-pulse">
                                              ℹ️ Connected Pixel with Page: Using Profile's Default Pixel
                                          </div>
                                      );
                                  }
                              })()}
                              {attachedFormName && (
                                  <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl text-xs text-blue-800 font-semibold leading-relaxed">
                                      ℹ️ Attached Qualification Form: <strong>{attachedFormName}</strong>
                                  </div>
                              )}
                              <div>
                                  <div className="flex justify-between items-center mb-1.5">
                                      <label className="text-[10px] font-bold text-slate-500 ml-2 uppercase tracking-wider">Select Meta Pixel</label>
                                      {selectedAdAccountId && !isLoadingPixels && (
                                          <button 
                                              type="button"
                                              onClick={handleCreatePixel}
                                              disabled={isCreatingPixel}
                                              className="text-[10px] font-extrabold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none mr-2 uppercase tracking-wider"
                                          >
                                              {isCreatingPixel ? (
                                                  <>
                                                      <Loader2 size={10} className="animate-spin text-blue-500" /> Generating...
                                                  </>
                                              ) : (
                                                  <>
                                                      <PlusCircle size={11} className="text-blue-500" /> Auto-Create Pixel
                                                  </>
                                              )}
                                          </button>
                                      )}
                                  </div>
                                  {isLoadingPixels ? (
                                      <div className="flex items-center gap-2 py-3 px-4 bg-slate-50 rounded-2xl border border-slate-200/60">
                                          <Loader2 size={16} className="animate-spin text-blue-500" />
                                          <span className="text-xs text-slate-500 font-medium">Loading pixels from Meta...</span>
                                      </div>
                                  ) : (
                                      <select 
                                          value={pixelId || ''} 
                                          onChange={(e) => setPixelId(e.target.value || null)}
                                          className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-slate-800 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer"
                                      >
                                          <option value="">-- Choose a Pixel --</option>
                                          {pixels.map(p => (
                                              <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                                          ))}
                                      </select>
                                  )}
                              </div>
                              {!pixelId && (
                                  <div className="bg-red-50 border border-red-100 p-4 rounded-2xl text-xs text-red-800 font-semibold leading-relaxed">
                                      ⚠️ Warning: You do not have a Meta Pixel linked to your account. Launching a Website Conversion campaign requires a Pixel. Please connect a Pixel in your Profile settings first, or switch to an Instant Form campaign.
                                  </div>
                              )}
                          </div>
                      )}

                      <div>
                          <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Website URL</label>
                          <input 
                              type="url" 
                              value={adForm.linkUrl} 
                              onChange={(e) => setAdForm(prev => ({...prev, linkUrl: e.target.value}))} 
                              className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" 
                              placeholder="https://yourwebsite.com" 
                          />
                      </div>

                      <div className="relative">
                          <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Target Locations</label>
                          {adForm.metaLocations.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-3">
                                  {adForm.metaLocations.map((loc, idx) => (
                                      <div key={idx} className="bg-blue-50/50 py-2 px-3 rounded-xl border border-blue-200 flex items-center flex-wrap gap-2">
                                          <div className="text-xs font-bold text-blue-900 flex items-center gap-1">
                                              <MapPin size={12}/> {loc.location.name}
                                          </div>
                                          {loc.location.type === 'city' && (
                                              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-0.5 ml-1">
                                                  <span className="text-[9px] text-slate-400 font-bold">Radius:</span>
                                                  <input 
                                                      type="number" 
                                                      min={17} 
                                                      max={80} 
                                                      value={loc.radius} 
                                                      onChange={(e) => {
                                                          const val = Math.min(80, Math.max(17, parseInt(e.target.value) || 17));
                                                          setAdForm(prev => ({
                                                              ...prev,
                                                              metaLocations: prev.metaLocations.map((item, i) => i === idx ? { ...item, radius: val } : item)
                                                          }));
                                                      }}
                                                      className="w-10 text-center font-bold text-xs text-blue-600 bg-transparent outline-none border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                  />
                                                  <span className="text-[9px] text-slate-400 font-bold">km</span>
                                              </div>
                                          )}
                                          <button 
                                              onClick={() => setAdForm(prev => ({ ...prev, metaLocations: prev.metaLocations.filter((_, i) => i !== idx) }))} 
                                              className="bg-white p-1 rounded-full shadow-sm text-slate-400 hover:text-red-500 transition-colors"
                                          >
                                              <X size={12} />
                                          </button>
                                      </div>
                                  ))}
                              </div>
                          )}
                          <div className="relative">
                            <input type="text" value={locationSearchText} onChange={(e) => setLocationSearchText(e.target.value)} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 pl-11 pr-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" placeholder="Search city..." />
                            <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                            {isSearchingLocation && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />}
                          </div>
                          {locationResults.length > 0 && (<div className="absolute z-20 w-full bg-white mt-2 rounded-2xl shadow-xl border border-slate-100 max-h-56 overflow-y-auto custom-scrollbar">{locationResults.map(loc => (<div key={loc.key} onClick={() => { let currentList = adForm.metaLocations; if (loc.key === '1021145') { currentList = currentList.filter(l => l.location.key !== '1726'); } else if (loc.key === '1726') { currentList = currentList.filter(l => l.location.key !== '1021145'); } if (!currentList.find(l => l.location.key === loc.key)) { setAdForm(prev => ({ ...prev, metaLocations: [...currentList, { location: loc, radius: 20 }] })); } setLocationSearchText(''); setLocationResults([]); }} className="p-4 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 transition-colors"><div className="text-sm font-bold text-slate-800">{loc.name}</div><div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1">{loc.region ? `${loc.region}, ` : ''}{loc.country_code} ({loc.type})</div></div>))}</div>)}
                      </div>

                      {/* Run as Remarketing Campaign Toggle */}
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-2xl border border-blue-100 flex items-center justify-between mt-4">
                          <div>
                            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Users size={16} className="text-blue-500"/> Run as Remarketing Campaign</h3>
                            <p className="text-xs text-slate-600 mt-1 font-medium">Target your existing Meta custom audiences instead of broad geographic targeting.</p>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setRunAsRemarketing(prev => !prev)} 
                            className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 shrink-0 ${runAsRemarketing ? 'bg-blue-500 focus:ring-blue-500' : 'bg-slate-300 focus:ring-slate-400'}`}
                          >
                            <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${runAsRemarketing ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
                      </div>

                      {/* Custom Audience Selection Checklist */}
                      {runAsRemarketing && (
                        <div className="mt-4 bg-slate-50 border border-slate-200/60 rounded-2xl p-5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 font-black">Select Target Custom Audiences</label>
                          {isLoadingCustomAudiences ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500 py-2 font-medium">
                              <Loader2 size={14} className="animate-spin text-blue-500" /> Fetching audiences...
                            </div>
                          ) : customAudiences.length === 0 ? (
                            <div className="text-xs text-slate-500 font-medium py-2">
                              No custom audiences found in this ad account. <a href={`/dashboard/profile/audiences${impersonateId ? `?impersonate=${impersonateId}` : ''}`} className="text-blue-600 hover:underline font-bold" target="_blank" rel="noopener noreferrer">Create or upload one first</a>.
                            </div>
                          ) : (
                            <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                              {customAudiences.map((aud) => {
                                const isChecked = selectedCustomAudienceIds.includes(aud.id);
                                return (
                                  <label key={aud.id} className="flex items-start gap-3 p-3 bg-white border border-slate-100 hover:border-blue-100 rounded-xl cursor-pointer shadow-sm transition-all select-none text-left">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        if (isChecked) {
                                          setSelectedCustomAudienceIds(prev => prev.filter(id => id !== aud.id));
                                        } else {
                                          setSelectedCustomAudienceIds(prev => [...prev, aud.id]);
                                        }
                                      }}
                                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs font-bold text-slate-800 truncate flex items-center justify-between">
                                        <span>{aud.name}</span>
                                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 ml-2">
                                          {aud.subtype}
                                        </span>
                                      </div>
                                      {aud.description && (
                                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{aud.description}</p>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Optimize for High-Quality Leads hidden as requested */}
                    
                      <div className="flex flex-col sm:flex-row gap-4">
                          <div className="flex-1"><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Gender</label><select value={adForm.gender} onChange={(e) => setAdForm(prev => ({...prev, gender: e.target.value}))} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-slate-800 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer">{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                          <div className="flex-1">
                              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Daily Budget ({currency === 'INR' ? '₹' : '$'})</label>
                              <div className="relative">
                                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">{currency === 'INR' ? '₹' : currency === 'AED' ? 'د.إ' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$'}</span>
                                  <input 
                                    type="number" 
                                    min={currency === 'INR' ? 100 : 5} 
                                    step={currency === 'INR' ? 100 : 1} 
                                    value={adForm.dailyBudgetINR} 
                                    onChange={(e) => setAdForm(prev => ({...prev, dailyBudgetINR: parseInt(e.target.value) || 0}))} 
                                    className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 pl-11 pr-4 rounded-2xl text-slate-800 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all" 
                                  />
                              </div>
                          </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-4 mt-4">
                          <div className="flex-1">
                              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Min Age</label>
                              <select 
                                value={adForm.ageMin} 
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  setAdForm(prev => ({
                                    ...prev,
                                    ageMin: val,
                                    ageMax: prev.ageMax < val ? val : prev.ageMax
                                  }))
                                }} 
                                className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-slate-800 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer"
                              >
                                {Array.from({ length: 48 }, (_, i) => 18 + i).map(age => (
                                    <option key={age} value={age}>{age}</option>
                                ))}
                              </select>
                          </div>
                          <div className="flex-1">
                              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Max Age</label>
                              <select 
                                value={adForm.ageMax} 
                                onChange={(e) => setAdForm(prev => ({ ...prev, ageMax: parseInt(e.target.value) }))} 
                                className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-slate-800 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer"
                              >
                                {Array.from({ length: 48 }, (_, i) => 18 + i)
                                  .filter(age => age >= adForm.ageMin)
                                  .map(age => (
                                      <option key={age} value={age}>{age === 65 ? '65+' : age}</option>
                                  ))}
                              </select>
                          </div>
                      </div>
                  </div>
              </div>
 
              {campaignType === 'instant_form' && (
                  <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4 border-b border-slate-100 pb-2"><Settings2 size={16} /> Lead Form Questions</label>
                      {formQuestions.length > 0 && (<div className="flex flex-col gap-3 mb-4">{formQuestions.map((q, idx) => (<div key={idx} className="bg-slate-50 border border-slate-200/60 rounded-[1.25rem] p-4 flex justify-between items-center group shadow-sm"><div><div className="text-sm font-bold text-slate-800 leading-tight mb-1">{q.label}</div><div className="flex flex-wrap gap-1.5 mt-1"><span className="text-[9px] bg-blue-100 text-blue-600 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">{q.type === 'MULTIPLE_CHOICE' ? `Multiple Choice` : 'Short Answer'}</span>{q.type === 'MULTIPLE_CHOICE' && q.options?.map((opt, oIdx) => (<span key={oIdx} className="text-[9px] bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">{opt}</span>))}</div></div><div className="flex gap-2"><button onClick={() => { setEditingIdx(idx); setNewQuestion(q); setIsAddingQuestion(true); }} className="bg-white p-2 rounded-full text-slate-400 hover:text-blue-500 shadow-sm border border-slate-100 transition-colors"><Settings2 size={14}/></button><button onClick={() => setFormQuestions(prev => prev.filter((_, i) => i !== idx))} className="bg-white p-2 rounded-full text-slate-400 hover:text-red-500 shadow-sm border border-slate-100 transition-colors"><X size={14}/></button></div></div>))}</div>)}
                      {(!isAddingQuestion && editingIdx === null) ? (<div className="flex flex-wrap gap-2"><button onClick={() => handleAddPresetQuestion('budget')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Budget</button><button onClick={() => handleAddPresetQuestion('type')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Property Type</button><button onClick={() => handleAddPresetQuestion('timeline')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Timeline</button><button onClick={() => handleAddPresetQuestion('visit')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Visit Time</button><button onClick={() => setIsAddingQuestion(true)} className="text-xs font-bold bg-slate-100 text-slate-600 px-4 py-2.5 rounded-full hover:bg-slate-200 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Custom</button></div>) : (
                          <div className="bg-slate-50/80 p-5 rounded-[1.5rem] border border-slate-200 space-y-4 shadow-inner">
                              <div><input type="text" value={newQuestion.label} onChange={e => setNewQuestion({...newQuestion, label: e.target.value})} className="w-full bg-white py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all" placeholder="Question Text..." /></div>
                              <div><select value={newQuestion.type} onChange={e => setNewQuestion({...newQuestion, type: e.target.value as any})} className="w-full bg-white py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all cursor-pointer"><option value="SHORT_ANSWER">Short Answer (Text)</option><option value="MULTIPLE_CHOICE">Multiple Choice</option></select></div>
                              {newQuestion.type === 'MULTIPLE_CHOICE' && (<div className="space-y-3"><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Configure Options</label>{(newQuestion.options || []).map((opt, oIdx) => (<div key={oIdx} className="flex gap-2 items-center"><input type="text" value={opt} onChange={e => { const updated = [...(newQuestion.options || [])]; updated[oIdx] = e.target.value; setNewQuestion({...newQuestion, options: updated}); }} className="flex-1 bg-white py-3 px-4 rounded-xl text-sm font-medium border border-slate-200 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all" placeholder={`Option ${oIdx + 1}`} /><button onClick={() => { const updated = (newQuestion.options || []).filter((_, i) => i !== oIdx); setNewQuestion({...newQuestion, options: updated}); }} className="p-3 text-slate-400 hover:text-red-500 transition-colors"><X size={16} /></button></div>))}<button onClick={() => setNewQuestion({...newQuestion, options: [...(newQuestion.options || []), '']})} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all flex items-center justify-center gap-2"><PlusCircle size={14} /> Add Another Option</button></div>)}
                              <div className="flex gap-3 pt-2"><button onClick={() => { setIsAddingQuestion(false); setEditingIdx(null); setNewQuestion({label: '', type: 'SHORT_ANSWER', options: ['']}); }} className="bg-white border border-slate-200 text-slate-600 px-6 py-3 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors">Cancel</button><button onClick={() => { if(newQuestion.label){ if (editingIdx !== null) { const updated = [...formQuestions]; updated[editingIdx] = newQuestion; setFormQuestions(updated); } else { setFormQuestions(prev => [...prev, newQuestion]); } setIsAddingQuestion(false); setEditingIdx(null); setNewQuestion({label: '', type: 'SHORT_ANSWER', options: ['']}); } }} className="flex-1 bg-slate-900 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors shadow-sm">{editingIdx !== null ? 'Update Question' : 'Save Question'}</button></div>
                          </div>
                      )}
                  </div>
              )}

            </div>



            <div className="p-6 bg-white border-t border-slate-100 flex-shrink-0">
              <button 
                onClick={handleLaunchCampaign} 
                disabled={
                    isSubmitting || 
                    checkingSanity ||
                    !selectedProduct ||
                    adForm.metaLocations.length === 0 || 
                    selectedCreatives.length === 0 || 
                    !accountStatus ||
                    (accountStatus && !accountStatus.error && (
                        accountStatus.account_status !== 1 || 
                        !accountStatus.has_payment_method || 
                        (campaignType === 'instant_form' && accountStatus.leadgenTos?.leadgen_tos?.accepted !== true)
                    ))
                } 
                className="w-full bg-slate-900 text-white py-4 sm:py-5 rounded-[1.5rem] text-sm sm:text-base font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 shadow-lg shadow-slate-900/20 hover:bg-slate-800"
              >
                {isSubmitting ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Zap size={20} className="text-yellow-400 animate-bounce" />
                )}
                {isSubmitting 
                  ? 'AI Optimizing & Launching...' 
                  : remarketSourceCampaign 
                    ? 'Launch Retargeting Campaign' 
                    : 'Launch Smart Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAssetSelector.isOpen && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl flex flex-col h-[80vh] overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white"><h2 className="text-xl font-bold">Select Assets</h2><button onClick={() => setShowAssetSelector({isOpen: false, type: 'library'})} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200"><X size={20} /></button></div>
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50/50">
                    {showAssetSelector.type === 'library' ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Filter by Product</label>
                                <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} className="bg-white border border-slate-200 text-sm font-medium text-slate-700 py-2 px-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer shadow-sm min-w-[200px]">
                                    <option value="All">All Assets</option>
                                    {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                {assets.filter(a => !['Failed', 'Processing', 'Rendering', 'Distributed'].includes(a.status || '') && (assetFilter === 'All' || a.property_id === assetFilter)).map(a => {
                                    const isSelected = selectedCreatives.some(c => c.id === a.id);
                                    return (
                                        <div key={a.id} onClick={() => {
                                            if (explorerAssetSelectorTarget) {
                                                setEditingNode((prev: any) => {
                                                    if (!prev || prev.id !== explorerAssetSelectorTarget) return prev;
                                                    return {
                                                        ...prev,
                                                        creative: {
                                                            ...(prev.creative || {}),
                                                            imageUrl: a.url,
                                                            imageHash: '', // clear imageHash so backend fetches it from URL
                                                            isVideo: a.type === 'video',
                                                            videoSourceUrl: a.type === 'video' ? a.url : ''
                                                        }
                                                    };
                                                });
                                                setShowAssetSelector({ isOpen: false, type: 'library' });
                                                setExplorerAssetSelectorTarget(null);
                                                return;
                                            }
                                            if (isSelected) removeCreative(selectedCreatives.find(c => c.id === a.id)!.uid); 
                                            else setSelectedCreatives(prev => [...prev, { uid: Math.random().toString(), sourceType: 'asset', id: a.id, previewUrl: a.url, name: 'Library', type: a.type, thumbnailUrl: a.metadata?.thumbnailUrl, mappedProductId: a.property_id || '' }]); 
                                        }} className={`relative aspect-square rounded-[1.5rem] overflow-hidden border-[3px] transition-all cursor-pointer ${isSelected ? 'border-blue-500' : 'border-transparent hover:border-blue-400 hover:shadow-lg bg-slate-100'}`}>
                                            {a.type === 'video' ? (
                                                <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
                                                    <LazyVideo 
                                                        src={fixR2Url(a.url)} 
                                                        poster={a.metadata?.thumbnailUrl ? fixR2Url(a.metadata.thumbnailUrl) : undefined} 
                                                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" 
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                                                        <div className="bg-white/20 backdrop-blur-md p-2.5 rounded-full shadow-sm">
                                                            <Video className="text-white" size={20} />
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <img src={fixR2Url(a.url)} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                                            )}
                                            {isSelected && <div className="absolute top-3 right-3 bg-blue-500 text-white p-1 rounded-full shadow-md"><CheckCircle size={16} /></div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {Array.from(new Set(assets.filter(a => a.master_creative_id && !['Failed', 'Processing', 'Rendering', 'Distributed'].includes(a.status || '')).map(a => a.master_creative_id))).map(batchId => {
                                const batchAssets = assets.filter(a => a.master_creative_id === batchId && !['Failed', 'Processing', 'Rendering', 'Distributed'].includes(a.status || ''));
                                return (
                                    <div key={batchId} className="bg-white p-4 rounded-2xl border border-slate-200">
                                        <h3 className="text-sm font-bold mb-3">Batch: {batchId}</h3>
                                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                            {batchAssets.map(a => {
                                                const isSelected = selectedCreatives.some(c => c.id === a.id);
                                                return (
                                                    <div key={a.id} onClick={() => {
                                                        if (explorerAssetSelectorTarget) {
                                                            setEditingNode((prev: any) => {
                                                                if (!prev || prev.id !== explorerAssetSelectorTarget) return prev;
                                                                return {
                                                                    ...prev,
                                                                    creative: {
                                                                        ...(prev.creative || {}),
                                                                        imageUrl: a.url,
                                                                        imageHash: '',
                                                                        isVideo: a.type === 'video',
                                                                        videoSourceUrl: a.type === 'video' ? a.url : ''
                                                                    }
                                                                };
                                                            });
                                                            setShowAssetSelector({ isOpen: false, type: 'library' });
                                                            setExplorerAssetSelectorTarget(null);
                                                            return;
                                                        }
                                                        if (isSelected) removeCreative(selectedCreatives.find(c => c.id === a.id)!.uid); 
                                                        else setSelectedCreatives(prev => [...prev, { uid: Math.random().toString(), sourceType: 'asset', id: a.id, previewUrl: a.url, name: 'Batch Asset', type: a.type, thumbnailUrl: a.metadata?.thumbnailUrl, mappedProductId: a.property_id || '' }]); 
                                                    }} className={`relative aspect-square rounded-xl overflow-hidden border-[3px] transition-all cursor-pointer ${isSelected ? 'border-blue-500' : 'border-transparent hover:border-blue-400 hover:shadow-lg bg-slate-100'}`}>
                                                        {a.type === 'video' ? (
                                                            <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
                                                                <LazyVideo 
                                                                    src={fixR2Url(a.url)} 
                                                                    poster={a.metadata?.thumbnailUrl ? fixR2Url(a.metadata.thumbnailUrl) : undefined} 
                                                                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" 
                                                                />
                                                                <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                                                                    <div className="bg-white/20 backdrop-blur-md p-1.5 rounded-full shadow-sm">
                                                                        <Video className="text-white" size={14} />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <img src={fixR2Url(a.url)} className="w-full h-full object-cover" />
                                                        )}
                                                        {isSelected && <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full"><CheckCircle size={12} /></div>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="p-4 border-t border-slate-100 flex justify-end bg-white"><button onClick={() => setShowAssetSelector({isOpen: false, type: 'library'})} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-colors shadow-md">Done</button></div>
            </div>
        </div>
      )}

      <ImagePreviewModal 
        isOpen={previewImage.isOpen} 
        onClose={() => setPreviewImage(prev => ({ ...prev, isOpen: false }))} 
        imageUrl={previewImage.url} 
        title={previewImage.title} 
        type={previewImage.type}
      />
    </div>
  )
}
