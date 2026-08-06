'use client'

import React from 'react'
import { Image, Video, FileText, ExternalLink, Phone, CornerDownLeft } from 'lucide-react'

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
  footerText = ''
}: WhatsAppLivePreviewProps) {

  // Meta Template Editor Body Text Parser (*bold*, **bold**, ***bold***)
  const renderPreviewBody = () => {
    if (!bodyText || !bodyText.trim()) {
      return <span className="text-[#8696a0] italic text-xs">Your message template body text will appear here...</span>;
    }

    let substituted = bodyText
      .replace(/\{\{1\}\}/g, sampleLeadName)
      .replace(/\{\{2\}\}/g, samplePropertyTitle)
      .replace(/\{\{3\}\}/g, sampleBusinessName)
      .replace(/\{\{(\d+)\}\}/g, 'Sample Value');

    const lines = substituted.split('\n');

    return (
      <div className="space-y-1.5 text-[#111b21] text-[13px] leading-[19px] break-words whitespace-pre-wrap font-sans">
        {lines.map((line, lineIdx) => {
          // Normalize double/triple asterisks into single asterisk (*text*)
          let cleanLine = line.replace(/\*{2,3}/g, '*');

          // Split line by bold (*text*), italic (_text_), strike (~text~)
          const parts = cleanLine.split(/(\*[^*]+\*|_[^_]+_|~[^~]+~)/g);

          return (
            <div key={lineIdx} className="min-h-[19px]">
              {parts.map((part, pIdx) => {
                if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                  return <strong key={pIdx} className="font-bold text-[#111b21]">{part.slice(1, -1)}</strong>
                }
                if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
                  return <em key={pIdx} className="italic text-[#111b21]">{part.slice(1, -1)}</em>
                }
                if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
                  return <del key={pIdx} className="line-through text-[#667781]">{part.slice(1, -1)}</del>
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
    <div className="w-full max-w-[340px] mx-auto bg-[#F5F6F8] rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm font-sans select-none relative">
      
      {/* Meta Template Header Title */}
      <div className="text-[11px] font-bold text-[#4b5563] uppercase tracking-wider mb-3 ml-1">
        Your template
      </div>

      {/* Meta Official WhatsApp Template Message Card */}
      <div className="w-full bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-slate-200/80 overflow-hidden relative">
        
        {/* HEADER MEDIA RENDERING */}
        {headerType === 'TEXT' && headerText && (
          <div className="px-4 pt-4 pb-2 font-bold text-[#111b21] text-[14px] leading-tight border-b border-slate-100">
            {headerText}
          </div>
        )}

        {headerType === 'IMAGE' && (
          <div className="w-full bg-[#f0f2f5] aspect-[16/9] flex items-center justify-center relative overflow-hidden">
            {headerMediaUrl ? (
              <img src={headerMediaUrl} alt="Header" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center justify-center text-[#8696a0] p-4 text-center space-y-1.5">
                <Image size={34} className="text-[#00a884]" />
                <span className="text-[11px] font-bold text-[#111b21] uppercase tracking-wider">Image Header</span>
                <span className="text-[9.5px] text-[#667781] font-medium">(Selected from Assets when sending)</span>
              </div>
            )}
          </div>
        )}

        {headerType === 'VIDEO' && (
          <div className="w-full bg-[#111b21] aspect-[16/9] flex items-center justify-center relative overflow-hidden">
            {headerMediaUrl ? (
              <video src={headerMediaUrl} className="w-full h-full object-cover" controls />
            ) : (
              <div className="flex flex-col items-center justify-center text-white p-4 text-center space-y-1.5">
                <Video size={34} className="text-[#25D366]" />
                <span className="text-[11px] font-bold text-white uppercase tracking-wider">Video Header (MP4)</span>
                <span className="text-[9.5px] text-slate-400 font-medium">(Selected from Assets when sending)</span>
              </div>
            )}
          </div>
        )}

        {headerType === 'DOCUMENT' && (
          <div className="m-3 p-3 bg-[#f0f2f5] rounded-xl border border-slate-200 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#ea4335] text-white flex items-center justify-center shrink-0 font-bold shadow-xs">
              <FileText size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold text-[#111b21] truncate">Brochure_Document.pdf</p>
              <p className="text-[9.5px] text-[#667781] font-medium">1 Page • PDF Document</p>
            </div>
          </div>
        )}

        {/* BODY & TIMESTAMP RENDERING */}
        <div className="p-4 space-y-2 relative">
          {renderPreviewBody()}

          {/* Optional Footer Text */}
          {footerText && (
            <div className="text-[11px] text-[#667781] pt-1.5 font-normal border-t border-slate-100">
              {footerText}
            </div>
          )}

          {/* Timestamp (Bottom Right) */}
          <div className="flex items-center justify-end text-[10px] text-[#8696a0] font-medium pt-1">
            <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        {/* INTERACTIVE BUTTONS RENDERING (META OFFICIAL STYLE) */}
        {buttonsType === 'QUICK_REPLY' && validQuickReplies.length > 0 && (
          <div className="border-t border-[#e9edef] divide-y divide-[#e9edef] bg-white">
            {validQuickReplies.map((btn, idx) => (
              <div key={idx} className="w-full py-2.5 px-3 text-[#008069] font-semibold text-[13px] text-center hover:bg-[#f9fafb] cursor-pointer flex items-center justify-center gap-1.5 transition-colors">
                <CornerDownLeft size={13} className="text-[#008069]" />
                <span>{btn}</span>
              </div>
            ))}
          </div>
        )}

        {buttonsType === 'CALL_TO_ACTION' && (ctaUrlText || ctaPhoneText) && (
          <div className="border-t border-[#e9edef] divide-y divide-[#e9edef] bg-white">
            {ctaUrlText && (
              <div className="w-full py-2.5 px-3 text-[#008069] font-semibold text-[13px] text-center hover:bg-[#f9fafb] cursor-pointer flex items-center justify-center gap-1.5 transition-colors">
                <ExternalLink size={13} className="text-[#008069]" />
                <span>{ctaUrlText}</span>
              </div>
            )}
            {ctaPhoneText && (
              <div className="w-full py-2.5 px-3 text-[#008069] font-semibold text-[13px] text-center hover:bg-[#f9fafb] cursor-pointer flex items-center justify-center gap-1.5 transition-colors">
                <Phone size={13} className="text-[#008069]" />
                <span>{ctaPhoneText}</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
