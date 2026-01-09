'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, MapPin, X, Loader2, Image as ImageIcon, Filter, FileText, Upload, Sparkles, LayoutGrid, Zap, BarChart3, Share2, Download, Building, Trash2, ChevronLeft, ChevronRight, User, Megaphone, Pin, Link as LinkIcon, Copy, Flame, Star, Trophy, Crown, Medal, Users, Coins, Save, Check, UserPlus, RefreshCw, Paperclip, Video, MessageCircle, Pencil, Gift, AlertTriangle, Clock } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { uploadToR2 } from '@/utils/upload-helper'
import { useOrganization } from '@/components/OrganizationWrapper'

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
      media_url?: string | null
      media_type?: 'image' | 'video' | null
      created_at: string
      tags: string[] | null 
      author?: { business_name: string, logo_url: string }
    }

// Modified for Agents Tab
type AgentProfile = Profile & {
    leads_count?: number
    assets_count?: number
}

type Profile = {
    id: string
    role: 'admin' | 'agent'
    organization_id: string
    business_name: string
    contact_number: string
    logo_url: string
    email?: string
    ad_credits?: number
    // Gamification Fields
    current_streak?: number
    last_activity_date?: string
    total_xp?: number
    level?: number
}

// --- UTILS: Client Side Compression ---
const compressImage = async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/')) return file;
    
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(file);

            // Max dimensions (e.g., 1280px)
            const MAX_SIZE = 1280;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                }
            } else {
                if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            // Compress to JPEG with 0.8 quality
            canvas.toBlob((blob) => {
                if (!blob) return resolve(file);
                resolve(new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                }));
            }, 'image/jpeg', 0.8); 
        };
        img.onerror = (err) => reject(err);
    });
};

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  
  // Use the global organization context
  const { org } = useOrganization()
  
  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'feed' | 'inventory' | 'leaderboard' | 'agents'>('feed')
  const [userProfile, setUserProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Data
  const [properties, setProperties] = useState<Property[]>([])
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [agentsList, setAgentsList] = useState<AgentProfile[]>([]) 
  const [leaderboard, setLeaderboard] = useState<Profile[]>([]) 
  const [claimedCreativeIds, setClaimedCreativeIds] = useState<Set<string>>(new Set()) 
  
  // --- NEW: Pending Approvals & XP ---
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([])
  const [xpSettings, setXpSettings] = useState({ site_visit: 50, closed: 500 })

  // Modals
  const [showAddProject, setShowAddProject] = useState(false)
  const [showAddCreative, setShowAddCreative] = useState(false)
  const [showAddNews, setShowAddNews] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null) 
  
  // Edit & Share State
  const [showEditProject, setShowEditProject] = useState(false)
  const [editingProject, setEditingProject] = useState<Property | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null) 
  
  // New Agent State
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [newAgent, setNewAgent] = useState({ name: '', email: '', password: '', phone: '' })

  // Image Slider State
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const sliderRef = useRef<HTMLDivElement>(null)

  // Forms
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  
  // Agent Credit Editing
  const [editCreditsValue, setEditCreditsValue] = useState<string>('')
  const [isUpdatingCredits, setIsUpdatingCredits] = useState(false)
  const [creditMode, setCreditMode] = useState<'add' | 'set'>('add')

  // XP Awarding State
  const [awardXpValue, setAwardXpValue] = useState<string>('') 
  const [isAwardingXp, setIsAwardingXp] = useState(false)
  
  // -- Add Project Form --
  const [newProject, setNewProject] = useState({
      title: '', address: '', rera: '', description: '',
      configs: [] as Configuration[]
  })
  const [tempConfig, setTempConfig] = useState({ name: '', size: '', price: '' })
  
  // PDF Support
  const [projectFiles, setProjectFiles] = useState<{images: File[], brochure?: File, floorPlan?: File}>({ images: [] })
  
  // -- Add Creative Form --
  const [newCreative, setNewCreative] = useState({
      property_id: '',
      caption: "Check out this new update! {{Name}} {{Phone}}"
  })
  const [creativeFile, setCreativeFile] = useState<File | null>(null)

  // -- Add News Form --
  const [newNews, setNewNews] = useState({ title: '', content: '' })
  const [newsFile, setNewsFile] = useState<File | null>(null)

  // --- STREAK HELPER ---
  const getEffectiveStreak = () => {
      if (!userProfile?.last_activity_date) return 0
      
      const last = new Date(userProfile.last_activity_date)
      const now = new Date()
      
      const isToday = last.toDateString() === now.toDateString()
      
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const isYesterday = last.toDateString() === yesterday.toDateString()
      
      if (isToday || isYesterday) return userProfile.current_streak || 0
      return 0 // Streak broken
  }

  const effectiveStreak = getEffectiveStreak()

  // 1. FETCH DATA
  const fetchData = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // 1. Get Profile
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
        .limit(50) // <--- LIMIT ADDED FOR SCALABILITY
      
      if (props) setProperties(props)

     // 3. Get Creatives Feed (SCALABILITY FIX: Added Limit)
     const { data: creatives } = await supabase
     .from('master_creatives')
     .select(`*, property:properties!inner(title, organization_id)`) 
     .eq('property.organization_id', orgId)
     .order('created_at', { ascending: false })
     .limit(30) // <--- ADDED LIMIT

   // 4. Get News Posts (SCALABILITY FIX: Added Limit)
   const { data: posts } = await supabase
     .from('posts')
     .select(`*, author:profiles!inner(organization_id, business_name, logo_url)`)
     .eq('author.organization_id', orgId)
     .order('created_at', { ascending: false })
     .limit(20) // <--- ADDED LIMIT

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
              media_url: p.media_url,
              media_type: p.media_type,
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
      const { data: lb } = await supabase
         .from('profiles')
         .select('*')
         .eq('organization_id', orgId)
         .neq('role', 'admin') 
         .order('total_xp', { ascending: false })
         .limit(20)
      
      if (lb) setLeaderboard(lb as Profile[])


      // 8. Get Agents List (Admin Only)
      if (profile.role === 'admin') {
          const { data: agents } = await supabase
            .from('profiles')
            .select('*')
            .eq('organization_id', orgId)
            .eq('role', 'agent')
            .order('created_at', { ascending: false })
            .limit(50) // <--- LIMIT ADDED FOR SCALABILITY
            
          if (agents) {
             setAgentsList(agents as AgentProfile[])
          }

          // --- NEW: FETCH PENDING APPROVALS ---
          const { data: pendings } = await supabase
            .from('leads')
            .select('*, agent:profiles!inner(business_name, organization_id)')
            .eq('status', 'Pending Approval')
            .eq('agent.organization_id', orgId)
          
          if (pendings) setPendingApprovals(pendings)

          // --- NEW: FETCH ORG SETTINGS ---
          const { data: orgData } = await supabase
             .from('organizations')
             .select('xp_structure')
             .eq('id', orgId)
             .single()
          
          if (orgData?.xp_structure) {
             setXpSettings(orgData.xp_structure as any)
          }
      }

    } catch (error) {
      console.error("Dashboard Error:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // --- Track Share Helper ---
  const trackShare = async () => {
    try {
        const res = await fetch('/api/gamification/track-share', { method: 'POST' })
        const data = await res.json()
        if (data.success && userProfile) {
            setUserProfile(prev => prev ? ({ ...prev, current_streak: data.streak, total_xp: (prev.total_xp || 0) + data.xpGained }) : null)
        }
    } catch(e) { console.error("Tracking error", e) }
  }

  // --- HANDLERS ---

  // --- NEW: Handle Approve Lead ---
  const handleApproveLead = async (leadId: string, stage: string, approved: boolean) => {
      if (!approved && !confirm("Reject change and revert to Qualified?")) return
      
      try {
          // Calculate XP to award based on stage
          let xpToAward = 0
          if (stage === 'Site Visit Done') xpToAward = xpSettings.site_visit
          if (stage === 'Closed') xpToAward = xpSettings.closed

          const res = await fetch('/api/admin/approve-stage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  leadId,
                  approved,
                  xpReward: approved ? xpToAward : 0
              })
          })

          const data = await res.json()
          if (!res.ok) throw new Error(data.error)

          alert(approved ? "Request Approved & XP Awarded!" : "Request Rejected.")
          fetchData() // Refresh list
      } catch (e: any) {
          alert("Action failed: " + e.message)
      }
  }

  const handleAddProject = async () => {
      if (!newProject.title || !newProject.rera || projectFiles.images.length === 0) {
          alert("Title, RERA, and at least 1 image are required.")
          return
      }
      setIsSubmitting(true)
      try {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error("No user")

          // 1. Upload Images
          const imageUrls = []
          for (const file of projectFiles.images) {
             // Compress if image
             let fileToUpload = file;
             if (file.type.startsWith('image/')) {
                 fileToUpload = await compressImage(file);
             }
             const publicUrl = await uploadToR2(fileToUpload, 'properties')
             imageUrls.push(publicUrl)
          }

          // 2. Upload Brochure (if present)
          let brochureUrl = null
          if (projectFiles.brochure) {
              brochureUrl = await uploadToR2(projectFiles.brochure, 'documents')
          }

          // 3. Upload Floor Plan (if present)
          let floorPlanUrl = null
          if (projectFiles.floorPlan) {
              floorPlanUrl = await uploadToR2(projectFiles.floorPlan, 'documents')
          }

          // 4. Insert into DB
          await supabase.from('properties').insert({
              user_id: user.id,
              organization_id: userProfile?.organization_id,
              title: newProject.title,
              address: newProject.address,
              rera_number: newProject.rera,
              description: newProject.description,
              image_url: imageUrls[0],
              images: imageUrls,
              brochure_url: brochureUrl,
              floor_plan_url: floorPlanUrl,
              configurations: newProject.configs
          })
          
          await fetchData()
          setShowAddProject(false)
          // Reset Form
          setNewProject({ title: '', address: '', rera: '', description: '', configs: [] })
          setProjectFiles({ images: [], brochure: undefined, floorPlan: undefined })
          
      } catch (e: any) {
          alert(e.message)
      } finally { setIsSubmitting(false) }
  }

  const handleAddCreative = async () => {
      if (!newCreative.property_id || !creativeFile) {
          alert("Select a project and upload a file.")
          return
      }
      setIsSubmitting(true)
      try {
          // 1. Upload to R2 (Client Side)
          let fileToUpload = creativeFile;
          // Apply compression if it's an image
          if (fileToUpload.type.startsWith('image/')) {
              fileToUpload = await compressImage(fileToUpload)
          }

          const publicUrl = await uploadToR2(fileToUpload, 'feed')
          
          // 2. Call API (Server Side) -> Inserts DB & Sends Notifications
          const res = await fetch('/api/creative/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  propertyId: newCreative.property_id,
                  url: publicUrl,
                  type: creativeFile.type.startsWith('video') ? 'video' : 'image',
                  caption: newCreative.caption
              })
          })

          const data = await res.json()
          if (!res.ok) throw new Error(data.error || "Failed to create creative")

          await fetchData()
          setShowAddCreative(false)
          setCreativeFile(null) // Reset file
          alert("Creative posted & Agents notified! 🚀")
      } catch (e: any) {
          alert(e.message)
      } finally { setIsSubmitting(false) }
  }

  const handleAddNews = async () => {
      if (!newNews.title || !newNews.content) {
          alert("Title and content are required")
          return
      }
      setIsSubmitting(true)
      try {
          let mediaUrl = null;
          let mediaType = null;

          if (newsFile) {
              mediaType = newsFile.type.startsWith('video') ? 'video' : 'image';
              
              // Compress if image
              let fileToUpload = newsFile;
              if (mediaType === 'image') {
                  fileToUpload = await compressImage(newsFile);
              }

              mediaUrl = await uploadToR2(fileToUpload, 'feed');
          }

          const res = await fetch('/api/posts/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  title: newNews.title,
                  content: newNews.content,
                  mediaUrl,
                  mediaType
              })
          })

          const data = await res.json()
          if (!res.ok) throw new Error(data.error || "Failed to post news")
          
          await fetchData()
          setShowAddNews(false)
          setNewNews({title: '', content: ''})
          setNewsFile(null)
          alert("News posted & Agents notified! 📢")
      } catch(e: any) {
          alert(e.message)
      } finally { setIsSubmitting(false) }
  }

  const handleClaim = async (creative: FeedItem) => {
      if (creative.kind !== 'creative') return
      
      if (!userProfile?.contact_number) {
          alert("Please complete your profile first.")
          return
      }

      const isAlreadyClaimed = claimedCreativeIds.has(creative.id)
      if (isAlreadyClaimed) {
          if (!confirm("You have already claimed this asset. Do you want to generate it again?")) return
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
              
              // Trigger Share Tracking Logic (Awards XP & Streak)
              await trackShare()

              alert(`Creative Claimed! It's saved to your Assets tab.`)
              router.push('/dashboard/assets')
          } else {
             throw new Error(data.error || "Stamping failed.")
          }
      } catch (e: any) {
          alert("Failed to claim asset: " + e.message)
      } finally { setIsSubmitting(false) }
  }

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

  // WhatsApp Share Handler
  const handleWhatsAppShare = async (p: Property, e: React.MouseEvent) => {
    e.stopPropagation()

    // 1. Construct Text Info
    let text = `*${p.title}*\n`
    text += `📍 ${p.address}\n\n`
    
    if (p.configurations && p.configurations.length > 0) {
        text += `*Configurations:*\n`
        p.configurations.forEach(c => {
            text += `• ${c.name} (${c.size}) - ${c.price}\n`
        })
        text += `\n`
    }
    
    if (p.description) text += `${p.description}\n\n`
    if (p.brochure_url) text += `📄 *Brochure:* ${p.brochure_url}\n\n`
    text += `_Shared via AdRolls AI_`

    if (!navigator.canShare || !navigator.share) {
         alert("Sharing is not supported on this device.")
         return
    }

    try {
        await navigator.clipboard.writeText(text)
    } catch (err) {
        console.error("Clipboard write failed", err)
    }

    setSharingId(p.id)
    try {
        // 2. Download Images in Parallel (Faster)
        const imagesToShare = (p.images && p.images.length > 0 ? p.images : [p.image_url]).slice(0, 10)
        
        const filePromises = imagesToShare.map(async (url, i) => {
            const response = await fetch(url)
            const blob = await response.blob()
            // Use jpg to be safe for WhatsApp
            return new File([blob], `image_${i + 1}.jpg`, { type: 'image/jpeg' })
        })

        const filesArray = await Promise.all(filePromises)

        // 3. Share using Native Share Sheet
        const shareData = {
            files: filesArray,
            text: text,
            title: p.title 
        }

        if (navigator.canShare(shareData)) {
            await navigator.share(shareData)
            
            // TRACK SHARE HERE
            await trackShare()
        } else {
             alert("Sharing this combination of files is not supported on this device.")
        }
    } catch (error: any) {
        if (error.name === 'AbortError' || error.message.toLowerCase().includes('abort') || error.code === 20) {
            return
        }
        console.error("Share failed:", error)
        alert("Share failed: " + error.message)
    } finally {
        setSharingId(null)
    }
  }
  
  // Edit Project Handlers
  const handleEditProject = (property: Property, e: React.MouseEvent) => {
      e.stopPropagation()
      setEditingProject(property)
      setProjectFiles({ images: [] }) // Reset file inputs
      setShowEditProject(true)
  }

  const handleSaveEdit = async () => {
      if (!editingProject) return
      setIsSubmitting(true)
      try {
          let imageUrls = editingProject.images || []
          
          // 1. Upload NEW Images if any and append
          if (projectFiles.images.length > 0) {
              for (const file of projectFiles.images) {
                  let fileToUpload = file.type.startsWith('image/') ? await compressImage(file) : file
                  const publicUrl = await uploadToR2(fileToUpload, 'properties')
                  imageUrls.push(publicUrl)
              }
          }

          // 2. Upload NEW Brochure
          let brochureUrl = editingProject.brochure_url
          if (projectFiles.brochure) {
              brochureUrl = await uploadToR2(projectFiles.brochure, 'documents')
          }

          // 3. Upload NEW Floor Plan
          let floorPlanUrl = editingProject.floor_plan_url
          if (projectFiles.floorPlan) {
              floorPlanUrl = await uploadToR2(projectFiles.floorPlan, 'documents')
          }

          // 4. Update Supabase
          const { error } = await supabase.from('properties').update({
              title: editingProject.title,
              address: editingProject.address,
              rera_number: editingProject.rera_number,
              description: editingProject.description,
              configurations: editingProject.configurations,
              images: imageUrls,
              image_url: imageUrls[0], // Keep main image updated
              brochure_url: brochureUrl,
              floor_plan_url: floorPlanUrl
          }).eq('id', editingProject.id)

          if (error) throw error
          
          alert("Project updated successfully!")
          setShowEditProject(false)
          fetchData()
      } catch (e: any) {
          alert("Update failed: " + e.message)
      } finally {
          setIsSubmitting(false)
      }
  }

  // Agent Management Handlers

  const handleCreateAgent = async () => {
      if (!newAgent.name || !newAgent.email || !newAgent.password) {
          alert("Name, Email and Password are required.")
          return
      }
      setIsSubmitting(true)
      try {
          const res = await fetch('/api/org/create-agent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newAgent)
          })
          const data = await res.json()
          
          if (!res.ok) throw new Error(data.error)
          
          alert(`✅ Agent ${newAgent.name} added successfully!`)
          setNewAgent({ name: '', email: '', password: '', phone: '' })
          setShowAddAgent(false)
          fetchData() // Refresh list
      } catch (e: any) {
          alert("Error: " + e.message)
      } finally {
          setIsSubmitting(false)
      }
  }

  const handleOpenAgent = async (agent: AgentProfile) => {
      setSelectedAgent(agent)
      setEditCreditsValue('') // Reset input on open
      setCreditMode('add')    // Default to 'Add' mode
      
      // Fetch stats for this agent
      const { count: leadsCount } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('user_id', agent.id)
      const { count: assetsCount } = await supabase.from('assets').select('*', { count: 'exact', head: true }).eq('user_id', agent.id)
      
      setSelectedAgent(prev => prev ? ({ ...prev, leads_count: leadsCount || 0, assets_count: assetsCount || 0 }) : null)
  }

  const handleUpdateCredits = async () => {
      if (!selectedAgent || !editCreditsValue) return
      setIsUpdatingCredits(true)
      try {
          const res = await fetch('/api/admin/update-credits', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  agentId: selectedAgent.id,
                  amount: editCreditsValue,
                  type: creditMode // 'add' or 'set'
              })
          })

          const data = await res.json()
          if (!res.ok) throw new Error(data.error)

          const newBalance = data.newBalance

          // Update local state to reflect change instantly
          setAgentsList(prev => prev.map(a => a.id === selectedAgent.id ? { ...a, ad_credits: newBalance } : a))
          setSelectedAgent(prev => prev ? { ...prev, ad_credits: newBalance } : null)
          
          alert(`Success! Credits updated. Agent has been notified.`)
          setEditCreditsValue('') 
      } catch (e: any) {
          alert("Failed to update credits: " + e.message)
      } finally {
          setIsUpdatingCredits(false)
      }
  }

  const handleAwardXp = async () => {
      if (!selectedAgent || !awardXpValue) return
      setIsAwardingXp(true)
      try {
          const res = await fetch('/api/admin/award-xp', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId: selectedAgent.id, amount: awardXpValue })
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error)
          
          setAgentsList(prev => prev.map(a => a.id === selectedAgent.id ? { ...a, total_xp: data.newTotal } : a))
          setSelectedAgent(prev => prev ? { ...prev, total_xp: data.newTotal } : null)
          alert("XP Awarded!")
          setAwardXpValue('')
      } catch(e: any) { alert("Error: " + e.message) } finally { setIsAwardingXp(false) }
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
    <div className="min-h-screen bg-slate-50 max-w-7xl mx-auto pb-24 shadow-2xl">
      
      <div className="p-4 md:p-6 space-y-6">

          {/* --- GAMIFICATION STATUS BAR --- */}
          {userProfile?.role === 'agent' && (
              <div className="flex items-center gap-4 bg-slate-900 text-white p-4 rounded-2xl shadow-lg relative overflow-hidden max-w-4xl mx-auto">
                  <div className="flex-1 flex items-center gap-3 relative z-10">
                      <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center font-black text-lg border-2 border-white/30">
                          {userProfile.level || 1}
                      </div>
                      <div>
                          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Current Level</p>
                          <p className="text-sm font-bold text-white flex items-center gap-1">
                              <Star size={14} className="text-yellow-400 fill-current"/> {userProfile.total_xp || 0} XP
                          </p>
                      </div>
                  </div>
                  
                  <div className="h-10 w-[1px] bg-white/10"></div>

                  <div className="flex-1 flex items-center gap-3 relative z-10 pl-2">
                       <div className="bg-orange-500/20 p-2.5 rounded-xl text-orange-400">
                           <Flame size={20} fill="currentColor" />
                       </div>
                       <div>
                          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Daily Streak</p>
                          <p className="text-sm font-bold text-white">{effectiveStreak} Days</p>
                       </div>
                  </div>

                  <div className="absolute top-0 right-0 p-2 opacity-5 pointer-events-none">
                      <Trophy size={100} />
                  </div>
              </div>
          )}

          {/* --- PAGE TABS --- */}
          <div className="sticky top-20 z-40 bg-white p-1.5 rounded-xl shadow-sm border border-slate-100 max-w-lg mx-auto flex gap-1">
              <button onClick={() => setActiveTab('feed')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'feed' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <Zap size={14}/> Feed
              </button>
              <button onClick={() => setActiveTab('inventory')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'inventory' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <Building size={14}/> Projects
              </button>
              
              <button onClick={() => setActiveTab('leaderboard')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'leaderboard' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <Trophy size={14}/> Rankings
              </button>

              {userProfile?.role === 'admin' && (
                  <button onClick={() => setActiveTab('agents')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'agents' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                      <Users size={14}/> Agents 
                      {pendingApprovals.length > 0 && <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full ml-1 shadow-sm">{pendingApprovals.length}</span>}
                  </button>
              )}
          </div>
          
          {/* --- TAB CONTENT AREA --- */}
          <div className="max-w-4xl mx-auto">
              
              {/* --- TAB: FEED --- */}
              {activeTab === 'feed' && (
                  <div className="space-y-4">
                     <div className="flex justify-between items-center mb-2">
                        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Latest Updates</h2>
                        {userProfile?.role === 'admin' && (
                            <div className="flex gap-2">
                                 <button onClick={() => setShowAddNews(true)} className="flex items-center gap-1 text-xs font-bold bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-full shadow-sm hover:bg-slate-50 transition-colors">
                                    <Megaphone size={12}/> News
                                </button>
                                <button onClick={() => setShowAddCreative(true)} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full shadow-lg hover:bg-slate-800 transition-colors">
                                    <Plus size={12}/> Creative
                                </button>
                            </div>
                        )}
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {feedItems.map(item => {
                            // RENDER NEWS POST
                            if (item.kind === 'post') {
                                const isPinned = item.tags?.includes('pinned')
                                return (
                                    <div key={item.id} className={`bg-white rounded-2xl p-5 shadow-sm border ${isPinned ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100'} relative group`}>
                                        {isPinned && <div className="absolute top-3 right-3 text-blue-500"><Pin size={16} fill="currentColor"/></div>}
                                        
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center font-bold text-sm text-blue-600 border border-blue-200">
                                                {item.author?.business_name?.[0] || 'N'}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-900">{item.title}</p>
                                                <p className="text-xs text-slate-400">{new Date(item.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        
                                        {/* POST CONTENT */}
                                        <p className="text-sm text-slate-700 whitespace-pre-line mb-3 leading-relaxed">{item.content}</p>

                                        {/* ATTACHED MEDIA */}
                                        {item.media_url && (
                                            <div className="rounded-xl overflow-hidden mb-3 border border-slate-100">
                                                {item.media_type === 'video' ? (
                                                    <video src={item.media_url} controls className="w-full max-h-64 object-cover" />
                                                ) : (
                                                    <img src={item.media_url} className="w-full max-h-64 object-cover" alt="Post attachment" />
                                                )}
                                            </div>
                                        )}

                                        {/* ADMIN ACTIONS */}
                                        {userProfile?.role === 'admin' && (
                                            <div className="flex gap-3 pt-3 border-t border-slate-100 justify-end opacity-50 group-hover:opacity-100 transition-opacity">
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
                                <div key={item.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 group relative flex flex-col">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-500">
                                            P
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-xs font-bold text-slate-900 truncate">{item.property?.title || 'General Update'}</p>
                                            <p className="text-xs text-slate-400">{new Date(item.created_at).toLocaleDateString()}</p>
                                        </div>
                                        {userProfile?.role === 'admin' && (
                                            <button onClick={(e) => handleDeleteItem(item, e)} className="text-slate-300 hover:text-red-500 p-1">
                                                <Trash2 size={14}/>
                                            </button>
                                        )}
                                    </div>
                                    <div className="rounded-xl overflow-hidden bg-slate-50 aspect-square mb-3 relative group-hover:shadow-md transition-shadow">
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
                                    <div className="px-1 mt-auto">
                                        <p className="text-xs text-slate-600 line-clamp-2">{item.caption_template || 'New marketing creative available.'}</p>
                                    </div>
                                </div>
                            )
                        })}
                     </div>
                     {feedItems.length === 0 && <div className="text-center py-10 text-slate-400 text-sm">No updates yet.</div>}
                  </div>
              )}

              {/* --- TAB: INVENTORY --- */}
              {activeTab === 'inventory' && (
                  <div className="space-y-4">
                     <div className="flex justify-between items-center mb-2">
                        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">All Projects</h2>
                        {userProfile?.role === 'admin' && (
                            <button onClick={() => setShowAddProject(true)} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-4 py-2 rounded-full shadow-lg hover:bg-slate-800 transition-colors">
                                <Plus size={14}/> Add Project
                            </button>
                        )}
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {properties.map(p => (
                            <div key={p.id} onClick={() => { setSelectedProperty(p); setCurrentImageIndex(0); }} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex gap-4 cursor-pointer hover:bg-slate-50 transition-colors relative group">
                                <img src={p.image_url} className="w-24 h-24 rounded-xl object-cover bg-slate-200 shadow-sm" />
                                <div className="flex-1 py-1">
                                    <div className="flex justify-between items-start">
                                        <h3 className="font-bold text-slate-900 text-base">{p.title}</h3>
                                        <div className="flex items-center gap-1">
                                            {/* WhatsApp Share Button */}
                                            <button 
                                                onClick={(e) => handleWhatsAppShare(p, e)}
                                                className="text-white bg-green-500 hover:bg-green-600 p-1.5 rounded-full transition-colors shadow-sm z-10"
                                                title="Share on WhatsApp"
                                            >
                                                {sharingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                                            </button>

                                            {/* Admin Edit & Delete */}
                                            {userProfile?.role === 'admin' && (
                                                <>
                                                    <button 
                                                        onClick={(e) => handleEditProject(p, e)}
                                                        className="text-white bg-blue-500 hover:bg-blue-600 p-1.5 rounded-full transition-colors shadow-sm z-10 ml-1"
                                                        title="Edit Project"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => handleDeleteProject(p.id, e)}
                                                        disabled={isDeleting}
                                                        className="text-slate-300 hover:text-red-500 transition-colors p-1.5 z-10"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><MapPin size={12}/> {p.address}</p>
                                    <div className="flex gap-2 mt-3 flex-wrap">
                                        {p.configurations?.map((c, i) => (
                                            <span key={i} className="px-2 py-1 bg-slate-100 rounded-md text-[10px] font-bold text-slate-600 border border-slate-200">{c.name}</span>
                                        )).slice(0, 3)}
                                    </div>
                                </div>
                            </div>
                        ))}
                     </div>
                     {properties.length === 0 && <div className="text-center py-10 text-slate-400 text-sm">No projects assigned to your organization.</div>}
                  </div>
              )}

              {/* --- TAB: LEADERBOARD --- */}
              {activeTab === 'leaderboard' && (
                  <div className="space-y-6">
                      <div className="bg-slate-900 p-8 rounded-[2rem] relative overflow-hidden text-white shadow-xl text-center">
                          <div className="absolute top-0 right-0 p-8 opacity-10"><Trophy size={150} /></div>
                          <h2 className="text-2xl font-bold mb-2 relative z-10">Top Performers</h2>
                          <p className="text-sm text-slate-400 mb-8 relative z-10">Ranking based on sales & activity</p>
                          
                          {leaderboard.length > 0 && (
                              <div className="flex items-end justify-center gap-6 relative z-10">
                                  {/* 2nd Place */}
                                  {leaderboard[1] && (
                                      <div className="flex flex-col items-center">
                                          <div className="w-16 h-16 rounded-full border-2 border-slate-500 bg-slate-800 flex items-center justify-center font-bold text-lg mb-2 overflow-hidden relative shadow-lg">
                                              {leaderboard[1].logo_url ? <img src={leaderboard[1].logo_url} className="w-full h-full object-cover"/> : leaderboard[1].business_name?.[0]}
                                              <div className="absolute -bottom-2 -right-2 bg-slate-500 rounded-full p-1 border-2 border-slate-900"><Medal size={14}/></div>
                                          </div>
                                          <p className="text-xs font-bold text-slate-300 w-20 text-center truncate">{leaderboard[1].business_name}</p>
                                          <p className="text-[10px] font-bold text-slate-500">{leaderboard[1].total_xp || 0} XP</p>
                                      </div>
                                  )}
                                  {/* 1st Place */}
                                  {leaderboard[0] && (
                                      <div className="flex flex-col items-center -mt-8">
                                          <Crown size={32} className="text-yellow-400 mb-2 animate-bounce"/>
                                          <div className="w-24 h-24 rounded-full border-4 border-yellow-400 bg-slate-800 flex items-center justify-center font-bold text-2xl mb-3 overflow-hidden shadow-xl shadow-yellow-500/20">
                                              {leaderboard[0].logo_url ? <img src={leaderboard[0].logo_url} className="w-full h-full object-cover"/> : leaderboard[0].business_name?.[0]}
                                          </div>
                                          <p className="text-sm font-bold text-white w-24 text-center truncate">{leaderboard[0].business_name}</p>
                                          <p className="text-xs font-bold text-yellow-400">{leaderboard[0].total_xp || 0} XP</p>
                                      </div>
                                  )}
                                  {/* 3rd Place */}
                                  {leaderboard[2] && (
                                      <div className="flex flex-col items-center">
                                          <div className="w-16 h-16 rounded-full border-2 border-orange-700 bg-slate-800 flex items-center justify-center font-bold text-lg mb-2 overflow-hidden relative shadow-lg">
                                              {leaderboard[2].logo_url ? <img src={leaderboard[2].logo_url} className="w-full h-full object-cover"/> : leaderboard[2].business_name?.[0]}
                                              <div className="absolute -bottom-2 -right-2 bg-orange-700 rounded-full p-1 border-2 border-slate-900"><Medal size={14}/></div>
                                          </div>
                                          <p className="text-xs font-bold text-slate-300 w-20 text-center truncate">{leaderboard[2].business_name}</p>
                                          <p className="text-[10px] font-bold text-slate-500">{leaderboard[2].total_xp || 0} XP</p>
                                      </div>
                                  )}
                              </div>
                          )}
                      </div>

                      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                          {leaderboard.map((agent, i) => (
                              <div key={agent.id} className={`p-4 flex items-center gap-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${agent.id === userProfile?.id ? 'bg-blue-50/50' : ''}`}>
                                  <span className={`w-8 text-center font-black text-sm ${i < 3 ? 'text-yellow-500' : 'text-slate-300'}`}>#{i + 1}</span>
                                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-600 overflow-hidden border border-slate-200">
                                      {agent.logo_url ? <img src={agent.logo_url} className="w-full h-full object-cover"/> : agent.business_name?.[0]}
                                  </div>
                                  <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                          <h4 className="font-bold text-sm text-slate-900">{agent.business_name}</h4>
                                          {agent.id === userProfile?.id && <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">YOU</span>}
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

              {/* --- TAB: AGENTS (Admin Only) --- */}
              {activeTab === 'agents' && (
                  <div className="space-y-6">
                      
                      {/* 1. APPROVAL QUEUE (New Feature) */}
                      {pendingApprovals.length > 0 && (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 shadow-sm animate-in slide-in-from-top-2">
                              <h3 className="font-bold text-yellow-800 text-sm mb-3 flex items-center gap-2"><AlertTriangle size={16}/> Pending Approvals</h3>
                              <div className="space-y-3">
                                  {pendingApprovals.map(p => (
                                      <div key={p.id} className="bg-white p-4 rounded-xl border border-yellow-100 flex items-center justify-between shadow-sm">
                                          <div>
                                              <p className="font-bold text-slate-900 text-sm">{p.name} <span className="text-slate-400 font-normal">({p.pipeline_stage})</span></p>
                                              <p className="text-xs text-slate-500">Agent: <span className="font-bold">{p.agent?.business_name}</span></p>
                                          </div>
                                          <div className="flex gap-2">
                                              <button 
                                                  onClick={() => handleApproveLead(p.id, p.pipeline_stage, false)}
                                                  className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 font-bold text-xs"
                                              >
                                                  Reject
                                              </button>
                                              <button 
                                                  onClick={() => handleApproveLead(p.id, p.pipeline_stage, true)}
                                                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-bold text-xs flex items-center gap-1 shadow-md"
                                              >
                                                  <Check size={14}/> Approve
                                              </button>
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}

                      {/* 2. XP SETTINGS (New Feature) */}
                      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                          <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2"><Sparkles size={16} className="text-purple-500"/> Reward Configuration</h3>
                          <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Site Visit XP</label>
                                    <input type="number" className="w-full bg-slate-50 p-2 rounded-lg text-sm font-bold mt-1" value={xpSettings.site_visit} disabled /> 
                                    <p className="text-[10px] text-slate-300 mt-1">Change in DB settings</p>
                                </div>
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Closure XP</label>
                                    <input type="number" className="w-full bg-slate-50 p-2 rounded-lg text-sm font-bold mt-1" value={xpSettings.closed} disabled />
                                </div>
                          </div>
                      </div>

                      <div className="flex justify-between items-center mb-2 mt-4">
                        <h3 className="font-bold text-slate-900 flex items-center gap-2">
                            <Users size={18}/> Managed Agents
                        </h3>
                        {/* Add Agent Button */}
                        <button 
                            onClick={() => setShowAddAgent(true)}
                            className="bg-slate-900 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg hover:bg-slate-800 transition-colors"
                        >
                            <UserPlus size={14}/> Add Agent
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {agentsList.map(agent => (
                              <div 
                                 key={agent.id} 
                                 onClick={() => handleOpenAgent(agent)}
                                 className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors active:scale-98 relative group"
                              >
                                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-lg font-bold text-slate-500 overflow-hidden border border-slate-200 group-hover:border-slate-300">
                                      {agent.logo_url ? <img src={agent.logo_url} className="w-full h-full object-cover"/> : agent.business_name?.[0]}
                                  </div>
                                  <div className="flex-1">
                                      <h4 className="font-bold text-slate-900 text-sm">{agent.business_name}</h4>
                                      <p className="text-xs text-slate-500">{agent.contact_number}</p>
                                      <div className="flex items-center gap-3 mt-1.5">
                                          <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded font-bold border border-green-100 flex items-center gap-1">
                                              <Coins size={10}/> ₹{(agent.ad_credits || 0).toLocaleString()}
                                          </span>
                                          <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                                              <Star size={10} className="text-yellow-400 fill-current"/> Lvl {agent.level || 1}
                                          </span>
                                      </div>
                                  </div>
                                  <div className="text-slate-300">
                                      <ChevronRight size={20}/>
                                  </div>
                              </div>
                          ))}
                          {agentsList.length === 0 && <div className="text-center py-10 text-slate-400 text-sm">No agents found. Add one above.</div>}
                      </div>
                  </div>
              )}
          </div>

      </div>

      {/* --- MODAL: ADD PROJECT --- */}
      {showAddProject && (
          <div className="fixed top-0 left-0 w-screen h-screen z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
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

                      {/* Image Upload */}
                      <div className="border-2 border-dashed border-slate-200 p-4 rounded-xl text-center">
                          <p className="text-xs text-slate-400 mb-2">Project Images (Required)</p>
                          <input type="file" multiple accept="image/*" onChange={e => e.target.files && setProjectFiles(prev => ({...prev, images: Array.from(e.target.files!)}))} className="text-xs text-slate-500 w-full" />
                      </div>

                      {/* PDF Uploads (Brochure & Floor Plan) */}
                      <div className="grid grid-cols-2 gap-3">
                          <div className="border-2 border-dashed border-slate-200 p-3 rounded-xl text-center">
                                <p className="text-xs text-slate-400 mb-1">Brochure (PDF)</p>
                                <input type="file" accept="application/pdf" onChange={e => e.target.files?.[0] && setProjectFiles(prev => ({...prev, brochure: e.target.files![0]}))} className="text-[10px] w-full text-slate-500" />
                          </div>
                          <div className="border-2 border-dashed border-slate-200 p-3 rounded-xl text-center">
                                 <p className="text-xs text-slate-400 mb-1">Floor Plan (PDF)</p>
                                 <input type="file" accept="application/pdf" onChange={e => e.target.files?.[0] && setProjectFiles(prev => ({...prev, floorPlan: e.target.files![0]}))} className="text-[10px] w-full text-slate-500" />
                          </div>
                      </div>

                      <button onClick={handleAddProject} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm mt-2">
                          {isSubmitting ? 'Saving...' : 'Create Project'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL: EDIT PROJECT (NEW) --- */}
      {showEditProject && editingProject && (
          <div className="fixed top-0 left-0 w-screen h-screen z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between mb-4">
                      <h2 className="font-bold text-lg">Edit Project</h2>
                      <button onClick={() => setShowEditProject(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-3">
                      <input 
                          value={editingProject.title} 
                          onChange={e => setEditingProject({...editingProject, title: e.target.value})} 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm" placeholder="Title" 
                      />
                      <input 
                          value={editingProject.address} 
                          onChange={e => setEditingProject({...editingProject, address: e.target.value})} 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm" placeholder="Address" 
                      />
                      <input 
                          value={editingProject.rera_number || ''} 
                          onChange={e => setEditingProject({...editingProject, rera_number: e.target.value})} 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm" placeholder="RERA" 
                      />
                      <textarea 
                          value={editingProject.description || ''} 
                          onChange={e => setEditingProject({...editingProject, description: e.target.value})} 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm" rows={3} placeholder="Description" 
                      />
                      
                      <div className="bg-slate-50 p-3 rounded-xl">
                          <p className="text-xs font-bold text-slate-400 mb-2">Configurations</p>
                          <div className="flex gap-2 mb-2">
                              <input placeholder="Type" className="flex-1 bg-white p-2 rounded-lg text-xs" value={tempConfig.name} onChange={e => setTempConfig({...tempConfig, name: e.target.value})} />
                              <input placeholder="Price" className="w-20 bg-white p-2 rounded-lg text-xs" value={tempConfig.price} onChange={e => setTempConfig({...tempConfig, price: e.target.value})} />
                              <button onClick={() => { 
                                  if(tempConfig.name) setEditingProject(prev => prev ? ({...prev, configurations: [...(prev.configurations||[]), tempConfig]}) : null); 
                                  setTempConfig({name:'', size:'', price:''}) 
                              }} className="bg-slate-900 text-white px-3 rounded-lg text-xs font-bold">+</button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                              {editingProject.configurations?.map((c, i) => (
                                  <div key={i} className="text-[10px] bg-white border px-2 py-1 rounded-md flex items-center gap-2">
                                      {c.name} - {c.price}
                                      <button onClick={() => setEditingProject(prev => prev ? ({...prev, configurations: prev.configurations?.filter((_, idx) => idx !== i)}) : null)} className="text-red-500"><X size={10}/></button>
                                  </div>
                              ))}
                          </div>
                      </div>

                      <div className="border-2 border-dashed border-slate-200 p-3 rounded-xl">
                          <p className="text-xs text-slate-400 mb-2">Add New Images (Appends to existing)</p>
                          <input type="file" multiple accept="image/*" onChange={e => e.target.files && setProjectFiles(prev => ({...prev, images: Array.from(e.target.files!)}))} className="text-xs w-full" />
                      </div>

                      <button onClick={handleSaveEdit} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm mt-2">
                          {isSubmitting ? 'Updating...' : 'Save Changes'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL: ADD AGENT --- */}
      {showAddAgent && (
          <div className="fixed top-0 left-0 w-screen h-screen z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10">
                  <div className="flex justify-between mb-4">
                      <h2 className="font-bold text-lg">Add New Agent</h2>
                      <button onClick={() => setShowAddAgent(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-3">
                      <input 
                          placeholder="Full Name" 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                          value={newAgent.name} onChange={e => setNewAgent({...newAgent, name: e.target.value})} 
                      />
                      <input 
                          placeholder="Email Address" 
                          type="email"
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                          value={newAgent.email} onChange={e => setNewAgent({...newAgent, email: e.target.value})} 
                      />
                      <input 
                          placeholder="Phone Number (Optional)" 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                          value={newAgent.phone} onChange={e => setNewAgent({...newAgent, phone: e.target.value})} 
                      />
                      <input 
                          placeholder="Set Password" 
                          type="text" // Visible so admin can copy
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                          value={newAgent.password} onChange={e => setNewAgent({...newAgent, password: e.target.value})} 
                      />
                      
                      <button onClick={handleCreateAgent} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm mt-2 hover:bg-slate-800 transition-colors">
                          {isSubmitting ? 'Creating...' : 'Create Account'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL: ADD CREATIVE --- */}
      {showAddCreative && (
          <div className="fixed top-0 left-0 w-screen h-screen z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
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

      {/* --- MODAL: ADD NEWS (UPDATED) --- */}
      {showAddNews && (
          <div className="fixed top-0 left-0 w-screen h-screen z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                  <div className="flex justify-between mb-4">
                      <h2 className="font-bold text-lg">Post News</h2>
                      <button onClick={() => setShowAddNews(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-4">
                      <input 
                          placeholder="Headline / Title" 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm font-bold focus:ring-2 focus:ring-slate-900 outline-none" 
                          value={newNews.title} 
                          onChange={e => setNewNews({...newNews, title: e.target.value})} 
                      />
                      
                      <textarea 
                          placeholder="Write your announcement here..." 
                          className="w-full bg-slate-50 p-3 rounded-xl text-sm h-28 focus:ring-2 focus:ring-slate-900 outline-none resize-none" 
                          value={newNews.content} 
                          onChange={e => setNewNews({...newNews, content: e.target.value})} 
                      />

                      {/* File Upload for News */}
                      <div className="relative group">
                           <div className={`border-2 border-dashed ${newsFile ? 'border-green-300 bg-green-50' : 'border-slate-200'} p-3 rounded-xl text-center cursor-pointer transition-colors hover:border-slate-400`}>
                               <input 
                                  type="file" 
                                  accept="image/*,video/*" 
                                  className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                                  onChange={e => e.target.files?.[0] && setNewsFile(e.target.files[0])} 
                                />
                               <div className="flex flex-col items-center justify-center gap-1">
                                   {newsFile ? (
                                       <>
                                           <Check size={20} className="text-green-600"/>
                                           <p className="text-xs font-bold text-green-700 truncate max-w-[200px]">{newsFile.name}</p>
                                       </>
                                   ) : (
                                       <>
                                           <Paperclip size={18} className="text-slate-400"/>
                                           <p className="text-xs font-bold text-slate-500">Attach Image or Video (Optional)</p>
                                       </>
                                   )}
                               </div>
                           </div>
                           {newsFile && (
                               <button 
                                  onClick={() => setNewsFile(null)} 
                                  className="absolute top-2 right-2 z-20 bg-slate-200 text-slate-500 rounded-full p-1 hover:bg-red-100 hover:text-red-500"
                               >
                                   <X size={12}/>
                               </button>
                           )}
                      </div>

                      <button onClick={handleAddNews} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all active:scale-95">
                          {isSubmitting ? <Loader2 className="animate-spin mx-auto"/> : 'Publish'}
                      </button>
                  </div>
              </div>
          </div>
      )}
      
      {/* --- MODAL: VIEW PROPERTY DETAILS --- */}
      {selectedProperty && (
        <div className="fixed top-0 left-0 w-screen h-screen z-[200] bg-white flex flex-col animate-in slide-in-from-bottom-10">
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
           </div>

           {/* Content Section */}
           <div className="flex-1 p-6 overflow-y-auto -mt-6 bg-white rounded-t-[2rem] relative z-10 max-w-4xl mx-auto w-full">
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

               {/* DOCUMENTS SECTION */}
               <div className="flex gap-2 mb-6">
                   {selectedProperty.brochure_url && (
                       <a href={selectedProperty.brochure_url} target="_blank" className="flex-1 border border-slate-200 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors">
                           <FileText size={16}/> Brochure
                       </a>
                   )}
                   {selectedProperty.floor_plan_url && (
                       <a href={selectedProperty.floor_plan_url} target="_blank" className="flex-1 border border-slate-200 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors">
                           <MapPin size={16}/> Floor Plan
                       </a>
                   )}
               </div>

               <h3 className="font-bold text-slate-900 text-sm mb-2">About Project</h3>
               <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line mb-6">{selectedProperty.description}</p>
           </div>
        </div>
      )}

      {/* --- MODAL: AGENT DETAIL (With XP Award) --- */}
      {selectedAgent && (
          <div className="fixed top-0 left-0 w-screen h-screen z-[200] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-start mb-6">
                      <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xl font-bold text-slate-500 overflow-hidden">
                              {selectedAgent.logo_url ? <img src={selectedAgent.logo_url} className="w-full h-full object-cover"/> : selectedAgent.business_name?.[0]}
                          </div>
                          <div>
                              <h2 className="text-lg font-black text-slate-900">{selectedAgent.business_name}</h2>
                              <p className="text-xs text-slate-500 font-medium">{selectedAgent.contact_number}</p>
                              {selectedAgent.email && <p className="text-[10px] text-slate-400">{selectedAgent.email}</p>}
                          </div>
                      </div>
                      <button onClick={() => setSelectedAgent(null)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={20} /></button>
                  </div>

                  {/* WALLET SECTION */}
                  <div className="bg-slate-900 p-5 rounded-2xl text-white mb-4 relative overflow-hidden">
                      <div className="relative z-10">
                           <div className="flex justify-between items-center mb-4">
                               <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Manage Wallet</p>
                               {/* MODE TOGGLE */}
                               <div className="bg-slate-800 p-1 rounded-lg flex text-[10px] font-bold">
                                   <button 
                                     onClick={() => setCreditMode('add')}
                                     className={`px-3 py-1 rounded-md transition-all ${creditMode === 'add' ? 'bg-green-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                   >
                                     ADD
                                   </button>
                                   <button 
                                     onClick={() => setCreditMode('set')}
                                     className={`px-3 py-1 rounded-md transition-all ${creditMode === 'set' ? 'bg-red-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                   >
                                     SET
                                   </button>
                               </div>
                           </div>
                           
                           {/* CURRENT BALANCE DISPLAY */}
                           <div className="mb-4 text-center">
                               <p className="text-xs text-slate-400 uppercase font-bold">Current Balance</p>
                               <p className="text-3xl font-black">₹{(selectedAgent.ad_credits || 0).toLocaleString()}</p>
                           </div>

                           <div className="flex items-center gap-2 mb-2">
                                <span className={`text-2xl font-bold ${creditMode === 'add' ? 'text-green-400' : 'text-white'}`}>
                                    {creditMode === 'add' ? '+' : '₹'}
                                </span>
                                <input 
                                    type="number"
                                    placeholder={creditMode === 'add' ? "Amount to add" : "New Balance"}
                                    value={editCreditsValue}
                                    onChange={(e) => setEditCreditsValue(e.target.value)}
                                    className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-xl font-bold w-full outline-none focus:bg-white/20 transition-all placeholder:text-white/20"
                                />
                           </div>
                           
                           <button 
                               onClick={handleUpdateCredits}
                               disabled={isUpdatingCredits || !editCreditsValue}
                               className="mt-3 w-full bg-white text-slate-900 hover:bg-slate-200 text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                           >
                               {isUpdatingCredits ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>}
                               {creditMode === 'add' ? 'Add Credits' : 'Set Balance'}
                           </button>
                      </div>
                      <div className="absolute -right-4 -bottom-4 opacity-10"><Coins size={100}/></div>
                  </div>

                  {/* ADMIN ONLY: XP AWARD (New Feature) */}
                  <div className="bg-gradient-to-r from-yellow-500 to-orange-500 p-5 rounded-2xl text-white mb-6 relative overflow-hidden">
                        <div className="relative z-10">
                            <p className="text-white/80 text-xs font-bold uppercase tracking-wider mb-2">Award Performance XP</p>
                            <p className="text-3xl font-black mb-2 flex items-center gap-2">
                                <Star fill="currentColor" className="text-white"/> {selectedAgent.total_xp}
                            </p>
                            
                            <div className="flex items-center gap-2">
                                <span className="text-2xl font-bold">+</span>
                                <input 
                                    type="number"
                                    placeholder="XP Amount"
                                    value={awardXpValue}
                                    onChange={(e) => setAwardXpValue(e.target.value)}
                                    className="bg-white/20 border border-white/30 rounded-lg px-3 py-2 text-xl font-bold w-full outline-none focus:bg-white/30 transition-all placeholder:text-white/50 text-white"
                                />
                            </div>
                            
                            <button 
                                onClick={handleAwardXp}
                                disabled={isAwardingXp || !awardXpValue}
                                className="mt-3 w-full bg-white text-orange-600 hover:bg-orange-50 text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md"
                            >
                                {isAwardingXp ? <Loader2 size={14} className="animate-spin"/> : <Gift size={14}/>}
                                Give XP Reward
                            </button>
                        </div>
                        <div className="absolute -right-2 -bottom-2 opacity-10"><Trophy size={100}/></div>
                  </div>

                  {/* STATS GRID */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <p className="text-xs text-slate-400 font-bold mb-1">Total Leads</p>
                          <p className="text-xl font-black text-slate-900">{selectedAgent.leads_count}</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <p className="text-xs text-slate-400 font-bold mb-1">Current Streak</p>
                          <p className="text-xl font-black text-slate-900">{selectedAgent.current_streak || 0} <span className="text-xs text-slate-400 font-normal">days</span></p>
                      </div>
                  </div>

                  <a 
                      href={`tel:${selectedAgent.contact_number}`}
                      className="w-full bg-white border-2 border-slate-100 text-slate-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
                  >
                      <User size={16}/> Call Agent
                  </a>
              </div>
          </div>
      )}

    </div>
  )
}