'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import {
  Users,
  Upload,
  Globe,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  FileText,
  Target,
  ArrowLeft,
  Calendar,
  AlertCircle,
  HelpCircle
} from 'lucide-react'

type MetaAudience = {
  id: string
  name: string
  subtype: string
  description?: string
  time_created: number
  approximate_count_lower_bound?: number
  approximate_count_upper_bound?: number
}

export default function CustomAudiencesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  // State
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [profileConnected, setProfileConnected] = useState(false)
  const [adAccountId, setAdAccountId] = useState<string | null>(null)
  const [audiences, setAudiences] = useState<MetaAudience[]>([])

  // Form State
  const [creationTab, setCreationTab] = useState<'list' | 'website' | 'crm'>('list')
  const [audName, setAudName] = useState('')
  const [audDescription, setAudDescription] = useState('')
  // List fields
  const [contactText, setContactText] = useState('')
  const [listFile, setListFile] = useState<File | null>(null)
  // CRM fields
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([])
  const [crmCampaignsList, setCrmCampaignsList] = useState<string[]>([])
  // Website fields
  const [retentionDays, setRetentionDays] = useState(30)
  const [urlContains, setUrlContains] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchProfileAndAudiences = async (force = false) => {
    try {
      if (!force) setLoading(true)
      else setIsRefreshing(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/')
        return
      }

      // Resolve Target Profile Role & Credentials
      const { data: authProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
      let targetUserId = user.id

      if (['admin', 'agent'].includes(authProfile?.role || '') && (authProfile?.agency_id || authProfile?.parent_id)) {
        targetUserId = (authProfile?.agency_id || authProfile?.parent_id) as string
      }

      if (impersonateId && ['super_admin', 'agency', 'admin', 'agent'].includes(authProfile?.role || '')) {
        if (authProfile?.role !== 'super_admin') {
          const isParent = (authProfile?.agency_id === impersonateId || authProfile?.parent_id === impersonateId)
          const { data: subAccount } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', impersonateId)
            .eq('agency_id', authProfile?.agency_id || user.id)
            .single()
          if (isParent || subAccount) targetUserId = impersonateId
        } else {
          targetUserId = impersonateId
        }
      }

      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('facebook_token, ad_account_id')
        .eq('id', targetUserId)
        .single()

      if (targetProfile?.facebook_token && targetProfile?.ad_account_id) {
        setProfileConnected(true)
        setAdAccountId(targetProfile.ad_account_id)
        
        // Fetch audiences
        const impParam = impersonateId ? `&impersonate=${impersonateId}` : ''
        const res = await fetch(`/api/meta-ads/custom-audiences?${impParam}`)
        const data = await res.json()

        if (data.audiences) {
          setAudiences(data.audiences)
        } else if (data.error) {
          toast.error(`Meta API Error: ${data.error}`)
        }

        // Fetch unique campaigns for CRM filters
        const { data: leadsData } = await supabase
          .from('leads')
          .select('campaign_id, source')
          .eq('user_id', targetUserId)
        
        if (leadsData) {
          const campaignSet = new Set<string>()
          leadsData.forEach((l: any) => {
            if (l.campaign_id) campaignSet.add(l.campaign_id)
            if (l.source) campaignSet.add(l.source)
          })
          setCrmCampaignsList(Array.from(campaignSet).filter(Boolean))
        }
      } else {
        setProfileConnected(false)
      }
    } catch (e: any) {
      console.error(e)
      toast.error('Failed to load credentials and audiences')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    fetchProfileAndAudiences()
  }, [])

  // File parsing & Hashing Helper on Frontend
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setListFile(e.target.files[0])
    }
  }

  const handleCreateAudience = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!audName.trim()) {
      toast.error('Audience name is required')
      return
    }

    setIsSubmitting(true)
    try {
      let contactsPayload: { email?: string; phone?: string }[] = []

      if (creationTab === 'list') {
        // Parse copy-pasted text
        if (contactText.trim()) {
          const lines = contactText.split(/[\n,;]+/)
          lines.forEach(line => {
            const clean = line.trim()
            if (!clean) return
            if (clean.includes('@')) {
              contactsPayload.push({ email: clean })
            } else {
              // assume phone number
              contactsPayload.push({ phone: clean })
            }
          })
        }

        // Parse file upload
        if (listFile) {
          const text = await listFile.text()
          const rows = text.split(/[\r\n,;]+/)
          rows.forEach(row => {
            const clean = row.trim()
            if (!clean) return
            if (clean.includes('@')) {
              contactsPayload.push({ email: clean })
            } else {
              contactsPayload.push({ phone: clean })
            }
          })
        }

        if (contactsPayload.length === 0) {
          toast.error('Please upload a file or paste at least one contact (email or phone number)')
          setIsSubmitting(false)
          return
        }
      } else if (creationTab === 'crm') {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setIsSubmitting(false)
          return
        }
        
        let targetUserId = user.id
        const { data: authProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
        if (['admin', 'agent'].includes(authProfile?.role || '') && (authProfile?.agency_id || authProfile?.parent_id)) {
          targetUserId = (authProfile?.agency_id || authProfile?.parent_id) as string
        }
        if (impersonateId && ['super_admin', 'agency', 'admin', 'agent'].includes(authProfile?.role || '')) {
          if (authProfile?.role !== 'super_admin') {
            const isParent = (authProfile?.agency_id === impersonateId || authProfile?.parent_id === impersonateId)
            const { data: subAccount } = await supabase
              .from('profiles')
              .select('id')
              .eq('id', impersonateId)
              .eq('agency_id', authProfile?.agency_id || user.id)
              .single()
            if (isParent || subAccount) targetUserId = impersonateId
          } else {
            targetUserId = impersonateId
          }
        }

        let query = supabase
          .from('leads')
          .select('email, phone, name, campaign_id, source')
          .eq('user_id', targetUserId)

        if (selectedStages.length > 0) {
          query = query.in('pipeline_stage', selectedStages)
        }

        const { data: filteredLeads, error: leadsFetchErr } = await query
        if (leadsFetchErr) {
          toast.error(`Failed to fetch leads: ${leadsFetchErr.message}`)
          setIsSubmitting(false)
          return
        }

        if (!filteredLeads || filteredLeads.length === 0) {
          toast.error('No leads found matching the selected CRM filters.')
          setIsSubmitting(false)
          return
        }

        // Apply campaign filter on results (since campaign could match campaign_id or source)
        let matchedLeads = filteredLeads
        if (selectedCampaigns.length > 0) {
          matchedLeads = filteredLeads.filter((l: any) => 
            (l.campaign_id && selectedCampaigns.includes(l.campaign_id)) || 
            (l.source && selectedCampaigns.includes(l.source))
          )
        }

        if (matchedLeads.length === 0) {
          toast.error('No leads matched the selected Campaign filters.')
          setIsSubmitting(false)
          return
        }

        contactsPayload = matchedLeads.map((l: any) => ({
          email: l.email || undefined,
          phone: l.phone || undefined
        })).filter((c: any) => c.email || c.phone)

        if (contactsPayload.length === 0) {
          toast.error('No leads have email or phone numbers configured.')
          setIsSubmitting(false)
          return
        }
      }

      const payload = {
        name: audName,
        description: audDescription,
        subtype: creationTab === 'website' ? 'WEBSITE' : 'CUSTOM',
        retention_seconds: creationTab === 'website' ? retentionDays * 86400 : undefined,
        url_contains: creationTab === 'website' && urlContains ? urlContains : undefined,
        contacts: creationTab !== 'website' ? contactsPayload : undefined
      }

      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/meta-ads/custom-audiences${impParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(`Custom Audience "${audName}" created successfully! ✨`, {
          description: data.num_received ? `Uploaded ${data.num_received} contacts.` : undefined
        })
        // Reset form
        setAudName('')
        setAudDescription('')
        setContactText('')
        setListFile(null)
        setUrlContains('')
        setRetentionDays(30)
        setSelectedStages([])
        setSelectedCampaigns([])
        if (fileInputRef.current) fileInputRef.current.value = ''
        
        fetchProfileAndAudiences(true)
      } else {
        toast.error(data.error || 'Failed to create custom audience')
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-slate-300" size={32} />
        <p className="text-sm font-medium animate-pulse">Syncing Custom Audiences...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">
      <button
        onClick={() => fetchProfileAndAudiences(true)}
        className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
        title="Refresh audiences list"
      >
        <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Back Button & Title */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
            className="bg-white hover:bg-slate-50 border border-slate-200 p-2.5 rounded-full shadow-sm text-slate-500 transition-all hover:text-blue-600 active:scale-95"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Meta Custom Audiences</h1>
            <p className="text-slate-500 text-sm font-medium mt-0.5">Define who sees your remarketing ads on Facebook and Instagram</p>
          </div>
        </div>

        {!profileConnected ? (
          <div className="bg-white border border-rose-150 rounded-[2rem] p-10 shadow-sm text-center max-w-xl mx-auto my-12 space-y-6">
            <div className="bg-rose-50 text-rose-500 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Meta Integrations Not Connected</h3>
              <p className="text-slate-500 text-sm leading-relaxed mt-2">
                Custom Audiences require a fully connected Meta Ad Account. Please link your Facebook profile, Page, and Ad Account in the Workspace settings first.
              </p>
            </div>
            <button
              onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3.5 px-6 rounded-full shadow-sm transition-all"
            >
              Go to Profile Connection Settings
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Create New Audience Forms */}
            <div className="lg:col-span-5 bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-200/60 space-y-6">
              <div className="border-b border-slate-100 pb-4 flex items-center gap-3">
                <div className="bg-blue-100 text-blue-600 p-2 rounded-full">
                  <Plus size={18} />
                </div>
                <h3 className="font-bold text-lg text-slate-900">Create New Audience</h3>
              </div>

              {/* Subtype tabs */}
              <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
                <button
                  type="button"
                  onClick={() => { setCreationTab('list'); setAudName(''); }}
                  className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1 ${creationTab === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Upload size={12} /> List File
                </button>
                <button
                  type="button"
                  onClick={() => { setCreationTab('crm'); setAudName(''); }}
                  className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1 ${creationTab === 'crm' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Users size={12} /> CRM Leads
                </button>
                <button
                  type="button"
                  onClick={() => { setCreationTab('website'); setAudName(''); }}
                  className={`flex-1 py-2 px-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1 ${creationTab === 'website' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Globe size={12} /> Website
                </button>
              </div>

              <form onSubmit={handleCreateAudience} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Audience Name</label>
                  <input
                    type="text"
                    required
                    placeholder={creationTab === 'list' ? 'E.g., VIP CRM Clients' : creationTab === 'crm' ? 'E.g., Qualified Leads' : 'E.g., All Website Visitors 30d'}
                    value={audName}
                    onChange={(e) => setAudName(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 py-3 px-4 rounded-2xl text-slate-800 text-sm font-semibold outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Description (Optional)</label>
                  <input
                    type="text"
                    placeholder="Describe the purpose of this audience"
                    value={audDescription}
                    onChange={(e) => setAudDescription(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 py-3 px-4 rounded-2xl text-slate-800 text-sm font-semibold outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                  />
                </div>

                {creationTab === 'list' && (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-1.5 ml-2 mb-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Upload CSV / TXT File</label>
                        <div className="group relative cursor-pointer">
                          <HelpCircle size={12} className="text-slate-400 hover:text-slate-600 transition-colors" />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 bg-slate-800 text-white text-[10px] rounded-xl shadow-md opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 leading-relaxed">
                            <strong>Format guidelines:</strong><br />
                            One email address or phone number per line.<br />
                            Commas, semicolons, and newlines will be used as delimiters. No headers required.
                          </div>
                        </div>
                      </div>
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-200 rounded-2xl p-6 bg-slate-50 hover:bg-blue-50/30 hover:border-blue-300 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
                      >
                        <Upload size={24} className="text-slate-400" />
                        <span className="text-xs font-bold text-slate-600">
                          {listFile ? listFile.name : 'Select contacts list file'}
                        </span>
                        <span className="text-[10px] text-slate-400">CSV or TXT containing one email/phone per line</span>
                      </div>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        accept=".csv,.txt"
                        className="hidden"
                      />
                    </div>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center" aria-hidden="true">
                        <div className="w-full border-t border-slate-100" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase font-black tracking-widest text-slate-350">
                        <span className="bg-white px-3">Or Paste Directly</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Paste Emails or Phones</label>
                      <textarea
                        rows={5}
                        placeholder="john@example.com&#10;+919876543210&#10;alice@domain.com"
                        value={contactText}
                        onChange={(e) => setContactText(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-slate-800 text-xs font-mono outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all resize-none"
                      />
                    </div>
                  </div>
                )}

                {creationTab === 'crm' && (
                  <div className="space-y-4 bg-blue-50/30 p-4 rounded-2xl border border-blue-100/50">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">CRM Lead Stage(s)</label>
                      <div className="flex flex-wrap gap-2">
                        {['New', 'Contacted', 'Qualified', 'Appointment Booked', 'Appointment Done', 'Closed', 'Lost'].map(stage => {
                          const isSelected = selectedStages.includes(stage)
                          return (
                            <button
                              key={stage}
                              type="button"
                              onClick={() => {
                                setSelectedStages(prev => 
                                  isSelected ? prev.filter(s => s !== stage) : [...prev, stage]
                                )
                              }}
                              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                                isSelected 
                                  ? 'bg-blue-600 border-blue-600 text-white shadow-sm' 
                                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm'
                              }`}
                            >
                              {stage}
                            </button>
                          )
                        })}
                      </div>
                      {selectedStages.length === 0 && (
                        <p className="text-[9px] text-slate-400 mt-1.5 ml-2 font-medium">None selected: All stages will be included.</p>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Source Campaign(s) / Channel(s)</label>
                      <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-2 border border-slate-200/60 rounded-2xl bg-white shadow-inner">
                        {crmCampaignsList.length === 0 ? (
                          <span className="text-xs text-slate-400 p-2 italic">No campaigns found in CRM</span>
                        ) : (
                          crmCampaignsList.map(campaign => {
                            const isSelected = selectedCampaigns.includes(campaign)
                            return (
                              <button
                                key={campaign}
                                type="button"
                                onClick={() => {
                                  setSelectedCampaigns(prev => 
                                    isSelected ? prev.filter(c => c !== campaign) : [...prev, campaign]
                                  )
                                }}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                                  isSelected 
                                    ? 'bg-blue-600 border-blue-600 text-white shadow-sm' 
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm'
                                }`}
                              >
                                {campaign}
                              </button>
                            )
                          })
                        )}
                      </div>
                      {selectedCampaigns.length === 0 && (
                        <p className="text-[9px] text-slate-400 mt-1.5 ml-2 font-medium">None selected: All campaigns will be included.</p>
                      )}
                    </div>
                  </div>
                )}

                {creationTab === 'website' && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Retention (Days)</label>
                      <select
                        value={retentionDays}
                        onChange={(e) => setRetentionDays(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-2xl text-sm font-semibold outline-none cursor-pointer text-slate-800 focus:ring-4 focus:ring-blue-500/20 transition-all"
                      >
                        <option value={30}>30 Days</option>
                        <option value={60}>60 Days</option>
                        <option value={90}>90 Days</option>
                        <option value={180}>180 Days (Max)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">URL contains (Optional)</label>
                      <input
                        type="text"
                        placeholder="E.g., product-details"
                        value={urlContains}
                        onChange={(e) => setUrlContains(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-100/50 py-3 px-4 rounded-2xl text-slate-800 text-sm font-semibold outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-2xl shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin text-white" size={16} /> Creating on Meta...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} /> Create Custom Audience
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* List of Custom Audiences */}
            <div className="lg:col-span-7 bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-100 text-purple-600 p-2 rounded-full">
                    <Users size={18} />
                  </div>
                  <h3 className="font-bold text-lg text-slate-900">Ad Account Audiences</h3>
                </div>
                <span className="text-xs bg-slate-100 text-slate-500 font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                  Ad Account ID: {adAccountId}
                </span>
              </div>

              {audiences.length === 0 ? (
                <div className="text-center py-20 text-slate-400 flex flex-col items-center justify-center gap-4">
                  <Users size={48} className="text-slate-200" />
                  <div>
                    <p className="text-base font-bold text-slate-600">No Custom Audiences Found</p>
                    <p className="text-sm mt-1">Create one using the form on the left to start targeting customized cohorts.</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <th className="p-4 pl-6">Audience Name</th>
                        <th className="p-4">Subtype</th>
                        <th className="p-4">Description</th>
                        <th className="p-4">Est. Size</th>
                        <th className="p-4 pr-6">Created Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                      {audiences.map((aud) => (
                        <tr key={aud.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-4 pl-6 font-bold text-slate-800">
                            <div className="flex flex-col">
                              <span>{aud.name}</span>
                              <span className="text-[10px] text-slate-400 font-mono font-medium mt-0.5">ID: {aud.id}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] uppercase font-bold ${
                              aud.subtype === 'CUSTOM' ? 'bg-blue-50 text-blue-600' :
                              aud.subtype === 'WEBSITE' ? 'bg-emerald-50 text-emerald-600' :
                              'bg-purple-50 text-purple-600'
                            }`}>
                              {aud.subtype}
                            </span>
                          </td>
                          <td className="p-4 text-slate-500 font-medium max-w-[150px] truncate" title={aud.description}>
                            {aud.description || '-'}
                          </td>
                          <td className="p-4 text-slate-900 font-bold">
                            {aud.approximate_count_lower_bound !== undefined && aud.approximate_count_upper_bound !== undefined ? (
                              aud.approximate_count_lower_bound === -1 ? (
                                <span className="text-slate-400 font-medium italic">Populating...</span>
                              ) : (
                                `${aud.approximate_count_lower_bound.toLocaleString()} - ${aud.approximate_count_upper_bound.toLocaleString()}`
                              )
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="p-4 pr-6 text-slate-500 font-medium">
                            <span className="flex items-center gap-1.5">
                              <Calendar size={12} className="text-slate-400" />
                              {new Date(aud.time_created * 1000).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric'
                              })}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
