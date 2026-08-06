'use client'

import React, { useState, useEffect } from 'react'
import { Image, Video, FileText, Upload, Check, Loader2, Library } from 'lucide-react'

interface WhatsAppTemplateMediaPickerProps {
  headerType: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null
  mediaUrl: string
  onMediaSelect: (url: string) => void
  userAssets?: any[]
}

export default function WhatsAppTemplateMediaPicker({
  headerType,
  mediaUrl,
  onMediaSelect,
  userAssets = []
}: WhatsAppTemplateMediaPickerProps) {
  const [tab, setTab] = useState<'library' | 'upload'>('library')
  const [uploading, setUploading] = useState(false)
  const [localAssets, setLocalAssets] = useState<any[]>(userAssets)
  const [loadingAssets, setLoadingAssets] = useState(false)

  useEffect(() => {
    if (userAssets && userAssets.length > 0) {
      setLocalAssets(userAssets)
    } else {
      fetchAssets()
    }
  }, [])

  const fetchAssets = async () => {
    setLoadingAssets(true)
    try {
      const res = await fetch('/api/assets')
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

  const filteredAssets = localAssets.filter(a => {
    if (!a.url && a.status !== 'Processing') return false
    const fileType = (a.type || '').toLowerCase()
    if (headerType === 'IMAGE') return fileType === 'image' || !a.url || a.url.match(/\.(png|jpg|jpeg|webp)$/i)
    if (headerType === 'VIDEO') return fileType === 'video' || (a.url && a.url.match(/\.(mp4|mov|webm)$/i))
    if (headerType === 'DOCUMENT') return fileType === 'pdf' || fileType === 'document' || (a.url && a.url.match(/\.(pdf)$/i))
    return true
  })

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
          {loadingAssets ? (
            <div className="flex items-center justify-center p-6 text-emerald-600 text-xs font-bold gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading assets...
            </div>
          ) : filteredAssets.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto custom-scrollbar p-1">
              {filteredAssets.slice(0, 16).map(a => {
                const isSelected = mediaUrl === a.url
                const isProcessing = a.status === 'Processing' || a.status === 'Rendering'

                return (
                  <div
                    key={a.id || a.url}
                    onClick={() => { if (!isProcessing && a.url) onMediaSelect(a.url) }}
                    className={`relative aspect-square rounded-xl overflow-hidden border-2 cursor-pointer transition-all bg-slate-100 ${
                      isSelected ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-slate-200 hover:border-emerald-300'
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
                        alt={a.title || 'Asset'} 
                        className="w-full h-full object-cover" 
                        onError={(e) => {
                          // Clean fallback image if asset URL fails to load
                          const target = e.currentTarget;
                          target.onerror = null;
                          target.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80';
                        }} 
                      />
                    )}
                    {isSelected && (
                      <div className="absolute top-1 right-1 bg-emerald-500 text-white p-0.5 rounded-full shadow-sm">
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
          <span className="truncate max-w-[280px]">Selected: {mediaUrl}</span>
          <button type="button" onClick={() => onMediaSelect('')} className="text-red-500 text-[10px] font-bold hover:underline">
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
