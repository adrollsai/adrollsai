// adrollsai/adrollsai/adrollsai-builder-app/app/dashboard/page.tsx

'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, MapPin, X, Loader2, Image as ImageIcon, Filter, FileText, Upload, Sparkles, LayoutGrid, Zap, BarChart3, Share2, Download, Building, Trash2, ChevronLeft, ChevronRight, User, Megaphone, Pin, Link as LinkIcon, Copy, Flame, Star, Trophy, Crown, Medal } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { uploadToR2 } from '@/utils/upload-helper'
import { useOrganization } from '@/components/OrganizationWrapper'
// import DistributeManager from '@/components/DistributeManager'
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
  organization_id: string
}

// Unified Feed Type
type FeedItem = 
  | { 
      kind: 'creative'
      id: string
      url: string
      type: 'image' | 'video'
      caption_template: string
      created_at: string
      property_id: string 
      property?: { title: string }
      pinned?: boolean 
    }
  | {
      kind: 'post'
      id: string
      title: string
      content: string
      created_at: string
      tags: string[] | null 
      author?: { business_name: string, logo_url: string }
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
    // Gamification Fields
    current_streak?: number
    total_xp?: number
    level?: number
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  
  // Use the global organization context
  const { org } = useOrganization()
  
  // --- STATE ---
  // Added 'leaderboard' to activeTab
  const [activeTab, setActiveTab] = useState<'feed' | 'inventory' | 'leaderboard' | 'analytics'>('feed')
  const [userProfile, setUserProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Data
  const [properties, setProperties] = useState<Property[]>([])
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [analytics, setAnalytics] = useState<AssetStat[]>([])
  const [leaderboard, setLeaderboard] = useState<Profile[]>([]) // New State
  const [claimedCreativeIds, setClaimedCreativeIds] = useState<Set<string>>(new Set()) 
  
  // Modals
  const [showAddProject, setShowAddProject] = useState(false)
  const [showAddCreative, setShowAddCreative] = useState(false)
  const [showAddNews, setShowAddNews] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  
  // Image Slider State
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const sliderRef = useRef<HTMLDivElement>(null)

  // Forms
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  
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

  // -- Add News Form --
  const [newNews, setNewNews] = useState({ title: '', content: '' })

  // 1. FETCH DATA
  const fetchData = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // 1. Get Profile to determine Organization
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      
      if (profileError || !profile) {
          console.error("Profile Fetch Error:", profileError)
          return
      }

      setUserProfile(profile as Profile)
      const orgId = profile.organization_id

      if (!orgId) {
          setLoading(false)
          return
      }

      // 2. Get Properties (FILTERED BY ORG)
      const { data: props } = await supabase
        .from('properties')
        .select('*')
        .eq('organization_id', orgId) 
        .order('created_at', { ascending: false })
      
      if (props) setProperties(props)

      // 3. Get Creatives Feed (FILTERED BY ORG via Property relation)
      const { data: creatives } = await supabase
        .from('master_creatives')
        .select(`*, property:properties!inner(title, organization_id)`) 
        .eq('property.organization_id', orgId)
        .order('created_at', { ascending: false })

      // 4. Get News Posts (FILTERED BY ORG via Author relation)
      const { data: posts } = await supabase
        .from('posts')
        .select(`*, author:profiles!inner(organization_id, business_name, logo_url)`)
        .eq('author.organization_id', orgId)
        .order('created_at', { ascending: false })

      // 5. Merge and Sort Feed
      const combinedFeed: FeedItem[] = []
      
      if (creatives) {
          creatives.forEach((c: any) => combinedFeed.push({
              kind: 'creative',
              id: c.id,
              url: c.url,
              type: c.type,
              caption_template: c.caption_template,
              created_at: c.created_at,
              property_id: c.property_id, 
              property: c.property
          }))
      }

      if (posts) {
          posts.forEach((p: any) => combinedFeed.push({
              kind: 'post',
              id: p.id,
              title: p.title,
              content: p.content,
              created_at: p.created_at,
              tags: p.tags,
              author: p.author
          }))
      }

      // Sort: Pinned posts first, then newest
      combinedFeed.sort((a, b) => {
          const isAPinned = a.kind === 'post' && a.tags?.includes('pinned')
          const isBPinned = b.kind === 'post' && b.tags?.includes('pinned')
          if (isAPinned && !isBPinned) return -1
          if (!isAPinned && isBPinned) return 1
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

      setFeedItems(combinedFeed)

      // 6. Get Claimed Creatives (For Agents)
      if (profile.role === 'agent') {
          const { data: claims } = await supabase
             .from('assets')
             .select('master_creative_id')
             .eq('user_id', user.id)
             .not('master_creative_id', 'is', null)
          
          const claimedSet = new Set<string>()
          claims?.forEach((c: any) => {
              if (c.master_creative_id) claimedSet.add(c.master_creative_id)
          })
          setClaimedCreativeIds(claimedSet)
      }

      // 7. Get Leaderboard (Everyone)
      // Exclude 'admin' role so the admin doesn't appear in rankings
      const { data: lb } = await supabase
         .from('profiles')
         .select('*')
         .eq('organization_id', orgId)
         .neq('role', 'admin') 
         .order('total_xp', { ascending: false })
         .limit(20)
      
      if (lb) setLeaderboard(lb as Profile[])


      // 8. Get Analytics (Admin Only & Filtered)
      if (profile.role === 'admin') {
          // Filter out the admin themselves from the user list
          const { data: orgUsers } = await supabase
            .from('profiles')
            .select('id, business_name')
            .eq('organization_id', orgId)
            .neq('role', 'admin')

          const orgUserIds = orgUsers?.map(u => u.id) || []

          if (orgUserIds.length > 0) {
            const { data: stats } = await supabase
                .from('assets')
                .select(`status, share_stats, user:profiles(business_name)`)
                .in('user_id', orgUserIds)
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
      }

    } catch (error) {
      console.error("Dashboard Error:", error)
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

          const imageUrls = []
          for (const file of projectFiles.images) {
             const publicUrl = await uploadToR2(file, 'properties')
             imageUrls.push(publicUrl)
          }

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

  // 3. Add News Post (Admin)
  const handleAddNews = async () => {
      if (!newNews.title || !newNews.content) return
      setIsSubmitting(true)
      try {
          const { data: { user } } = await supabase.auth.getUser()
          
          await supabase.from('posts').insert({
              user_id: user?.id,
              title: newNews.title,
              content: newNews.content,
              status: 'published',
              tags: []
          })
          
          await fetchData()
          setShowAddNews(false)
          setNewNews({title: '', content: ''})
      } catch(e: any) {
          alert(e.message)
      } finally { setIsSubmitting(false) }
  }

  // 4. Agent: Claim Creative
  const handleClaim = async (creative: FeedItem) => {
      if (creative.kind !== 'creative') return
      
      if (!userProfile?.contact_number) {
          alert("Please complete your profile first.")
          return
      }

      // Check for prior claim
      const isAlreadyClaimed = claimedCreativeIds.has(creative.id)
      if (isAlreadyClaimed) {
          if (!confirm("You have already claimed this asset. Do you want to generate it again?")) {
              return
          }
      }

      setIsSubmitting(true)
      try {
          const res = await fetch('/api/creative/stamp', {
              method: 'POST',
              body: JSON.stringify({
                  masterImageUrl: creative.url,
                  agentProfile: userProfile,
                  propertyId: creative.property_id, 
                  masterCreativeId: creative.id
              })
          })
          
          const data = await res.json()
          
          if(res.ok) {
              setClaimedCreativeIds(prev => new Set(prev).add(creative.id))
              
              // Gamification Alert
              if (data.xpEarned) {
                  alert(`Creative Claimed!\n\n🔥 Streak: ${data.streak} Days\n✨ XP Earned: +${data.xpEarned}`)
              }

              router.push('/dashboard/assets')
              
          } else {
             throw new Error(data.error || "Stamping failed.")
          }
      } catch (e: any) {
          console.error(e)
          alert("Failed to claim asset: " + e.message)
      } finally { setIsSubmitting(false) }
  }

  // 5. Delete Item (Admin)
  const handleDeleteItem = async (item: FeedItem, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm("Are you sure you want to delete this?")) return
      
      setFeedItems(prev => prev.filter(i => i.id !== item.id))

      try {
          if (item.kind === 'creative') {
              await supabase.from('master_creatives').delete().eq('id', item.id)
          } else {
              await supabase.from('posts').delete().eq('id', item.id)
          }
      } catch (err) {
          console.error(err)
          fetchData()
      }
  }

  // 6. Pin/Unpin Post
  const handleTogglePin = async (post: FeedItem, e: React.MouseEvent) => {
      e.stopPropagation()
      if (post.kind !== 'post') return

      const isPinned = post.tags?.includes('pinned')
      const newTags = isPinned 
         ? (post.tags || []).filter(t => t !== 'pinned')
         : [...(post.tags || []), 'pinned']

      setFeedItems(prev => prev.map(i => {
          if (i.id === post.id && i.kind === 'post') {
              return { ...i, tags: newTags }
          }
          return i
      }).sort((a, b) => {
          const isAPinned = a.kind === 'post' && (a.id === post.id ? newTags.includes('pinned') : a.tags?.includes('pinned'))
          const isBPinned = b.kind === 'post' && (b.id === post.id ? newTags.includes('pinned') : b.tags?.includes('pinned'))
          if (isAPinned && !isBPinned) return -1
          if (!isAPinned && isBPinned) return 1
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }))

      await supabase.from('posts').update({ tags: newTags }).eq('id', post.id)
  }

  // 7. Delete Project
  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Are you sure? This will delete the project and all its templates.")) return

    setIsDeleting(true)
    const backupProperties = [...properties]
    setProperties(prev => prev.filter(p => p.id !== id))

    try {
        await supabase.from('assets').update({ property_id: null }).eq('property_id', id)
        await supabase.from('master_creatives').delete().eq('property_id', id)
        const { error } = await supabase.from('properties').delete().eq('id', id)
        if (error) throw error
    } catch (err: any) {
        console.error("Delete failed:", err)
        alert("Failed to delete: " + err.message)
        setProperties(backupProperties)
    } finally {
        setIsDeleting(false)
        fetchData()
    }
  }
  
  // 8. Invite Link
  const handleCopyInvite = () => {
      if (!userProfile?.organization_id) return
      const link = `${window.location.origin}/?invite_org=${userProfile.organization_id}`
      navigator.clipboard.writeText(link)
      alert("Invite link copied to clipboard! Send this to your agents.")
  }

  // --- UI HELPERS ---
  const handleScroll = () => {
    if (sliderRef.current) {
        const scrollLeft = sliderRef.current.scrollLeft
        const width = sliderRef.current.offsetWidth
        const index = Math.round(scrollLeft / width)
        setCurrentImageIndex(index)
    }
  }

  const getDisplayImages = (p: Property) => {
      if (p.images && p.images.length > 0) return p.images;
      return [p.image_url];
  }

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="min-h-screen bg-slate-50 pb-24 max-w-md mx-auto relative shadow-2xl">
      
      {/* Header */}
      <div className="bg-white p-5 pt-8 rounded-b-[2rem] shadow-sm z-10 sticky top-0">
          <div className="flex justify-between items-center mb-4">
            <div>
                <div className="flex items-center gap-2 mb-1">
                   {org?.master_logo_url && <img src={org.master_logo_url} className="w-8 h-8 object-contain" alt="Org Logo"/>}
                   <h1 className="text-xl font-black text-slate-900 tracking-tight">
                     {org?.name || (userProfile?.role === 'admin' ? 'Builder Console' : 'Agent Hub')}
                   </h1>
                </div>
                <p className="text-xs font-medium text-slate-400">
                    {userProfile?.role === 'admin' ? 'Organization Admin' : 'Sales Agent'}
                </p>
            </div>
            {/* INVITE BUTTON (Admin Only) */}
            {userProfile?.role === 'admin' && (
                <button onClick={handleCopyInvite} className="bg-slate-100 p-2 rounded-full text-slate-600 active:scale-95 transition-transform" title="Copy Invite Link">
                    <LinkIcon size={18} />
                </button>
            )}
          </div>
          
          {/* --- GAMIFICATION STATUS BAR --- */}
          {userProfile?.role === 'agent' && (
              <div className="flex items-center gap-2 mb-4 bg-slate-900 text-white p-3 rounded-xl shadow-lg relative overflow-hidden">
                  <div className="flex-1 flex items-center gap-2 relative z-10">
                      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-black text-sm border-2 border-white/30">
                          {userProfile.level || 1}
                      </div>
                      <div>
                          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Current Level</p>
                          <p className="text-xs font-bold text-white flex items-center gap-1">
                              <Star size={10} className="text-yellow-400 fill-current"/> {userProfile.total_xp || 0} XP
                          </p>
                      </div>
                  </div>
                  
                  <div className="h-8 w-[1px] bg-white/10"></div>

                  <div className="flex-1 flex items-center gap-2 relative z-10 pl-2">
                       <div className="bg-orange-500/20 p-2 rounded-lg text-orange-400">
                           <Flame size={18} fill="currentColor" />
                       </div>
                       <div>
                          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Daily Streak</p>
                          <p className="text-xs font-bold text-white">{userProfile.current_streak || 0} Days</p>
                       </div>
                  </div>

                  {/* Decorative BG */}
                  <div className="absolute top-0 right-0 p-2 opacity-5 pointer-events-none">
                      <Trophy size={80} />
                  </div>
              </div>
          )}

          {/* TABS */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setActiveTab('feed')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'feed' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                  <Zap size={14}/> Feed
              </button>
              <button onClick={() => setActiveTab('inventory')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'inventory' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                  <Building size={14}/> Projects
              </button>
              
              {/* Leaderboard Tab (All Users) */}
              <button onClick={() => setActiveTab('leaderboard')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'leaderboard' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                  <Trophy size={14}/> Rankings
              </button>

              {userProfile?.role === 'admin' && (
                  <button onClick={() => setActiveTab('analytics')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'analytics' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                      <BarChart3 size={14}/> Stats
                  </button>
              )}
          </div>
      </div>

      <div className="p-5 space-y-4">
          
          {/* --- TAB: FEED --- */}
          {activeTab === 'feed' && (
              <>
                 <div className="flex justify-between items-center">
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Latest Updates</h2>
                    {userProfile?.role === 'admin' && (
                        <div className="flex gap-2">
                             <button onClick={() => setShowAddNews(true)} className="flex items-center gap-1 text-xs font-bold bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-full shadow-sm active:scale-95 transition-transform">
                                <Megaphone size={12}/> News
                            </button>
                            <button onClick={() => setShowAddCreative(true)} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full shadow-lg active:scale-95 transition-transform">
                                <Plus size={12}/> Creative
                            </button>
                        </div>
                    )}
                 </div>

                 {feedItems.map(item => {
                     // RENDER NEWS POST
                     if (item.kind === 'post') {
                         const isPinned = item.tags?.includes('pinned')
                         return (
                            <div key={item.id} className={`bg-white rounded-2xl p-4 shadow-sm border ${isPinned ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100'} relative group`}>
                                {isPinned && <div className="absolute top-2 right-2 text-blue-500"><Pin size={14} fill="currentColor"/></div>}
                                
                                <div className="flex items-center gap-2 mb-2">
                                     <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-xs text-blue-600">
                                         {item.author?.business_name?.[0] || 'N'}
                                     </div>
                                     <div>
                                         <p className="text-xs font-bold text-slate-900">{item.title}</p>
                                         <p className="text-[10px] text-slate-400">{new Date(item.created_at).toLocaleDateString()}</p>
                                     </div>
                                </div>
                                <p className="text-sm text-slate-700 whitespace-pre-line mb-2">{item.content}</p>

                                {/* ADMIN ACTIONS */}
                                {userProfile?.role === 'admin' && (
                                    <div className="flex gap-3 mt-3 pt-3 border-t border-slate-100 justify-end">
                                        <button onClick={(e) => handleTogglePin(item, e)} className={`text-xs font-bold flex items-center gap-1 ${isPinned ? 'text-blue-600' : 'text-slate-400'}`}>
                                            <Pin size={12}/> {isPinned ? 'Unpin' : 'Pin'}
                                        </button>
                                        <button onClick={(e) => handleDeleteItem(item, e)} className="text-xs font-bold text-red-400 flex items-center gap-1 hover:text-red-600">
                                            <Trash2 size={12}/> Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                         )
                     }

                     // RENDER CREATIVE CARD
                     const isClaimed = claimedCreativeIds.has(item.id)

                     return (
                         <div key={item.id} className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 group relative">
                             <div className="flex items-center gap-2 mb-3">
                                 <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-500">
                                     P
                                 </div>
                                 <div className="flex-1">
                                     <p className="text-xs font-bold text-slate-900">{item.property?.title || 'General Update'}</p>
                                     <p className="text-[10px] text-slate-400">{new Date(item.created_at).toLocaleDateString()}</p>
                                 </div>
                                 {userProfile?.role === 'admin' && (
                                     <button onClick={(e) => handleDeleteItem(item, e)} className="text-slate-300 hover:text-red-500 p-1">
                                         <Trash2 size={14}/>
                                     </button>
                                 )}
                             </div>
                             <div className="rounded-xl overflow-hidden bg-slate-50 aspect-square mb-3 relative">
                                 {item.type === 'video' ? (
                                    <video src={item.url} controls className="w-full h-full object-cover" />
                                 ) : (
                                    <img src={item.url} className="w-full h-full object-cover" />
                                 )}
                                 
                                 {userProfile?.role === 'agent' && (
                                     <button 
                                        onClick={() => handleClaim(item)} 
                                        disabled={isSubmitting} 
                                        className={`absolute bottom-3 right-3 backdrop-blur text-xs font-bold px-4 py-2 rounded-full shadow-md active:scale-95 transition-transform flex items-center gap-1 
                                            ${isClaimed ? 'bg-green-100/90 text-green-800' : 'bg-white/90 text-slate-900'}
                                        `}
                                     >
                                         {isSubmitting ? '...' : isClaimed ? (
                                            <>Claim Again</>
                                         ) : 'Claim & Share'}
                                     </button>
                                 )}
                             </div>
                             <div className="px-1">
                                 <p className="text-xs text-slate-600 line-clamp-2">{item.caption_template || 'New marketing creative available.'}</p>
                             </div>
                         </div>
                     )
                 })}
                 {feedItems.length === 0 && <div className="text-center py-10 text-slate-400 text-xs">No updates yet.</div>}
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
                     <div key={p.id} onClick={() => { setSelectedProperty(p); setCurrentImageIndex(0); }} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex gap-3 cursor-pointer hover:bg-slate-50 transition-colors relative group">
                         <img src={p.image_url} className="w-20 h-20 rounded-xl object-cover bg-slate-200" />
                         <div className="flex-1 py-1">
                             <div className="flex justify-between items-start">
                                 <h3 className="font-bold text-slate-900 text-sm">{p.title}</h3>
                                 {userProfile?.role === 'admin' && (
                                     <button 
                                         onClick={(e) => handleDeleteProject(p.id, e)}
                                         disabled={isDeleting}
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
                 {properties.length === 0 && <div className="text-center py-10 text-slate-400 text-xs">No projects assigned to your organization.</div>}
              </>
          )}

          {/* --- TAB: LEADERBOARD --- */}
          {activeTab === 'leaderboard' && (
              <div className="space-y-4">
                  <div className="bg-slate-900 p-6 rounded-3xl relative overflow-hidden text-white shadow-xl">
                      <div className="absolute top-0 right-0 p-6 opacity-10"><Trophy size={120} /></div>
                      <h2 className="text-xl font-bold mb-1">Top Performers</h2>
                      <p className="text-xs text-slate-400 mb-6">Based on activity and sales</p>
                      
                      {leaderboard.length > 0 && (
                          <div className="flex items-end justify-center gap-4 mb-4">
                              {/* 2nd Place */}
                              {leaderboard[1] && (
                                  <div className="flex flex-col items-center">
                                      <div className="w-12 h-12 rounded-full border-2 border-slate-500 bg-slate-800 flex items-center justify-center font-bold text-sm mb-2 overflow-hidden relative">
                                          {leaderboard[1].logo_url ? <img src={leaderboard[1].logo_url} className="w-full h-full object-cover"/> : leaderboard[1].business_name?.[0]}
                                          <div className="absolute -bottom-1 -right-1 bg-slate-500 rounded-full p-0.5"><Medal size={12}/></div>
                                      </div>
                                      <p className="text-[10px] font-bold text-slate-300 w-16 text-center truncate">{leaderboard[1].business_name}</p>
                                      <p className="text-[10px] font-bold text-slate-500">{leaderboard[1].total_xp || 0} XP</p>
                                  </div>
                              )}
                              {/* 1st Place */}
                              {leaderboard[0] && (
                                  <div className="flex flex-col items-center -mt-6">
                                      <Crown size={24} className="text-yellow-400 mb-2 animate-bounce"/>
                                      <div className="w-16 h-16 rounded-full border-4 border-yellow-400 bg-slate-800 flex items-center justify-center font-bold text-lg mb-2 overflow-hidden shadow-lg shadow-yellow-500/20">
                                          {leaderboard[0].logo_url ? <img src={leaderboard[0].logo_url} className="w-full h-full object-cover"/> : leaderboard[0].business_name?.[0]}
                                      </div>
                                      <p className="text-xs font-bold text-white w-20 text-center truncate">{leaderboard[0].business_name}</p>
                                      <p className="text-[10px] font-bold text-yellow-400">{leaderboard[0].total_xp || 0} XP</p>
                                  </div>
                              )}
                              {/* 3rd Place */}
                              {leaderboard[2] && (
                                  <div className="flex flex-col items-center">
                                      <div className="w-12 h-12 rounded-full border-2 border-orange-700 bg-slate-800 flex items-center justify-center font-bold text-sm mb-2 overflow-hidden relative">
                                          {leaderboard[2].logo_url ? <img src={leaderboard[2].logo_url} className="w-full h-full object-cover"/> : leaderboard[2].business_name?.[0]}
                                          <div className="absolute -bottom-1 -right-1 bg-orange-700 rounded-full p-0.5"><Medal size={12}/></div>
                                      </div>
                                      <p className="text-[10px] font-bold text-slate-300 w-16 text-center truncate">{leaderboard[2].business_name}</p>
                                      <p className="text-[10px] font-bold text-slate-500">{leaderboard[2].total_xp || 0} XP</p>
                                  </div>
                              )}
                          </div>
                      )}
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                      {leaderboard.map((agent, i) => (
                          <div key={agent.id} className={`p-4 flex items-center gap-3 border-b border-slate-50 last:border-0 ${agent.id === userProfile?.id ? 'bg-blue-50' : ''}`}>
                              <span className={`w-6 text-center font-bold text-sm ${i < 3 ? 'text-yellow-500' : 'text-slate-400'}`}>#{i + 1}</span>
                              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-600 overflow-hidden">
                                  {agent.logo_url ? <img src={agent.logo_url} className="w-full h-full object-cover"/> : agent.business_name?.[0]}
                              </div>
                              <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-sm text-slate-900">{agent.business_name}</h4>
                                      {agent.id === userProfile?.id && <span className="bg-blue-200 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded">YOU</span>}
                                  </div>
                                  <div className="flex gap-3 text-[10px] text-slate-500 font-medium">
                                      <span className="flex items-center gap-1"><Flame size={10} className="text-orange-500"/> {agent.current_streak || 0} Day Streak</span>
                                      <span>Level {agent.level || 1}</span>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <p className="font-bold text-sm text-slate-900">{agent.total_xp || 0}</p>
                                  <p className="text-[10px] text-slate-400">XP</p>
                              </div>
                          </div>
                      ))}
                      {leaderboard.length === 0 && <div className="p-8 text-center text-slate-400 text-xs">No rankings available yet.</div>}
                  </div>
              </div>
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
                      <h2 className="font-bold text-lg">Post Creative</h2>
                      <button onClick={() => setShowAddCreative(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-slate-500 ml-1">Select Project</label>
                          <select className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none" onChange={e => setNewCreative({...newCreative, property_id: e.target.value})}>
                              <option value="">-- Select --</option>
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
                      </div>

                      <button onClick={handleAddCreative} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm">
                          {isSubmitting ? 'Posting...' : 'Post Update'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL: ADD NEWS --- */}
      {showAddNews && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6">
                  <div className="flex justify-between mb-4">
                      <h2 className="font-bold text-lg">Post News</h2>
                      <button onClick={() => setShowAddNews(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-4">
                      <input placeholder="Headline / Title" className="w-full bg-slate-50 p-3 rounded-xl text-sm font-bold" value={newNews.title} onChange={e => setNewNews({...newNews, title: e.target.value})} />
                      <textarea placeholder="Write your announcement here..." className="w-full bg-slate-50 p-3 rounded-xl text-sm h-32" value={newNews.content} onChange={e => setNewNews({...newNews, content: e.target.value})} />

                      <button onClick={handleAddNews} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm">
                          {isSubmitting ? 'Publishing...' : 'Publish'}
                      </button>
                  </div>
              </div>
          </div>
      )}
      
      {/* --- MODAL: VIEW PROPERTY DETAILS --- */}
      {selectedProperty && (
        <div className="fixed inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom-10">
           {/* Close Button */}
           <button onClick={() => setSelectedProperty(null)} className="absolute top-4 right-4 z-20 bg-black/40 backdrop-blur-md text-white p-2.5 rounded-full hover:bg-black/60 transition-colors"><X size={20}/></button>
           
           {/* IMAGE SLIDER */}
           <div className="relative w-full h-[40vh] bg-slate-100">
               <div 
                 ref={sliderRef}
                 onScroll={handleScroll}
                 className="flex overflow-x-auto w-full h-full snap-x snap-mandatory scrollbar-hide"
                 style={{ scrollBehavior: 'smooth' }}
               >
                   {getDisplayImages(selectedProperty).map((img, index) => (
                       <div key={index} className="w-full h-full flex-shrink-0 snap-center relative">
                           <img src={img} className="w-full h-full object-cover" alt={`Slide ${index}`} />
                       </div>
                   ))}
               </div>
               <div className="absolute top-4 left-4 z-10 bg-black/40 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1.5 rounded-full">
                   {currentImageIndex + 1} / {getDisplayImages(selectedProperty).length}
               </div>
               {getDisplayImages(selectedProperty).length > 1 && (
                   <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 z-10">
                       {getDisplayImages(selectedProperty).map((_, idx) => (
                           <div key={idx} className={`w-1.5 h-1.5 rounded-full transition-colors ${idx === currentImageIndex ? 'bg-white' : 'bg-white/40'}`} />
                       ))}
                   </div>
               )}
           </div>

           {/* Content Section */}
           <div className="flex-1 p-6 overflow-y-auto -mt-6 bg-white rounded-t-[2rem] relative z-10">
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