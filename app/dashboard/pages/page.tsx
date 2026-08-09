'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
    Globe, Plus, Trash2, Edit3, Eye, Copy, Check, MessageSquare, 
    Sparkles, ArrowRight, Loader2, List, Clipboard, ArrowLeft, Send, Paperclip,
    Code, Image as ImageIcon, X, Smartphone, Tablet, Monitor
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { getPropertyDisplayLabel } from '@/utils/property-helper'
import { uploadToR2, compressImage } from '@/utils/upload-helper'



type FormField = {
    name: string
    type: 'text' | 'tel' | 'select'
    label: string
}

type CustomQuestion = {
    label: string
    type: 'SHORT_ANSWER' | 'MULTIPLE_CHOICE'
    options?: string[]
    disqualify_options?: string[]
    disqualify_message?: string
}

type QualificationForm = {
    id: string
    name: string
    fields: FormField[]
    custom_questions: CustomQuestion[]
    created_at: string
}

type LandingPage = {
    id: string
    slug: string
    title: string
    product_name: string
    html_content: string
    form_id: string | null
    booking_enabled?: boolean
    pixel_id?: string | null
    created_at: string
}

export default function PagesDashboard() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const supabase = createClient()
    const impersonateId = searchParams.get('impersonate')

    // Tab state
    const [activeTab, setActiveTab] = useState<'landing_pages' | 'forms' | 'business_landing'>('landing_pages')
    
    // Main Business Landing Page States
    const [businessLandingEnabled, setBusinessLandingEnabled] = useState(false)
    const [businessLandingHeroTitle, setBusinessLandingHeroTitle] = useState('')
    const [businessLandingHeroSubtitle, setBusinessLandingHeroSubtitle] = useState('')
    const [businessLandingShowProducts, setBusinessLandingShowProducts] = useState(true)
    const [savingBusinessLanding, setSavingBusinessLanding] = useState(false)
    
    // Core States
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [successMessage, setSuccessMessage] = useState('')
    const [errorMessage, setErrorMessage] = useState('')
    const [copiedId, setCopiedId] = useState<string | null>(null)

    // Data lists
    const [forms, setForms] = useState<QualificationForm[]>([])
    const [landingPages, setLandingPages] = useState<LandingPage[]>([])
    const [pixels, setPixels] = useState<{ id: string, name: string }[]>([])
    const [isLoadingPixels, setIsLoadingPixels] = useState(false)

    // Impersonation Profile resolver
    const [subAccountName, setSubAccountName] = useState('')
    const [targetUserId, setTargetUserId] = useState('')
    const [customDomain, setCustomDomain] = useState('')

    // Form builder state
    const [showFormModal, setShowFormModal] = useState(false)
    const [formName, setFormName] = useState('')
    const [formFields, setFormFields] = useState<FormField[]>([])
    const [formQuestions, setFormQuestions] = useState<CustomQuestion[]>([])
    const [editingFormId, setEditingFormId] = useState<string | null>(null)
    const [editingQuestionIdx, setEditingQuestionIdx] = useState<number | null>(null)
    const [newQuestionLabel, setNewQuestionLabel] = useState('')
    const [newQuestionType, setNewQuestionType] = useState<'SHORT_ANSWER' | 'MULTIPLE_CHOICE'>('SHORT_ANSWER')
    const [newQuestionOptions, setNewQuestionOptions] = useState('')
    const [newDisqualifyOptions, setNewDisqualifyOptions] = useState('')
    const [newDisqualifyMessage, setNewDisqualifyMessage] = useState('')

    // Page generator state
    const [showPageGenerator, setShowPageGenerator] = useState(false)
    const [pageProductName, setPageProductName] = useState('')
    const [pageContext, setPageContext] = useState('')
    const [selectedFormId, setSelectedFormId] = useState('')
    const [properties, setProperties] = useState<any[]>([])
    const [selectedPropertyId, setSelectedPropertyId] = useState('')
    const [customInstructions, setCustomInstructions] = useState('')
    const [pageType, setPageType] = useState<'standard' | 'survey' | 'raw_survey' | 'business'>('standard')

    // Edit/Chat Console state
    const [activeEditorPage, setActiveEditorPage] = useState<LandingPage | null>(null)
    const [chatInput, setChatInput] = useState('')
    const [chatLogs, setChatLogs] = useState<{ sender: 'user' | 'ai', message: string, images?: string[] }[]>([
        { sender: 'ai', message: "Hi! I am your Landing Page Assistant. Tell me what changes you'd like to make to the generated landing page (e.g. 'Make the buttons larger and glowing', 'change background to premium dark mode')." }
    ])
    const [editorView, setEditorView] = useState<'preview' | 'code'>('preview')
    const [editedHtml, setEditedHtml] = useState('')
    const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
    const [editorMobileTab, setEditorMobileTab] = useState<'chat' | 'preview'>('chat')

    useEffect(() => {
        if (activeEditorPage) {
            setEditedHtml(activeEditorPage.html_content)
        } else {
            setEditorView('preview')
        }
    }, [activeEditorPage?.id, activeEditorPage?.html_content])

    // Listen for visual edits inside the iframe
    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (e.data && e.data.type === 'html-visually-updated') {
                setEditedHtml(e.data.html)
                if (activeEditorPage) {
                    setActiveEditorPage(prev => prev ? { ...prev, html_content: e.data.html } : null)
                }
                showToast("Visual changes captured! Click Save Code to save permanently.", "success")
            }
        }
        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [activeEditorPage])

    // Slug inline editing states
    const [editingSlugPageId, setEditingSlugPageId] = useState<string | null>(null)
    const [tempSlug, setTempSlug] = useState('')

    // Brand Color & Chat files states
    const [brandColor, setBrandColor] = useState('#2563eb')
    const [attachments, setAttachments] = useState<{ id: string; type: 'local' | 'asset'; url: string; file?: File }[]>([])
    const [isUploadingChatFiles, setIsUploadingChatFiles] = useState(false)
    const chatFileInputRef = useRef<HTMLInputElement>(null)

    // Assets Picker States
    const [existingAssets, setExistingAssets] = useState<any[]>([])
    const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false)
    const [loadingAssets, setLoadingAssets] = useState(false)




    const getContrastColor = (hexColor: string): string => {
        if (!hexColor) return '#ffffff';
        let hex = hexColor.trim().replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }
        if (hex.length !== 6) return '#ffffff';
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#0f172a' : '#ffffff';
    };

    const handleChatFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const filesArray = Array.from(e.target.files)
            const newAttachments = filesArray.map(file => ({
                id: crypto.randomUUID(),
                type: 'local' as const,
                url: URL.createObjectURL(file),
                file
            }))
            setAttachments(prev => [...prev, ...newAttachments])
        }
    }

    const handleRemoveAttachment = (id: string) => {
        setAttachments(prev => prev.filter(att => att.id !== id))
    }

    const handleOpenAssetPicker = async () => {
        setIsAssetPickerOpen(true)
        setLoadingAssets(true)
        try {
            const urlParams = new URLSearchParams(window.location.search)
            const impersonateId = urlParams.get('impersonate')
            const response = await fetch(`/api/assets${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
            const assetData = await response.json()
            if (Array.isArray(assetData)) {
                const photoAssets = assetData.filter((a: any) => 
                    a.type === 'image' && 
                    a.url && 
                    !a.url.includes('processing') && 
                    !['Processing', 'Rendering', 'Failed'].includes(a.status)
                )
                setExistingAssets(photoAssets)
            }
        } catch (err) {
            console.error("Failed to load existing assets:", err)
        } finally {
            setLoadingAssets(false)
        }
    }

    const handleToggleAsset = (assetUrl: string) => {
        const exists = attachments.some(a => a.url === assetUrl)
        if (exists) {
            setAttachments(prev => prev.filter(a => a.url !== assetUrl))
        } else {
            setAttachments(prev => [...prev, {
                id: crypto.randomUUID(),
                type: 'asset' as const,
                url: assetUrl
            }])
        }
    }

    // --- 1. SESSION & IMPERSONATION SETUP ---
    useEffect(() => {
        const resolveTargetAccount = async () => {
            setLoading(true)
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.user) {
                router.push('/login')
                return
            }

            // Fetch caller profile
            const { data: caller } = await supabase.from('profiles').select('role, agency_id, parent_id, brand_color, ad_account_id').eq('id', session.user.id).single()
            let resolvedId = session.user.id
            let adAccountId: string | null = null

            // Resolve target client account if impersonating
            if (impersonateId && ['super_admin', 'agency', 'admin'].includes(caller?.role || '')) {
                const { data: clientProfile } = await supabase.from('profiles').select('id, business_name, custom_domain, brand_color, ad_account_id, business_landing_enabled, business_landing_hero_title, business_landing_hero_subtitle, business_landing_show_products').eq('id', impersonateId).single()
                if (clientProfile) {
                    resolvedId = clientProfile.id
                    setSubAccountName(clientProfile.business_name || 'Client')
                    setCustomDomain(clientProfile.custom_domain || '')
                    setBrandColor(clientProfile.brand_color || '#2563eb')
                    adAccountId = clientProfile.ad_account_id
                    setBusinessLandingEnabled(!!clientProfile.business_landing_enabled)
                    setBusinessLandingHeroTitle(clientProfile.business_landing_hero_title || '')
                    setBusinessLandingHeroSubtitle(clientProfile.business_landing_hero_subtitle || '')
                    setBusinessLandingShowProducts(clientProfile.business_landing_show_products !== false)
                }
            } else {
                const { data: ownProfile } = await supabase.from('profiles').select('business_name, custom_domain, brand_color, ad_account_id, business_landing_enabled, business_landing_hero_title, business_landing_hero_subtitle, business_landing_show_products').eq('id', session.user.id).single()
                if (ownProfile) {
                    setCustomDomain(ownProfile.custom_domain || '')
                    setBrandColor(ownProfile.brand_color || '#2563eb')
                    adAccountId = ownProfile.ad_account_id
                    setBusinessLandingEnabled(!!ownProfile.business_landing_enabled)
                    setBusinessLandingHeroTitle(ownProfile.business_landing_hero_title || '')
                    setBusinessLandingHeroSubtitle(ownProfile.business_landing_hero_subtitle || '')
                    setBusinessLandingShowProducts(ownProfile.business_landing_show_products !== false)
                }
            }

            setTargetUserId(resolvedId)

            // Setup Client Caching Load
            const cacheKey_forms = `pages_forms_cache_${resolvedId}`;
            const cacheKey_pages = `pages_landing_pages_cache_${resolvedId}`;
            const cacheKey_props = `pages_properties_cache_${resolvedId}`;
            try {
                const cachedForms = localStorage.getItem(cacheKey_forms);
                const cachedPages = localStorage.getItem(cacheKey_pages);
                const cachedProps = localStorage.getItem(cacheKey_props);
                if (cachedForms) setForms(JSON.parse(cachedForms));
                if (cachedPages) setLandingPages(JSON.parse(cachedPages));
                if (cachedProps) setProperties(JSON.parse(cachedProps));
                if (cachedForms && cachedPages) {
                    setLoading(false);
                }
            } catch (e) {
                console.error("Cache load failed", e);
            }

            await fetchListData(resolvedId)
            if (adAccountId) {
                await fetchPixels(adAccountId)
            }
        };

        resolveTargetAccount();
    }, [impersonateId]);

    // --- 2. LIST DATA LOADING ---
    const fetchListData = async (userId: string) => {
        try {
            // Load custom forms
            const { data: formsData, error: formsErr } = await supabase
                .from('qualification_forms')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
            if (formsErr) throw formsErr
            const finalForms = formsData || []
            setForms(finalForms)
            try { localStorage.setItem(`pages_forms_cache_${userId}`, JSON.stringify(finalForms)); } catch (e) {}

            // Load landing pages
            const { data: pagesData, error: pagesErr } = await supabase
                .from('landing_pages')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
            if (pagesErr) throw pagesErr
            const finalPages = pagesData || []
            setLandingPages(finalPages)
            try { localStorage.setItem(`pages_landing_pages_cache_${userId}`, JSON.stringify(finalPages)); } catch (e) {}

            // Load properties inventory
            const { data: propertiesData, error: propertiesErr } = await supabase
                .from('properties')
                .select('id, title, description, tags, configurations')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
            if (propertiesErr) throw propertiesErr
            const finalProps = propertiesData || []
            setProperties(finalProps)
            try { localStorage.setItem(`pages_properties_cache_${userId}`, JSON.stringify(finalProps)); } catch (e) {}
        } catch (e: any) {
            setErrorMessage("Failed to load dashboard data: " + e.message)
        } finally {
            setLoading(false)
        }
    }

    const fetchPixels = async (adAccountId: string) => {
        setIsLoadingPixels(true)
        try {
            const res = await fetch('/api/facebook/pixels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adAccountId, impersonateId })
            })
            if (!res.ok) {
                throw new Error(`Request failed with status ${res.status}`)
            }
            const contentType = res.headers.get('content-type') || ''
            if (!contentType.includes('application/json')) {
                throw new Error(`Expected JSON response, but got ${contentType}`)
            }
            const data = await res.json()
            if (data.pixels) {
                setPixels(data.pixels)
            } else {
                setPixels([])
            }
        } catch (e) {
            console.error("Error fetching pixels:", e)
            setPixels([])
        } finally {
            setIsLoadingPixels(false)
        }
    }

    const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
        if (type === 'success') {
            setSuccessMessage(msg)
            setTimeout(() => setSuccessMessage(''), 4000)
        } else {
            setErrorMessage(msg)
            setTimeout(() => setErrorMessage(''), 4000)
        }
    }

    const handleSaveBusinessLanding = async () => {
        setSavingBusinessLanding(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.user) throw new Error('Unauthenticated')

            const targetId = impersonateId || session.user.id
            const { error } = await supabase
                .from('profiles')
                .update({
                    business_landing_enabled: businessLandingEnabled,
                    business_landing_hero_title: businessLandingHeroTitle,
                    business_landing_hero_subtitle: businessLandingHeroSubtitle,
                    business_landing_show_products: businessLandingShowProducts
                })
                .eq('id', targetId)

            if (error) throw error
            showToast('Business landing settings saved successfully!', 'success')
        } catch (e: any) {
            showToast('Failed to save settings: ' + e.message, 'error')
        }
        setSavingBusinessLanding(false)
    }



    // --- 3. FORM BUILDER OPERATIONS ---
    const handleAddQuestion = () => {
        if (!newQuestionLabel.trim()) return

        let opts = newQuestionType === 'MULTIPLE_CHOICE' 
            ? newQuestionOptions.split(',').map(o => o.trim()).filter(Boolean) 
            : undefined

        const disq = newQuestionType === 'MULTIPLE_CHOICE'
            ? newDisqualifyOptions.split(',').map(o => o.trim()).filter(Boolean)
            : undefined

        // Automatically merge disqualifying options into options if not already present
        if (opts && disq) {
            const existingSet = new Set(opts.map(o => o.toLowerCase()))
            disq.forEach(dOpt => {
                if (!existingSet.has(dOpt.toLowerCase())) {
                    opts!.push(dOpt)
                }
            })
        }

        const newQ: CustomQuestion = {
            label: newQuestionLabel.trim(),
            type: newQuestionType,
            options: opts,
            disqualify_options: disq,
            disqualify_message: newQuestionType === 'MULTIPLE_CHOICE' && newDisqualifyMessage.trim()
                ? newDisqualifyMessage.trim()
                : undefined
        }

        if (editingQuestionIdx !== null) {
            const updated = [...formQuestions]
            updated[editingQuestionIdx] = newQ
            setFormQuestions(updated)
            setEditingQuestionIdx(null)
        } else {
            setFormQuestions([...formQuestions, newQ])
        }

        setNewQuestionLabel('')
        setNewQuestionType('SHORT_ANSWER')
        setNewQuestionOptions('')
        setNewDisqualifyOptions('')
        setNewDisqualifyMessage('')
    }

    const handleRemoveQuestion = (idx: number) => {
        setFormQuestions(formQuestions.filter((_, i) => i !== idx))
        if (editingQuestionIdx === idx) {
            setEditingQuestionIdx(null)
            setNewQuestionLabel('')
            setNewQuestionType('SHORT_ANSWER')
            setNewQuestionOptions('')
            setNewDisqualifyOptions('')
            setNewDisqualifyMessage('')
        } else if (editingQuestionIdx !== null && editingQuestionIdx > idx) {
            setEditingQuestionIdx(editingQuestionIdx - 1)
        }
    }

    const handleEditQuestionClick = (idx: number) => {
        const q = formQuestions[idx]
        if (!q) return
        setNewQuestionLabel(q.label)
        setNewQuestionType(q.type)
        setNewQuestionOptions(q.options ? q.options.join(', ') : '')
        setNewDisqualifyOptions(q.disqualify_options ? q.disqualify_options.join(', ') : '')
        setNewDisqualifyMessage(q.disqualify_message || '')
        setEditingQuestionIdx(idx)
    }

    const handleCancelQuestionEdit = () => {
        setNewQuestionLabel('')
        setNewQuestionType('SHORT_ANSWER')
        setNewQuestionOptions('')
        setNewDisqualifyOptions('')
        setNewDisqualifyMessage('')
        setEditingQuestionIdx(null)
    }

    const handleEditFormClick = (form: QualificationForm) => {
        setEditingFormId(form.id)
        setFormName(form.name)
        setFormFields(form.fields && form.fields.length > 0 ? form.fields : [
            { name: 'name', type: 'text', label: 'Full Name' },
            { name: 'phone', type: 'tel', label: 'WhatsApp Number' },
            { name: 'city', type: 'text', label: 'City' }
        ])
        setFormQuestions(form.custom_questions || [])
        setEditingQuestionIdx(null)
        setNewQuestionLabel('')
        setNewQuestionType('SHORT_ANSWER')
        setNewQuestionOptions('')
        setNewDisqualifyOptions('')
        setNewDisqualifyMessage('')
        setShowFormModal(true)
    }

    const handleOpenNewFormModal = () => {
        setEditingFormId(null)
        setFormName('')
        setFormFields([
            { name: 'name', type: 'text', label: 'Full Name' },
            { name: 'phone', type: 'tel', label: 'WhatsApp Number' },
            { name: 'city', type: 'text', label: 'City' }
        ])
        setFormQuestions([])
        setEditingQuestionIdx(null)
        setNewQuestionLabel('')
        setNewQuestionType('SHORT_ANSWER')
        setNewQuestionOptions('')
        setNewDisqualifyOptions('')
        setNewDisqualifyMessage('')
        setShowFormModal(true)
    }

    const handleCreateForm = async () => {
        if (!formName.trim()) {
            showToast("Please enter a name for the qualification form.", 'error')
            return
        }

        setActionLoading(true)
        try {
            if (editingFormId) {
                const { error } = await supabase
                    .from('qualification_forms')
                    .update({
                        name: formName.trim(),
                        fields: formFields,
                        custom_questions: formQuestions
                    })
                    .eq('id', editingFormId)

                if (error) throw error
                showToast(`Form "${formName}" updated successfully!`)
            } else {
                const { error } = await supabase
                    .from('qualification_forms')
                    .insert({
                        user_id: targetUserId,
                        name: formName.trim(),
                        fields: formFields,
                        custom_questions: formQuestions
                    })

                if (error) throw error
                showToast(`Form "${formName}" created successfully!`)
            }

            setFormName('')
            setFormQuestions([])
            setFormFields([])
            setEditingFormId(null)
            setEditingQuestionIdx(null)
            setShowFormModal(false)
            await fetchListData(targetUserId)
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

    const handleDeleteForm = async (formId: string) => {
        if (!confirm("Are you sure you want to delete this qualification form? Landing pages relying on it will no longer display the form.")) return
        
        setActionLoading(true)
        try {
            const { error } = await supabase
                .from('qualification_forms')
                .delete()
                .eq('id', formId)
            
            if (error) throw error
            showToast("Qualification form deleted successfully.")
            await fetchListData(targetUserId)
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

    // --- 4. LANDING PAGE GENERATION ---
const handleGenerateLandingPage = async () => {
        if (!pageProductName.trim() && !selectedPropertyId && pageType !== 'business') {
            showToast("Please enter a product name or select a property from your inventory.", 'error')
            return
        }

        setActionLoading(true)
        let startedBgJob = false
        try {
            const endpoint = impersonateId 
                ? `/api/landing-page/generate?impersonate=${impersonateId}` 
                : `/api/landing-page/generate`

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productName: pageProductName.trim(),
                    context: pageContext.trim(),
                    propertyId: selectedPropertyId || null,
                    customInstructions: customInstructions.trim(),
                    formId: selectedFormId || null,
                    mode: 'generate',
                    pageType: pageType
                })
            })

            const contentType = response.headers.get('content-type') || ''
            let resData: any = null
            if (contentType.includes('application/json')) {
                resData = await response.json()
            } else {
                const text = await response.text()
                throw new Error(text || `Request failed with status ${response.status}`)
            }

            if (!response.ok) throw new Error(resData.error || "Generation failed")

            showToast(`Generation started in background...prefix`)
            setPageProductName('')
            setPageContext('')
            setSelectedPropertyId('')
            setCustomInstructions('')
            setSelectedFormId('')
            setPageType('standard')
            setShowPageGenerator(false)
            
            // Auto open the newly generated page in the preview editor with a loading state
            if (resData.page) {
                setActiveEditorPage(resData.page)
                setChatLogs([
                    { sender: 'ai', message: `Building landing page for "${resData.page.product_name}" in the background... This can take up to a minute. Please wait.` }
                ])
            }
            
            if (resData.jobId && resData.page) {
                startedBgJob = true
                startPollingJobStatus(resData.jobId, resData.page.id, false)
            }
            await fetchListData(targetUserId)
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            if (!startedBgJob) {
                setActionLoading(false)
            }
        }
    }

    // Clean placeholder helper text from showToast
    const handleDeletePage = async (pageId: string) => {
        if (!confirm("Are you sure you want to delete this landing page Listing?")) return

        setActionLoading(true)
        try {
            const { error } = await supabase
                .from('landing_pages')
                .delete()
                .eq('id', pageId)
            
            if (error) throw error
            showToast("Landing page deleted.")
            await fetchListData(targetUserId)
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

    const handleUpdatePageForm = async (pageId: string, formId: string | null) => {
        setActionLoading(true)
        try {
            const { error } = await supabase
                .from('landing_pages')
                .update({ form_id: formId })
                .eq('id', pageId)
            
            if (error) throw error
            showToast("Landing page qualification form updated successfully!")
            await fetchListData(targetUserId)
            
            if (activeEditorPage && activeEditorPage.id === pageId) {
                setActiveEditorPage(prev => prev ? { ...prev, form_id: formId } : null)
            }
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

    const handleUpdatePageBooking = async (pageId: string, enabled: boolean) => {
        setActionLoading(true)
        try {
            const { error } = await supabase
                .from('landing_pages')
                .update({ booking_enabled: enabled })
                .eq('id', pageId)
            
            if (error) throw error
            showToast("Landing page booking preferences updated successfully!")
            await fetchListData(targetUserId)
            
            if (activeEditorPage && activeEditorPage.id === pageId) {
                setActiveEditorPage(prev => prev ? { ...prev, booking_enabled: enabled } : null)
            }
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

    const handleUpdatePagePixel = async (pageId: string, pixelId: string | null) => {
        setActionLoading(true)
        try {
            const { error } = await supabase
                .from('landing_pages')
                .update({ pixel_id: pixelId })
                .eq('id', pageId)
            
            if (error) throw error
            showToast("Landing page pixel updated successfully!")
            await fetchListData(targetUserId)
            
            if (activeEditorPage && activeEditorPage.id === pageId) {
                setActiveEditorPage(prev => prev ? { ...prev, pixel_id: pixelId } : null)
            }
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

    const handleUpdateSlug = async (pageId: string, newSlug: string) => {
        const cleanSlug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
        if (!cleanSlug) {
            showToast("Slug cannot be empty.", "error")
            return
        }

        setActionLoading(true)
        try {
            // Check if slug is taken by another landing page of this user
            const { data: existing, error: checkErr } = await supabase
                .from('landing_pages')
                .select('id')
                .eq('user_id', targetUserId)
                .eq('slug', cleanSlug)
                .neq('id', pageId)
                .maybeSingle()

            if (checkErr) throw checkErr
            if (existing) {
                showToast("This slug is already taken by another landing page.", "error")
                return
            }

            const { error: updateErr } = await supabase
                .from('landing_pages')
                .update({ slug: cleanSlug })
                .eq('id', pageId)

            if (updateErr) throw updateErr
            showToast("Slug updated successfully!")
            setEditingSlugPageId(null)
            await fetchListData(targetUserId)

            if (activeEditorPage && activeEditorPage.id === pageId) {
                setActiveEditorPage(prev => prev ? { ...prev, slug: cleanSlug } : null)
            }
        } catch (e: any) {
            showToast("Failed to update slug: " + e.message, "error")
        } finally {
            setActionLoading(false)
        }
    }

    // --- 5. CONVERSATIONAL EDIT CHAT Console ---
    const startPollingJobStatus = (jobId: string, pageId: string, isEditMode: boolean) => {
        const interval = setInterval(async () => {
            try {
                const { data, error } = await supabase
                    .from('campaign_jobs')
                    .select('status, message')
                    .eq('id', jobId)
                    .single()

                if (error) {
                    console.error("Job status check error:", error)
                    clearInterval(interval)
                    setActionLoading(false)
                    showToast("Could not check generation progress.", "error")
                    return
                }

                if (data) {
                    if (data.status === 'completed') {
                        clearInterval(interval)
                        
                        // Fetch latest page details
                        const { data: updatedPage, error: pageErr } = await supabase
                            .from('landing_pages')
                            .select('*')
                            .eq('id', pageId)
                            .single()

                        setActionLoading(false)
                        if (pageErr) {
                            showToast("Failed to load generated page content.", "error")
                        } else if (updatedPage) {
                            setActiveEditorPage(updatedPage)
                            if (isEditMode) {
                                setChatLogs(prev => [...prev, { 
                                    sender: 'ai', 
                                    message: "I have successfully modified the styling and layout according to your request! You can inspect the updated preview now." 
                                }])
                            } else {
                                showToast("Landing page generated successfully!")
                                setChatLogs([
                                    { sender: 'ai', message: `Awesome! Landing page generated with slug "/${updatedPage.slug}". Inspect the live preview on the right side and type any modifications you need in this chat console!` }
                                ])
                            }
                        }
                        await fetchListData(targetUserId)
                    } else if (data.status === 'failed') {
                        clearInterval(interval)
                        setActionLoading(false)
                        showToast(data.message || "Background generation failed.", "error")
                        if (isEditMode) {
                            setChatLogs(prev => [...prev, { 
                                sender: 'ai', 
                                message: `❌ Generation failed: ${data.message || "Unknown error"}` 
                            }])
                        }
                    }
                }
            } catch (err: any) {
                console.error("Error in status polling:", err)
                clearInterval(interval)
                setActionLoading(false)
            }
        }, 3000)
    }

const handleSendChatEdit = async () => {
        if ((!chatInput.trim() && attachments.length === 0) || !activeEditorPage) return
        
        const userMsg = chatInput.trim()
        setChatInput('')
        const localAttachments = attachments.filter(a => a.type === 'local')
        const assetAttachments = attachments.filter(a => a.type === 'asset')
        const previewsToSend = attachments.map(a => a.url)
        setAttachments([])

        setChatLogs(prev => [...prev, { sender: 'user', message: userMsg || "Sent attachment(s)", images: previewsToSend }])
        setActionLoading(true)
        let startedBgJob = false

        try {
            let uploadedUrls: string[] = []
            if (localAttachments.length > 0) {
                setIsUploadingChatFiles(true)
                try {
                    const uploadPromises = localAttachments.map(async (att) => {
                        const compressedFile = await compressImage(att.file!)
                        const publicUrl = await uploadToR2(compressedFile, 'chat-attachments')
                        return publicUrl
                    })
                    uploadedUrls = await Promise.all(uploadPromises)
                } catch (err: any) {
                    showToast("Failed to upload attached images: " + err.message, "error")
                    setIsUploadingChatFiles(false)
                    setActionLoading(false)
                    return
                }
                setIsUploadingChatFiles(false)
            }

            const finalImageUrls = [...uploadedUrls, ...assetAttachments.map(a => a.url)]

            const endpoint = impersonateId 
                ? `/api/landing-page/generate?impersonate=${impersonateId}` 
                : `/api/landing-page/generate`

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: activeEditorPage.id,
                    slug: activeEditorPage.slug,
                    productName: activeEditorPage.product_name,
                    formId: activeEditorPage.form_id,
                    mode: 'edit',
                    instructions: userMsg,
                    currentHtml: activeEditorPage.html_content,
                    imageUrls: finalImageUrls
                })
            })

            let resData: any = null
            if (response.ok) {
                resData = await response.json()
            } else {
                let errMsg = "Edit failed"
                try {
                    const contentType = response.headers.get('content-type') || ''
                    if (contentType.includes('application/json')) {
                        const errorJson = await response.json()
                        errMsg = errorJson.error || errMsg
                    } else {
                        const errorText = await response.text()
                        errMsg = errorText || errMsg
                    }
                } catch (_) {
                    errMsg = `Request failed with status ${response.status}`
                }
                throw new Error(errMsg)
            }

            if (resData.jobId && resData.page) {
                startedBgJob = true
                setChatLogs(prev => [...prev, { 
                    sender: 'ai', 
                    message: "Applying edits to the landing page styling and layout in the background... Please wait." 
                }])
                startPollingJobStatus(resData.jobId, resData.page.id, true)
            }
        } catch(e: any) {
            setChatLogs(prev => [...prev, { sender: 'ai', message: `❌ Edit Failed: ${e.message}. Please try again.` }])
        } finally {
            if (!startedBgJob) {
                setActionLoading(false)
            }
        }
    }

        const handleSaveHtml = async () => {
        if (!activeEditorPage) return

        setActionLoading(true)
        try {
            const { error } = await supabase
                .from('landing_pages')
                .update({ html_content: editedHtml })
                .eq('id', activeEditorPage.id)
            
            if (error) throw error
            showToast("Landing page HTML saved successfully!")
            
            setLandingPages(prev => prev.map(p => p.id === activeEditorPage.id ? { ...p, html_content: editedHtml } : p))
            setActiveEditorPage(prev => prev ? { ...prev, html_content: editedHtml } : null)
        } catch (e: any) {
            showToast("Failed to save HTML: " + e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

    const copyUrl = (slug: string, id: string) => {
        const domainBase = customDomain || `app.nobogent.com/shared/${targetUserId}`
        const fullUrl = `https://${domainBase}/${slug}`
        navigator.clipboard.writeText(fullUrl)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const getPreviewHtml = (page: LandingPage) => {
        let html = page.html_content
        const form = forms.find(f => f.id === page.form_id)
        
        let buttonText = "Submit & Continue (Form Preview)"
        let cardTitle = "Get Instant Details"
        
        const containerMatch = html.match(/<div\s+[^>]*id="qualification-form-container"([^>]*?)>/i)
        if (containerMatch && containerMatch[1]) {
            const attrs = containerMatch[1]
            const btnTextMatch = attrs.match(/data-button-text="([^"]+)"/i) || attrs.match(/data-button-text='([^']+)'/i)
            if (btnTextMatch) buttonText = btnTextMatch[1]

            const titleMatch = attrs.match(/data-title="([^"]+)"/i) || attrs.match(/data-title='([^']+)'/i)
            if (titleMatch) cardTitle = titleMatch[1]
        }
        
        const isBrandLight = getContrastColor(brandColor) === '#0f172a';
        const buttonBgColor = isBrandLight ? '#0B0F19' : brandColor;
        const buttonTextColor = '#ffffff';

        const isSurveyPage = html.includes('data-page-type="survey"') || html.includes('id="survey-form-container"')
        
        let formHtml = ''
        if (isSurveyPage) {
            const customQuestions = form?.custom_questions || []
            const firstQuestionLabel = customQuestions[0]?.label || "What is your budget limit?"
            const options = customQuestions[0]?.options || ["Under 1 Cr", "1 Cr - 2 Cr", "Above 2 Cr"]
            const totalSteps = customQuestions.length + 1
            
            formHtml = `
                <div id="survey-wizard-container" style="width: 100%; max-width: 500px; background: #ffffff; border-radius: 1.5rem; padding: 2.25rem 2rem; border: 1px solid #e2e8f0; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.5rem; margin: 0 auto; text-align: left; font-family: system-ui, sans-serif;">
                    <!-- Progress Container -->
                    <div style="display: flex; align-items: center; gap: 0.75rem; width: 100%; box-sizing: border-box;">
                        <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                            <div style="width: ${Math.round(100 / totalSteps)}%; height: 100%; background: ${brandColor}; border-radius: 3px;"></div>
                        </div>
                        <span style="font-size: 0.75rem; font-weight: 700; color: #64748b; white-space: nowrap;">Step 1 of ${totalSteps}</span>
                    </div>
                    <!-- Steps Content Container -->
                    <div style="width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.25rem;">
                        <h4 style="margin: 0; color: #0f172a; font-size: 1.25rem; font-weight: 800; line-height: 1.4;">${firstQuestionLabel}</h4>
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                            ${customQuestions[0]?.type === 'MULTIPLE_CHOICE' || !customQuestions[0] ? 
                                options.map(opt => `
                                    <button disabled style="width: 100%; padding: 1rem 1.25rem; background: #f8fafc !important; border: 1px solid #e2e8f0; border-radius: 0.75rem; font-size: 0.875rem; font-weight: 600; color: #334155 !important; text-align: left; cursor: not-allowed; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; font-family: inherit;">
                                        <span>${opt}</span>
                                        <span style="color: #94a3b8; font-weight: bold;">→</span>
                                    </button>
                                `).join('') : `
                                    <input type="text" disabled placeholder="Type your answer here..." style="width: 100%; padding: 0.875rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; color: #0f172a; background-color: #ffffff; font-family: inherit;" />
                                    <button disabled style="width: 100%; padding: 0.875rem; background: ${buttonBgColor}; color: ${buttonTextColor}; border: none; border-radius: 0.75rem; font-size: 0.875rem; font-weight: 700; cursor: not-allowed; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); font-family: inherit;">Next</button>
                                `
                            }
                        </div>
                    </div>
                </div>
            `
        } else {
            const formFieldsToRender = form && form.fields && form.fields.length > 0 ? form.fields : [
                { name: 'name', type: 'text', label: 'Full Name' },
                { name: 'phone', type: 'tel', label: 'WhatsApp Number' },
                { name: 'city', type: 'text', label: 'City' }
            ]

            formHtml = `
                <div style="max-width: 500px; margin: 2rem auto; padding: 1.5rem 0; background: transparent; font-family: inherit; text-align: left; box-sizing: border-box;">
                    <h3 style="margin-top: 0; margin-bottom: 1.5rem; color: inherit; font-size: 1.5rem; font-weight: 800; text-align: center; letter-spacing: -0.025em; font-family: inherit;">${cardTitle}</h3>
            `

            formFieldsToRender.forEach((f: any) => {
                let placeholder = 'Your answer'
                if (f.name === 'name') placeholder = 'John Doe'
                else if (f.name === 'phone') placeholder = '+91 98765 43210'
                else if (f.name === 'city') placeholder = 'Mohali'

                formHtml += `
                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: inherit; opacity: 0.8; font-family: inherit;">${f.label}</label>
                        <input type="${f.type}" disabled placeholder="${placeholder}" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; color: inherit; background-color: #ffffff;" />
                    </div>
                `
            })

            if (form) {
                const customQuestions = form.custom_questions || []
                customQuestions.forEach((q: any, index: number) => {
                    formHtml += `
                        <div style="margin-bottom: 1.25rem;">
                            <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: inherit; opacity: 0.8; font-family: inherit;">${q.label}</label>
                    `
                    if (q.type === 'MULTIPLE_CHOICE') {
                        formHtml += `<select disabled style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; background: #fff; color: inherit;">`
                        const displayOpts = [...(q.options || [])]
                        if (q.disqualify_options && Array.isArray(q.disqualify_options)) {
                            q.disqualify_options.forEach((disqOpt: string) => {
                                const trimmed = disqOpt.trim()
                                if (trimmed && !displayOpts.some(o => o.trim().toLowerCase() === trimmed.toLowerCase())) {
                                    displayOpts.push(trimmed)
                                }
                            })
                        }
                        displayOpts.forEach((opt: string) => {
                            formHtml += `<option value="${opt}">${opt}</option>`
                        })
                        formHtml += `</select>`
                    } else {
                        formHtml += `<input type="text" disabled placeholder="Your answer" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; color: inherit; background-color: #ffffff;" />`
                    }
                    formHtml += `</div>`
                })
            }

            formHtml += `
                    <button disabled style="width: 100%; padding: 0.875rem; background: ${buttonBgColor}; color: ${buttonTextColor}; border: none; border-radius: 0.75rem; font-size: 0.875rem; font-weight: 700; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); cursor: not-allowed; font-family: inherit;">${buttonText}</button>
                </div>
            `
        }

        const containerRegex = /<div\s+[^>]*id="qualification-form-container"[^>]*>([\s\S]*?)<\/div>/gi
        if (html.match(containerRegex)) {
            html = html.replace(containerRegex, formHtml)
        } else if (html.includes('</body>')) {
            html = html.replace('</body>', `<div style="max-width: 600px; margin: 4rem auto; padding: 0 1rem;">${formHtml}</div></body>`)
        } else {
            html = `${html}<div style="max-width: 600px; margin: 4rem auto; padding: 0 1rem;">${formHtml}</div>`
        }

        // If it is a business landing page, inject products preview
        if (page.slug === 'index') {
            const activeProps = properties.filter(p => p.show_on_landing_page !== false)
            let productsHtml = ''
            if (activeProps.length > 0) {
                productsHtml = `
                    <div style="max-width: 1200px; margin: 4rem auto; padding: 0 1.5rem; font-family: system-ui, sans-serif;">
                        <h2 style="font-size: 1.875rem; font-weight: 900; text-align: center; color: #0f172a; margin-bottom: 2rem;">Our Featured Listings</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 2rem;">
                            ${activeProps.map(p => `
                                <div style="background: #ffffff; border-radius: 1.5rem; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); border: 1px solid #f1f5f9; display: flex; flex-direction: column; height: 100%;">
                                    <div style="position: relative; aspect-ratio: 1.6; background: #f8fafc; overflow: hidden;">
                                        <img src="${p.image_url || 'https://i.ibb.co/NdSPkfxQ/3bhk.webp'}" alt="${p.title}" style="width: 100%; height: 100%; object-fit: cover;" />
                                    </div>
                                    <div style="padding: 1.5rem; flex-grow: 1; display: flex; flex-direction: column;">
                                        <h3 style="font-weight: 800; font-size: 1.125rem; color: #0f172a; margin: 0 0 0.5rem; line-clamp: 1;">${p.title}</h3>
                                        <p style="color: #64748b; font-size: 0.75rem; line-height: 1.5; margin: 0 0 1rem; flex-grow: 1;">${p.description || ''}</p>
                                        <div style="margin-top: auto; padding-top: 1rem; border-top: 1px solid #f1f5f9;">
                                            <span style="display: inline-block; background: #0f172a; color: #ffffff; font-weight: 800; font-size: 0.75rem; padding: 0.5rem 1rem; border-radius: 0.75rem;">${p.price || 'Contact us'}</span>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `
            }
            const prodContainerRegex = /<div\s+[^>]*id="business-products-container"[^>]*>([\s\S]*?)<\/div>/gi
            if (html.match(prodContainerRegex)) {
                html = html.replace(prodContainerRegex, `<div id="business-products-container">${productsHtml}</div>`)
            } else if (html.includes('</body>')) {
                html = html.replace('</body>', `<div id="business-products-container">${productsHtml}</div></body>`)
            }
        }

        // Inject contenteditable scripts for visual text editing
        const editableScript = `
            <script id="preview-visual-edit-script">
            (function() {
                document.addEventListener("DOMContentLoaded", () => {
                    const editableSelectors = 'h1, h2, h3, h4, h5, h6, p, span, a, li, button, label, strong, em';
                    document.querySelectorAll(editableSelectors).forEach(el => {
                        if (el.closest('#qualification-form-container') || 
                            el.closest('#survey-wizard-container') || 
                            el.closest('#business-products-container') || 
                            el.closest('#eligibility-modal-overlay')) {
                            return;
                        }
                        
                        el.contentEditable = "true";
                        el.style.outline = "none";
                        
                        el.addEventListener('mouseover', (e) => {
                            e.stopPropagation();
                            el.style.boxShadow = "0 0 0 2px rgba(37, 99, 235, 0.4)";
                            el.style.borderRadius = "4px";
                            el.style.cursor = "text";
                        });
                        
                        el.addEventListener('mouseout', (e) => {
                            e.stopPropagation();
                            el.style.boxShadow = "none";
                        });
                        
                        el.addEventListener('blur', () => {
                            const docClone = document.documentElement.cloneNode(true);
                            
                            docClone.querySelectorAll('[contenteditable]').forEach(cloneEl => {
                                cloneEl.removeAttribute('contenteditable');
                                cloneEl.style.boxShadow = '';
                                cloneEl.style.borderRadius = '';
                                cloneEl.style.cursor = '';
                                if (cloneEl.getAttribute('style') === '') {
                                    cloneEl.removeAttribute('style');
                                }
                            });
                            
                            const formCont = docClone.querySelector('#qualification-form-container');
                            if (formCont) formCont.innerHTML = '';
                            const prodCont = docClone.querySelector('#business-products-container');
                            if (prodCont) prodCont.innerHTML = '';
                            
                            const previewScript = docClone.querySelector('#preview-visual-edit-script');
                            if (previewScript) previewScript.remove();
                            
                            window.parent.postMessage({
                                type: 'html-visually-updated',
                                html: '<!DOCTYPE html>\\n' + docClone.outerHTML
                            }, '*');
                        });
                    });
                });
            })();
            </script>
        `
        if (html.includes('</body>')) {
            html = html.replace('</body>', `${editableScript}</body>`)
        } else {
            html = html + editableScript
        }

        return html
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#F8FAFC]">
                <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-[#F8FAFC] pb-24 font-sans px-4 sm:px-6 lg:px-8 pt-8 relative selection:bg-blue-200">
            
            {/* Header */}
            <div className="max-w-7xl mx-auto mb-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-3">
                            <Globe className="text-blue-500" size={30} /> Landing Pages Manager
                        </h1>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-2.5">
                            {subAccountName ? `Configuring Client Listing: ${subAccountName}` : 'Create & Optimize High-Converting Landers'}
                        </p>
                    </div>

                    <div className="flex gap-2">
                        {activeTab === 'landing_pages' ? (
                            <button 
                                onClick={() => { 
                                    setActiveEditorPage(null); 
                                    setPageProductName('');
                                    setPageContext('');
                                    setSelectedPropertyId('');
                                    setCustomInstructions('');
                                    setSelectedFormId('');
                                    setPageType('standard');
                                    setShowPageGenerator(true);
                                }}
                                className="bg-slate-900 text-white font-extrabold hover:bg-slate-800 text-sm px-6 py-3 rounded-full shadow-md shadow-slate-900/10 flex items-center gap-2 active:scale-95 transition-all"
                            >
                                <Sparkles size={16} className="text-purple-400" /> AI Lander Generator
                            </button>
                        ) : (
                            <button 
                                onClick={handleOpenNewFormModal}
                                className="bg-slate-900 text-white font-extrabold hover:bg-slate-800 text-sm px-6 py-3 rounded-full shadow-md shadow-slate-900/10 flex items-center gap-2 active:scale-95 transition-all"
                            >
                                <Plus size={16} /> Custom Form
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Custom Toast Alert */}
            {successMessage && (
                <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] bg-green-50 text-green-700 font-bold border border-green-200 rounded-full px-6 py-3 shadow-xl animate-in slide-in-from-top-4 duration-300">
                    {successMessage}
                </div>
            )}
            {errorMessage && (
                <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] bg-red-50 text-red-700 font-bold border border-red-200 rounded-full px-6 py-3 shadow-xl animate-in slide-in-from-top-4 duration-300">
                    {errorMessage}
                </div>
            )}

            {/* CONVERSATIONAL EDITOR DRAWER PANEL */}
            {activeEditorPage ? (
                <div className="max-w-7xl mx-auto bg-white border border-slate-200 rounded-[2.5rem] p-4 sm:p-6 shadow-xl flex flex-col gap-4 lg:flex-row h-[85vh] lg:h-[80vh] overflow-hidden animate-in zoom-in-95 duration-300">
                    
                    {/* Mobile View Switcher */}
                    <div className="flex lg:hidden bg-slate-100 p-1 rounded-2xl border border-slate-200 justify-between shrink-0">
                        <button
                            onClick={() => setEditorMobileTab('chat')}
                            className={`flex-1 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
                                editorMobileTab === 'chat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                            }`}
                        >
                            <MessageSquare size={14} /> Assistant Chat
                        </button>
                        <button
                            onClick={() => setEditorMobileTab('preview')}
                            className={`flex-1 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
                                editorMobileTab === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                            }`}
                        >
                            <Eye size={14} /> Page Preview
                        </button>
                    </div>

                    {/* Left Pane: Conversation console */}
                    <div className={`w-full lg:w-[400px] flex flex-col h-full bg-slate-50 border border-slate-200 rounded-[2rem] p-4 ${
                        editorMobileTab === 'chat' ? 'flex' : 'hidden lg:flex'
                    }`}>
                        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
                            <div>
                                <h3 className="text-base font-black text-slate-800">Lander Assistant</h3>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">{activeEditorPage.product_name}</p>
                            </div>
                            <button 
                                onClick={() => setActiveEditorPage(null)}
                                className="bg-white p-2 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-500 transition-colors"
                            >
                                <ArrowLeft size={16} />
                            </button>
                        </div>

                        {/* Chat history */}
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                            {chatLogs.map((log, index) => (
                                <div 
                                    key={index}
                                    className={`p-3 rounded-2xl text-xs leading-relaxed max-w-[85%] font-medium shadow-sm ${
                                        log.sender === 'ai' 
                                            ? 'bg-white text-slate-800 border border-slate-200 rounded-tl-none self-start mr-auto' 
                                            : 'bg-blue-600 text-white rounded-tr-none self-end ml-auto'
                                    }`}
                                >
                                    <div>{log.message}</div>
                                    {log.images && log.images.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {log.images.map((url, i) => (
                                                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-14 h-14 rounded-lg overflow-hidden border border-slate-200/50 shadow-sm relative hover:scale-105 transition-all">
                                                    <img src={url} alt="attachment" className="w-full h-full object-cover" />
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {actionLoading && (
                                <div className="bg-white text-slate-800 border border-slate-200 rounded-2xl rounded-tl-none p-3 text-xs flex items-center gap-2 self-start mr-auto shadow-sm">
                                    <Loader2 className="animate-spin text-blue-500 w-4 h-4" /> {isUploadingChatFiles ? "Uploading attachments..." : "Asking Gemini to update landing page styles..."}
                                </div>
                            )}
                        </div>

                        {/* Attached files previews */}
                        {attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2 p-2 bg-white border border-slate-200 rounded-xl animate-in fade-in duration-200">
                                {attachments.map((att) => (
                                    <div key={att.id} className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 group">
                                        <img src={att.url} alt="attached-preview" className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => handleRemoveAttachment(att.id)}
                                            className="absolute top-0.5 right-0.5 bg-red-500/90 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold hover:bg-red-600 transition-colors shadow"
                                        >
                                            ×
                                        </button>
                                        <span className={`absolute bottom-0.5 right-0.5 text-[6px] font-black text-white px-1 rounded ${att.type === 'asset' ? 'bg-purple-600' : 'bg-blue-600'}`}>{att.type === 'asset' ? 'Asset' : 'File'}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Input bar */}
                        <div className="mt-3 flex gap-2">
                            <input 
                                type="file" 
                                ref={chatFileInputRef} 
                                onChange={handleChatFileSelect} 
                                multiple 
                                accept="image/*" 
                                className="hidden" 
                            />
                            <button
                                onClick={() => chatFileInputRef.current?.click()}
                                disabled={actionLoading}
                                type="button"
                                className="bg-white border border-slate-200 text-slate-500 hover:text-slate-700 rounded-xl p-3 shadow-sm hover:bg-slate-50 active:scale-95 disabled:opacity-50 flex items-center justify-center transition-all"
                                title="Attach local photo or screenshot"
                            >
                                <Paperclip size={16} />
                            </button>
                            <button
                                onClick={handleOpenAssetPicker}
                                disabled={actionLoading}
                                type="button"
                                className="bg-white border border-slate-200 text-slate-500 hover:text-slate-700 rounded-xl p-3 shadow-sm hover:bg-slate-50 active:scale-95 disabled:opacity-50 flex items-center justify-center transition-all"
                                title="Select from Assets"
                            >
                                <ImageIcon size={16} />
                            </button>
                            <input 
                                type="text"
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && !actionLoading && handleSendChatEdit()}
                                disabled={actionLoading}
                                placeholder="Describe edits or attach screenshots..."
                                className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 transition-all"
                            />
                            <button
                                onClick={handleSendChatEdit}
                                disabled={actionLoading || (!chatInput.trim() && attachments.length === 0)}
                                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-3 shadow-md shadow-blue-500/10 active:scale-95 disabled:opacity-50 flex items-center justify-center transition-all"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Right Pane: Live iFrame Preview or HTML Code Editor */}
                    <div className={`flex-1 flex flex-col h-full bg-slate-50 border border-slate-200 rounded-[2rem] p-4 relative overflow-hidden ${
                        editorMobileTab === 'preview' ? 'flex' : 'hidden lg:flex'
                    }`}>
                        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3 gap-2 flex-wrap">
                            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-full border border-slate-200/50">
                                <button
                                    onClick={() => setEditorView('preview')}
                                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                                        editorView === 'preview' 
                                            ? 'bg-white text-slate-800 shadow-sm' 
                                            : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Eye size={12} /> Preview
                                </button>
                                <button
                                    onClick={() => setEditorView('code')}
                                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                                        editorView === 'code' 
                                            ? 'bg-white text-slate-800 shadow-sm' 
                                            : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Code size={12} /> HTML Code
                                </button>
                            </div>

                            {/* Device Viewport Selector */}
                            {editorView === 'preview' && (
                                <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl border border-slate-300/60">
                                    <button
                                        onClick={() => setPreviewDevice('desktop')}
                                        className={`p-1.5 rounded-lg transition-all ${
                                            previewDevice === 'desktop' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                        title="Desktop View (100%)"
                                    >
                                        <Monitor size={14} />
                                    </button>
                                    <button
                                        onClick={() => setPreviewDevice('tablet')}
                                        className={`p-1.5 rounded-lg transition-all ${
                                            previewDevice === 'tablet' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                        title="Tablet View (768px)"
                                    >
                                        <Tablet size={14} />
                                    </button>
                                    <button
                                        onClick={() => setPreviewDevice('mobile')}
                                        className={`p-1.5 rounded-lg transition-all ${
                                            previewDevice === 'mobile' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                        title="Mobile View (375px)"
                                    >
                                        <Smartphone size={14} />
                                    </button>
                                </div>
                            )}

                            <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                                {editorView === 'code' ? (
                                    <button
                                        onClick={handleSaveHtml}
                                        disabled={actionLoading}
                                        className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md shadow-blue-500/10 active:scale-95 disabled:opacity-50"
                                    >
                                        {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                        Save Code
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => copyUrl(activeEditorPage.slug, activeEditorPage.id)}
                                        className="bg-white px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-600 text-[10px] font-black flex items-center gap-1.5 transition-all shadow-sm active:scale-95 truncate"
                                    >
                                        {copiedId === activeEditorPage.id ? <Check size={12} className="text-green-600" /> : <Copy size={12} />} 
                                        {copiedId === activeEditorPage.id ? 'Copied' : 'Copy URL'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {editorView === 'preview' ? (
                            <div className="flex-1 overflow-auto flex items-center justify-center bg-slate-200/50 rounded-[1.5rem] p-2 relative">
                                <div className={`transition-all duration-300 bg-white shadow-xl overflow-hidden ${
                                    previewDevice === 'mobile'
                                        ? 'w-[375px] h-[667px] max-h-full rounded-[2.5rem] border-[8px] border-slate-900 shadow-2xl relative my-auto'
                                        : previewDevice === 'tablet'
                                            ? 'w-[768px] h-full max-h-full rounded-[2rem] border-[8px] border-slate-900 shadow-2xl relative my-auto'
                                            : 'w-full h-full rounded-[1.5rem] border border-slate-200'
                                }`}>
                                    <iframe 
                                        srcDoc={getPreviewHtml(activeEditorPage)} 
                                        className="w-full h-full border-none"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 rounded-[1.5rem] overflow-hidden border border-slate-200 shadow-inner relative bg-slate-950 flex flex-col p-2">
                                <textarea
                                    value={editedHtml}
                                    onChange={(e) => setEditedHtml(e.target.value)}
                                    className="w-full h-full bg-slate-950 text-emerald-400 font-mono text-[11px] leading-relaxed p-4 outline-none resize-none scrollbar-hide border-none selection:bg-slate-800"
                                    placeholder="Enter your landing page HTML code here..."
                                />
                            </div>
                        )}
                    </div>

                </div>
            ) : (
                <div className="max-w-7xl mx-auto">
                    
                    {/* Navigation Pills */}
                    <div className="flex justify-start border-b border-slate-200/60 mb-8 gap-6">
                        <button 
                            onClick={() => setActiveTab('landing_pages')}
                            className={`pb-4 text-sm font-black flex items-center gap-2 relative transition-colors ${activeTab === 'landing_pages' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Globe size={18} /> Landing Pages
                            {activeTab === 'landing_pages' && <span className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-full animate-in slide-in-from-left duration-200"></span>}
                        </button>
                        <button 
                            onClick={() => setActiveTab('forms')}
                            className={`pb-4 text-sm font-black flex items-center gap-2 relative transition-colors ${activeTab === 'forms' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <List size={18} /> Qualification Forms
                            {activeTab === 'forms' && <span className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-full animate-in slide-in-from-left duration-200"></span>}
                        </button>
                        <button 
                            onClick={() => setActiveTab('business_landing')}
                            className={`pb-4 text-sm font-black flex items-center gap-2 relative transition-colors ${activeTab === 'business_landing' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Sparkles size={18} /> Business Landing Page
                            {activeTab === 'business_landing' && <span className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-full animate-in slide-in-from-left duration-200"></span>}
                        </button>
                    </div>

                    {/* Tab Panels */}
                    {activeTab === 'landing_pages' && (
                        <div className="animate-in fade-in duration-300">
                            {landingPages.length === 0 ? (
                                <div className="text-center py-20 bg-white border border-slate-200/60 rounded-[3rem] border-dashed shadow-sm">
                                    <div className="w-16 h-16 bg-blue-50 flex items-center justify-center rounded-2xl mx-auto mb-4 text-blue-500 shadow-inner">
                                        <Globe size={28} />
                                    </div>
                                    <h3 className="text-lg font-black text-slate-800">No landing pages yet</h3>
                                    <p className="text-xs font-semibold text-slate-400 mt-2 max-w-[280px] mx-auto leading-relaxed">Let Gemini generate high-converting landers with custom forms instantly.</p>
                                    <button 
                                        onClick={() => {
                                            setPageProductName('');
                                            setPageContext('');
                                            setSelectedPropertyId('');
                                            setCustomInstructions('');
                                            setSelectedFormId('');
                                            setPageType('standard');
                                            setShowPageGenerator(true);
                                        }}
                                        className="mt-6 bg-slate-900 text-white font-extrabold text-xs px-5 py-3 rounded-full hover:bg-slate-800 transition-colors shadow-md shadow-slate-900/10 inline-flex items-center gap-2 active:scale-95"
                                    >
                                        <Sparkles size={14} className="text-purple-400" /> Generate First Page
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {landingPages.map((page) => (
                                        <div key={page.id} className="bg-white border border-slate-200/60 rounded-[2rem] p-5 shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col h-full border-t-4 border-t-blue-500">
                                            <div className="flex items-center gap-2 mb-2 min-w-0">
                                                <h3 className="text-lg font-black text-slate-800 leading-tight line-clamp-1 flex-1">{page.product_name}</h3>
                                                {page.html_content?.includes('data-page-type="survey"') ? (
                                                    <span className="text-[9px] bg-purple-50 text-purple-600 font-extrabold px-2 py-0.5 rounded-full shrink-0 border border-purple-100">Survey Form</span>
                                                ) : (
                                                    <span className="text-[9px] bg-blue-50 text-blue-600 font-extrabold px-2 py-0.5 rounded-full shrink-0 border border-blue-100">Standard Page</span>
                                                )}
                                            </div>
                                            <p className="text-xs font-semibold text-slate-400 line-clamp-2 leading-relaxed mb-4">{page.title}</p>
                                            
                                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 flex items-center justify-between mb-4 shrink-0 min-w-0 gap-3">
                                                {editingSlugPageId === page.id ? (
                                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                        <span className="text-[10px] font-bold text-slate-400">/</span>
                                                        <input 
                                                            type="text" 
                                                            value={tempSlug} 
                                                            onChange={e => setTempSlug(e.target.value)}
                                                            className="flex-1 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-700 outline-none"
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') handleUpdateSlug(page.id, tempSlug)
                                                                if (e.key === 'Escape') setEditingSlugPageId(null)
                                                            }}
                                                            autoFocus
                                                        />
                                                        <button 
                                                            onClick={() => handleUpdateSlug(page.id, tempSlug)}
                                                            className="text-green-600 hover:text-green-700 text-[10px] font-black shrink-0"
                                                        >
                                                            Save
                                                        </button>
                                                        <button 
                                                            onClick={() => setEditingSlugPageId(null)}
                                                            className="text-slate-400 hover:text-slate-600 text-[10px] font-bold shrink-0"
                                                        >
                                                            X
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                        <span className="text-[10px] font-bold text-slate-500 truncate select-all">{`/${page.slug}`}</span>
                                                        <button
                                                            onClick={() => {
                                                                setEditingSlugPageId(page.id)
                                                                setTempSlug(page.slug)
                                                            }}
                                                            className="text-slate-400 hover:text-slate-600 p-0.5 transition-colors shrink-0"
                                                            title="Edit Slug"
                                                        >
                                                            <Edit3 size={11} />
                                                        </button>
                                                    </div>
                                                )}
                                                
                                                <button
                                                    onClick={() => copyUrl(page.slug, page.id)}
                                                    className="bg-white p-2 rounded-full border border-slate-200/60 hover:bg-slate-100 text-slate-400 hover:text-blue-500 active:scale-90 transition-all shrink-0 shadow-sm"
                                                    title="Copy full URL"
                                                >
                                                    {copiedId === page.id ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                                                </button>
                                            </div>

                                            <div className="mb-6">
                                                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Linked Form</label>
                                                <select 
                                                    value={page.form_id || ''}
                                                    onChange={(e) => handleUpdatePageForm(page.id, e.target.value || null)}
                                                    className="w-full bg-slate-50 hover:bg-slate-100/50 p-3 rounded-xl text-xs font-bold text-slate-700 outline-none border border-slate-200/60 transition-all cursor-pointer"
                                                >
                                                    <option value="">Default Form (Name, WhatsApp, City)</option>
                                                    {forms.map(f => (
                                                        <option key={f.id} value={f.id}>{f.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="mb-6">
                                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                                    <input 
                                                        type="checkbox"
                                                        checked={page.booking_enabled || false}
                                                        onChange={(e) => handleUpdatePageBooking(page.id, e.target.checked)}
                                                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                                                    />
                                                    <span className="text-xs font-bold text-slate-600">Enable Google Calendar booking after lead submission</span>
                                                </label>
                                            </div>

                                            <div className="mb-6">
                                                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Connected Meta Pixel</label>
                                                {isLoadingPixels ? (
                                                    <div className="text-[10px] text-slate-400 font-bold ml-1 animate-pulse">Loading pixels...</div>
                                                ) : (
                                                    <select 
                                                        value={page.pixel_id || ''}
                                                        onChange={(e) => handleUpdatePagePixel(page.id, e.target.value || null)}
                                                        className="w-full bg-slate-50 hover:bg-slate-100/50 p-3 rounded-xl text-xs font-bold text-slate-700 outline-none border border-slate-200/60 transition-all cursor-pointer"
                                                    >
                                                        <option value="">Default Profile Pixel</option>
                                                        {pixels.map(p => (
                                                            <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                                                        ))}
                                                    </select>
                                                )}
                                            </div>

                                            <div className="flex gap-2 w-full pt-4 border-t border-slate-100 mt-auto">
                                                <button 
                                                    onClick={() => {
                                                        setActiveEditorPage(page)
                                                        setChatLogs([
                                                            { sender: 'ai', message: `Previewing landing page for "${page.product_name}". Write your visual/copy changes directly in this chat!` }
                                                        ])
                                                    }}
                                                    className="flex-1 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white py-3 rounded-xl font-extrabold text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                                                >
                                                    <MessageSquare size={14} /> Chat Edit
                                                </button>
                                                
                                                <button 
                                                    onClick={() => {
                                                        const domainBase = customDomain || `app.nobogent.com/shared/${targetUserId}`
                                                        window.open(`https://${domainBase}/${page.slug}`, '_blank')
                                                    }}
                                                    className="bg-slate-50 text-slate-600 hover:bg-slate-100 p-3 rounded-xl border border-slate-200 transition-colors"
                                                    title="View Live Page"
                                                >
                                                    <Eye size={14} />
                                                </button>

                                                <button 
                                                    onClick={() => handleDeletePage(page.id)}
                                                    className="bg-red-50 text-red-500 hover:bg-red-500 hover:text-white p-3 rounded-xl border border-red-100 transition-colors"
                                                    title="Delete Page"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'forms' && (
                        <div className="animate-in fade-in duration-300">
                            {forms.length === 0 ? (
                                <div className="text-center py-20 bg-white border border-slate-200/60 rounded-[3rem] border-dashed shadow-sm">
                                    <div className="w-16 h-16 bg-blue-50 flex items-center justify-center rounded-2xl mx-auto mb-4 text-blue-500 shadow-inner">
                                        <List size={28} />
                                    </div>
                                    <h3 className="text-lg font-black text-slate-800">No forms built yet</h3>
                                    <p className="text-xs font-semibold text-slate-400 mt-2 max-w-[280px] mx-auto leading-relaxed">Default fields (Name, WhatsApp, City) are automatically set up. Add custom questions for qualification.</p>
                                    <button 
                                        onClick={handleOpenNewFormModal}
                                        className="mt-6 bg-slate-900 text-white font-extrabold text-xs px-5 py-3 rounded-full hover:bg-slate-800 transition-colors shadow-md shadow-slate-900/10 inline-flex items-center gap-2 active:scale-95"
                                    >
                                        <Plus size={14} /> Build First Form
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {forms.map((form) => (
                                        <div key={form.id} className="bg-white border border-slate-200/60 rounded-[2rem] p-5 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full border-t-4 border-t-slate-800">
                                            <h3 className="text-lg font-black text-slate-800 leading-tight mb-3 truncate">{form.name}</h3>
                                            
                                            <div className="space-y-2 mb-6">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Base Fields</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-lg">Name</span>
                                                    <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-lg">WhatsApp</span>
                                                    <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-lg">City</span>
                                                </div>
                                            </div>

                                            {form.custom_questions && form.custom_questions.length > 0 && (
                                                <div className="space-y-2 mb-6 flex-1">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Custom Questions ({form.custom_questions.length})</div>
                                                    <div className="flex flex-col gap-1.5">
                                                        {form.custom_questions.map((q, idx) => (
                                                            <div key={idx} className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-xs text-slate-700 font-semibold truncate flex flex-col gap-1">
                                                                <div className="flex items-center gap-1.5 justify-between">
                                                                    <span className="truncate">{q.label}</span>
                                                                    <span className="text-[9px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded font-black shrink-0">{q.type === 'MULTIPLE_CHOICE' ? 'Choice' : 'Text'}</span>
                                                                </div>
                                                                {q.disqualify_options && q.disqualify_options.length > 0 && (
                                                                    <div className="text-[9px] text-red-500 font-bold tracking-tight">
                                                                        Disqualifies: {q.disqualify_options.join(', ')}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-auto">
                                                <button 
                                                    onClick={() => handleEditFormClick(form)}
                                                    className="bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white p-3 rounded-xl border border-blue-100 transition-all active:scale-95"
                                                    title="Edit Form"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                
                                                <button 
                                                    onClick={() => handleDeleteForm(form.id)}
                                                    className="bg-red-50 text-red-500 hover:bg-red-500 hover:text-white p-3 rounded-xl border border-red-100 transition-all active:scale-95"
                                                    title="Delete Form"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}



                </div>
            )}

            {/* MODAL: FORM CREATOR */}
            {showFormModal && (
                <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-6 sm:p-8 shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300 overflow-y-auto custom-scrollbar">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-6">
                            <h2 className="text-xl font-black text-slate-900">{editingFormId ? 'Edit Qualification Form' : 'Create Custom Form'}</h2>
                            <button onClick={() => setShowFormModal(false)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors">
                                <Plus className="rotate-45" size={18} />
                            </button>
                        </div>

                        {/* Name */}
                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Form Name</label>
                            <input 
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                placeholder="e.g. Ananta Luxury Lead Form"
                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                            />
                        </div>

                        {/* Standard Fields Configuration */}
                        <div className="mb-6 bg-slate-50 border border-slate-200/60 rounded-3xl p-5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-3 block">Configure Base Fields</label>
                            <div className="space-y-4">
                                {/* Name Field */}
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="checkbox" 
                                        checked={true} 
                                        disabled={true} 
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-not-allowed"
                                        readOnly
                                    />
                                    <div className="flex-1">
                                        <div className="text-xs font-bold text-slate-700 mb-1">Name Field (Required)</div>
                                        <input 
                                            type="text"
                                            value={formFields.find(f => f.name === 'name')?.label || 'Full Name'}
                                            onChange={e => {
                                                const newFields = formFields.map(f => f.name === 'name' ? { ...f, label: e.target.value } : f)
                                                setFormFields(newFields)
                                            }}
                                            placeholder="Label for Name Field"
                                            className="w-full bg-white px-3 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none border border-slate-200 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                </div>

                                {/* Phone/WhatsApp Field */}
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="checkbox" 
                                        checked={true} 
                                        disabled={true} 
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-not-allowed"
                                        readOnly
                                    />
                                    <div className="flex-1">
                                        <div className="text-xs font-bold text-slate-700 mb-1">WhatsApp Number Field (Required)</div>
                                        <input 
                                            type="text"
                                            value={formFields.find(f => f.name === 'phone')?.label || 'WhatsApp Number'}
                                            onChange={e => {
                                                const newFields = formFields.map(f => f.name === 'phone' ? { ...f, label: e.target.value } : f)
                                                setFormFields(newFields)
                                            }}
                                            placeholder="Label for WhatsApp Field"
                                            className="w-full bg-white px-3 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none border border-slate-200 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                </div>

                                {/* City Field */}
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="checkbox" 
                                        checked={formFields.some(f => f.name === 'city')} 
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setFormFields([...formFields, { name: 'city', type: 'text', label: 'City' }])
                                            } else {
                                                setFormFields(formFields.filter(f => f.name !== 'city'))
                                            }
                                        }}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                    <div className="flex-1">
                                        <div className="text-xs font-bold text-slate-700 mb-1">City Field (Optional)</div>
                                        <input 
                                            type="text"
                                            disabled={!formFields.some(f => f.name === 'city')}
                                            value={formFields.find(f => f.name === 'city')?.label || 'City'}
                                            onChange={e => {
                                                const newFields = formFields.map(f => f.name === 'city' ? { ...f, label: e.target.value } : f)
                                                setFormFields(newFields)
                                            }}
                                            placeholder="Label for City Field"
                                            className="w-full bg-white disabled:bg-slate-100/50 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none border border-slate-200 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Added Questions list */}
                        {formQuestions.length > 0 && (
                            <div className="mb-6">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Added Custom Questions</label>
                                <div className="space-y-2">
                                    {formQuestions.map((q, idx) => (
                                        <div key={idx} className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3 flex justify-between items-center">
                                            <div className="min-w-0">
                                                <div className="text-xs font-bold text-slate-700 truncate">{q.label}</div>
                                                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                                    {q.type === 'MULTIPLE_CHOICE' ? `Choice (${q.options?.length} opts)` : 'Short Answer'}
                                                    {q.disqualify_options && q.disqualify_options.length > 0 && (
                                                        <span className="text-red-500 font-bold ml-1.5">
                                                            (Disqualifies: {q.disqualify_options.join(', ')})
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button 
                                                    onClick={() => handleEditQuestionClick(idx)} 
                                                    className={`p-1.5 rounded-lg border transition-all ${editingQuestionIdx === idx ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 hover:bg-blue-50 text-slate-500 hover:text-blue-600 border-slate-200'}`}
                                                    title="Edit Question"
                                                >
                                                    <Edit3 size={12} />
                                                </button>
                                                <button 
                                                    onClick={() => handleRemoveQuestion(idx)} 
                                                    className="bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 p-1.5 rounded-lg border border-slate-200 transition-all"
                                                    title="Delete Question"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Question adder */}
                        <div className="border-t border-slate-100 pt-6 mb-8">
                            <h4 className="text-xs font-black text-slate-700 mb-4">{editingQuestionIdx !== null ? 'Edit Custom Question' : 'Add Custom Question'}</h4>
                            
                            <div className="space-y-4">
                                <div>
                                    <input 
                                        type="text"
                                        value={newQuestionLabel}
                                        onChange={e => setNewQuestionLabel(e.target.value)}
                                        placeholder="e.g. What is your budget limit?"
                                        className="w-full bg-slate-50 hover:bg-slate-100/50 p-3.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                                    />
                                </div>

                                <div className="flex gap-4">
                                    <div className="flex-1">
                                        <select 
                                            value={newQuestionType}
                                            onChange={e => setNewQuestionType(e.target.value as any)}
                                            className="w-full bg-slate-50 hover:bg-slate-100/50 p-3.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                                        >
                                            <option value="SHORT_ANSWER">Short Answer</option>
                                            <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                                        </select>
                                    </div>
                                    
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={handleAddQuestion}
                                            className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs px-5 rounded-xl transition-all h-[42px] shrink-0"
                                        >
                                            {editingQuestionIdx !== null ? 'Update' : 'Add'}
                                        </button>
                                        {editingQuestionIdx !== null && (
                                            <button 
                                                onClick={handleCancelQuestionEdit}
                                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs px-4 rounded-xl transition-all h-[42px] shrink-0"
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {newQuestionType === 'MULTIPLE_CHOICE' && (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Answer Options</label>
                                            <input 
                                                type="text"
                                                value={newQuestionOptions}
                                                onChange={e => setNewQuestionOptions(e.target.value)}
                                                placeholder="Options (comma separated, e.g. Under 50L, 50L-1Cr, 1Cr+)"
                                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-3.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Disqualifying Options (Optional)</label>
                                            <input 
                                                type="text"
                                                value={newDisqualifyOptions}
                                                onChange={e => setNewDisqualifyOptions(e.target.value)}
                                                placeholder="Disqualifying options (comma separated, e.g. Under 50L)"
                                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-3.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Exit Reason Message (Optional)</label>
                                            <input 
                                                type="text"
                                                value={newDisqualifyMessage}
                                                onChange={e => setNewDisqualifyMessage(e.target.value)}
                                                placeholder="Reason: e.g. We require a minimum budget of 50L to qualify."
                                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-3.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Submit */}
                        <button
                            onClick={handleCreateForm}
                            disabled={actionLoading}
                            className="bg-slate-900 text-white w-full py-4 rounded-full font-black text-sm shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 mt-auto shrink-0"
                        >
                            {actionLoading ? <Loader2 className="animate-spin" size={16} /> : 'Save Qualification Form'}
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'business_landing' && (
                <div className="animate-in fade-in duration-300 space-y-6">
                    <div className="bg-white border border-slate-200/80 rounded-[3rem] p-6 sm:p-8 shadow-xl max-w-2xl mx-auto space-y-6">
                        <div>
                            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2"><Sparkles className="text-blue-600" /> Business Landing Page Settings</h2>
                            <p className="text-[11px] font-semibold text-slate-400 mt-1">Configure your primary business profile landing page served on your main custom domain.</p>
                        </div>
                        
                        <div className="space-y-4">
                            {/* Toggle: Enable Main Business Landing Page */}
                            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <div>
                                    <div className="text-xs font-bold text-slate-800">Enable Custom Landing Page</div>
                                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium leading-relaxed">Turn on to serve a premium lead-capturing landing page instead of a raw catalog feed.</p>
                                </div>
                                <button 
                                  onClick={() => setBusinessLandingEnabled(!businessLandingEnabled)}
                                  className={`w-10 h-6 rounded-full flex items-center transition-all duration-300 px-0.5 ${businessLandingEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                                >
                                  <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${businessLandingEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            {businessLandingEnabled && (
                                <div className="space-y-4 pt-2 animate-in fade-in duration-200">
                                    {/* Hero Title */}
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">Hero Headline Title</label>
                                        <input 
                                            type="text"
                                            value={businessLandingHeroTitle}
                                            onChange={e => setBusinessLandingHeroTitle(e.target.value)}
                                            placeholder="e.g. Find Your Dream Property with Homcom Realtors"
                                            className="w-full bg-slate-50 hover:bg-slate-100/50 p-3.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                                        />
                                    </div>

                                    {/* Hero Subtitle */}
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">Hero Subheadline / Description</label>
                                        <textarea 
                                            value={businessLandingHeroSubtitle}
                                            onChange={e => setBusinessLandingHeroSubtitle(e.target.value)}
                                            placeholder="Describe your value proposition, locations served, or special hooks..."
                                            rows={3}
                                            className="w-full bg-slate-50 hover:bg-slate-100/50 p-3.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all resize-none leading-relaxed"
                                        />
                                    </div>

                                    {/* Checkbox: Include Products */}
                                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                        <div>
                                            <div className="text-xs font-bold text-slate-800">Show Inventory Products</div>
                                            <p className="text-[10px] text-slate-400 mt-0.5 font-medium leading-relaxed">Display products/properties having "Show on Landing Page" active.</p>
                                        </div>
                                        <button 
                                          onClick={() => setBusinessLandingShowProducts(!businessLandingShowProducts)}
                                          className={`w-10 h-6 rounded-full flex items-center transition-all duration-300 px-0.5 ${businessLandingShowProducts ? 'bg-blue-600' : 'bg-slate-300'}`}
                                        >
                                          <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${businessLandingShowProducts ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                            )}

                        </div>

                        {/* Save Button */}
                        <button
                            onClick={handleSaveBusinessLanding}
                            disabled={savingBusinessLanding}
                            className="bg-slate-900 text-white w-full py-4 rounded-full font-black text-sm shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all shrink-0 mt-4"
                        >
                            {savingBusinessLanding ? <Loader2 className="animate-spin" size={16} /> : 'Save Landing Page Settings'}
                        </button>
                    </div>

                    <div className="bg-white border border-slate-200/80 rounded-[3rem] p-6 sm:p-8 shadow-xl max-w-2xl mx-auto">
                        {(() => {
                            const bizPage = landingPages.find(p => p.slug === 'index')
                            if (bizPage) {
                                return (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-base font-black text-slate-800">AI Generated Business Homepage</h3>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Live at: /{bizPage.slug}</p>
                                            </div>
                                            <span className="bg-green-50 text-green-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-green-200">Active</span>
                                        </div>
                                        <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                            A custom business landing page has been generated for your agency. You can visually edit any text elements directly in the preview pane, use the Conversational Editor to guide AI edits, or re-generate the homepage from scratch.
                                        </p>
                                        <div className="flex gap-2 pt-2">
                                            <button 
                                                onClick={() => {
                                                    setActiveEditorPage(bizPage)
                                                    setChatLogs([
                                                        { sender: 'ai', message: "Hi! I'm ready to update your business landing page. Click elements to edit them visually, or type what adjustments you'd like me to apply!" }
                                                    ])
                                                }}
                                                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black py-3 rounded-full transition-all text-center"
                                            >
                                                Edit Page (AI & Visual)
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    setPageProductName(subAccountName || '')
                                                    setPageContext('')
                                                    setSelectedPropertyId('')
                                                    setCustomInstructions('')
                                                    setSelectedFormId(bizPage.form_id || '')
                                                    setPageType('business')
                                                    setShowPageGenerator(true)
                                                }}
                                                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black py-3 rounded-full transition-all text-center"
                                            >
                                                Re-generate with AI
                                            </button>
                                        </div>
                                    </div>
                                )
                            } else {
                                return (
                                    <div className="space-y-4 text-center py-6">
                                        <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                                            <Sparkles size={22} className="text-blue-600" />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-black text-slate-800">Generate Custom Business Landing Page</h3>
                                            <p className="text-xs font-semibold text-slate-400 mt-1 max-w-[340px] mx-auto leading-relaxed">
                                                Create a premium, high-converting homepage showcasing your brand mission, services, active listings, and lead-capturing forms.
                                            </p>
                                        </div>
                                        <button 
                                            onClick={() => {
                                                setPageProductName(subAccountName || '')
                                                setPageContext('')
                                                setSelectedPropertyId('')
                                                setCustomInstructions('')
                                                setSelectedFormId('')
                                                setPageType('business')
                                                setShowPageGenerator(true)
                                            }}
                                            className="bg-slate-900 text-white font-extrabold text-xs px-6 py-3.5 rounded-full hover:bg-slate-800 transition-colors shadow-md shadow-slate-900/10 inline-flex items-center gap-2 active:scale-95"
                                        >
                                            <Sparkles size={14} className="text-purple-400" /> Generate Business Homepage
                                        </button>
                                    </div>
                                )
                            }
                        })()}
                    </div>
                </div>
            )}

            {/* MODAL: AI PAGE GENERATOR */}
            {showPageGenerator && (
                <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-6 sm:p-8 shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300 overflow-y-auto custom-scrollbar">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-6">
                            <h2 className="text-xl font-black text-slate-900">AI Landing Page Generator</h2>
                            <button onClick={() => setShowPageGenerator(false)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors">
                                <Plus className="rotate-45" size={18} />
                            </button>
                        </div>

                        {/* Scope Selection */}
                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Scope of Landing Page</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        setPageType('standard')
                                        setSelectedPropertyId('')
                                        setPageProductName('')
                                        setPageContext('')
                                    }}
                                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                                        pageType !== 'business' 
                                            ? 'bg-slate-900 text-white border-slate-900' 
                                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    Specific Product / Property
                                </button>
                                <button
                                    onClick={() => {
                                        setPageType('business')
                                        setSelectedPropertyId('')
                                        setPageProductName(subAccountName || '')
                                        setPageContext('')
                                    }}
                                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                                        pageType === 'business' 
                                            ? 'bg-slate-900 text-white border-slate-900' 
                                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    Entire Business Homepage
                                </button>
                            </div>
                        </div>

                        {/* Select Product from Inventory */}
                        {pageType !== 'business' && (
                            <div className="mb-6">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Select Product from Inventory</label>
                                <select 
                                    value={selectedPropertyId}
                                    onChange={e => {
                                        const val = e.target.value
                                        setSelectedPropertyId(val)
                                        if (val === '') {
                                            setPageProductName('')
                                            setPageContext('')
                                        } else {
                                            const found = properties.find(p => p.id === val)
                                            if (found) {
                                                setPageProductName(found.title || '')
                                                setPageContext(found.description || '')
                                            }
                                        }
                                    }}
                                    className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer"
                                >
                                    <option value="">Custom Product / Raw Input</option>
                                    {properties.map(p => (
                                        <option key={p.id} value={p.id}>{getPropertyDisplayLabel(p)}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Product/Business Name */}
                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">
                                {pageType === 'business' ? 'Business Name' : 'Product Name / Title'}
                            </label>
                            <input 
                                type="text"
                                value={pageProductName}
                                onChange={e => setPageProductName(e.target.value)}
                                placeholder={pageType === 'business' ? 'e.g. Homcom Realtors' : 'e.g. Homeland Regalia Luxury Apartments'}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                            />
                        </div>

                        {/* Product/Business Details context */}
                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">
                                {pageType === 'business' ? 'Business Description & Mission' : 'Product Details & Context'}
                            </label>
                            <textarea 
                                value={pageContext}
                                onChange={e => setPageContext(e.target.value)}
                                placeholder={pageType === 'business' ? 'Describe your business services, value proposition, areas served, and overall mission...' : 'Describe product details, location, pricing, special hooks, aesthetics, and premium benefits to guide the copywriting...'}
                                rows={4}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all resize-none leading-relaxed"
                            />
                        </div>

                        {/* Custom Instructions */}
                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Custom Instructions (Optional)</label>
                            <textarea 
                                value={customInstructions}
                                onChange={e => setCustomInstructions(e.target.value)}
                                placeholder="e.g. Focus on proximity to Mohali airport, maintain smart elegant dark gold theme, highlight gated safety..."
                                rows={3}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all resize-none leading-relaxed"
                            />
                        </div>

                        {/* Page Type Selection */}
                        {pageType !== 'business' && (
                            <div className="mb-6">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Generation Format / Type</label>
                                <select 
                                    value={pageType}
                                    onChange={e => setPageType(e.target.value as 'standard' | 'survey' | 'raw_survey')}
                                    className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer"
                                >
                                    <option value="standard">Standard Landing Page (Conversion Copy + Modal Form)</option>
                                    <option value="survey">Survey Form Only (Super Fast + Direct Inline Form)</option>
                                    <option value="raw_survey">Raw Survey Card (Photos + Form Callout, No extra info)</option>
                                </select>
                            </div>
                        )}

                        {/* Connect Form */}
                        <div className="mb-8">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Link Qualification Form</label>
                            <select 
                                value={selectedFormId}
                                onChange={e => setSelectedFormId(e.target.value)}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer"
                            >
                                <option value="">Select a Form (None - collects Name, WhatsApp, City only)</option>
                                {forms.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Submit */}
                        <button
                            onClick={handleGenerateLandingPage}
                            disabled={actionLoading}
                            className="bg-slate-900 text-white w-full py-4 rounded-full font-black text-sm shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 mt-auto shrink-0"
                        >
                            {actionLoading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} className="text-purple-400" />}
                            {actionLoading ? 'Asking Gemini to generate HTML...' : 'Generate High-Converting Landing Page'}
                        </button>
                    </div>
                </div>
            )}

            {/* ASSET PICKER DIALOG */}
            {isAssetPickerOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-2xl rounded-[2rem] border border-slate-100 shadow-2xl p-6 flex flex-col max-h-[80vh] overflow-hidden transform transition-all scale-100 animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                            <div>
                                <h3 className="text-base font-black text-slate-800">Select Image from Assets</h3>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Click on creatives to toggle select</p>
                            </div>
                            <button 
                                onClick={() => setIsAssetPickerOpen(false)}
                                className="bg-slate-50 p-2 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-500 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-hide">
                            {loadingAssets ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                                    <Loader2 className="animate-spin text-blue-500 w-8 h-8" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Loading assets...</span>
                                </div>
                            ) : existingAssets.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                                    <ImageIcon size={32} />
                                    <span className="text-xs font-bold uppercase tracking-wider">No assets found</span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                    {existingAssets.map((asset) => {
                                        const isSelected = attachments.some(a => a.url === asset.url);
                                        return (
                                            <div 
                                                key={asset.id}
                                                onClick={() => handleToggleAsset(asset.url)}
                                                className={`relative rounded-2xl overflow-hidden border-2 cursor-pointer transition-all aspect-[4/5] shadow-sm group ${
                                                    isSelected ? 'border-blue-600 ring-4 ring-blue-500/10 scale-[0.98]' : 'border-slate-100 hover:border-slate-300'
                                                }`}
                                            >
                                                <img 
                                                    src={asset.url} 
                                                    alt={asset.caption || 'Asset'} 
                                                    className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" 
                                                />
                                                {/* Checkbox overlay */}
                                                <div className={`absolute inset-0 flex items-center justify-center transition-all ${
                                                    isSelected ? 'bg-blue-900/10' : 'bg-transparent'
                                                }`}>
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg border border-white transition-all transform ${
                                                        isSelected ? 'bg-blue-600 text-white scale-100' : 'bg-white/80 text-slate-500 scale-90 opacity-0 group-hover:opacity-100'
                                                    }`}>
                                                        <Check size={16} />
                                                    </div>
                                                </div>
                                                {/* Title watermark */}
                                                {asset.caption && (
                                                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-6 text-[10px] text-white font-medium truncate">
                                                        {asset.caption}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="border-t border-slate-100 pt-4 mt-4 flex justify-end">
                            <button
                                onClick={() => setIsAssetPickerOpen(false)}
                                className="bg-slate-900 text-white font-extrabold hover:bg-slate-800 text-xs px-6 py-3 rounded-full shadow-md shadow-slate-900/10 active:scale-95 transition-all"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
