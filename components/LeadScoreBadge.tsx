'use client'

import React from 'react'
import { calculateLeadScore, parseCustomFields, LeadScoreResult } from '@/utils/lead-scoring'

interface LeadScoreBadgeProps {
  score?: number | null
  lead?: any
  qualifyingQuestions?: string[]
  size?: 'sm' | 'md' | 'lg'
  showDetails?: boolean
  className?: string
}

export default function LeadScoreBadge({
  score: explicitScore,
  lead,
  qualifyingQuestions = [],
  size = 'md',
  showDetails = false,
  className = ''
}: LeadScoreBadgeProps) {
  let scoreData: LeadScoreResult

  if (lead) {
    scoreData = calculateLeadScore(lead, qualifyingQuestions)
  } else {
    const s = explicitScore !== undefined && explicitScore !== null ? explicitScore : 0
    let tier: 'hot' | 'warm' | 'cold' = 'cold'
    let label = 'Cold'
    let color = 'slate'
    let badgeEmoji = '❄️'

    if (s >= 70) {
      tier = 'hot'
      label = 'Hot'
      color = 'rose'
      badgeEmoji = '🔥'
    } else if (s >= 40) {
      tier = 'warm'
      label = 'Warm'
      color = 'amber'
      badgeEmoji = '⚡'
    }

    scoreData = {
      score: s,
      tier,
      label,
      color,
      badgeEmoji,
      breakdown: { appointment: 0, expert_request: 0, qualification: 0, contact_info: 0 },
      answeredQuestionsCount: 0,
      totalQuestionsCount: 0
    }
  }

  const { score, tier, label, badgeEmoji, breakdown } = scoreData

  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2 py-0.5 gap-1.5',
    lg: 'text-sm px-2.5 py-1 gap-2'
  }[size]

  const tierStyles = {
    hot: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 shadow-sm shadow-rose-500/10',
    warm: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-sm shadow-amber-500/10',
    cold: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20'
  }[tier]

  return (
    <div className={`inline-flex items-center group relative cursor-default ${className}`}>
      <span
        className={`inline-flex items-center rounded-full font-semibold tracking-wide transition-all ${sizeClasses} ${tierStyles}`}
        title={`Lead Score: ${score}/100 (${label})`}
      >
        <span className="shrink-0">{badgeEmoji}</span>
        <span className="font-bold">{score}</span>
        <span className="opacity-80 font-medium">{label}</span>
      </span>

      {showDetails && (
        <div className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2.5 bg-slate-900/95 backdrop-blur-md text-white text-[11px] rounded-lg shadow-xl border border-slate-800 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <div className="font-bold pb-1 mb-1.5 border-b border-slate-800 flex justify-between items-center text-xs">
            <span>Lead Score: {score}/100</span>
            <span className="text-rose-400">{label}</span>
          </div>
          <div className="space-y-1 text-slate-300">
            <div className="flex justify-between">
              <span>📅 Appointment / Visit:</span>
              <span className="font-semibold text-white">+{breakdown.appointment} pts</span>
            </div>
            <div className="flex justify-between">
              <span>📞 Connect with Expert:</span>
              <span className="font-semibold text-white">+{breakdown.expert_request} pts</span>
            </div>
            <div className="flex justify-between">
              <span>📋 Questions Answered:</span>
              <span className="font-semibold text-white">+{breakdown.qualification} pts</span>
            </div>
            <div className="flex justify-between">
              <span>👤 Contact Info:</span>
              <span className="font-semibold text-white">+{breakdown.contact_info} pts</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
