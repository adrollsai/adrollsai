'use client'

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'

export type SearchableSelectBadgeTone = 'emerald' | 'blue' | 'amber' | 'slate'

export interface SearchableSelectOption {
  /** The raw value handed back to onChange */
  value: string
  /** What the user reads */
  label: string
  /** Optional pill rendered next to the label, e.g. "Active" */
  badge?: string | null
  /** Colour of the pill */
  badgeTone?: SearchableSelectBadgeTone
  /** Optional secondary line under the label */
  hint?: string | null
  /** Renders the row but blocks selection. */
  disabled?: boolean
}

export interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value: string
  onChange: (value: string) => void

  /** When provided a "reset to everything" row is rendered at the top of the list. */
  allLabel?: string
  /** Value emitted by the reset row. Defaults to 'ALL'. */
  allValue?: string

  placeholder?: string
  searchPlaceholder?: string
  /** Message shown when the search matches nothing. */
  emptyText?: string

  disabled?: boolean

  /** Wrapper class (positioning / width). */
  className?: string
  /** Class for the trigger button. */
  buttonClassName?: string
  /** Class for the popup panel. */
  panelClassName?: string

  /** Render the panel in normal flow instead of absolutely positioned. */
  inlinePanel?: boolean
  /** Icon rendered inside the trigger before the label. */
  icon?: React.ReactNode
}

const BADGE_TONES: Record<SearchableSelectBadgeTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
}

const BADGE_DOT_TONES: Record<SearchableSelectBadgeTone, string> = {
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  slate: 'bg-slate-400',
}

function Badge({ label, tone }: { label: string; tone: SearchableSelectBadgeTone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border shrink-0 ${BADGE_TONES[tone]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${BADGE_DOT_TONES[tone]}`} />
      <span>{label}</span>
    </span>
  )
}

/**
 * A generic, searchable single-select dropdown.
 *
 * Exists because the CRM / analytics filter surfaces were plain <select> elements:
 * with a real workspace those lists run to dozens or hundreds of campaigns, forms,
 * agents and stages, which makes a native select unusable. Options may also carry a
 * badge so live "Active" campaigns/forms are visually distinguishable from dead ones.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  allLabel,
  allValue = 'ALL',
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No matches found',
  disabled = false,
  className = '',
  buttonClassName = '',
  panelClassName = '',
  inlinePanel = false,
  icon,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    setSearch('')
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen])

  // Auto-focus the search box when opened
  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => searchRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [isOpen])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) => {
      const label = String(opt.label || '').toLowerCase()
      const hint = String(opt.hint || '').toLowerCase()
      return label.includes(q) || hint.includes(q)
    })
  }, [options, search])

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) || null,
    [options, value]
  )

  const isAllSelected = allLabel !== undefined && value === allValue
  const triggerLabel = selectedOption?.label
    || (isAllSelected ? allLabel : placeholder)

  const hasActiveSelection = Boolean(selectedOption) && !isAllSelected

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    setIsOpen(false)
    setSearch('')
  }

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* TRIGGER */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setIsOpen((prev) => !prev)
          setSearch('')
        }}
        title={triggerLabel}
        className={`w-full text-xs font-bold rounded-xl py-3 pl-3 pr-3 text-left outline-none transition-all flex items-center justify-between gap-2 shadow-xs ${
          disabled ? 'opacity-60 cursor-not-allowed bg-slate-100 border border-slate-200' : 'cursor-pointer'
        } ${buttonClassName}`}
      >
        <span className="truncate flex-1 flex items-center gap-1.5 min-w-0">
          {icon && <span className="shrink-0 opacity-70">{icon}</span>}
          <span className="truncate">{triggerLabel}</span>
          {selectedOption?.badge && (
            <Badge label={selectedOption.badge} tone={selectedOption.badgeTone || 'emerald'} />
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {hasActiveSelection && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                onChange(allLabel !== undefined ? allValue : '')
              }}
              className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              title="Clear selection"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={13}
            className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {/* PANEL */}
      {isOpen && (
        <div
          className={`${
            inlinePanel ? 'mt-2 w-full' : 'absolute left-0 right-0 top-full mt-1.5 z-[150] min-w-[220px]'
          } bg-white border border-slate-200 rounded-2xl shadow-xl p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150 ${panelClassName}`}
        >
          {/* Search box */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-7 py-2 bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 placeholder:font-medium outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Options */}
          <div className="max-h-56 overflow-y-auto space-y-0.5 custom-scrollbar pr-0.5">
            {allLabel !== undefined && (
              <button
                type="button"
                onClick={() => handleSelect(allValue)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-extrabold flex items-center justify-between gap-2 transition-all cursor-pointer ${
                  isAllSelected ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="truncate">{allLabel}</span>
                {isAllSelected && <Check size={13} className="shrink-0" />}
              </button>
            )}

            {filteredOptions.map((opt) => {
              const isSelected = opt.value === value && !isAllSelected
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => handleSelect(opt.value)}
                  title={opt.hint || opt.label}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 transition-all border ${
                    opt.disabled
                      ? 'opacity-50 cursor-not-allowed border-transparent text-slate-400'
                      : isSelected
                        ? 'bg-blue-50/80 text-blue-900 border-blue-200/80 shadow-xs font-black cursor-pointer'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-transparent cursor-pointer'
                  }`}
                >
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="break-words leading-relaxed">{opt.label}</span>
                    {opt.hint && (
                      <span className="text-[10px] font-medium text-slate-400 truncate mt-0.5">{opt.hint}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {opt.badge && <Badge label={opt.badge} tone={opt.badgeTone || 'emerald'} />}
                    {isSelected && <Check size={13} />}
                  </span>
                </button>
              )
            })}

            {filteredOptions.length === 0 && (
              <div className="py-4 text-center text-xs font-semibold text-slate-400">
                {search ? `${emptyText} for “${search}”` : emptyText}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-400">
            <span>
              {search
                ? `${filteredOptions.length} of ${options.length}`
                : `${options.length} option${options.length === 1 ? '' : 's'}`}
            </span>
            <button
              type="button"
              onClick={close}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
