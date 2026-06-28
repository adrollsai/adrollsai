'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Layout, Sparkles, X, Check, Upload, Package, Smartphone, Square, RectangleVertical, ChevronDown, User, RefreshCw, Zap, Plus, CheckCircle, Image as ImageIcon, Video as VideoIcon, Clock, Trash2, Globe, Languages, Mic, AlertCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

// --- TYPES ---
type Message = {
  id: number
  role: 'user' | 'ai'
  text: string
  mediaUrl?: string
  mediaType?: 'image' | 'video'
  steps?: string[]
  concepts?: any[]
  script?: any
  refImages?: string[]
  imageDescriptions?: string[]
  prompts?: string[]
  isError?: boolean
  failedConcept?: any
}

type Property = { 
  id: string, 
  title: string, 
  address: string, 
  price: string,
  images: string[], 
  image_url: string,
  description?: string 
}

type Profile = {
  id: string
  business_name: string
  contact_number: string
  logo_url: string
  brand_color: string
  mission_statement: string
  character_url?: string
  character_audio_url?: string
  avatar_url?: string
  avatar_description?: string
  avatar_audio_url?: string
}


// --- TEMPLATES LIBRARY ---
const TEMPLATES: { id: string, name: string, url: string }[] = []

const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1', icon: Square },
  { label: '4:5', value: '4:5', icon: RectangleVertical },
  { label: '9:16', value: '9:16', icon: Smartphone }
]

const ALLOWED_VIDEO_USERS = [
  'bc63c065-9bcc-4793-bedc-f0960406425b',
  '2f62a259-f23b-48ee-a920-c436f36eaa4b',
  '29937131-1975-4c5f-9b78-e5b28f918d32' // The ProEstate
]

const renderVisualsWithBadges = (visualsText: string) => {
  if (!visualsText) return "";
  const parts = visualsText.split(/(@Image \d)/g);
  return parts.map((part, index) => {
    if (part.match(/@Image \d/)) {
      const imgNum = part.split(' ')[1];
      return (
        <span key={index} className="inline-flex items-center gap-0.5 bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded text-[10px] font-extrabold mx-0.5">
          <ImageIcon size={10} className="w-2.5 h-2.5" /> Image {imgNum}
        </span>
      );
    }
    return part;
  });
};

