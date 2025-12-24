'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Phone, User, FileText, Play, Loader2, Plus, Trash2, RefreshCw } from 'lucide-react'

export default function CallingPage() {
  const [calls, setCalls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [newCall, setNewCall] = useState({ name: '', phone_number: '', notes: '' })
  const [adding, setAdding] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    fetchCalls()
  }, [])

  const fetchCalls = async () => {
    setLoading(true)
    const { data } = await supabase.from('calls').select('*').order('created_at', { ascending: false })
    if (data) setCalls(data)
    setLoading(false)
  }

  const handleAddCall = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      await supabase.from('calls').insert({
        user_id: user.id,
        name: newCall.name,
        phone_number: newCall.phone_number,
        notes: newCall.notes,
        status: 'pending'
      })
      setNewCall({ name: '', phone_number: '', notes: '' })
      fetchCalls()
    }
    setAdding(false)
  }

  const triggerCall = async (callId: string, phone: string, name: string, notes: string) => {
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, status: 'calling' } : c))

    try {
      const response = await fetch('/api/calling/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, phone, name, notes }),
      })

      if (!response.ok) throw new Error('Call failed')
      
      // Refresh status after 2 seconds to catch immediate changes
      setTimeout(fetchCalls, 2000)
    } catch (error) {
      console.error(error)
      setCalls(prev => prev.map(c => c.id === callId ? { ...c, status: 'failed' } : c))
    }
  }

  const deleteCall = async (id: string) => {
    const originalCalls = [...calls]
    setCalls(calls.filter(c => c.id !== id))

    const { error } = await supabase.from('calls').delete().eq('id', id)
    
    if (error) {
      console.error("Delete failed", error)
      alert("Could not delete item. Check console.")
      setCalls(originalCalls)
    }
  }

  return (
    // Added pb-32 to make space for the "Dog" (Floating Agent) at the bottom
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full pb-32">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <div className="p-2 bg-black rounded-lg">
              <Phone className="w-6 h-6 text-white" />
            </div>
            AI Calling Agent
          </h1>
          <p className="text-gray-500 mt-1">Manage your automated calling queue.</p>
        </div>
        <button 
          onClick={fetchCalls}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Add New Call Form */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8">
        <form onSubmit={handleAddCall} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Name</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                required
                className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                placeholder="Ex: Rahul"
                value={newCall.name}
                onChange={e => setNewCall({...newCall, name: e.target.value})}
              />
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Phone (+91...)</label>
            <div className="relative">
              <Phone className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                required
                className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                placeholder="+91..."
                value={newCall.phone_number}
                onChange={e => setNewCall({...newCall, phone_number: e.target.value})}
              />
            </div>
          </div>
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Call Context</label>
            <div className="relative">
              <FileText className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                placeholder="Ex: Discuss property prices..."
                value={newCall.notes}
                onChange={e => setNewCall({...newCall, notes: e.target.value})}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <button 
              disabled={adding}
              className="w-full bg-black text-white h-[42px] rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Add</>}
            </button>
          </div>
        </form>
      </div>

      {/* List - Wrapped with overflow handling */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left py-4 px-6 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-gray-500 uppercase">Phone</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-gray-500 uppercase w-1/3">Context</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right py-4 px-6 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {calls.map((call) => (
                <tr key={call.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-4 px-6 font-medium text-gray-900">{call.name}</td>
                  <td className="py-4 px-6 text-gray-600 font-mono text-sm">{call.phone_number}</td>
                  <td className="py-4 px-6 text-gray-600 text-sm max-w-xs truncate" title={call.notes}>
                    {call.notes}
                  </td>
                  <td className="py-4 px-6">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                      ${call.status === 'completed' ? 'bg-green-100 text-green-800' :
                        call.status === 'calling' ? 'bg-blue-100 text-blue-800 animate-pulse' :
                        call.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                      {call.status}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => triggerCall(call.id, call.phone_number, call.name, call.notes)}
                        disabled={call.status === 'calling'}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Start Call"
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                      <button
                        onClick={() => deleteCall(call.id)}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}