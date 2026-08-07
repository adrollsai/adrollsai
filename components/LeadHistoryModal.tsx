'use client'

import React, { useState, useEffect } from 'react'
import { X, History, Clock, User, Phone, MessageSquare, AlertCircle, RefreshCw, FileText } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface LeadHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  lead: any
}

export default function LeadHistoryModal({ isOpen, onClose, lead }: LeadHistoryModalProps) {
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (isOpen && lead?.id) {
      fetchHistory()
    }
  }, [isOpen, lead?.id])

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('lead_history')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
      
      setHistoryItems(data || [])
    } catch (err) {
      console.error("Failed to fetch lead history timeline:", err)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !lead) return null

  // Format date/time
  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleString([], {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    } catch (e) {
      return dateStr
    }
  }

  // Extract initial for avatar
  const getInitial = (name: string) => {
    if (!name) return 'U'
    return name.trim().charAt(0).toUpperCase()
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200 pb-24 sm:pb-8">
      <div className="relative w-full max-w-3xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[88vh]">
        
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 truncate">
                History Timeline - {lead.name || 'Unnamed Lead'}
              </h3>
              <p className="text-xs text-slate-500 truncate">Phone: {lead.phone || 'N/A'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-6">
          <div className="text-center border-b border-slate-100 pb-3">
            <h4 className="text-base font-extrabold text-slate-700 uppercase tracking-wide">Lead History</h4>
          </div>

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="text-xs font-semibold">Loading timeline records...</span>
            </div>
          ) : historyItems.length === 0 ? (
            /* Synthetic / Initial Creation Item if no DB history yet */
            <div className="relative pl-8 border-l-2 border-emerald-500/40 space-y-6 my-4">
              <div className="relative">
                <span className="absolute -left-[39px] top-1 w-3.5 h-3.5 rounded-full border-2 border-emerald-500 bg-white" />
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center border border-amber-300">
                    {getInitial(lead.user_name || 'System')}
                  </div>
                  <span className="font-bold text-xs text-slate-700">{lead.user_name || 'System / Agent'}</span>
                  <span className="text-xs text-slate-400">{formatDateTime(lead.created_at)}</span>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl space-y-1.5 text-xs text-slate-700 font-medium">
                  <p className="font-extrabold text-sm text-slate-900">Lead Created from {lead.source || 'Facebook'}</p>
                  <div><strong>Lead Name :</strong> {lead.name || 'N/A'}</div>
                  <div><strong>Contact no :</strong> {lead.phone || 'N/A'}</div>
                  {lead.email && <div><strong>Email :</strong> {lead.email}</div>}
                  <div><strong>Lead Source :</strong> {lead.source || 'Facebook'}</div>
                  <div><strong>Source Details :</strong> {lead.ad_name || lead.form_name || lead.campaign_name || 'Meta Ad'}</div>
                  <div><strong>Lead Status :</strong> {lead.pipeline_stage || 'New Lead'}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative pl-8 border-l-2 border-emerald-500/40 space-y-6 my-4">
              {historyItems.map((item, idx) => {
                const actorName = item.actor_name || item.performed_by || lead.user_name || 'Agent';
                return (
                  <div key={item.id || idx} className="relative">
                    {/* Circle Bullet on Timeline */}
                    <span className="absolute -left-[39px] top-1 w-3.5 h-3.5 rounded-full border-2 border-emerald-500 bg-white" />

                    {/* Actor Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center border border-amber-300">
                        {getInitial(actorName)}
                      </div>
                      <span className="font-bold text-xs text-slate-800">{actorName}</span>
                      <span className="text-xs text-slate-400">{formatDateTime(item.created_at)}</span>
                    </div>

                    {/* Event Detail Card */}
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1.5 text-xs text-slate-700 font-medium leading-relaxed">
                      <p className="font-extrabold text-sm text-slate-900">{item.action_type || item.title || 'Followup Event'}</p>

                      {item.description && (
                        <p className="text-slate-800 whitespace-pre-wrap">{item.description}</p>
                      )}

                      {/* Structured Details */}
                      {item.details && typeof item.details === 'object' && (
                        <div className="space-y-1 pt-1 border-t border-slate-200/60 mt-2">
                          {Object.entries(item.details).map(([k, v]) => (
                            <div key={k}>
                              <strong className="capitalize">{k.replace(/_/g, ' ')} :</strong> {String(v)}
                            </div>
                          ))}
                        </div>
                      )}

                      {!item.details && (
                        <div className="space-y-0.5 pt-1 text-slate-600">
                          <div><strong>Lead Name :</strong> {lead.name || 'N/A'}</div>
                          <div><strong>Contact no :</strong> {lead.phone || 'N/A'}</div>
                          <div><strong>Lead Status :</strong> {item.new_stage || lead.pipeline_stage || 'New Lead'}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  )
}
