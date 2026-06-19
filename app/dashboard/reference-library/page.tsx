'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Eye, 
  ImageIcon, 
  Loader2, 
  UploadCloud, 
  X, 
  CheckCircle,
  AlertTriangle,
  FileImage
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'
import { toast } from 'sonner'

type ReferenceCreative = {
  id: string
  category: 'premium' | 'high_converting'
  url: string
  created_at: string
}

// Client-side Canvas-based image compression
async function compressImage(file: File, maxWidth = 1000, maxHeight = 1000, quality = 0.8): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      resolve(file)
      return
    }

    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        // Calculate aspect ratio and clamp width/height
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width)
            width = maxWidth
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height)
            height = maxHeight
          }
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file) // Fallback to original
          return
        }

        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name
              const compressedFile = new File([blob], `${baseName}.jpg`, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              })
              resolve(compressedFile)
            } else {
              resolve(file)
            }
          },
          'image/jpeg',
          quality
        )
      }
      img.onerror = (err) => reject(err)
    }
    reader.onerror = (err) => reject(err)
  })
}

export default function ReferenceLibraryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  // State
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<string | null>(null)
  const [referenceCreatives, setReferenceCreatives] = useState<ReferenceCreative[]>([])
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  
  // Upload State
  const [uploadCategory, setUploadCategory] = useState<'premium' | 'high_converting'>('premium')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  
  // Filter state
  const [activeTab, setActiveTab] = useState<'all' | 'premium' | 'high_converting'>('all')
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. Verify Authentication & Role Guard
  useEffect(() => {
    let isMounted = true

    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) {
          router.push('/login')
          return
        }

        setUserId(session.user.id)

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, agency_id, parent_id')
          .eq('id', session.user.id)
          .single()

        if (!isMounted) return

        const userRole = profile?.role || 'agent'
        setRole(userRole)

        // Resolve Target User ID (exactly like profile page)
        let tUserId = session.user.id
        if (['admin', 'agent'].includes(userRole) && (profile?.agency_id || profile?.parent_id)) {
          tUserId = (profile?.agency_id || profile?.parent_id) as string
        }

        if (impersonateId && (['super_admin', 'agency', 'admin', 'agent'].includes(userRole))) {
          if (userRole !== 'super_admin') {
            const { data: subAccount } = await supabase
              .from('profiles')
              .select('id')
              .eq('id', impersonateId)
              .eq('agency_id', profile?.agency_id || session.user.id)
              .single()
            if (subAccount) tUserId = impersonateId
          } else {
            tUserId = impersonateId
          }
        }
        setTargetUserId(tUserId)

        // Fetch references
        let query = supabase
          .from('reference_creatives')
          .select('*')
          .order('created_at', { ascending: false })

        if (userRole === 'super_admin' && !impersonateId) {
          query = query.is('user_id', null)
        } else {
          query = query.eq('user_id', tUserId)
        }

        const { data: refs, error } = await query
        if (!isMounted) return

        if (!error && refs) {
          setReferenceCreatives(refs as ReferenceCreative[])
        }
      } catch (err) {
        console.error('Auth verification failed:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    checkAuth()

    return () => {
      isMounted = false
    }
  }, [supabase, router])

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files)
    setSelectedFiles(prev => [...prev, ...files])
    
    const newPreviews = files.map(file => URL.createObjectURL(file))
    setPreviews(prev => [...prev, ...newPreviews])
  }

  // Remove a file from selections
  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    setPreviews(prev => {
      URL.revokeObjectURL(prev[index])
      return prev.filter((_, i) => i !== index)
    })
  }

  // Batch sequentially upload reference creatives with browser compression
  const handleUploadAll = async () => {
    if (selectedFiles.length === 0) return
    setIsUploading(true)
    let successCount = 0

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const originalFile = selectedFiles[i]
        
        // 1. Compress
        setUploadProgress(`Compressing image ${i + 1} of ${selectedFiles.length}...`)
        const compressedFile = await compressImage(originalFile)

        // 2. Upload to Cloudflare R2
        setUploadProgress(`Uploading ${i + 1} of ${selectedFiles.length}...`)
        const publicUrl = await uploadToR2(compressedFile, 'reference-creatives')

        // 3. Save to database
        const insertPayload: any = { category: uploadCategory, url: publicUrl }
        if (role === 'super_admin' && !impersonateId) {
          insertPayload.user_id = null
        } else {
          insertPayload.user_id = targetUserId || userId
        }

        const { data, error } = await supabase
          .from('reference_creatives')
          .insert(insertPayload)
          .select()
          .single()

        if (error) throw error

        if (data) {
          setReferenceCreatives(prev => [data as ReferenceCreative, ...prev])
          successCount++
        }
      }

      toast.success(`Successfully uploaded ${successCount} references!`)
      setSelectedFiles([])
      // Clear object URLs to prevent memory leaks
      previews.forEach(url => URL.revokeObjectURL(url))
      setPreviews([])
    } catch (error: any) {
      console.error('Upload process failed:', error)
      toast.error(`Upload failed: ${error.message || 'Unknown error'}`)
    } finally {
      setIsUploading(false)
      setUploadProgress('')
    }
  }

  // Delete reference creative
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this reference creative?')) return
    try {
      const { error } = await supabase
        .from('reference_creatives')
        .delete()
        .eq('id', id)

      if (error) throw error

      toast.success('Reference creative deleted!')
      setReferenceCreatives(prev => prev.filter(item => item.id !== id))
    } catch (error: any) {
      console.error('Delete failed:', error)
      toast.error(`Delete failed: ${error.message}`)
    }
  }

  // Previews cleanup on unmount
  useEffect(() => {
    return () => {
      previews.forEach(url => URL.revokeObjectURL(url))
    }
  }, [previews])

  // Loader View
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex flex-col items-center justify-center p-4">
        <Loader2 className="animate-spin text-purple-600 w-10 h-10 mb-4" />
        <p className="text-slate-500 font-bold text-sm">Verifying access controls...</p>
      </div>
    )
  }



  // Categorize counts
  const premiumCount = referenceCreatives.filter(c => c.category === 'premium').length
  const highConvertingCount = referenceCreatives.filter(c => c.category === 'high_converting').length
  const totalCount = referenceCreatives.length

  // Filter grid list
  const filteredCreatives = referenceCreatives.filter(item => {
    if (activeTab === 'all') return true
    return item.category === activeTab
  })

  return (
    <div className="min-h-screen bg-slate-50/50 pb-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* Back Link */}
        <button 
          onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors text-xs font-bold mb-6 bg-white py-2 px-4 rounded-full border border-slate-200/60 shadow-sm group active:scale-95 duration-200"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" /> 
          Back to Profile
        </button>

        {/* Header Title */}
        <div className="mb-10">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Reference Library
            </h1>
            {role === 'super_admin' && !impersonateId ? (
              <span className="bg-purple-100 text-purple-700 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">
                Super Admin Mode
              </span>
            ) : (
              <span className="bg-blue-100 text-blue-700 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">
                Personal Library
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 font-medium mt-1.5 leading-relaxed">
            {role === 'super_admin' && !impersonateId 
              ? "Relocated global design guidelines repository. Select multiple file references, automatically compress them client-side to keep hosting efficient, and publish."
              : "Manage your personal reference creatives. Select multiple reference images to compress and upload to your personal design library."
            }
          </p>
        </div>

        {/* Dashboard Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Uploader Left Panel (takes 4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm p-6 sm:p-7 space-y-6">
              
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Upload References</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Upload new style coordinates in bulk.</p>
              </div>

              {/* Strategy Select */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-0.5">Strategy Category</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-2xl text-xs font-bold outline-none cursor-pointer text-slate-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 transition-all"
                >
                  <option value="premium">💎 Premium (High-End Luxury renders/glows)</option>
                  <option value="high_converting">🎯 High Converting (Barebones organic snapshot)</option>
                </select>
              </div>

              {/* Drag Drop Box */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-0.5">Reference Images</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-purple-500 bg-slate-50/50 hover:bg-purple-50/10 rounded-2xl p-6 text-center cursor-pointer transition-all duration-300 group flex flex-col items-center justify-center space-y-2.5"
                >
                  <UploadCloud size={32} className="text-slate-400 group-hover:text-purple-600 group-hover:scale-105 transition-all" />
                  <div>
                    <span className="text-xs font-bold text-purple-600 block group-hover:underline">Select multiple images</span>
                    <span className="text-[9px] font-bold text-slate-400 mt-1 block">Supports JPG, PNG, WebP</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Selection Previews */}
              {selectedFiles.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Queue ({selectedFiles.length})</span>
                    <button 
                      onClick={() => { setSelectedFiles([]); previews.forEach(url => URL.revokeObjectURL(url)); setPreviews([]) }}
                      className="text-[9px] font-black text-red-500 hover:text-red-700 tracking-wider uppercase"
                    >
                      Clear All
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                    {previews.map((preview, index) => (
                      <div key={index} className="aspect-square rounded-xl overflow-hidden border border-slate-200 relative bg-slate-50 group">
                        <img src={preview} alt="Upload queue" className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeFile(index)}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black text-white p-1 rounded-full shadow transition-all duration-200"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="bg-purple-50 rounded-2xl p-3 border border-purple-100 flex gap-2.5 items-start">
                    <CheckCircle className="text-purple-600 shrink-0 mt-0.5" size={14} />
                    <p className="text-[10px] text-purple-800 font-medium leading-relaxed">
                      Files will be resized dynamically to max 1000px and converted to compressed JPEGs (80% quality) in your browser to save storage costs.
                    </p>
                  </div>

                  {/* Submit Button */}
                  <button
                    onClick={handleUploadAll}
                    disabled={isUploading}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-3 px-5 rounded-full transition-all shadow-md shadow-purple-500/15 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>{uploadProgress || 'Uploading...'}</span>
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        <span>Upload {selectedFiles.length} References</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Grid Right Panel (takes 8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm overflow-hidden">
              
              {/* Category Filter Tabs */}
              <div className="border-b border-slate-200/60 px-6 sm:px-8 bg-slate-50/50">
                <div className="flex gap-2 overflow-x-auto scrollbar-hide py-3">
                  {[
                    { id: 'all', label: 'All strategy references', count: totalCount },
                    { id: 'premium', label: 'Premium Strategy', count: premiumCount },
                    { id: 'high_converting', label: 'High Converting', count: highConvertingCount }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold tracking-tight transition-all duration-200 flex items-center gap-2 active:scale-95 ${
                        activeTab === tab.id
                          ? 'bg-slate-900 text-white shadow-md'
                          : 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                        activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid content */}
              <div className="p-6 sm:p-8">
                {filteredCreatives.length === 0 ? (
                  <div className="text-center py-24 flex flex-col items-center justify-center space-y-4">
                    <div className="bg-slate-50 text-slate-400 w-16 h-16 rounded-full flex items-center justify-center shadow-inner">
                      <ImageIcon size={26} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm">No references found</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-[280px] mx-auto leading-relaxed">
                        No reference creatives have been loaded for this strategy aesthetic category yet.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {filteredCreatives.map((item) => (
                      <div 
                        key={item.id} 
                        className="group aspect-square rounded-2xl overflow-hidden border border-slate-200/80 bg-slate-50 relative hover:shadow-lg transition-all duration-300 ease-out"
                      >
                        <img 
                          src={item.url} 
                          alt={`Reference ${item.category}`} 
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                        
                        {/* Overlay info / Category badge */}
                        <div className="absolute top-2 left-2 z-10">
                          <span className="bg-black/60 backdrop-blur-md text-white text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md">
                            {item.category.replace('_', ' ')}
                          </span>
                        </div>

                        {/* Hover Overlay Actions */}
                        <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 z-20">
                          <button 
                            onClick={() => window.open(item.url, '_blank')} 
                            className="bg-white hover:bg-slate-100 text-slate-800 p-2.5 rounded-xl shadow-lg transition-all active:scale-90"
                            title="View Full Resolution"
                          >
                            <Eye size={14} />
                          </button>
                          <button 
                            onClick={() => handleDelete(item.id)} 
                            className="bg-red-600 hover:bg-red-700 text-white p-2.5 rounded-xl shadow-lg transition-all active:scale-90"
                            title="Delete Reference"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
