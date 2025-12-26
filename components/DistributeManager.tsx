'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Send, Users, CheckCircle, Loader2, AlertCircle, CheckSquare, Square } from 'lucide-react'

type Agent = {
    id: string
    business_name: string | null
    contact_number: string | null
    logo_url: string | null
}

type Creative = {
    id: string
    url: string
    type: 'image' | 'video'
}

export default function DistributeManager({ creative }: { creative: Creative }) {
  const supabase = createClient()
  
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()) // Track selection
  const [loading, setLoading] = useState(true)
  const [isDistributing, setIsDistributing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' })
  const [results, setResults] = useState<{success: number, failed: number}>({ success: 0, failed: 0 })

  // 1. Fetch Agents & Select All by Default
  useEffect(() => {
    const fetchTeam = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: myProfile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
      
      if (myProfile?.organization_id) {
        const { data: team } = await supabase
          .from('profiles')
          .select('id, business_name, contact_number, logo_url')
          .eq('organization_id', myProfile.organization_id)
        
        if (team) {
            setAgents(team as Agent[])
            // Default: Select ALL IDs
            setSelectedIds(new Set(team.map(a => a.id)))
        }
      }
      setLoading(false)
    }
    fetchTeam()
  }, [])

  // 2. Toggle Selection Helper
  const toggleAgent = (id: string) => {
    if (isDistributing) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  // 3. Toggle All
  const toggleAll = () => {
      if (isDistributing) return
      if (selectedIds.size === agents.length) {
          setSelectedIds(new Set()) // Deselect all
      } else {
          setSelectedIds(new Set(agents.map(a => a.id))) // Select all
      }
  }

  // 4. The Loop (Only iterates over SELECTED agents)
  const handleDistribute = async () => {
    if (!creative.url) return alert("Creative has no image URL")
    
    // Filter the list based on selection
    const targets = agents.filter(a => selectedIds.has(a.id))

    if (targets.length === 0) return alert("Please select at least one agent.")
    if (!confirm(`Confirm blast to ${targets.length} selected agents?`)) return
    
    setIsDistributing(true)
    setResults({ success: 0, failed: 0 })
    let s = 0;
    let f = 0;

    for (let i = 0; i < targets.length; i++) {
        const agent = targets[i]
        
        setProgress({ 
            current: i + 1, 
            total: targets.length, 
            status: `Processing ${agent.business_name || 'Agent'}...` 
        })

        try {
            const res = await fetch('/api/organization/distribute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetAgentId: agent.id,
                    masterImageUrl: creative.url,
                    masterCreativeId: creative.id
                })
            })

            const data = await res.json()

            if (res.ok && data.success) s++
            else {
                console.error(`Failed for ${agent.business_name}:`, data.error)
                f++
            }

        } catch (err) {
            console.error("Network Error", err)
            f++
        }
        
        await new Promise(r => setTimeout(r, 500))
    }

    setResults({ success: s, failed: f })
    setIsDistributing(false)
    alert(`Distribution Complete!\n✅ Sent: ${s}\n❌ Failed: ${f}`)
  }

  if (loading) return <div className="p-4 text-xs text-slate-400 flex gap-2"><Loader2 className="animate-spin" size={14}/> Loading team...</div>

  return (
    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
      
      {/* Header Info */}
      <div className="flex justify-between items-end mb-4 border-b border-slate-200 pb-4">
        <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Users size={18} className="text-purple-600"/> 
                Select Team
            </h3>
            <p className="text-xs text-slate-500 mt-1">
                {selectedIds.size} of {agents.length} agents selected
            </p>
        </div>
        <button 
            onClick={toggleAll} 
            className="text-xs font-bold text-purple-600 hover:text-purple-800 underline disabled:opacity-50"
            disabled={isDistributing}
        >
            {selectedIds.size === agents.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      {/* Agent List with Checkboxes */}
      <div className="max-h-60 overflow-y-auto space-y-2 mb-4 pr-1">
          {agents.map(agent => {
              const isSelected = selectedIds.has(agent.id)
              return (
                <div 
                    key={agent.id} 
                    onClick={() => toggleAgent(agent.id)}
                    className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-purple-50 border-purple-200' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                >
                    <div className={`text-purple-600 ${isDistributing ? 'opacity-50' : ''}`}>
                        {isSelected ? <CheckSquare size={18}/> : <Square size={18} className="text-slate-300"/>}
                    </div>
                    
                    <div className="w-8 h-8 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex-shrink-0">
                        {agent.logo_url ? <img src={agent.logo_url} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-[8px] font-bold text-slate-400">?</div>}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">{agent.business_name || 'Unknown Agent'}</p>
                        <p className="text-[10px] text-slate-400 truncate">{agent.contact_number || 'No Phone'}</p>
                    </div>
                </div>
              )
          })}
      </div>

      {/* Progress or Action Button */}
      {isDistributing ? (
        <div className="space-y-3 py-2 bg-white p-3 rounded-lg border border-purple-100">
            <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Progress</span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div 
                    className="bg-purple-600 h-full transition-all duration-300 ease-out"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
            </div>
            <p className="text-xs text-center font-medium text-purple-700 flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin"/>
                {progress.status}
            </p>
        </div>
      ) : (
        <div>
            <button 
                onClick={handleDistribute}
                disabled={selectedIds.size === 0}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-purple-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Send size={16} /> 
                Blast to {selectedIds.size} Agents
            </button>
        </div>
      )}
    </div>
  )
}