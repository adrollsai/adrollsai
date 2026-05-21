'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Layout, Sparkles, X, Check, Upload, Package, Smartphone, Square, RectangleVertical, ChevronDown, User, RefreshCw, Zap, Plus, CheckCircle, Image as ImageIcon, Video as VideoIcon } from 'lucide-react'
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
  '2f62a259-f23b-48ee-a920-c436f36eaa4b'
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
  const [selectedPropId, setSelectedPropId] = useState<string>('')
  
  // Chat State
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [currentStep, setCurrentStep] = useState<string>('') 
  const [chatAttachments, setChatAttachments] = useState<string[]>([])
  const [isUploadingChat, setIsUploadingChat] = useState(false)
  const chatFileInputRef = useRef<HTMLInputElement>(null)

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
  
  // Custom Reference State
  const [uploadedRefUrl, setUploadedRefUrl] = useState<string | null>(null)
  const [isUploadingRef, setIsUploadingRef] = useState(false)
  const refFileInputRef = useRef<HTMLInputElement>(null)
  
  // NEW: Creation Mode Toggle
  const [creationMode, setCreationMode] = useState<'image' | 'video'>('image')
  
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
    isOrganic: true,
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
              previousAngles: (creativeFlow.angles || []).map((a: any) => a.title).join(', ')
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
            const payload = {
                propertyTitle: creativeFlow.product?.title,
                propertyDescription: (creativeFlow.product?.description || "") + "\n\nANGLE: " + angle.title + "\nCONCEPT: " + angle.visual_concept,
                userInstructions: creativeFlow.instructions,
                propImages: [creativeFlow.product?.image_url],
                isOrganic: creativeFlow.isOrganic,
                aspectRatio: "4:5",
                model: 'image-2.0',
                contactNumber: profile?.contact_number,
                logoUrl: profile?.logo_url
            };

            const res = await fetch('/api/chat', {
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
            }
        } catch (e) {
            console.error("Batch error for angle:", angle.title);
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
    } catch (error: any) {
        alert("Upload failed: " + error.message);
    } finally {
        setIsUploadingRef(false);
    }
  }

  // --- CLIENT INTERACTIVE VIDEO HANDLERS ---
  const handleSelectConcept = async (concept: any, refImages: string[], imageDescriptions?: string[]) => {
    if (isThinking) return
    setIsThinking(true)
    setCurrentStep('AI Creative Director is writing your 30s Hinglish script...')

    try {
        const scriptResponse = await fetch('/api/video/script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyId: selectedPropId || null,
                concept,
                userInstructions: '', // None yet during selection
                images: refImages,
                imageDescriptions
            })
        });

        const scriptData = await scriptResponse.json();
        if (scriptData.error) throw new Error(scriptData.error);

        const aiMsg: Message = {
            id: Date.now(),
            role: 'ai',
            text: `Here is the drafted script for **${scriptData.title}**! 🎬\n\nReview the dialogue, visuals, and final caption below.`,
            script: {
                title: scriptData.title,
                dialogue: scriptData.dialogue,
                visuals: scriptData.visuals,
                scenes: scriptData.scenes,
                finalCaption: scriptData.finalCaption,
                concept
            },
            refImages: scriptData.refImages || refImages,
            imageDescriptions: scriptData.imageDescriptions || imageDescriptions
        };
        setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
        toast.error("Failed to generate script: " + error.message);
        const errorMsg: Message = { id: Date.now(), role: 'ai', text: "Error: " + error.message }
        setMessages(prev => [...prev, errorMsg])
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
        const scriptResponse = await fetch('/api/video/script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyId: selectedPropId || null,
                concept,
                userInstructions: '',
                images: refImages,
                imageDescriptions,
                variation: true
            })
        });

        const scriptData = await scriptResponse.json();
        if (scriptData.error) throw new Error(scriptData.error);

        setMessages(prev => prev.map(m => {
            if (m.id === messageId) {
                return {
                    ...m,
                    text: `Here is a fresh variation for **${scriptData.title}**! 🎬\n\nReview the dialogue, visuals, and final caption below.`,
                    script: {
                        title: scriptData.title,
                        dialogue: scriptData.dialogue,
                        visuals: scriptData.visuals,
                        scenes: scriptData.scenes,
                        finalCaption: scriptData.finalCaption,
                        concept
                    },
                    refImages: scriptData.refImages || refImages,
                    imageDescriptions: scriptData.imageDescriptions || imageDescriptions
                }
            }
            return m
        }))
        toast.success("Script variation generated! ✨");
    } catch (error: any) {
        toast.error("Failed to generate variation: " + error.message);
    } finally {
        setIsThinking(false)
        setCurrentStep('')
    }
  }

  const handleApproveVideo = async (script: any, refImages: string[], imageDescriptions?: string[]) => {
    if (isThinking) return
    setIsThinking(true)
    setCurrentStep('Starting Bytedance Seedance 2.0 Fast video task...')

    try {
        const response = await fetch('/api/video/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyId: selectedPropId || null,
                script,
                images: refImages,
                imageDescriptions
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        toast.success("Video Production Started! 🎬", {
            description: "Your 15s Bytedance Seedance 2.0 Fast video is rendering."
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
            // --- STEP 1: CONCEPTS ---
            setCurrentStep('AI Creative Director is analyzing your images & generating 5 ad concepts...');
            
            // Gather reference images (up to 4)
            const prop = properties.find(p => p.id === selectedPropId)
            let propImages: string[] = []
            if (prop) {
                if (prop.images && prop.images.length > 0) propImages = prop.images.slice(0, 4)
                else if (prop.image_url) propImages = [prop.image_url]
            }
            const refImages = [...propImages, ...chatAttachments].slice(0, 4)

            const conceptsResponse = await fetch('/api/video/concepts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propertyId: selectedPropId || null,
                    userInstructions: userText,
                    images: refImages
                })
            });

            setChatAttachments([]) // Clear attachments after sending

            const conceptsData = await conceptsResponse.json();
            if (conceptsData.error) throw new Error(conceptsData.error);

            const aiMsg: Message = {
                id: Date.now() + 1,
                role: 'ai',
                text: `I've analyzed your product and custom instructions. Here are 5 high-converting 15-second ad concepts for your UGC video. Select one to generate a script:`,
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
    if (prop.images && prop.images.length > 0) propImages = prop.images.slice(0, 2)
    else if (prop.image_url) propImages = [prop.image_url]
  }

  const templateObj = TEMPLATES.find(t => t.id === selectedTemplate)
  const activeReferenceUrl = uploadedRefUrl || templateObj?.url || null

  const startResponse = await fetch('/api/chat', {
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
        model: selectedModel 
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
        <div className="px-4 mb-3 grid grid-cols-2 md:grid-cols-3 gap-2">
            
            {ALLOWED_VIDEO_USERS.includes(userId || '') && (
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

            {/* Ratio Selector Pill */}
            <div className={`flex bg-slate-100/80 rounded-[1rem] p-1 border border-slate-200/60 w-full transition-opacity ${creationMode === 'video' ? 'opacity-50 pointer-events-none' : ''}`}>
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

            {/* Product Selector Pill (Full width on mobile, 1/3 on desktop) */}
            <div className="relative w-full">
                <Package size={14} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isLoadingProperties ? 'text-slate-400' : 'text-blue-500'}`} />
                <select 
                    value={selectedPropId}
                    onChange={(e) => setSelectedPropId(e.target.value)}
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
        
        {/* ROW 2: Templates & Reference Upload (Grid Layout) */}
        <div className="px-4 flex gap-2 w-full overflow-x-auto scrollbar-hide">
             <button 
                onClick={() => { setSelectedTemplate(null); setUploadedRefUrl(null); }}
                className={`flex-shrink-0 w-16 h-16 rounded-[1.25rem] border-2 flex flex-col items-center justify-center gap-1 transition-all ${selectedTemplate === null && uploadedRefUrl === null ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-sm' : 'border-dashed border-slate-200 text-slate-400 hover:bg-slate-50'}`}
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
                    <button 
                        onClick={(e) => { e.stopPropagation(); setUploadedRefUrl(null); }}
                        className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-1 shadow-md hover:bg-slate-700 transition-colors"
                    >
                        <X size={10} />
                     </button>
                 )}
             </div>

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

                    {msg.script.scenes && Array.isArray(msg.script.scenes) ? (
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
                              <div className="text-xs text-slate-700 leading-relaxed font-medium pl-1">
                                {renderVisualsWithBadges(scene.visuals)}
                              </div>
                            </div>

                            {/* Dialogue/Voiceover */}
                            <div className="flex flex-col gap-1 border-t border-slate-200/40 pt-2.5">
                              <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-wider flex items-center gap-1">
                                <User size={10} /> Dialogue (Hinglish)
                              </span>
                              <div className="text-xs text-slate-800 leading-relaxed font-serif italic pl-2 border-l-2 border-indigo-200/50">
                                "{scene.dialogue}"
                              </div>
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
                          <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 text-xs text-slate-700 leading-relaxed font-medium">
                            {renderVisualsWithBadges(msg.script.visuals)}
                          </div>
                        </div>

                        {/* Dialogue/Voiceover */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-wider flex items-center gap-1">
                            <User size={12} /> Conversational Audio/Dialogue (Hinglish)
                          </span>
                          <div className="bg-indigo-50/30 rounded-xl p-3.5 border border-indigo-100/50 text-xs text-slate-800 leading-relaxed font-semibold italic relative">
                            <span className="absolute -top-2 left-2 text-3xl text-indigo-200/50 select-none">“</span>
                            <p className="pl-3 pr-2 font-serif">"{msg.script.dialogue}"</p>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Suggested Caption */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Layout size={12} /> Social Media Ad Caption
                      </span>
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-xs text-slate-600 leading-relaxed font-normal whitespace-pre-wrap">
                        {msg.script.finalCaption}
                      </div>
                    </div>

                    {/* Reference Images Row */}
                    {msg.refImages && msg.refImages.length > 0 && (
                      <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
                        <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">Reference Images</span>
                        <div className="flex gap-2 flex-wrap">
                          {msg.refImages.map((url: string, i: number) => (
                            <div key={i} className="relative group w-10 h-10 rounded-lg overflow-hidden border border-slate-200 shadow-sm flex-shrink-0">
                              <img src={url} className="w-full h-full object-cover" alt="ref" />
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <span className="text-[8px] font-black text-white">IMG {i+1}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Interactive Action Buttons */}
                    {msg.id === messages[messages.length - 1]?.id && (
                      <div className="flex gap-2 mt-2 border-t border-slate-100 pt-3">
                        <button
                          onClick={() => handleApproveVideo(msg.script, msg.refImages || [], msg.imageDescriptions)}
                          disabled={isThinking}
                          className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <Sparkles size={14} /> Approve & Generate Video 🎬
                        </button>
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
        <div className="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2 px-4">
            {chatAttachments.map((url, i) => (
                <div key={i} className="relative group w-14 h-14 rounded-xl overflow-hidden border-2 border-white shadow-md flex-shrink-0">
                    <img src={url} className="w-full h-full object-cover" alt="attachment" />
                    <button 
                        onClick={() => setChatAttachments(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <X size={12} />
                    </button>
                </div>
            ))}
        </div>

        <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex items-center gap-2 max-w-4xl mx-auto relative shadow-lg shadow-slate-200/50 rounded-full bg-white border border-slate-200/60 transition-all focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-300"
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
              className="ml-2 p-3 text-slate-400 hover:text-blue-600 transition-colors rounded-full"
            >
              {isUploadingChat ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            </button>

            <input 
              type="text" 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              placeholder={selectedPropId ? "Add a prompt (e.g. 'Make it luxurious')..." : "Describe what to generate..."} 
              disabled={isThinking} 
              className="flex-1 bg-transparent py-4 pl-1 pr-16 text-sm text-slate-800 font-medium outline-none transition-all disabled:opacity-50 placeholder-slate-400" 
            />
            <button 
              type="submit" 
              disabled={isThinking || isUploadingChat || (!input.trim() && !selectedPropId && chatAttachments.length === 0)} 
              className="absolute right-1.5 top-1.5 bottom-1.5 aspect-square bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center rounded-full transition-all duration-300 disabled:opacity-50 disabled:bg-slate-200 disabled:text-slate-400 shadow-sm active:scale-90"
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
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-4">3. Vibe</label>
                    <button 
                      onClick={() => setCreativeFlow((prev: any) => ({ ...prev, isOrganic: !prev.isOrganic }))}
                      className={`w-full py-3.5 px-4 rounded-2xl text-sm font-bold border transition-all flex items-center justify-center gap-2 ${
                        creativeFlow.isOrganic ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-200 text-blue-700'
                      }`}
                    >
                      {creativeFlow.isOrganic ? <Zap size={16} /> : <ImageIcon size={16} />}
                      {creativeFlow.isOrganic ? 'Raw & Organic' : 'Hyper-Realistic Studio'}
                    </button>
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