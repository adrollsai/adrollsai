'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, Loader2, Link as LinkIcon, AlertCircle, Building2, Facebook } from 'lucide-react'
import { useOrganization } from '@/components/OrganizationWrapper'
import { useRouter } from 'next/navigation'

type Property = {
    id: string
    title: string
    template_adset_id?: string
    template_campaign_id?: string
}

type FbEntity = {
    id: string
    name: string
}

export default function AdsMappingPage() {
  const supabase = createClient()
  const router = useRouter()
  const { userRole, org } = useOrganization()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Data State
  const [properties, setProperties] = useState<Property[]>([])
  const [fbCampaigns, setFbCampaigns] = useState<FbEntity[]>([])
  const [fbAdSets, setFbAdSets] = useState<FbEntity[]>([])
  
  // Selection State
  const [selectedPropId, setSelectedPropId] = useState('')
  const [selectedCampId, setSelectedCampId] = useState('')
  const [selectedAdSetId, setSelectedAdSetId] = useState('')

  useEffect(() => {
    if (userRole && userRole !== 'admin') {
        // Redirect if not Org Admin (Agents shouldn't be here)
        router.push('/dashboard/ads')
        return
    }
    loadData()
  }, [userRole, org])

  const loadData = async () => {
    if(!org?.id) return

    // 1. Fetch Properties for THIS Organization
    const { data: props } = await supabase
        .from('properties')
        .select('id, title, template_adset_id, template_campaign_id')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: false })
    
    if(props) setProperties(props)

    // 2. Fetch FB Campaigns (from API that uses Org Admin's token)
    try {
        const res = await fetch('/api/meta-ads/campaigns?admin=true') 
        const data = await res.json()
        if(data.campaigns) setFbCampaigns(data.campaigns)
    } catch(e) { console.error(e) }
    
    setLoading(false)
  }

  // Fetch AdSets when Campaign is selected
  const handleCampaignSelect = async (campId: string) => {
      setSelectedCampId(campId)
      setSelectedAdSetId('') // Reset AdSet
      
      // Fetch AdSets for this campaign
      try {
        // You need to ensure this API endpoint exists to fetch adsets
        const res = await fetch(`/api/meta-ads/adsets?campaignId=${campId}`)
        const data = await res.json()
        if(data.adsets) setFbAdSets(data.adsets)
      } catch (e) { console.error(e) }
  }

  // Populate selections when a property is chosen
  const handlePropertySelect = (propId: string) => {
      setSelectedPropId(propId)
      const prop = properties.find(p => p.id === propId)
      if(prop) {
          if(prop.template_campaign_id) handleCampaignSelect(prop.template_campaign_id)
          if(prop.template_adset_id) setSelectedAdSetId(prop.template_adset_id)
      } else {
          setSelectedCampId('')
          setSelectedAdSetId('')
      }
  }

  const handleSaveMapping = async () => {
      if(!selectedPropId || !selectedAdSetId) return alert("Please select a Property and a Template Ad Set")
      setSaving(true)
      
      const { error } = await supabase
        .from('properties')
        .update({
            template_campaign_id: selectedCampId,
            template_adset_id: selectedAdSetId
        })
        .eq('id', selectedPropId)

      setSaving(false)
      
      if(error) {
          alert("Failed to save mapping")
      } else {
          alert("✅ Project Linked Successfully! Agents can now run ads for this project.")
          // Update local state to show checkmark
          setProperties(prev => prev.map(p => p.id === selectedPropId ? {...p, template_adset_id: selectedAdSetId} : p))
      }
  }

  if (loading) return <div className="p-10 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <LinkIcon className="text-blue-600"/> Campaign Mapping
          </h1>
          <p className="text-slate-500 text-sm mt-1">
             Link your Real Estate Projects to Facebook Ad Templates.
          </p>
      </div>
      
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* 1. SELECT PROJECT */}
        <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                <Building2 size={14}/> 1. Select Project
            </label>
            <div className="relative">
                <select 
                    className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                    value={selectedPropId}
                    onChange={(e) => handlePropertySelect(e.target.value)}
                >
                    <option value="">-- Choose Project --</option>
                    {properties.map(p => (
                        <option key={p.id} value={p.id}>
                            {p.title} {p.template_adset_id ? '✓' : ''}
                        </option>
                    ))}
                </select>
            </div>
            <p className="text-[10px] text-slate-400">Select a property from your inventory.</p>
        </div>

        {/* 2. SELECT CAMPAIGN */}
        <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                <Facebook size={14}/> 2. Master Campaign
            </label>
            <select 
                className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={selectedCampId}
                onChange={(e) => handleCampaignSelect(e.target.value)}
            >
                <option value="">-- Select Facebook Campaign --</option>
                {fbCampaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
             <p className="text-[10px] text-slate-400">Select the campaign that contains your templates.</p>
        </div>

        {/* 3. SELECT TEMPLATE AD SET */}
        <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                <Save size={14}/> 3. Template Ad Set
            </label>
            <select 
                className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={selectedAdSetId}
                onChange={(e) => setSelectedAdSetId(e.target.value)}
                disabled={!selectedCampId}
            >
                <option value="">-- Choose Ad Set to Clone --</option>
                {fbAdSets.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </select>
            <p className="text-[10px] text-slate-400">Agents will copy this Ad Set's settings & creative.</p>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-end gap-4">
        {selectedPropId && selectedAdSetId && (
            <div className="text-xs text-green-600 font-bold bg-green-50 px-3 py-1 rounded-full animate-in fade-in">
                Ready to link!
            </div>
        )}
        <button 
            onClick={handleSaveMapping}
            disabled={saving || !selectedPropId || !selectedAdSetId}
            className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50 transition-all active:scale-95"
        >
            {saving ? <Loader2 className="animate-spin" /> : <LinkIcon size={18} />}
            Link Project to Template
        </button>
      </div>

      <div className="mt-6 bg-blue-50 text-blue-800 p-5 rounded-2xl text-sm flex items-start gap-3 border border-blue-100">
         <AlertCircle size={20} className="mt-0.5 shrink-0" />
         <div>
            <h4 className="font-bold mb-1">How Mapping Works</h4>
            <p className="leading-relaxed opacity-90">
               When an agent selects this project, the system will automatically <strong>Clone</strong> the 
               Ad Set you selected above. This includes the <strong>Images, Ad Copy, Targeting, and Lead Form</strong>. 
               The Agent only controls the Budget.
            </p>
         </div>
      </div>
    </div>
  )
}