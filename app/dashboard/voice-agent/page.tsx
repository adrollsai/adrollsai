'use client'

import { useState, useEffect } from 'react'
import { Mic, PhoneOff, User, Phone, CheckCircle, XCircle, UserPlus, Volume2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useGeminiLive } from '@/hooks/useGeminiLive'

type Lead = {
  id: string
  name: string
  status: string
  phone: string
  summary?: string
}

export default function VoiceAgentPage() {
  const supabase = createClient()
  const [apiKey, setApiKey] = useState('') 
  const [leads, setLeads] = useState<Lead[]>([])
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Custom Hook
  const { connect, disconnect, isConnected, isSpeaking, volumeLevel } = useGeminiLive(apiKey)

  // 1. Fetch Leads
  const fetchLeads = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setLeads(data || [])
    } catch (e) {
      console.error("Error fetching leads:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLeads() }, [])

  // 2. Demo Helpers
  const addDemoLeads = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const demoData = [
      { user_id: user.id, name: 'Sarah Miller', phone: '+1 (555) 010-9988', status: 'New', summary: 'Looking for a 2BHK downtown.' },
      { user_id: user.id, name: 'David Chen', phone: '+1 (555) 012-3344', status: 'New', summary: 'Investor, budget $2M.' },
      { user_id: user.id, name: 'Emily Davis', phone: '+1 (555) 019-7766', status: 'New', summary: 'First time buyer.' }
    ]

    await supabase.from('leads').insert(demoData)
    fetchLeads()
  }

  const deleteLead = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await supabase.from('leads').delete().eq('id', id)
    setLeads(prev => prev.filter(l => l.id !== id))
    if (activeLead?.id === id) setActiveLead(null)
  }

  // 3. Start Call Logic
  const handleStartCall = async () => {
    if (!activeLead) return alert("Select a lead first")
    if (!apiKey) return alert("Please enter a Gemini API Key to demo")

    const systemPrompt = `
      You are 'Alex', a professional real estate AI for 'AdRolls'.
      You are calling ${activeLead.name}.
      Context: ${activeLead.summary || 'Unknown context'}.
      
      YOUR GOAL: Qualify them.
      Ask:
      1. Timeline?
      2. Budget?
      
      Be concise. Speak naturally.
      Start by saying: "Hi, is this ${activeLead.name}?"
    `
    // Tools definition (same as before)
    const tools = [
        { name: "mark_qualified", description: "Lead has budget/intent", parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } } } },
        { name: "mark_unqualified", description: "Lead not interested", parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } } } }
    ]

    await connect(systemPrompt, tools)
  }

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24 relative bg-surface">
      
      {/* Header */}
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Voice AI</h1>
          <p className="text-slate-500 text-xs mt-1">Sales Agent Demo</p>
        </div>
        <div className="flex gap-2">
            {/* Quick Demo Button */}
            <button onClick={addDemoLeads} className="bg-white p-2 rounded-full shadow-sm border border-slate-100 text-slate-500 hover:text-blue-600">
                <RefreshCw size={18} />
            </button>
            <div className="bg-white px-3 py-1.5 rounded-full border border-slate-100 shadow-sm flex items-center">
                <input 
                    type="password" 
                    placeholder="API Key" 
                    className="text-[10px] outline-none w-16 bg-transparent"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                />
            </div>
        </div>
      </div>

      {/* ACTIVE CALL CARD */}
      <div className={`relative w-full aspect-square rounded-[2.5rem] shadow-xl overflow-hidden transition-all duration-500 ${isConnected ? 'bg-slate-900 scale-105' : 'bg-white border border-slate-100'}`}>
        
        {/* Status Pill */}
        <div className="absolute top-6 left-0 right-0 flex justify-center">
            {isConnected ? (
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 animate-pulse">
                    <div className="w-2 h-2 bg-red-500 rounded-full" />
                    <span className="text-xs font-bold text-white tracking-wide">LIVE</span>
                </div>
            ) : (
                <div className="flex items-center gap-2 bg-slate-50 px-4 py-1.5 rounded-full border border-slate-100">
                    <div className="w-2 h-2 bg-green-400 rounded-full" />
                    <span className="text-xs font-bold text-slate-500">Ready</span>
                </div>
            )}
        </div>

        {/* Center Visuals */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            {isConnected ? (
                <div className="mb-6 flex items-end gap-1 h-16">
                    {[1,2,3,4,5].map(i => (
                        <div key={i} className="w-2 bg-white rounded-full transition-all duration-75" 
                             style={{ height: `${Math.max(20, Math.random() * volumeLevel * 300)}%` }} />
                    ))}
                </div>
            ) : (
                <div className="w-28 h-28 bg-slate-50 rounded-full flex items-center justify-center mb-6 border-2 border-dashed border-slate-200">
                    <User size={40} className="text-slate-300" />
                </div>
            )}
            
            <h2 className={`text-2xl font-bold ${isConnected ? 'text-white' : 'text-slate-800'}`}>
                {activeLead ? activeLead.name : 'Select a Lead'}
            </h2>
            <p className={`text-sm mt-1 ${isConnected ? 'text-slate-400' : 'text-slate-400'}`}>
                {activeLead ? activeLead.phone : 'Tap a list item below'}
            </p>
        </div>

        {/* Controls */}
        <div className="absolute bottom-8 left-0 right-0 px-10 flex justify-between items-center">
            <button className="p-4 rounded-full bg-slate-100/10 backdrop-blur-sm text-slate-400 hover:bg-slate-100/20 transition-colors">
                <Volume2 size={22} />
            </button>
            
            {!isConnected ? (
                <button 
                    onClick={handleStartCall}
                    disabled={!activeLead}
                    className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-200 hover:scale-105 active:scale-95 transition-all text-white disabled:opacity-50 disabled:grayscale"
                >
                    <Phone size={28} fill="currentColor" />
                </button>
            ) : (
                <button 
                    onClick={disconnect}
                    className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-900/20 hover:scale-105 active:scale-95 transition-all text-white animate-in zoom-in"
                >
                    <PhoneOff size={28} fill="currentColor" />
                </button>
            )}

            <button className="p-4 rounded-full bg-slate-100/10 backdrop-blur-sm text-slate-400 hover:bg-slate-100/20 transition-colors">
                <Mic size={22} />
            </button>
        </div>
      </div>

      {/* LEADS LIST */}
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4 px-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">CRM Pipeline</h3>
            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded-md">{leads.length} Leads</span>
        </div>

        {leads.length === 0 && !loading ? (
            <div className="text-center py-10 bg-white rounded-3xl border border-dashed border-slate-200">
                <p className="text-sm text-slate-400 mb-3">No leads found.</p>
                <button onClick={addDemoLeads} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors">
                    Generate Demo Data
                </button>
            </div>
        ) : (
            <div className="space-y-2 pb-10">
                {leads.map(lead => (
                    <div 
                        key={lead.id} 
                        onClick={() => !isConnected && setActiveLead(lead)}
                        className={`group p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${activeLead?.id === lead.id ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-100' : 'bg-white border-slate-50 hover:border-slate-200'}`}
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold transition-colors ${lead.status === 'Qualified' ? 'bg-green-100 text-green-600' : lead.status === 'Unqualified' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                                {lead.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                                <h4 className="font-bold text-sm text-slate-800 truncate">{lead.name}</h4>
                                <p className="text-[10px] text-slate-400 truncate max-w-[120px]">{lead.summary || 'No context'}</p>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            {lead.status === 'Qualified' && <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-md">Qualified</span>}
                            {lead.status === 'Unqualified' && <span className="text-[10px] font-bold text-red-400 bg-red-50 px-2 py-1 rounded-md">Rejected</span>}
                            
                            <button 
                                onClick={(e) => deleteLead(e, lead.id)}
                                className="p-2 text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>

    </div>
  )
}