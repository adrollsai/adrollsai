'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams, usePathname } from 'next/navigation'
import { MapPin, Phone, Loader2, Image as ImageIcon, AlertCircle, LayoutGrid, BookOpen, ChevronRight, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// --- Types ---
type Property = {
  id: string
  title: string
  address: string
  price: string
  status: string
  image_url: string
  images: string[]
  description?: string
}

type Post = {
  id: string
  title: string
  excerpt: string
  content: string
  image_url: string
  created_at: string
  tags: string[]
}

// --- Helper: Price Parser ---
const parsePrice = (priceStr: string | null) => {
  if (!priceStr) return 0
  const numbersOnly = priceStr.replace(/[^0-9]/g, '')
  return parseInt(numbersOnly || '0')
}

export default function PublicProfilePage() {
  // --- HOOKS ---
  const params = useParams()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'inventory' | 'blog'>('inventory')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  
  // Data
  const [profile, setProfile] = useState<any>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  
  // Selection (For viewing a full blog post)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)

  // Filters
  const minQuery = searchParams.get('min')
  const maxQuery = searchParams.get('max')
  const qQuery = searchParams.get('q')

  // --- 1. ID EXTRACTION ---
  const getSafeUserId = () => {
    if (params?.userId) return params.userId as string
    if (params?.id) return params.id as string
    if (params && Object.keys(params).length > 0) return Object.values(params)[0] as string
    if (pathname) {
        const segments = pathname.split('/')
        const sharedIndex = segments.indexOf('shared')
        if (sharedIndex !== -1 && segments[sharedIndex + 1]) return segments[sharedIndex + 1]
    }
    return null
  }

  // --- 2. DATA FETCHING ---
  useEffect(() => {
    const userId = getSafeUserId()

    if (!userId) {
        const timer = setTimeout(() => { if (loading) { setErrorMsg("Invalid Page Link"); setLoading(false) } }, 500)
        return () => clearTimeout(timer)
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId)) {
        setErrorMsg("Invalid Page Link (Bad ID)")
        setLoading(false)
        return
    }

    const fetchData = async () => {
      try {
        // A. Profile
        const { data: profileData } = await supabase.from('profiles').select('*').eq('id', userId).single()
        if (profileData) setProfile(profileData)

        // B. Properties
        const { data: props } = await supabase
            .from('properties')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
        if (props) setProperties(props)

        // C. Blog Posts
        const { data: blogPosts } = await supabase
            .from('posts')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'published')
            .order('created_at', { ascending: false })
        if (blogPosts) setPosts(blogPosts)

      } catch (err) {
          console.error(err)
          setErrorMsg("Failed to load content.")
      } finally {
          setLoading(false)
      }
    }

    fetchData()
  }, [params, pathname])

  // --- 3. FILTER LOGIC ---
  const filteredProperties = properties.filter(p => {
    const priceVal = parsePrice(p.price)
    const min = minQuery ? parseInt(minQuery) : 0
    const max = maxQuery ? parseInt(maxQuery) : Infinity
    const search = (qQuery || '').toLowerCase()
    
    // const isActive = p.status?.toLowerCase() === 'active' // Uncomment to hide drafts
    const matchesPrice = priceVal >= min && priceVal <= max
    const matchesSearch = p.title?.toLowerCase().includes(search) || p.address?.toLowerCase().includes(search)
    
    return matchesPrice && matchesSearch
  })

  // --- RENDER ---
  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400 bg-slate-50"><Loader2 className="animate-spin" /></div>
  if (errorMsg) return <div className="flex h-screen items-center justify-center text-slate-400"><p>{errorMsg}</p></div>

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans">
      
      {/* HEADER */}
      <div className="bg-white px-6 pt-8 pb-6 shadow-sm border-b border-slate-100">
        <div className="max-w-md mx-auto">
            <div className="flex items-center gap-4 mb-6">
                {profile?.logo_url ? (
                    <img src={profile.logo_url} className="w-16 h-16 rounded-full object-cover border border-slate-100 shadow-sm" alt="Logo" />
                ) : (
                    <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xl">
                    {profile?.business_name?.[0] || 'A'}
                    </div>
                )}
                <div>
                    <h1 className="text-xl font-bold text-slate-900">{profile?.business_name || 'Portfolio'}</h1>
                    {profile?.contact_number && (
                    <a href={`tel:${profile.contact_number}`} className="flex items-center gap-1.5 text-slate-500 text-xs mt-1 hover:text-blue-600 transition-colors">
                        <Phone size={12} /> {profile.contact_number}
                    </a>
                    )}
                </div>
            </div>

            {/* TABS */}
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                <button 
                    onClick={() => setActiveTab('inventory')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'inventory' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <LayoutGrid size={14} /> Inventory
                </button>
                <button 
                    onClick={() => setActiveTab('blog')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'blog' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <BookOpen size={14} /> Blog
                </button>
            </div>
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="max-w-md mx-auto px-5 py-6">
        
        {/* INVENTORY TAB */}
        {activeTab === 'inventory' && (
            <div className="space-y-4 animate-in fade-in duration-300">
                <div className="flex justify-between items-end mb-2">
                    <h2 className="font-bold text-slate-700">Available Properties</h2>
                    <span className="text-xs text-slate-400">{filteredProperties.length} found</span>
                </div>
                
                {filteredProperties.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-[1.5rem] border border-dashed border-slate-200">
                        No properties match this filter.
                    </div>
                ) : (
                    filteredProperties.map((prop) => (
                        <div key={prop.id} className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-100 group">
                            <div className="relative h-48 w-full rounded-2xl overflow-hidden bg-slate-100 mb-3">
                                <img src={prop.image_url} alt="Property" className="w-full h-full object-cover" />
                                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-white/90 text-slate-700 backdrop-blur-sm">{prop.price}</span>
                                {prop.images && prop.images.length > 1 && (
                                    <div className="absolute bottom-2 right-2 bg-black/60 text-white px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm flex items-center gap-1"><ImageIcon size={10} /> +{prop.images.length - 1}</div>
                                )}
                            </div>
                            <div className="px-1">
                                <h3 className="text-lg font-bold text-slate-800">{prop.title}</h3>
                                <div className="flex items-center gap-1.5 text-slate-500 mt-1 mb-3"><MapPin size={14} /><span className="text-xs font-medium truncate">{prop.address}</span></div>
                                <a href={`https://wa.me/${profile?.contact_number?.replace(/[^0-9]/g,'')}?text=I'm interested in ${prop.title}`} target="_blank" className="block w-full text-center bg-slate-900 text-white py-3 rounded-xl text-xs font-bold hover:opacity-90 active:scale-95 transition-all">Contact Agent</a>
                            </div>
                        </div>
                    ))
                )}
            </div>
        )}

        {/* BLOG TAB */}
        {activeTab === 'blog' && (
            <div className="space-y-4 animate-in fade-in duration-300">
                <h2 className="font-bold text-slate-700 mb-2">Latest Insights</h2>
                
                {posts.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-[1.5rem] border border-dashed border-slate-200">
                        <p>No articles yet.</p>
                        <p className="text-[10px] mt-1">Check back soon for market updates.</p>
                    </div>
                ) : (
                    posts.map((post) => (
                        <div key={post.id} onClick={() => setSelectedPost(post)} className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-slate-100 cursor-pointer hover:border-blue-100 transition-colors group">
                            {post.image_url && (
                                <div className="h-32 w-full rounded-xl overflow-hidden mb-3 bg-slate-50">
                                    <img src={post.image_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Blog" />
                                </div>
                            )}
                            <div className="flex justify-between items-start gap-4">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800 line-clamp-2">{post.title}</h3>
                                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{post.excerpt}</p>
                                    <div className="flex gap-2 mt-3">
                                        {post.tags?.map(tag => (
                                            <span key={tag} className="text-[10px] font-medium bg-slate-50 text-slate-500 px-2 py-1 rounded-md">#{tag}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded-full text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                                    <ChevronRight size={16} />
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        )}

      </div>

      {/* BLOG MODAL */}
      {selectedPost && (
        <div className="fixed inset-0 z-[100] bg-white animate-in slide-in-from-bottom-10 overflow-y-auto">
            <div className="relative">
                {selectedPost.image_url && (
                    <div className="h-64 w-full relative">
                        <img src={selectedPost.image_url} className="w-full h-full object-cover" alt="Cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </div>
                )}
                <button onClick={() => setSelectedPost(null)} className="absolute top-4 right-4 bg-black/20 backdrop-blur-md text-white p-2 rounded-full hover:bg-black/40 transition-colors z-20">
                    <X size={20} />
                </button>
                
                <div className="max-w-md mx-auto px-6 -mt-12 relative z-10">
                    <div className="bg-white rounded-t-[2rem] p-6 min-h-screen shadow-lg">
                        <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-6" />
                        <h1 className="text-2xl font-bold text-slate-900 mb-2 leading-tight">{selectedPost.title}</h1>
                        <p className="text-xs text-slate-400 mb-6">{new Date(selectedPost.created_at).toLocaleDateString()}</p>
                        
                        <div className="prose prose-sm prose-slate max-w-none">
                            {/* Simple line break rendering for now */}
                            {selectedPost.content.split('\n').map((paragraph, i) => (
                                <p key={i} className="mb-4 text-slate-600 leading-relaxed">{paragraph}</p>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

    </div>
  )
}