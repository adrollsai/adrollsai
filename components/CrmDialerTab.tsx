'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Phone, Delete, User, Sparkles, Clock, History, ShieldCheck, ArrowRight, RefreshCw, Plus } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatCallPhone } from '@/utils/dialer'
import Link from 'next/link'

interface CrmDialerTabProps {
    onInitiateCall: (phoneNumber: string, contactName?: string, leadId?: string) => void
    impersonateId?: string | null
}

const DIALPAD_BUTTONS = [
    { digit: '1', sub: '' },
    { digit: '2', sub: 'ABC' },
    { digit: '3', sub: 'DEF' },
    { digit: '4', sub: 'GHI' },
    { digit: '5', sub: 'JKL' },
    { digit: '6', sub: 'MNO' },
    { digit: '7', sub: 'PQRS' },
    { digit: '8', sub: 'TUV' },
    { digit: '9', sub: 'WXYZ' },
    { digit: '*', sub: '' },
    { digit: '0', sub: '+' },
    { digit: '#', sub: '' }
]

export default function CrmDialerTab({ onInitiateCall, impersonateId }: CrmDialerTabProps) {
    const supabase = useMemo(() => createClient(), [])
    const [typedNumber, setTypedNumber] = useState('')
    const [matchedLead, setMatchedLead] = useState<any | null>(null)
    const [isSearchingLead, setIsSearchingLead] = useState(false)
    const [recentCalls, setRecentCalls] = useState<any[]>([])
    const [isLoadingRecents, setIsLoadingRecents] = useState(false)

    // Handle physical keyboard input
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if active element is an input or textarea other than dialer
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
                return
            }

            if (/^[0-9*#]$/.test(e.key)) {
                setTypedNumber(prev => (prev.length < 15 ? prev + e.key : prev))
            } else if (e.key === 'Backspace') {
                setTypedNumber(prev => prev.slice(0, -1))
            } else if (e.key === 'Enter') {
                handleCall()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [typedNumber])

    // Match typed number to CRM lead
    useEffect(() => {
        const cleanDigits = typedNumber.replace(/\D/g, '')
        if (cleanDigits.length < 8) {
            setMatchedLead(null)
            return
        }

        const last10 = cleanDigits.slice(-10)
        let isCancelled = false
        setIsSearchingLead(true)

        async function searchLead() {
            try {
                const { data } = await supabase
                    .from('leads')
                    .select('id, name, phone, pipeline_stage, status, custom_fields')
                    .or(`phone.ilike.%${last10}%,phone.eq.+91${last10}`)
                    .limit(1)
                    .maybeSingle()
                if (isCancelled) return
                setMatchedLead(data || null)
            } catch (err) {
                // Ignore search error
            } finally {
                if (!isCancelled) setIsSearchingLead(false)
            }
        }

        searchLead()

        return () => {
            isCancelled = true
        }
    }, [typedNumber, supabase])

    // Fetch recent calls
    const fetchRecentCalls = useCallback(async () => {
        setIsLoadingRecents(true)
        try {
            const { data } = await supabase
                .from('lead_history')
                .select('id, lead_id, created_at, description, action_type')
                .eq('action_type', 'REMARK')
                .or('description.ilike.%🎙️ CALL_JSON%,description.ilike.%Agent VoIP%,description.ilike.%VoIP call initiated%')
                .order('created_at', { ascending: false })
                .limit(12)

            if (data && data.length > 0) {
                // Fetch corresponding lead info
                const leadIds = Array.from(new Set(data.map(d => d.lead_id).filter(Boolean)))
                const { data: leadsData } = await supabase
                    .from('leads')
                    .select('id, name, phone, pipeline_stage')
                    .in('id', leadIds)

                const leadMap = new Map((leadsData || []).map(l => [l.id, l]))

                const formatted = data.map(item => {
                    let summaryText = 'VoIP Call'
                    let recordingUrl = null
                    if (item.description && item.description.startsWith('🎙️ CALL_JSON:')) {
                        try {
                            const parsed = JSON.parse(item.description.replace('🎙️ CALL_JSON:', '').trim())
                            summaryText = parsed.summary || summaryText
                            recordingUrl = parsed.recording_url || null
                        } catch (e) {}
                    } else if (item.description) {
                        summaryText = item.description
                    }

                    const lead = leadMap.get(item.lead_id)
                    return {
                        id: item.id,
                        leadId: item.lead_id,
                        name: lead?.name || 'Contact',
                        phone: lead?.phone || '',
                        stage: lead?.pipeline_stage || '',
                        summary: summaryText,
                        recordingUrl,
                        date: item.created_at
                    }
                })

                setRecentCalls(formatted)
            }
        } catch (e) {
            console.warn('[CRM DIALER] Error fetching recent calls:', e)
        } finally {
            setIsLoadingRecents(false)
        }
    }, [supabase])

    useEffect(() => {
        fetchRecentCalls()
    }, [fetchRecentCalls])

    // Add digit to input
    const handleDigitClick = (digit: string) => {
        setTypedNumber(prev => (prev.length < 15 ? prev + digit : prev))
    }

    // Call action
    const handleCall = () => {
        if (!typedNumber.trim()) return
        const phone = formatCallPhone(typedNumber)
        onInitiateCall(phone, matchedLead?.name || undefined, matchedLead?.id || undefined)
    }

    return (
        <div className="w-full max-w-5xl mx-auto py-4 px-2 sm:px-4 space-y-6 animate-in fade-in duration-200">
            
            {/* Top DID Banner */}
            <div className="bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-900/60 border border-indigo-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl text-white shadow-md shadow-blue-500/20">
                        <Phone size={22} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm sm:text-base font-black text-white tracking-tight">Bluesquare Infra VoIP Softphone</h2>
                            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-[10px] font-black uppercase tracking-wider">
                                Active Line
                            </span>
                        </div>
                        <p className="text-xs text-slate-300 font-medium mt-0.5">
                            Outbound Caller DID: <span className="font-mono font-bold text-white bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700/80 ml-1">+91 79 6548 0905</span>
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end text-[11px] text-slate-400">
                    <ShieldCheck size={14} className="text-blue-400 shrink-0" />
                    <span>In-Browser WebRTC • Auto Audio Recording • AI Summary</span>
                </div>
            </div>

            {/* Main Grid: Dialpad (Left) + Recents (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Dialpad Section (Cols 1-7) */}
                <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-sm space-y-6">
                    
                    {/* Number Display Input */}
                    <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-inner">
                        <div className="flex-1 min-w-0 pr-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">
                                Destination Phone
                            </span>
                            <div className="flex items-center">
                                <span className="text-slate-400 font-mono text-lg sm:text-xl font-bold mr-1.5 select-none">+91</span>
                                <input
                                    type="text"
                                    value={typedNumber}
                                    onChange={(e) => {
                                        const clean = e.target.value.replace(/[^\d*#]/g, '')
                                        setTypedNumber(clean)
                                    }}
                                    placeholder="Enter 10-digit number..."
                                    className="bg-transparent border-none outline-none font-mono text-xl sm:text-2xl font-black text-slate-900 dark:text-white w-full placeholder:text-slate-400/60"
                                    autoFocus
                                />
                            </div>
                        </div>

                        {typedNumber && (
                            <button
                                onClick={() => setTypedNumber(prev => prev.slice(0, -1))}
                                className="p-2.5 text-slate-400 hover:text-rose-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                                title="Backspace"
                            >
                                <Delete size={20} />
                            </button>
                        )}
                    </div>

                    {/* Matched Lead Indicator Banner */}
                    {matchedLead ? (
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-3.5 flex items-center justify-between gap-3 animate-in fade-in duration-200">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-2 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
                                    <User size={16} />
                                </div>
                                <div className="min-w-0">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                                        Matched CRM Lead
                                    </span>
                                    <p className="text-xs font-black text-slate-900 dark:text-white truncate">
                                        {matchedLead.name}
                                    </p>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                        Stage: <strong className="text-indigo-600 dark:text-indigo-400">{matchedLead.pipeline_stage || 'New Lead'}</strong>
                                    </span>
                                </div>
                            </div>
                            <Link
                                href={`/dashboard/crm/${matchedLead.id}${impersonateId ? `?impersonate=${impersonateId}` : ''}`}
                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white dark:hover:bg-slate-800 rounded-xl transition-all shadow-sm shrink-0"
                                title="Open Lead Profile"
                            >
                                <ArrowRight size={16} />
                            </Link>
                        </div>
                    ) : typedNumber.length >= 10 && !isSearchingLead ? (
                        <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-3 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                            <span>Number not in CRM. Call will be logged as manual softphone session.</span>
                        </div>
                    ) : null}

                    {/* 3x4 Dialpad Buttons */}
                    <div className="grid grid-cols-3 gap-3">
                        {DIALPAD_BUTTONS.map(({ digit, sub }) => (
                            <button
                                key={digit}
                                onClick={() => handleDigitClick(digit)}
                                className="py-3.5 sm:py-4 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/70 dark:hover:bg-slate-700/80 active:scale-95 border border-slate-200/60 dark:border-slate-700/50 rounded-2xl transition-all flex flex-col items-center justify-center cursor-pointer shadow-sm group"
                            >
                                <span className="font-mono text-xl sm:text-2xl font-black text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                    {digit}
                                </span>
                                {sub && (
                                    <span className="text-[9px] font-bold text-slate-400 tracking-widest mt-0.5">
                                        {sub}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Big Call Button */}
                    <button
                        onClick={handleCall}
                        disabled={!typedNumber.trim()}
                        className="w-full py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white font-extrabold text-sm sm:text-base rounded-2xl transition-all shadow-lg shadow-emerald-600/30 active:scale-95 flex items-center justify-center gap-2.5 cursor-pointer disabled:cursor-not-allowed"
                    >
                        <Phone size={20} className="fill-current" />
                        <span>Call via Bluesquare Line (+91 79 6548 0905)</span>
                    </button>
                </div>

                {/* Recent Calls Log (Cols 8-12) */}
                <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-indigo-600 dark:text-indigo-400" />
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                Recent VoIP Calls & AI Summaries
                            </h3>
                        </div>
                        <button
                            onClick={fetchRecentCalls}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                            title="Refresh Recents"
                        >
                            <RefreshCw size={14} className={isLoadingRecents ? 'animate-spin' : ''} />
                        </button>
                    </div>

                    {recentCalls.length === 0 ? (
                        <div className="text-center py-12 text-slate-400 text-xs">
                            <History size={28} className="mx-auto mb-2 opacity-40" />
                            <p>No recent VoIP calls logged yet.</p>
                            <p className="text-[11px] text-slate-500 mt-1">Dial a number above to start a browser call.</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                            {recentCalls.map((call) => (
                                <div
                                    key={call.id}
                                    className="p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-700/50 rounded-2xl transition-all flex items-start justify-between gap-3 group"
                                >
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-center gap-2">
                                            {call.leadId ? (
                                                <Link
                                                    href={`/dashboard/crm/${call.leadId}${impersonateId ? `?impersonate=${impersonateId}` : ''}`}
                                                    className="font-bold text-xs text-slate-900 dark:text-white hover:text-indigo-600 transition-colors truncate"
                                                >
                                                    {call.name}
                                                </Link>
                                            ) : (
                                                <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                                    {call.name}
                                                </span>
                                            )}
                                            {call.phone && (
                                                <span className="font-mono text-[11px] text-slate-400">
                                                    {call.phone}
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                                            {call.summary}
                                        </p>

                                        <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium pt-0.5">
                                            <span>
                                                {new Date(call.date).toLocaleString([], {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                            {call.recordingUrl && (
                                                <a
                                                    href={call.recordingUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-indigo-500 hover:text-indigo-400 font-bold underline"
                                                >
                                                    🎙️ Audio
                                                </a>
                                            )}
                                        </div>
                                    </div>

                                    {/* Quick Redial Button */}
                                    {call.phone && (
                                        <button
                                            onClick={() => onInitiateCall(call.phone, call.name, call.leadId)}
                                            className="p-2.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-xl transition-all shadow-sm shrink-0 cursor-pointer active:scale-95"
                                            title="Redial this number"
                                        >
                                            <Phone size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>
        </div>
    )
}
