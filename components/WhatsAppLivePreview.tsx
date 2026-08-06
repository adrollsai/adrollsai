'use client'

import React from 'react'
import { Image, Video, FileText, ExternalLink, Phone, Reply, CheckCheck } from 'lucide-react'

interface WhatsAppLivePreviewProps {
  headerType?: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null
  headerText?: string
  headerMediaUrl?: string
  bodyText: string
  sampleLeadName?: string
  samplePropertyTitle?: string
  sampleBusinessName?: string
  buttonsType?: 'NONE' | 'QUICK_REPLY' | 'CALL_TO_ACTION' | null
  quickReplyButtons?: string[]
  ctaUrlText?: string
  ctaUrl?: string
  ctaPhoneText?: string
  ctaPhone?: string
  footerText?: string
}

export default function WhatsAppLivePreview({
  headerType = 'NONE',
  headerText = '',
  headerMediaUrl = '',
  bodyText = '',
  sampleLeadName = 'Rahul Sharma',
  samplePropertyTitle = 'Green Valley Luxury Villas',
  sampleBusinessName = 'Nobogent AI',
  buttonsType = 'NONE',
  quickReplyButtons = [],
  ctaUrlText = '',
  ctaUrl = '',
  ctaPhoneText = '',
  ctaPhone = '',
  footerText = 'Reply STOP to opt out'
}: WhatsAppLivePreviewProps) {

  // Replace variable placeholders like {{1}}, {{2}}, {{3}} with live preview data
  const renderPreviewBody = () => {
    if (!bodyText) return <span className="text-slate-400 italic">Your message body will appear here...</span>;

    let substituted = bodyText
      .replace(/\{\{1\}\}/g, sampleLeadName)
      .replace(/\{\{2\}\}/g, samplePropertyTitle)
      .replace(/\{\{3\}\}/g, sampleBusinessName)
      .replace(/\{\{(\d+)\}\}/g, 'Sample Value');

    // Split by newlines for clean paragraph formatting
    const lines = substituted.split('\n');

    return (
      <div className="space-y-1 text-slate-800 text-[13px] leading-relaxed break-words whitespace-pre-wrap font-sans">
        {lines.map((line, idx) => {
          // Parse basic bold markdown (*text*)
          const parts = line.split(/(\*[^*]+\*)/g);
          return (
            <div key={idx}>
              {parts.map((part, pIdx) => {
                if (part.startsWith('*') && part.endsWith('*')) {
                  return <strong key={pIdx} className="font-bold text-slate-950">{part.slice(1, -1)}</strong>
                }
                return <span key={pIdx}>{part}</span>
              })}
            </div>
          )
        })}
      </div>
    );
  };

  const validQuickReplies = (quickReplyButtons || []).filter(b => !!b?.trim());

  return (
    <div className="w-full max-w-sm mx-auto bg-[#E5DDD5] rounded-3xl p-4 shadow-inner border border-slate-300 relative overflow-hidden font-sans select-none">
      {/* WhatsApp Chat Header Mock */}
      <div className="bg-[#075E54] text-white p-3 rounded-2xl flex items-center gap-3 mb-3 shadow-sm">
        <div className="w-8 h-8 rounded-full bg-emerald-400 text-[#075E54] font-black flex items-center justify-center text-xs shadow-inner">
          💬
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-bold truncate">WhatsApp Message Preview</h4>
          <p className="text-[10px] text-emerald-200 font-medium">Business Account • Official Template</p>
        </div>
        <span className="text-[9px] bg-emerald-800/60 px-2 py-0.5 rounded-full text-emerald-200 font-bold uppercase tracking-wider">PREVIEW</span>
      </div>

      {/* WhatsApp Message Bubble */}
      <div className="bg-white rounded-2xl p-3 shadow-md border border-slate-200/80 space-y-2 relative">
        {/* HEADER RENDERING */}
        {headerType === 'TEXT' && headerText && (
          <div className="font-bold text-slate-900 text-sm border-b border-slate-100 pb-1.5 leading-snug">
            {headerText}
          </div>
        )}

        {headerType === 'IMAGE' && (
          <div className="rounded-xl overflow-hidden bg-slate-100 border border-slate-200/60 aspect-video flex items-center justify-center relative">
            {headerMediaUrl ? (
              <img src={headerMediaUrl} alt="Header" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-400 p-4 text-center space-y-1">
                <Image size={28} className="text-slate-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Image Header</span>
                <span className="text-[9px] text-slate-400">(Selected from Assets on send)</span>
              </div>
            )}
          </div>
        )}

        {headerType === 'VIDEO' && (
          <div className="rounded-xl overflow-hidden bg-slate-900 border border-slate-800 aspect-video flex items-center justify-center relative">
            {headerMediaUrl ? (
              <video src={headerMediaUrl} className="w-full h-full object-cover" controls />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-300 p-4 text-center space-y-1">
                <Video size={28} className="text-emerald-400 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-200">Video Header (MP4)</span>
                <span className="text-[9px] text-slate-400">(Selected from Assets on send)</span>
              </div>
            )}
          </div>
        )}

        {headerType === 'DOCUMENT' && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0 font-bold">
              <FileText size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-800 truncate">Attachment_Document.pdf</p>
              <p className="text-[10px] text-slate-400 font-semibold">PDF Document • Header</p>
            </div>
          </div>
        )}

        {/* BODY RENDERING */}
        <div className="pt-1">
          {renderPreviewBody()}
        </div>

        {/* FOOTER & TIMESTAMP */}
        <div className="flex justify-between items-end pt-1 text-[10px] text-slate-400">
          <span>{footerText}</span>
          <div className="flex items-center gap-1 ml-auto">
            <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <CheckCheck size={14} className="text-blue-500" />
          </div>
        </div>
      </div>

      {/* BUTTONS RENDERING */}
      {buttonsType === 'QUICK_REPLY' && validQuickReplies.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {validQuickReplies.map((btn, idx) => (
            <div key={idx} className="w-full bg-white hover:bg-slate-50 text-emerald-600 font-bold text-xs py-2 px-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-colors">
              <Reply size={13} className="text-emerald-500" />
              <span>{btn}</span>
            </div>
          ))}
        </div>
      )}

      {buttonsType === 'CALL_TO_ACTION' && (ctaUrlText || ctaPhoneText) && (
        <div className="mt-2 space-y-1.5">
          {ctaUrlText && (
            <div className="w-full bg-white hover:bg-slate-50 text-blue-600 font-bold text-xs py-2 px-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-colors">
              <ExternalLink size={13} className="text-blue-500" />
              <span>{ctaUrlText}</span>
            </div>
          )}
          {ctaPhoneText && (
            <div className="w-full bg-white hover:bg-slate-50 text-emerald-600 font-bold text-xs py-2 px-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-colors">
              <Phone size={13} className="text-emerald-500" />
              <span>{ctaPhoneText}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
