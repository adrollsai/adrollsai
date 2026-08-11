'use client'

import { useState, useEffect } from 'react'
import { 
  Sparkles, 
  Plus, 
  Trash2, 
  Loader2, 
  ArrowLeft,
  Info,
  CheckCircle2,
  ListTodo
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { getCachedValue, setCachedValue } from '@/utils/client-cache'

export default function QualifyingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  const [loading, setLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('qualifying_cache')
      if (cached) return false
    }
    return true
  })
  const [isSaving, setIsSaving] = useState(false)
  const [qualifyingEnabled, setQualifyingEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('qualifying_cache')
      if (cached) return cached.qualifyingEnabled || false
    }
    return false
  })
  const [qualifyingQuestions, setQualifyingQuestions] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('qualifying_cache')
      if (cached?.qualifyingQuestions) return cached.qualifyingQuestions
    }
    return []
  })
  const [newQuestionText, setNewQuestionText] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('admin')

  useEffect(() => {
    async function loadData() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/')
          return
        }

        // Get effective user ID (support impersonation)
        let targetUserId = session.user.id
        
        // Fetch session user role
        const { data: authProfile } = await supabase
          .from('profiles')
          .select('role, agency_id, parent_id')
          .eq('id', session.user.id)
          .single()
        
        const currentRole = authProfile?.role || 'admin'
        setUserRole(currentRole)

        if (impersonateId && ['super_admin', 'agency'].includes(currentRole)) {
          targetUserId = impersonateId
        }

        setUserId(targetUserId)

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('qualifying_enabled, qualifying_questions')
          .eq('id', targetUserId)
          .single()

        if (error) throw error

        if (profile) {
          setQualifyingEnabled(profile.qualifying_enabled || false)
          setQualifyingQuestions(profile.qualifying_questions || [])
          // Persist to localStorage
          setCachedValue('qualifying_cache', {
            qualifyingEnabled: profile.qualifying_enabled || false,
            qualifyingQuestions: profile.qualifying_questions || []
          })
        }
      } catch (err) {
        console.error("Failed to load qualification settings:", err)
        toast.error("Failed to load settings")
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [impersonateId])

  const handleSave = async () => {
    if (!userId) return
    setIsSaving(true)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          qualifying_enabled: qualifyingEnabled,
          qualifying_questions: qualifyingQuestions
        })
        .eq('id', userId)

      if (error) throw error
      toast.success("AI Qualification Settings saved successfully!")
    } catch (err) {
      console.error("Failed to save settings:", err)
      toast.error("Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddQuestion = () => {
    if (!newQuestionText.trim()) return
    setQualifyingQuestions([...qualifyingQuestions, newQuestionText.trim()])
    setNewQuestionText('')
  }

  const handleRemoveQuestion = (idx: number) => {
    setQualifyingQuestions(qualifyingQuestions.filter((_, i) => i !== idx))
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors active:scale-95 shrink-0 border border-slate-200"
        >
          <ArrowLeft size={16} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">AI Qualification Questions</h1>
          <p className="text-xs text-slate-500 font-medium">Manage sequential questions asked by your AI calling agent and WhatsApp bot before lead creation.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Toggle Panel */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white rounded-[2rem] border border-slate-200 p-6 shadow-sm flex flex-col justify-between h-full min-h-[300px]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-800">Status Toggle</h3>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Configure Flow Status</p>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100/50 rounded-2xl border border-slate-150 transition-colors cursor-pointer">
                  <span className="text-xs font-bold text-slate-700">Enable AI Qualification</span>
                  <div className="relative inline-flex items-center">
                    <input 
                      type="checkbox" 
                      checked={qualifyingEnabled} 
                      onChange={(e) => setQualifyingEnabled(e.target.checked)}
                      disabled={userRole === 'agent'}
                      className="sr-only peer" 
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                </label>
              </div>

              <div className="bg-amber-50/50 rounded-2xl p-4 border border-amber-100/70 text-slate-700 text-xs font-medium space-y-2">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    When active, the AI outbound agent and WhatsApp bot will sequentially ask these questions to the lead.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Answers are automatically parsed and structured inside the lead's CRM record.
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 mt-6">
              <button
                onClick={handleSave}
                disabled={isSaving || userRole === 'agent'}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3 px-5 rounded-full transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                {isSaving ? 'Saving Settings...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>

        {/* Questions Panel */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-[2rem] border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                <ListTodo size={20} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-800">Sequential Questions</h3>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Lead Information Checklist</p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              {qualifyingQuestions.length === 0 ? (
                <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <p className="text-xs text-slate-400 italic font-medium">No questions added yet. Build your sequence sequence.</p>
                </div>
              ) : (
                qualifyingQuestions.map((q, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 bg-slate-50/50 hover:bg-slate-50 p-4 rounded-2xl border border-slate-200/60 transition-colors">
                    <span className="text-xs text-slate-700 font-semibold leading-relaxed">
                      <strong className="text-blue-600 mr-2">{idx + 1}.</strong> {q}
                    </span>
                    <button
                      type="button"
                      disabled={userRole === 'agent'}
                      onClick={() => handleRemoveQuestion(idx)}
                      className="text-slate-400 hover:text-red-500 p-1.5 transition-colors shrink-0 rounded-lg hover:bg-slate-100 active:scale-90"
                      title="Remove question"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {userRole !== 'agent' && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddQuestion();
                    }
                  }}
                  placeholder="e.g. What budget do you have allocated for marketing?"
                  className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-xs font-semibold outline-none border border-slate-200 focus:border-blue-400 transition-all shadow-xs"
                />
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-6 py-3.5 rounded-2xl shadow-md transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
                >
                  <Plus size={14} /> Add
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
