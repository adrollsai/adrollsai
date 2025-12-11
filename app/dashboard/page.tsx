'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, MapPin, X, Loader2, Image as ImageIcon, Filter, FileText, Upload, Sparkles, LayoutGrid, Zap, BarChart3, Share2, Download, Building, Trash2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { uploadToR2 } from '@/utils/upload-helper'

// --- Types ---
type Configuration = { name: string; size: string; price: string }

type Property = {
  id: string
  title: string
  address: string
  rera_number?: string
  description?: string
  image_url: string
  images: string[]
  brochure_url?: string
  floor_plan_url?: string
  configurations?: Configuration[]
  created_at: string
}

type MasterCreative = {
  id: string
  url: string
  type: 'image' | 'video'
  caption_template: string
  created_at: string
  property?: Property // Joined
}

type AssetStat = {
    agent_name: string
    status: string
    share_stats: { whatsapp: number, facebook: number, instagram: number, download: number }
}

type Profile = {
    id: string
    role: 'admin' | 'agent'
    organization_id: string
    business_name: string
    contact_number: string
    logo_url: string
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  
  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'feed' | 'inventory' | 'analytics'>('feed')
  
  const [userProfile, setUserProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Data
  const [properties, setProperties] = useState<Property[]>([])
  const [creatives, setCreatives] = useState<MasterCreative[]>([])
  const [analytics, setAnalytics] = useState<AssetStat[]>([])
  
  // Modals
  const [showAddProject, setShowAddProject] = useState(false)
  const [showAddCreative, setShowAddCreative] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  
  // Forms
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // -- Add Project Form --
  const [newProject, setNewProject] = useState({
      title: '', address: '', rera: '', description: '',
      configs: [] as Configuration[]
  })
  const [tempConfig, setTempConfig] = useState({ name: '', size: '', price: '' })
  const [projectFiles, setProjectFiles] = useState<{images: File[], brochure?: File, floorPlan?: File}>({ images: [] })
  
  // -- Add Creative Form --
  const [newCreative, setNewCreative] = useState({
      property_id: '',
      caption: "Check out this new update! {{Name}} {{Phone}}"
  })
  const [creativeFile, setCreativeFile] = useState<File | null>(null)

  // 1. FETCH DATA
  const fetchData = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // Get Profile
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (profile) setUserProfile(profile as Profile)

      // Get Properties
      const { data: props } = await supabase.from('properties').select('*').order('created_at', { ascending: false })
      if (props) setProperties(props)

      // Get Creatives Feed
      const { data: feed } = await supabase
        .from('master_creatives')
        .select(`*, property:properties(title)`)
        .order('created_at', { ascending: false })
      if (feed) setCreatives(feed)

      // Get Analytics (Admin Only)
      if (profile?.role === 'admin') {
          const { data: stats } = await supabase
            .from('assets')
            .select(`status, share_stats, user:profiles(business_name)`)
            .not('share_stats', 'is', null)
          
          if (stats) {
             const formatted = stats.map((s: any) => ({
                 agent_name: s.user?.business_name || 'Unknown',
                 status: s.status,
                 share_stats: s.share_stats
             }))
             setAnalytics(formatted)
          }
      }

    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // --- HANDLERS ---

  // 1. Add Project
  const handleAddProject = async () => {
      if (!newProject.title || !newProject.rera || projectFiles.images.length === 0) {
          alert("Title, RERA, and at least 1 image are required.")
          return
      }
      setIsSubmitting(true)
      try {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error("No user")

          // Upload Images to R2
          const imageUrls = []
          for (const file of projectFiles.images) {
             const publicUrl = await uploadToR2(file, 'properties')
             imageUrls.push(publicUrl)
          }

          // Insert
          await supabase.from('properties').insert({
              user_id: user.id,
              organization_id: userProfile?.organization_id,
              title: newProject.title,
              address: newProject.address,
              rera_number: newProject.rera,
              description: newProject.description,
              image_url: imageUrls[0],
              images: imageUrls,
              configurations: newProject.configs
          })
          
          await fetchData()
          setShowAddProject(false)
      } catch (e: any) {
          alert(e.message)
      } finally { setIsSubmitting(false) }
  }

  // 2. Add Creative to Feed
  const handleAddCreative = async () => {
      if (!newCreative.property_id || !creativeFile) {
          alert("Select a project and upload a file.")
          return
      }
      setIsSubmitting(true)
      try {
          // Upload to R2
          const publicUrl = await uploadToR2(creativeFile, 'feed')
          
          await supabase.from('master_creatives').insert({
              property_id: newCreative.property_id,
              url: publicUrl,
              type: creativeFile.type.startsWith('video') ? 'video' : 'image',
              caption_template: newCreative.caption
          })

          await fetchData()
          setShowAddCreative(false)
      } catch (e: any) {
          alert(e.message)
      } finally { setIsSubmitting(false) }
  }

  // 3. Agent: Claim Creative
  const handleClaim = async (creative: MasterCreative) => {
      if (!userProfile?.contact_number) {
          alert("Please complete your profile first.")
          return
      }
      setIsSubmitting(true)
      try {
          const res = await fetch('/api/creative/stamp', {
              method: 'POST',
              body: JSON.stringify({
                  masterImageUrl: creative.url,
                  agentProfile: userProfile,
                  propertyId: creative.property?.id,
                  masterCreativeId: creative.id
              })
          })
          if(res.ok) {
              alert("Creative Claimed! Check your Assets tab.")
          }
      } catch (e) {
          console.error(e)
      } finally { setIsSubmitting(false) }
  }

  // 4. Delete Project (FIXED: Manual Cascade Delete)
  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Are you sure? This will delete all associated creatives.")) return

    // Optimistic UI Update
    setProperties(prev => prev.filter(p => p.id !== id))

    try {
        // 1. Delete dependent Master Creatives first
        await supabase.from('master_creatives').delete().eq('property_id', id)
        
        // 2. Delete dependent Assets
        await supabase.from('assets').delete().eq('property_id', id)

        // 3. Finally Delete Property
        const { error } = await supabase.from('properties').delete().eq('id', id)

        if (error) {
            console.error("Delete Error:", error)
            alert("Failed to delete from database. Refreshing...")
            fetchData() // Revert UI
        }
    } catch (err: any) {
        alert("Error: " + err.message)
        fetchData()
    }
  }

  // --- UI COMPONENTS ---

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="min-h-screen bg-slate-50 pb-24 max-w-md mx-auto relative shadow-2xl">
      
      {/* Header */}
      <div className="bg-white p-5 pt-8 rounded-b-[2rem] shadow-sm z-10 sticky top-0">
          <div className="flex justify-between items-center mb-4">
            <div>
                <h1 className="text-xl font-black text-slate-900 tracking-tight">{userProfile?.role === 'admin' ? 'Builder Console' : 'Agent Hub'}</h1>
                <p className="text-xs font-medium text-slate-400">{userProfile?.organization_id ? 'Prime Estates' : 'Welcome'}</p>
            </div>
          </div>

          {/* TABS */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setActiveTab('feed')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'feed' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                  <Zap size={14}/> Feed
              </button>
              <button onClick={() => setActiveTab('inventory')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'inventory' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                  <Building size={14}/> Projects
              </button>
              {userProfile?.role === 'admin' && (
                  <button onClick={() => setActiveTab('analytics')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'analytics' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                      <BarChart3 size={14}/> Stats
                  </button>
              )}
          </div>
      </div>

      <div className="p-5 space-y-4">
          
          {/* --- TAB: CREATIVE FEED --- */}
          {activeTab === 'feed' && (
              <>
                 <div className="flex justify-between items-center">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Latest Updates</h2>
                    {userProfile?.role === 'admin' && (
                        <button onClick={() => setShowAddCreative(true)} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full shadow-lg active:scale-95 transition-transform">
                            <Plus size={12}/> New Post
                        </button>
                    )}
                 </div>

                 {creatives.map(c => (
                     <div key={c.id} className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100">
                         <div className="flex items-center gap-2 mb-3">
                             <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-500">
                                 P
                             </div>
                             <div>
                                 <p className="text-xs font-bold text-slate-900">{c.property?.title || 'General Update'}</p>
                                 <p className="text-[10px] text-slate-400">{new Date(c.created_at).toLocaleDateString()}</p>
                             </div>
                         </div>
                         <div className="rounded-xl overflow-hidden bg-slate-50 aspect-square mb-3 relative">
                             {c.type === 'video' ? (
                                <video src={c.url} controls className="w-full h-full object-cover" />
                             ) : (
                                <img src={c.url} className="w-full h-full object-cover" />
                             )}
                             {userProfile?.role === 'agent' && (
                                 <button onClick={() => handleClaim(c)} disabled={isSubmitting} className="absolute bottom-3 right-3 bg-white/90 backdrop-blur text-slate-900 text-xs font-bold px-4 py-2 rounded-full shadow-md active:scale-95 transition-transform">
                                     {isSubmitting ? 'Claiming...' : 'Claim & Share'}
                                 </button>
                             )}
                         </div>
                         <div className="px-1">
                             <p className="text-xs text-slate-600 line-clamp-2">{c.caption_template || 'New marketing creative available.'}</p>
                         </div>
                     </div>
                 ))}
                 {creatives.length === 0 && <div className="text-center py-10 text-slate-400 text-xs">No updates yet.</div>}
              </>
          )}

          {/* --- TAB: INVENTORY --- */}
          {activeTab === 'inventory' && (
              <>
                <div className="flex justify-between items-center">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">All Projects</h2>
                    {userProfile?.role === 'admin' && (
                        <button onClick={() => setShowAddProject(true)} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full shadow-lg active:scale-95 transition-transform">
                            <Plus size={12}/> Add Project
                        </button>
                    )}
                 </div>

                 {properties.map(p => (
                     <div key={p.id} onClick={() => setSelectedProperty(p)} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex gap-3 cursor-pointer hover:bg-slate-50 transition-colors relative group">
                         <img src={p.image_url} className="w-20 h-20 rounded-xl object-cover bg-slate-200" />
                         <div className="flex-1 py-1">
                             <div className="flex justify-between items-start">
                                 <h3 className="font-bold text-slate-900 text-sm">{p.title}</h3>
                                 {/* DELETE BUTTON */}
                                 {userProfile?.role === 'admin' && (
                                     <button 
                                         onClick={(e) => handleDeleteProject(p.id, e)}
                                         className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                     >
                                         <Trash2 size={16} />
                                     </button>
                                 )}
                             </div>
                             <p className="text-xs text-slate-500 mt-1">{p.address}</p>
                             <div className="flex gap-2 mt-2">
                                 {p.configurations?.map((c, i) => (
                                     <span key={i} className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-600">{c.name}</span>
                                 )).slice(0, 3)}
                             </div>
                         </div>
                     </div>
                 ))}
              </>
          )}

          {/* --- TAB: ANALYTICS (Admin Only) --- */}
          {activeTab === 'analytics' && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                  <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><Share2 size={16}/> Team Activity</h3>
                  <div className="space-y-4">
                      {analytics.map((stat, i) => (
                          <div key={i} className="flex items-center justify-between border-b border-slate-50 pb-3 last:border-0">
                              <div>
                                  <p className="text-xs font-bold text-slate-800">{stat.agent_name}</p>
                                  <p className="text-[10px] text-slate-400">Status: {stat.status}</p>
                              </div>
                              <div className="flex gap-3 text-xs font-mono text-slate-600">
                                  <div className="flex items-center gap-1"><Share2 size={10} className="text-green-500"/> {stat.share_stats.whatsapp}</div>
                                  <div className="flex items-center gap-1"><Download size={10} className="text-blue-500"/> {stat.share_stats.download}</div>
                              </div>
                          </div>
                      ))}
                      {analytics.length === 0 && <div className="text-center text-xs text-slate-400 py-4">No activity recorded yet.</div>}
                  </div>
              </div>
          )}

      </div>

      {/* --- MODAL: ADD PROJECT --- */}
      {showAddProject && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between mb-4">
                      <h2 className="font-bold text-lg">New Project</h2>
                      <button onClick={() => setShowAddProject(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-3">
                      <input placeholder="Project Title" className="w-full bg-slate-50 p-3 rounded-xl text-sm" onChange={e => setNewProject({...newProject, title: e.target.value})} />
                      <input placeholder="Address" className="w-full bg-slate-50 p-3 rounded-xl text-sm" onChange={e => setNewProject({...newProject, address: e.target.value})} />
                      <input placeholder="RERA Number" className="w-full bg-slate-50 p-3 rounded-xl text-sm" onChange={e => setNewProject({...newProject, rera: e.target.value})} />
                      <textarea placeholder="Description" className="w-full bg-slate-50 p-3 rounded-xl text-sm" rows={3} onChange={e => setNewProject({...newProject, description: e.target.value})} />
                      
                      {/* Configurations */}
                      <div className="bg-slate-50 p-3 rounded-xl">
                          <p className="text-xs font-bold text-slate-400 mb-2 uppercase">Configurations</p>
                          <div className="flex gap-2 mb-2">
                              <input placeholder="Type (2BHK)" className="flex-1 bg-white p-2 rounded-lg text-xs" value={tempConfig.name} onChange={e => setTempConfig({...tempConfig, name: e.target.value})} />
                              <input placeholder="Price" className="w-20 bg-white p-2 rounded-lg text-xs" value={tempConfig.price} onChange={e => setTempConfig({...tempConfig, price: e.target.value})} />
                              <button onClick={() => {
                                  if(tempConfig.name) setNewProject(prev => ({...prev, configs: [...prev.configs, tempConfig]}))
                                  setTempConfig({name:'', size:'', price:''})
                              }} className="bg-slate-900 text-white px-3 rounded-lg text-xs font-bold">+</button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                              {newProject.configs.map((c, i) => (
                                  <span key={i} className="text-[10px] bg-white border px-2 py-1 rounded-md">{c.name} - {c.price}</span>
                              ))}
                          </div>
                      </div>

                      <div className="border-2 border-dashed border-slate-200 p-4 rounded-xl text-center">
                          <p className="text-xs text-slate-400 mb-2">Project Images (Required)</p>
                          <input type="file" multiple accept="image/*" onChange={e => e.target.files && setProjectFiles({...projectFiles, images: Array.from(e.target.files)})} className="text-xs text-slate-500 w-full" />
                      </div>

                      <button onClick={handleAddProject} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm mt-2">
                          {isSubmitting ? 'Saving...' : 'Create Project'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL: ADD CREATIVE --- */}
      {showAddCreative && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6">
                  <div className="flex justify-between mb-4">
                      <h2 className="font-bold text-lg">Post to Feed</h2>
                      <button onClick={() => setShowAddCreative(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-slate-500 ml-1">Select Project</label>
                          <select className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none" onChange={e => setNewCreative({...newCreative, property_id: e.target.value})}>
                              <option value="">-- General / Select --</option>
                              {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                          </select>
                      </div>
                      
                      <div className="border-2 border-dashed border-slate-200 p-6 rounded-xl text-center cursor-pointer hover:bg-slate-50 transition-colors relative">
                          <input type="file" accept="image/*,video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files?.[0] && setCreativeFile(e.target.files[0])} />
                          <Upload className="mx-auto text-slate-400 mb-2" size={24}/>
                          <p className="text-xs font-bold text-slate-500">{creativeFile ? creativeFile.name : 'Upload Creative File'}</p>
                      </div>

                      <div>
                          <label className="text-xs font-bold text-slate-500 ml-1">Caption Template</label>
                          <textarea className="w-full bg-slate-50 p-3 rounded-xl text-sm" rows={3} value={newCreative.caption} onChange={e => setNewCreative({...newCreative, caption: e.target.value})} />
                          <p className="text-[10px] text-slate-400 mt-1 ml-1">Use {'{{Name}}'} and {'{{Phone}}'}</p>
                      </div>

                      <button onClick={handleAddCreative} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm">
                          {isSubmitting ? 'Posting...' : 'Post Update'}
                      </button>
                  </div>
              </div>
          </div>
      )}
      
      {/* --- MODAL: VIEW PROPERTY DETAILS --- */}
      {selectedProperty && (
        <div className="fixed inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom-10">
           <button onClick={() => setSelectedProperty(null)} className="absolute top-4 right-4 z-10 bg-black/50 text-white p-2 rounded-full"><X size={20}/></button>
           <img src={selectedProperty.image_url} className="w-full h-64 object-cover" />
           <div className="flex-1 p-6 overflow-y-auto -mt-6 bg-white rounded-t-[2rem] relative">
               <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider mb-2 inline-block">RERA: {selectedProperty.rera_number || 'Pending'}</span>
               <h1 className="text-2xl font-black text-slate-900 mb-1">{selectedProperty.title}</h1>
               <p className="text-slate-500 text-sm flex items-center gap-1 mb-6"><MapPin size={14}/> {selectedProperty.address}</p>
               
               <div className="grid grid-cols-2 gap-3 mb-6">
                   {selectedProperty.configurations?.map((c, i) => (
                       <div key={i} className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                           <p className="text-xs font-bold text-slate-400 uppercase">{c.name}</p>
                           <p className="font-bold text-slate-900">{c.price}</p>
                           <p className="text-[10px] text-slate-500">{c.size}</p>
                       </div>
                   ))}
               </div>

               <h3 className="font-bold text-slate-900 text-sm mb-2">About Project</h3>
               <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line mb-6">{selectedProperty.description}</p>
               
               {/* Show Brochure Button if URL exists */}
               {selectedProperty.brochure_url && (
                   <button className="w-full border border-slate-200 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 mb-2">
                       <FileText size={16}/> Download Brochure
                   </button>
               )}
           </div>
        </div>
      )}

    </div>
  )
}