export default function CreationPage() {
  const router = useRouter()
  const supabase = createClient()
  
  // Data State
  const [properties, setProperties] = useState<Property[]>([])
  const [isLoadingProperties, setIsLoadingProperties] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [selectedPropId, setSelectedPropId] = useState<string>('')
  
  // Chat State
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [currentStep, setCurrentStep] = useState<string>('') 
  const [chatAttachments, setChatAttachments] = useState<string[]>([])
  const [excludedImages, setExcludedImages] = useState<string[]>([])
  const [isUploadingChat, setIsUploadingChat] = useState(false)
  const chatFileInputRef = useRef<HTMLInputElement>(null)

  const [localRefImages, setLocalRefImages] = useState<string[]>([])
  const [isUploadingLocalRef, setIsUploadingLocalRef] = useState(false)
  const localRefFileInputRef = useRef<HTMLInputElement>(null)

  const handleLocalRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    
    setIsUploadingLocalRef(true)
    try {
      const uploadPromises = Array.from(files).map(file => uploadToR2(file, 'product-references'))
      const urls = await Promise.all(uploadPromises)
      setLocalRefImages(prev => [...prev, ...urls].slice(0, 2))
      toast.success("Product reference image uploaded! 📸")
    } catch (error) {
      console.error("Local reference upload failed:", error)
      toast.error("Failed to upload reference image.")
    } finally {
      setIsUploadingLocalRef(false)
      if (localRefFileInputRef.current) localRefFileInputRef.current.value = ''
    }
  }

  const handleChatFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    
    setIsUploadingChat(true)
    try {
      const uploadPromises = Array.from(files).map(file => uploadToR2(file, 'chat-attachments'))
      const urls = await Promise.all(uploadPromises)
      setChatAttachments(prev => [...prev, ...urls])
    } catch (error) {
      console.error("Chat upload failed:", error)
      toast.error("Failed to upload image.")
    } finally {
      setIsUploadingChat(false)
      if (chatFileInputRef.current) chatFileInputRef.current.value = ''
    }
  }

  
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: 'ai', text: 'Ready to design! Select a product or just type an idea. You can also upload a reference style.' }
  ])
  
  // Configuration State
  const [selectedRatio, setSelectedRatio] = useState('4:5')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<'google/nano-banana-2' | 'gpt/gpt-image-2-text-to-image'>('gpt/gpt-image-2-text-to-image')
  const [creativeCategory, setCreativeCategory] = useState('Premium')
  
  // Custom Reference State
  const [uploadedRefUrl, setUploadedRefUrl] = useState<string | null>(null)
  const [isUploadingRef, setIsUploadingRef] = useState(false)
  const refFileInputRef = useRef<HTMLInputElement>(null)
  
  // Reference Library State
  const [userReferences, setUserReferences] = useState<any[]>([])
  const [selectedUserRefId, setSelectedUserRefId] = useState<string | null>(null)
  
  // NEW: Creation Mode Toggle
  const [creationMode, setCreationMode] = useState<'image' | 'video'>('image')
  
  // Presenter settings mode: 'video' (reference video), 'avatar' (avatar photo), or 'none'
  const [presenterMode, setPresenterMode] = useState<'video' | 'avatar' | 'none'>('none')
  const [isPresenterModalOpen, setIsPresenterModalOpen] = useState(false)
  const [videoInstructions, setVideoInstructions] = useState('')
  const [useUploadedAudio, setUseUploadedAudio] = useState(true)

  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [uploadingAvatarAudio, setUploadingAvatarAudio] = useState(false)

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const avatarAudioInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0]
      if (!file || !targetUserId) return
      if (file.size > 15 * 1024 * 1024) {
        toast.error("Avatar image size exceeds 15MB limit.")
        return
      }
      setUploadingAvatar(true)
      const fileExt = file.name.split('.').pop()
      const fileName = `avatar-${targetUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })
      const publicUrl = await uploadToR2(renamedFile, 'logos')

      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          updates: { avatar_url: publicUrl }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)

      setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : null)
      setPresenterMode('avatar')
      toast.success("Avatar photo uploaded and analyzed successfully!")
    } catch (err: any) {
      console.error(err)
      toast.error("Failed to upload avatar photo.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0]
      if (!file || !targetUserId) return
      if (file.size > 50 * 1024 * 1024) {
        toast.error("Video size exceeds 50MB limit.")
        return
      }
      setUploadingVideo(true)
      const fileExt = file.name.split('.').pop()
      const fileName = `character-${targetUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })
      const publicUrl = await uploadToR2(renamedFile, 'logos')

      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          updates: { character_url: publicUrl }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)

      const updatedProfile = resData.profile || { ...profile, character_url: resData.profile?.character_url || publicUrl, character_audio_url: resData.profile?.character_audio_url }
      setProfile(prev => prev ? { ...prev, ...updatedProfile } : null)
      setPresenterMode('video')
      toast.success("Reference video uploaded and automatically trimmed/normalized successfully!")
    } catch (err: any) {
      console.error(err)
      toast.error("Failed to upload reference video.")
    } finally {
      setUploadingVideo(false)
    }
  }

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0]
      if (!file || !targetUserId) return
      if (file.size > 15 * 1024 * 1024) {
        toast.error("Audio size exceeds 15MB limit.")
        return
      }
      setUploadingAudio(true)
      const fileExt = file.name.split('.').pop()
      const fileName = `voice-sample-${targetUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })
      const publicUrl = await uploadToR2(renamedFile, 'logos')

      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          updates: { character_audio_url: publicUrl }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)

      setProfile(prev => prev ? { ...prev, character_audio_url: publicUrl } : null)
      toast.success("Voice audio sample uploaded successfully!")
    } catch (err: any) {
      console.error(err)
      toast.error("Failed to upload voice audio sample.")
    } finally {
      setUploadingAudio(false)
    }
  }

  const handleAvatarAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0]
      if (!file || !targetUserId) return
      if (file.size > 15 * 1024 * 1024) {
        toast.error("Audio size exceeds 15MB limit.")
        return
      }
      setUploadingAvatarAudio(true)
      const fileExt = file.name.split('.').pop()
      const fileName = `avatar-voice-sample-${targetUserId}-${Date.now()}.${fileExt}`
      const renamedFile = new File([file], fileName, { type: file.type })
      const publicUrl = await uploadToR2(renamedFile, 'logos')

      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          updates: { avatar_audio_url: publicUrl }
        })
      })
      const resData = await res.json()
      if (resData.error) throw new Error(resData.error)

      setProfile(prev => prev ? { ...prev, avatar_audio_url: publicUrl } : null)
      toast.success("Avatar voice audio sample uploaded successfully!")
    } catch (err: any) {
      console.error(err)
      toast.error("Failed to upload avatar voice audio sample.")
    } finally {
      setUploadingAvatarAudio(false)
    }
  }

  // Dynamic Video Duration State (15s, 30s, 45s, 60s)
  const [selectedDuration, setSelectedDuration] = useState<15 | 30 | 45 | 60>(15)

  // Language Toggle for Video (Hinglish = Devanagari-English mix, English = pure English)
  const [videoLanguage, setVideoLanguage] = useState<'hinglish' | 'english'>('hinglish')

  // Deselected catalog images state
  const [deselectedCatalogImages, setDeselectedCatalogImages] = useState<string[]>([])
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 1. SAFE FETCH WITH LOCAL CACHING
  const fetchProperties = async (force = false) => {
    try {
      if (!force && properties.length === 0) setIsLoadingProperties(true)
      if (force) setIsRefreshing(true)

      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) return

      setUserId(user.id)

      // 1. Resolve Target User ID (Impersonation check first)
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      
      // Fetch CURRENT user profile to check role
      const { data: currentUserProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single()
      const currentRole = currentUserProfile?.role || 'admin'
      setCurrentUserRole(currentRole)
      
      if (currentRole === 'agent') {
          router.push('/dashboard')
          return
      }
      
      let tUserId = user.id
      if (['admin', 'agent'].includes(currentRole as string) && (currentUserProfile?.parent_id || currentUserProfile?.agency_id)) {
          tUserId = (currentUserProfile?.parent_id || currentUserProfile?.agency_id) as string
      }

      if (impersonateId && (['super_admin', 'agency', 'admin', 'agent'].includes(currentRole))) {
          if (currentRole !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', user.id)
                .single()
              if (subAccount) tUserId = impersonateId
          } else {
              tUserId = impersonateId
          }
      }
      setTargetUserId(tUserId)

      // 2. Fetch TARGET Profile (If impersonating, we need the client's logo & branding)
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', tUserId).single()
      if (profileData) {
          setProfile(profileData)
          if (profileData.character_url && profileData.avatar_url) {
              setPresenterMode('video')
          } else if (profileData.character_url) {
              setPresenterMode('video')
          } else if (profileData.avatar_url) {
              setPresenterMode('avatar')
          } else {
              setPresenterMode('none')
          }
      }

      const { data, error: dbError } = await supabase
        .from('properties')
        .select('id, title, address, price, images, image_url, description, created_at')
        .eq('user_id', tUserId)
        .order('created_at', { ascending: false })

      if (dbError) throw new Error(dbError.message)
      
      if (data) {
          setProperties(data)
      }

      // Fetch User's Reference Library creatives
      const { data: userRefs, error: refsError } = await supabase
        .from('reference_creatives')
        .select('id, category, url')
        .eq('user_id', tUserId)
        .order('created_at', { ascending: false })
      if (!refsError && userRefs) {
        setUserReferences(userRefs)
      }

    } catch (error: any) {
      console.error("Fetch Error:", error.message)
      toast.error("Failed to load catalog.")
    } finally {
      setIsLoadingProperties(false)
      setIsRefreshing(false)
    }
  }

  // --- BATCH CREATIVE WORKFLOW LOGIC ---
  const [creativeFlow, setCreativeFlow] = useState<{
    isOpen: boolean,
    step: 'setup' | 'angles' | 'rendering' | 'final',
    product: Property | null,
    instructions: string,
    quantity: number,
    isOrganic: boolean,
    creativeCategory: string,
    angles: any[],
    selectedAngles: number[],
    generatedAssets: any[],
    status: 'idle' | 'loading' | 'error'
  }>({
    isOpen: false,
    step: 'setup',
    product: null,
    instructions: '',
    quantity: 5,
    isOrganic: false,
    creativeCategory: 'Premium',
    angles: [],
    selectedAngles: [],
    generatedAssets: [],
    status: 'idle'
  })

  const handleGenerateAngles = async () => {
    if (!creativeFlow.product) return;
    setCreativeFlow(prev => ({ ...prev, status: 'loading' }));
    try {
      const strategyRes = await fetch('/api/agent/strategy', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              product: creativeFlow.product,
              quantity: creativeFlow.quantity,
              instructions: creativeFlow.instructions,
              previousAngles: (creativeFlow.angles || []).map((a: any) => a.title).join(', '),
              creativeCategory: creativeFlow.creativeCategory || 'Premium'
          })
      });
      const strategyData = await strategyRes.json();
      setCreativeFlow(prev => ({ 
          ...prev, 
          step: 'angles', 
          angles: [...prev.angles, ...(strategyData.angles || [])],
          status: 'idle' 
      }));
    } catch (e) {
      setCreativeFlow(prev => ({ ...prev, status: 'error' }));
    }
  }

  const handleStartBatchRendering = async () => {
    setCreativeFlow(prev => ({ ...prev, step: 'rendering', status: 'loading' }));
    const selected = creativeFlow.angles.filter((_, i) => creativeFlow.selectedAngles.includes(i));
    const batchId = crypto.randomUUID();
    
    // Batch process
    const results: any[] = [];
    for (const angle of selected) {
        try {
            let propImages: string[] = [];
            if (creativeFlow.product) {
                if (creativeFlow.product.images && creativeFlow.product.images.length > 0) {
                    propImages = creativeFlow.product.images.slice(0, 10);
                } else if (creativeFlow.product.image_url) {
                    propImages = [creativeFlow.product.image_url];
                }
            }

            const payload = {
                propertyTitle: creativeFlow.product?.title,
                propertyDescription: creativeFlow.product?.description || "",
                creativeCategory: creativeFlow.creativeCategory || 'Premium',
                styleAesthetic: angle.title ? `${angle.title} - ${angle.visual_concept}` : undefined,
                userInstructions: creativeFlow.instructions + (angle.visual_concept ? `\nVisual Concept to follow: ${angle.visual_concept}` : ""),
                propImages: propImages,
                isOrganic: creativeFlow.isOrganic || angle.title?.toLowerCase().includes('raw') || angle.title?.toLowerCase().includes('smartphone') || creativeFlow.creativeCategory === 'High Converting',
                aspectRatio: "4:5",
                model: 'image-2.0',
                contactNumber: profile?.contact_number,
                logoUrl: profile?.logo_url,
                excludedImages: excludedImages
            };

            const res = await fetch(`/api/chat${window.location.search}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if (data.taskId) {
                // Trigger Background Worker to save to DB
                fetch('/api/background-worker', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: targetUserId || userId,
                        propId: creativeFlow.product?.id,
                        propertyTitle: creativeFlow.product?.title,
                        existingTaskId: data.taskId,
                        existingCaption: data.caption,
                        batchId: batchId
                    })
                }).catch(err => console.error("Worker trigger failed:", err));
                
                results.push({ ...angle, taskId: data.taskId });
            } else if (data.error) {
                console.error("Batch error for angle:", angle.title, data.error);
                toast.error(`Failed to generate "${angle.title}": ${data.error}`);
            }
        } catch (e: any) {
            console.error("Batch error for angle:", angle.title, e);
            toast.error(`Error generating "${angle.title}": ${e.message || e}`);
        }
    }
    setCreativeFlow(prev => ({ ...prev, generatedAssets: results, status: 'idle', step: 'final' }));
  }

  // Trigger fetch on mount
  useEffect(() => {
    fetchProperties()
  }, [supabase])

  // 2. Prevent Accidental Navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (isThinking) {
            e.preventDefault();
            e.returnValue = ''; 
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isThinking]);

  useEffect(() => { 
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) 
  }, [messages, isThinking, currentStep])

  // Helper: Handle Reference Upload
  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setIsUploadingRef(true);
    try {
        const file = e.target.files[0];
        const fileExt = file.name.split('.').pop();
        const newFileName = `reference-${Date.now()}.${fileExt}`;
        const renamedFile = new File([file], newFileName, { type: file.type });

        const publicUrl = await uploadToR2(renamedFile, 'references');
        setUploadedRefUrl(publicUrl);
        setSelectedTemplate(null); 
        setSelectedUserRefId(null);
    } catch (error: any) {
        alert("Upload failed: " + error.message);
    } finally {
        setIsUploadingRef(false);
    }
  }

  // --- CLIENT INTERACTIVE VIDEO HANDLERS ---
  // --- CLIENT INTERACTIVE VIDEO HANDLERS ---
  const handleSelectConcept = async (concept: any, refImages: string[], imageDescriptions?: string[], msgIdToReplace?: number) => {
    if (isThinking) return
    setIsThinking(true)
    setCurrentStep(`AI Creative Director is writing your ${selectedDuration}s ${videoLanguage === 'hinglish' ? 'Hinglish' : 'English'} script...`)

    const activeMsgId = msgIdToReplace || Date.now()

    try {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        const scriptResponse = await fetch(`/api/video/script${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyId: selectedPropId || null,
                concept,
                userInstructions: videoInstructions,
                images: refImages,
                imageDescriptions,
                presenterType: presenterMode,
                duration: selectedDuration,
                language: videoLanguage
            })
        });

        const scriptData = await scriptResponse.json();
        if (scriptData.error) throw new Error(scriptData.error);

        // Fetch prompts immediately to bypass "Review Final Prompts" step
        setCurrentStep('AI Creative Director is generating physical scenes prompts for review...')
        let prompts = []
        try {
            const promptResponse = await fetch(`/api/video/generate${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propertyId: selectedPropId || null,
                    script: {
                        title: scriptData.title,
                        dialogue: scriptData.dialogue,
                        visuals: scriptData.visuals,
                        scenes: scriptData.scenes,
                        finalCaption: scriptData.finalCaption,
                        concept
                    },
                    images: scriptData.refImages || refImages,
                    imageDescriptions: scriptData.imageDescriptions || imageDescriptions,
                    presenterType: presenterMode,
                    customInstructions: `${videoInstructions ? `${videoInstructions}\n\n` : ''}${concept.description || concept.visualConcept || ''}`.trim(),
                    preview: true,
                    language: videoLanguage,
                    useUploadedAudio
                })
            });
            const promptData = await promptResponse.json();
            if (promptData.prompts) {
                prompts = promptData.prompts;
            }
        } catch (promptErr: any) {
            console.error("Failed to generate preview prompts automatically:", promptErr);
        }

        const aiMsg: Message = {
            id: activeMsgId,
            role: 'ai',
            text: `Here is the drafted script and generated prompts for **${scriptData.title}**! 🎬\n\nReview the dialogue, visuals, final caption, and customize the prompts below.`,
            script: {
                title: scriptData.title,
                dialogue: scriptData.dialogue,
                visuals: scriptData.visuals,
                scenes: scriptData.scenes,
                finalCaption: scriptData.finalCaption,
                concept
            },
            refImages: scriptData.refImages || refImages,
            imageDescriptions: scriptData.imageDescriptions || imageDescriptions,
            prompts: prompts.length > 0 ? prompts : undefined
        };

        if (msgIdToReplace) {
            setMessages(prev => prev.map(m => m.id === msgIdToReplace ? aiMsg : m));
        } else {
            setMessages(prev => [...prev, aiMsg]);
        }
    } catch (error: any) {
        toast.error("Failed to generate script: " + error.message);
        const errorMsg: Message = { 
            id: activeMsgId, 
            role: 'ai', 
            text: "Error: " + error.message,
            isError: true,
            failedConcept: concept,
            refImages,
            imageDescriptions
        };
        if (msgIdToReplace) {
            setMessages(prev => prev.map(m => m.id === msgIdToReplace ? errorMsg : m));
        } else {
            setMessages(prev => [...prev, errorMsg]);
        }
    } finally {
        setIsThinking(false)
        setCurrentStep('')
    }
  }

  const handleGenerateScriptVariation = async (concept: any, refImages: string[], messageId: number, imageDescriptions?: string[]) => {
    if (isThinking) return
    setIsThinking(true)
    setCurrentStep('Re-scripting and generating a new variation...')

    try {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        const scriptResponse = await fetch(`/api/video/script${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyId: selectedPropId || null,
                concept,
                userInstructions: videoInstructions,
                images: refImages,
                imageDescriptions,
                variation: true,
                presenterType: presenterMode,
                duration: selectedDuration,
                language: videoLanguage
            })
        });

        const scriptData = await scriptResponse.json();
        if (scriptData.error) throw new Error(scriptData.error);

        // Fetch prompts immediately to bypass "Review Final Prompts" step
        setCurrentStep('AI Creative Director is generating physical scenes prompts for review...')
        let prompts = []
        try {
            const promptResponse = await fetch(`/api/video/generate${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propertyId: selectedPropId || null,
                    script: {
                        title: scriptData.title,
                        dialogue: scriptData.dialogue,
                        visuals: scriptData.visuals,
                        scenes: scriptData.scenes,
                        finalCaption: scriptData.finalCaption,
                        concept
                    },
                    images: scriptData.refImages || refImages,
                    imageDescriptions: scriptData.imageDescriptions || imageDescriptions,
                    presenterType: presenterMode,
                    customInstructions: `${videoInstructions ? `${videoInstructions}\n\n` : ''}${concept.description || concept.visualConcept || ''}`.trim(),
                    preview: true,
                    language: videoLanguage,
                    useUploadedAudio
                })
            });
            const promptData = await promptResponse.json();
            if (promptData.prompts) {
                prompts = promptData.prompts;
            }
        } catch (promptErr: any) {
            console.error("Failed to generate preview prompts automatically:", promptErr);
        }

        setMessages(prev => prev.map(m => {
            if (m.id === messageId) {
                return {
                    ...m,
                    text: `Here is a fresh variation and generated prompts for **${scriptData.title}**! 🎬\n\nReview the dialogue, visuals, final caption, and customize the prompts below.`,
                    isError: false,
                    failedConcept: undefined,
                    script: {
                        title: scriptData.title,
                        dialogue: scriptData.dialogue,
                        visuals: scriptData.visuals,
                        scenes: scriptData.scenes,
                        finalCaption: scriptData.finalCaption,
                        concept
                    },
                    refImages: scriptData.refImages || refImages,
                    imageDescriptions: scriptData.imageDescriptions || imageDescriptions,
                    prompts: prompts.length > 0 ? prompts : undefined
                }
            }
            return m
        }))
        toast.success("Script variation and prompts generated! ✨");
    } catch (error: any) {
        toast.error("Failed to generate variation: " + error.message);
        const errorMsg: Message = {
            id: messageId,
            role: 'ai',
            text: "Error: " + error.message,
            isError: true,
            failedConcept: concept,
            refImages,
            imageDescriptions
        };
        setMessages(prev => prev.map(m => m.id === messageId ? errorMsg : m));
    } finally {
        setIsThinking(false)
        setCurrentStep('')
    }
  }

  const handleApproveVideo = async (script: any, refImages: string[], imageDescriptions?: string[], prompts?: string[]) => {
    if (isThinking) return
    setIsThinking(true)
    setCurrentStep('Starting Bytedance Seedance 2.0 Fast video task...')

    try {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        const response = await fetch(`/api/video/generate${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyId: selectedPropId || null,
                script,
                images: refImages,
                imageDescriptions,
                presenterType: presenterMode,
                customInstructions: `${videoInstructions ? `${videoInstructions}\n\n` : ''}${script.concept?.description || script.concept?.visualConcept || ''}`.trim(),
                prompts,
                language: videoLanguage,
                useUploadedAudio
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const totalDuration = (script.scenes?.length || 1) * 15;
        toast.success("Video Production Started! 🎬", {
            description: `Your ${totalDuration}s Bytedance Seedance 2.0 Fast video is rendering.`
        });

        const aiMsg: Message = {
            id: Date.now(),
            role: 'ai',
            text: "Video production has been launched in the background! 🎬\n\nA placeholder with a spinning preview card has been created in your **Assets** tab. It will take about 2-3 minutes. I'll send you a push notification as soon as the final video is processed!"
        };
        setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
        toast.error("Failed to start video generation: " + error.message);
        const errorMsg: Message = { id: Date.now(), role: 'ai', text: "Error starting video: " + error.message }
        setMessages(prev => [...prev, errorMsg])
    } finally {
        setIsThinking(false)
        setCurrentStep('')
    }
  }

  const handlePreviewPrompts = async (script: any, refImages: string[], imageDescriptions: string[] | undefined, messageId: number) => {
    if (isThinking) return
    setIsThinking(true)
    setCurrentStep('AI Creative Director is generating physical scenes prompts for review...')

    try {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        const response = await fetch(`/api/video/generate${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyId: selectedPropId || null,
                script,
                images: refImages,
                imageDescriptions,
                presenterType: presenterMode,
                customInstructions: `${videoInstructions ? `${videoInstructions}\n\n` : ''}${script.concept?.description || script.concept?.visualConcept || ''}`.trim(),
                preview: true,
                language: videoLanguage,
                useUploadedAudio
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        setMessages(prev => prev.map(m => {
            if (m.id === messageId) {
                return {
                    ...m,
                    prompts: data.prompts
                }
            }
            return m
        }))
        toast.success("Final prompts generated! You can now review, edit and launch 👁️");
    } catch (error: any) {
        toast.error("Failed to generate preview prompts: " + error.message);
    } finally {
        setIsThinking(false)
        setCurrentStep('')
    }
  }

  // 3. Handle Send
  const handleSend = async () => {
    if (isThinking) return
    
    const userText = input.trim()
    if (!userText && !selectedPropId) {
        alert("Please enter instructions or select a product.")
        return
    }

    const displayText = userText || (selectedPropId ? "Generate a creative design for this product." : "Surprise me.")
    const userMsg: Message = { id: Date.now(), role: 'user', text: displayText }
    setMessages(prev => [...prev, userMsg])
    
    setInput('')
    setIsThinking(true)
    setCurrentStep(creationMode === 'image' ? 'Initializing Design Engine...' : 'Analyzing images & generating concepts...')

    try {
        if (creationMode === 'video') {
            setVideoInstructions(userText);
            // --- STEP 1: CONCEPTS ---
            setCurrentStep('AI Creative Director is analyzing your images & generating 5 ad concepts...');
            
            // Gather reference images (up to 4) - Filter out invalid placeholders/empty strings
            const prop = properties.find(p => p.id === selectedPropId)
            let propImages: string[] = []
            if (prop) {
                if (prop.images && prop.images.length > 0) propImages = prop.images;
                else if (prop.image_url) propImages = [prop.image_url];
            }
            
            const filteredPropImages = propImages.filter(img => img && typeof img === 'string' && img.startsWith('http') && !img.includes('placeholder') && !img.includes('placehold') && img !== 'null' && img !== 'undefined' && !deselectedCatalogImages.includes(img));
            const limitedCatalogImages = filteredPropImages.slice(0, 6);
            const limitedLocalRefImages = [...localRefImages, ...chatAttachments].slice(0, 2);
            const refImages = [...limitedCatalogImages, ...limitedLocalRefImages];

            const urlParams = new URLSearchParams(window.location.search)
            const impersonateId = urlParams.get('impersonate')
            const conceptsResponse = await fetch(`/api/video/concepts${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propertyId: selectedPropId || null,
                    userInstructions: userText,
                    images: refImages,
                    presenterType: presenterMode,
                    duration: selectedDuration,
                    language: videoLanguage
                })
            });

            setChatAttachments([]) // Clear attachments after sending

            const conceptsData = await conceptsResponse.json();
            if (conceptsData.error) throw new Error(conceptsData.error);

            const aiMsg: Message = {
                id: Date.now() + 1,
                role: 'ai',
                text: `I've analyzed your product and custom instructions. Here are 5 high-converting ${selectedDuration}-second ad concepts for your UGC video. Select one to generate a script:`,
                concepts: conceptsData.concepts || [],
                refImages: conceptsData.refImages || refImages,
                imageDescriptions: conceptsData.imageDescriptions || []
            };
            setMessages(prev => [...prev, aiMsg]);
            setIsThinking(false);
            return;
        }

  // A. Prepare Data
  const prop = properties.find(p => p.id === selectedPropId)
  
  // LOGO CHECK: Explicitly ensure we have the logo from the profile state
  // If the profile state is empty, the AI won't know where to place the logo.
  const accountLogo = profile?.logo_url || "";
  const contactInfo = profile?.contact_number || "";

  let propImages: string[] = []
  if (prop) {
    if (prop.images && prop.images.length > 0) propImages = prop.images.slice(0, 10)
    else if (prop.image_url) propImages = [prop.image_url]
  }

  const templateObj = TEMPLATES.find(t => t.id === selectedTemplate)
  const activeReferenceUrl = uploadedRefUrl || templateObj?.url || userReferences.find(r => r.id === selectedUserRefId)?.url || null

  const startResponse = await fetch(`/api/chat${window.location.search}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        userInstructions: userText,
        propertyDescription: prop?.description || "",
        propertyTitle: prop?.title || "",
        contactNumber: contactInfo, // Corrected reference
        logoUrl: accountLogo,       // Corrected reference
        propImages: [...propImages, ...chatAttachments],
        templateUrl: activeReferenceUrl, 
        aspectRatio: selectedRatio,
        model: selectedModel,
        creativeCategory: creativeCategory,
        isOrganic: creativeCategory === 'High Converting',
        excludedImages: excludedImages
    })
  })
      
      setChatAttachments([]) // Clear attachments after sending
      
      const startData = await startResponse.json()
      if (startData.error) throw new Error(startData.error)

      const generatedCaption = startData.caption || ''
      setCurrentStep('Generating Visuals (Safe to background or lock phone)...')

      // C. Fire Server Worker & Client Polling
      if (startData.taskId) {
        const taskId = startData.taskId 
        
        toast.success("AI Generation Started ✨", { 
            description: "You can lock your phone. We'll notify you when it's done." 
        })

        // FIRE AND FORGET THE SERVER WORKER
        fetch('/api/background-worker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: targetUserId || userId,
                propId: selectedPropId || null,
                propertyTitle: prop?.title || '',
                existingTaskId: taskId,
                existingCaption: generatedCaption
            })
        }).catch(err => console.error("Worker trigger failed:", err));


        // CLIENT POLLING (Updates Chat UI if user stays on the screen)
        let attempts = 0
        const maxAttempts = 30 
        let finalImageUrl = ''

        while (attempts < maxAttempts) {
            attempts++
            // Slowed down polling to 12s as requested
            await new Promise(resolve => setTimeout(resolve, 12000))

            const checkResponse = await fetch('/api/check-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId })
             })

            const checkData = await checkResponse.json()
            
            const status = checkData.status || checkData.data?.status || checkData.data?.state;
            
            if (status === 'succeeded' || status === 'completed' || status === 'success') {
                const result = checkData.result || checkData.data?.result || checkData.data;
                finalImageUrl = result?.image_url || 
                               result?.output_url || 
                               result?.url || 
                               (typeof result === 'string' && result.startsWith('http') ? result : null);

                if (!finalImageUrl && checkData.data?.resultJson) {
                    try {
                        const parsed = JSON.parse(checkData.data.resultJson);
                        finalImageUrl = parsed.resultUrls?.[0] || parsed.url;
                    } catch(e) {}
                }
                
                if (finalImageUrl) break;
            } else if (status === 'failed' || status === 'error') {
                throw new Error("Generation failed: " + (checkData.failMsg || checkData.data?.failMsg || "Unknown error"));
            }
        }

        if (finalImageUrl) {
            const aiMsg: Message = { 
              id: Date.now() + 1, 
              role: 'ai', 
              text: generatedCaption ? `Here is your design and suggested copy:\n\n${generatedCaption}` : `Here is your design!`, 
              mediaType: 'image',
              mediaUrl: finalImageUrl
            }
            setMessages(prev => [...prev, aiMsg])
        } else {
            throw new Error("Generation timed out.")
        }
      }

    } catch (error: any) {
      const errorMsg: Message = { id: Date.now() + 1, role: 'ai', text: "Error: " + error.message }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsThinking(false)
      setCurrentStep('')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-70px)] sm:h-screen bg-[#F8FAFC] relative">
      
      {/* FIXED REFRESH BUTTON */}
      <button 
          onClick={() => fetchProperties(true)}
          className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
          title="Refresh Catalog"
      >
          <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      {/* --- HEADER & CONFIG BAR (Grid Layout for Mobile Robustness) --- */}
      <div className="bg-white/95 backdrop-blur-xl border-b border-slate-200/60 z-20 flex-shrink-0 rounded-b-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] pb-4 pt-3">
        
        <div className="px-5 flex flex-wrap justify-between items-center gap-2 mb-3">
            <div className="flex items-center gap-3">
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                    <Sparkles size={20} className="text-blue-500" /> AI Creator
                </h1>
                
                <button 
                    onClick={() => setCreativeFlow(prev => ({ ...prev, isOpen: true }))}
                    className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest shadow-md shadow-blue-500/20 active:scale-95 transition-all"
                >
                    <Zap size={10} fill="white" /> Batch Mode
                </button>

                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all ${profile?.logo_url && profile?.contact_number ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${profile?.logo_url && profile?.contact_number ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    {profile?.logo_url && profile?.contact_number ? 'Branding Active' : 'Profile Incomplete'}
                </div>
            </div>
            {/* Right side spacer for the fixed refresh button */}
            <div className="w-10 h-10 hidden sm:block"></div>
        </div>

        {/* 
            ROW 1: Settings Controls
            Mobile: 2 cols for Model & Ratio, full width for Product
            Desktop: 3 cols inline
        */}
        <div className={`px-4 mb-3 grid grid-cols-2 ${creationMode === 'video' ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-2`}>
            
            {(currentUserRole === 'super_admin' || (userId && ALLOWED_VIDEO_USERS.includes(userId)) || (targetUserId && ALLOWED_VIDEO_USERS.includes(targetUserId))) && (
                <div className="flex bg-slate-100/80 rounded-[1rem] p-1 border border-slate-200/60 w-full">
                    <button 
                        onClick={() => setCreationMode('image')}
                        className={`flex-1 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition-all duration-300 flex items-center justify-center gap-1 ${creationMode === 'image' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <ImageIcon size={12} className="hidden sm:block" /> Image
                    </button>
                    <button 
                        onClick={() => { setCreationMode('video'); setSelectedRatio('9:16'); }}
                        className={`flex-1 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition-all duration-300 flex items-center justify-center gap-1 ${creationMode === 'video' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <VideoIcon size={12} className="hidden sm:block" /> Video
                    </button>
                </div>
            )}

            {/* Ratio or Duration Selector Pill */}
            {creationMode === 'video' ? (
                <div className="flex bg-slate-100/80 rounded-[1rem] p-1 border border-slate-200/60 w-full animate-in fade-in duration-200">
                    {([15, 30, 45, 60] as const).map(dur => (
                        <button 
                            key={dur}
                            type="button"
                            onClick={() => setSelectedDuration(dur)}
                            className={`flex-1 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-extrabold transition-all duration-300 flex items-center justify-center gap-1 ${selectedDuration === dur ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Clock size={12} className="hidden sm:block" /> {dur === 60 ? '1m' : `${dur}s`}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="flex bg-slate-100/80 rounded-[1rem] p-1 border border-slate-200/60 w-full">
                    {ASPECT_RATIOS.map(ratio => {
                        const Icon = ratio.icon
                        return (
                            <button 
                                key={ratio.value}
                                onClick={() => setSelectedRatio(ratio.value)}
                                className={`flex-1 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition-all duration-300 flex items-center justify-center gap-1 ${selectedRatio === ratio.value ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                <Icon size={12} className="hidden sm:block" /> {ratio.label}
                            </button>
                        )
                    })}
                </div>
            )}

            {creationMode === 'image' && (
                <div className="relative w-full">
                    <Sparkles size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-500 animate-pulse" />
                    <select 
                        value={creativeCategory}
                        onChange={(e) => setCreativeCategory(e.target.value)}
                        className="w-full bg-purple-50/50 hover:bg-purple-100/50 border border-purple-100 text-purple-900 text-[11px] font-bold rounded-[1rem] py-2.5 pl-9 pr-8 appearance-none outline-none focus:ring-2 focus:ring-purple-500/20 transition-all cursor-pointer h-full"
                    >
                        {[
                          'Premium',
                          'High Converting'
                        ].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none" />
                </div>
            )}

            {/* Language Toggle (only in video mode) */}
            {creationMode === 'video' && (
                <div className="flex bg-slate-100/80 rounded-[1rem] p-1 border border-slate-200/60 w-full animate-in fade-in duration-200">
                    <button 
                        type="button"
                        onClick={() => setVideoLanguage('hinglish')}
                        className={`flex-1 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-extrabold transition-all duration-300 flex items-center justify-center gap-1 ${videoLanguage === 'hinglish' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <Languages size={12} className="hidden sm:block" /> हिंग्लिश
                    </button>
                    <button 
                        type="button"
                        onClick={() => setVideoLanguage('english')}
                        className={`flex-1 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-extrabold transition-all duration-300 flex items-center justify-center gap-1 ${videoLanguage === 'english' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <Globe size={12} className="hidden sm:block" /> English
                    </button>
                </div>
            )}

            {/* Product Selector Pill (Full width on mobile, 1/3 on desktop) */}
            <div className="relative w-full">
                <Package size={14} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isLoadingProperties ? 'text-slate-400' : 'text-blue-500'}`} />
                <select 
                    value={selectedPropId}
                    onChange={(e) => {
                        setSelectedPropId(e.target.value);
                        setDeselectedCatalogImages([]);
                    }}
                    disabled={isLoadingProperties}
                    className="w-full bg-blue-50/50 hover:bg-blue-100/50 border border-blue-100 text-blue-900 text-[11px] font-bold rounded-[1rem] py-2.5 pl-9 pr-8 appearance-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer h-full disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    <option value="">{isLoadingProperties ? 'Loading catalog...' : '-- Attach Product --'}</option>
                    {properties.map(p => (
                         <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                </select>
                {isLoadingProperties ? (
                    <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" />
                ) : (
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" />
                )}
            </div>
        </div>

        {/* Presenter Settings Panel */}
        {creationMode === 'video' && (
            <div className="px-4 mb-3 animate-in fade-in duration-300">
                <div className="bg-white px-4 py-2.5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div className="bg-indigo-50 text-indigo-600 p-2 rounded-xl flex-shrink-0 animate-pulse">
                            <User size={16} />
                        </div>
                        <div className="min-w-0">
                            <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest leading-none">Presenter Character</h4>
                            <p className="text-xs font-bold text-slate-700 mt-1 truncate">
                                {presenterMode === 'none' && 'No Presenter (Generic Video)'}
                                {presenterMode === 'video' && 'Reference Video Presenter'}
                                {presenterMode === 'avatar' && 'Avatar Photo Presenter'}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                        {/* Micro preview thumbnail */}
                        {presenterMode === 'video' && profile?.character_url && (
                            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-purple-100 flex-shrink-0">
                                {(/\.(mp4|webm)/i.test(profile.character_url) || profile.character_url.includes('video')) ? (
                                    <video src={profile.character_url} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                                ) : (
                                    <img src={profile.character_url} className="w-full h-full object-cover" alt="Video character" />
                                )}
                            </div>
                        )}
                        {presenterMode === 'avatar' && profile?.avatar_url && (
                            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-indigo-100 flex-shrink-0">
                                <img src={profile.avatar_url} className="w-full h-full object-cover" alt="Avatar character" />
                            </div>
                        )}
                        
                        <button
                            type="button"
                            onClick={() => setIsPresenterModalOpen(true)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-1.5 px-3.5 rounded-xl text-[10px] font-extrabold transition-all duration-200 active:scale-95 border border-indigo-100/50 flex items-center gap-1.5"
                        >
                            Configure Presenter
                        </button>
                    </div>
                </div>
            </div>
        )}

               {/* ROW 2: Templates & Reference Upload (Grid Layout) */}
        {creationMode === 'video' ? (
            <div className="px-4 flex gap-2.5 w-full overflow-x-auto scrollbar-hide py-1 animate-in fade-in duration-300">

                {/* 2. Product Catalog Images (Filtered with Toggle selection capability) */}
                {(() => {
                    const prop = properties.find(p => p.id === selectedPropId);
                    let propImages: string[] = [];
                    if (prop) {
                        if (prop.images && prop.images.length > 0) propImages = prop.images;
                        else if (prop.image_url) propImages = [prop.image_url];
                    }
                    const filteredPropImages = propImages.filter(img => img && typeof img === 'string' && img.startsWith('http') && !img.includes('placeholder') && !img.includes('placehold') && img !== 'null' && img !== 'undefined').slice(0, 6);

                    return filteredPropImages.map((url, i) => {
                        const isDeselected = deselectedCatalogImages.includes(url);
                        return (
                            <div 
                                key={i} 
                                onClick={() => {
                                    if (isDeselected) {
                                        setDeselectedCatalogImages(prev => prev.filter(x => x !== url));
                                    } else {
                                        setDeselectedCatalogImages(prev => [...prev, url]);
                                    }
                                }}
                                className={`relative w-16 h-16 rounded-[1.25rem] overflow-hidden flex-shrink-0 bg-white flex flex-col items-center justify-center shadow-sm cursor-pointer transition-all duration-300 ${
                                    !isDeselected 
                                        ? 'border-2 border-blue-500 ring-2 ring-blue-100/50 scale-100' 
                                        : 'border border-slate-200 opacity-40 grayscale hover:opacity-75 scale-95'
                                }`}
                            >
                                <img src={url} className="w-full h-full object-cover" alt="Product" />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent flex items-end justify-center pb-1">
                                    <span className="text-white text-[8px] font-black uppercase tracking-wider text-center w-full truncate">Catalog {i + 1}</span>
                                </div>
                                {!isDeselected && (
                                    <div className="absolute top-1 right-1 bg-blue-500 text-white rounded-full p-0.5 shadow-md flex items-center justify-center z-10 animate-in zoom-in duration-200">
                                        <Check size={8} strokeWidth={4} />
                                    </div>
                                )}
                            </div>
                        );
                    });
                })()}

                {/* 3. Locally Uploaded Product Reference Images */}
                {localRefImages.map((url, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-[1.25rem] border border-slate-200 overflow-hidden flex-shrink-0 bg-white shadow-sm group">
                        <img src={url} className="w-full h-full object-cover" alt="Custom Ref" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent flex items-end justify-center pb-1">
                            <span className="text-white text-[8px] font-black uppercase tracking-wider text-center w-full truncate">Custom {i + 1}</span>
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setLocalRefImages(prev => prev.filter((_, idx) => idx !== i)); }}
                            className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <X size={8} />
                        </button>
                    </div>
                ))}

                {/* 4. Local Product Reference Upload Button */}
                <button 
                    onClick={() => localRefFileInputRef.current?.click()}
                    disabled={isUploadingLocalRef || localRefImages.length >= 2}
                    className={`w-16 h-16 rounded-[1.25rem] border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-all flex-shrink-0 ${localRefImages.length >= 2 ? 'border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50' : 'border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/5'}`}
                >
                    {isUploadingLocalRef ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <Upload size={16} />}
                    <span className="text-[8px] font-bold text-center px-1 leading-tight uppercase">
                        {localRefImages.length >= 2 ? 'Max Limit' : 'Upload Ref'}
                    </span>
                </button>
                <input type="file" ref={localRefFileInputRef} onChange={handleLocalRefUpload} className="hidden" accept="image/*" multiple />

                {/* 5. Personal Reference Library Selection */}
                {userReferences.map(ref => {
                    const isSelected = localRefImages.includes(ref.url);
                    return (
                        <button 
                           type="button"
                           key={ref.id}
                           onClick={() => { 
                             if (isSelected) {
                               setLocalRefImages(prev => prev.filter(url => url !== ref.url));
                             } else {
                               if (localRefImages.length >= 2) {
                                 toast.error("You can select up to 2 reference images.");
                                 return;
                               }
                               setLocalRefImages(prev => [...prev, ref.url]);
                             }
                           }}
                           className={`flex-shrink-0 w-16 h-16 rounded-[1.25rem] border-2 relative overflow-hidden transition-all group ${isSelected ? 'border-blue-500 ring-2 ring-blue-100 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}
                        >
                           <img src={ref.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="personal ref" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center pb-1">
                               <span className="text-white text-[8px] font-bold truncate px-1 w-full text-center capitalize">{ref.category.replace('_', ' ')}</span>
                           </div>
                           {isSelected && (
                             <div className="absolute top-1 right-1 bg-blue-500 text-white p-0.5 rounded-full shadow-sm">
                               <Check size={8} strokeWidth={4} />
                             </div>
                           )}
                        </button>
                    );
                })}
            </div>
        ) : (
            <div className="px-4 flex gap-2 w-full overflow-x-auto scrollbar-hide">
                 <button 
                    onClick={() => { setSelectedTemplate(null); setUploadedRefUrl(null); setSelectedUserRefId(null); }}
                    className={`flex-shrink-0 w-16 h-16 rounded-[1.25rem] border-2 flex flex-col items-center justify-center gap-1 transition-all ${selectedTemplate === null && uploadedRefUrl === null && selectedUserRefId === null ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-sm' : 'border-dashed border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                 >
                    <Layout size={16} />
                    <span className="text-[9px] font-bold uppercase tracking-wider">Auto</span>
                 </button>
     
                 <div className="relative flex-shrink-0">
                      <button 
                         onClick={() => refFileInputRef.current?.click()}
                         className={`w-16 h-16 rounded-[1.25rem] border-2 flex flex-col items-center justify-center gap-1 transition-all ${uploadedRefUrl ? 'border-blue-500 ring-2 ring-blue-100 overflow-hidden p-0' : 'border-dashed border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/30'}`}
                      >
                         {uploadedRefUrl ? (
                             <img src={uploadedRefUrl} className="w-full h-full object-cover" alt="ref" />
                         ) : (
                             <>
                                 {isUploadingRef ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <Upload size={16} />}
                                 <span className="text-[8px] font-bold text-center px-1 leading-tight uppercase">Upload</span>
                             </>
                         )}
                       </button>
                      <input type="file" ref={refFileInputRef} onChange={handleReferenceUpload} className="hidden" accept="image/*" />
                      
                      {uploadedRefUrl && (
                         <div className="absolute -top-1.5 -right-1.5 flex gap-1 z-10">
                            <button 
                                type="button"
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                        const cat = (creativeCategory || 'Premium').toLowerCase().replace(' ', '_');
                                        const insertPayload = {
                                            category: cat,
                                            url: uploadedRefUrl,
                                            user_id: targetUserId || userId
                                        };
                                        const { data, error } = await supabase
                                            .from('reference_creatives')
                                            .insert(insertPayload)
                                            .select()
                                            .single();
                                            
                                        if (error) throw error;
                                        
                                        if (data) {
                                            setUserReferences(prev => [data, ...prev]);
                                            setSelectedUserRefId(data.id);
                                            setUploadedRefUrl(null);
                                            toast.success("Saved to Reference Library! 💎");
                                        }
                                    } catch (err: any) {
                                        console.error(err);
                                        toast.error("Failed to save reference style: " + err.message);
                                    }
                                }}
                                className="bg-emerald-600 text-white rounded-full p-1 shadow-md hover:bg-emerald-700 transition-colors"
                                title="Save to Library"
                            >
                                <Check size={10} strokeWidth={3} />
                            </button>
                            <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setUploadedRefUrl(null); }}
                                className="bg-slate-800 text-white rounded-full p-1 shadow-md hover:bg-slate-700 transition-colors"
                                title="Remove Uploaded Style"
                            >
                                <X size={10} />
                            </button>
                         </div>
                      )}
                 </div>

                 {/* Map user's personal reference library creatives */}
                 {userReferences.length === 0 && (
                      <span className="text-[9px] font-bold text-slate-400 border border-dashed border-slate-200 px-3 rounded-2xl h-16 flex items-center justify-center bg-slate-50/50 flex-shrink-0">
                          Library Empty (Manage in Profile)
                      </span>
                 )}
                 {userReferences.map(ref => (
                      <button 
                         key={ref.id}
                         onClick={() => { 
                           setSelectedTemplate(null); 
                           setUploadedRefUrl(null); 
                           setSelectedUserRefId(ref.id); 
                         }}
                         className={`flex-shrink-0 w-16 h-16 rounded-[1.25rem] border-2 relative overflow-hidden transition-all group ${selectedUserRefId === ref.id ? 'border-purple-500 ring-2 ring-purple-100 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}
                      >
                         <img src={ref.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="personal ref" />
                         <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center pb-1">
                             <span className="text-white text-[8px] font-bold truncate px-1 w-full text-center capitalize">{ref.category.replace('_', ' ')}</span>
                         </div>
                         {selectedUserRefId === ref.id && (
                           <div className="absolute top-1 right-1 bg-purple-500 text-white p-0.5 rounded-full shadow-sm">
                             <Check size={8} strokeWidth={4} />
                           </div>
                         )}
                      </button>
                 ))}
     
                 {/* Map visible templates (Limit to 3 or 4 to fit on screen without scrolling if possible) */}
                 {TEMPLATES.slice(0, 4).map(t => (
                      <button 
                         key={t.id}
                         onClick={() => { setSelectedTemplate(t.id); setUploadedRefUrl(null); }}
                         className={`flex-shrink-0 w-16 h-16 rounded-[1.25rem] border-2 relative overflow-hidden transition-all group ${selectedTemplate === t.id ? 'border-blue-500 ring-2 ring-blue-100 shadow-sm' : 'border-transparent opacity-80 hover:opacity-100'}`}
                      >
                         <img src={t.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="template" />
                         <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center pb-1">
                             <span className="text-white text-[8px] font-bold truncate px-1 w-full text-center">{t.name}</span>
                         </div>
                         {selectedTemplate === t.id && <div className="absolute top-1 right-1 bg-blue-500 text-white p-0.5 rounded-full shadow-sm"><Check size={8} strokeWidth={4} /></div>}
                      </button>
                 ))}
            </div>
        )}
      </div>

      {/* --- CHAT AREA --- */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#F8FAFC]">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex w-full animate-in fade-in slide-in-from-bottom-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[85%] sm:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-auto sm:mt-1 shadow-sm ${msg.role === 'user' ? 'bg-slate-200 ml-2' : 'bg-gradient-to-br from-blue-500 to-indigo-600 mr-2'}`}>
                  {msg.role === 'user' ? <User size={14} className="text-slate-500" /> : <Bot size={16} className="text-white" />}
              </div>

              {/* Bubble */}
              <div className="flex flex-col gap-2">
                <div className={`p-4 text-sm font-medium leading-relaxed shadow-sm whitespace-pre-wrap ${
                    msg.role === 'user' 
                    ? 'bg-slate-900 text-white rounded-[2rem] rounded-br-sm' 
                    : 'bg-white text-slate-700 border border-slate-100/80 rounded-[2rem] rounded-bl-sm'
                }`}>
                  {msg.text}
                </div>
                
                {msg.mediaUrl && (
                  <div className={`relative overflow-hidden rounded-[1.5rem] border-[4px] border-white shadow-md group max-w-sm w-full`}>
                      {msg.mediaType === 'video' ? (
                          <video 
                              src={msg.mediaUrl} 
                              controls 
                              autoPlay 
                              loop 
                              muted 
                              className="w-full h-auto object-cover aspect-[9/16]" 
                          />
                      ) : (
                          <img src={msg.mediaUrl} alt="Generated content" className="w-full h-auto object-cover" />
                      )}
                      <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 bg-white text-slate-800 text-xs font-bold px-4 py-2 rounded-full shadow-lg transition-all duration-300 transform scale-95 group-hover:scale-100">
                              {msg.mediaType === 'video' ? 'Download Video' : 'View Full Size'}
                          </span>
                      </a>
                  </div>
                )}

                {/* 5 CONCEPTS LIST UI */}
                {msg.concepts && msg.concepts.length > 0 && (
                  <div className="grid grid-cols-1 gap-3.5 mt-3 max-w-xl animate-in fade-in slide-in-from-top-3">
                    {msg.concepts.map((concept, idx) => (
                      <button
                        key={concept.id || idx}
                        onClick={() => handleSelectConcept(concept, msg.refImages || [], msg.imageDescriptions)}
                        disabled={isThinking}
                        className="w-full text-left bg-white hover:bg-slate-50/50 border border-slate-200 hover:border-blue-500 rounded-[1.5rem] p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col gap-2 group active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Concept {idx + 1}</span>
                          <span className="text-[9px] font-extrabold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase tracking-wide">
                            {concept.title.includes(':') ? concept.title.split(':')[0] : 'UGC AD'}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                          {concept.title.includes(':') ? concept.title.split(':').slice(1).join(':').trim() : concept.title}
                        </h4>
                        <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 flex flex-col gap-1 w-full">
                          <p className="text-[9px] font-extrabold text-blue-500 uppercase tracking-widest">3S Hook</p>
                          <p className="text-xs text-slate-600 italic font-medium leading-relaxed">
                            {concept.hook}
                          </p>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed font-normal">
                          {concept.description}
                        </p>
                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-wider">
                          <Sparkles size={11} className="text-blue-500" />
                          <span>{concept.visualConcept || concept.visual_concept}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* SCRIPT GENERATION RETRY UI */}
                {msg.isError && msg.failedConcept && (
                  <div className="bg-red-50/50 border border-red-200 rounded-[2rem] p-5 shadow-sm max-w-xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-3 mt-2">
                    <div className="flex items-center gap-2 text-red-600 font-extrabold text-xs uppercase tracking-wider">
                      <X className="text-red-500" size={16} /> Script Generation Failed
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed font-normal">
                      The AI Creative Director couldn't complete the script generation due to high API demand. Don't worry, your custom instructions and concept details are fully saved. You can retry safely.
                    </p>
                    <button
                      onClick={() => handleSelectConcept(msg.failedConcept, msg.refImages || [], msg.imageDescriptions, msg.id)}
                      disabled={isThinking}
                      className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md shadow-red-500/10 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={isThinking ? 'animate-spin' : ''} /> Retry Script Generation 🔄
                    </button>
                  </div>
                )}

                {/* SCRIPT REVIEW UI */}
                {msg.script && (
                  <div className="bg-white border border-slate-200 rounded-[2rem] p-5 shadow-md max-w-xl flex flex-col gap-4 animate-in fade-in slide-in-from-top-3 mt-2">
                    
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-50 rounded-lg text-blue-500">
                          <VideoIcon size={16} />
                        </div>
                        <div>
                          <h4 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">UGC Script Draft</h4>
                          <h3 className="text-sm font-extrabold text-slate-800">{msg.script.title}</h3>
                        </div>
                      </div>
                      <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full uppercase tracking-wider">
                        {msg.script.scenes && msg.script.scenes.length > 1 ? `${msg.script.scenes.length * 15} Seconds (${msg.script.scenes.length}x 15s clips)` : '15 Seconds'}
                      </span>
                    </div>

                    {!msg.prompts && (
                      msg.script.scenes && Array.isArray(msg.script.scenes) ? (
                        <div className="flex flex-col gap-3.5">
                          {msg.script.scenes.map((scene: any, idx: number) => (
                            <div key={idx} className="bg-slate-50/60 rounded-[1.5rem] p-4 border border-slate-100 flex flex-col gap-3 relative overflow-hidden">
                              <div className="absolute top-0 right-0 bg-blue-500 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider">
                                Scene {idx + 1} (15s)
                              </div>
                              
                              {/* Visual Scene Description */}
                              <div className="flex flex-col gap-1 mt-1">
                                <span className="text-[9px] font-extrabold text-blue-500 uppercase tracking-wider flex items-center gap-1">
                                  <ImageIcon size={10} /> Visuals
                                </span>
                                <textarea
                                  value={scene.visuals}
                                  onChange={(e) => {
                                    const updatedScenes = [...msg.script.scenes];
                                    updatedScenes[idx] = { ...scene, visuals: e.target.value };
                                    setMessages(prev => prev.map(m => m.id === msg.id ? {
                                      ...m,
                                      script: { ...m.script, scenes: updatedScenes }
                                    } : m));
                                  }}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-700 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all resize-none h-16"
                                />
                              </div>

                              {/* Dialogue/Voiceover */}
                              <div className="flex flex-col gap-1 border-t border-slate-200/40 pt-2.5">
                                <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-wider flex items-center gap-1">
                                  <User size={10} /> Dialogue ({videoLanguage === 'hinglish' ? 'Hinglish' : 'English'})
                                </span>
                                <textarea
                                  value={scene.dialogue}
                                  onChange={(e) => {
                                    const updatedScenes = [...msg.script.scenes];
                                    updatedScenes[idx] = { ...scene, dialogue: e.target.value };
                                    setMessages(prev => prev.map(m => m.id === msg.id ? {
                                      ...m,
                                      script: { 
                                        ...m.script, 
                                        scenes: updatedScenes,
                                        dialogue: updatedScenes.map(s => s.dialogue).join(" ")
                                      }
                                    } : m));
                                  }}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 font-medium italic focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all resize-none h-20"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          {/* Visual Scene Description */}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[9px] font-extrabold text-blue-500 uppercase tracking-wider flex items-center gap-1">
                              <ImageIcon size={12} /> Visual Action Sequence (9:16 UGC)
                            </span>
                            <textarea
                              value={msg.script.visuals}
                              onChange={(e) => {
                                setMessages(prev => prev.map(m => m.id === msg.id ? {
                                  ...m,
                                  script: { ...m.script, visuals: e.target.value }
                                } : m));
                              }}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all h-24"
                            />
                          </div>

                          {/* Dialogue/Voiceover */}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-wider flex items-center gap-1">
                              <User size={12} /> Conversational Audio/Dialogue ({videoLanguage === 'hinglish' ? 'Hinglish' : 'English'})
                            </span>
                            <textarea
                              value={msg.script.dialogue}
                              onChange={(e) => {
                                setMessages(prev => prev.map(m => m.id === msg.id ? {
                                  ...m,
                                  script: { ...m.script, dialogue: e.target.value }
                                } : m));
                              }}
                              className="w-full bg-indigo-50/30 border border-indigo-100/50 rounded-xl p-3.5 text-xs text-slate-800 font-semibold italic outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all h-24"
                            />
                          </div>
                        </>
                      )
                    )}

                    {/* Suggested Caption */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Layout size={12} /> Social Media Ad Caption
                      </span>
                      <textarea
                        value={msg.script.finalCaption}
                        onChange={(e) => {
                          setMessages(prev => prev.map(m => m.id === msg.id ? {
                            ...m,
                            script: { ...m.script, finalCaption: e.target.value }
                          } : m));
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all h-28"
                      />
                    </div>

                    {/* Prompt Review and Edit Section */}
                    {msg.prompts && msg.prompts.length > 0 && (
                      <div className="flex flex-col gap-3.5 border-t border-slate-100 pt-4 animate-in fade-in slide-in-from-top-3">
                        <div className="bg-blue-50/50 p-4 rounded-[1.5rem] border border-blue-100/50">
                          <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-1">
                            ✨ Review & Edit AI Prompts
                          </span>
                          <span className="text-[11px] text-slate-500 font-medium">
                            The AI generated these physical scenes prompts for Bytedance Seedance. You can customize them before generating.
                          </span>
                        </div>
                        {msg.prompts.map((promptText: string, pIdx: number) => (
                          <div key={pIdx} className="flex flex-col gap-1.5 bg-slate-50/60 p-3 rounded-xl border border-slate-100">
                            <span className="text-[9px] font-extrabold text-blue-500 uppercase tracking-wider">
                              Scene {pIdx + 1} Prompt
                            </span>
                            <textarea
                              value={promptText}
                              onChange={(e) => {
                                const updatedPrompts = [...(msg.prompts || [])];
                                updatedPrompts[pIdx] = e.target.value;
                                setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, prompts: updatedPrompts } : m));
                              }}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-700 font-semibold focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all resize-none h-28"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Reference Images Row */}
                    <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Reference Images</span>
                        <span className="text-[9px] text-slate-400 font-medium">Use these photos in video background/scene</span>
                      </div>
                      <div className="flex gap-2 flex-wrap items-center">
                        {msg.refImages && msg.refImages.map((url: string, i: number) => (
                          <div key={i} className="relative group w-12 h-12 rounded-xl overflow-hidden border border-slate-200 shadow-sm flex-shrink-0 transition-all hover:scale-105">
                            <img src={url} className="w-full h-full object-cover" alt="ref" />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity">
                              <span className="text-[8px] font-black text-white">IMG {i+1}</span>
                            </div>
                            <button
                              onClick={() => {
                                setMessages(prev => prev.map(m => m.id === msg.id ? {
                                  ...m,
                                  refImages: m.refImages?.filter((_, idx) => idx !== i)
                                } : m));
                              }}
                              className="absolute inset-0 bg-red-600/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer duration-150"
                              title="Delete Image"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                        
                        {/* Add Reference Image Button */}
                        <label className="w-12 h-12 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-500 flex flex-col items-center justify-center cursor-pointer transition-colors hover:bg-blue-50/30 flex-shrink-0">
                          {isUploadingRef ? (
                            <Loader2 size={14} className="text-blue-500 animate-spin" />
                          ) : (
                            <>
                              <Plus size={14} className="text-slate-400 hover:text-blue-500" />
                              <span className="text-[7px] text-slate-400 font-extrabold mt-0.5">ADD</span>
                            </>
                          )}
                          <input
                            type="file"
                            className="hidden"
                            accept="image/*"
                            disabled={isUploadingRef}
                            onChange={async (e) => {
                              if (!e.target.files || e.target.files.length === 0) return;
                              setIsUploadingRef(true);
                              try {
                                const file = e.target.files[0];
                                const fileExt = file.name.split('.').pop();
                                const newFileName = `ref-addition-${Date.now()}.${fileExt}`;
                                const renamedFile = new File([file], newFileName, { type: file.type });
                                const publicUrl = await uploadToR2(renamedFile, 'references');
                                
                                setMessages(prev => prev.map(m => m.id === msg.id ? {
                                  ...m,
                                  refImages: [...(m.refImages || []), publicUrl]
                                } : m));
                                toast.success("Reference image added! 📸");
                              } catch (uploadErr: any) {
                                toast.error("Failed to upload reference image: " + uploadErr.message);
                              } finally {
                                setIsUploadingRef(false);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Interactive Action Buttons */}
                    {msg.id === messages[messages.length - 1]?.id && (
                      <div className="flex gap-2 mt-2 border-t border-slate-100 pt-3">
                        {msg.prompts ? (
                          <button
                            onClick={() => handleApproveVideo(msg.script, msg.refImages || [], msg.imageDescriptions, msg.prompts)}
                            disabled={isThinking}
                            className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-500/10 active:scale-95 transition-all disabled:opacity-50"
                          >
                            <Sparkles size={14} /> Confirm & Launch Video Task 🚀
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePreviewPrompts(msg.script, msg.refImages || [], msg.imageDescriptions, msg.id)}
                            disabled={isThinking}
                            className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 active:scale-95 transition-all disabled:opacity-50"
                          >
                            <Sparkles size={14} /> Review Final Prompts 👁️
                          </button>
                        )}
                        <button
                          onClick={() => handleGenerateScriptVariation(msg.script.concept, msg.refImages || [], msg.id, msg.imageDescriptions)}
                          disabled={isThinking}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
                        >
                          <RefreshCw size={14} className={isThinking ? 'animate-spin' : ''} /> Generate Again 🔄
                        </button>
                      </div>
                    )}

                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
         
        {isThinking && (
             <div className="flex items-start gap-3 w-full animate-in fade-in slide-in-from-bottom-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-auto sm:mt-1 shadow-sm border border-blue-200">
                    <Loader2 size={16} className="text-blue-600 animate-spin" />
                </div>
                <div className="bg-white p-4 rounded-[2rem] rounded-bl-sm border border-blue-100 shadow-sm max-w-[80%]">
                    <p className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                        <Sparkles size={14} className="text-blue-500" /> AI is crafting...
                    </p>
                    <p className="text-xs text-blue-600 font-medium animate-pulse">{currentStep}</p>
                    <p className="text-[10px] text-slate-400 mt-2 font-medium leading-tight">You can lock your phone. We'll notify you when it's done.</p>
                </div>
             </div>
        )}
        <div ref={chatEndRef} className="h-6" />
      </div>

      {/* --- FLOATING INPUT AREA --- */}
      {/* ADDED PADDING (pb-24 sm:pb-32) SO IT FLOATS ABOVE THE NAVIGATION BAR */}
      <div className="bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC] to-transparent p-4 pb-24 sm:pb-32 border-t-0 flex-shrink-0 z-20">
        {(() => {
          const currentProperty = properties.find(p => p.id === selectedPropId);
          let currentPropImages: string[] = [];
          if (currentProperty) {
            if (currentProperty.images && currentProperty.images.length > 0) {
              currentPropImages = currentProperty.images.slice(0, 10);
            } else if (currentProperty.image_url) {
              currentPropImages = [currentProperty.image_url];
            }
          }

          const selectedTemplateObj = TEMPLATES.find(t => t.id === selectedTemplate);
          const currentActiveReferenceUrl = uploadedRefUrl || selectedTemplateObj?.url || userReferences.find(r => r.id === selectedUserRefId)?.url || null;
          const currentAccountLogo = profile?.logo_url || "";

          const potentialInputImages = [
            ...currentPropImages,
            currentAccountLogo,
            currentActiveReferenceUrl,
            ...chatAttachments
          ].filter((url): url is string => !!(url && typeof url === 'string' && url.startsWith('http') && !url.includes('placehold.co') && !url.toLowerCase().endsWith('.svg')));

          const uniquePotentialInputImages = Array.from(new Set(potentialInputImages));
          const imagesBeingSent = uniquePotentialInputImages.filter(url => !excludedImages.includes(url));
          const excludedImagesList = uniquePotentialInputImages.filter(url => excludedImages.includes(url));

          return (
            <>
              {imagesBeingSent.length > 0 && (
                <div className="max-w-4xl mx-auto mb-3 px-4">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Images Sent to Image Model ({imagesBeingSent.length}/16):
                  </span>
                  <div className="flex flex-wrap gap-2.5">
                    {imagesBeingSent.map((url, i) => {
                      let badge = "Asset";
                      if (url === currentAccountLogo) badge = "Logo";
                      else if (url === currentActiveReferenceUrl) badge = "Style";
                      else if (currentPropImages.includes(url)) badge = "Property";

                      return (
                        <div key={i} className="relative group w-16 h-16 rounded-2xl overflow-hidden border-2 border-slate-200 shadow-sm flex-shrink-0 bg-slate-50 transition-all hover:scale-95 duration-200">
                          <img src={url} className="w-full h-full object-cover" alt="asset" />
                          <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[8px] font-black text-center py-0.5 uppercase tracking-wide">
                            {badge}
                          </div>
                          <button 
                            type="button"
                            onClick={() => {
                              setExcludedImages(prev => [...prev, url]);
                              if (chatAttachments.includes(url)) {
                                setChatAttachments(prev => prev.filter(u => u !== url));
                              }
                            }}
                            className="absolute top-1 right-1 bg-rose-500 hover:bg-rose-600 text-white p-0.5 rounded-full shadow-sm z-10 transition-colors"
                            title="Exclude from generation"
                          >
                            <X size={10} strokeWidth={3} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {imagesBeingSent.length > 16 && (
                    <p className="text-[10px] text-rose-500 font-extrabold mt-1">
                      ⚠️ Warning: Max images limit is 16. Only the first 16 images will be sent.
                    </p>
                  )}
                </div>
              )}

              {excludedImagesList.length > 0 && (
                <div className="max-w-4xl mx-auto mb-3 px-4 flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
                    Excluded (Click to Add Back):
                  </span>
                  {excludedImagesList.map((url, i) => {
                    let badge = "Asset";
                    if (url === currentAccountLogo) badge = "Logo";
                    else if (url === currentActiveReferenceUrl) badge = "Style";
                    else if (currentPropImages.includes(url)) badge = "Property";

                    return (
                      <button
                        type="button"
                        key={i}
                        onClick={() => setExcludedImages(prev => prev.filter(u => u !== url))}
                        className="text-[9px] font-bold text-slate-500 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 border border-slate-200 hover:border-blue-100 rounded-full px-2 py-0.5 flex items-center gap-1 transition-all active:scale-95"
                        title="Click to include back"
                      >
                        <span>{badge}</span>
                        <Plus size={8} strokeWidth={3} />
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}

        <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex items-end gap-2 max-w-4xl mx-auto relative shadow-lg shadow-slate-200/50 rounded-[1.75rem] bg-white border border-slate-200/60 transition-all focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-300 p-1.5"
        >
            <input 
              type="file" 
              ref={chatFileInputRef} 
              onChange={handleChatFileChange} 
              className="hidden" 
              accept="image/*" 
              multiple 
            />
            <button 
              type="button"
              onClick={() => chatFileInputRef.current?.click()}
              disabled={isThinking || isUploadingChat}
              className="p-3 text-slate-400 hover:text-blue-600 transition-colors rounded-full mb-0.5 ml-0.5"
            >
              {isUploadingChat ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            </button>

            <textarea 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              placeholder={selectedPropId ? "Add a prompt (e.g. 'Make it luxurious')..." : "Describe what to generate..."} 
              disabled={isThinking} 
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!isThinking && !isUploadingChat && (input.trim() || selectedPropId || chatAttachments.length > 0)) {
                    handleSend();
                  }
                }
              }}
              className="flex-1 bg-transparent py-3 pl-1 pr-14 text-sm text-slate-800 font-medium outline-none transition-all disabled:opacity-50 placeholder-slate-400 resize-none max-h-36 overflow-y-auto custom-scrollbar min-h-[44px]" 
            />
            <button 
              type="submit" 
              disabled={isThinking || isUploadingChat || (!input.trim() && !selectedPropId && chatAttachments.length === 0)} 
              className="w-10 h-10 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center rounded-full transition-all duration-300 disabled:opacity-50 disabled:bg-slate-200 disabled:text-slate-400 shadow-sm active:scale-90 flex-shrink-0 mb-0.5 mr-0.5"
            >
              {isThinking ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} className="ml-0.5" />}
            </button>
        </form>
      </div>

      {/* CREATIVE FLOW MODAL */}
      <CreativeFlowModal 
        creativeFlow={creativeFlow}
        setCreativeFlow={setCreativeFlow}
        properties={properties}
        handleGenerateAngles={handleGenerateAngles}
        handleStartBatchRendering={handleStartBatchRendering}
      />

      {/* Presenter Modal Dialog */}
      {isPresenterModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-3xl border border-slate-100 shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto transform transition-all scale-100 animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                        <div className="bg-indigo-50 text-indigo-600 p-2 rounded-xl flex-shrink-0 animate-pulse">
                            <User size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">Presenter Configuration</h3>
                            <p className="text-[10px] text-slate-400">Select presenter type for video generation</p>
                        </div>
                    </div>
                    <button 
                        type="button"
                        onClick={() => setIsPresenterModalOpen(false)}
                        className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Selector Cards */}
                <div className="grid grid-cols-3 gap-2.5">
                    {/* Option 1: Reference Video */}
                    <div
                        onClick={() => {
                            if (profile?.character_url) {
                                setPresenterMode('video');
                            } else {
                                toast.info("Upload a character reference video first!");
                            }
                        }}
                        className={`relative border p-3 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ${
                            presenterMode === 'video'
                                ? 'border-purple-500 bg-purple-50/20 ring-2 ring-purple-100'
                                : 'border-slate-200 hover:border-slate-300 bg-slate-50/20'
                        } ${!profile?.character_url ? 'opacity-50 cursor-not-allowed bg-slate-50/40' : ''}`}
                    >
                        {profile?.character_url ? (
                            <div className="w-10 h-10 rounded-full overflow-hidden mb-1.5 border border-purple-200/50 flex-shrink-0 animate-in zoom-in duration-300">
                                {(/\.(mp4|webm)/i.test(profile.character_url) || profile.character_url.includes('video')) ? (
                                    <video src={profile.character_url} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                                ) : (
                                    <img src={profile.character_url} className="w-full h-full object-cover" alt="Video character" />
                                )}
                            </div>
                        ) : (
                            <VideoIcon size={18} className="text-slate-400 mb-1.5" />
                        )}
                        <span className="text-[10px] font-black text-slate-800">Reference Video</span>
                        <span className="text-[8px] text-slate-400 mt-0.5 leading-none">
                            {profile?.character_url ? 'Configured' : 'Not Uploaded'}
                        </span>
                        {presenterMode === 'video' && (
                            <div className="absolute top-1.5 right-1.5 bg-purple-500 text-white rounded-full p-0.5 shadow-sm">
                                <Check size={8} strokeWidth={4} />
                            </div>
                        )}
                    </div>

                    {/* Option 2: Avatar Photo */}
                    <div
                        onClick={() => {
                            if (profile?.avatar_url) {
                                setPresenterMode('avatar');
                            } else {
                                toast.info("Upload a presenter avatar photo first!");
                            }
                        }}
                        className={`relative border p-3 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ${
                            presenterMode === 'avatar'
                                ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-100'
                                : 'border-slate-200 hover:border-slate-300 bg-slate-50/20'
                        } ${!profile?.avatar_url ? 'opacity-50 cursor-not-allowed bg-slate-50/40' : ''}`}
                    >
                        {profile?.avatar_url ? (
                            <div className="w-10 h-10 rounded-full overflow-hidden mb-1.5 border border-indigo-200/50 flex-shrink-0 animate-in zoom-in duration-300">
                                <img src={profile.avatar_url} className="w-full h-full object-cover" alt="Avatar character" />
                            </div>
                        ) : (
                            <User size={18} className="text-slate-400 mb-1.5" />
                        )}
                        <span className="text-[10px] font-black text-slate-800">Avatar Photo</span>
                        <span className="text-[8px] text-slate-400 mt-0.5 leading-none">
                            {profile?.avatar_url ? 'Configured' : 'Not Uploaded'}
                        </span>
                        {presenterMode === 'avatar' && (
                            <div className="absolute top-1.5 right-1.5 bg-indigo-500 text-white rounded-full p-0.5 shadow-sm">
                                <Check size={8} strokeWidth={4} />
                            </div>
                        )}
                    </div>

                    {/* Option 3: Disable Presenter */}
                    <div
                        onClick={() => setPresenterMode('none')}
                        className={`relative border p-3 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ${
                            presenterMode === 'none'
                                ? 'border-slate-500 bg-slate-100 ring-2 ring-slate-200'
                                : 'border-slate-200 hover:border-slate-300 bg-slate-50/20'
                        }`}
                    >
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-1.5 text-slate-400 flex-shrink-0">
                            <X size={18} />
                        </div>
                        <span className="text-[10px] font-black text-slate-800">No Presenter</span>
                        <span className="text-[8px] text-slate-400 mt-0.5 leading-none">Generic Video</span>
                        {presenterMode === 'none' && (
                            <div className="absolute top-1.5 right-1.5 bg-slate-600 text-white rounded-full p-0.5 shadow-sm">
                                <Check size={8} strokeWidth={4} />
                            </div>
                        )}
                    </div>
                </div>

                {/* Conditional Upload Panel (If missing selection requirements) */}
                {((presenterMode === 'video' && (!profile?.character_url || !profile?.character_audio_url)) ||
                  (presenterMode === 'avatar' && (!profile?.avatar_url || !profile?.avatar_audio_url)) ||
                  (!profile?.character_url && !profile?.avatar_url)) && (
                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 space-y-2.5 animate-in slide-in-from-top-2 duration-300">
                        <div className="flex items-center gap-1.5 text-slate-600">
                            <AlertCircle size={14} className="text-amber-500" />
                            <span className="text-[10px] font-bold">Missing Required Presenter Assets</span>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                            {/* 1. Upload Avatar Photo */}
                            {(!profile?.avatar_url || presenterMode === 'avatar') && (
                                <button
                                    type="button"
                                    onClick={() => avatarInputRef.current?.click()}
                                    disabled={uploadingAvatar}
                                    className="w-full bg-white hover:bg-indigo-50/30 text-slate-700 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 py-2.5 px-3 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs animate-pulse"
                                >
                                    {uploadingAvatar ? (
                                        <Loader2 size={12} className="animate-spin text-indigo-600" />
                                    ) : (
                                        <Upload size={12} />
                                    )}
                                    {profile?.avatar_url ? 'Update Avatar Photo' : 'Upload Avatar Photo'}
                                </button>
                            )}

                            {/* 2. Upload Reference Video */}
                            {(!profile?.character_url || presenterMode === 'video') && (
                                <button
                                    type="button"
                                    onClick={() => videoInputRef.current?.click()}
                                    disabled={uploadingVideo}
                                    className="w-full bg-white hover:bg-purple-50/30 text-slate-700 hover:text-purple-600 border border-slate-200 hover:border-purple-200 py-2.5 px-3 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs animate-pulse"
                                >
                                    {uploadingVideo ? (
                                        <Loader2 size={12} className="animate-spin text-purple-600" />
                                    ) : (
                                        <Upload size={12} />
                                    )}
                                    {profile?.character_url ? 'Update Ref Video' : 'Upload Ref Video'}
                                </button>
                            )}

                            {/* 3. Upload Audio sample (required only for Video presenter) */}
                            {(presenterMode === 'video' || (!profile?.character_url && !profile?.avatar_url)) && (
                                <button
                                    type="button"
                                    onClick={() => audioInputRef.current?.click()}
                                    disabled={uploadingAudio}
                                    className={`w-full bg-white hover:bg-emerald-50/30 border py-2.5 px-3 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs animate-pulse ${
                                        profile?.character_audio_url 
                                            ? 'text-emerald-700 border-emerald-200 hover:border-emerald-300' 
                                            : 'text-slate-700 border-slate-200 hover:border-emerald-200'
                                    }`}
                                >
                                    {uploadingAudio ? (
                                        <Loader2 size={12} className="animate-spin text-emerald-600" />
                                    ) : (
                                        <Mic size={12} className={profile?.character_audio_url ? "text-emerald-500 animate-pulse" : ""} />
                                    )}
                                    {profile?.character_audio_url ? 'Video Voice Loaded' : 'Upload Video Voice (Audio)'}
                                </button>
                            )}

                            {/* 4. Upload Audio sample (required for Avatar presenter) */}
                            {(presenterMode === 'avatar' || (!profile?.character_url && !profile?.avatar_url)) && (
                                <button
                                    type="button"
                                    onClick={() => avatarAudioInputRef.current?.click()}
                                    disabled={uploadingAvatarAudio}
                                    className={`w-full bg-white hover:bg-indigo-50/30 border py-2.5 px-3 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs animate-pulse ${
                                        profile?.avatar_audio_url 
                                            ? 'text-indigo-700 border-indigo-200 hover:border-indigo-300' 
                                            : 'text-slate-700 border-slate-200 hover:border-indigo-200'
                                    }`}
                                >
                                    {uploadingAvatarAudio ? (
                                        <Loader2 size={12} className="animate-spin text-indigo-600" />
                                    ) : (
                                        <Mic size={12} className={profile?.avatar_audio_url ? "text-indigo-500 animate-pulse" : ""} />
                                    )}
                                    {profile?.avatar_audio_url ? 'Avatar Voice Loaded' : 'Upload Avatar Voice (Audio)'}
                                </button>
                            )}
                        </div>

                        {/* Descriptions / Warnings */}
                        {presenterMode === 'video' && !profile?.character_audio_url && useUploadedAudio && (
                            <p className="text-[9px] text-amber-600 font-bold leading-tight">
                                ⚠️ Cloning voice for video requires a video voice audio sample. Upload an audio sample (up to 15s MP3/WAV) to proceed.
                            </p>
                        )}
                        {presenterMode === 'avatar' && !profile?.avatar_audio_url && useUploadedAudio && (
                            <p className="text-[9px] text-amber-600 font-bold leading-tight">
                                ⚠️ Cloning voice for avatar requires an avatar voice audio sample. Upload an audio sample (up to 15s MP3/WAV) to proceed.
                            </p>
                        )}
                        {presenterMode !== 'none' && !useUploadedAudio && (
                            <p className="text-[9px] text-slate-500 font-bold leading-tight">
                                ℹ️ Video will be generated using the model's default voice.
                            </p>
                        )}
                    </div>
                )}

                {/* Voice Cloning Option */}
                {presenterMode !== 'none' && (
                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 flex items-center justify-between gap-3 animate-in slide-in-from-top-2 duration-300">
                        <div className="min-w-0">
                            <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest leading-none">Voice Cloning</h4>
                            <p className="text-xs font-bold text-slate-700 mt-1">Use my uploaded voice sample</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setUseUploadedAudio(prev => !prev)}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none ${
                                useUploadedAudio ? 'bg-blue-600' : 'bg-slate-200'
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                    useUploadedAudio ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>
                )}

                {/* Hidden File Inputs */}
                <input type="file" ref={avatarInputRef} onChange={handleAvatarUpload} className="hidden" accept="image/*" />
                <input type="file" ref={videoInputRef} onChange={handleVideoUpload} className="hidden" accept="video/*" />
                <input type="file" ref={audioInputRef} onChange={handleAudioUpload} className="hidden" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav" />
                <input type="file" ref={avatarAudioInputRef} onChange={handleAvatarAudioUpload} className="hidden" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav" />

                {/* Footer Action */}
                <div className="pt-3 border-t border-slate-100 flex justify-end">
                    <button
                        type="button"
                        onClick={() => setIsPresenterModalOpen(false)}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-6 py-2.5 rounded-xl transition-all shadow-sm active:scale-95"
                    >
                        Save & Close
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  )
}

function CreativeFlowModal({ 
    creativeFlow, 
    setCreativeFlow, 
    properties, 
    handleGenerateAngles, 
    handleStartBatchRendering
  }: any) {
    if (!creativeFlow.isOpen) return null;
  
    const currentStep = creativeFlow.step;
  
    return (
      <div className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
        <div className="bg-white w-full max-w-2xl rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20">
          
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="text-blue-600" size={24} /> AI Creative Engine
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                Step {currentStep === 'setup' ? '1' : currentStep === 'angles' ? '2' : currentStep === 'rendering' ? '3' : '4'} of 4
              </p>
            </div>
            <button 
              onClick={() => setCreativeFlow((prev: any) => ({ ...prev, isOpen: false }))}
              className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
  
          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            
            {currentStep === 'setup' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-4">1. Select Product to Promote</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {properties.map((p: any) => (
                      <div 
                        key={p.id}
                        onClick={() => setCreativeFlow((prev: any) => ({ ...prev, product: p }))}
                        className={`relative aspect-square rounded-2xl overflow-hidden cursor-pointer border-2 transition-all ${
                          creativeFlow.product?.id === p.id ? 'border-blue-600 ring-4 ring-blue-500/10' : 'border-transparent hover:border-slate-200'
                        }`}
                      >
                        <img src={p.image_url} className="w-full h-full object-cover" alt={p.title} />
                        <div className="absolute inset-0 bg-black/20" />
                        <div className="absolute bottom-2 left-2 right-2 truncate text-[10px] font-bold text-white drop-shadow-sm">{p.title}</div>
                        {creativeFlow.product?.id === p.id && (
                          <div className="absolute top-2 right-2 bg-blue-600 text-white p-1 rounded-full"><CheckCircle size={12} /></div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
  
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-4">2. Quantity</label>
                    <select 
                      value={creativeFlow.quantity}
                      onChange={(e) => setCreativeFlow((prev: any) => ({ ...prev, quantity: parseInt(e.target.value) }))}
                      className="w-full bg-slate-50 border border-slate-200 py-3.5 px-4 rounded-2xl text-sm font-bold outline-none"
                    >
                      {[3, 5, 10, 15].map(q => <option key={q} value={q}>{q} Variations</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-4">3. Creative Strategy</label>
                    <div className="relative">
                      <Sparkles size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-500 animate-pulse pointer-events-none" />
                      <select 
                        value={creativeFlow.creativeCategory || 'Premium'}
                        onChange={(e) => {
                          const cat = e.target.value;
                          setCreativeFlow((prev: any) => ({ 
                            ...prev, 
                            creativeCategory: cat,
                            isOrganic: cat === 'High Converting'
                          }));
                        }}
                        className="w-full bg-slate-50 border border-slate-200 py-3.5 pl-11 pr-10 rounded-2xl text-sm font-bold outline-none cursor-pointer hover:bg-slate-100/50 appearance-none transition-all h-[52px]"
                      >
                        {[
                          'Premium',
                          'High Converting'
                        ].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
  
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-4">4. Additional Context (Optional)</label>
                  <textarea 
                    value={creativeFlow.instructions}
                    onChange={(e) => setCreativeFlow((prev: any) => ({ ...prev, instructions: e.target.value }))}
                    placeholder="e.g. Focus on the spacious balcony or the premium marble flooring..."
                    className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl text-sm font-medium outline-none h-24"
                  />
                </div>
              </div>
            )}
  
            {currentStep === 'angles' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex justify-between items-center bg-blue-50/50 p-4 rounded-2xl border border-blue-100 mb-6">
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">Select hooks to render</p>
                  <button 
                     onClick={handleGenerateAngles}
                     disabled={creativeFlow.status === 'loading'}
                     className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-full hover:bg-slate-50 transition-all flex items-center gap-1"
                  >
                     <RefreshCw size={12} className={creativeFlow.status === 'loading' ? 'animate-spin' : ''} /> More Options
                  </button>
                </div>
  
                <div className="space-y-3">
                  {creativeFlow.angles.map((angle: any, i: number) => {
                    const isSelected = creativeFlow.selectedAngles.includes(i);
                    return (
                      <div 
                        key={i}
                        onClick={() => setCreativeFlow((prev: any) => ({
                          ...prev,
                          selectedAngles: isSelected 
                            ? prev.selectedAngles.filter((idx: number) => idx !== i)
                            : [...prev.selectedAngles, i]
                        }))}
                        className={`p-5 rounded-[1.5rem] border-2 transition-all cursor-pointer group relative overflow-hidden ${
                          isSelected ? 'border-blue-600 bg-blue-50/30' : 'border-slate-100 hover:border-slate-200 bg-slate-50/30'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-700 transition-colors">{angle.title}</h4>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                            {isSelected && <CheckCircle size={12} />}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed font-medium mb-3">{angle.brief}</p>
                        <div className="bg-white/60 p-3 rounded-xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><ImageIcon size={12}/> Visual Concept</p>
                          <p className="text-[10px] text-slate-700 font-bold italic">"{angle.visual_concept}"</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
  
            {currentStep === 'rendering' && (
              <div className="flex flex-col items-center justify-center py-20 animate-in fade-in zoom-in-95">
                <div className="relative mb-8">
                  <div className="w-24 h-24 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center text-blue-600">
                    <Sparkles size={32} className="animate-pulse" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Batch Rendering Pipeline</h3>
                <p className="text-sm text-slate-500 font-medium text-center max-w-sm">
                  Generating {creativeFlow.selectedAngles.length} variations in high-fidelity 4:5 aspect ratio. This may take up to 60 seconds...
                </p>
                
                <div className="w-full max-w-xs bg-slate-100 h-1.5 rounded-full mt-8 overflow-hidden">
                  <div className="bg-blue-600 h-full w-1/2 animate-shimmer" style={{backgroundSize: '200% 100%'}} />
                </div>
              </div>
            )}
  
            {currentStep === 'final' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 text-center">
                  <p className="text-sm font-bold text-emerald-800">Batch generation complete! Preview tasks below.</p>
                  <p className="text-[10px] text-emerald-600 uppercase tracking-widest font-bold mt-1">Generated assets will be saved to your "Campaign Ready" bucket.</p>
                </div>
  
                <div className="grid grid-cols-1 gap-4">
                  {creativeFlow.generatedAssets.map((asset: any, i: number) => (
                    <div key={i} className="bg-white border border-slate-200 rounded-[1.5rem] p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                      <div className="w-20 h-20 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-100 flex-shrink-0">
                        <ImageIcon size={24} className="text-slate-300" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <h4 className="text-xs font-bold text-slate-800 uppercase truncate">{asset.title}</h4>
                        <p className="text-[10px] text-slate-500 font-medium mt-1 truncate">Task ID: {asset.taskId}</p>
                        <div className="flex gap-2 mt-2">
                          <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase">Render Queued</span>
                          <span className="text-[9px] font-bold bg-slate-50 text-slate-400 px-2 py-0.5 rounded-full uppercase tracking-tighter italic">"Campaign Ready" Bucket</span>
                        </div>
                      </div>
                      <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl border border-emerald-100 shadow-sm">
                        <CheckCircle size={18} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
  
          </div>
  
          <div className="p-6 border-t border-slate-100 bg-white flex justify-between items-center">
            {currentStep !== 'setup' && currentStep !== 'rendering' ? (
              <button 
                onClick={() => setCreativeFlow((prev: any) => ({ ...prev, step: currentStep === 'angles' ? 'setup' : 'angles' }))}
                className="bg-slate-100 text-slate-600 px-6 py-3 rounded-2xl font-bold hover:bg-slate-200 transition-colors"
              >
                Back
              </button>
            ) : <div />}
  
            <button 
              disabled={
                (currentStep === 'setup' && !creativeFlow.product) ||
                (currentStep === 'angles' && creativeFlow.selectedAngles.length === 0) ||
                creativeFlow.status === 'loading'
              }
              onClick={() => {
                if (currentStep === 'setup') handleGenerateAngles();
                else if (currentStep === 'angles') handleStartBatchRendering();
                else if (currentStep === 'final') setCreativeFlow((prev: any) => ({ ...prev, isOpen: false }));
              }}
              className="bg-blue-600 text-white px-8 py-3.5 rounded-2xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {creativeFlow.status === 'loading' ? <Loader2 className="animate-spin" size={18} /> : (
                <>
                  {currentStep === 'setup' ? 'Next: Strategy Review' : currentStep === 'angles' ? `Generate ${creativeFlow.selectedAngles.length} Creatives` : 'Done'}
                  {currentStep !== 'final' && <Plus size={18} />}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }