'use client'

import React, { useState } from 'react'
import { 
  Clock, Plus, Play, Pause, Trash2, Edit3, ArrowRight, 
  MessageSquare, Phone, Mail, CheckCircle2, ChevronRight,
  Zap, Calendar, Users, Sliders
} from 'lucide-react'
import { toast } from 'sonner'

export interface SequenceStep {
  id: string
  delay: string
  channel: 'whatsapp' | 'instagram' | 'voice' | 'email'
  title: string
  message: string
  openRate: string
}

export interface DripSequence {
  id: string
  name: string
  description: string
  triggerEvent: string
  enrolledCount: number
  completionRate: string
  isActive: boolean
  steps: SequenceStep[]
}

const DEFAULT_SEQUENCES: DripSequence[] = [
  {
    id: 'seq_investor_vip',
    name: '7-Day High-Net-Worth Investor Nurture Drip',
    description: 'Automated 4-step sequence sent to qualified real estate investors who showed interest in ₹3Cr+ luxury properties.',
    triggerEvent: 'Lead Qualified with Score >= 70% in Flow Builder',
    enrolledCount: 894,
    completionRate: '78.5%',
    isActive: false, // Default PAUSED
    steps: [
      {
        id: 's1',
        delay: 'Immediate (Day 0)',
        channel: 'whatsapp',
        title: 'VIP Portfolio & Floor Plans Delivery',
        message: 'Welcome Mr. {{name}}! Here is the private investment prospectus for Mohali Luxury Enclave.',
        openRate: '98.2%'
      },
      {
        id: 's2',
        delay: '+24 Hours (Day 1)',
        channel: 'whatsapp',
        title: 'Architectural 4K Video Tour & VR Link',
        message: 'Take a virtual walk inside the 4-bedroom sky villa before general public release.',
        openRate: '84.6%'
      },
      {
        id: 's3',
        delay: '+48 Hours (Day 3)',
        channel: 'voice',
        title: 'AI Senior Wealth Advisor Callback',
        message: 'Automated 3-minute consultative voice check-in (Gemini 3.1 Live) to answer payment schedule queries.',
        openRate: '72.1%'
      },
      {
        id: 's4',
        delay: '+96 Hours (Day 7)',
        channel: 'whatsapp',
        title: 'Exclusive Pre-launch Token Reservation',
        message: 'Last 4 inventory slots remaining under builder subsidy. Click to reserve unit with zero deposit.',
        openRate: '64.8%'
      }
    ]
  },
  {
    id: 'seq_candidate_hiring',
    name: 'Candidate Interview & Automated Hiring Drip',
    description: 'Drip pipeline for sales executive & real estate broker applicants who applied via portal or WhatsApp.',
    triggerEvent: 'Applicant triggers "Automated Hiring Pipeline" Flow',
    enrolledCount: 342,
    completionRate: '89.0%',
    isActive: false, // Default PAUSED
    steps: [
      {
        id: 'h1',
        delay: 'Immediate',
        channel: 'whatsapp',
        title: 'Application Receipt & Screening Form',
        message: 'Thank you for applying to Nobogent! Please tap below to answer 3 quick qualification questions.',
        openRate: '96.0%'
      },
      {
        id: 'h2',
        delay: '+4 Hours',
        channel: 'voice',
        title: 'AI First-Round Telephonic Interview',
        message: 'Automated 5-minute voice assessment verifying sales experience, local market knowledge & CTC.',
        openRate: '88.5%'
      },
      {
        id: 'h3',
        delay: '+24 Hours',
        channel: 'whatsapp',
        title: 'Offer Letter or Round-2 HR Invite',
        message: 'Congratulations! You passed the initial assessment. Select your slot for final management meeting.',
        openRate: '82.4%'
      }
    ]
  }
]

interface SequencesViewProps {
  flows: any[]
}

