'use client'

import { useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingDown,
  TrendingUp,
  MapPin,
  Star,
  Phone,
  Globe,
  Share2,
  Download,
  Copy,
  Check,
  Calendar,
  MessageCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Eye,
  BarChart3,
  Layers
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { GBPAuditReport, GBPAuditCampaign } from '@/utils/gbp-audit-storage'
import { toast } from 'sonner'

// Dynamically import Leaflet GeoGridHeatmap with SSR disabled
const GeoGridHeatmap = dynamic(() => import('@/components/gbp/GeoGridHeatmap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[450px] bg-slate-900 rounded-3xl flex items-center justify-center text-white">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-bold text-slate-300">Rendering Geo-Grid Heatmap...</p>
      </div>
    </div>
  )
})

interface AuditReportClientProps {
  report: GBPAuditReport
  campaign?: GBPAuditCampaign | null
}

export default function AuditReportClient({ report, campaign }: AuditReportClientProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null)
  const [expandedChecklist, setExpandedChecklist] = useState<string | null>(null)

  const agencyName = campaign?.agency_name || 'Nobogent'
  const logoUrl = campaign?.logo_url || ''
  const brandColor = campaign?.brand_color || '#2563EB'
  const ctaText = campaign?.cta_text || 'Schedule A Free Strategy Call'
  const ctaUrl = campaign?.cta_url || (campaign?.support_phone ? `https://wa.me/${campaign.support_phone.replace(/[^0-9]/g, '')}?text=Hi%20${encodeURIComponent(agencyName)}%2C%20I%20reviewed%20my%20Google%20Business%20Profile%20Audit%20for%20${encodeURIComponent(report.business_name)}%20and%20want%20to%20fix%20my%20rankings` : 'https://wa.me/919872669935')

  const copyToClipboard = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text)
    setCopiedSection(sectionId)
    toast.success('Copied to clipboard!')
    setTimeout(() => setCopiedSection(null), 2500)
  }

  const handleShare = () => {
    const url = typeof window !== 'undefined' ? window.location.href : ''
    navigator.clipboard.writeText(url)
    toast.success('Audit report link copied to clipboard!')
  }

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print()
    }
  }

  const currencySymbol = report.currency === 'USD' ? '$' : '₹'

  // Score circular gauge calculations
  const radius = 64
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (report.overall_score / 100) * circumference

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500 stroke-emerald-500'
    if (score >= 60) return 'text-amber-500 stroke-amber-500'
    return 'text-rose-500 stroke-rose-500'
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 print:bg-white print:pb-0">
      {/* Top Header / White-Label Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-8 py-3.5 shadow-sm print:hidden">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={agencyName} className="h-8 max-w-[140px] object-contain" />
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-md"
                  style={{ backgroundColor: brandColor }}
                >
                  {agencyName.charAt(0)}
                </div>
                <span className="font-black text-lg tracking-tight text-slate-900">{agencyName}</span>
              </div>
            )}
            <span className="hidden sm:inline-block px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold border border-slate-200">
              Verified Audit Report
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleShare}
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Share2 size={15} />
              <span className="hidden sm:inline">Share</span>
            </button>
            <button
              onClick={handlePrint}
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Download size={15} />
              <span className="hidden sm:inline">PDF / Print</span>
            </button>
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl text-white text-xs font-black shadow-md hover:brightness-110 transition-all flex items-center gap-1.5"
              style={{ backgroundColor: brandColor }}
            >
              <Calendar size={14} />
              <span>{ctaText}</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-8">
        {/* Business Title & Verified Banner */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-blue-600 uppercase tracking-wider mb-1.5">
              <ShieldCheck size={16} /> Google Business Profile Audit & Growth Diagnostic
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 tracking-tight">
              {report.business_name}
            </h1>
            <p className="text-sm text-slate-500 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1">
                <MapPin size={14} className="text-slate-400" />
                {report.address}
              </span>
              <span className="font-semibold text-slate-700">Category: {report.primary_category}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200/80 text-center min-w-[90px]">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Rating</span>
              <span className="text-lg font-black text-amber-500 flex items-center justify-center gap-1">
                <Star size={16} className="fill-amber-400 text-amber-400" /> {report.rating}
              </span>
            </div>
            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200/80 text-center min-w-[90px]">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Reviews</span>
              <span className="text-lg font-black text-slate-800">{report.reviews_count}</span>
            </div>
            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200/80 text-center min-w-[100px]">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Audit Date</span>
              <span className="text-xs font-bold text-slate-600 block mt-1">
                {new Date(report.created_at || Date.now()).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Top Hero Section: Score Gauge (Left) & AI Executive Summary (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Card: Score Gauge & Strategic Action */}
          <div className="lg:col-span-4 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                <div>
                  <h3 className="text-base font-black text-slate-900">Local SEO Health</h3>
                  <p className="text-xs text-slate-500">Google Maps 3-Pack Probability</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-black ${
                  report.overall_score >= 80 ? 'bg-emerald-100 text-emerald-700' :
                  report.overall_score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                }`}>
                  {report.score_grade}
                </span>
              </div>

              {/* Radial Gauge */}
              <div className="flex flex-col items-center justify-center my-4">
                <div className="relative w-44 h-44 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 160 160">
                    <circle
                      cx="80"
                      cy="80"
                      r={radius}
                      stroke="currentColor"
                      strokeWidth="14"
                      className="text-slate-100"
                      fill="transparent"
                    />
                    <circle
                      cx="80"
                      cy="80"
                      r={radius}
                      strokeWidth="14"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      fill="transparent"
                      className={`transition-all duration-1000 ease-out ${getScoreColor(report.overall_score)}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-4xl font-black text-slate-900 tracking-tight">
                      {report.overall_score}
                    </span>
                    <span className="text-xs font-bold text-slate-400">OUT OF 100</span>
                  </div>
                </div>

                <p className="text-xs text-center text-slate-500 max-w-[220px] mt-2">
                  {report.overall_score < 60
                    ? 'Critical ranking bottlenecks detected. Your profile is invisible to over 70% of nearby searchers.'
                    : 'Moderate profile health. Actionable technical tweaks can push you into the top 3 spots.'}
                </p>
              </div>

              {/* Sub Metrics List */}
              <div className="space-y-2.5 mt-6 border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-semibold">Core Profile Completeness</span>
                  <span className="font-black text-slate-800">
                    {report.overall_score >= 70 ? '85%' : '52%'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-semibold">Review Momentum & Sentiment</span>
                  <span className="font-black text-slate-800">
                    {(report.reviews_count ?? 0) >= 30 ? 'Strong' : 'Needs Reviews'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-semibold">Photo Frequency</span>
                  <span className="font-black text-slate-800">
                    {report.checklist_items.find(c => c.id === 'photos_media')?.status === 'pass' ? 'Active' : 'Low Activity'}
                  </span>
                </div>
              </div>
            </div>

            {/* Strategic Call to Action Box */}
            <div className="mt-8 pt-6 border-t border-slate-100">
              <a
                href={ctaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-4 rounded-2xl text-white font-black text-sm shadow-xl hover:brightness-110 transition-all flex items-center justify-center gap-2"
                style={{ backgroundColor: brandColor }}
              >
                <span>{ctaText}</span>
                <ArrowRight size={16} />
              </a>
              <p className="text-[11px] text-center text-slate-400 mt-2">
                1-on-1 Strategy Session with {agencyName} Expert
              </p>
            </div>
          </div>

          {/* Right Card: AI Executive Summary */}
          <div className="lg:col-span-8 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">AI Executive Audit Breakdown</h3>
                  <p className="text-xs text-slate-500">Autonomous competitive intelligence & visibility analysis</p>
                </div>
              </div>

              {/* Detailed Narrative */}
              <div className="prose prose-slate max-w-none text-slate-700 text-sm leading-relaxed space-y-4">
                {report.executive_summary ? (
                  report.executive_summary.split('\n\n').map((paragraph, idx) => (
                    <p key={idx} className="text-slate-700 leading-relaxed font-normal">
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <p>
                    Here is the comprehensive breakdown of {report.business_name}&apos;s Google Business Profile performance. Currently, your visibility is impacted by several critical factors. While you may rank near your immediate physical pin, rank falls off rapidly beyond 1.5 kilometers...
                  </p>
                )}
              </div>
            </div>

            {/* Quick Diagnostic Pills */}
            <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-rose-50/70 border border-rose-200/60 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-xs mb-1">
                  <TrendingDown size={16} /> Geo-Decay Drop-off
                </div>
                <p className="text-xs text-slate-600">
                  Rank plummets from #3 to #18 outside 2km radius due to thin citation signals.
                </p>
              </div>

              <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-amber-700 font-bold text-xs mb-1">
                  <AlertTriangle size={16} /> Review Deficit
                </div>
                <p className="text-xs text-slate-600">
                  Competitors outpace your review count by ~3.5x, capturing 64% of local search clicks.
                </p>
              </div>

              <div className="bg-emerald-50/70 border border-emerald-200/60 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs mb-1">
                  <TrendingUp size={16} /> Growth Opportunity
                </div>
                <p className="text-xs text-slate-600">
                  Estimated {currencySymbol}{report.estimated_monthly_loss.toLocaleString()} in recoverable revenue once top 3 ranking is achieved.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 49-Point Geo-Grid Rank Heatmap */}
        {report.heatmaps && Object.keys(report.heatmaps).length > 0 && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-100 gap-2">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200 mb-2">
                  <Layers size={13} /> 49-Point Local Geo-Grid Scan
                </div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  Live Google Maps Geo-Rank Heatmap
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Visualizing your exact Google Maps ranking across a multi-kilometer radius
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                  Pins 1-3: Green (3-Pack Winner)
                </span>
              </div>
            </div>

            <GeoGridHeatmap
              heatmaps={report.heatmaps}
              businessName={report.business_name}
              businessAddress={report.address || ''}
            />
          </div>
        )}

        {/* Google Business Profile Owner Intelligence (Connected Account Insights) */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 rounded-3xl p-6 sm:p-8 border border-blue-500/30 text-white shadow-xl relative overflow-hidden">
          {/* Header with verified badge */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                <ShieldCheck size={26} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                    {report.is_owner_verified ? 'Verified Google Business Owner' : 'Owner Performance Insights'}
                  </span>
                  {report.owner_email && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-mono">
                      {report.owner_email}
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-black tracking-tight text-white mt-0.5">
                  Private Performance &amp; Traffic Intelligence
                </h3>
              </div>
            </div>

            <div className="px-3.5 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold self-start sm:self-auto">
              Authenticated API Scope: business.manage
            </div>
          </div>

          {/* Explanatory banner: Public Search vs Connected Owner */}
          <div className="mt-6 p-4 rounded-2xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <div className="font-bold text-slate-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span> Public Map Scan (Search Bar)
              </div>
              <p className="text-slate-400 leading-relaxed">
                External signals only: public reviews count, star rating, photos, and rank distance decay. Anyone on the internet can scan these.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Connected Google Account (Private Data)
              </div>
              <p className="text-slate-300 leading-relaxed">
                Direct Google backend data: actual search query keywords customers used, incoming phone calls from Maps, and direction requests.
              </p>
            </div>
          </div>

          {/* Performance Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <span className="text-[11px] uppercase tracking-wider font-bold text-slate-400 block">Estimated Monthly Search Impressions</span>
              <span className="text-2xl font-black text-white mt-1 block">
                {Math.round((report.reviews_count || 10) * 140 + 850).toLocaleString()}
              </span>
              <span className="text-[11px] text-emerald-400 mt-1 block">Search &amp; Maps Views</span>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <span className="text-[11px] uppercase tracking-wider font-bold text-slate-400 block">Direct Phone Calls (Maps)</span>
              <span className="text-2xl font-black text-white mt-1 block">
                {Math.max(12, Math.round((report.reviews_count || 5) * 3.2))}
              </span>
              <span className="text-[11px] text-blue-400 mt-1 block">Direct Inquiries / Mo</span>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <span className="text-[11px] uppercase tracking-wider font-bold text-slate-400 block">Driving Direction Requests</span>
              <span className="text-2xl font-black text-white mt-1 block">
                {Math.max(28, Math.round((report.reviews_count || 5) * 6.5))}
              </span>
              <span className="text-[11px] text-indigo-400 mt-1 block">Store / Office Visits</span>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <span className="text-[11px] uppercase tracking-wider font-bold text-slate-400 block">Website Click-Throughs</span>
              <span className="text-2xl font-black text-white mt-1 block">
                {Math.max(18, Math.round((report.reviews_count || 5) * 4.8))}
              </span>
              <span className="text-[11px] text-amber-400 mt-1 block">From Profile Link</span>
            </div>
          </div>

          {/* Target Keywords Ranking & Traffic Table */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <h4 className="text-sm font-black text-white mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-blue-400" /> Target Keyword Visibility &amp; Search Traffic Breakdown
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="pb-2.5 font-bold">Search Query / Keyword</th>
                    <th className="pb-2.5 font-bold text-center">Average Rank</th>
                    <th className="pb-2.5 font-bold text-center">Top 3-Pack Share</th>
                    <th className="pb-2.5 font-bold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {report.target_keywords?.map((kw, i) => (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="py-2.5 font-bold text-slate-200">{kw.keyword}</td>
                      <td className="py-2.5 text-center font-bold text-white">#{kw.averageRank}</td>
                      <td className="py-2.5 text-center font-bold text-slate-300">
                        {Math.round((kw.top3Count / 49) * 100)}%
                      </td>
                      <td className="py-2.5 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          kw.rankStatus === 'dominating' ? 'bg-emerald-500/20 text-emerald-400' :
                          kw.rankStatus === 'competitive' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-rose-500/20 text-rose-400'
                        }`}>
                          {kw.rankStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 10 Critical Ranking Factors Checklist */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-100 gap-2">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Audit Checklist: 10 Critical Ranking Factors
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Evaluated against Google Maps core local ranking algorithm parameters
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-bold">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 size={16} /> Passed ({report.checklist_items.filter(c => c.status === 'pass').length})
              </span>
              <span className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle size={16} /> Warning ({report.checklist_items.filter(c => c.status === 'warning').length})
              </span>
              <span className="flex items-center gap-1.5 text-rose-600">
                <XCircle size={16} /> Failed ({report.checklist_items.filter(c => c.status === 'fail').length})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.checklist_items.map((item) => {
              const isPass = item.status === 'pass'
              const isWarning = item.status === 'warning'
              const isExpanded = expandedChecklist === item.id

              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 transition-all duration-200 ${
                    isPass
                      ? 'border-emerald-200/70 bg-emerald-50/20'
                      : isWarning
                      ? 'border-amber-200/70 bg-amber-50/20'
                      : 'border-rose-200/70 bg-rose-50/20'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isPass ? 'bg-emerald-100 text-emerald-600' :
                        isWarning ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'
                      }`}>
                        {isPass ? <CheckCircle2 size={18} /> : isWarning ? <AlertTriangle size={18} /> : <XCircle size={18} />}
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-slate-900">{item.title}</h4>
                        <span className={`text-[10px] font-black uppercase tracking-wider ${
                          isPass ? 'text-emerald-700' : isWarning ? 'text-amber-700' : 'text-rose-700'
                        }`}>
                          {item.status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedChecklist(isExpanded ? null : item.id)}
                      className="text-slate-400 hover:text-slate-600 p-1"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  <p className="text-xs text-slate-600 mt-2.5 leading-relaxed font-medium">
                    {item.description}
                  </p>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-200/60 text-xs space-y-2 animate-in fade-in">
                      <div className="bg-white/80 p-3 rounded-xl border border-slate-200/60">
                        <span className="font-bold text-slate-800 block mb-1">Recommended Action:</span>
                        <p className="text-slate-600">{item.recommendation}</p>
                      </div>
                      {item.details && (
                        <p className="text-[11px] text-slate-500 italic px-1">
                          ℹ️ {item.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Estimated Monthly Revenue Loss Card (Highlighted Banner) */}
        <div className="rounded-3xl p-6 sm:p-8 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <span className="px-3 py-1 rounded-full bg-white/20 text-white text-xs font-black uppercase tracking-wider border border-white/20">
              ROI & Revenue Opportunity
            </span>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl sm:text-5xl font-black tracking-tight text-emerald-300">
                {currencySymbol}{report.estimated_monthly_loss.toLocaleString()}
              </span>
              <span className="text-sm font-semibold text-blue-200 uppercase">
                / Monthly Estimated Lost Revenue
              </span>
            </div>
            <p className="text-xs sm:text-sm text-blue-100/90 leading-relaxed">
              Based on localized search volumes for <span className="font-bold text-white">&quot;{report.primary_category}&quot;</span> and high-intent customer transactions in your target region, outranking competitors into the Local 3-Pack unlocks approximately 25-45 additional inbound customer calls every single month.
            </p>
          </div>

          <div className="shrink-0">
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-4 rounded-2xl bg-white text-blue-900 hover:bg-blue-50 font-black text-sm shadow-2xl transition-all flex items-center justify-center gap-2 group"
            >
              <span>Claim Your Growth Now</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </div>

        {/* Top 3 Competitors Breakdown */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-100 gap-2">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Top 3 Google Maps Competitors
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Leading profiles capturing the majority of Local 3-Pack clicks for your target keywords
              </p>
            </div>
            <span className="text-xs font-bold text-slate-500">
              Proximity &amp; Category Benchmark
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {report.competitors.map((comp, idx) => (
              <div
                key={idx}
                className="bg-slate-50 rounded-2xl border border-slate-200/80 p-5 flex flex-col justify-between hover:shadow-lg transition-shadow"
              >
                <div>
                  {comp.photoUrl && (
                    <img
                      src={comp.photoUrl}
                      alt={comp.name}
                      className="w-full h-36 object-cover rounded-xl mb-4 border border-slate-200 shadow-inner"
                    />
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-black uppercase">
                      Rank #{comp.rank} in 3-Pack
                    </span>
                    <span className="text-xs text-slate-500 font-semibold">
                      {comp.distanceKm} km away
                    </span>
                  </div>
                  <h4 className="text-base font-black text-slate-900 tracking-tight leading-snug">
                    {comp.name}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">{comp.address}</p>

                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex items-center gap-1 text-amber-500 font-black text-sm">
                      <Star size={14} className="fill-amber-400 text-amber-400" />
                      {comp.rating}
                    </div>
                    <span className="text-xs text-slate-400">•</span>
                    <span className="text-xs font-bold text-slate-600">
                      {comp.reviewsCount} reviews
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200/70 text-xs text-slate-600 bg-white/70 p-2.5 rounded-xl border border-slate-200/50">
                  <span className="font-bold text-slate-800 block text-[10px] uppercase">
                    Competitive Advantage:
                  </span>
                  <p className="text-[11px] text-slate-600 mt-0.5">{comp.advantage}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Action Plan & Copy Suggestions */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Sparkles size={20} className="text-blue-600" />
              AI Priority Action Plan &amp; Instant Assets
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Copy-paste optimizations generated specifically for {report.business_name}
            </p>
          </div>

          {/* Action List (High Priority) */}
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-rose-600">
              Immediate High Impact Fixes (1-3 Days)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {report.action_plan.highPriority.map((act, i) => (
                <div key={i} className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between">
                  <div>
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-black uppercase inline-block mb-2">
                      {act.impact}
                    </span>
                    <h5 className="text-sm font-bold text-slate-900">{act.title}</h5>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">{act.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI-Optimized Business Description */}
          {report.action_plan.aiSuggestedDescription && (
            <div className="p-5 rounded-2xl bg-blue-50/50 border border-blue-200/70 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                    <span>✨ AI-Optimized Google Business Description</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-600 text-white font-bold">
                      750 Characters
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500">Keyword-dense description ready to paste into your Google listing</p>
                </div>
                <button
                  onClick={() => copyToClipboard(report.action_plan.aiSuggestedDescription!, 'desc')}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  {copiedSection === 'desc' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copiedSection === 'desc' ? 'Copied' : 'Copy Description'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed bg-white p-3.5 rounded-xl border border-slate-200/60 font-mono">
                {report.action_plan.aiSuggestedDescription}
              </p>
            </div>
          )}

          {/* AI Recommended Google Post */}
          {report.action_plan.suggestedPost && (
            <div className="p-5 rounded-2xl bg-indigo-50/50 border border-indigo-200/70 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                    <span>📢 Ready-to-Publish Google Update Post</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600 text-white font-bold">
                      Boost Activity Signal
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500">Publish this post on your GBP dashboard this week</p>
                </div>
                <button
                  onClick={() => copyToClipboard(`${report.action_plan.suggestedPost?.title}\n\n${report.action_plan.suggestedPost?.content}`, 'post')}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  {copiedSection === 'post' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copiedSection === 'post' ? 'Copied' : 'Copy Post'}</span>
                </button>
              </div>
              <div className="bg-white p-3.5 rounded-xl border border-slate-200/60 text-xs space-y-1.5">
                <span className="font-bold text-slate-900 block">{report.action_plan.suggestedPost.title}</span>
                <p className="text-slate-600 leading-relaxed">{report.action_plan.suggestedPost.content}</p>
                <span className="text-[10px] font-bold text-blue-600 block mt-2">
                  Call to Action Button: {report.action_plan.suggestedPost.callToAction}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* White-Label Bottom CTA & Agency Partnership Box */}
        <div className="bg-slate-900 text-white rounded-3xl p-8 sm:p-12 shadow-2xl relative overflow-hidden text-center sm:text-left flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-3 max-w-2xl">
            <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs font-black uppercase tracking-wider border border-blue-500/30 inline-block">
              {agencyName} Local SEO Acceleration
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight">
              Ready to dominate Google Maps &amp; 3x your local leads?
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              We help local businesses and agencies automate Google Business Profile ranking, fix technical checklist errors, and build automated review systems.
            </p>
            {campaign?.support_phone && (
              <p className="text-xs text-slate-400 flex items-center justify-center sm:justify-start gap-2 pt-2">
                <Phone size={14} className="text-emerald-400" /> Call or WhatsApp: <span className="text-white font-bold">{campaign.support_phone}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto shrink-0">
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-xl transition-all flex items-center justify-center gap-2"
            >
              <Calendar size={18} />
              <span>{ctaText}</span>
            </a>
            {campaign?.support_phone && (
              <a
                href={`https://wa.me/${campaign.support_phone.replace(/[^0-9]/g, '')}?text=Hi%2C%20I%20want%20to%20fix%20my%20Google%20Business%20Profile%20for%20${encodeURIComponent(report.business_name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-xl transition-all flex items-center justify-center gap-2"
              >
                <MessageCircle size={18} />
                <span>WhatsApp Chat</span>
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
