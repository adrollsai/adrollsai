'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, Plus, Trash2, Check, Loader2, Image as ImageIcon, Grid, X, AlertCircle, Mail, Phone, RefreshCw, Download, StopCircle, ShieldAlert, CheckSquare, Square } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'
import { useOrganization } from '@/components/OrganizationWrapper'

// --- TYPES ---
type Agent = {
  id: string
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
  const { userRole, loading: orgLoading } = useOrganization()
  
  // --- STATE ---
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set()) // NEW: Selection State
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [activeTab, setActiveTab] = useState<'manage' | 'distribute'>('manage')
  
  // Manage Form State
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('') 
  const [newLogo, setNewLogo] = useState<File | null>(null)
  
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
    if (orgLoading) return
    if (userRole !== 'admin' && userRole !== 'super_user') return

    const init = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // 1. Load Agents
        const { data: agentData } = await supabase.from('external_agents').select('*').order('created_at', { ascending: false })
        if (agentData) {
            setAgents(agentData)
            // NEW: Default select all agents
            setSelectedAgents(new Set(agentData.map(a => a.id)))
        }
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
            // If job is running, switch to distribute tab
            setActiveTab('distribute')
            
            if (activeBatch.master_image_url) {
                setMasterImage(activeBatch.master_image_url)
            }
        }
    }
    init()
  }, [orgLoading, userRole])

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


  // --- ACTIONS ---
  const fetchAgents = async () => {
    const { data } = await supabase.from('external_agents').select('*').order('created_at', { ascending: false })
    if (data) {
        setAgents(data)
        // Only select all if selection was empty (or you can force select all on refresh)
        if (selectedAgents.size === 0) {
            setSelectedAgents(new Set(data.map(a => a.id)))
        }
    }
  }

  const toggleAgentSelection = (id: string) => {
      const newSet = new Set(selectedAgents)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)
      setSelectedAgents(newSet)
  }

  const toggleAllAgents = () => {
      if (selectedAgents.size === agents.length) {
          setSelectedAgents(new Set())
      } else {
          setSelectedAgents(new Set(agents.map(a => a.id)))
      }
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
        setUserAssets(cleanAssets as Asset[])
    }
    setLoadingAssets(false)
  }

  const handleAddAgent = async () => {
    if (!newName || !newPhone) return alert("Name and Phone are required")
    setProcessing(true)
    
    try {
        let logoUrl = ''
        if (newLogo) {
            logoUrl = await uploadToR2(newLogo, 'agent-logos')
        }

        const { data, error } = await supabase.from('external_agents').insert({
            business_name: newName,
            contact_number: newPhone,
            email: newEmail, 
            logo_url: logoUrl
        }).select().single()

        if (error) throw error
        setNewName(''); setNewPhone(''); setNewEmail(''); setNewLogo(null)
        
        // Optimistic update + Selection
        if (data) {
            setAgents(prev => [data, ...prev])
            setSelectedAgents(prev => new Set(prev).add(data.id))
        } else {
            fetchAgents()
        }
    } catch (e: any) { alert("Error: " + e.message) } finally { setProcessing(false) }
  }

  const handleUploadCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (event) => {
        const text = event.target?.result as string
        const lines = text.split('\n').slice(1)
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
            await supabase.from('external_agents').insert(newAgents)
            setProcessing(false); fetchAgents()
            alert(`Imported ${newAgents.length} agents`)
        }
    }
    reader.readAsText(file)
  }

  const handleDelete = async (id: string) => {
    if(!confirm("Remove this agent?")) return
    await supabase.from('external_agents').delete().eq('id', id)
    setAgents(agents.filter(a => a.id !== id))
    const newSet = new Set(selectedAgents)
    newSet.delete(id)
    setSelectedAgents(newSet)
  }

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
    
    // NEW: Filter based on selection
    const targetAgents = agents.filter(a => selectedAgents.has(a.id))
    
    if (targetAgents.length === 0) return alert("Please select at least one agent")
    
    setProcessing(true)
    setBatchResults([]) 
    
    try {
        const res = await fetch('/api/distribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                masterImageUrl: fixUrl(masterImage),
                agents: targetAgents.map(a => ({ ...a, logo_url: fixUrl(a.logo_url) })),
                sendEmail: sendEmails 
            })
        })
        const data = await res.json()
        if (data.success) {
            setActiveBatchId(data.batchId)
            setBatchProgress({ total: targetAgents.length, completed: 0, status: 'pending' })
            alert("Distribution started! You can scroll down to see results appearing.")
        } else {
            alert("Error: " + data.error)
        }
    } catch (e) { alert("Network Error") } finally { setProcessing(false) }
  }

  const handleCancelBatch = async () => {
      if (!activeBatchId) return
      if (!confirm("Stop monitoring this batch? This effectively cancels it from your view.")) return
      await supabase.from('distribution_batches').update({ status: 'failed' }).eq('id', activeBatchId)
      setActiveBatchId(null)
      setBatchProgress({ total: 0, completed: 0, status: 'idle' })
      setBatchResults([])
  }

  // --- ACCESS CONTROL ---
  if (orgLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>

  if (userRole !== 'admin' && userRole !== 'super_user') {
      return (
          <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
              <div className="bg-red-50 p-6 rounded-full mb-4"><ShieldAlert size={48} className="text-red-500" /></div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
              <p className="text-gray-500 max-w-md">Only Organization Owners can access this feature.</p>
          </div>
      )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto pb-32">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Distribution Center</h1>
                <p className="text-slate-500 mt-1">Manage your agent network and distribute personalized marketing assets.</p>
            </div>
            <div className="bg-slate-100 p-1 rounded-xl flex">
                <button onClick={() => setActiveTab('manage')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'manage' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>Manage Agents</button>
                <button onClick={() => setActiveTab('distribute')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'distribute' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>Distribute Graphics</button>
            </div>
        </div>

        {activeTab === 'manage' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Plus size={18} className="text-blue-600"/> Add New Agent</h3>
                    <div className="flex gap-4 items-end flex-wrap">
                        <div className="flex-1 min-w-[150px]"><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Business Name</label><input value={newName} onChange={e => setNewName(e.target.value)} className="w-full border bg-slate-50 p-2.5 rounded-xl text-sm" placeholder="Name" /></div>
                        <div className="flex-1 min-w-[150px]"><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Phone</label><input value={newPhone} onChange={e => setNewPhone(e.target.value)} className="w-full border bg-slate-50 p-2.5 rounded-xl text-sm" placeholder="Phone" /></div>
                        <div className="flex-1 min-w-[150px]"><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Email</label><input value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full border bg-slate-50 p-2.5 rounded-xl text-sm" placeholder="Email" /></div>
                        <div><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Logo</label><input type="file" onChange={e => setNewLogo(e.target.files?.[0] || null)} className="text-[10px]" /></div>
                        <button onClick={handleAddAgent} disabled={processing} className="bg-slate-900 text-white px-6 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold hover:bg-slate-800">{processing ? <Loader2 className="animate-spin" size={16}/> : <Plus size={16}/>} Add</button>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                         <input type="file" ref={fileInputRef} hidden accept=".csv" onChange={handleUploadCSV} />
                         <button onClick={() => fileInputRef.current?.click()} className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"><Upload size={14} /> Import CSV</button>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    {/* DESKTOP TABLE */}
                    <table className="w-full text-sm text-left hidden md:table">
                        <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                            <tr><th className="p-4">Agent Name</th><th className="p-4">Contact</th><th className="p-4">Branding</th><th className="p-4 text-right">Action</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {agents.map(agent => (
                                <tr key={agent.id} className="hover:bg-slate-50/80">
                                    <td className="p-4 font-bold text-slate-800">{agent.business_name}</td>
                                    <td className="p-4"><div className="flex flex-col gap-1"><span className="flex items-center gap-1"><Phone size={12}/> {agent.contact_number}</span>{agent.email && <span className="flex items-center gap-1 text-slate-500 text-xs"><Mail size={12}/> {agent.email}</span>}</div></td>
                                    <td className="p-4">{agent.logo_url ? <img src={fixUrl(agent.logo_url)} className="w-8 h-8 object-contain bg-white border rounded" /> : '-'}</td>
                                    <td className="p-4 text-right"><button onClick={() => handleDelete(agent.id!)} className="text-red-500 hover:bg-red-50 p-2 rounded"><Trash2 size={16}/></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* MOBILE CARD VIEW (Stacking content) */}
                    <div className="md:hidden divide-y divide-slate-50">
                        {agents.map(agent => (
                            <div key={agent.id} className="p-4 flex flex-col gap-3">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3">
                                        {agent.logo_url ? <img src={fixUrl(agent.logo_url)} className="w-10 h-10 object-contain bg-white border rounded-lg" /> : <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400"><ImageIcon size={16}/></div>}
                                        <div>
                                            <p className="font-bold text-slate-800">{agent.business_name}</p>
                                            <p className="text-xs text-slate-500">{agent.contact_number}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => handleDelete(agent.id!)} className="text-red-500 bg-red-50 p-2 rounded-lg"><Trash2 size={16}/></button>
                                </div>
                                {agent.email && <div className="text-xs text-slate-500 flex items-center gap-1 bg-slate-50 p-2 rounded"><Mail size={12}/> {agent.email}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'distribute' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-6">
                    {/* STEP 1: MASTER CREATIVE */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><span className="bg-slate-900 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span> Select Master Creative</h3>
                        {!masterImage ? (
                            <div className="grid grid-cols-2 gap-4 h-40">
                                <label className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-all"><Upload size={24} className="text-blue-500 mb-2"/><span className="text-sm font-bold text-slate-600">Upload New</span><input type="file" hidden accept="image/*" onChange={handleNewMasterUpload} disabled={processing} /></label>
                                <button onClick={() => { setShowAssetModal(true); fetchAssets() }} className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center hover:bg-slate-50 transition-all"><Grid size={24} className="text-purple-500 mb-2"/><span className="text-sm font-bold text-slate-600">Select Asset</span></button>
                            </div>
                        ) : (
                            <div className="relative rounded-xl overflow-hidden border border-slate-200 group bg-slate-50">
                                <img src={fixUrl(masterImage)} className="w-full h-64 object-contain" />
                                <button onClick={() => setMasterImage(null)} className="absolute top-2 right-2 bg-white text-red-500 p-2 rounded-lg shadow hover:bg-red-50"><Trash2 size={16}/></button>
                            </div>
                        )}
                    </div>

                    {/* NEW STEP 2: RECIPIENT SELECTION */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><span className="bg-slate-900 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span> Recipients ({selectedAgents.size})</h3>
                            <button onClick={toggleAllAgents} className="text-xs font-bold text-blue-600 hover:underline">
                                {selectedAgents.size === agents.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        
                        <div className="max-h-60 overflow-y-auto space-y-2 border border-slate-100 rounded-xl p-2 bg-slate-50/50 scrollbar-thin scrollbar-thumb-slate-200">
                            {agents.length === 0 ? (
                                <p className="text-center text-sm text-slate-400 py-4">No agents found. Add agents in the Manage tab.</p>
                            ) : (
                                agents.map(agent => (
                                    <div key={agent.id} onClick={() => toggleAgentSelection(agent.id)} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selectedAgents.has(agent.id) ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:border-blue-200'}`}>
                                        <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${selectedAgents.has(agent.id) ? 'bg-blue-600 text-white' : 'bg-slate-200 text-transparent'}`}>
                                            <Check size={14} strokeWidth={3} />
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <p className="font-bold text-sm text-slate-800 truncate">{agent.business_name}</p>
                                            <p className="text-xs text-slate-500 truncate">{agent.contact_number}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* STEP 3: SETTINGS */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><span className="bg-slate-900 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">3</span> Settings</h3>
                        <label className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer ${sendEmails ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100'}`}>
                            <input type="checkbox" checked={sendEmails} onChange={e => setSendEmails(e.target.checked)} className="w-5 h-5 accent-blue-600 mt-1" />
                            <div><span className="font-bold block text-slate-800">Send via Email</span><span className="text-slate-500 text-xs">Automatically email results to agents.</span></div>
                        </label>
                        <button onClick={handleDistribute} disabled={processing || !masterImage || selectedAgents.size === 0} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold flex justify-center items-center gap-3 mt-4 hover:bg-slate-800 disabled:opacity-50">
                            {processing ? <Loader2 className="animate-spin" /> : <div className="flex items-center gap-2"><RefreshCw size={20}/> <span>Start Distribution</span></div>}
                        </button>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-lg border border-slate-200 flex flex-col h-[700px] overflow-hidden sticky top-6">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">Live Results {activeBatchId && <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{batchProgress.status}</span>}</h3>
                        {activeBatchId && batchProgress.status !== 'completed' && <button onClick={handleCancelBatch} className="text-red-500 hover:bg-red-50 p-1 rounded text-xs font-bold flex items-center gap-1"><StopCircle size={14}/> Stop</button>}
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 bg-slate-50/30">
                        {activeBatchId ? (
                            <>
                                {batchProgress.status !== 'completed' && (
                                    <div className="mb-6 bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                                        <div className="flex justify-between text-xs font-bold text-slate-600 mb-2"><span>Processing...</span><span>{Math.round((batchProgress.completed / (batchProgress.total || 1)) * 100)}%</span></div>
                                        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden"><div className="bg-blue-600 h-3 rounded-full transition-all duration-500 relative" style={{ width: `${batchProgress.total ? (batchProgress.completed / batchProgress.total) * 100 : 0}%` }}></div></div>
                                    </div>
                                )}
                                <div className="space-y-3">
                                    {batchResults.map((item) => (
                                        <div key={item.id} className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex gap-4 items-center hover:shadow-md transition-shadow">
                                            <div className="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden border border-slate-200">{item.status === 'failed' ? <AlertCircle className="m-auto mt-4 text-red-400"/> : <img src={fixUrl(item.result_url)} className="w-full h-full object-cover"/>}</div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-sm text-slate-800 truncate">{item.agent_data.business_name}</p>
                                                <p className="text-xs text-slate-500 truncate mb-1">{item.agent_data.email || 'No email'}</p>
                                                <div className="flex gap-2">{item.status === 'failed' ? <span className="text-[10px] font-bold bg-red-50 text-red-600 px-2 rounded">Failed</span> : item.email_sent ? <span className="text-[10px] font-bold bg-green-50 text-green-700 px-2 rounded flex items-center gap-1"><Check size={10}/> Sent</span> : <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 rounded">Generated</span>}</div>
                                            </div>
                                            {item.result_url && <a href={fixUrl(item.result_url)} target="_blank" download className="p-2 bg-slate-50 rounded-full text-slate-400 hover:text-blue-600"><Download size={18}/></a>}
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-300"><Grid size={48} className="opacity-50 mb-2"/><p>Results will appear here.</p></div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* ASSET MODAL */}
        {showAssetModal && (
            <div className="fixed inset-0 bg-slate-900/40 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                    <div className="p-5 border-b flex justify-between items-center"><h3 className="font-bold text-xl">Select Master Asset</h3><button onClick={() => setShowAssetModal(false)}><X size={24}/></button></div>
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                        {loadingAssets ? <div className="text-center p-10"><Loader2 className="animate-spin mx-auto"/></div> : <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{userAssets.map(asset => (<div key={asset.id} onClick={() => { setMasterImage(asset.url); setShowAssetModal(false) }} className="aspect-square bg-white rounded-xl overflow-hidden cursor-pointer border hover:border-blue-500"><img src={fixUrl(asset.url)} className="w-full h-full object-cover"/></div>))}</div>}
                    </div>
                </div>
            </div>
        )}
    </div>
  )
}