'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, Plus, Trash2, Check, Loader2, Image as ImageIcon, Grid, X, Search } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'

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

export default function DistributePage() {
  const supabase = createClient()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [activeTab, setActiveTab] = useState<'manage' | 'distribute'>('manage')
  
  // Form State
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('') 
  const [newLogo, setNewLogo] = useState<File | null>(null)
  
  // Distribute State
  const [masterImage, setMasterImage] = useState<string | null>(null)
  const [sendEmails, setSendEmails] = useState(true) 
  const [results, setResults] = useState<any[]>([])

  // Asset Selection Modal
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [userAssets, setUserAssets] = useState<Asset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- URL FIXER ---
  // This ensures we only add the folder when FETCHING/DISPLAYING
  const fixUrl = (url: string | null) => {
    if (!url) return ''
    if (url.includes('r2.dev') && !url.includes('/adrolls-storage/')) {
        return url.replace('.r2.dev/', '.r2.dev/adrolls-storage/')
    }
    return url
  }

  useEffect(() => {
    fetchAgents()
  }, [])

  const fetchAgents = async () => {
    const { data } = await supabase.from('external_agents').select('*').order('created_at', { ascending: false })
    if (data) setAgents(data)
    setLoading(false)
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

  const handleAddAgent = async () => {
    if (!newName || !newPhone) return alert("Name and Phone are required")
    setProcessing(true)
    
    try {
        let logoUrl = ''
        if (newLogo) logoUrl = await uploadToR2(newLogo, 'agent-logos')

        // Save to DB (Clean URL)
        const { error } = await supabase.from('external_agents').insert({
            business_name: newName,
            contact_number: newPhone,
            email: newEmail, 
            logo_url: logoUrl
        })

        if (error) throw error
        setNewName(''); setNewPhone(''); setNewEmail(''); setNewLogo(null)
        fetchAgents()
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
  }

  const handleDistribute = async () => {
    if (!masterImage) return alert("Please select a master image")
    if (agents.length === 0) return alert("No agents to distribute to")
    
    setProcessing(true)
    setResults([]) 
    
    try {
        const res = await fetch('/api/distribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // Ensure backend gets the FIXED URL for processing
                masterImageUrl: fixUrl(masterImage),
                agents: agents.map(a => ({
                    ...a,
                    logo_url: fixUrl(a.logo_url) // Fix logo URL for backend too
                })),
                sendEmail: sendEmails 
            })
        })
        const data = await res.json()
        if (data.success) {
            setResults(data.results)
        } else {
            alert("Error: " + data.error)
        }
    } catch (e) { alert("Network Error") } finally { setProcessing(false) }
  }

  const handleNewMasterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setProcessing(true) 
      try {
          const url = await uploadToR2(file, 'creatives')
          setMasterImage(url) // State holds Clean URL
      } catch (e) { alert("Upload failed") }
      finally { setProcessing(false) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto pb-24">
        <h1 className="text-2xl font-bold mb-6">Distribution Center</h1>
        
        <div className="flex gap-4 mb-6 border-b">
            <button onClick={() => setActiveTab('manage')} className={`pb-2 px-4 ${activeTab === 'manage' ? 'border-b-2 border-black font-bold' : 'text-gray-500'}`}>Manage List</button>
            <button onClick={() => setActiveTab('distribute')} className={`pb-2 px-4 ${activeTab === 'distribute' ? 'border-b-2 border-black font-bold' : 'text-gray-500'}`}>Distribute</button>
        </div>

        {activeTab === 'manage' && (
            <div>
                {/* Add Agent Form */}
                <div className="bg-white p-4 rounded-xl shadow-sm border mb-6 flex gap-4 items-end flex-wrap">
                    <div><label className="text-[10px] font-bold text-gray-500 block">Business Name</label><input value={newName} onChange={e => setNewName(e.target.value)} className="border p-2 rounded-lg w-32 text-sm" placeholder="Name" /></div>
                    <div><label className="text-[10px] font-bold text-gray-500 block">Phone</label><input value={newPhone} onChange={e => setNewPhone(e.target.value)} className="border p-2 rounded-lg w-32 text-sm" placeholder="Phone" /></div>
                    <div><label className="text-[10px] font-bold text-gray-500 block">Email</label><input value={newEmail} onChange={e => setNewEmail(e.target.value)} className="border p-2 rounded-lg w-40 text-sm" placeholder="Email" /></div>
                    <div><label className="text-[10px] font-bold text-gray-500 block">Logo</label><input type="file" onChange={e => setNewLogo(e.target.files?.[0] || null)} className="text-[10px]" /></div>
                    <button onClick={handleAddAgent} disabled={processing} className="bg-black text-white px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-bold">{processing ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Add</button>
                    <div className="ml-auto"><input type="file" ref={fileInputRef} hidden accept=".csv" onChange={handleUploadCSV} /><button onClick={() => fileInputRef.current?.click()} className="text-xs text-blue-600 underline">Upload CSV</button></div>
                </div>

                {/* List */}
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500"><tr><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">Email</th><th className="p-3">Logo</th><th className="p-3">Action</th></tr></thead>
                        <tbody>
                            {agents.map(agent => (
                                <tr key={agent.id} className="border-t">
                                    <td className="p-3 font-medium">{agent.business_name}</td>
                                    <td className="p-3 text-xs">{agent.contact_number}</td>
                                    <td className="p-3 text-xs text-gray-500">{agent.email || '-'}</td>
                                    <td className="p-3">
                                        {agent.logo_url ? (
                                            <div className="w-8 h-8 rounded bg-gray-50 border flex items-center justify-center overflow-hidden">
                                                {/* FIX: Use fixUrl here */}
                                                <img src={fixUrl(agent.logo_url)} className="w-full h-full object-contain" alt="logo"/>
                                            </div>
                                        ) : '-'}
                                    </td>
                                    <td className="p-3"><button onClick={() => handleDelete(agent.id!)} className="text-red-500 p-1 hover:bg-red-50 rounded"><Trash2 size={14} /></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {agents.length === 0 && <div className="p-8 text-center text-gray-400">No agents yet.</div>}
                </div>
            </div>
        )}

        {activeTab === 'distribute' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <h3 className="font-bold mb-4">1. Select Master Image</h3>
                    
                    {!masterImage ? (
                        <div className="flex gap-2 h-40">
                            <label className="flex-1 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors">
                                {processing ? <Loader2 className="animate-spin text-gray-400" /> : <Upload size={24} className="text-gray-400 mb-2"/>}
                                <span className="text-sm font-bold text-gray-600">Upload New</span>
                                <input type="file" hidden accept="image/*" onChange={handleNewMasterUpload} disabled={processing} />
                            </label>
                            <button onClick={() => { setShowAssetModal(true); fetchAssets() }} className="flex-1 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors">
                                <Grid size={24} className="text-gray-400 mb-2"/>
                                <span className="text-sm font-bold text-gray-600">Select Asset</span>
                            </button>
                        </div>
                    ) : (
                        <div className="relative rounded-xl overflow-hidden border border-gray-200 group bg-gray-100">
                            {/* FIX: Use fixUrl here */}
                            <img src={fixUrl(masterImage)} className="w-full h-64 object-contain" />
                            <button onClick={() => setMasterImage(null)} className="absolute top-2 right-2 bg-white p-2 rounded-full shadow-md text-red-500 hover:bg-red-50"><Trash2 size={16}/></button>
                        </div>
                    )}

                    <div className="mt-6 space-y-4">
                        <div className="flex items-center gap-3 bg-blue-50 p-4 rounded-xl border border-blue-100">
                            <input type="checkbox" checked={sendEmails} onChange={e => setSendEmails(e.target.checked)} className="w-5 h-5 accent-blue-600" />
                            <div className="text-sm">
                                <span className="font-bold text-blue-900 block">Send via Email</span>
                                <span className="text-blue-700 text-xs">Automatically email stamped graphic to agents</span>
                            </div>
                        </div>
                        
                        <button onClick={handleDistribute} disabled={processing || !masterImage} className="w-full bg-black text-white py-4 rounded-xl font-bold flex justify-center items-center gap-2 hover:bg-gray-900 disabled:opacity-50">
                            {processing ? <Loader2 className="animate-spin" /> : "Start Distribution"}
                        </button>
                    </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 h-[600px] overflow-y-auto border border-gray-100">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold">Results</h3>
                        {results.length > 0 && <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">{results.length} Generated</span>}
                    </div>
                    
                    <div className="space-y-2">
                        {results.map((res, i) => (
                            <div key={i} className="bg-white p-3 rounded-lg shadow-sm flex gap-3 items-center border border-gray-100">
                                {/* FIX: Use fixUrl here (though results usually come fixed from backend) */}
                                <img src={fixUrl(res.stampedUrl)} className="w-16 h-16 object-cover rounded bg-gray-100" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm truncate">{res.agentName}</p>
                                    <div className="flex gap-2 text-[10px] text-gray-500 mt-1">
                                        {res.emailSent ? 
                                            <span className="text-green-600 flex items-center gap-1 font-bold"><Check size={10}/> Email Sent</span> : 
                                            <span className="flex items-center gap-1"><X size={10}/> No Email</span>
                                        }
                                    </div>
                                </div>
                                <a href={fixUrl(res.stampedUrl)} target="_blank" className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 text-blue-500"><ImageIcon size={16}/></a>
                            </div>
                        ))}
                    </div>
                    
                    {results.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400">
                            <ImageIcon size={48} className="opacity-20 mb-2" />
                            <p className="text-sm">Generated images will appear here.</p>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Asset Selection Modal */}
        {showAssetModal && (
            <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                <div className="bg-white rounded-2xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-lg">Select Master Asset</h3>
                        <button onClick={() => setShowAssetModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20}/></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                        {loadingAssets ? (
                            <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin text-gray-400" size={32} /></div>
                        ) : userAssets.length === 0 ? (
                            <div className="text-center text-gray-400 py-20">No valid images found in your library.</div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {userAssets.map(asset => (
                                    <div 
                                        key={asset.id} 
                                        onClick={() => { setMasterImage(asset.url); setShowAssetModal(false) }} 
                                        className="group relative aspect-square bg-white rounded-xl overflow-hidden cursor-pointer border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-500 transition-all"
                                    >
                                        {/* FIX: Use fixUrl here */}
                                        <img src={fixUrl(asset.url)} className="w-full h-full object-cover" loading="lazy" />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 text-white p-1 rounded-full shadow-lg">
                                            <Check size={14} />
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