export function SequencesView({ flows }: SequencesViewProps) {
  const [sequences, setSequences] = useState<DripSequence[]>(DEFAULT_SEQUENCES)
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>(DEFAULT_SEQUENCES[0].id)
  const [editingSequence, setEditingSequence] = useState<DripSequence | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  const selectedSeq = sequences.find(s => s.id === selectedSequenceId) || sequences[0]

  const toggleSequence = (id: string) => {
    setSequences(prev => prev.map(s => {
      if (s.id === id) {
        const next = !s.isActive
        toast.success(next ? `Sequence "${s.name}" enabled` : `Sequence "${s.name}" paused`)
        return { ...s, isActive: next }
      }
      return s
    }))
  }

  const handleDelete = (id: string) => {
    setSequences(prev => prev.filter(s => s.id !== id))
    toast.success('Sequence deleted')
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-yellow-500/10 border border-amber-200/80 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shadow-md shadow-amber-500/20 shrink-0">
            <Clock size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900">Multi-Channel Drip Sequences</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full border border-amber-200">
                Automated Drips
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Automate multi-day follow-ups over WhatsApp, Voice calls, Instagram DM, and Email based on delays to convert cold prospects into booked appointments.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            const newSeq: DripSequence = {
              id: `seq_${Date.now()}`,
              name: 'New Follow-Up Campaign',
              description: 'Custom multi-step automated drip sequence',
              triggerEvent: 'When contact enters tag "New Lead"',
              enrolledCount: 0,
              completionRate: '0%',
              isActive: false, // Default PAUSED
              steps: [
                {
                  id: 's_new_1',
                  delay: 'Immediate',
                  channel: 'whatsapp',
                  title: 'Welcome Message',
                  message: 'Hello! Thank you for reaching out.',
                  openRate: '100%'
                }
              ]
            }
            setSequences([newSeq, ...sequences])
            setSelectedSequenceId(newSeq.id)
            toast.success('New sequence created')
          }}
          className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-bold text-xs rounded-xl shadow-sm cursor-pointer shrink-0"
        >
          <Plus size={15} />
          <span>New Drip Sequence</span>
        </button>
      </div>

      {/* Main Grid: Left sequence selector, Right timeline view */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: Sequence list */}
        <div className="lg:col-span-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">
            Active Follow-up Sequences ({sequences.length})
          </div>

          <div className="space-y-2.5">
            {sequences.map(seq => (
              <div
                key={seq.id}
                onClick={() => setSelectedSequenceId(seq.id)}
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                  selectedSequenceId === seq.id
                    ? 'border-amber-500 bg-white ring-2 ring-amber-400/20 shadow-sm'
                    : 'border-slate-200/80 hover:border-slate-300 bg-white shadow-2xs'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{seq.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{seq.description}</p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border shrink-0 ${
                    seq.isActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>
                    {seq.isActive ? 'Active' : 'Paused'}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
                  <span className="text-slate-500 font-medium">
                    {seq.steps.length} Steps • {seq.enrolledCount} Enrolled
                  </span>
                  <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md">
                    {seq.completionRate} Comp Rate
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: Selected sequence timeline steps */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-5">
          {selectedSeq ? (
            <>
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-slate-900">{selectedSeq.name}</h2>
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                      selectedSeq.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {selectedSeq.isActive ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{selectedSeq.description}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 w-fit">
                    <Zap size={13} />
                    <span>Trigger: {selectedSeq.triggerEvent}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleSequence(selectedSeq.id)}
                    className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      selectedSeq.isActive
                        ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    }`}
                    title={selectedSeq.isActive ? 'Pause Sequence' : 'Activate Sequence'}
                  >
                    {selectedSeq.isActive ? <Pause size={15} /> : <Play size={15} />}
                  </button>

                  <button
                    onClick={() => handleDelete(selectedSeq.id)}
                    className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Delete sequence"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Steps timeline */}
              <div className="space-y-4 relative before:absolute before:left-5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                {selectedSeq.steps.map((step, idx) => (
                  <div key={step.id} className="relative pl-12">
                    {/* Circle icon */}
                    <div className="absolute left-3 top-2 -translate-x-1/2 w-6 h-6 rounded-full bg-white border-2 border-amber-500 text-amber-600 flex items-center justify-center font-bold text-[10px] shadow-2xs">
                      {idx + 1}
                    </div>

                    <div className="bg-slate-50 hover:bg-slate-100/70 p-4 rounded-xl border border-slate-200/80 space-y-2 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded-md">
                            ⏳ {step.delay}
                          </span>
                          <span className="text-xs font-bold text-slate-900">{step.title}</span>
                        </div>
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          {step.openRate} Open Rate
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed">
                        {step.message}
                      </p>

                      <div className="flex items-center gap-2 pt-1 text-[11px] font-semibold text-slate-400">
                        <span className="capitalize">Channel: {step.channel}</span>
                        <span>•</span>
                        <span>Auto-delivered 24/7</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-slate-400 text-xs">
              Select a sequence on the left to view steps
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
