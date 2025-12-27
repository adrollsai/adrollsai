'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, Plus, Trash2, Check, Loader2, Image as ImageIcon, Grid, X, Search, RefreshCw, AlertCircle, Mail, Phone, MapPin, User, ChevronRight, Download, StopCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'

// --- TYPES ---
type Agent = {
  id?: string
  business_name: string
  contact_number: string
  logo_url: string
  address?: string
  email?: string 
}

type Asset = {
    id: string
    url: string
    type: 'image' | 'video'
    status?: string 
}

type BatchItem = {
    id: string
    agent_data: any
    status: string
    result_url: string | null
    email_sent: boolean
    error_message: string | null
    created_at: string
}

export default function DistributePage() {
  const supabase = createClient()
  
  // --- STATE ---
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [activeTab, setActiveTab] = useState<'manage' | 'distribute'>('manage')
  
  // Manage Form State
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('') 
  const [newLogo, setNewLogo] = useState<File | null>(null)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)
  
  // Distribute State
  const [masterImage, setMasterImage] = useState<string | null>(null)
  const [sendEmails, setSendEmails] = useState(true) 
  
  // Job / Batch State
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState({ total: 0, completed: 0, status: 'idle' })
  const [batchResults, setBatchResults] = useState<BatchItem[]>([]) 

  // Asset Modal State
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [userAssets, setUserAssets] = useState<Asset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- HELPER: URL Fixer ---
  const fixUrl = (url: string | null) => {
    if (!url) return ''
    if (url.includes('r2.dev') && !url.includes('/adrolls-storage/')) {
        return url.replace('.r2.dev/', '.r2.dev/adrolls-storage/')
    }
    return url
  }

  // --- INITIAL LOAD ---
  useEffect(() => {
    const init = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // 1. Load Agents
        const { data: agentData } = await supabase.from('external_agents').select('*').order('created_at', { ascending: false })
        if (agentData) setAgents(agentData)
        setLoading(false)

        // 2. Check for Active Batch
        const { data: activeBatch } = await supabase
            .from('distribution_batches')
            .select('*')
            .eq('user_id', user.id)
            .in('status', ['pending', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        if (activeBatch) {
            setActiveBatchId(activeBatch.id)
            setBatchProgress({
                total: activeBatch.total_count,
                completed: activeBatch.completed_count,
                status: activeBatch.status
            })
            // If job is running, go to distribute tab
            setActiveTab('distribute')
            
            if (activeBatch.master_image_url) {
                setMasterImage(activeBatch.master_image_url)
            }
        }
    }
    init()
  }, [])

  // --- POLLING EFFECT (Background Job Tracking) ---
  useEffect(() => {
    let interval: any
    
    const pollBatch = async () => {
        if (!activeBatchId) return

        // 1. Get Batch Status
        const { data: batch } = await supabase
            .from('distribution_batches')
            .select('*')
            .eq('id', activeBatchId)
            .single()
        
        if (batch) {
            setBatchProgress({
                total: batch.total_count,
                completed: batch.completed_count,
                status: batch.status
            })

            // 2. Get Completed Items (Live Results)
            const { data: items } = await supabase
                .from('distribution_items')
                .select('*')
                .eq('batch_id', activeBatchId)
                .neq('status', 'pending') 
                .order('created_at', { ascending: false })
            
            if (items) {
                setBatchResults(items)
            }

            // Stop polling if complete or failed
            if (batch.status === 'completed' || batch.status === 'failed') {
                clearInterval(interval)
            }
        }
    }

    if (activeBatchId && batchProgress.status !== 'completed' && batchProgress.status !== 'failed') {
        pollBatch() 
        interval = setInterval(pollBatch, 2000) 
    }

    return () => clearInterval(interval)
  }, [activeBatchId, batchProgress.status])


  // --- DATA FETCHING ---
  const fetchAgents = async () => {
    const { data } = await supabase.from('external_agents').select('*').order('created_at', { ascending: false })
    if (data) setAgents(data)
  }

  const fetchAssets = async () => {
    setLoadingAssets(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    
    const { data } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', user.id)
        .eq('type', 'image')
        .order('created_at', { ascending: false })

    if (data) {
        const cleanAssets = data.filter(asset => asset.status !== 'Distributed')
        setUserAssets(cleanAssets)
    }
    setLoadingAssets(false)
  }

  // --- ACTIONS: MANAGE AGENTS ---
  const handleAddAgent = async () => {
    if (!newName || !newPhone) return alert("Name and Phone are required")
    setProcessing(true)
    
    try {
        let logoUrl = ''
        if (newLogo) {
            setIsUploadingLogo(true)
            logoUrl = await uploadToR2(newLogo, 'agent-logos')
            setIsUploadingLogo(false)
        }

        const { error } = await supabase.from('external_agents').insert({
            business_name: newName,
            contact_number: newPhone,
            email: newEmail, 
            logo_url: logoUrl
        })

        if (error) throw error
        
        setNewName('')
        setNewPhone('')
        setNewEmail('')
        setNewLogo(null)
        fetchAgents()
    } catch (e: any) {
        alert("Error adding agent: " + e.message)
    } finally {
        setProcessing(false)
        setIsUploadingLogo(false)
    }
  }

  const handleUploadCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = async (event) => {
        const text = event.target?.result as string
        const lines = text.split('\n').slice(1) // Skip header
        
        const newAgents = []
        for (const line of lines) {
            const [name, phone, email, logo, address] = line.split(',')
            if (name && phone) {
                newAgents.push({
                    business_name: name.trim(),
                    contact_number: phone.trim(),
                    email: email?.trim() || '', 
                    logo_url: logo?.trim() || '',
                    address: address?.trim() || ''
                })
            }
        }
        
        if (newAgents.length > 0) {
            setProcessing(true)
            const { error } = await supabase.from('external_agents').insert(newAgents)
            setProcessing(false)
            if (error) {
                alert("CSV Import Error: " + error.message)
            } else {
                fetchAgents()
                alert(`Successfully imported ${newAgents.length} agents`)
            }
        }
    }
    reader.readAsText(file)
  }

  const handleDelete = async (id: string) => {
    if(!confirm("Are you sure you want to remove this agent?")) return
    await supabase.from('external_agents').delete().eq('id', id)
    setAgents(agents.filter(a => a.id !== id))
  }

  // --- ACTIONS: DISTRIBUTE ---
  const handleNewMasterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setProcessing(true)
      try {
          const url = await uploadToR2(file, 'creatives')
          setMasterImage(url)
      } catch (e) { alert("Upload failed") }
      finally { setProcessing(false) }
  }

  const handleDistribute = async () => {
    if (!masterImage) return alert("Please select a master image")
    if (agents.length === 0) return alert("No agents to distribute to")
    
    setProcessing(true)
    setBatchResults([]) 
    
    try {
        const res = await fetch('/api/distribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                masterImageUrl: fixUrl(masterImage),
                agents: agents.map(a => ({ ...a, logo_url: fixUrl(a.logo_url) })),
                sendEmail: sendEmails 
            })
        })
        const data = await res.json()
        if (data.success) {
            setActiveBatchId(data.batchId)
            setBatchProgress({ total: agents.length, completed: 0, status: 'pending' })
            alert("Distribution started! You can scroll down to see results appearing.")
        } else {
            alert("Error: " + data.error)
        }
    } catch (e) {
        alert("Network Error")
    } finally {
        setProcessing(false)
    }
  }

  // --- NEW: Cancel Stuck Batch ---
  const handleCancelBatch = async () => {
      if (!activeBatchId) return
      if (!confirm("Stop monitoring this batch? This effectively cancels it from your view.")) return

      // Update DB so it doesn't auto-load again
      await supabase.from('distribution_batches').update({ status: 'failed' }).eq('id', activeBatchId)
      
      setActiveBatchId(null)
      setBatchProgress({ total: 0, completed: 0, status: 'idle' })
      setBatchResults([])
  }

  return (
    <div className="p-6 max-w-5xl mx-auto pb-32">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Distribution Center</h1>
                <p className="text-slate-500 mt-1">Manage your agent network and distribute personalized marketing assets.</p>
            </div>
            {/* Tab Switcher */}
            <div className="bg-slate-100 p-1 rounded-xl flex">
                <button 
                    onClick={() => setActiveTab('manage')} 
                    className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${activeTab === 'manage' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Manage Agents
                </button>
                <button 
                    onClick={() => setActiveTab('distribute')} 
                    className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${activeTab === 'distribute' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Distribute Graphics
                </button>
            </div>
        </div>

        {/* --- TAB: MANAGE LIST --- */}
        {activeTab === 'manage' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Add Agent Form */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Plus size={18} className="text-blue-600"/> Add New Agent</h3>
                    <div className="flex gap-4 items-end flex-wrap">
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Business Name</label>
                            <div className="relative">
                                <User size={16} className="absolute left-3 top-3 text-slate-400" />
                                <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full pl-9 border border-slate-200 bg-slate-50 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Agent Name" />
                            </div>
                        </div>
                        <div className="flex-1 min-w-[160px]">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Phone Number</label>
                            <div className="relative">
                                <Phone size={16} className="absolute left-3 top-3 text-slate-400" />
                                <input value={newPhone} onChange={e => setNewPhone(e.target.value)} className="w-full pl-9 border border-slate-200 bg-slate-50 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="1234567890" />
                            </div>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Email Address</label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3 top-3 text-slate-400" />
                                <input value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full pl-9 border border-slate-200 bg-slate-50 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="agent@email.com" />
                            </div>
                        </div>
                        <div className="w-[120px]">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Logo (Opt)</label>
                            <div className="relative overflow-hidden">
                                <input type="file" onChange={e => setNewLogo(e.target.files?.[0] || null)} className="w-full text-[10px] file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                            </div>
                        </div>
                        
                        <button onClick={handleAddAgent} disabled={processing} className="bg-slate-900 text-white px-6 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200 disabled:opacity-70 disabled:cursor-not-allowed h-[42px]">
                            {processing ? <Loader2 className="animate-spin" size={16} /> : <Plus size={18} />} 
                            <span>Add</span>
                        </button>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                         <input type="file" ref={fileInputRef} hidden accept=".csv" onChange={handleUploadCSV} />
                         <button onClick={() => fileInputRef.current?.click()} className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">
                            <Upload size={14} /> Import CSV
                         </button>
                    </div>
                </div>

                {/* List Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                                <tr>
                                    <th className="p-4 font-bold uppercase text-[11px] tracking-wider">Agent Name</th>
                                    <th className="p-4 font-bold uppercase text-[11px] tracking-wider">Contact Info</th>
                                    <th className="p-4 font-bold uppercase text-[11px] tracking-wider">Branding</th>
                                    <th className="p-4 font-bold uppercase text-[11px] tracking-wider text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {loading ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-2"/>Loading agents...</td></tr>
                                ) : agents.length === 0 ? (
                                    <tr><td colSpan={4} className="p-12 text-center text-slate-400">No agents found. Add one above or import CSV.</td></tr>
                                ) : (
                                    agents.map(agent => (
                                        <tr key={agent.id} className="hover:bg-slate-50/80 transition-colors group">
                                            <td className="p-4">
                                                <div className="font-bold text-slate-800">{agent.business_name}</div>
                                                <div className="text-[10px] text-slate-400">{agent.id?.slice(0,8)}...</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className="flex items-center gap-1.5 text-slate-600"><Phone size={12}/> {agent.contact_number}</span>
                                                    {agent.email && <span className="flex items-center gap-1.5 text-slate-500 text-xs"><Mail size={12}/> {agent.email}</span>}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                {agent.logo_url ? (
                                                    <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden p-1 shadow-sm">
                                                        <img src={fixUrl(agent.logo_url)} className="w-full h-full object-contain" alt="logo"/>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-slate-400 italic">No Logo</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-right">
                                                {/* FIXED DELETE BUTTON: RED & VISIBLE */}
                                                <button onClick={() => handleDelete(agent.id!)} className="bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 p-2 rounded-lg transition-all shadow-sm">
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        )}

        {/* --- TAB: DISTRIBUTE --- */}
        {activeTab === 'distribute' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* LEFT PANEL: CONTROLS */}
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <span className="bg-slate-900 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
                            Select Master Creative
                        </h3>
                        
                        {!masterImage ? (
                            <div className="grid grid-cols-2 gap-4 h-48">
                                <label className={`border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-all group ${processing ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <div className="bg-blue-50 text-blue-600 p-3 rounded-full mb-3 group-hover:scale-110 transition-transform">
                                        <Upload size={24}/>
                                    </div>
                                    <span className="text-sm font-bold text-slate-600">Upload New</span>
                                    <span className="text-[10px] text-slate-400 mt-1">JPG, PNG (Max 5MB)</span>
                                    <input type="file" hidden accept="image/*" onChange={handleNewMasterUpload} disabled={processing} />
                                </label>
                                <button onClick={() => { setShowAssetModal(true); fetchAssets() }} className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-all group">
                                    <div className="bg-purple-50 text-purple-600 p-3 rounded-full mb-3 group-hover:scale-110 transition-transform">
                                        <Grid size={24}/>
                                    </div>
                                    <span className="text-sm font-bold text-slate-600">Select Asset</span>
                                    <span className="text-[10px] text-slate-400 mt-1">From Library</span>
                                </button>
                            </div>
                        ) : (
                            <div className="relative rounded-xl overflow-hidden border border-slate-200 group bg-slate-50 shadow-inner">
                                <img src={fixUrl(masterImage)} className="w-full h-64 object-contain" />
                                <div className="absolute top-0 right-0 p-3 flex gap-2">
                                    <button onClick={() => setMasterImage(null)} className="bg-white/90 backdrop-blur text-red-500 p-2 rounded-lg shadow-md hover:bg-red-50 transition-colors">
                                        <Trash2 size={18}/>
                                    </button>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 bg-black/50 backdrop-blur-sm text-white text-xs p-2 text-center">
                                    Selected Master Image
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <span className="bg-slate-900 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
                            Distribution Settings
                        </h3>

                        <div className="space-y-4">
                            <label className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${sendEmails ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:border-slate-200'}`}>
                                <div className="pt-0.5">
                                    <input type="checkbox" checked={sendEmails} onChange={e => setSendEmails(e.target.checked)} className="w-5 h-5 accent-blue-600" />
                                </div>
                                <div>
                                    <span className={`font-bold block ${sendEmails ? 'text-blue-700' : 'text-slate-700'}`}>Send via Email</span>
                                    <span className="text-slate-500 text-xs mt-1 block leading-relaxed">
                                        Automatically email the personalized graphic to each agent's registered email address immediately after generation.
                                    </span>
                                </div>
                            </label>
                            
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div className="flex justify-between items-center text-sm mb-2">
                                    <span className="text-slate-500">Target Audience</span>
                                    <span className="font-bold text-slate-900">{agents.length} Agents</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-500">Estimated Time</span>
                                    <span className="font-bold text-slate-900">~{Math.ceil(agents.length * 2 / 60)} mins</span>
                                </div>
                            </div>

                            <button 
                                onClick={handleDistribute} 
                                disabled={processing || !masterImage || agents.length === 0} 
                                className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold flex justify-center items-center gap-3 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-slate-200 transition-all active:scale-95"
                            >
                                {processing ? <Loader2 className="animate-spin" /> : <div className="flex items-center gap-2"><RefreshCw size={20}/> <span>Start Distribution Engine</span></div>}
                            </button>
                        </div>
                    </div>
                </div>

                {/* RIGHT PANEL: RESULTS & PROGRESS */}
                <div className="bg-white rounded-2xl shadow-lg border border-slate-200 flex flex-col h-[700px] overflow-hidden sticky top-6">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            Live Results 
                            {activeBatchId && (
                                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${batchProgress.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 animate-pulse'}`}>
                                    {batchProgress.status}
                                </span>
                            )}
                        </h3>
                        {batchResults.length > 0 && <span className="text-xs font-bold text-slate-500">{batchResults.length} Items</span>}
                        
                        {/* CANCEL BUTTON FOR STUCK JOBS */}
                        {activeBatchId && batchProgress.status !== 'completed' && (
                            <button onClick={handleCancelBatch} className="text-red-500 hover:bg-red-50 p-1 rounded-full text-xs font-bold flex items-center gap-1">
                                <StopCircle size={14} /> Stop
                            </button>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 bg-slate-50/30">
                        {activeBatchId ? (
                            <>
                                 {/* PROGRESS BAR */}
                                {batchProgress.status !== 'completed' && (
                                    <div className="mb-6 bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                                        <div className="flex justify-between text-xs font-bold text-slate-600 mb-2">
                                            <span>Processing Batch...</span>
                                            <span>{Math.round((batchProgress.completed / (batchProgress.total || 1)) * 100)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                                            <div 
                                                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out relative" 
                                                style={{ width: `${batchProgress.total ? (batchProgress.completed / batchProgress.total) * 100 : 0}%` }} 
                                            >
                                                <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-2 text-center">You can navigate away, this process will continue.</p>
                                    </div>
                                )}

                                {/* RESULTS LIST */}
                                <div className="space-y-3">
                                    {batchResults.map((item) => (
                                        <div key={item.id} className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex gap-4 items-center animate-in fade-in slide-in-from-bottom-2 duration-300 hover:shadow-md transition-shadow">
                                            {/* Thumbnail */}
                                            <div className="w-16 h-16 flex-shrink-0 bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                                                {item.status === 'failed' ? (
                                                    <div className="w-full h-full flex items-center justify-center text-red-400"><AlertCircle size={24}/></div>
                                                ) : (
                                                    <img src={fixUrl(item.result_url)} className="w-full h-full object-cover" />
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <p className="font-bold text-sm text-slate-800 truncate">{item.agent_data.business_name}</p>
                                                    <span className="text-[10px] text-slate-400">{new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                                </div>
                                                <p className="text-xs text-slate-500 truncate mb-1.5">{item.agent_data.email || 'No email provided'}</p>
                                                
                                                <div className="flex gap-2">
                                                    {item.status === 'failed' ? (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded">Failed</span>
                                                    ) : item.email_sent ? (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-50 text-green-700 px-2 py-0.5 rounded"><Check size={10} strokeWidth={3}/> Email Sent</span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded">No Email</span>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            {item.result_url && (
                                                <a href={fixUrl(item.result_url)} target="_blank" download className="p-2.5 bg-slate-50 rounded-full text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                                    <Download size={18}/>
                                                </a>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* DONE STATE */}
                                {batchProgress.status === 'completed' && (
                                    <div className="mt-8 text-center pb-8">
                                         <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 text-green-600 rounded-full mb-3 shadow-sm">
                                            <Check size={32} strokeWidth={3} />
                                         </div>
                                         <h3 className="font-bold text-slate-800 text-lg">Batch Complete!</h3>
                                         <p className="text-slate-500 text-sm mb-4">All {batchProgress.total} graphics have been processed.</p>
                                         <button onClick={() => { setActiveBatchId(null); setBatchResults([]); setBatchProgress({total:0,completed:0,status:'idle'}); setMasterImage(null) }} className="text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline">
                                             Start New Batch
                                         </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            // EMPTY STATE
                            <div className="flex flex-col items-center justify-center h-full text-slate-300">
                                <div className="bg-slate-50 p-6 rounded-full mb-4">
                                    <Grid size={48} className="opacity-50" />
                                </div>
                                <p className="text-sm font-medium text-slate-400">Generated images will appear here.</p>
                                <p className="text-xs text-slate-300 mt-1">Select a master image to begin.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* ASSET MODAL */}
        {showAssetModal && (
            <div className="fixed inset-0 bg-slate-900/40 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
                        <div>
                            <h3 className="font-bold text-xl text-slate-900">Select Master Asset</h3>
                            <p className="text-xs text-slate-500">Choose an image from your library</p>
                        </div>
                        <button onClick={() => setShowAssetModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"><X size={24}/></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                        {loadingAssets ? (
                            <div className="flex flex-col justify-center items-center h-full text-slate-400 gap-3">
                                <Loader2 className="animate-spin text-blue-500" size={40} />
                                <span className="text-sm font-medium">Loading library...</span>
                            </div>
                        ) : userAssets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                                <ImageIcon size={64} className="opacity-20" />
                                <p>No compatible images found.</p>
                                <button onClick={() => setShowAssetModal(false)} className="text-blue-600 text-sm font-bold hover:underline">Upload one instead</button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {userAssets.map(asset => (
                                    <div 
                                        key={asset.id} 
                                        onClick={() => { setMasterImage(asset.url); setShowAssetModal(false) }} 
                                        className="group relative aspect-square bg-white rounded-xl overflow-hidden cursor-pointer border border-slate-200 shadow-sm hover:shadow-lg hover:border-blue-500 transition-all duration-200"
                                    >
                                        <img src={fixUrl(asset.url)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                                            <div className="bg-blue-600 text-white p-2 rounded-full shadow-lg">
                                                <Check size={16} strokeWidth={3} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
    </div>
  )
}