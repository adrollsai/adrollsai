'use client'

import React, { useState, useEffect, useRef } from 'react'
import { calculateLeadScore, parseCustomFields, LeadScoreResult } from '@/utils/lead-scoring'
import { X } from 'lucide-react'

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
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

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
      breakdown: { questions_answered: 0, appointment_booked: 0, expert_clicked: 0, view_products_clicked: 0 },
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
    hot: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 shadow-sm shadow-rose-500/10 hover:bg-rose-500/25',
    warm: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-sm shadow-amber-500/10 hover:bg-amber-500/25',
    cold: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 hover:bg-slate-500/20'
  }[tier]

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (showDetails) {
      setIsOpen(prev => !prev)
    }
  }

  return (
    <div ref={containerRef} className={`inline-flex items-center relative ${className}`}>
      <button
        type="button"
        onClick={handleBadgeClick}
        className={`inline-flex items-center rounded-full font-semibold tracking-wide transition-all cursor-pointer select-none active:scale-95 ${sizeClasses} ${tierStyles}`}
        title={`Click to view score breakdown: ${score}/100 (${label})`}
      >
        <span className="shrink-0">{badgeEmoji}</span>
        <span className="font-bold">{score}</span>
        <span className="opacity-80 font-medium">{label}</span>
      </button>

      {showDetails && isOpen && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 bg-slate-900/95 backdrop-blur-md text-white text-[11px] rounded-xl shadow-2xl border border-slate-800 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="font-bold pb-1.5 mb-2 border-b border-slate-800 flex justify-between items-center text-xs">
            <span>Lead Score: {score}/100</span>
            <div className="flex items-center gap-1.5">
              <span className="text-rose-400 font-extrabold">{label}</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white p-0.5 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          <div className="space-y-1.5 text-slate-300">
            <div className="flex justify-between">
              <span>📋 Questions Answered:</span>
              <span className="font-semibold text-white">+{breakdown.questions_answered ?? 0} pts</span>
            </div>
            <div className="flex justify-between">
              <span>📅 Appointment Booked:</span>
              <span className="font-semibold text-white">+{breakdown.appointment_booked ?? 0} pts</span>
            </div>
            <div className="flex justify-between">
              <span>📞 Talk to Expert:</span>
              <span className="font-semibold text-white">+{breakdown.expert_clicked ?? 0} pts</span>
            </div>
            <div className="flex justify-between">
              <span>🏢 View Properties:</span>
              <span className="font-semibold text-white">+{breakdown.view_products_clicked ?? 0} pts</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
