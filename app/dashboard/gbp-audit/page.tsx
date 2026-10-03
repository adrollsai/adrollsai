'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import {
  Link2,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  Sparkles,
  Share2,
  MessageCircle,
  Building,
  User,
  Phone,
  Mail,
  Calendar,
  Save,
  Loader2,
  MapPin,
  TrendingDown,
  TrendingUp,
  BarChart3,
  Layers,
  ShieldCheck,
  Eye,
  RefreshCw,
  Search
} from 'lucide-react'
import { GBPAuditCampaign, GBPAuditReport } from '@/utils/gbp-audit-storage'
import { toast } from 'sonner'

export default function GBPAuditDashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [activeTab, setActiveTab] = useState<'generator' | 'leads' | 'settings'>('generator')

  const [campaign, setCampaign] = useState<GBPAuditCampaign>({
    id: '',
    slug: 'my-agency',
    agency_name: 'Nobogent Agency',
    logo_url: '',
    hero_title: 'Free Google Business Profile Audit & Local Rank Heatmap',
    hero_subtitle: 'Discover why competitors outrank you on Google Maps and unlock massive local customer growth.',
    cta_text: 'Book A Free Strategy Call',
    cta_url: '',
    support_phone: '',
    support_email: '',
    brand_color: '#2563EB',
    target_industry: 'General',
    enabled_modes: ['instant_search', 'google_oauth'],
  })

  const [reports, setReports] = useState<GBPAuditReport[]>([])
  const [searchFilter, setSearchFilter] = useState('')

  const fetchCampaignData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/gbp/campaigns')
      const data = await res.json()
      if (data.campaign) {
        setCampaign(data.campaign)
      }
      if (data.reports) {
        setReports(data.reports)
      }
    } catch (err) {
      console.warn('Failed to load campaigns:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function checkSuperAdmin() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, email')
        .eq('id', session.user.id)
        .single()

      const isSuperAdmin =
        profile?.role === 'super_admin' ||
        profile?.email === 'rchopra489@gmail.com' ||
        session.user.email === 'rchopra489@gmail.com'

      if (!isSuperAdmin) {
        router.push('/dashboard')
        return
      }

      setIsAuthorized(true)
      fetchCampaignData()
    }

    checkSuperAdmin()
  }, [router, supabase])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://nobogent.com'
  const liveAuditUrl = `${origin}/audit/${campaign.slug}`

  const handleCopyLink = () => {
    navigator.clipboard.writeText(liveAuditUrl)
    setCopiedLink(true)
    toast.success('Live audit link copied to clipboard!')
    setTimeout(() => setCopiedLink(false), 2500)
  }

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/gbp/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaign)
      })
      const data = await res.json()
      if (data.success) {
        toast.success('White-label campaign settings updated successfully!')
        if (data.campaign) setCampaign(data.campaign)
      } else {
        throw new Error(data.error || 'Failed to update campaign')
      }
    } catch (err: any) {
      toast.error(err.message || 'Error saving campaign')
    } finally {
      setSaving(false)
    }
  }

  const filteredReports = reports.filter(r =>
    r.business_name?.toLowerCase().includes(searchFilter.toLowerCase()) ||
    r.lead_name?.toLowerCase().includes(searchFilter.toLowerCase()) ||
    r.lead_email?.toLowerCase().includes(searchFilter.toLowerCase()) ||
    r.lead_phone?.includes(searchFilter)
  )

  const totalMonthlyLossPipeline = reports.reduce((acc, r) => acc + (r.estimated_monthly_loss || 0), 0)
  const avgAuditScore = reports.length > 0
    ? Math.round(reports.reduce((acc, r) => acc + (r.overall_score || 0), 0) / reports.length)
    : 0

  if (!isAuthorized || loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm font-bold text-slate-600">Loading Google Business Profile Hub...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-32">
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wider mb-2 border border-blue-100">
            <Layers size={13} /> Agency &amp; Admin Suite
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Google Business Profile Audit Generator
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Generate your own white-labeled Google Business Profile audit link. Prospects can connect their Google account or perform a live scan, generating a 49-point geo-grid rank heatmap &amp; lost revenue report.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <a
            href={liveAuditUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black shadow-md flex items-center gap-2 transition-colors"
          >
            <span>Preview Audit Page</span>
            <ExternalLink size={14} />
          </a>
          <button
            onClick={handleCopyLink}
            className="px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-md shadow-blue-500/20 flex items-center gap-2 transition-colors"
          >
            {copiedLink ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedLink ? 'Copied!' : 'Copy Audit Link'}</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase">Total Audits Ran</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <BarChart3 size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{reports.length}</p>
          <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-1">
            <TrendingUp size={12} /> Active conversion funnel
          </span>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase">Average Audit Score</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <ShieldCheck size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{avgAuditScore}/100</p>
          <span className="text-[11px] font-semibold text-slate-500 mt-1">
            Avg Prospect SEO Health
          </span>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase">Pipeline Opportunity</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <TrendingUp size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-600 mt-2">
            ₹{totalMonthlyLossPipeline.toLocaleString()}
          </p>
          <span className="text-[11px] font-semibold text-slate-500 mt-1">
            Monthly Lost Revenue Detected
          </span>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase">Client Leads Captured</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <User size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">
            {reports.filter(r => r.lead_email || r.lead_phone).length}
          </p>
          <span className="text-[11px] font-semibold text-blue-600 mt-1">
            Synced with Nobogent CRM
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveTab('generator')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'generator'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Shareable Link &amp; Generator
        </button>
        <button
          onClick={() => setActiveTab('leads')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'leads'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>Audited Leads &amp; Reports</span>
          <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-800 text-[10px] font-black">
            {reports.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'settings'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          White-Label Customization
        </button>
      </div>

      {/* TAB 1: Link Generator & Sharing Hub */}
      {activeTab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Your Live White-Label Auditing URL
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Share this link on your website, WhatsApp, social media, or directly during sales discovery calls.
              </p>
            </div>

            {/* Link Box */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="flex-1 px-4 py-2 font-mono text-xs text-slate-700 select-all overflow-x-auto">
                {liveAuditUrl}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyLink}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                >
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                </button>
                <a
                  href={liveAuditUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ExternalLink size={14} />
                  <span>Open</span>
                </a>
              </div>
            </div>

            {/* Quick Share Buttons */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-500">Quick Share:</span>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Check out your free Google Business Profile & Local Rank Heatmap audit in 60 seconds: ${liveAuditUrl}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <MessageCircle size={14} /> WhatsApp
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent('Your Free Google Business Profile Audit')}&body=${encodeURIComponent(`Hi,\n\nHere is your free Google Business Profile & Local Ranking Audit tool:\n${liveAuditUrl}\n\nIt analyzes your rank across 49 coordinate checkpoints on Google Maps.`)}`}
                className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <Mail size={14} /> Email
              </a>
            </div>

            {/* How It Works Flow Cards */}
            <div className="border-t border-slate-100 pt-6 space-y-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                How Your Clients Experience The Audit Funnel
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-black text-xs flex items-center justify-center mb-2">
                    1
                  </span>
                  <h4 className="text-xs font-bold text-slate-900">Prospect Lands on URL</h4>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    They see your white-label branding, agency logo, and value proposition.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-center mb-2">
                    2
                  </span>
                  <h4 className="text-xs font-bold text-slate-900">Connects or Searches</h4>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    They connect their Google account or search their business name on Google Maps.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-black text-xs flex items-center justify-center mb-2">
                    3
                  </span>
                  <h4 className="text-xs font-bold text-slate-900">Generates Report &amp; Converts</h4>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    The report shows their 49-point geo-grid rank, lost revenue, and your calendar CTA.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Card: Instant QR & Test Drive */}
          <div className="lg:col-span-4 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <QrCode size={20} className="text-blue-600" />
                <h3 className="text-base font-black text-slate-900">In-Person &amp; Event QR Code</h3>
              </div>
              <p className="text-xs text-slate-500">
                Display this QR code at networking events, on business cards, or during presentations for instant client audits.
              </p>

              <div className="my-6 p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(liveAuditUrl)}`}
                  alt="Audit Link QR Code"
                  className="w-40 h-40 rounded-xl bg-white p-2 border border-slate-200 shadow-sm"
                />
                <span className="text-[11px] font-mono text-slate-500 mt-3 truncate max-w-[200px]">
                  /audit/{campaign.slug}
                </span>
              </div>
            </div>

            <a
              href={liveAuditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <span>Test Live Onboarding Flow</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      )}

      {/* TAB 2: Audited Leads & Reports Table */}
      {activeTab === 'leads' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Audited Businesses &amp; Inbound Leads
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Every business that has completed an audit through your white-label URL
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter by business or lead..."
                  className="pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                onClick={fetchCampaignData}
                className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          {filteredReports.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-3">
              <Building size={36} className="mx-auto text-slate-400" />
              <h3 className="text-sm font-bold text-slate-700">No Audits Completed Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Share your white-label link with prospects or run a test audit to see them populate here in real-time.
              </p>
              <div className="pt-2">
                <a
                  href={liveAuditUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold text-xs inline-flex items-center gap-1.5"
                >
                  <span>Run First Test Audit</span>
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider">
                    <th className="pb-3 px-3">Business</th>
                    <th className="pb-3 px-3">Lead Contact</th>
                    <th className="pb-3 px-3">SEO Score</th>
                    <th className="pb-3 px-3">Est. Lost Revenue</th>
                    <th className="pb-3 px-3">Date</th>
                    <th className="pb-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReports.map((report) => (
                    <tr key={report.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-4 px-3">
                        <div className="font-black text-slate-900">{report.business_name}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[200px] mt-0.5">
                          {report.address}
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        <div className="font-bold text-slate-800">{report.lead_name || 'Anonymous'}</div>
                        <div className="text-[11px] text-slate-500">{report.lead_email || report.lead_phone || '—'}</div>
                      </td>
                      <td className="py-4 px-3">
                        <span className={`px-2.5 py-1 rounded-full font-black text-[10px] ${
                          report.overall_score >= 80 ? 'bg-emerald-100 text-emerald-800' :
                          report.overall_score >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {report.overall_score}/100 • {report.score_grade}
                        </span>
                      </td>
                      <td className="py-4 px-3 font-bold text-slate-900">
                        {report.currency === 'USD' ? '$' : '₹'}
                        {report.estimated_monthly_loss?.toLocaleString()}/mo
                      </td>
                      <td className="py-4 px-3 text-slate-500 text-[11px]">
                        {new Date(report.created_at || Date.now()).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric'
                        })}
                      </td>
                      <td className="py-4 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {report.lead_phone && (
                            <a
                              href={`https://wa.me/${report.lead_phone.replace(/[^0-9]/g, '')}?text=Hi%20${encodeURIComponent(report.lead_name || '')}%2C%20I%20reviewed%20your%20Google%20Business%20Profile%20Audit%20for%20${encodeURIComponent(report.business_name)}%20(Score%3A%20${report.overall_score}%2F100).%20Let%27s%20discuss%20how%20to%20get%20you%20into%20the%20top%203%20spots!`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                              title="WhatsApp Lead"
                            >
                              <MessageCircle size={14} />
                            </a>
                          )}
                          <a
                            href={`/audit/report/${report.share_token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-xs inline-flex items-center gap-1 transition-colors"
                          >
                            <Eye size={13} />
                            <span>View</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: White-Label Customization Settings */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveCampaign} className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-8">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              White-Label Customization Settings
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Customize the branding, colors, links, and contact options your clients see on their audit onboarding and report pages.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Agency / Brand Name</label>
              <input
                type="text"
                required
                value={campaign.agency_name}
                onChange={(e) => setCampaign({ ...campaign, agency_name: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Custom URL Slug</label>
              <div className="flex items-center">
                <span className="px-3 py-2.5 bg-slate-100 border border-r-0 border-slate-200 rounded-l-xl text-xs text-slate-500 font-mono">
                  /audit/
                </span>
                <input
                  type="text"
                  required
                  value={campaign.slug}
                  onChange={(e) => setCampaign({ ...campaign, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  className="w-full px-4 py-2.5 rounded-r-xl border border-slate-200 text-xs font-mono font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Logo URL (Optional)</label>
              <input
                type="url"
                value={campaign.logo_url || ''}
                onChange={(e) => setCampaign({ ...campaign, logo_url: e.target.value })}
                placeholder="https://..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Brand Accent Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={campaign.brand_color || '#2563EB'}
                  onChange={(e) => setCampaign({ ...campaign, brand_color: e.target.value })}
                  className="w-10 h-10 rounded-xl cursor-pointer border border-slate-200 p-0.5"
                />
                <input
                  type="text"
                  value={campaign.brand_color || '#2563EB'}
                  onChange={(e) => setCampaign({ ...campaign, brand_color: e.target.value })}
                  className="w-32 px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono"
                />
              </div>
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Hero Title</label>
              <input
                type="text"
                value={campaign.hero_title || ''}
                onChange={(e) => setCampaign({ ...campaign, hero_title: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Hero Subtitle</label>
              <textarea
                rows={2}
                value={campaign.hero_subtitle || ''}
                onChange={(e) => setCampaign({ ...campaign, hero_subtitle: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Call to Action Button Text</label>
              <input
                type="text"
                value={campaign.cta_text || ''}
                onChange={(e) => setCampaign({ ...campaign, cta_text: e.target.value })}
                placeholder="e.g. Schedule A Free Strategy Call"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">CTA Destination URL (Calendly, WhatsApp, Cal.com)</label>
              <input
                type="text"
                value={campaign.cta_url || ''}
                onChange={(e) => setCampaign({ ...campaign, cta_url: e.target.value })}
                placeholder="https://calendly.com/... or https://wa.me/..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Support Phone / WhatsApp</label>
              <input
                type="tel"
                value={campaign.support_phone || ''}
                onChange={(e) => setCampaign({ ...campaign, support_phone: e.target.value })}
                placeholder="+91 98765 43210"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Support Email</label>
              <input
                type="email"
                value={campaign.support_email || ''}
                onChange={(e) => setCampaign({ ...campaign, support_email: e.target.value })}
                placeholder="contact@myagency.com"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="pt-4 flex items-center justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              <span>{saving ? 'Saving...' : 'Save Campaign Settings'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
