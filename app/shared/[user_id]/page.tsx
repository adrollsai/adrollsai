'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { 
  MapPin, Phone, Loader2, Image as ImageIcon, LayoutGrid, Rss, 
  ChevronRight, X, Filter, Check, Facebook, Instagram, Linkedin, Youtube, Share2, ArrowUpRight, ChevronLeft, Search
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// --- TYPES ---
type Profile = {
  business_name: string
  contact_number: string
  logo_url: string
  brand_color: string
  mission_statement: string
  facebook_url?: string
  instagram_url?: string
  linkedin_url?: string
  youtube_url?: string
}

type Property = {
  id: string
  title: string
  description: string
  price: string
  address: string
  image_url: string
  images: string[]
  status: string
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

// Custom WhatsApp Icon
const WhatsAppIcon = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
  </svg>
)

export default function SharedCataloguePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'inventory' | 'feed'>('inventory')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  
  // Data
  const [profile, setProfile] = useState<Profile | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  
  // Modals
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // Filters
  const [showFilters, setShowFilters] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
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
    const q = searchParams.get('q'); if (q) setSearchQuery(q)

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
        
        // THE FIX: Use maybeSingle() instead of single() to prevent 406 crashes
        const { data: profileData, error: profileError } = await profileQuery.maybeSingle()
        
        if (profileError) {
            console.error("Database error fetching profile:", profileError)
            throw new Error("Failed to load catalog database.")
        }

        if (!profileData) {
            // Gracefully handle 0 rows returned (e.g., domain typo or RLS block)
            setErrorMsg("This catalog is unavailable or the link is incorrect.")
            setLoading(false)
            return
        }

        setProfile(profileData)

        const { data: props } = await supabase
            .from('properties')
            .select('*')
            .eq('user_id', profileData.id)
            .order('created_at', { ascending: false })
        
        if (props) {
            // Filter out non-active properties
            const activeProps = props.filter(p => p.status !== 'Archived' && p.status !== 'Sold')
            setProperties(activeProps)
        }

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
    
    const matchesSearch = !searchQuery || 
                          p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.description?.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesPrice && matchesType && matchesSearch
  })

  // --- 4. SHARE LOGIC ---
  const handleShare = async (e: React.MouseEvent, prop: Property) => {
    e.stopPropagation()
    try {
      setSharingId(prop.id)
      const shareText = `Check out this property!\n\n*${prop.title}*\n📍 ${prop.address}\n💰 ${prop.price}\n\n${prop.description ? prop.description : ''}`

      if (navigator.canShare) {
        const filesToShare: File[] = []
        const imageUrls = prop.images && prop.images.length > 0 ? prop.images.slice(0, 3) : [prop.image_url]

        for (let i = 0; i < imageUrls.length; i++) {
          if (!imageUrls[i]) continue;
          try {
            const proxyUrl = `/api/fetch-image?url=${encodeURIComponent(imageUrls[i])}`
            const response = await fetch(proxyUrl)
            const blob = await response.blob()
            const mimeType = blob.type || 'image/jpeg'
            const ext = mimeType.split('/')[1] || 'jpg'
            const file = new File([blob], `property_image_${i}.${ext}`, { type: mimeType })
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

  // --- 5. CONTACT HELPERS ---
  const handleWhatsApp = (e: React.MouseEvent, propTitle: string) => {
    e.stopPropagation()
    if (!profile?.contact_number) return
    const text = `Hi! I'm interested in the "${propTitle}" I saw in your catalog.`
    const phone = profile.contact_number.replace(/[^0-9]/g, '')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank')
  }

  const handleCall = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!profile?.contact_number) return
    window.open(`tel:${profile.contact_number}`, '_self')
  }

  // --- 6. MODAL NAVIGATION ---
  const openModal = (prop: Property) => {
    setSelectedProperty(prop)
    setCurrentImageIndex(0)
  }

  const handleNextImage = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!selectedProperty) return
      const images = selectedProperty.images?.length > 0 ? selectedProperty.images : [selectedProperty.image_url]
      setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const handlePrevImage = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!selectedProperty) return
      const images = selectedProperty.images?.length > 0 ? selectedProperty.images : [selectedProperty.image_url]
      setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
  }

  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400 bg-[#F8FAFC]"><Loader2 className="animate-spin w-10 h-10 text-blue-500" /></div>
  if (errorMsg) return <div className="flex h-screen items-center justify-center text-slate-400 bg-[#F8FAFC]"><p className="bg-white px-8 py-5 rounded-[2rem] shadow-sm font-bold border border-slate-200">{errorMsg}</p></div>

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 font-sans selection:bg-blue-200">
      
      {/* 1. PUBLIC HEADER */}
      <div className="bg-white/90 sticky top-0 z-40 border-b border-slate-200/60 shadow-sm backdrop-blur-xl transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-4">
            
            {/* Branding */}
            <div className="flex items-center gap-3">
              {profile?.logo_url ? (
                <img src={profile.logo_url} alt="Logo" className="w-12 h-12 rounded-[1rem] object-cover shadow-sm border border-slate-100" />
              ) : (
                <div className="w-12 h-12 rounded-[1rem] bg-blue-50 flex items-center justify-center text-blue-500 font-black text-xl shadow-sm">
                  {profile?.business_name?.charAt(0)?.toUpperCase() || 'B'}
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 truncate tracking-tight">{profile?.business_name || 'Business Catalog'}</h1>
                <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest truncate">{profile?.mission_statement || 'Digital Catalog'}</p>
              </div>
            </div>

            {/* BIG CALL BUTTON WITH NUMBER */}
            {profile?.contact_number && (
              <button 
                onClick={handleCall}
                className="bg-slate-900 hover:bg-slate-800 text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-full shadow-md shadow-slate-900/20 transition-all flex items-center gap-2.5 active:scale-95 shrink-0 group"
              >
                <Phone size={16} className="text-white group-hover:rotate-12 transition-transform" /> 
                <span className="text-sm font-extrabold tracking-wide hidden sm:inline">{profile.contact_number}</span>
                <span className="text-sm font-extrabold tracking-wide sm:hidden">Call</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. HERO SECTION */}
      <div className="bg-white md:mt-8 md:mx-8 rounded-b-[2.5rem] md:rounded-[3rem] p-8 md:p-14 shadow-sm border border-slate-100 mb-8 max-w-7xl mx-auto transition-all relative overflow-hidden">
        {/* Subtle decorative background blob */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-50 rounded-full mix-blend-multiply filter blur-3xl opacity-70"></div>
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-purple-50 rounded-full mix-blend-multiply filter blur-3xl opacity-70"></div>
        
        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10 relative z-10">
            <div className="relative group">
                {profile?.logo_url ? (
                    <img src={profile.logo_url} className="w-28 h-28 md:w-40 md:h-40 rounded-[2rem] object-cover shadow-lg border-4 border-white" alt="Logo" />
                ) : (
                    <div className="w-28 h-28 md:w-40 md:h-40 rounded-[2rem] bg-blue-100 flex items-center justify-center text-blue-500 font-black text-5xl shadow-lg border-4 border-white">
                    {profile?.business_name?.[0] || 'A'}
                    </div>
                )}
            </div>

            <div className="flex-1 text-center md:text-left">
                <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-3 leading-tight">{profile?.business_name || 'Portfolio'}</h1>
                <p className="text-slate-500 font-medium max-w-xl mx-auto md:mx-0 text-sm md:text-base leading-relaxed mb-6">
                    {profile?.mission_statement || "Discover premium real estate opportunities tailored for you."}
                </p>
                
                {/* Social Icons Row */}
                <div className="flex justify-center md:justify-start gap-3">
                    {profile?.facebook_url && (
                        <a href={profile.facebook_url} target="_blank" rel="noopener noreferrer" className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white border border-slate-100 text-[#1877F2] hover:bg-[#1877F2] hover:text-white transition-all shadow-sm"><Facebook size={20} /></a>
                    )}
                    {profile?.instagram_url && (
                        <a href={profile.instagram_url} target="_blank" rel="noopener noreferrer" className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white border border-slate-100 text-[#E4405F] hover:bg-gradient-to-tr hover:from-[#f09433] hover:via-[#dc2743] hover:to-[#bc1888] hover:text-white transition-all shadow-sm"><Instagram size={20} /></a>
                    )}
                    {profile?.linkedin_url && (
                        <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white border border-slate-100 text-[#0077b5] hover:bg-[#0077b5] hover:text-white transition-all shadow-sm"><Linkedin size={20} /></a>
                    )}
                    {profile?.youtube_url && (
                        <a href={profile.youtube_url} target="_blank" rel="noopener noreferrer" className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white border border-slate-100 text-[#FF0000] hover:bg-[#FF0000] hover:text-white transition-all shadow-sm"><Youtube size={20} /></a>
                    )}
                </div>
            </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6">
        
        {/* PILL TABS */}
        <div className="flex justify-center mb-8">
            <div className="bg-white p-2 rounded-[1.5rem] shadow-sm inline-flex gap-2 border border-slate-200/60">
                <button onClick={() => setActiveTab('inventory')} className={`flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'inventory' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <LayoutGrid size={18} /> Inventory
                </button>
                <button onClick={() => setActiveTab('feed')} className={`flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'feed' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <Rss size={18} /> Updates Feed
                </button>
            </div>
        </div>

        {/* CONTENT AREA */}
        {activeTab === 'inventory' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Search & Filter Controls */}
                <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center mb-6 gap-4">
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight px-1 hidden md:block">Featured Catalog</h2>
                    
                    <div className="flex items-center gap-2 flex-1 md:flex-none">
                        <div className="relative flex-1 md:w-72">
                            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input 
                                type="text" 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search products..." 
                                className="w-full bg-white border border-slate-200/60 py-3.5 pl-11 pr-4 rounded-2xl shadow-sm text-sm text-slate-700 font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all" 
                            />
                        </div>

                        <button 
                            onClick={() => setShowFilters(!showFilters)} 
                            className={`px-5 py-3.5 rounded-2xl flex items-center gap-2 text-sm font-bold transition-all shadow-sm ${showFilters ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200/60'}`}
                        >
                            <Filter size={18} /> <span className="hidden sm:inline">Filters</span> {(selectedTypes.length > 0 || minPrice || maxPrice) && <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>}
                        </button>
                    </div>
                </div>

                {/* Filter Panel (Material You) */}
                {showFilters && (
                    <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-200/60 mb-8 animate-in slide-in-from-top-4 duration-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="flex flex-col sm:flex-row gap-4">
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Min Price (₹)</label>
                                    <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0" className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all" />
                                </div>
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Max Price (₹)</label>
                                    <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Any" className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Property Type</label>
                                <div className="flex gap-2 flex-wrap">
                                    {PROPERTY_TYPES.map(type => {
                                        const isSelected = selectedTypes.includes(type)
                                        return (
                                            <button key={type} onClick={() => toggleType(type)} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${isSelected ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'}`}>
                                                {type} {isSelected && <Check size={14} />}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                        {(minPrice || maxPrice || selectedTypes.length > 0) && (
                            <div className="mt-6 flex justify-end pt-4 border-t border-slate-100">
                                <button onClick={() => { setMinPrice(''); setMaxPrice(''); setSelectedTypes([]) }} className="text-sm font-bold text-red-500 hover:bg-red-50 px-5 py-2.5 rounded-xl transition-colors">Clear All Filters</button>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Properties Grid */}
                {filteredProperties.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-[3rem] shadow-sm border border-slate-200/60 border-dashed">
                        <div className="w-20 h-20 bg-slate-50 rounded-[1.5rem] flex items-center justify-center mx-auto mb-4">
                            <LayoutGrid size={32} className="text-slate-300" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-700">No properties found</h3>
                        <p className="text-slate-400 mt-2 font-medium">Try adjusting your filters to see more results.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
                        {filteredProperties.map((prop) => {
                            const renderType = prop.property_type === '2 BHK' ? '2 RK' : prop.property_type;
                            return (
                                <div 
                                    key={prop.id} 
                                    onClick={() => openModal(prop)}
                                    className="bg-white rounded-[2rem] p-3 shadow-sm hover:shadow-xl transition-all duration-300 group border border-slate-200/60 cursor-pointer flex flex-col h-full hover:-translate-y-1"
                                >
                                    <div className="relative h-64 w-full rounded-[1.5rem] overflow-hidden bg-slate-100 mb-4 shrink-0">
                                        <img src={prop.image_url} alt="Property" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                        
                                        {/* Floating Price */}
                                        {prop.price && (
                                            <div className="absolute top-4 left-4">
                                                <span className="px-4 py-2 rounded-xl text-sm font-black shadow-lg bg-white/95 text-slate-900 backdrop-blur-md">
                                                    {prop.price}
                                                </span>
                                            </div>
                                        )}
                                        
                                        {/* Floating Type */}
                                        {renderType && (
                                            <div className="absolute top-4 right-4">
                                                <span className="px-4 py-2 rounded-xl text-xs font-bold shadow-lg bg-black/70 text-white backdrop-blur-md">
                                                    {renderType}
                                                </span>
                                            </div>
                                        )}

                                        {prop.images && prop.images.length > 1 && (
                                            <div className="absolute bottom-4 right-4 bg-white/90 text-slate-900 px-3 py-1.5 rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 backdrop-blur-md">
                                                <ImageIcon size={14} /> +{prop.images.length - 1}
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="px-3 pb-3 flex-1 flex flex-col">
                                        <h3 className="text-xl font-black text-slate-900 tracking-tight leading-tight mb-2 line-clamp-1 group-hover:text-blue-600 transition-colors">{prop.title}</h3>
                                        <div className="flex items-start gap-2 text-slate-500 mb-6 flex-1">
                                            <MapPin size={16} className="mt-0.5 flex-shrink-0 text-blue-500" />
                                            <span className="text-sm font-medium line-clamp-2 leading-snug">{prop.address}</span>
                                        </div>
                                        
                                        <div className="flex gap-2 w-full pt-4 border-t border-slate-100 shrink-0">
                                            <button 
                                                onClick={(e) => handleWhatsApp(e, prop.title)} 
                                                className="flex-1 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366] hover:text-white py-3.5 rounded-[1.25rem] text-sm font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                            >
                                                <WhatsAppIcon size={18} /> Inquire
                                            </button>
                                            
                                            <button 
                                                onClick={(e) => handleShare(e, prop)}
                                                disabled={sharingId === prop.id}
                                                className="w-14 flex items-center justify-center bg-slate-50 text-slate-600 rounded-[1.25rem] hover:bg-slate-200 active:scale-[0.98] transition-all disabled:opacity-50 border border-slate-200/60"
                                                title="Share Details"
                                            >
                                                {sharingId === prop.id ? <Loader2 size={18} className="animate-spin text-blue-500" /> : <Share2 size={18} />}
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
                <h2 className="text-2xl font-black text-slate-800 tracking-tight px-2 mb-6 text-center md:text-left">Market Updates & Insights</h2>
                
                {posts.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-[3rem] shadow-sm border border-slate-200/60 border-dashed">
                        <div className="w-20 h-20 bg-slate-50 rounded-[1.5rem] flex items-center justify-center mx-auto mb-4">
                            <Rss size={32} className="text-slate-300" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-700">No updates yet</h3>
                        <p className="text-slate-400 mt-2 font-medium">Check back soon for the latest market insights.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                        {posts.map((post) => (
                            <div key={post.id} onClick={() => setSelectedPost(post)} className="bg-white p-4 rounded-[2rem] shadow-sm hover:shadow-xl cursor-pointer transition-all duration-300 group flex flex-col h-full border border-slate-200/60 hover:-translate-y-1">
                                {post.image_url && (
                                    <div className="h-56 w-full rounded-[1.5rem] overflow-hidden mb-5 bg-slate-100 relative shrink-0">
                                        <img src={post.image_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="Feed cover" />
                                        <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors"></div>
                                    </div>
                                )}
                                <div className="px-2 pb-2 flex-1 flex flex-col">
                                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2.5">{new Date(post.created_at).toLocaleDateString()}</p>
                                    <h3 className="text-xl font-black text-slate-900 leading-snug mb-3 line-clamp-2 group-hover:text-blue-600 transition-colors">{post.title}</h3>
                                    <p className="text-sm text-slate-500 font-medium line-clamp-3 leading-relaxed flex-1">{post.excerpt}</p>
                                    
                                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100 shrink-0">
                                        <div className="flex gap-2 overflow-hidden">
                                            {post.tags?.slice(0,2).map(tag => (
                                                <span key={tag} className="text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-500 px-3 py-1.5 rounded-lg whitespace-nowrap">#{tag}</span>
                                            ))}
                                        </div>
                                        <div className="w-10 h-10 rounded-[1rem] bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:border-blue-600 group-hover:text-white transition-all flex-shrink-0 shadow-sm">
                                            <ArrowUpRight size={18} />
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

      {/* 4. PRODUCT DETAILS MODAL (Responsive Bottom Sheet / Centered Card) */}
      {selectedProperty && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-300">
              <div 
                  className="bg-white w-full max-w-3xl rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
              >
                  {/* Modal Header */}
                  <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 bg-white/90 backdrop-blur-md sticky top-0 z-10 shrink-0">
                      <h2 className="text-lg font-bold text-slate-900 line-clamp-1 pr-4">{selectedProperty.title}</h2>
                      <button onClick={() => setSelectedProperty(null)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors shrink-0">
                          <X size={18} />
                      </button>
                  </div>

                  {/* Modal Scrollable Body */}
                  <div className="overflow-y-auto custom-scrollbar flex-1 pb-6">
                      
                      {/* Image Carousel */}
                      <div className="relative w-full aspect-square sm:aspect-video bg-slate-100 group">
                          {(() => {
                              const images = selectedProperty.images?.length > 0 ? selectedProperty.images : [selectedProperty.image_url];
                              return (
                                  <>
                                      <img src={images[currentImageIndex]} alt="Product view" className="w-full h-full object-cover" />
                                      
                                      {images.length > 1 && (
                                          <>
                                              {/* Image Counter */}
                                              <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-md text-white px-4 py-1.5 rounded-full text-xs font-bold tracking-widest shadow-sm border border-white/20">
                                                  {currentImageIndex + 1} / {images.length}
                                              </div>
                                              {/* Navigation Arrows */}
                                              <button onClick={handlePrevImage} className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/90 backdrop-blur-md p-3 rounded-full shadow-lg text-slate-800 hover:bg-white transition-all opacity-0 sm:opacity-100 sm:group-hover:opacity-100 active:scale-95 border border-white/40">
                                                  <ChevronLeft size={24} />
                                              </button>
                                              <button onClick={handleNextImage} className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/90 backdrop-blur-md p-3 rounded-full shadow-lg text-slate-800 hover:bg-white transition-all opacity-0 sm:opacity-100 sm:group-hover:opacity-100 active:scale-95 border border-white/40">
                                                  <ChevronRight size={24} />
                                              </button>
                                          </>
                                      )}
                                  </>
                              )
                          })()}
                      </div>

                      {/* Details Area */}
                      <div className="p-6 sm:p-10 space-y-6 max-w-2xl mx-auto w-full">
                          <div>
                              {selectedProperty.price && (
                                  <div className="inline-block bg-green-50 text-green-700 px-4 py-2 rounded-xl font-black text-xl mb-4 border border-green-200/60 shadow-sm">
                                      {selectedProperty.price}
                                  </div>
                              )}
                              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight mb-6 tracking-tight">
                                  {selectedProperty.title}
                              </h1>
                              
                              <p className="text-slate-600 text-base leading-relaxed whitespace-pre-line font-medium bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                                  {selectedProperty.description || "Contact us for more details about this product."}
                              </p>
                          </div>

                          {selectedProperty.address && (
                              <div className="flex items-center gap-4 bg-blue-50/50 p-5 rounded-[1.5rem] border border-blue-100">
                                  <div className="bg-white p-3 rounded-full shadow-sm">
                                      <MapPin className="text-blue-500 shrink-0" size={24} />
                                  </div>
                                  <span className="text-base font-bold text-slate-800">{selectedProperty.address}</span>
                              </div>
                          )}
                      </div>
                  </div>

                  {/* Sticky Footer CTA */}
                  <div className="p-5 sm:p-6 bg-white border-t border-slate-100 shrink-0 flex gap-3 sm:gap-4 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]">
                      <button 
                          onClick={handleCall}
                          className="flex-1 bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm sm:text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 transition-all active:scale-[0.98]"
                      >
                          <Phone size={20} fill="white" /> Call Now
                      </button>
                      <button 
                          onClick={(e) => handleWhatsApp(e, selectedProperty.title)}
                          className="flex-1 bg-[#25D366] hover:bg-[#1EBE57] text-white py-4 rounded-[1.5rem] text-sm sm:text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#25D366]/20 transition-all active:scale-[0.98]"
                      >
                          <WhatsAppIcon size={20} /> WhatsApp
                      </button>
                  </div>

              </div>
          </div>
      )}

      {/* FEED POST FULL-SCREEN MODAL */}
      {selectedPost && (
        <div className="fixed inset-0 z-[100] bg-[#F4F7FC] animate-in slide-in-from-bottom-full duration-300 overflow-y-auto">
            <div className="relative min-h-screen pb-20">
                {selectedPost.image_url && (
                    <div className="h-72 md:h-96 w-full relative">
                        <img src={selectedPost.image_url} className="w-full h-full object-cover" alt="Cover" />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-[#F4F7FC]" />
                    </div>
                )}
                
                <button onClick={() => setSelectedPost(null)} className="fixed top-6 right-6 md:top-10 md:right-10 bg-white/90 backdrop-blur-md text-slate-900 p-3.5 rounded-full hover:bg-white transition-all z-20 shadow-xl hover:scale-110">
                    <X size={24} />
                </button>
                
                <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10 -mt-20 md:-mt-32">
                    <div className="bg-white rounded-[2.5rem] md:rounded-[3rem] p-8 md:p-16 shadow-xl border border-slate-100">
                        <div className="flex gap-2 mb-6 flex-wrap">
                            {selectedPost.tags?.map(tag => (
                                <span key={tag} className="text-xs font-bold bg-blue-50 border border-blue-100 text-blue-600 px-4 py-1.5 rounded-lg uppercase tracking-wider">#{tag}</span>
                            ))}
                        </div>
                        
                        <h1 className="text-3xl md:text-5xl font-black text-slate-900 mb-8 leading-tight tracking-tight">{selectedPost.title}</h1>
                        
                        <div className="flex items-center gap-4 mb-10 pb-10 border-b border-slate-100">
                            {profile?.logo_url ? (
                                <img src={profile.logo_url} className="w-14 h-14 rounded-[1.25rem] object-cover shadow-sm border border-slate-100" alt="Author" />
                            ) : (
                                <div className="w-14 h-14 rounded-[1.25rem] bg-blue-50 border border-blue-100 flex items-center justify-center font-black text-xl text-blue-500">{profile?.business_name?.[0] || 'A'}</div>
                            )}
                            <div>
                                <p className="text-base font-extrabold text-slate-900">{profile?.business_name || 'Market Update'}</p>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">{new Date(selectedPost.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            </div>
                        </div>

                        <div className="prose prose-lg prose-slate max-w-none prose-headings:font-black prose-headings:tracking-tight prose-p:leading-relaxed prose-p:font-medium prose-a:text-blue-600 prose-img:rounded-[2rem] prose-img:shadow-sm">
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