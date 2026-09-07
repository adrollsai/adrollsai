'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { 
  Workflow, 
  MessageSquare, 
  Layers, 
  Clock, 
  BarChart3, 
  Sparkles, 
  Plus, 
  ArrowLeft,
  ChevronRight,
  Zap,
  PhoneCall
} from 'lucide-react'

// Custom SVG Icons for Instagram & Facebook for pixel perfection
export function InstagramIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

export function FacebookIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  )
}

export type SuiteTabType = 'flows' | 'ai_calling' | 'dm' | 'ig_comments' | 'fb_comments' | 'sequences' | 'analytics'

interface SuiteHeaderProps {
  activeTab: SuiteTabType
  onSelectTab: (tab: SuiteTabType) => void
  impersonateId: string | null
  onOpenAiArchitect: () => void
  onCreateBlankFlow: () => void
  onOpenCreateModal?: () => void
  totalActiveCount: number
  isSuperAdmin?: boolean
}

export function SuiteHeader({
  activeTab,
  onSelectTab,
  impersonateId,
  onOpenAiArchitect,
  onCreateBlankFlow,
  onOpenCreateModal,
  totalActiveCount,
  isSuperAdmin = false
}: SuiteHeaderProps) {
  const router = useRouter()

  const allTabs: { id: SuiteTabType; label: string; icon: React.ElementType; badge?: string; desc: string }[] = [
    {
      id: 'flows',
      label: 'Flows',
      icon: Workflow,
      desc: 'Visual Canvas Flow Builder & Studio'
    },
    {
      id: 'ai_calling',
      label: 'AI Calling',
      icon: PhoneCall,
      badge: 'Gemini Live',
      desc: 'Outbound telecalling & voice qualification'
    },
    {
      id: 'dm',
      label: 'DM Automations',
      icon: MessageSquare,
      desc: 'Keyword triggers & auto-responses'
    },
    {
      id: 'ig_comments',
      label: 'Instagram Comments',
      icon: InstagramIcon,
      badge: 'Meta API',
      desc: 'Reel & post comment-to-DM flows'
    },
    {
      id: 'fb_comments',
      label: 'Facebook Comments',
      icon: FacebookIcon,
      desc: 'Page & Ad comment automations'
    },
    {
      id: 'sequences',
      label: 'Drip Sequences',
      icon: Clock,
      desc: 'Time-delayed follow-up campaigns'
    },
    {
      id: 'analytics',
      label: 'Unified Analytics',
      icon: BarChart3,
      desc: 'Cross-channel metrics & live feed'
    }
  ]

  const tabs = allTabs.filter(t => isSuperAdmin ? true : t.id !== 'flows')

  return (
    <div className="bg-white border-b border-slate-200/90 sticky top-0 z-30 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.04)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top bar with breadcrumb & actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-5 pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <button
                onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ArrowLeft size={13} /> Dashboard
              </button>
              <span className="text-slate-300">/</span>
              <span className="text-xs font-bold text-slate-800">Automations Suite</span>
              <span className="text-[10px] font-black uppercase tracking-wider bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full border border-violet-200">
                PRO
              </span>
            </div>

            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                Automations
              </h1>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-bold border border-slate-200">
                <span className={`w-2 h-2 rounded-full ${totalActiveCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
                <span>{totalActiveCount} Active</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSuperAdmin
                ? 'All-in-one marketing & lead conversion automation: Visual flow builder, AI Calling, DM triggers, comment auto-responders & drip sequences.'
                : 'All-in-one marketing & lead conversion automation: AI Calling, DM triggers, comment auto-responders & drip sequences.'}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {activeTab === 'flows' ? (
              <>
                <button
                  onClick={onOpenAiArchitect}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
                >
                  <Sparkles size={15} />
                  <span>AI Flow Architect</span>
                </button>
                <button
                  onClick={onCreateBlankFlow}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs sm:text-sm rounded-xl transition-all shadow-2xs active:scale-95 cursor-pointer"
                >
                  <Plus size={15} />
                  <span>New Flow</span>
                </button>
              </>
            ) : (
              <button
                onClick={onOpenCreateModal}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
              >
                <Plus size={15} />
                <span>
                  {activeTab === 'ai_calling' && 'New Calling Rule'}
                  {activeTab === 'dm' && 'New DM Automation'}
                  {activeTab === 'ig_comments' && 'New IG Comment Rule'}
                  {activeTab === 'fb_comments' && 'New FB Comment Rule'}
                  {activeTab === 'sequences' && 'New Sequence'}
                  {activeTab === 'analytics' && 'Export Report'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation with smooth mobile horizontal scroll */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-2 scroll-smooth">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
                  isActive
                    ? 'border-violet-600 text-violet-700 bg-violet-50/40 rounded-t-lg'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
                title={tab.desc}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-violet-600' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className={`text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase tracking-wider ${
                    isActive ? 'bg-violet-200/80 text-violet-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
