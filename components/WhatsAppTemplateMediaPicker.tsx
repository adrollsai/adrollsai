'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Image, Video, FileText, Upload, Check, Loader2, Library, Search, Filter, X, ExternalLink, Maximize2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface WhatsAppTemplateMediaPickerProps {
  headerType: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null
  mediaUrl: string
  onMediaSelect: (url: string) => void
  userAssets?: any[]
  userId?: string
}

export default function WhatsAppTemplateMediaPicker({
  headerType,
  mediaUrl,
  onMediaSelect,
  userAssets = [],
  userId
}: WhatsAppTemplateMediaPickerProps) {
  const [tab, setTab] = useState<'library' | 'upload'>('library')
  const [uploading, setUploading] = useState(false)
  const [localAssets, setLocalAssets] = useState<any[]>(userAssets)
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Modal filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all')
  const [properties, setProperties] = useState<Array<{ id: string; title: string }>>([])

  const supabase = createClient()

  useEffect(() => {
    fetchProperties()
    if (userAssets && userAssets.length > 0) {
      setLocalAssets(userAssets)
    } else {
      fetchAssets()
    }
  }, [])

  const fetchProperties = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const targetUser = userId || user?.id
      if (!targetUser) return

      const { data } = await supabase
        .from('properties')
        .select('id, title')
        .eq('user_id', targetUser)
        .order('title', { ascending: true })

      if (data) {
        setProperties(data)
      }
    } catch (e) {
      console.error('Failed to load properties for creative picker:', e)
    }
  }

  const fetchAssets = async () => {
    setLoadingAssets(true)
    try {
      const impParam = userId ? `?impersonate=${userId}` : ''
      const res = await fetch(`/api/assets${impParam}`)
      if (res.ok) {
        const data = await res.json()
        const rawList = Array.isArray(data) ? data : (data.assets || [])
        // Filter out failed assets
        setLocalAssets(rawList.filter((a: any) => a.status !== 'Failed'))
      }
    } catch (e) {
      console.error('Failed to load user assets:', e)
    } finally {
      setLoadingAssets(false)
    }
  }

  if (!headerType || !['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
    return null
  }

  const targetTypeLabel = headerType === 'IMAGE' ? 'Image' : headerType === 'VIDEO' ? 'Video' : 'PDF Document'
  const acceptedMime = headerType === 'IMAGE' ? 'image/*' : headerType === 'VIDEO' ? 'video/*' : 'application/pdf,.pdf'

  // Map property titles for easy lookup
  const propertyMap = useMemo(() => {
    const map = new Map<string, string>()
    properties.forEach(p => map.set(p.id, p.title))
    return map
  }, [properties])

  // Base filtering by header type
  const typeFilteredAssets = useMemo(() => {
    return localAssets.filter(a => {
      if (!a.url && a.status !== 'Processing') return false
      const fileType = (a.type || '').toLowerCase()
      if (headerType === 'IMAGE') return fileType === 'image' || !a.url || a.url.match(/\.(png|jpg|jpeg|webp)$/i)
      if (headerType === 'VIDEO') return fileType === 'video' || (a.url && a.url.match(/\.(mp4|mov|webm)$/i))
      if (headerType === 'DOCUMENT') return fileType === 'pdf' || fileType === 'document' || (a.url && a.url.match(/\.(pdf)$/i))
      return true
    })
  }, [localAssets, headerType])

  // Modal search & product filtering
  const modalFilteredAssets = useMemo(() => {
    return typeFilteredAssets.filter(a => {
      // Product / Property filter
      if (selectedPropertyId !== 'all') {
        if (a.property_id !== selectedPropertyId) return false
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const propTitle = (propertyMap.get(a.property_id) || '').toLowerCase()
        const caption = (a.caption || '').toLowerCase()
        const url = (a.url || '').toLowerCase()
        const title = (a.title || '').toLowerCase()
        const matches = propTitle.includes(q) || caption.includes(q) || url.includes(q) || title.includes(q)
        if (!matches) return false
      }

      return true
    })
  }, [typeFilteredAssets, selectedPropertyId, searchQuery, propertyMap])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const signRes = await fetch('/api/upload/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          folder: 'whatsapp_headers'
        })
      })

      if (!signRes.ok) throw new Error('Failed to sign upload URL')
      const { signedUrl, publicUrl } = await signRes.json()

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      })

      if (!uploadRes.ok) throw new Error('Failed to upload media file')

      onMediaSelect(publicUrl)
      // Add newly uploaded file to local library list
      setLocalAssets(prev => [{ id: Date.now(), url: publicUrl, type: headerType.toLowerCase(), status: 'Completed' }, ...prev])
      setTab('library')
      setIsModalOpen(false)
    } catch (err: any) {
      console.error('Media upload error:', err)
      alert(err.message || 'Failed to upload header media file')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-emerald-50/60 border border-emerald-100 p-4 rounded-2xl space-y-3 mt-3">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          {headerType === 'IMAGE' && <Image size={16} className="text-emerald-600" />}
          {headerType === 'VIDEO' && <Video size={16} className="text-emerald-600" />}
          {headerType === 'DOCUMENT' && <FileText size={16} className="text-emerald-600" />}
          <span className="text-xs font-black text-emerald-900 uppercase tracking-wider">
            Template Header {targetTypeLabel} Required
          </span>
        </div>
        <div className="flex gap-1 bg-white p-1 rounded-xl border border-emerald-200 text-[10px] font-bold">
          <button
            type="button"
            onClick={() => setTab('library')}
            className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
              tab === 'library' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Library size={10} /> Library
          </button>
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
              tab === 'upload' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Upload size={10} /> Upload
          </button>
        </div>
      </div>

      {tab === 'library' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-800">
              Showing {Math.min(typeFilteredAssets.length, 12)} of {typeFilteredAssets.length} creatives
            </span>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-white border border-emerald-200 px-3 py-1 rounded-lg shadow-sm flex items-center gap-1.5 transition-all hover:bg-emerald-50"
            >
              <Maximize2 size={12} /> Browse All Creatives with Product Filter
            </button>
          </div>

          {loadingAssets ? (
            <div className="flex items-center justify-center p-6 text-emerald-600 text-xs font-bold gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading creatives...
            </div>
          ) : typeFilteredAssets.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-48 overflow-y-auto custom-scrollbar p-1">
              {typeFilteredAssets.slice(0, 12).map(a => {
                const isSelected = mediaUrl === a.url
                const isProcessing = a.status === 'Processing' || a.status === 'Rendering'
                const propertyTitle = propertyMap.get(a.property_id)

                return (
                  <div
                    key={a.id || a.url}
                    onClick={() => { if (!isProcessing && a.url) onMediaSelect(a.url) }}
                    title={propertyTitle ? `Project: ${propertyTitle}` : 'Click to select'}
                    className={`group relative aspect-square rounded-xl overflow-hidden border-2 cursor-pointer transition-all bg-slate-100 shadow-sm ${
                      isSelected ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-slate-200 hover:border-emerald-400'
                    }`}
                  >
                    {isProcessing ? (
                      <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-slate-100 text-emerald-600">
                        <Loader2 size={16} className="animate-spin mb-1" />
                        <span className="text-[9px] font-bold text-slate-500">Generating...</span>
                      </div>
                    ) : headerType === 'VIDEO' ? (
                      <video src={`${a.url}#t=0.1`} className="w-full h-full object-cover" muted />
                    ) : headerType === 'DOCUMENT' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-slate-50">
                        <FileText size={20} className="text-emerald-600 mb-1" />
                        <span className="text-[9px] font-bold text-slate-700 truncate w-full">{a.caption || 'PDF'}</span>
                      </div>
                    ) : (
                      <img 
                        src={a.url} 
                        alt={a.title || 'Creative'} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" 
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.onerror = null;
                          target.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80';
                        }} 
                      />
                    )}

                    {propertyTitle && (
                      <div className="absolute bottom-0 inset-x-0 bg-slate-950/75 backdrop-blur-xs text-white text-[8px] font-bold px-1 py-0.5 truncate">
                        {propertyTitle}
                      </div>
                    )}

                    {isSelected && (
                      <div className="absolute top-1 right-1 bg-emerald-500 text-white p-0.5 rounded-full shadow-md ring-2 ring-white">
                        <Check size={12} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center p-4 text-xs font-bold text-slate-500 bg-white rounded-xl border border-slate-200">
              No matching {targetTypeLabel} assets found. Use Upload tab instead!
            </div>
          )}

          {typeFilteredAssets.length > 12 && (
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline"
              >
                + View all {typeFilteredAssets.length} creatives in modal
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
          <label className="text-[10px] font-bold text-slate-500 block uppercase">
            Upload custom {targetTypeLabel}:
          </label>
          <input
            type="file"
            accept={acceptedMime}
            onChange={handleFileUpload}
            disabled={uploading}
            className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
          />
          {uploading && (
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-600">
              <Loader2 size={14} className="animate-spin" /> Uploading {targetTypeLabel}...
            </div>
          )}
        </div>
      )}

      {mediaUrl && (
        <div className="bg-white p-2.5 rounded-xl border border-emerald-200 flex items-center justify-between text-xs font-bold text-emerald-900">
          <div className="flex items-center gap-2 truncate max-w-[80%]">
            <Check size={14} className="text-emerald-600 shrink-0" />
            <span className="truncate">Selected: {mediaUrl}</span>
          </div>
          <button type="button" onClick={() => onMediaSelect('')} className="text-red-500 text-[10px] font-bold hover:underline shrink-0">
            Clear
          </button>
        </div>
      )}

      {/* FULL CREATIVE PICKER MODAL WITH PRODUCT FILTER & SEARCH */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 shadow-sm">
                  <Library size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Creative Media Library</h3>
                  <p className="text-xs text-slate-500">
                    Filter by product/project and select the creative for your WhatsApp template or campaign
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Filter Toolbar */}
            <div className="px-6 py-3 border-b border-slate-100 bg-white flex flex-col sm:flex-row gap-3 items-center justify-between">
              {/* Product Filter */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Filter size={15} className="text-slate-400 shrink-0" />
                <span className="text-xs font-bold text-slate-700 whitespace-nowrap">Filter Product:</span>
                <select
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                  className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-64"
                >
                  <option value="all">All Products / Projects ({typeFilteredAssets.length})</option>
                  {properties.map(p => {
                    const count = typeFilteredAssets.filter(a => a.property_id === p.id).length
                    return (
                      <option key={p.id} value={p.id}>
                        {p.title} ({count})
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Search Bar */}
              <div className="relative w-full sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search caption or project..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Modal Body - Creative Grid */}
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              {loadingAssets ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                  <Loader2 size={32} className="animate-spin text-emerald-600" />
                  <span className="text-sm font-semibold">Loading creative assets...</span>
                </div>
              ) : modalFilteredAssets.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {modalFilteredAssets.map((a) => {
                    const isSelected = mediaUrl === a.url
                    const isProcessing = a.status === 'Processing' || a.status === 'Rendering'
                    const propertyTitle = propertyMap.get(a.property_id)

                    return (
                      <div
                        key={a.id || a.url}
                        onClick={() => {
                          if (!isProcessing && a.url) {
                            onMediaSelect(a.url)
                            setIsModalOpen(false)
                          }
                        }}
                        className={`group relative rounded-2xl overflow-hidden border-2 cursor-pointer transition-all bg-slate-100 flex flex-col shadow-sm hover:shadow-md ${
                          isSelected
                            ? 'border-emerald-500 ring-4 ring-emerald-500/20'
                            : 'border-slate-200 hover:border-emerald-400 hover:-translate-y-0.5'
                        }`}
                      >
                        {/* Media Thumbnail */}
                        <div className="relative aspect-square w-full bg-slate-200 overflow-hidden">
                          {isProcessing ? (
                            <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-slate-100 text-emerald-600">
                              <Loader2 size={24} className="animate-spin mb-2" />
                              <span className="text-xs font-bold text-slate-500">Generating...</span>
                            </div>
                          ) : headerType === 'VIDEO' ? (
                            <video src={`${a.url}#t=0.1`} className="w-full h-full object-cover" muted />
                          ) : headerType === 'DOCUMENT' ? (
                            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-slate-50">
                              <FileText size={36} className="text-emerald-600 mb-2" />
                              <span className="text-xs font-bold text-slate-700 line-clamp-2">{a.caption || 'PDF Document'}</span>
                            </div>
                          ) : (
                            <img
                              src={a.url}
                              alt={a.title || 'Creative'}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                const target = e.currentTarget;
                                target.onerror = null;
                                target.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80';
                              }}
                            />
                          )}

                          {isSelected && (
                            <div className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded-full shadow-lg ring-2 ring-white">
                              <Check size={16} />
                            </div>
                          )}
                        </div>

                        {/* Card Info Details */}
                        <div className="p-2.5 bg-white flex flex-col justify-between flex-1 border-t border-slate-100">
                          {propertyTitle ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md truncate mb-1">
                              {propertyTitle}
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-slate-400 mb-1">
                              General Creative
                            </span>
                          )}

                          {a.caption && (
                            <p className="text-[10px] text-slate-600 line-clamp-2 leading-tight">
                              {a.caption}
                            </p>
                          )}

                          <button
                            type="button"
                            className={`mt-2 w-full py-1 px-2 rounded-lg text-[11px] font-bold transition-colors ${
                              isSelected
                                ? 'bg-emerald-500 text-white'
                                : 'bg-slate-100 text-slate-700 group-hover:bg-emerald-50 group-hover:text-emerald-700'
                            }`}
                          >
                            {isSelected ? 'Selected' : 'Use Creative'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                    <Search size={22} />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 mb-1">No creatives found</h4>
                  <p className="text-xs text-slate-500 max-w-sm">
                    No {targetTypeLabel} assets match the selected product or search term. Try changing your filters.
                  </p>
                  {(selectedPropertyId !== 'all' || searchQuery) && (
                    <button
                      type="button"
                      onClick={() => { setSelectedPropertyId('all'); setSearchQuery('') }}
                      className="mt-3 text-xs font-bold text-emerald-600 hover:underline"
                    >
                      Reset filters
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Found <strong className="text-slate-800">{modalFilteredAssets.length}</strong> matching creatives
              </span>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors shadow-sm"
              >
                Close Library
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
