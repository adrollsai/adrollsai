'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
    Globe, Plus, Trash2, Edit3, Eye, Copy, Check, MessageSquare, 
    Sparkles, ArrowRight, Loader2, List, Clipboard, ArrowLeft, Send
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

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
    created_at: string
}

export default function PagesDashboard() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const supabase = createClient()
    const impersonateId = searchParams.get('impersonate')

    // Tab state: 'landing_pages' | 'forms'
    const [activeTab, setActiveTab] = useState<'landing_pages' | 'forms'>('landing_pages')
    
    // Core States
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [successMessage, setSuccessMessage] = useState('')
    const [errorMessage, setErrorMessage] = useState('')
    const [copiedId, setCopiedId] = useState<string | null>(null)

    // Data lists
    const [forms, setForms] = useState<QualificationForm[]>([])
    const [landingPages, setLandingPages] = useState<LandingPage[]>([])

    // Impersonation Profile resolver
    const [subAccountName, setSubAccountName] = useState('')
    const [targetUserId, setTargetUserId] = useState('')
    const [customDomain, setCustomDomain] = useState('')

    // Form builder state
    const [showFormModal, setShowFormModal] = useState(false)
    const [formName, setFormName] = useState('')
    const [formQuestions, setFormQuestions] = useState<CustomQuestion[]>([])
    const [editingFormId, setEditingFormId] = useState<string | null>(null)
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

    // Edit/Chat Console state
    const [activeEditorPage, setActiveEditorPage] = useState<LandingPage | null>(null)
    const [chatInput, setChatInput] = useState('')
    const [chatLogs, setChatLogs] = useState<{ sender: 'user' | 'ai', message: string }[]>([
        { sender: 'ai', message: "Hi! I am your Landing Page Assistant. Tell me what changes you'd like to make to the generated landing page (e.g. 'Make the buttons larger and glowing', 'change background to premium dark mode')." }
    ])

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
            const { data: caller } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', session.user.id).single()
            let resolvedId = session.user.id

            // Resolve target client account if impersonating
            if (impersonateId && ['super_admin', 'agency', 'admin'].includes(caller?.role || '')) {
                const { data: clientProfile } = await supabase.from('profiles').select('id, business_name, custom_domain').eq('id', impersonateId).single()
                if (clientProfile) {
                    resolvedId = clientProfile.id
                    setSubAccountName(clientProfile.business_name || 'Client')
                    setCustomDomain(clientProfile.custom_domain || '')
                }
            } else {
                const { data: ownProfile } = await supabase.from('profiles').select('business_name, custom_domain').eq('id', session.user.id).single()
                if (ownProfile) {
                    setCustomDomain(ownProfile.custom_domain || '')
                }
            }

            setTargetUserId(resolvedId)
            await fetchListData(resolvedId)
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
            setForms(formsData || [])

            // Load landing pages
            const { data: pagesData, error: pagesErr } = await supabase
                .from('landing_pages')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
            if (pagesErr) throw pagesErr
            setLandingPages(pagesData || [])

            // Load properties inventory
            const { data: propertiesData, error: propertiesErr } = await supabase
                .from('properties')
                .select('id, title, description')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
            if (propertiesErr) throw propertiesErr
            setProperties(propertiesData || [])
        } catch (e: any) {
            setErrorMessage("Failed to load dashboard data: " + e.message)
        } finally {
            setLoading(false)
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
        setFormQuestions([...formQuestions, newQ])
        setNewQuestionLabel('')
        setNewQuestionOptions('')
        setNewDisqualifyOptions('')
        setNewDisqualifyMessage('')
    }

    const handleRemoveQuestion = (idx: number) => {
        setFormQuestions(formQuestions.filter((_, i) => i !== idx))
    }

    const handleEditFormClick = (form: QualificationForm) => {
        setEditingFormId(form.id)
        setFormName(form.name)
        setFormQuestions(form.custom_questions || [])
        setShowFormModal(true)
    }

    const handleOpenNewFormModal = () => {
        setEditingFormId(null)
        setFormName('')
        setFormQuestions([])
        setShowFormModal(true)
    }

    const handleCreateForm = async () => {
        if (!formName.trim()) {
            showToast("Please enter a name for the qualification form.", 'error')
            return
        }

        setActionLoading(true)
        try {
            const defaultFields: FormField[] = [
                { name: 'name', type: 'text', label: 'Full Name' },
                { name: 'phone', type: 'tel', label: 'WhatsApp Number' },
                { name: 'city', type: 'text', label: 'City' }
            ]

            if (editingFormId) {
                const { error } = await supabase
                    .from('qualification_forms')
                    .update({
                        name: formName.trim(),
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
                        fields: defaultFields,
                        custom_questions: formQuestions
                    })

                if (error) throw error
                showToast(`Form "${formName}" created successfully!`)
            }

            setFormName('')
            setFormQuestions([])
            setEditingFormId(null)
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
        if (!pageProductName.trim() && !selectedPropertyId) {
            showToast("Please enter a product name or select a property from your inventory.", 'error')
            return
        }

        setActionLoading(true)
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
                    mode: 'generate'
                })
            })

            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || "Generation failed")

            showToast(`Landing page for "${pageProductName || 'your property'}" created successfully!`)
            setPageProductName('')
            setPageContext('')
            setSelectedPropertyId('')
            setCustomInstructions('')
            setSelectedFormId('')
            setShowPageGenerator(false)
            
            // Auto open the newly generated page in the preview editor
            if (resData.page) {
                setActiveEditorPage(resData.page)
                setChatLogs([
                    { sender: 'ai', message: `Awesome! Landing page for "${resData.page.product_name}" generated with slug "/${resData.page.slug}". Inspect the live preview on the right side and type any modifications you need in this chat console!` }
                ])
            }
            await fetchListData(targetUserId)
        } catch (e: any) {
            showToast(e.message, 'error')
        } finally {
            setActionLoading(false)
        }
    }

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

    // --- 5. CONVERSATIONAL EDIT CHAT Console ---
    const handleSendChatEdit = async () => {
        if (!chatInput.trim() || !activeEditorPage) return
        
        const userMsg = chatInput.trim()
        setChatInput('')
        setChatLogs(prev => [...prev, { sender: 'user', message: userMsg }])
        setActionLoading(true)

        try {
            const endpoint = impersonateId 
                ? `/api/landing-page/generate?impersonate=${impersonateId}` 
                : `/api/landing-page/generate`

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productName: activeEditorPage.product_name,
                    formId: activeEditorPage.form_id,
                    mode: 'edit',
                    instructions: userMsg,
                    currentHtml: activeEditorPage.html_content
                })
            })

            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || "Edit failed")

            if (resData.page) {
                setActiveEditorPage(resData.page)
                setChatLogs(prev => [...prev, { sender: 'ai', message: "I have successfully modified the styling and layout according to your request! You can inspect the updated preview now." }])
                // Refresh list
                await fetchListData(targetUserId)
            }
        } catch(e: any) {
            setChatLogs(prev => [...prev, { sender: 'ai', message: `❌ Edit Failed: ${e.message}. Please try again.` }])
        } finally {
            setActionLoading(false)
        }
    }

    const copyUrl = (slug: string, id: string) => {
        const domainBase = customDomain || `app.adrolls.in/shared/${targetUserId}`
        const fullUrl = `https://${domainBase}/${slug}`
        navigator.clipboard.writeText(fullUrl)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const getPreviewHtml = (page: LandingPage) => {
        let html = page.html_content
        const form = forms.find(f => f.id === page.form_id)
        
        let formHtml = `
            <div style="max-width: 500px; margin: 2rem auto; padding: 2rem; background: #ffffff; border-radius: 1.5rem; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); font-family: system-ui, -apple-system, sans-serif; text-align: left;">
                <h3 style="margin-top: 0; margin-bottom: 1.5rem; color: #0f172a; font-size: 1.5rem; font-weight: 800; text-align: center; letter-spacing: -0.025em;">Get Instant Details</h3>
                <div style="margin-bottom: 1.25rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">Full Name</label>
                    <input type="text" disabled placeholder="John Doe" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box;" />
                </div>
                <div style="margin-bottom: 1.25rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">WhatsApp Number</label>
                    <input type="tel" disabled placeholder="+91 98765 43210" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box;" />
                </div>
                <div style="margin-bottom: 1.25rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">City</label>
                    <input type="text" disabled placeholder="Mohali" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box;" />
                </div>
        `

        if (form) {
            const customQuestions = form.custom_questions || []
            customQuestions.forEach((q: any, index: number) => {
                formHtml += `
                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">${q.label}</label>
                `
                if (q.type === 'MULTIPLE_CHOICE') {
                    formHtml += `<select disabled style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; background: #fff;">`
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
                    formHtml += `<input type="text" disabled placeholder="Your answer" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box;" />`
                }
                formHtml += `</div>`
            })
        }

        formHtml += `
                <button disabled style="width: 100%; padding: 0.875rem; background: #2563eb; color: #ffffff; border: none; border-radius: 0.75rem; font-size: 0.875rem; font-weight: 700; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2); cursor: not-allowed;">Submit & Continue (Form Preview)</button>
            </div>
        `

        const containerRegex = /<div\s+[^>]*id="qualification-form-container"[^>]*>([\s\S]*?)<\/div>/gi
        if (html.match(containerRegex)) {
            html = html.replace(containerRegex, formHtml)
        } else if (html.includes('</body>')) {
            html = html.replace('</body>', `<div style="max-width: 600px; margin: 4rem auto; padding: 0 1rem;">${formHtml}</div></body>`)
        } else {
            html = `${html}<div style="max-width: 600px; margin: 4rem auto; padding: 0 1rem;">${formHtml}</div>`
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
                                onClick={() => { setActiveEditorPage(null); setShowPageGenerator(true) }}
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
                <div className="max-w-7xl mx-auto bg-white border border-slate-200 rounded-[2.5rem] p-6 shadow-xl flex flex-col lg:flex-row gap-6 h-[80vh] overflow-hidden animate-in zoom-in-95 duration-300">
                    
                    {/* Left Pane: Conversation console */}
                    <div className="w-full lg:w-[400px] flex flex-col h-full bg-slate-50 border border-slate-200 rounded-[2rem] p-4">
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
                                    {log.message}
                                </div>
                            ))}
                            {actionLoading && (
                                <div className="bg-white text-slate-800 border border-slate-200 rounded-2xl rounded-tl-none p-3 text-xs flex items-center gap-2 self-start mr-auto shadow-sm">
                                    <Loader2 className="animate-spin text-blue-500 w-4 h-4" /> Asking Gemini to update landing page styles...
                                </div>
                            )}
                        </div>

                        {/* Input bar */}
                        <div className="mt-3 flex gap-2">
                            <input 
                                type="text"
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && !actionLoading && handleSendChatEdit()}
                                disabled={actionLoading}
                                placeholder="Change layout styles..."
                                className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 transition-all"
                            />
                            <button
                                onClick={handleSendChatEdit}
                                disabled={actionLoading || !chatInput.trim()}
                                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-3 shadow-md shadow-blue-500/10 active:scale-95 disabled:opacity-50 flex items-center justify-center transition-all"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Right Pane: Live iFrame Preview */}
                    <div className="flex-1 flex flex-col h-full bg-slate-50 border border-slate-200 rounded-[2rem] p-4 relative overflow-hidden">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0"></span>
                                <span className="text-xs font-bold text-slate-600 truncate">
                                    {`https://${customDomain || `app.adrolls.in/shared/${targetUserId}`}/${activeEditorPage.slug}`}
                                </span>
                            </div>
                            
                            <button
                                onClick={() => copyUrl(activeEditorPage.slug, activeEditorPage.id)}
                                className="bg-white px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-600 text-[10px] font-black flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                            >
                                {copiedId === activeEditorPage.id ? <Check size={12} className="text-green-600" /> : <Copy size={12} />} 
                                {copiedId === activeEditorPage.id ? 'Copied' : 'Copy URL'}
                            </button>
                        </div>

                        <div className="flex-1 rounded-[1.5rem] overflow-hidden border border-slate-200 shadow-inner relative bg-white">
                            <iframe 
                                srcDoc={getPreviewHtml(activeEditorPage)} 
                                className="w-full h-full border-none"
                            />
                        </div>
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
                                        onClick={() => setShowPageGenerator(true)}
                                        className="mt-6 bg-slate-900 text-white font-extrabold text-xs px-5 py-3 rounded-full hover:bg-slate-800 transition-colors shadow-md shadow-slate-900/10 inline-flex items-center gap-2 active:scale-95"
                                    >
                                        <Sparkles size={14} className="text-purple-400" /> Generate First Page
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {landingPages.map((page) => (
                                        <div key={page.id} className="bg-white border border-slate-200/60 rounded-[2rem] p-5 shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col h-full border-t-4 border-t-blue-500">
                                            <h3 className="text-lg font-black text-slate-800 leading-tight mb-2 line-clamp-1">{page.product_name}</h3>
                                            <p className="text-xs font-semibold text-slate-400 line-clamp-2 leading-relaxed mb-4">{page.title}</p>
                                            
                                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 flex items-center justify-between mb-4 shrink-0 min-w-0 gap-3">
                                                <span className="text-[10px] font-bold text-slate-500 truncate select-all">{`/${page.slug}`}</span>
                                                
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
                                                        const domainBase = customDomain || `app.adrolls.in/shared/${targetUserId}`
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

                        {/* Defaults Alert */}
                        <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 mb-6 text-xs text-slate-500 font-semibold leading-relaxed">
                            💡 Name, WhatsApp Number, and City fields are automatically included as standard required fields.
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
                                            <button onClick={() => handleRemoveQuestion(idx)} className="text-slate-400 hover:text-red-500 p-1 transition-colors">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Question adder */}
                        <div className="border-t border-slate-100 pt-6 mb-8">
                            <h4 className="text-xs font-black text-slate-700 mb-4">Add Custom Question</h4>
                            
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
                                    
                                    <button 
                                        onClick={handleAddQuestion}
                                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs px-5 rounded-xl transition-all"
                                    >
                                        Add Question
                                    </button>
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

                        {/* Select Product from Inventory */}
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
                                    <option key={p.id} value={p.id}>{p.title}</option>
                                ))}
                            </select>
                        </div>

                        {/* Product Name */}
                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Product Name / Title</label>
                            <input 
                                type="text"
                                value={pageProductName}
                                onChange={e => setPageProductName(e.target.value)}
                                placeholder="e.g. Homeland Regalia Luxury Apartments"
                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                            />
                        </div>

                        {/* Product Details context */}
                        <div className="mb-6">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Product Details & Context</label>
                            <textarea 
                                value={pageContext}
                                onChange={e => setPageContext(e.target.value)}
                                placeholder="Describe product details, location, pricing, special hooks, aesthetics, and premium benefits to guide the copywriting..."
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

        </div>
    )
}
