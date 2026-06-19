'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, X, Loader2, Image as ImageIcon, Link as LinkIcon, Youtube, MessageSquare, Trash2, Send, Sparkles } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

type Post = {
  id: string
  title: string
  content: string
  image_url: string | null
  link_url: string | null
  youtube_url: string | null
  created_at: string
  status: string
}

export default function FeedManagementPage() {
  const supabase = createClient()
  const router = useRouter()
  
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null)

  // New Post Form State
  const [showAddModal, setShowAddModal] = useState(false)
  const [newPost, setNewPost] = useState({
    title: '',
    content: '',
    link_url: '',
    youtube_url: ''
  })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- UTILS ---
  const compressImage = (file: File, quality = 0.7, maxWidth = 1200): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = (maxWidth / width) * height;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Canvas to Blob conversion failed'));
            }
          }, 'image/jpeg', quality);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const fetchPosts = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase.from('profiles').select('role, agency_id').eq('id', user.id).single()
      
      if (profile?.role === 'agent') {
          router.push('/dashboard')
          return
      }
      
      // Impersonation Logic
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      let targetUserId = user.id

      if (impersonateId && (['super_admin', 'agency', 'admin'].includes(profile?.role || ''))) {
          if (profile?.role !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', profile?.agency_id || user.id)
                .single()
              if (subAccount) targetUserId = impersonateId
          } else {
              targetUserId = impersonateId
          }
      }

      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setPosts(data || [])
    } catch (error: any) {
      toast.error("Failed to load feed posts")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPosts()
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setSelectedFile(file)
      setPreview(URL.createObjectURL(file))
    }
  }

  const handleCreatePost = async () => {
    if (!newPost.title && !newPost.content) {
      toast.error("Please add a title or content to your post.")
      return
    }

    setIsSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const { data: profile } = await supabase.from('profiles').select('role, agency_id').eq('id', user.id).single()
      
      // Impersonation Logic
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      let targetUserId = user.id

      if (impersonateId && (['super_admin', 'agency', 'admin'].includes(profile?.role || ''))) {
          if (profile?.role !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', profile?.agency_id || user.id)
                .single()
              if (subAccount) targetUserId = impersonateId
          } else {
              targetUserId = impersonateId
          }
      }

      let image_url = null
      if (selectedFile) {
        const compressedFile = await compressImage(selectedFile)
        const fileExt = 'jpg'
        const fileName = `feed-${Date.now()}.${fileExt}`
        const renamedFile = new File([compressedFile], fileName, { type: compressedFile.type })
        image_url = await uploadToR2(renamedFile, 'assets')
      }

      const { data: postData, error } = await supabase.from('posts').insert({
        user_id: targetUserId,
        title: newPost.title || 'Update',
        content: newPost.content,
        image_url,
        link_url: newPost.link_url || null,
        youtube_url: newPost.youtube_url || null,
        status: 'published'
      }).select().single()

      if (error) throw error

      toast.success("Post published! Sending notifications...")
      
      // Trigger Push Notifications
      fetch('/api/feed/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: postData.id, ownerId: targetUserId })
      }).catch(err => console.error("Notification trigger failed", err))

      setShowAddModal(false)
      setNewPost({ title: '', content: '', link_url: '', youtube_url: '' })
      setSelectedFile(null)
      setPreview(null)
      fetchPosts()
    } catch (error: any) {
      toast.error("Failed to create post: " + error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeletePost = async (id: string) => {
    setIsDeletingId(id)
    try {
      const { error } = await supabase.from('posts').delete().eq('id', id)
      if (error) throw error
      setPosts(posts.filter(p => p.id !== id))
      toast.success("Post deleted")
    } catch (error: any) {
      toast.error("Failed to delete post")
    } finally {
      setIsDeletingId(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-32">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Landing Page Feed</h1>
          <p className="text-slate-500 font-medium">Post updates to your public catalog visitors.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-2xl shadow-lg shadow-blue-600/20 transition-all active:scale-95 flex items-center gap-2 font-bold"
        >
          <Plus size={20} strokeWidth={3} /> Post Update
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : posts.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-[1.75rem] xs:rounded-[2.5rem] border-2 border-dashed border-slate-200">
          <MessageSquare className="mx-auto text-slate-300 mb-4" size={48} />
          <p className="text-slate-500 font-bold">No posts yet. Start by sharing an update!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {posts.map(post => (
            <div key={post.id} className="bg-white p-6 rounded-[1.5rem] xs:rounded-[2rem] border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-6 relative group transition-all hover:shadow-md">
              {post.image_url && (
                <div className="w-full sm:w-48 h-48 rounded-2xl overflow-hidden shrink-0">
                  <img src={post.image_url} className="w-full h-full object-cover" alt="Post" />
                </div>
              )}
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-xl font-bold text-slate-900 leading-tight">{post.title}</h3>
                  <button 
                    onClick={() => handleDeletePost(post.id)}
                    disabled={isDeletingId === post.id}
                    className="text-slate-300 hover:text-red-500 transition-colors p-2"
                  >
                    {isDeletingId === post.id ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                  </button>
                </div>
                <p className="text-slate-600 font-medium mb-4 line-clamp-3 leading-relaxed">
                  {post.content}
                </p>
                <div className="flex gap-4">
                  {post.link_url && <div className="flex items-center gap-1.5 text-blue-600 text-xs font-bold bg-blue-50 px-3 py-1.5 rounded-lg"><LinkIcon size={14} /> Link Attached</div>}
                  {post.youtube_url && <div className="flex items-center gap-1.5 text-red-600 text-xs font-bold bg-red-50 px-3 py-1.5 rounded-lg"><Youtube size={14} /> Video Attached</div>}
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-4">
                  Published {new Date(post.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD POST MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-t-[1.75rem] xs:rounded-t-[2.5rem] sm:rounded-[3rem] p-8 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-slate-900">Share Update</h2>
              <button onClick={() => setShowAddModal(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              <div onClick={() => fileInputRef.current?.click()} className="w-full h-48 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-50/50 hover:border-blue-400 transition-all group overflow-hidden relative">
                {preview ? (
                  <img src={preview} className="w-full h-full object-cover" alt="Preview" />
                ) : (
                  <>
                    <ImageIcon size={32} className="text-slate-300 mb-2 group-hover:scale-110 group-hover:text-blue-500 transition-all" />
                    <span className="text-sm font-bold text-slate-400 group-hover:text-blue-600">Add Photo (Optional)</span>
                  </>
                )}
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Title</label>
                <input 
                  type="text" 
                  value={newPost.title}
                  onChange={(e) => setNewPost({...newPost, title: e.target.value})}
                  placeholder="Catchy headline..." 
                  className="w-full bg-slate-50 border border-slate-100 py-4 px-6 rounded-2xl text-sm font-bold text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 outline-none transition-all" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Caption</label>
                <textarea 
                  value={newPost.content}
                  onChange={(e) => setNewPost({...newPost, content: e.target.value})}
                  placeholder="What's happening?" 
                  rows={4}
                  className="w-full bg-slate-50 border border-slate-100 py-4 px-6 rounded-2xl text-sm font-medium text-slate-700 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 outline-none transition-all resize-none" 
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1 flex items-center gap-1.5"><LinkIcon size={12} /> Website Link</label>
                  <input 
                    type="url" 
                    value={newPost.link_url}
                    onChange={(e) => setNewPost({...newPost, link_url: e.target.value})}
                    placeholder="https://..." 
                    className="w-full bg-slate-50 border border-slate-100 py-3 px-4 rounded-xl text-xs font-bold text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 outline-none transition-all" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1 flex items-center gap-1.5"><Youtube size={12} /> YouTube Link</label>
                  <input 
                    type="url" 
                    value={newPost.youtube_url}
                    onChange={(e) => setNewPost({...newPost, youtube_url: e.target.value})}
                    placeholder="https://youtube.com/..." 
                    className="w-full bg-slate-50 border border-slate-100 py-3 px-4 rounded-xl text-xs font-bold text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 outline-none transition-all" 
                  />
                </div>
              </div>

              <button 
                onClick={handleCreatePost}
                disabled={isSubmitting}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-5 rounded-[2rem] text-sm font-bold shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <><Send size={18} /> Publish Update</>}
              </button>
              
              <p className="text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                <Sparkles size={12} className="text-amber-500" /> This will notify all your PWA subscribers
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
