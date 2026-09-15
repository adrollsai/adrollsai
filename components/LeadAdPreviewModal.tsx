'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { X, ExternalLink, Play, Copy, Check, Sparkles, RefreshCw, Eye } from 'lucide-react'
import { toast } from 'sonner'

interface LeadAdPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  lead: any
  campaignName?: string
  onUpdateLead?: (updatedLead: any) => void
}

export default function LeadAdPreviewModal({
  isOpen,
  onClose,
  lead,
  campaignName,
  onUpdateLead
}: LeadAdPreviewModalProps) {
  const [loading, setLoading] = useState(false)
  const [copiedCopy, setCopiedCopy] = useState(false)
  const [fetchedData, setFetchedData] = useState<any>(null)
  const [videoError, setVideoError] = useState(false)
  const [imgError, setImgError] = useState(false)

  // Extract custom_fields
  const customFields = useMemo(() => {
    if (!lead?.custom_fields) return {}
    let cf = lead.custom_fields
    if (typeof cf === 'string') {
      try {
        while (typeof cf === 'string') cf = JSON.parse(cf)
      } catch (e) {
        return {}
      }
    }
    return cf || {}
  }, [lead])

  const origin = useMemo(() => {
    return customFields?.meta_ad_origin || {}
  }, [customFields])

  // Reset states when lead changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setVideoError(false)
      setImgError(false)
      setCopiedCopy(false)
      setFetchedData(null)
    }
  }, [isOpen, lead?.id])

  // Fetch full creative if media URL is missing or on demand
  useEffect(() => {
    if (!isOpen || !lead) return

    const currentOrigin = origin
    const hasMedia = currentOrigin.video_url || currentOrigin.image_url
    const adId = currentOrigin.ad_id || lead.ad_id || customFields.ad_id

    // If media is missing, fetch from Meta API
    if (!hasMedia && (adId || lead.id)) {
      setLoading(true)
      fetch(`/api/meta-ads/video-source?adId=${encodeURIComponent(adId || '')}&leadId=${encodeURIComponent(lead.id || '')}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            setFetchedData(data)
            if (onUpdateLead) {
              const updatedLead = {
                ...lead,
                custom_fields: {
                  ...customFields,
                  meta_ad_origin: {
                    ...currentOrigin,
                    ...data
                  }
                }
              }
              onUpdateLead(updatedLead)
            }
          }
        })
        .catch(err => {
          console.error('[LeadAdPreviewModal Fetch Error]:', err)
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [isOpen, lead?.id])

  if (!isOpen || !lead) return null

  // Resolved values
  const effectiveOrigin = {
    ...origin,
    ...(fetchedData || {})
  }

  const effectiveCampaign = campaignName || effectiveOrigin.campaign_name || lead.campaign_name || 'Meta Ad Campaign'
  const effectiveHeadline = effectiveOrigin.headline || effectiveOrigin.ad_name || lead.ad_name || 'Meta Ad Promotion'
  const effectiveBody = effectiveOrigin.body || ''
  const effectiveAdName = effectiveOrigin.ad_name || lead.ad_name || 'Meta Ad Variation'
  const effectiveAdset = effectiveOrigin.adset_name || 'Default Ad Set'
  const effectiveVideoUrl = !videoError ? (effectiveOrigin.video_url || null) : null
  const effectiveImageUrl = !imgError ? (effectiveOrigin.image_url || null) : null
  const effectiveLinkUrl = effectiveOrigin.link_url || null
  const effectiveAdId = effectiveOrigin.ad_id || customFields.ad_id || null
  const effectiveLiveAdUrl = effectiveOrigin.source_url || (effectiveAdId ? `https://www.facebook.com/ads/library/?id=${effectiveAdId}` : null)

  const copyAdCopy = () => {
    const textToCopy = `${effectiveHeadline ? effectiveHeadline + '\n\n' : ''}${effectiveBody}`
    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy)
    setCopiedCopy(true)
    toast.success('Ad copy copied to clipboard!')
    setTimeout(() => setCopiedCopy(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      {/* Backdrop click */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Modal Container */}
      <div 
        className="relative z-10 bg-slate-900 border border-slate-800 text-white w-full max-w-2xl rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile Pull Bar */}
        <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm sm:text-base text-white truncate">Ad Creative & Lead Origin</h3>
                <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                  Live Preview
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Source details for <strong className="text-slate-200">{lead.name || 'Lead'}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {effectiveLiveAdUrl && (
              <a
                href={effectiveLiveAdUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden xs:flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
                title="Open live Meta Ad or Library"
              >
                <span>Live Ad</span>
                <ExternalLink size={12} />
              </a>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Close modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          
          {/* Campaign & Ad Set Header Banner */}
          <div className="bg-gradient-to-r from-slate-800/90 to-slate-800/40 p-3.5 rounded-2xl border border-slate-700/60 shadow-xs flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                📢 Campaign
              </span>
              <span className="text-[10px] font-bold text-slate-400 truncate max-w-[200px]">
                {effectiveAdset}
              </span>
            </div>
            <h4 className="font-extrabold text-white text-sm sm:text-base leading-snug break-words" title={effectiveCampaign}>
              {effectiveCampaign}
            </h4>
          </div>

          {/* Media Player / Image Creative Container */}
          <div className="relative bg-black rounded-2xl overflow-hidden border border-slate-800 min-h-[220px] max-h-[50vh] flex items-center justify-center shadow-inner">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
                <RefreshCw size={24} className="animate-spin text-indigo-500" />
                <span className="text-xs font-bold">Loading ad creative from Meta...</span>
              </div>
            ) : effectiveVideoUrl ? (
              <video
                src={effectiveVideoUrl}
                controls
                autoPlay
                playsInline
                onError={() => setVideoError(true)}
                className="w-full max-h-[48vh] object-contain rounded-xl"
              />
            ) : effectiveImageUrl ? (
              <img
                src={effectiveImageUrl}
                alt={effectiveHeadline}
                onError={() => setImgError(true)}
                className="w-full max-h-[48vh] object-contain rounded-xl"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Eye size={22} />
                </div>
                <div className="text-xs font-extrabold text-slate-200">
                  {effectiveHeadline || 'Meta Ad Submission'}
                </div>
                <p className="text-[11px] text-slate-400 max-w-sm">
                  This lead responded directly to the Meta Ad copy below.
                </p>
              </div>
            )}

            {/* Top pill for Media Format */}
            {(effectiveVideoUrl || effectiveImageUrl) && (
              <div className="absolute top-2.5 left-2.5 px-2.5 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[10px] font-black uppercase text-white/90 border border-white/10 flex items-center gap-1 shadow-sm">
                {effectiveVideoUrl ? <Play size={10} className="fill-white" /> : '📷'}
                <span>{effectiveVideoUrl ? 'Video Ad' : 'Image Ad'}</span>
              </div>
            )}
          </div>

          {/* Ad Copy Section */}
          <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/80 space-y-3 shadow-xs">
            {/* Headline */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-[9px] font-black uppercase text-indigo-400 tracking-wider block">
                  Ad Headline
                </span>
                <h5 className="font-extrabold text-white text-sm sm:text-base mt-0.5 leading-snug">
                  {effectiveHeadline}
                </h5>
              </div>

              {effectiveBody && (
                <button
                  type="button"
                  onClick={copyAdCopy}
                  className="px-2.5 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer shadow-2xs active:scale-95"
                  title="Copy ad copy to clipboard"
                >
                  {copiedCopy ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copiedCopy ? 'Copied' : 'Copy'}</span>
                </button>
              )}
            </div>

            {/* Primary Text / Body */}
            {effectiveBody ? (
              <div>
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                  Ad Copy (Primary Text)
                </span>
                <div className="p-3 bg-slate-900/70 rounded-xl border border-slate-700/60 max-h-56 overflow-y-auto">
                  <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed font-normal">
                    {effectiveBody}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 italic bg-slate-900/50 p-2.5 rounded-xl border border-slate-700/40">
                No custom ad body text recorded for this variation.
              </div>
            )}

            {/* Destination Link / CTA */}
            {effectiveLinkUrl && (
              <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Destination Link:</span>
                <a
                  href={effectiveLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-bold text-indigo-400 hover:text-indigo-300 hover:underline truncate max-w-xs flex items-center gap-1"
                >
                  <span className="truncate">{effectiveLinkUrl}</span>
                  <ExternalLink size={12} className="shrink-0" />
                </a>
              </div>
            )}
          </div>

          {/* Ad Variation & Identifier Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
            <div className="bg-slate-800/50 p-2.5 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider">Ad Name / Variation</span>
              <span className="font-extrabold text-slate-100 truncate block mt-0.5" title={effectiveAdName}>
                {effectiveAdName}
              </span>
            </div>
            <div className="bg-slate-800/50 p-2.5 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider">Ad Set</span>
              <span className="font-extrabold text-slate-100 truncate block mt-0.5" title={effectiveAdset}>
                {effectiveAdset}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-slate-800/50 p-2.5 rounded-xl border border-slate-700/50">
              <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider">Ad ID</span>
              <span className="font-extrabold text-slate-100 truncate block mt-0.5" title={effectiveAdId || 'N/A'}>
                {effectiveAdId || 'Meta Ad ID'}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
            <span>Lead Phone:</span>
            <strong className="text-slate-200 font-mono">{lead.phone || 'N/A'}</strong>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {effectiveLiveAdUrl && (
              <a
                href={effectiveLiveAdUrl}
                target="_blank"
                rel="noreferrer"
                className="xs:hidden px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1"
              >
                <span>Live Ad</span>
                <ExternalLink size={12} />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
