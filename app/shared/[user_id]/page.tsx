'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams, usePathname } from 'next/navigation'
import { MapPin, Phone, Loader2, Image as ImageIcon, LayoutGrid, BookOpen, ChevronRight, X, Filter, Check, Facebook, Instagram, Linkedin, Youtube, Share2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// --- TYPES ---
type Property = {
  id: string
  title: string
  address: string
  price: string
  status: string
  image_url: string
  images: string[]
  description?: string
  property_type?: string
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

const PROPERTY_TYPES = ['Residential', 'Commercial', 'Plots']

const parsePrice = (priceStr: string | null) => {
  if (!priceStr) return 0
  const numbersOnly = priceStr.replace(/[^0-9]/g, '')
  return parseInt(numbersOnly || '0')
}

export default function PublicProfilePage() {
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
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)

  // Filters
  const [showFilters, setShowFilters] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  // Sharing State
  const [sharingId, setSharingId] = useState<string | null>(null)

  // --- 1. ID EXTRACTION ---
  const getSafeUserId = () => {
    if (params?.userId) return params.userId as string
    if (params?.id) return params.id as string
    if (params && Object.keys(params).length > 0) return Object.values(params)[0] as string
    return null
  }

  // --- 2. DATA FETCHING ---
  useEffect(() => {
    const userId = getSafeUserId()
    
    // Init filters
    const urlMin = searchParams.get('min'); if(urlMin) setMinPrice(urlMin)
    const urlMax = searchParams.get('max'); if(urlMax) setMaxPrice(urlMax)
    const urlTypes = searchParams.get('types'); if(urlTypes) setSelectedTypes(urlTypes.split(','))

    if (!userId) {
        setErrorMsg("Invalid Page Link")
        setLoading(false)
        return
    }

    const fetchData = async () => {
      try {
        const { data: profileData } = await supabase.from('profiles').select('*').eq('id', userId).single()
        if (profileData) setProfile(profileData)

        const { data: props } = await supabase
            .from('properties')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
        if (props) setProperties(props)

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
  }, [])

  // --- 3. FILTER LOGIC ---
  const toggleType = (type: string) => {
    setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  }

  const filteredProperties = properties.filter(p => {
    const priceVal = parsePrice(p.price)
    const min = minPrice ? parseInt(minPrice) : 0
    const max = maxPrice ? parseInt(maxPrice) : Infinity
    const matchesType = selectedTypes.length === 0 || (p.property_type && selectedTypes.includes(p.property_type))
    const matchesPrice = priceVal >= min && priceVal <= max
    return matchesPrice && matchesType
  })

  // --- 4. SHARE LOGIC (Native Web Share API) ---
  const handleShare = async (prop: Property) => {
    try {
      setSharingId(prop.id)
      
      // Determine what text to share
      const shareText = `Check out this property!\n\n*${prop.title}*\n📍 ${prop.address}\n💰 ${prop.price}\n\n${prop.description ? prop.description : ''}`

      // Check if the browser supports sharing files
      if (navigator.canShare) {
        const filesToShare: File[] = []
        
        // Grab the main image (or loop through multiple if you want to share up to 3)
        // Here we just grab the primary image to ensure it loads fast
        const imageUrls = prop.images && prop.images.length > 0 ? prop.images.slice(0, 3) : [prop.image_url]

        for (let i = 0; i < imageUrls.length; i++) {
          if (!imageUrls[i]) continue;
          try {
            const response = await fetch(imageUrls[i])
            const blob = await response.blob()
            const file = new File([blob], `property_image_${i}.jpg`, { type: blob.type })
            filesToShare.push(file)
          } catch (e) {
            console.error("Failed to fetch image for sharing:", e)
          }
        }

        const shareData = {
          title: prop.title,
          text: shareText,
          files: filesToShare
        }

        // Trigger native share sheet
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData)
        } else {
          // Fallback if the device can share, but specifically rejected the files
          await navigator.share({ title: prop.title, text: `${shareText}\n\n${prop.image_url}` })
        }
      } else {
        // Fallback for desktop/unsupported browsers: Just copy to clipboard or open normal intent
        alert("Native file sharing is not supported on this device. The link has been copied instead.")
        navigator.clipboard.writeText(`${shareText}\n\nLink: ${prop.image_url}`)
      }
    } catch (error) {
      console.error('Error sharing property:', error)
    } finally {
      setSharingId(null)
    }
  }

  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400 bg-slate-50"><Loader2 className="animate-spin" /></div>
  if (errorMsg) return <div className="flex h-screen items-center justify-center text-slate-400"><p>{errorMsg}</p></div>

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans">
      
      {/* HEADER */}
      <div className="bg-white px-6 pt-8 pb-6 shadow-sm border-b border-slate-100">
        <div className="max-w-md mx-auto">
            <div className="flex items-center gap-4 mb-4">
                {profile?.logo_url ? (
                    <img src={profile.logo_url} className="w-16 h-16 rounded-full object-cover border border-slate-100 shadow-sm" alt="Logo" />
                ) : (
                    <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xl">
                    {profile?.business_name?.[0] || 'A'}
                    </div>
                )}
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-slate-900">{profile?.business_name || 'Portfolio'}</h1>
                    {profile?.contact_number && (
                    <a href={`tel:${profile.contact_number}`} className="flex items-center gap-1.5 text-slate-500 text-xs mt-1 hover:text-blue-600 transition-colors">
                        <Phone size={12} /> {profile.contact_number}
                    </a>
                    )}
                </div>
            </div>

            {/* Social Icons Row */}
            <div className="flex gap-3 mb-6 pl-1">
                {profile?.facebook_url && (
                    <a href={profile.facebook_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-[#1877F2] transition-colors"><Facebook size={20} /></a>
                )}
                {profile?.instagram_url && (
                    <a href={profile.instagram_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-[#E4405F] transition-colors"><Instagram size={20} /></a>
                )}
                {profile?.linkedin_url && (
                    <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-[#0077b5] transition-colors"><Linkedin size={20} /></a>
                )}
                {profile?.youtube_url && (
                    <a href={profile.youtube_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-[#FF0000] transition-colors"><Youtube size={20} /></a>
                )}
            </div>

            {/* TABS */}
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                <button onClick={() => setActiveTab('inventory')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'inventory' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <LayoutGrid size={14} /> Inventory
                </button>
                <button onClick={() => setActiveTab('blog')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'blog' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <BookOpen size={14} /> Blog
                </button>
            </div>
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="max-w-md mx-auto px-5 py-6">
        
        {activeTab === 'inventory' && (
            <div className="space-y-4 animate-in fade-in duration-300">
                <div className="flex justify-between items-end mb-2">
                    <h2 className="font-bold text-slate-700">Available Properties</h2>
                    <button onClick={() => setShowFilters(!showFilters)} className={`p-2 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-colors ${showFilters ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                        <Filter size={12} /> Filter
                    </button>
                </div>

                {showFilters && (
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 animate-in slide-in-from-top-2 space-y-3">
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Min Price</label>
                                <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0" className="w-full bg-slate-50 p-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Max Price</label>
                                <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Any" className="w-full bg-slate-50 p-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Type</label>
                            <div className="flex gap-2 flex-wrap">
                                {PROPERTY_TYPES.map(type => {
                                    const isSelected = selectedTypes.includes(type)
                                    return (
                                        <button key={type} onClick={() => toggleType(type)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 ${isSelected ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                                            {type} {isSelected && <Check size={12} />}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1">
                            <span>{filteredProperties.length} results</span>
                            {(minPrice || maxPrice || selectedTypes.length > 0) && (
                                <button onClick={() => { setMinPrice(''); setMaxPrice(''); setSelectedTypes([]) }} className="text-red-400 hover:text-red-500">Reset All</button>
                            )}
                        </div>
                    </div>
                )}
                
                {filteredProperties.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-[1.5rem] border border-dashed border-slate-200">
                        No properties match your filter.
                    </div>
                ) : (
                    filteredProperties.map((prop) => (
                        <div key={prop.id} className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-100 group">
                            <div className="relative h-48 w-full rounded-2xl overflow-hidden bg-slate-100 mb-3">
                                <img src={prop.image_url} alt="Property" className="w-full h-full object-cover" />
                                <div className="absolute top-3 left-3 flex gap-1">
                                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-white/90 text-slate-700 backdrop-blur-sm">{prop.price}</span>
                                    {prop.property_type && <span className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-black/60 text-white backdrop-blur-sm">{prop.property_type}</span>}
                                </div>
                                {prop.images && prop.images.length > 1 && (
                                    <div className="absolute bottom-2 right-2 bg-black/60 text-white px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm flex items-center gap-1"><ImageIcon size={10} /> +{prop.images.length - 1}</div>
                                )}
                            </div>
                            <div className="px-1">
                                <h3 className="text-lg font-bold text-slate-800">{prop.title}</h3>
                                <div className="flex items-center gap-1.5 text-slate-500 mt-1 mb-3">
                                    <MapPin size={14} />
                                    <span className="text-xs font-medium truncate">{prop.address}</span>
                                </div>
                                
                                {/* UPDATED BUTTON ROW */}
                                <div className="flex gap-2 w-full">
                                    <a href={`https://wa.me/${profile?.contact_number?.replace(/[^0-9]/g,'')}?text=I'm interested in ${prop.title} (${prop.price})`} target="_blank" rel="noopener noreferrer" className="flex-1 text-center bg-slate-900 text-white py-3 rounded-xl text-xs font-bold hover:opacity-90 active:scale-95 transition-all">
                                        Contact Agent
                                    </a>
                                    
                                    <button 
                                        onClick={() => handleShare(prop)}
                                        disabled={sharingId === prop.id}
                                        className="w-12 flex items-center justify-center bg-green-50 text-green-600 rounded-xl hover:bg-green-100 active:scale-95 transition-all disabled:opacity-50"
                                        title="Share Images + Details"
                                    >
                                        {sharingId === prop.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Share2 size={16} />
                                        )}
                                    </button>
                                </div>
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