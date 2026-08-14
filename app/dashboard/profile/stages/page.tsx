'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, Plus, Trash2, Check, Sparkles, RefreshCw, 
  Activity, ShieldCheck, HelpCircle, Layers, Sliders, Save, AlertCircle 
} from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_PIPELINE_STAGES, PipelineStageConfig } from '@/utils/pipeline-stages'

const CAPI_STANDARD_EVENTS = [
  'Lead',
  'Schedule',
  'Contact',
  'CompleteRegistration',
  'InitiateCheckout',
  'Purchase',
  'ViewContent',
  'Custom'
]

export default function PipelineStagesPage() {
  const router = useRouter()
  const [stages, setStages] = useState<PipelineStageConfig[]>(DEFAULT_PIPELINE_STAGES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageCategory, setNewStageCategory] = useState<'fresh' | 'ongoing' | 'not_interested'>('ongoing')
  const [newStageEnableCapi, setNewStageEnableCapi] = useState(false)
  const [newStageCapiEvent, setNewStageCapiEvent] = useState('Schedule')

  useEffect(() => {
    const fetchStages = async () => {
      setLoading(true)
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const imp = urlParams.get('impersonate')
        const res = await fetch(`/api/profile/pipeline-stages${imp ? `?impersonate=${imp}` : ''}`)
        if (res.ok) {
          const data = await res.json()
          if (data.stages && Array.isArray(data.stages) && data.stages.length > 0) {
            setStages(data.stages)
          }
        }
      } catch (e) {
        console.error('Failed to load pipeline stages:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchStages()
  }, [])

  const handleSave = async (updatedStages = stages) => {
    setSaving(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const imp = urlParams.get('impersonate')
      const res = await fetch('/api/profile/pipeline-stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: updatedStages, impersonateId: imp })
      })
      if (res.ok) {
        toast.success('Pipeline stages and Meta CAPI settings saved successfully!')
        setStages(updatedStages)
      } else {
        const err = await res.json().catch(() => null)
        toast.error(err?.error || 'Failed to save pipeline stages')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Error saving pipeline stages')
    } finally {
      setSaving(false)
    }
  }

  const handleAddStage = () => {
    if (!newStageName.trim()) {
      toast.error('Please enter a stage name')
      return
    }

    if (stages.some(s => s.name.trim().toLowerCase() === newStageName.trim().toLowerCase())) {
      toast.error('A stage with this name already exists')
      return
    }

    const id = newStageName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const newStage: PipelineStageConfig = {
      id: id || `stage_${Date.now()}`,
      name: newStageName.trim(),
      category: newStageCategory,
      enableCapi: newStageEnableCapi,
      capiEventName: newStageEnableCapi ? newStageCapiEvent : undefined,
      isCustom: true
    }

    const updated = [...stages, newStage]
    setStages(updated)
    setIsAddingNew(false)
    setNewStageName('')
    setNewStageCategory('ongoing')
    setNewStageEnableCapi(false)
    handleSave(updated)
  }

  const handleDeleteStage = (id: string) => {
    if (stages.length <= 1) {
      toast.error('You must keep at least one pipeline stage')
      return
    }
    const target = stages.find(s => s.id === id)
    if (!confirm(`Are you sure you want to delete stage "${target?.name}"?`)) return

    const updated = stages.filter(s => s.id !== id)
    setStages(updated)
    handleSave(updated)
  }

  const handleToggleCapi = (id: string) => {
    const updated = stages.map(s => {
      if (s.id === id) {
        const nextState = !s.enableCapi
        return {
          ...s,
          enableCapi: nextState,
          capiEventName: nextState ? (s.capiEventName || s.name) : s.capiEventName
        }
      }
      return s
    })
    setStages(updated)
    handleSave(updated)
  }

  const handleUpdateCapiEventName = (id: string, eventName: string) => {
    const updated = stages.map(s => {
      if (s.id === id) {
        return { ...s, capiEventName: eventName }
      }
      return s
    })
    setStages(updated)
  }

  const handleUpdateCategory = (id: string, category: 'fresh' | 'ongoing' | 'not_interested') => {
    const updated = stages.map(s => {
      if (s.id === id) {
        return { ...s, category }
      }
      return s
    })
    setStages(updated)
    handleSave(updated)
  }

  const handleResetToDefaults = () => {
    if (!confirm('Reset all pipeline stages to standard real estate defaults? Any custom stages will be removed.')) return
    setStages(DEFAULT_PIPELINE_STAGES)
    handleSave(DEFAULT_PIPELINE_STAGES)
  }

  const freshCount = stages.filter(s => s.category === 'fresh').length
  const ongoingCount = stages.filter(s => s.category === 'ongoing').length
  const notInterestedCount = stages.filter(s => s.category === 'not_interested').length
  const capiActiveCount = stages.filter(s => s.enableCapi).length

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/profile"
              className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2">
              <Layers className="text-blue-500" /> Pipeline Stages & Meta CAPI
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 pl-11">
            Customize stages for your business, organize into <strong>Fresh</strong>, <strong>Ongoing</strong>, and <strong>Not Interested</strong>, and configure automatic <strong>Meta Conversion API (CAPI)</strong> events.
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={handleResetToDefaults}
            className="px-3.5 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-bold text-slate-300 transition-colors flex items-center gap-1.5"
            title="Reset to Real Estate Defaults"
          >
            <RefreshCw size={13} />
            <span>Reset Defaults</span>
          </button>
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-extrabold shadow-lg shadow-blue-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <Save size={14} />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Stages</span>
          <span className="text-2xl font-black text-white mt-0.5 block">{stages.length}</span>
        </div>
        <div className="bg-blue-950/40 border border-blue-800/50 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">Fresh Bucket</span>
          <span className="text-2xl font-black text-blue-300 mt-0.5 block">{freshCount}</span>
        </div>
        <div className="bg-indigo-950/40 border border-indigo-800/50 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">Ongoing Bucket</span>
          <span className="text-2xl font-black text-indigo-300 mt-0.5 block">{ongoingCount}</span>
        </div>
        <div className="bg-emerald-950/40 border border-emerald-800/50 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">Meta CAPI Triggers</span>
          <span className="text-2xl font-black text-emerald-400 mt-0.5 block">{capiActiveCount} Active</span>
        </div>
      </div>

      {/* Main Stages Table & Editor */}
      <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-5 sm:p-7 shadow-xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-white">Configured Stages</h2>
            <p className="text-xs text-slate-400">Map stages to their primary section in CRM and set Meta CAPI dispatch rules.</p>
          </div>
          <button
            onClick={() => setIsAddingNew(!isAddingNew)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            <Plus size={14} />
            <span>Add Custom Stage</span>
          </button>
        </div>

        {/* Add Stage Form Drawer */}
        {isAddingNew && (
          <div className="bg-slate-900 border border-blue-500/40 p-4 sm:p-5 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2">
            <h3 className="text-sm font-black text-blue-400 flex items-center gap-1.5">
              <Plus size={14} /> Create New Pipeline Stage
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Stage Name</label>
                <input
                  type="text"
                  placeholder="e.g. Virtual Demo Done"
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-xs font-bold text-white rounded-xl px-3 py-2.5 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">CRM Section</label>
                <select
                  value={newStageCategory}
                  onChange={(e) => setNewStageCategory(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 text-xs font-bold text-white rounded-xl px-3 py-2.5 outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="ongoing">Ongoing (Active Pipeline)</option>
                  <option value="fresh">Fresh (New Leads)</option>
                  <option value="not_interested">Not Interested / Lost</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Meta CAPI Trigger</label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 font-bold cursor-pointer py-2">
                    <input
                      type="checkbox"
                      checked={newStageEnableCapi}
                      onChange={(e) => setNewStageEnableCapi(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0 cursor-pointer"
                    />
                    <span>Send to Meta</span>
                  </label>
                  {newStageEnableCapi && (
                    <input
                      type="text"
                      placeholder="Event Name"
                      value={newStageCapiEvent}
                      onChange={(e) => setNewStageCapiEvent(e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 text-xs font-bold text-white rounded-xl px-3 py-2 outline-none focus:border-blue-500"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsAddingNew(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleAddStage}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold"
              >
                Save & Add Stage
              </button>
            </div>
          </div>
        )}

        {/* Stages List */}
        <div className="overflow-x-auto border border-slate-700/80 rounded-2xl bg-slate-900/60">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800/80 border-b border-slate-700 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Stage Name</th>
                <th className="py-3 px-4">CRM Primary Section</th>
                <th className="py-3 px-4">Meta Conversion API (CAPI)</th>
                <th className="py-3 px-4">Meta Event Name</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {stages.map((stage) => {
                return (
                  <tr key={stage.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                        <span>{stage.name}</span>
                        {stage.isCustom && (
                          <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-extrabold text-[9px]">Custom</span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <select
                        value={stage.category}
                        onChange={(e) => handleUpdateCategory(stage.id, e.target.value as any)}
                        className={`border rounded-lg text-xs font-black py-1 px-2 cursor-pointer outline-none ${
                          stage.category === 'fresh'
                            ? 'bg-blue-500/10 border-blue-500/40 text-blue-300'
                            : stage.category === 'ongoing'
                            ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300'
                            : 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                        }`}
                      >
                        <option value="fresh" className="bg-slate-900 text-white">Fresh Leads</option>
                        <option value="ongoing" className="bg-slate-900 text-white">Ongoing Pipeline</option>
                        <option value="not_interested" className="bg-slate-900 text-white">Not Interested / Lost</option>
                      </select>
                    </td>

                    <td className="py-3 px-4">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!stage.enableCapi}
                          onChange={() => handleToggleCapi(stage.id)}
                          className="w-4 h-4 rounded text-emerald-500 focus:ring-0 cursor-pointer"
                        />
                        <span className={`text-xs font-bold ${stage.enableCapi ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {stage.enableCapi ? '⚡ Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </td>

                    <td className="py-3 px-4">
                      {stage.enableCapi ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={stage.capiEventName || stage.name}
                            onChange={(e) => handleUpdateCapiEventName(stage.id, e.target.value)}
                            onBlur={() => handleSave()}
                            placeholder="e.g. Schedule"
                            className="bg-slate-800 border border-slate-700 text-xs font-bold text-emerald-300 rounded-lg px-2.5 py-1 outline-none focus:border-emerald-500 max-w-[150px]"
                          />
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic">Not Dispatched</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDeleteStage(stage.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete Stage"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
