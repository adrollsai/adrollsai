'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  Mic, PhoneOff, Phone, RefreshCw, Trash2, 
  CheckCircle, XCircle, UserPlus, Volume2, User,
  Terminal, Activity
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useGeminiLive } from '@/hooks/useGeminiLive'
import OrbVisualizer from '@/components/OrbVisualizer'

type Lead = { id: string, name: string, status: string, phone: string, summary?: string }

export default function VoiceAgentPage() {
  const supabase = createClient()
  const [apiKey, setApiKey] = useState('') 
  const [leads, setLeads] = useState<Lead[]>([])
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  
  const { 
    connect, disconnect, isConnected, isSpeaking, 
    inputAnalyser, outputAnalyser, logs 
  } = useGeminiLive(apiKey)

  // FIX: Scroll only the debug container
  const logsContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (showDebug && logsContainerRef.current) {
        logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, showDebug])

  // Fetch Leads
  useEffect(() => {
    const fetchLeads = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data } = await supabase.from('leads').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
        setLeads(data || [])
    }
    fetchLeads()
  }, [])

  const addDemoLeads = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('leads').insert([
        { user_id: user.id, name: 'Sarah Miller', phone: '+1 555-0100', status: 'New', summary: 'Buyer: 2BHK downtown' }
    ])
    window.location.reload() // Quick refresh to show data
  }

  const handleStartCall = async () => {
    if (!activeLead) return alert("Select a lead first")
    if (!apiKey) return alert("Enter Gemini API Key")
    
    // Updated Prompt: Explicitly enables multilingual support
    const systemPrompt = `You are Alex, calling ${activeLead.name}. 
    Goal: Qualify for real estate. Ask budget and timeline.
    Rules:
    1. Be concise (1-2 sentences).
    2. Speak the user's language if they switch languages.
    3. Be friendly and natural.`
    
    const tools = [{ name: "mark_qualified", description: "Lead is good", parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } } } }]
    
    await connect(systemPrompt, tools)
  }
  
  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32 relative bg-surface">
      
      {/* Header */}
      <div className="mb-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Voice AI</h1>
        <div className="flex gap-2">
            <button onClick={() => setShowDebug(!showDebug)} className={`p-2 rounded-full border ${showDebug ? 'bg-slate-800 text-white' : 'bg-white text-slate-400'}`}>
                <Terminal size={16} />
            </button>
            <input type="password" placeholder="API Key" className="bg-white px-3 rounded-full border border-slate-100 text-[10px] w-24 outline-none focus:border-blue-300" value={apiKey} onChange={e => setApiKey(e.target.value)}/>
        </div>
      </div>

      {/* Orb Card */}
      <div className={`relative w-full aspect-square rounded-[2.5rem] shadow-2xl overflow-hidden transition-all duration-500 bg-black`}>
        <div className="absolute inset-0 z-0">
            <OrbVisualizer isSpeaking={isSpeaking} inputAnalyser={inputAnalyser} outputAnalyser={outputAnalyser} />
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
            <div className="mt-32 text-center">
                <h2 className="text-xl font-bold text-white drop-shadow-md">{activeLead ? activeLead.name : 'Select Lead'}</h2>
                <div className="flex items-center justify-center gap-2 mt-2">
                    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                    <p className="text-xs text-slate-300 drop-shadow-md">
                        {isConnected ? (isSpeaking ? "Alex Speaking..." : "Listening...") : "Ready"}
                    </p>
                </div>
            </div>
        </div>

        <div className="absolute bottom-8 left-0 right-0 px-10 flex justify-center items-center z-20 gap-6">
            {!isConnected ? (
                <button onClick={handleStartCall} disabled={!activeLead} className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all text-white disabled:opacity-50 disabled:grayscale">
                    <Phone size={28} fill="currentColor" />
                </button>
            ) : (
                <button onClick={disconnect} className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all text-white">
                    <PhoneOff size={28} fill="currentColor" />
                </button>
            )}
        </div>
      </div>

      {/* DEBUG CONSOLE (Fixed Scroll) */}
      {showDebug && (
        <div ref={logsContainerRef} className="mt-4 p-4 bg-slate-900 rounded-2xl h-48 overflow-y-auto border border-slate-800 shadow-inner">
            <div className="flex items-center gap-2 mb-2 text-slate-400 text-[10px] uppercase font-bold tracking-wider sticky top-0 bg-slate-900 pb-2">
                <Activity size={12} /> Live Logs
            </div>
            <div className="space-y-1 font-mono text-[10px]">
                {logs.length === 0 && <div className="text-slate-600 italic">Waiting for connection...</div>}
                {logs.map((log, i) => (
                    <div key={i} className={`flex gap-2 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-slate-300'}`}>
                        <span className="opacity-50">[{log.time}]</span>
                        <span>{log.msg}</span>
                    </div>
                ))}
            </div>
        </div>
      )}

      {/* Leads List */}
      <div className="mt-6 space-y-2">
        {leads.length === 0 && (
            <button onClick={addDemoLeads} className="w-full py-4 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors">
                Tap to load demo leads
            </button>
        )}
        {leads.map(lead => (
            <div key={lead.id} onClick={() => !isConnected && setActiveLead(lead)} className={`p-4 rounded-xl border bg-white flex justify-between items-center cursor-pointer active:scale-95 transition-all ${activeLead?.id === lead.id ? 'border-blue-500 ring-1 ring-blue-100 shadow-sm' : 'border-slate-100'}`}>
                <div>
                    <h4 className="font-bold text-sm text-slate-800">{lead.name}</h4>
                    <p className="text-[10px] text-slate-400">{lead.summary}</p>
                </div>
                {lead.status === 'New' ? <UserPlus size={16} className="text-blue-400"/> : <CheckCircle size={16} className="text-green-400"/>}
            </div>
        ))}
      </div>

    </div>
  )
}