'use client'

import { useState } from 'react'
import { Zap, Users, TrendingUp, Bell, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export default function NotificationTester() {
  const [loading, setLoading] = useState<string | null>(null)

  const trigger = async (type: string) => {
    setLoading(type)
    try {
      await fetch('/api/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, delay: 0 }), // Instant
      })
      toast.success(`Sent ${type.toUpperCase()} alert!`)
    } catch (e) {
      toast.error("Failed to send")
    } finally {
      setLoading(null)
    }
  }

  const triggerBackground = async () => {
    setLoading('bg')
    toast.info("Close app now! Wait 5 seconds...")
    try {
        await fetch('/api/test-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'lead', delay: 5 }), // 5s Delay
            keepalive: true
        })
    } catch (e) { console.error(e) }
    setLoading(null)
  }

  return (
    <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100 mt-6">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Notification Simulator</h3>
      
      <div className="grid grid-cols-2 gap-3">
        {/* LEAD ALERT */}
        <button 
          onClick={() => trigger('lead')}
          disabled={!!loading}
          className="flex items-center gap-2 p-3 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 transition-colors"
        >
          {loading === 'lead' ? <Loader2 size={16} className="animate-spin"/> : <Users size={16} />}
          New Lead
        </button>

        {/* RIVALRY ALERT */}
        <button 
          onClick={() => trigger('rivalry')}
          disabled={!!loading}
          className="flex items-center gap-2 p-3 rounded-xl bg-purple-50 text-purple-700 text-xs font-bold hover:bg-purple-100 transition-colors"
        >
          {loading === 'rivalry' ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16} />}
          Rank Up
        </button>

        {/* ROI ALERT */}
        <button 
          onClick={() => trigger('roi')}
          disabled={!!loading}
          className="flex items-center gap-2 p-3 rounded-xl bg-green-50 text-green-700 text-xs font-bold hover:bg-green-100 transition-colors"
        >
          {loading === 'roi' ? <Loader2 size={16} className="animate-spin"/> : <TrendingUp size={16} />}
          High ROI
        </button>

        {/* BACKGROUND TEST */}
        <button 
          onClick={triggerBackground}
          disabled={!!loading}
          className="flex items-center gap-2 p-3 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
        >
          {loading === 'bg' ? <Loader2 size={16} className="animate-spin"/> : <Bell size={16} />}
          Background (5s)
        </button>
      </div>
    </div>
  )
}