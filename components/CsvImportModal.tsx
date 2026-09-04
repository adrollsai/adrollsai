'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { 
  X, Upload, FileSpreadsheet, Check, CheckCircle2, AlertCircle, 
  HelpCircle, ChevronDown, Loader2, Sparkles, Filter, Database, ArrowRight
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

interface CsvImportModalProps {
  isOpen: boolean
  onClose: () => void
  headers: string[]
  rows: string[][]
  fileName: string
  effectiveUserId: string
  existingLeads: any[]
  onSuccess: () => Promise<void>
}

export function sanitizePhoneNumber(raw: string): string | null {
  if (!raw) return null
  let clean = raw.trim()
  // Strip prefixes like "p:", "p:+", "tel:", "tel:+"
  clean = clean.replace(/^(p:|tel:)/i, '').trim()
  const hasPlus = clean.startsWith('+')
  const digits = clean.replace(/\D/g, '')
  if (!digits || digits.length < 5) return null

  let formatted = hasPlus ? `+${digits}` : digits
  if (!formatted.startsWith('+')) {
    if (digits.length === 10) formatted = `+91${digits}`
    else formatted = `+${digits}`
  }
  return formatted
}

export default function CsvImportModal({
  isOpen,
  onClose,
  headers,
  rows,
  fileName,
  effectiveUserId,
  existingLeads,
  onSuccess
}: CsvImportModalProps) {
  const supabase = createClient()

  const [audienceName, setAudienceName] = useState('')
  const [columnMap, setColumnMap] = useState({
    name: '',
    phone: '',
    email: '',
    city: '',
    budget: '',
    stage: '',
    notes: ''
  })
  const [customFieldsToInclude, setCustomFieldsToInclude] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)

  // Initialize auto-detection when modal opens or headers change
  useEffect(() => {
    if (!headers || headers.length === 0) return

    const defaultAudience = fileName.replace(/\.[^/.]+$/, '').trim() || 'General CSV Import'
    setAudienceName(defaultAudience)

    // Smart auto-detection for core fields
    const nameCol = headers.find(h => {
      const lower = h.toLowerCase().trim()
      if (lower.includes('budget') || lower.includes('price') || lower.includes('investment') || lower.includes('?')) return false
      return lower === 'full_name' || lower === 'fullname' || lower === 'name' || lower === 'lead_name' || lower === 'customer_name' || lower === 'contact_name' || lower === 'lead name' || lower === 'full name'
    }) || headers.find(h => {
      const lower = h.toLowerCase().trim()
      return !lower.includes('?') && !lower.includes('budget') && !lower.includes('file') && lower.includes('name')
    }) || ''

    const phoneCol = headers.find(h => {
      const lower = h.toLowerCase().trim()
      return lower === 'phone_number' || lower === 'phone' || lower === 'mobile' || lower === 'contact' || lower === 'contacts' || lower === 'phone number' || lower.includes('phone') || lower.includes('mobile')
    }) || ''

    const emailCol = headers.find(h => {
      const lower = h.toLowerCase().trim()
      return lower === 'email' || lower === 'email_address' || lower === 'email address' || lower.includes('mail')
    }) || ''

    const cityCol = headers.find(h => {
      const lower = h.toLowerCase().trim()
      return lower === 'city' || lower === 'location' || lower === 'town' || lower === 'state'
    }) || ''

    const budgetCol = headers.find(h => {
      const lower = h.toLowerCase().trim()
      return lower.includes('budget') || lower.includes('investment') || lower.includes('price')
    }) || ''

    const stageCol = headers.find(h => {
      const lower = h.toLowerCase().trim()
      return lower === 'status' || lower === 'stage' || lower === 'lead status' || lower === 'pipeline_stage'
    }) || ''

    const notesCol = headers.find(h => {
      const lower = h.toLowerCase().trim()
      return lower === 'notes' || lower === 'remarks' || lower.includes('remarks') || lower.includes('comments')
    }) || ''

    setColumnMap({
      name: nameCol,
      phone: phoneCol,
      email: emailCol,
      city: cityCol,
      budget: budgetCol,
      stage: stageCol,
      notes: notesCol
    })

    // By default, include all survey / other columns in custom fields (excluding name & phone)
    const extraCols = headers.filter(h => h !== nameCol && h !== phoneCol)
    setCustomFieldsToInclude(extraCols)
  }, [headers, fileName, isOpen])

  // Sample data rows (excluding header)
  const sampleRows = useMemo(() => {
    return rows.slice(1, 4)
  }, [rows])

  const totalDataRows = Math.max(0, rows.length - 1)

  // Available extra columns not mapped to Name or Phone
  const availableExtraColumns = useMemo(() => {
    return headers.filter(h => h && h !== columnMap.name && h !== columnMap.phone)
  }, [headers, columnMap.name, columnMap.phone])

  const toggleCustomField = (header: string) => {
    setCustomFieldsToInclude(prev => 
      prev.includes(header) ? prev.filter(c => c !== header) : [...prev, header]
    )
  }

  const selectAllCustomFields = () => {
    setCustomFieldsToInclude([...availableExtraColumns])
  }

  const deselectAllCustomFields = () => {
    setCustomFieldsToInclude([])
  }

  const handleImport = async () => {
    if (!columnMap.name) {
      toast.error('Please select the Full Name column.')
      return
    }
    if (!columnMap.phone) {
      toast.error('Please select the Phone Number column.')
      return
    }

    setIsImporting(true)

    try {
      const nameIdx = headers.indexOf(columnMap.name)
      const phoneIdx = headers.indexOf(columnMap.phone)
      const emailIdx = columnMap.email ? headers.indexOf(columnMap.email) : -1
      const cityIdx = columnMap.city ? headers.indexOf(columnMap.city) : -1
      const budgetIdx = columnMap.budget ? headers.indexOf(columnMap.budget) : -1
      const stageIdx = columnMap.stage ? headers.indexOf(columnMap.stage) : -1
      const notesIdx = columnMap.notes ? headers.indexOf(columnMap.notes) : -1

      const finalAudienceName = audienceName.trim() || 'General CSV Import'

      // Pre-compute custom field mappings
      const customFieldMappings = customFieldsToInclude
        .filter(h => h !== columnMap.name && h !== columnMap.phone)
        .map(header => {
          // Create clean key
          const cleanKey = header
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '') || 'field'
          return {
            key: cleanKey,
            header,
            index: headers.indexOf(header)
          }
        })
        .filter(cf => cf.index !== -1)

      const parsedLeads: any[] = []

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        if (!r || r.length === 0) continue

        const rawName = nameIdx !== -1 ? (r[nameIdx] || '').trim() : ''
        const rawPhone = phoneIdx !== -1 ? (r[phoneIdx] || '').trim() : ''
        const email = emailIdx !== -1 ? (r[emailIdx] || '').trim() : null

        if (!rawName && !rawPhone && !email) continue

        const formattedPhone = rawPhone ? sanitizePhoneNumber(rawPhone) : null
        const city = cityIdx !== -1 ? (r[cityIdx] || '').trim() : null
        const budget = budgetIdx !== -1 ? (r[budgetIdx] || '').trim() : null
        const notes = notesIdx !== -1 ? (r[notesIdx] || '').trim() : null
        const rawStage = stageIdx !== -1 ? (r[stageIdx] || '').trim() : 'New'

        // Build custom fields object
        const customFieldsObj: Record<string, any> = {
          csv_audience: finalAudienceName
        }
        if (city) customFieldsObj.city = city

        customFieldMappings.forEach(cf => {
          const val = (r[cf.index] || '').trim()
          if (val) {
            customFieldsObj[cf.key] = val
          }
        })

        parsedLeads.push({
          user_id: effectiveUserId,
          name: rawName || 'Lead',
          phone: formattedPhone || (rawPhone ? rawPhone : null),
          email: email || null,
          source: 'CSV Import',
          budget: budget || null,
          status: rawStage || 'New',
          pipeline_stage: 'New',
          notes: notes || null,
          csv_audience: finalAudienceName,
          custom_fields: customFieldsObj,
          created_at: new Date().toISOString()
        })
      }

      if (parsedLeads.length === 0) {
        toast.error('No valid leads found in this CSV.')
        setIsImporting(false)
        return
      }

      // Deduplicate against existing CRM leads and within the import batch
      const existingPhoneSet = new Set<string>()
      existingLeads.forEach(l => {
        const d = (l.phone || '').replace(/\D/g, '').slice(-10)
        if (d.length >= 7) existingPhoneSet.add(d)
      })

      const uniqueLeads: any[] = []
      const seenInBatch = new Set<string>()

      for (const lead of parsedLeads) {
        const d = (lead.phone || '').replace(/\D/g, '').slice(-10)
        if (d && d.length >= 7) {
          if (!existingPhoneSet.has(d) && !seenInBatch.has(d)) {
            seenInBatch.add(d)
            uniqueLeads.push(lead)
          }
        } else {
          // If no unique phone, still allow lead
          uniqueLeads.push(lead)
        }
      }

      if (uniqueLeads.length === 0) {
        toast.info(`All ${parsedLeads.length} contacts already exist in your CRM. 0 duplicates added.`)
        onClose()
        setIsImporting(false)
        return
      }

      // Batch insert in chunks of 100
      const CHUNK_SIZE = 100
      for (let i = 0; i < uniqueLeads.length; i += CHUNK_SIZE) {
        const chunk = uniqueLeads.slice(i, i + CHUNK_SIZE)
        const { error: insertErr } = await supabase.from('leads').insert(chunk)
        if (insertErr) {
          console.error('[CSV IMPORT] Insert chunk error:', insertErr)
          throw insertErr
        }
      }

      const skippedCount = parsedLeads.length - uniqueLeads.length
      toast.success(`🎉 Successfully imported ${uniqueLeads.length} leads under "${finalAudienceName}"!${skippedCount > 0 ? ` (${skippedCount} existing duplicates skipped)` : ''}`)
      
      await onSuccess()
      onClose()
    } catch (err: any) {
      console.error('[CSV IMPORT] Import failed:', err)
      toast.error(err.message || 'Failed to import CSV leads')
    } finally {
      setIsImporting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-[2rem] shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                Map CSV Columns & Import
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                  {totalDataRows} Rows Detected
                </span>
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Verify how columns map to CRM fields and select custom survey fields to ingest.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            disabled={isImporting}
            className="p-2.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all active:scale-95"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          
          {/* Audience / Batch Name */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/70">
            <label className="text-[11px] font-bold text-slate-700 block mb-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>Audience / Batch Tag</span>
              <span className="text-slate-400 normal-case font-normal">Use this to filter or broadcast to this batch later</span>
            </label>
            <input 
              type="text"
              value={audienceName}
              onChange={e => setAudienceName(e.target.value)}
              placeholder="e.g. Bioque Estates Dubai Leads, Expo 2026, etc."
              className="w-full bg-white px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>

          {/* Core Fields Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Database size={16} className="text-indigo-600" />
                Core Lead Fields
              </h3>
              <span className="text-xs text-slate-500">Name & Phone are required</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              
              {/* Full Name */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-all">
                <label className="text-[10px] font-bold text-slate-600 block mb-1 uppercase tracking-wider flex items-center gap-1">
                  <span>Full Name</span>
                  <span className="text-rose-500 font-black">*</span>
                </label>
                <select
                  value={columnMap.name}
                  onChange={e => setColumnMap({...columnMap, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">-- Select Name Column --</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Phone Number */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-all">
                <label className="text-[10px] font-bold text-slate-600 block mb-1 uppercase tracking-wider flex items-center gap-1">
                  <span>Phone Number</span>
                  <span className="text-rose-500 font-black">*</span>
                </label>
                <select
                  value={columnMap.phone}
                  onChange={e => setColumnMap({...columnMap, phone: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">-- Select Phone Column --</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Email */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-all">
                <label className="text-[10px] font-bold text-slate-600 block mb-1 uppercase tracking-wider">
                  Email Address
                </label>
                <select
                  value={columnMap.email}
                  onChange={e => setColumnMap({...columnMap, email: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">[None / Skip]</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* City */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-all">
                <label className="text-[10px] font-bold text-slate-600 block mb-1 uppercase tracking-wider">
                  City / Location
                </label>
                <select
                  value={columnMap.city}
                  onChange={e => setColumnMap({...columnMap, city: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">[None / Skip]</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Budget */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-all">
                <label className="text-[10px] font-bold text-slate-600 block mb-1 uppercase tracking-wider">
                  Planned Budget
                </label>
                <select
                  value={columnMap.budget}
                  onChange={e => setColumnMap({...columnMap, budget: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">[None / Skip]</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Stage / Status */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-all">
                <label className="text-[10px] font-bold text-slate-600 block mb-1 uppercase tracking-wider">
                  Pipeline Stage
                </label>
                <select
                  value={columnMap.stage}
                  onChange={e => setColumnMap({...columnMap, stage: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">[Default: New Lead]</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

            </div>
          </div>

          {/* Questionnaire & Survey Columns to Ingest into Custom Fields */}
          {availableExtraColumns.length > 0 && (
            <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles size={16} className="text-indigo-600" />
                    Survey & Questionnaire Columns to Save
                  </h3>
                  <p className="text-xs text-slate-500">
                    These columns will be saved into each lead's details (<code className="font-mono text-indigo-700 bg-indigo-100/60 px-1 py-0.5 rounded">custom_fields</code>) so zero information is lost.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    type="button" 
                    onClick={selectAllCustomFields} 
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm"
                  >
                    Select All
                  </button>
                  <button 
                    type="button" 
                    onClick={deselectAllCustomFields} 
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                {availableExtraColumns.map(col => {
                  const isChecked = customFieldsToInclude.includes(col)
                  const sampleVal = sampleRows[0] ? sampleRows[0][headers.indexOf(col)] : ''

                  return (
                    <label 
                      key={col} 
                      className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer select-none ${
                        isChecked 
                          ? 'bg-white border-indigo-300 shadow-sm' 
                          : 'bg-slate-50/60 border-slate-200/80 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <input 
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCustomField(col)}
                        className="mt-1 w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-900 truncate" title={col}>
                          {col}
                        </div>
                        {sampleVal && (
                          <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5" title={sampleVal}>
                            Sample: {sampleVal}
                          </div>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* Live Table Preview */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-600" />
                Live Mapping Preview (First 3 Leads)
              </h3>
              <span className="text-[11px] text-slate-400">Verifying phone cleaning & mapping</span>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Full Name</th>
                      <th className="py-2.5 px-3">Cleaned Phone</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">City</th>
                      <th className="py-2.5 px-3">Custom Fields</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {sampleRows.map((row, rIdx) => {
                      const nameIdx = headers.indexOf(columnMap.name)
                      const phoneIdx = headers.indexOf(columnMap.phone)
                      const emailIdx = columnMap.email ? headers.indexOf(columnMap.email) : -1
                      const cityIdx = columnMap.city ? headers.indexOf(columnMap.city) : -1

                      const rawName = nameIdx !== -1 ? row[nameIdx] : ''
                      const rawPhone = phoneIdx !== -1 ? row[phoneIdx] : ''
                      const cleanedPhone = sanitizePhoneNumber(rawPhone)

                      const email = emailIdx !== -1 ? row[emailIdx] : '-'
                      const city = cityIdx !== -1 ? row[cityIdx] : '-'

                      return (
                        <tr key={rIdx} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">{rIdx + 1}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {rawName ? (
                              rawName
                            ) : (
                              <span className="text-rose-500 italic">Missing Name</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-emerald-700 font-medium">
                            {cleanedPhone ? (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200/60">
                                {cleanedPhone}
                              </span>
                            ) : (
                              <span className="text-rose-500 italic">Invalid / Missing Phone</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{email || '-'}</td>
                          <td className="py-2.5 px-3 text-slate-600">{city || '-'}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-[11px] font-semibold text-indigo-700 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100">
                              {customFieldsToInclude.length} fields
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
          <button 
            type="button" 
            onClick={onClose}
            disabled={isImporting}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100 transition-all"
          >
            Cancel
          </button>

          <button 
            type="button" 
            onClick={handleImport}
            disabled={isImporting || !columnMap.name || !columnMap.phone}
            className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold shadow-md shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
          >
            {isImporting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Importing Leads...</span>
              </>
            ) : (
              <>
                <Upload size={16} />
                <span>Confirm & Import {totalDataRows} Leads</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}
