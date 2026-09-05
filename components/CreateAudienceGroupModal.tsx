'use client'

import React, { useState, useMemo, useRef } from 'react'
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Sparkles, 
  Users, 
  Phone, 
  ShieldCheck, 
  HelpCircle,
  FileText,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'

interface CreateAudienceGroupModalProps {
  isOpen: boolean
  onClose: () => void
  allLeads: any[]
  onSuccess: (groupName: string) => void
}

function normalizePhoneDigits(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

export default function CreateAudienceGroupModal({
  isOpen,
  onClose,
  allLeads,
  onSuccess
}: CreateAudienceGroupModalProps) {
  const [activeTab, setActiveTab] = useState<'paste' | 'file'>('paste')
  const [groupName, setGroupName] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [uploadedFileNumbers, setUploadedFileNumbers] = useState<string[]>([])
  const [uploadedFileName, setUploadedFileName] = useState('')
  const [addNewLeadsIfMissing, setAddNewLeadsIfMissing] = useState(false)
  const [showPreviewList, setShowPreviewList] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Pre-index existing leads by last 10 digits for instant O(1) matching
  const existingLeadMap = useMemo(() => {
    const map = new Map<string, any>()
    for (const lead of allLeads) {
      if (!lead.phone) continue
      const digits = normalizePhoneDigits(lead.phone)
      if (digits && !map.has(digits)) {
        map.set(digits, lead)
      }
    }
    return map
  }, [allLeads])

  // Extract raw numbers depending on active tab
  const rawNumbers = useMemo(() => {
    if (activeTab === 'file') {
      return uploadedFileNumbers
    }
    if (!pastedText.trim()) return []
    // Split by comma, newline, semicolon, or whitespace
    return pastedText
      .split(/[\n,;\r\t]+/)
      .map(s => s.trim())
      .filter(Boolean)
  }, [activeTab, pastedText, uploadedFileNumbers])

  // Process unique valid numbers and match against CRM leads
  const { unique10Digits, matchedLeads, unmatchedNumbers, uniqueRawNumbers } = useMemo(() => {
    const seenDigits = new Set<string>()
    const rawList: string[] = []
    const matched: any[] = []
    const unmatched: string[] = []

    for (const raw of rawNumbers) {
      const digits = normalizePhoneDigits(raw)
      if (digits && !seenDigits.has(digits)) {
        seenDigits.add(digits)
        rawList.push(raw)
        const lead = existingLeadMap.get(digits)
        if (lead) {
          matched.push(lead)
        } else {
          unmatched.push(raw)
        }
      }
    }

    return {
      unique10Digits: Array.from(seenDigits),
      matchedLeads: matched,
      unmatchedNumbers: unmatched,
      uniqueRawNumbers: rawList
    }
  }, [rawNumbers, existingLeadMap])

  if (!isOpen) return null

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadedFileName(file.name)
    // Auto-fill group name from file name if empty
    if (!groupName.trim()) {
      const cleanBase = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim()
      setGroupName(cleanBase)
    }

    try {
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (extension === 'xlsx' || extension === 'xls') {
        const buffer = await file.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: 'array' })
        const firstSheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[firstSheetName]
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
        
        const extracted: string[] = []
        for (const row of jsonData) {
          if (!Array.isArray(row)) continue
          for (const cell of row) {
            if (cell !== null && cell !== undefined) {
              const str = String(cell).trim()
              if (normalizePhoneDigits(str)) {
                extracted.push(str)
              }
            }
          }
        }
        setUploadedFileNumbers(extracted)
        toast.success(`Loaded ${extracted.length} raw phone entries from "${file.name}"`)
      } else {
        // Plain text or CSV
        const text = await file.text()
        const extracted = text
          .split(/[\n,;\r\t]+/)
          .map(s => s.trim())
          .filter(s => !!normalizePhoneDigits(s))
        setUploadedFileNumbers(extracted)
        toast.success(`Loaded ${extracted.length} phone entries from "${file.name}"`)
      }
    } catch (err: any) {
      console.error('[FILE PARSE ERROR]', err)
      toast.error('Failed to parse file: ' + (err.message || 'Unknown error'))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!groupName.trim()) {
      return toast.error('Please enter a name for this Audience Group.')
    }
    if (unique10Digits.length === 0) {
      return toast.error('Please provide at least one valid 10-digit phone number.')
    }

    if (matchedLeads.length === 0 && !addNewLeadsIfMissing) {
      return toast.error('None of the numbers exist in your CRM. Check "Also import numbers not in CRM" or provide existing CRM numbers.')
    }

    setIsSubmitting(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const targetUrl = `/api/voice/audience-group${impersonateId ? `?impersonate=${impersonateId}` : ''}`

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName: groupName.trim(),
          phoneNumbers: uniqueRawNumbers,
          addNewLeadsIfMissing
        })
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create audience group.')
      }

      toast.success(data.message || `Audience Group "${data.groupName}" created successfully!`)
      onSuccess(data.groupName)
      onClose()
    } catch (err: any) {
      console.error('[SUBMIT AUDIENCE GROUP ERROR]', err)
      toast.error(err.message || 'Failed to create audience group.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-[2rem] shadow-2xl overflow-hidden my-8 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200">
              <Users size={20} />
            </div>
            <div>
              <h3 className="font-extrabold text-lg text-slate-900 flex items-center gap-2">
                Create Number Audience Group
                <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                  Zero Duplicates
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Tag specific numbers into a calling audience without modifying their CRM stages, sources, or history.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Group Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-slate-600 uppercase tracking-wide flex items-center justify-between">
              <span>Audience Group Name <span className="text-rose-500">*</span></span>
              <span className="text-[10px] text-slate-400 font-normal lowercase">Will appear in voice campaign audience filter</span>
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. VIP Aerocity High Budget Prospects"
              className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-500 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-900 outline-none transition-all shadow-xs"
              required
            />
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab('paste')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'paste'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              <FileText size={14} /> Paste Numbers
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('file')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'file'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              <Upload size={14} /> Upload File (.xlsx, .csv, .txt)
            </button>
          </div>

          {/* Tab Content: Paste Numbers */}
          {activeTab === 'paste' ? (
            <div className="space-y-2 animate-in fade-in duration-150">
              <label className="text-[11px] font-black text-slate-600 uppercase tracking-wide block">
                Paste Phone Numbers
              </label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={`Paste phone numbers separated by newlines, commas, or spaces:
9876543210
+91 98123 45678
919988776655
+91-9876501234`}
                rows={6}
                className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-500 p-3 rounded-xl text-xs font-mono text-slate-800 outline-none transition-all resize-y shadow-xs"
              />
              <p className="text-[11px] text-slate-400 font-medium">
                Supports all formats: raw 10 digits, +91, with spaces or hyphens.
              </p>
            </div>
          ) : (
            /* Tab Content: Upload File */
            <div className="space-y-3 animate-in fade-in duration-150">
              <label className="text-[11px] font-black text-slate-600 uppercase tracking-wide block">
                Select File
              </label>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-indigo-50/30 rounded-2xl p-6 text-center cursor-pointer transition-all group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <FileSpreadsheet size={24} />
                </div>
                <p className="text-xs font-bold text-slate-800">
                  Click to choose a CSV, Excel (.xlsx/.xls), or Text file
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  We will automatically scan and detect all 10-digit phone numbers in the file.
                </p>
                {uploadedFileName && (
                  <div className="mt-3 inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
                    <Check size={14} /> {uploadedFileName} ({uploadedFileNumbers.length} numbers)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Real-time Match Intelligence Badges */}
          {unique10Digits.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                <span className="text-[11px] font-black text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-500" /> CRM Match Summary
                </span>
                <span className="text-xs font-bold text-slate-500">
                  {unique10Digits.length} Unique Numbers Found
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200/80 p-3 rounded-xl shadow-xs">
                  <span className="text-[10px] font-black text-slate-400 uppercase block">Total Entered</span>
                  <div className="text-base font-black text-slate-900 mt-0.5">{unique10Digits.length}</div>
                </div>

                <div className="bg-emerald-50/50 border border-emerald-200/80 p-3 rounded-xl shadow-xs">
                  <span className="text-[10px] font-black text-emerald-600 uppercase block flex items-center gap-1">
                    <CheckCircle2 size={12} /> Matched in CRM
                  </span>
                  <div className="text-base font-black text-emerald-700 mt-0.5">{matchedLeads.length} Leads</div>
                </div>

                <div className="bg-amber-50/50 border border-amber-200/80 p-3 rounded-xl shadow-xs col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-black text-amber-600 uppercase block flex items-center gap-1">
                    <AlertCircle size={12} /> Not in CRM
                  </span>
                  <div className="text-base font-black text-amber-700 mt-0.5">{unmatchedNumbers.length} Numbers</div>
                </div>
              </div>

              {/* Zero Overwrite Assurance */}
              <div className="flex items-start gap-2 bg-indigo-50/60 border border-indigo-100 rounded-xl p-3 text-[11px] text-indigo-900 font-medium">
                <ShieldCheck size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Preserves CRM Integrity:</strong> Matched leads will simply be tagged with this group. 
                  Their stages, sources, notes, conversation history, and assigned agents remain 100% untouched.
                </div>
              </div>

              {/* Checkbox for Unmatched Numbers */}
              {unmatchedNumbers.length > 0 && (
                <label className="flex items-center gap-2.5 bg-white border border-slate-200/80 p-3 rounded-xl text-xs font-bold text-slate-800 cursor-pointer select-none hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={addNewLeadsIfMissing}
                    onChange={(e) => setAddNewLeadsIfMissing(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>
                    Also create new CRM leads for the {unmatchedNumbers.length} unmatched numbers
                  </span>
                </label>
              )}

              {/* Matched Leads Preview Toggle */}
              {matchedLeads.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowPreviewList(!showPreviewList)}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
                  >
                    {showPreviewList ? (
                      <>
                        <ChevronUp size={14} /> Hide Preview of Matched Leads ({matchedLeads.length})
                      </>
                    ) : (
                      <>
                        <ChevronDown size={14} /> Preview Matched Leads ({matchedLeads.length})
                      </>
                    )}
                  </button>

                  {showPreviewList && (
                    <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto bg-white">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-slate-100/70 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 sticky top-0">
                          <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Phone</th>
                            <th className="px-3 py-2">Stage</th>
                            <th className="px-3 py-2">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {matchedLeads.slice(0, 100).map((l, i) => (
                            <tr key={l.id || i} className="hover:bg-slate-50/80">
                              <td className="px-3 py-1.5 font-bold text-slate-900 truncate max-w-[120px]">{l.name || 'Unnamed Lead'}</td>
                              <td className="px-3 py-1.5 font-mono text-slate-600">{l.phone}</td>
                              <td className="px-3 py-1.5">
                                <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-semibold text-[10px]">
                                  {l.pipeline_stage || 'New'}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-slate-500 truncate max-w-[100px]">{l.source || 'Direct'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {matchedLeads.length > 100 && (
                        <div className="text-center py-2 text-[10px] text-slate-400 font-bold bg-slate-50 border-t border-slate-100">
                          + {matchedLeads.length - 100} more matched leads
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || unique10Digits.length === 0 || !groupName.trim()}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-extrabold flex items-center gap-2 shadow-md shadow-indigo-200 transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Grouping Leads...
                </>
              ) : (
                <>
                  <Sparkles size={14} /> Create & Select Group
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
