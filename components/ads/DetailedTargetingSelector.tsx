'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Target, Search, X, Plus, Loader2, Sparkles, Users, HelpCircle, Check } from 'lucide-react'

export interface MetaInterest {
  id: string
  name: string
  audience_size_lower_bound?: number
  audience_size_upper_bound?: number
  topic?: string
}

interface DetailedTargetingSelectorProps {
  selectedInterests: MetaInterest[]
  onChange?: (interests: MetaInterest[]) => void
  onInterestsChange?: (interests: MetaInterest[]) => void
  impersonateId?: string | null
}

const POPULAR_PRESETS: MetaInterest[] = [
  { id: '6003139266472', name: 'Real estate', topic: 'Business and industry' },
  { id: '6003350419330', name: 'Luxury real estate', topic: 'Business and industry' },
  { id: '6003135985834', name: 'Real estate investing', topic: 'Business and industry' },
  { id: '6003306692298', name: 'First-time buyer', topic: 'Financial services' },
  { id: '6003186259834', name: 'Villa', topic: 'Real estate' },
  { id: '6003136274434', name: 'Apartment', topic: 'Real estate' },
  { id: '6003194098634', name: 'Mortgage loans', topic: 'Financial services' },
  { id: '6003444853034', name: 'Commercial property', topic: 'Real estate' },
  { id: '6003144862434', name: 'Interior design', topic: 'Design' }
]

function formatAudience(lower?: number, upper?: number): string {
  if (!lower && !upper) return ''
  const val = upper || lower || 0
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B people`
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M people`
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K people`
  return `${val} people`
}

export default function DetailedTargetingSelector({
  selectedInterests,
  onChange,
  onInterestsChange,
  impersonateId
}: DetailedTargetingSelectorProps) {
  const triggerChange = (newInterests: MetaInterest[]) => {
    if (onChange) onChange(newInterests)
    if (onInterestsChange) onInterestsChange(newInterests)
  }
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<MetaInterest[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setIsLoading(false)
      return
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    setIsLoading(true)

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const url = `/api/meta-ads/search-interests?q=${encodeURIComponent(query.trim())}${
          impersonateId ? `&impersonate=${impersonateId}` : ''
        }`
        const res = await fetch(url)
        const data = await res.json()
        setResults(data.data || [])
        setIsOpen(true)
      } catch (err) {
        console.error('Interest search error:', err)
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 350)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [query, impersonateId])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectInterest = (interest: MetaInterest) => {
    if (!selectedInterests.some(i => i.id === interest.id)) {
      triggerChange([...selectedInterests, interest])
    }
    setQuery('')
    setIsOpen(false)
  }

  const handleRemoveInterest = (id: string) => {
    triggerChange(selectedInterests.filter(i => i.id !== id))
  }

  return (
    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
          <Target size={15} className="text-blue-600" /> Detailed Targeting (Interests & Demographics)
        </label>
        <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
          Meta Ads Manager
        </span>
      </div>
      <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
        Define your target audience by including relevant interests, demographics, or behaviors. If left empty, Meta's Advantage delivery will target broadly.
      </p>

      {/* Selected Interest Chips */}
      {selectedInterests.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {selectedInterests.map(interest => (
            <span
              key={interest.id}
              className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-900 border border-blue-200 px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs animate-in fade-in duration-150"
            >
              <span>{interest.name}</span>
              <button
                type="button"
                onClick={() => handleRemoveInterest(interest.id)}
                className="text-blue-500 hover:text-red-500 p-0.5 rounded-full hover:bg-blue-100/80 transition-colors ml-0.5"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative" ref={dropdownRef}>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim() && setIsOpen(true)}
            placeholder="Search Meta interests (e.g. Real estate, Luxury goods, Investing)..."
            className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-9 text-xs font-medium text-slate-800 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
          />
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          {isLoading && (
            <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />
          )}
        </div>

        {/* Live Search Results Dropdown */}
        {isOpen && results.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-[1002] max-h-56 overflow-y-auto custom-scrollbar">
            {results.map(item => {
              const isSelected = selectedInterests.some(i => i.id === item.id)
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectInterest(item)}
                  className={`p-3 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-none flex items-center justify-between text-left transition-colors ${
                    isSelected ? 'bg-blue-50/60' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span>{item.name}</span>
                      {isSelected && <Check size={13} className="text-blue-600" />}
                    </div>
                    {item.topic && (
                      <div className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mt-0.5">
                        {item.topic}
                      </div>
                    )}
                  </div>
                  {(item.audience_size_lower_bound || item.audience_size_upper_bound) && (
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg shrink-0 ml-2">
                      {formatAudience(item.audience_size_lower_bound, item.audience_size_upper_bound)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Suggested Quick Presets */}
      <div className="pt-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
          <Sparkles size={11} className="text-amber-500" /> Quick Real Estate Presets
        </div>
        <div className="flex flex-wrap gap-1.5">
          {POPULAR_PRESETS.map(preset => {
            const isSelected = selectedInterests.some(i => i.id === preset.id)
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => isSelected ? handleRemoveInterest(preset.id) : handleSelectInterest(preset)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                {isSelected ? <Check size={11} /> : <Plus size={11} />}
                {preset.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
