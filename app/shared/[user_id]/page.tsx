// app/shared/[user_id]/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams, usePathname } from 'next/navigation'
import { 
  MapPin, Phone, Loader2, Image as ImageIcon, LayoutGrid, Rss, 
  ChevronRight, X, Filter, Check, Facebook, Instagram, Linkedin, Youtube, Share2, ArrowUpRight
} from 'lucide-react'
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

const PROPERTY_TYPES = ['Residential', 'Commercial', 'Plots', 'Studio', '1 BHK', '2 RK']

const parsePrice = (priceStr: string | null) => {
  if (!priceStr) return 0
  const numbersOnly = priceStr.replace(/[^0-9]/g, '')
  return parseInt(numbersOnly || '0')
}

export default function PublicProfilePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'inventory' | 'feed'>('inventory')
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

  // --- 1. ID / DOMAIN EXTRACTION ---
  const getSafeIdentifier = () => {
    if (params?.user_id) return params.user_id as string
    if (params?.userId) return params.userId as string
    if (params?.id) return params.id as string
    if (params && Object.keys(params).length > 0) return Object.values(params)[0] as string
    return null
  }

  // --- 2. DATA FETCHING ---
  useEffect(() => {
    const identifier = getSafeIdentifier()
    
    // Init filters
    const urlMin = searchParams.get('min'); if(urlMin) setMinPrice(urlMin)
    const urlMax = searchParams.get('max'); if(urlMax) setMaxPrice(urlMax)
    const urlTypes = searchParams.get('types'); if(urlTypes) setSelectedTypes(urlTypes.split(','))

    if (!identifier) {
        setErrorMsg("Invalid Page Link")
        setLoading(false)
        return
    }

    const fetchData = async () => {
      try {
        let profileQuery = supabase.from('profiles').select('*')
        
        if (identifier.includes('.')) {
            profileQuery = profileQuery.eq('custom_domain', identifier)
        } else {
            profileQuery = profileQuery.eq('id', identifier)
        }
        
        const { data: profileData, error: profileError } = await profileQuery.single()
        
        if (profileError || !profileData) throw new Error("Profile not found")
        setProfile(profileData)

        const { data: props } = await supabase
            .from('properties')
            .select('*')
            .eq('user_id', profileData.id)
            .order('created_at', { ascending: false })
        if (props) setProperties(props)

        const { data: blogPosts } = await supabase
            .from('posts')
            .select('*')
            .eq('user_id', profileData.id)
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
    
    const rawType = p.property_type === '2 BHK' ? '2 RK' : p.property_type;
    const matchesType = selectedTypes.length === 0 || (rawType && selectedTypes.includes(rawType))
    const matchesPrice = priceVal >= min && priceVal <= max
    return matchesPrice && matchesType
  })

  // --- 4. SHARE LOGIC ---
  const handleShare = async (prop: Property) => {
    try {
      setSharingId(prop.id)
      const shareText = `Check out this property!\n\n*${prop.title}*\n📍 ${prop.address}\n💰 ${prop.price}\n\n${prop.description ? prop.description : ''}`

      if (navigator.canShare) {
        const filesToShare: File[] = []
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

        const shareData = { title: prop.title, text: shareText, files: filesToShare }
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData)
        } else {
          await navigator.share({ title: prop.title, text: `${shareText}\n\n${prop.image_url}` })
        }
      } else {
        alert("Native file sharing is not supported on this device. The link has been copied instead.")
        navigator.clipboard.writeText(`${shareText}\n\nLink: ${prop.image_url}`)
      }
    } catch (error) {
      console.error('Error sharing property:', error)
    } finally {
      setSharingId(null)
    }
  }

  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400 bg-[#F4F7FC]"><Loader2 className="animate-spin w-8 h-8 text-blue-500" /></div>
  if (errorMsg) return <div className="flex h-screen items-center justify-center text-slate-400 bg-[#F4F7FC]"><p className="bg-white px-6 py-4 rounded-full shadow-sm">{errorMsg}</p></div>

  return (
    <div className="min-h-screen bg-[#F4F7FC] pb-24 font-sans selection:bg-blue-200">
      
      {/* HEADER (Bubbly, Material You Style) */}
      <div className="bg-white md:mt-6 md:mx-6 rounded-b-[2.5rem] md:rounded-[3rem] p-8 md:p-12 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-8 max-w-6xl mx-auto transition-all">
        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
            <div className="relative group">
                {profile?.logo_url ? (
                    <img src={profile.logo_url} className="w-28 h-28 md:w-36 md:h-36 rounded-full object-cover shadow-sm ring-4 ring-blue-50" alt="Logo" />
                ) : (
                    <div className="w-28 h-28 md:w-36 md:h-36 rounded-full bg-blue-100 flex items-center justify-center text-blue-500 font-black text-4xl shadow-sm">
                    {profile?.business_name?.[0] || 'A'}
                    </div>
                )}
                {/* Decorative floating bubble */}
                <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-400 rounded-full border-4 border-white shadow-sm"></div>
            </div>

            <div className="flex-1 text-center md:text-left">
                <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-2">{profile?.business_name || 'Portfolio'}</h1>
                <p className="text-slate-500 font-medium max-w-xl mx-auto md:mx-0 text-sm md:text-base leading-relaxed mb-4">
                    {profile?.mission_statement || "Discover premium real estate opportunities."}
                </p>
                
                <div className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-3">
                    {profile?.contact_number && (
                    <a href={`tel:${profile.contact_number}`} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-full text-sm font-bold transition-all hover:scale-105 active:scale-95 shadow-md">
                        <Phone size={16} /> Contact Us
                    </a>
                    )}
                    
                    {/* Social Icons Row */}
                    <div className="flex gap-2 bg-slate-100 p-2 rounded-full">
                        {profile?.facebook_url && (
                            <a href={profile.facebook_url} target="_blank" rel="noopener noreferrer" className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-[#1877F2] hover:scale-110 transition-transform shadow-sm"><Facebook size={18} /></a>
                        )}
                        {profile?.instagram_url && (
                            <a href={profile.instagram_url} target="_blank" rel="noopener noreferrer" className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-[#E4405F] hover:scale-110 transition-transform shadow-sm"><Instagram size={18} /></a>
                        )}
                        {profile?.linkedin_url && (
                            <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-[#0077b5] hover:scale-110 transition-transform shadow-sm"><Linkedin size={18} /></a>
                        )}
                        {profile?.youtube_url && (
                            <a href={profile.youtube_url} target="_blank" rel="noopener noreferrer" className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-[#FF0000] hover:scale-110 transition-transform shadow-sm"><Youtube size={18} /></a>
                        )}
                    </div>
                </div>
            </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6">
        
        {/* PILL TABS */}
        <div className="flex justify-center mb-8">
            <div className="bg-white p-1.5 rounded-full shadow-sm inline-flex gap-1 border border-slate-100">
                <button onClick={() => setActiveTab('inventory')} className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all ${activeTab === 'inventory' ? 'bg-[#D0E8FF] text-blue-900' : 'text-slate-500 hover:bg-slate-50'}`}>
                    <LayoutGrid size={16} /> Inventory
                </button>
                <button onClick={() => setActiveTab('feed')} className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all ${activeTab === 'feed' ? 'bg-[#D0E8FF] text-blue-900' : 'text-slate-500 hover:bg-slate-50'}`}>
                    <Rss size={16} /> Updates Feed
                </button>
            </div>
        </div>

        {/* CONTENT AREA */}
        {activeTab === 'inventory' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Filter Controls */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight px-2">Featured Properties</h2>
                    <button onClick={() => setShowFilters(!showFilters)} className={`px-6 py-3 rounded-full flex items-center gap-2 text-sm font-bold transition-all shadow-sm ${showFilters ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'}`}>
                        <Filter size={16} /> Filters {(selectedTypes.length > 0 || minPrice || maxPrice) && <span className="w-2 h-2 rounded-full bg-blue-500"></span>}
                    </button>
                </div>

                {/* Filter Panel (Material You Expansion) */}
                {showFilters && (
                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-8 animate-in slide-in-from-top-4 duration-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Min Price</label>
                                    <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0" className="w-full bg-[#F4F7FC] p-4 rounded-[1.5rem] text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-100 transition-all" />
                                </div>
                                <div className="flex-1">
                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Max Price</label>
                                    <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Any" className="w-full bg-[#F4F7FC] p-4 rounded-[1.5rem] text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-100 transition-all" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Property Type</label>
                                <div className="flex gap-2 flex-wrap">
                                    {PROPERTY_TYPES.map(type => {
                                        const isSelected = selectedTypes.includes(type)
                                        return (
                                            <button key={type} onClick={() => toggleType(type)} className={`px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${isSelected ? 'bg-slate-900 text-white' : 'bg-[#F4F7FC] text-slate-600 hover:bg-slate-200'}`}>
                                                {type} {isSelected && <Check size={14} />}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                        {(minPrice || maxPrice || selectedTypes.length > 0) && (
                            <div className="mt-6 flex justify-end">
                                <button onClick={() => { setMinPrice(''); setMaxPrice(''); setSelectedTypes([]) }} className="text-sm font-bold text-red-500 hover:bg-red-50 px-4 py-2 rounded-full transition-colors">Clear All Filters</button>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Properties Grid */}
                {filteredProperties.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-[3rem] shadow-sm">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <LayoutGrid size={32} className="text-slate-300" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-700">No properties found</h3>
                        <p className="text-slate-400 mt-2">Try adjusting your filters to see more results.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                        {filteredProperties.map((prop) => {
                            const renderType = prop.property_type === '2 BHK' ? '2 RK' : prop.property_type;
                            return (
                                <div key={prop.id} className="bg-white rounded-[2.5rem] p-3 shadow-sm hover:shadow-xl transition-all duration-300 group border border-slate-50">
                                    <div className="relative h-64 w-full rounded-[2rem] overflow-hidden bg-slate-100 mb-4">
                                        <img src={prop.image_url} alt="Property" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                        
                                        {/* Floating Price Bubble */}
                                        <div className="absolute top-4 left-4">
                                            <span className="px-4 py-2 rounded-full text-sm font-black shadow-lg bg-white/95 text-slate-900 backdrop-blur-md">
                                                {prop.price}
                                            </span>
                                        </div>
                                        
                                        {/* Floating Type Bubble */}
                                        {renderType && (
                                            <div className="absolute top-4 right-4">
                                                <span className="px-4 py-2 rounded-full text-xs font-bold shadow-lg bg-black/70 text-white backdrop-blur-md">
                                                    {renderType}
                                                </span>
                                            </div>
                                        )}

                                        {prop.images && prop.images.length > 1 && (
                                            <div className="absolute bottom-4 right-4 bg-white/90 text-slate-900 px-3 py-1.5 rounded-full text-xs font-bold shadow-md flex items-center gap-1.5 backdrop-blur-md">
                                                <ImageIcon size={12} /> +{prop.images.length - 1}
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="px-3 pb-3">
                                        <h3 className="text-xl font-black text-slate-900 tracking-tight leading-tight mb-2 line-clamp-1">{prop.title}</h3>
                                        <div className="flex items-start gap-1.5 text-slate-500 mb-6">
                                            <MapPin size={16} className="mt-0.5 flex-shrink-0 text-blue-500" />
                                            <span className="text-sm font-medium line-clamp-2 leading-snug">{prop.address}</span>
                                        </div>
                                        
                                        <div className="flex gap-2 w-full">
                                            <a href={`https://wa.me/${profile?.contact_number?.replace(/[^0-9]/g,'')}?text=I'm interested in ${prop.title} (${prop.price})`} target="_blank" rel="noopener noreferrer" className="flex-1 text-center bg-[#D0E8FF] text-blue-900 py-3.5 rounded-full text-sm font-bold hover:bg-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2">
                                                <ArrowUpRight size={16} /> Contact Agent
                                            </a>
                                            
                                            <button 
                                                onClick={() => handleShare(prop)}
                                                disabled={sharingId === prop.id}
                                                className="w-14 flex items-center justify-center bg-slate-50 text-slate-600 rounded-full hover:bg-slate-200 active:scale-95 transition-all disabled:opacity-50 border border-slate-100"
                                                title="Share Details"
                                            >
                                                {sharingId === prop.id ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )}

        {/* FEED TAB */}
        {activeTab === 'feed' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-2xl font-black text-slate-800 tracking-tight px-2 mb-6">Market Updates & Insights</h2>
                
                {posts.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-[3rem] shadow-sm">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Rss size={32} className="text-slate-300" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-700">No updates yet</h3>
                        <p className="text-slate-400 mt-2">Check back soon for the latest market insights.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                        {posts.map((post) => (
                            <div key={post.id} onClick={() => setSelectedPost(post)} className="bg-white p-3 rounded-[2.5rem] shadow-sm hover:shadow-xl cursor-pointer transition-all duration-300 group flex flex-col h-full border border-slate-50">
                                {post.image_url && (
                                    <div className="h-48 w-full rounded-[2rem] overflow-hidden mb-4 bg-slate-100 relative">
                                        <img src={post.image_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="Feed cover" />
                                        <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors"></div>
                                    </div>
                                )}
                                <div className="px-3 pb-3 flex-1 flex flex-col">
                                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2">{new Date(post.created_at).toLocaleDateString()}</p>
                                    <h3 className="text-lg font-black text-slate-900 leading-snug mb-2 line-clamp-2">{post.title}</h3>
                                    <p className="text-sm text-slate-500 line-clamp-3 leading-relaxed flex-1">{post.excerpt}</p>
                                    
                                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-50">
                                        <div className="flex gap-1.5 overflow-hidden">
                                            {post.tags?.slice(0,2).map(tag => (
                                                <span key={tag} className="text-[10px] font-bold bg-[#F4F7FC] text-slate-500 px-3 py-1.5 rounded-full whitespace-nowrap">#{tag}</span>
                                            ))}
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-blue-500 group-hover:text-white transition-colors flex-shrink-0">
                                            <ChevronRight size={16} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}

      </div>

      {/* FEED POST FULL-SCREEN MODAL */}
      {selectedPost && (
        <div className="fixed inset-0 z-[100] bg-[#F4F7FC] animate-in slide-in-from-bottom-full duration-300 overflow-y-auto">
            <div className="relative min-h-screen pb-20">
                {selectedPost.image_url && (
                    <div className="h-72 md:h-96 w-full relative">
                        <img src={selectedPost.image_url} className="w-full h-full object-cover" alt="Cover" />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#F4F7FC]" />
                    </div>
                )}
                
                <button onClick={() => setSelectedPost(null)} className="fixed top-6 right-6 md:top-10 md:right-10 bg-white/90 backdrop-blur-md text-slate-900 p-3 rounded-full hover:bg-white transition-all z-20 shadow-lg hover:scale-110">
                    <X size={24} />
                </button>
                
                <div className="max-w-3xl mx-auto px-4 sm:px-6 relative z-10 -mt-20 md:-mt-32">
                    <div className="bg-white rounded-[2.5rem] md:rounded-[3rem] p-8 md:p-14 shadow-xl">
                        <div className="flex gap-2 mb-6 flex-wrap">
                            {selectedPost.tags?.map(tag => (
                                <span key={tag} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full">#{tag}</span>
                            ))}
                        </div>
                        
                        <h1 className="text-3xl md:text-5xl font-black text-slate-900 mb-6 leading-tight tracking-tight">{selectedPost.title}</h1>
                        
                        <div className="flex items-center gap-3 mb-10 pb-10 border-b border-slate-100">
                            {profile?.logo_url ? (
                                <img src={profile.logo_url} className="w-12 h-12 rounded-full object-cover shadow-sm" alt="Author" />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-400">{profile?.business_name?.[0] || 'A'}</div>
                            )}
                            <div>
                                <p className="text-sm font-bold text-slate-900">{profile?.business_name || 'Market Update'}</p>
                                <p className="text-xs text-slate-400 font-medium">{new Date(selectedPost.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            </div>
                        </div>

                        <div className="prose prose-lg prose-slate max-w-none prose-headings:font-black prose-headings:tracking-tight prose-p:leading-relaxed prose-a:text-blue-600 prose-img:rounded-3xl">
                            <div dangerouslySetInnerHTML={{ __html: selectedPost.content.replace(/\n/g, '<br/>') }} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

    </div>
  )
}