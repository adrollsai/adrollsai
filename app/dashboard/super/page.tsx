/* adrollsai/adrollsai/adrollsai-builder-app-gamification/app/dashboard/super/page.tsx */

'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Loader2, Plus, Trash2, Shield, Play, CheckCircle, Building2, ExternalLink, FileText } from 'lucide-react'

// Types
type Organization = { id: string; name: string; created_at: string }
type Property = { id: string; title: string }
type CreativePrompt = {
    id: string
    organization_id: string
    property_id?: string | null
    prompt_text: string
    is_used: boolean
    created_at: string
    used_at?: string
    property?: { title: string } // Joined data
}

export default function SuperAdminPage() {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Data
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [prompts, setPrompts] = useState<CreativePrompt[]>([])
  
  // Selection
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null)
  const [selectedProperty, setSelectedProperty] = useState<string>("") 
  const [newPromptText, setNewPromptText] = useState('')

  // 1. Fetch Orgs
  useEffect(() => {
    const fetchOrgs = async () => {
        const { data } = await supabase.from('organizations').select('id, name, created_at').order('created_at', { ascending: false })
        if (data) setOrgs(data)
        setLoading(false)
    }
    fetchOrgs()
  }, [])

  // 2. Fetch Details when Org Selected
  useEffect(() => {
    if (selectedOrg) {
        fetchProperties(selectedOrg)
        fetchPrompts(selectedOrg)
    } else {
        setProperties([])
        setPrompts([])
    }
  }, [selectedOrg])

  const fetchProperties = async (orgId: string) => {
      const { data } = await supabase.from('properties').select('id, title').eq('organization_id', orgId).order('created_at', { ascending: false })
      if (data) setProperties(data)
  }

  const fetchPrompts = async (orgId: string) => {
    // @ts-ignore
    const { data } = await supabase
      .from('creative_prompts')
      .select('*, property:properties(title)')
      .eq('organization_id', orgId)
      .order('is_used', { ascending: true })
      .order('created_at', { ascending: false })
    
    if (data) setPrompts(data as any)
  }

  // 3. Add Prompt (Single)
  const handleAddPrompt = async () => {
    if (!selectedOrg || !newPromptText.trim()) return
    setIsSubmitting(true)

    const insert = {
        organization_id: selectedOrg,
        property_id: selectedProperty || null, 
        prompt_text: newPromptText.trim(),
        is_used: false
    }

    // @ts-ignore
    const { error } = await supabase.from('creative_prompts').insert([insert])
    
    if (!error) {
        setNewPromptText('')
        fetchPrompts(selectedOrg)
    } else {
        alert("Error: " + error.message)
    }
    setIsSubmitting(false)
  }

  // 4. Bulk Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file || !selectedOrg) return

      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim() !== '')

      if (lines.length === 0) return

      setIsSubmitting(true)
      // @ts-ignore
      const inserts = lines.map(line => ({
        organization_id: selectedOrg,
        property_id: selectedProperty || null,
        prompt_text: line.trim(),
        is_used: false
      }))

      // @ts-ignore
      const { error } = await supabase.from('creative_prompts').insert(inserts)
      if (!error) {
          alert(`Successfully uploaded ${lines.length} prompts from file.`)
          fetchPrompts(selectedOrg)
          if(fileInputRef.current) fileInputRef.current.value = '' 
      } else {
          alert("Error uploading file: " + error.message)
      }
      setIsSubmitting(false)
  }

  const handleDeletePrompt = async (id: string) => {
    if(!confirm("Delete this prompt?")) return
    // @ts-ignore
    await supabase.from('creative_prompts').delete().eq('id', id)
    if (selectedOrg) fetchPrompts(selectedOrg)
  }

  // 5. TRIGGER AUTOMATION (FIXED ERROR HANDLING)
  const triggerAutomation = async (orgId: string) => {
      if(!confirm("Force run automation? This uses 1 credit.")) return
      setIsSubmitting(true)
      try {
        const res = await fetch(`/api/cron/daily-creative?force_org=${orgId}`)
        const data = await res.json()
        
        // Check the actual RESULTS array
        if (data.results && data.results.length > 0) {
            const result = data.results[0]
            if (result.status === 'Success') {
                alert(`✅ Success! Asset created for ${result.org}.`)
            } else {
                // Show the REAL error message from the backend
                alert(`❌ Failed: ${result.status} \nDetails: ${JSON.stringify(result.error || '')}`)
            }
        } else {
            alert("❌ Failed: No results returned from automation engine.")
        }

        fetchPrompts(orgId)
      } catch (e: any) {
          alert("❌ Network Error: " + e.message)
      } finally { setIsSubmitting(false) }
  }

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 pb-32">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
            <div className="bg-purple-600 text-white p-2.5 rounded-xl shadow-lg shadow-purple-200">
                <Shield size={24} />
            </div>
            <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Super User Console</h1>
                <p className="text-xs text-slate-500 font-medium">Manage organizations & automated creative pipelines</p>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* LEFT: Orgs List */}
            <div className="md:col-span-3 bg-white rounded-3xl p-5 shadow-sm border border-slate-100 h-[80vh] flex flex-col">
                <h2 className="font-bold text-slate-400 text-xs uppercase tracking-wider mb-4 ml-1">Organizations</h2>
                <div className="space-y-2 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                    {orgs.map(org => (
                        <div 
                            key={org.id} 
                            onClick={() => setSelectedOrg(org.id)}
                            className={`p-4 rounded-2xl cursor-pointer transition-all border group relative ${selectedOrg === org.id ? 'bg-purple-50 border-purple-200 ring-1 ring-purple-200 shadow-sm' : 'bg-white border-slate-100 hover:border-purple-100'}`}
                        >
                            <div>
                                <p className="font-bold text-sm text-slate-800">{org.name}</p>
                                <p className="text-[10px] text-slate-400 truncate mt-0.5">{org.id}</p>
                            </div>

                            <a 
                                href={`/dashboard?impersonate_org=${org.id}`}
                                target="_blank"
                                onClick={(e) => e.stopPropagation()} 
                                className={`absolute top-3 right-3 bg-slate-900 text-white text-[10px] font-bold px-2 py-1.5 rounded-lg transition-all flex items-center gap-1 shadow-md ${selectedOrg === org.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                title="Login as Admin"
                            >
                                Login <ExternalLink size={10} />
                            </a>
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT: Manager Panel */}
            <div className="md:col-span-9 flex flex-col gap-6 h-[80vh]">
                {selectedOrg ? (
                    <>
                        {/* INPUT BOX */}
                        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex-shrink-0">
                            
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-bold text-slate-900 flex items-center gap-2 text-lg">
                                        <Plus size={20} className="text-purple-600"/> Add Prompt
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-1">Add a single prompt (newlines allowed) or upload a bulk file.</p>
                                </div>
                                <div className="flex gap-2">
                                    <a 
                                        href={`/dashboard?impersonate_org=${selectedOrg}`}
                                        target="_blank"
                                        className="text-[10px] bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-full font-bold flex items-center gap-1.5 transition-all"
                                    >
                                        <ExternalLink size={10}/> View Dashboard
                                    </a>

                                    <button 
                                        onClick={() => triggerAutomation(selectedOrg)}
                                        disabled={isSubmitting}
                                        className="text-[10px] bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-full font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                                    >
                                        {isSubmitting ? <Loader2 size={10} className="animate-spin"/> : <Play size={10} fill="currentColor"/>} 
                                        Run Automation
                                    </button>
                                </div>
                            </div>

                            {/* Project Selector */}
                            <div className="mb-4 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block ml-1">
                                    Target Project (Required for Images)
                                </label>
                                <div className="relative">
                                    <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                    <select 
                                        value={selectedProperty}
                                        onChange={(e) => setSelectedProperty(e.target.value)}
                                        className="w-full pl-9 pr-4 py-3 rounded-xl bg-white border border-slate-200 text-sm font-medium focus:ring-2 focus:ring-purple-100 outline-none appearance-none"
                                    >
                                        <option value="">-- Auto-Select Latest Project --</option>
                                        {properties.map(p => (
                                            <option key={p.id} value={p.id}>{p.title}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            
                            {/* Prompt Input Area */}
                            <div className="relative">
                                <textarea 
                                    value={newPromptText}
                                    onChange={(e) => setNewPromptText(e.target.value)}
                                    placeholder="Enter your detailed prompt here...&#10;Lines will be preserved."
                                    className="w-full bg-slate-50 p-4 rounded-2xl text-sm border-2 border-transparent focus:border-purple-100 focus:bg-white focus:ring-4 focus:ring-purple-50/50 outline-none transition-all h-32 resize-none"
                                />
                            </div>
                            
                            <div className="flex justify-between mt-4">
                                {/* BULK UPLOAD BUTTON */}
                                <div>
                                    <input 
                                        type="file" 
                                        ref={fileInputRef}
                                        accept=".txt" 
                                        onChange={handleFileUpload} 
                                        className="hidden"
                                    />
                                    <button 
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isSubmitting}
                                        className="text-slate-500 hover:text-slate-800 text-xs font-bold flex items-center gap-2 py-2 px-3 hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                        <FileText size={16}/> Upload Bulk (.txt)
                                    </button>
                                </div>

                                {/* ADD SINGLE BUTTON */}
                                <button 
                                    onClick={handleAddPrompt}
                                    disabled={!newPromptText.trim() || isSubmitting}
                                    className="bg-purple-600 text-white px-8 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-purple-700 active:scale-95 transition-all disabled:opacity-50"
                                >
                                    <Plus size={16} /> Add Single Prompt
                                </button>
                            </div>
                        </div>

                        {/* QUEUE LIST */}
                        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex-1 overflow-hidden flex flex-col">
                            <h3 className="font-bold text-slate-900 mb-4 flex-shrink-0">Queue Status</h3>
                            <div className="space-y-3 overflow-y-auto pr-2 flex-1 custom-scrollbar">
                                {prompts.length === 0 && <div className="text-center py-10 text-slate-400 text-xs">Queue is empty.</div>}
                                {prompts.map(prompt => (
                                    <div key={prompt.id} className={`p-4 rounded-2xl border flex items-start gap-4 ${prompt.is_used ? 'bg-slate-50 opacity-60' : 'bg-white border-purple-100'}`}>
                                        <div className="mt-1">
                                            {prompt.is_used ? <CheckCircle size={18} className="text-slate-300"/> : <div className="w-4 h-4 rounded-full border-2 border-green-500 bg-green-100"/>}
                                        </div>
                                        <div className="flex-1">
                                            {/* Render prompt preserving whitespace for checking */}
                                            <p className={`text-sm whitespace-pre-wrap ${prompt.is_used ? 'line-through text-slate-400' : 'text-slate-700 font-medium'}`}>{prompt.prompt_text}</p>
                                            <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                                                {prompt.property && (
                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-bold flex items-center gap-1">
                                                        <Building2 size={8}/> {prompt.property.title}
                                                    </span>
                                                )}
                                                <span>{prompt.is_used ? 'Used' : 'Pending'}</span>
                                            </div>
                                        </div>
                                        <button onClick={() => handleDeletePrompt(prompt.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16}/></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="h-full flex items-center justify-center text-slate-400">Select an Organization</div>
                )}
            </div>
        </div>
      </div>
    </div>
  )
}