'use client'

import { useState, useEffect } from 'react'
import { Plus, MapPin, Loader2, X, Search, Globe, ExternalLink, RefreshCw, MessageCircle, ArrowLeft, Trash2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// Types
type Requirement = {
  id: string
  title: string // We will use this to store the "Search Query"
  created_at: string
  // We keep these optional for backward compatibility or if we extract them later
  location?: string 
  budget_range?: string
}

type ExternalListing = {
  id: string
  title: string
  description: string
  location: string
  price: string
  source_platform: string
  source_url: string
  contact_info: { phone?: string, email?: string } | null 
  created_at: string
  requirement_id?: string // CRITICAL: This links match to need
}

export default function DealRoomPage() {
  const supabase = createClient()
  
  // State
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [loading, setLoading] = useState(true)
  
  // Navigation State
  const [activeRequirement, setActiveRequirement] = useState<Requirement | null>(null)
  const [matches, setMatches] = useState<ExternalListing[]>([])
  const [loadingMatches, setLoadingMatches] = useState(false)
  
  // Form State
  const [showAddModal, setShowAddModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 1. Fetch User Requirements
  const fetchRequirements = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: reqs } = await supabase
        .from('deal_requirements')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      
      if (reqs) setRequirements(reqs)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRequirements() }, [])

  // 2. Fetch Matches for a Specific Requirement
  const openMatches = async (req: Requirement) => {
    setActiveRequirement(req)
    setLoadingMatches(true)
    setMatches([]) // Clear previous

    try {
      // Fetch matches linked to THIS requirement ID
      // Note: You must ensure your n8n workflow saves 'requirement_id' to the 'external_listings' table
      const { data: ext } = await supabase
        .from('external_listings')
        .select('*')
        .eq('requirement_id', req.id) // <--- SCOPING FIX
        .order('created_at', { ascending: false })
      
      if (ext) {
        // DEDUPLICATION LOGIC
        const uniqueMatches: ExternalListing[] = []
        const seenPhones = new Set()
        const seenUrls = new Set()

        ext.forEach(item => {
            const phone = item.contact_info?.phone?.replace(/[^0-9]/g, '')
            const url = item.source_url

            // If we have a phone, dedup by phone. If not, dedup by URL.
            if (phone) {
                if (!seenPhones.has(phone)) {
                    seenPhones.add(phone)
                    uniqueMatches.push(item)
                }
            } else if (url) {
                if (!seenUrls.has(url)) {
                    seenUrls.add(url)
                    uniqueMatches.push(item)
                }
            }
        })
        setMatches(uniqueMatches)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingMatches(false)
    }
  }

  // 3. Handle Post Requirement (Simplified)
  const handlePostRequirement = async () => {
    if (!searchQuery.trim()) return

    setIsSubmitting(true)
    try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error("No user")

        // Insert to DB (We use 'title' to store the full query for simplicity)
        const { data: insertedData, error } = await supabase
            .from('deal_requirements')
            .insert({
                user_id: user.id,
                title: searchQuery, // Storing the raw query
                location: 'Unknown', // Defaults
                property_type: 'Mixed',
                status: 'active'
            })
            .select()
            .single()

        if (error) throw error

        // Trigger AI Agent
        if (insertedData) {
            await fetch('/api/agent-hunt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requirementId: insertedData.id,
                    query: searchQuery // Passing raw query
                })
            })
        }

        await fetchRequirements()
        setShowAddModal(false)
        setSearchQuery('')
        alert("Agent deployed! It will take about 30-60 seconds to find matches.")

    } catch (e: any) {
        alert("Failed: " + e.message)
    } finally {
        setIsSubmitting(false)
    }
  }

  // 4. Connect Action (Updated)
  const handleConnect = (match: ExternalListing) => {
    const introText = `Hi, I saw your listing for "${match.title}". I have a buyer. Is it still available?`
    
    if (match.contact_info?.phone) {
        // 1. Remove all non-numeric characters (spaces, dashes, brackets)
        let cleanPhone = match.contact_info.phone.replace(/[^0-9]/g, '')

        // 2. INTELLIGENT FORMATTING
        // If it's a 10-digit number (e.g., 9876543210), assume it's Indian (+91)
        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone
        }
        // If it starts with '0' (e.g., 098765...), remove the 0 and add 91
        else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
            cleanPhone = '91' + cleanPhone.substring(1)
        }
        // If it already has 12 digits (91987...), leave it alone. 
        // Otherwise, send as is.

        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(introText)}`, '_blank')
    } else {
        window.open(match.source_url, '_blank')
    }
  }

  // 5. Delete Requirement
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if(!confirm("Delete this requirement?")) return
    await supabase.from('deal_requirements').delete().eq('id', id)
    fetchRequirements()
  }

  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24 relative bg-surface">
      
      {/* VIEW 1: REQUIREMENTS LIST */}
      {!activeRequirement && (
        <>
            <div className="flex justify-between items-end mb-6">
                <div>
                <h1 className="text-2xl font-bold text-slate-900">Deal Room</h1>
                <p className="text-slate-500 text-xs mt-1">AI Agent finds deals for you</p>
                </div>
                <button onClick={() => setShowAddModal(true)} className="bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-slate-200 active:scale-95 transition-transform flex items-center gap-2 font-bold text-xs">
                    <Plus size={16} /> New Search
                </button>
            </div>

            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
                {requirements.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <Search size={24} className="text-slate-300" />
                        </div>
                        <p className="text-slate-400 text-sm">No active searches.</p>
                        <p className="text-slate-300 text-xs mt-1">Post a need to start hunting.</p>
                    </div>
                ) : (
                    requirements.map((req) => (
                        <div key={req.id} className="bg-white p-5 rounded-[1.5rem] shadow-sm border border-slate-100 relative group transition-all hover:shadow-md cursor-pointer" onClick={() => openMatches(req)}>
                            
                            <div className="flex justify-between items-start mb-2">
                                <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-wider">Active Search</span>
                                <button onClick={(e) => handleDelete(e, req.id)} className="text-slate-300 hover:text-red-400 p-1"><Trash2 size={14}/></button>
                            </div>
                            
                            <h3 className="font-bold text-slate-800 text-base mb-3 leading-snug">
                                "{req.title}"
                            </h3>
                            
                            <div className="flex justify-between items-center border-t border-slate-50 pt-3">
                                <span className="text-[10px] text-slate-400 font-medium">{new Date(req.created_at).toLocaleDateString()}</span>
                                <div className="flex items-center gap-1 text-xs font-bold text-slate-900">
                                    View Matches <Search size={12} strokeWidth={3} />
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </>
      )}

      {/* VIEW 2: MATCHES VIEW */}
      {activeRequirement && (
        <div className="animate-in slide-in-from-right-4 duration-200">
            {/* Nav Header */}
            <div className="sticky top-0 bg-surface/95 backdrop-blur-sm z-10 pb-4 pt-2 mb-2 flex items-center gap-3">
                <button onClick={() => setActiveRequirement(null)} className="p-2 bg-white rounded-full shadow-sm border border-slate-100 text-slate-600 hover:bg-slate-50">
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                    <p className="text-[10px] text-slate-400 font-bold uppercase">Results for</p>
                    <h2 className="text-sm font-bold text-slate-900 truncate pr-4">"{activeRequirement.title}"</h2>
                </div>
                <button onClick={() => openMatches(activeRequirement)} className="p-2 text-slate-400 hover:text-blue-500"><RefreshCw size={18}/></button>
            </div>

            {/* Matches List */}
            {loadingMatches ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                    <Loader2 className="animate-spin text-slate-400" size={30} />
                    <p className="text-xs text-slate-400 animate-pulse">Hunting down the best deals...</p>
                </div>
            ) : matches.length === 0 ? (
                <div className="text-center py-20">
                    <p className="text-slate-400 text-sm">No matches found yet.</p>
                    <p className="text-slate-300 text-xs mt-1">The agent might still be searching. Check back in a minute.</p>
                </div>
            ) : (
                <div className="space-y-4 pb-10">
                    <p className="text-xs text-slate-400 px-1">Found {matches.length} unique opportunities</p>
                    {matches.map((match) => (
                        <div key={match.id} className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-blue-50 relative overflow-hidden">
                            {/* Platform Badge */}
                            <div className="absolute top-0 right-0 bg-slate-50 px-3 py-1 rounded-bl-xl border-l border-b border-slate-100">
                                <div className="flex items-center gap-1.5">
                                    <Globe size={10} className="text-blue-500" />
                                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">{match.source_platform}</span>
                                </div>
                            </div>

                            <div className="pr-16 mb-2">
                                <h3 className="font-bold text-slate-800 text-sm leading-tight mb-1">{match.title}</h3>
                                <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                                    <span className="font-bold text-green-600">{match.price || 'Price on Request'}</span>
                                    <span className="text-slate-300">•</span>
                                    <span className="truncate max-w-[150px]">{match.location}</span>
                                </div>
                            </div>

                            <p className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl leading-relaxed border border-slate-100 mb-3 line-clamp-3">
                                {match.description}
                            </p>

                            <div className="flex gap-2">
                                <a href={match.source_url} target="_blank" rel="noopener noreferrer" className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 hover:bg-slate-50 transition-colors">
                                    View Source <ExternalLink size={12} />
                                </a>
                                <button 
                                    onClick={() => handleConnect(match)}
                                    className="flex-1 bg-slate-900 text-white py-2.5 rounded-xl text-xs font-bold shadow-md shadow-slate-200 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                                >
                                    {match.contact_info?.phone ? <MessageCircle size={14} /> : <Globe size={14} />}
                                    {match.contact_info?.phone ? 'WhatsApp' : 'Visit Link'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      )}

      {/* ADD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10">
            
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Agent Hunt</h2>
                <p className="text-xs text-slate-400">Describe what you need.</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="bg-slate-50 p-2 rounded-full text-slate-500 hover:bg-slate-100"><X size={18} /></button>
            </div>

            <div className="space-y-4">
                <div>
                    <textarea 
                        value={searchQuery} 
                        onChange={e => setSearchQuery(e.target.value)} 
                        placeholder="e.g. 3 BHK in Mohali Sector 82 under 1.5 Cr for investment..." 
                        rows={4}
                        className="w-full bg-slate-50 p-4 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-primary resize-none" 
                    />
                    <p className="text-[10px] text-slate-400 mt-2 ml-1">
                        *Be specific about location and budget for better results.
                    </p>
                </div>

                <button onClick={handlePostRequirement} disabled={isSubmitting || !searchQuery.trim()} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold shadow-lg shadow-slate-200 active:scale-95 transition-transform disabled:opacity-70 flex items-center justify-center gap-2">
                    {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : ( <><Search size={18} /> Start Hunt</> )}
                </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}