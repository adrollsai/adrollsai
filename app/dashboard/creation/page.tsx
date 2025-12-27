'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Layout, Sparkles, X, Check, Upload, Package } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'

// --- TYPES ---
type Message = {
  id: number
  role: 'user' | 'ai'
  text: string
  mediaUrl?: string
  mediaType?: 'image' | 'video'
  steps?: string[]
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
const TEMPLATES: { id: string, name: string, url: string }[] = [
  // { id: 't1', name: 'Minimalist', url: '...' },
]

const ASPECT_RATIOS = [
  { label: 'Square (1:1)', value: '1:1', icon: 'square' },
  { label: 'Portrait (4:5)', value: '4:5', icon: 'portrait' },
  { label: 'Story (9:16)', value: '9:16', icon: 'smartphone' }
]

export default function CreationPage() {
  const supabase = createClient()
  
  // State
  const [mode, setMode] = useState<'image' | 'video'>('image')
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [currentStep, setCurrentStep] = useState<string>('') 
  
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: 'ai', text: 'Ready to design! Select a product or just type an idea. You can also upload a reference style.' }
  ])
  
  // Configuration State
  const [selectedRatio, setSelectedRatio] = useState('1:1')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  
  // Custom Reference State
  const [uploadedRefUrl, setUploadedRefUrl] = useState<string | null>(null)
  const [isUploadingRef, setIsUploadingRef] = useState(false)
  const refFileInputRef = useRef<HTMLInputElement>(null)
  
  // Data State
  const [properties, setProperties] = useState<Property[]>([]) 
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selectedPropId, setSelectedPropId] = useState<string>('')
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 1. Fetch Data
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (profileData) {
          setProfile(profileData)
          console.log("[LOG] Profile Loaded. Logo URL:", profileData.logo_url)
      } else {
          console.warn("[LOG] Profile Data Missing or Empty")
      }

      const { data: props } = await supabase
        .from('properties')
        .select('id, title, address, price, images, image_url, description, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      
      if (props) setProperties(props)
    }
    init()
  }, [])

  // 2. Prevent Accidental Navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (isThinking) {
            e.preventDefault();
            e.returnValue = ''; // Chrome requires returnValue to be set
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isThinking]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isThinking, currentStep])

  // Helper: Handle Reference Upload (R2)
  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsUploadingRef(true);
    try {
        const file = e.target.files[0];
        const fileExt = file.name.split('.').pop();
        const newFileName = `reference-${Date.now()}.${fileExt}`;
        const renamedFile = new File([file], newFileName, { type: file.type });

        console.log("[LOG] Uploading Reference:", newFileName);
        const publicUrl = await uploadToR2(renamedFile, 'references');
        console.log("[LOG] Reference Uploaded:", publicUrl);

        setUploadedRefUrl(publicUrl);
        setSelectedTemplate(null); 
    } catch (error: any) {
        alert("Upload failed: " + error.message);
        console.error(error);
    } finally {
        setIsUploadingRef(false);
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
    setCurrentStep('Initializing Design Engine...')

    try {
      // A. Prepare Data
      const prop = properties.find(p => p.id === selectedPropId)
      
      let propImages: string[] = []
      if (prop) {
        if (prop.images && prop.images.length > 0) propImages = prop.images.slice(0, 2)
        else if (prop.image_url) propImages = [prop.image_url]
      }

      const templateObj = TEMPLATES.find(t => t.id === selectedTemplate)
      const activeReferenceUrl = uploadedRefUrl || templateObj?.url || null

      console.log("[LOG] Sending Request:", {
          instructions: userText,
          product: prop?.title,
          hasLogo: !!profile?.logo_url,
          logoUrl: profile?.logo_url,
          reference: activeReferenceUrl
      });

      // B. Send to API
      const startResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            userInstructions: userText,
            propertyDescription: prop?.description || "",
            propertyTitle: prop?.title || "",
            contactNumber: profile?.contact_number || "",
            businessName: profile?.business_name || "",
            logoUrl: profile?.logo_url || "", // Explicitly passing logo
            
            // Context
            propImages: propImages,
            templateUrl: activeReferenceUrl, 
            
            // Config
            mode: mode,
            aspectRatio: selectedRatio
        })
      })
      
      const startData = await startResponse.json()
      if (startData.error) throw new Error(startData.error)

      setCurrentStep('Generating Visuals (Please wait)...')
      
      // C. Poll for Result
      if (startData.taskId) {
        const taskId = startData.taskId 
        let attempts = 0
        const maxAttempts = 30 
        let finalImageUrl = ''

        while (attempts < maxAttempts) {
            attempts++
            await new Promise(resolve => setTimeout(resolve, 4000))

            console.log(`[LOG] Polling Attempt ${attempts}/${maxAttempts} for Task: ${taskId}`);

            const checkResponse = await fetch('/api/check-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId })
            })

            const checkData = await checkResponse.json()
            
            if (checkData.data && checkData.data.state === 'success') { 
                console.log("[LOG] Generation Success:", checkData.data);
                if (checkData.data.resultJson) {
                    try {
                        const resultObj = JSON.parse(checkData.data.resultJson)
                        if (resultObj.resultUrls?.[0]) {
                            finalImageUrl = resultObj.resultUrls[0]
                            break 
                        }
                    } catch(e) {}
                } else if (checkData.data.resultUrl) {
                    finalImageUrl = checkData.data.resultUrl
                    break 
                }
            } else if (checkData.data && checkData.data.state === 'failed') {
                console.error("[LOG] Generation Failed:", checkData.data.failMsg);
                throw new Error("Generation failed: " + (checkData.data.failMsg || "Unknown error"))
            }
        }

        if (finalImageUrl) {
            console.log("[LOG] Final Image URL:", finalImageUrl);
            // Save to DB
            if (profile) {
                const { error: dbError } = await supabase.from('assets').insert({
                    user_id: profile.id,
                    url: finalImageUrl,
                    type: mode,
                    status: 'Draft'
                })
                if (dbError) console.error("[LOG] DB Save Error:", dbError);
                else console.log("[LOG] Saved to Assets Table");
            }

            const aiMsg: Message = { 
              id: Date.now() + 1, 
              role: 'ai', 
              text: `Here is your design!`, 
              mediaType: mode,
              mediaUrl: finalImageUrl
            }
            setMessages(prev => [...prev, aiMsg])
        } else {
            throw new Error("Generation timed out.")
        }
      }

    } catch (error: any) {
      console.error("[LOG] Error in handleSend:", error);
      const errorMsg: Message = { id: Date.now() + 1, role: 'ai', text: "Error: " + error.message }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsThinking(false)
      setCurrentStep('')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-surface">
      
      {/* --- HEADER --- */}
      <div className="bg-white border-b border-slate-100 z-10 flex-shrink-0">
        <div className="px-4 py-3 flex justify-between items-center">
            <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Sparkles size={18} className="text-primary" />
                Creator
            </h1>
            <div className="bg-slate-100 p-1 rounded-full flex">
                <button onClick={() => setMode('image')} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${mode === 'image' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Image</button>
                <button onClick={() => setMode('video')} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${mode === 'video' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Video</button>
            </div>
        </div>

        {/* CONTROLS BAR */}
        <div className="px-4 pb-3 overflow-x-auto scrollbar-hide flex gap-3 items-center">
            
            {/* Product Selector */}
            <div className="relative min-w-[200px]">
                <Package size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select 
                    value={selectedPropId}
                    onChange={(e) => setSelectedPropId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg py-2.5 pl-9 pr-4 appearance-none focus:ring-1 focus:ring-primary outline-none"
                >
                    <option value="">-- Select Product --</option>
                    {properties.map(p => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                </select>
            </div>

            <div className="h-6 w-px bg-slate-200 mx-1 flex-shrink-0" />

            {/* Aspect Ratio */}
            <div className="flex bg-slate-50 rounded-lg p-1 border border-slate-200">
                {ASPECT_RATIOS.map(ratio => (
                    <button 
                        key={ratio.value}
                        onClick={() => setSelectedRatio(ratio.value)}
                        className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all flex items-center gap-1 ${selectedRatio === ratio.value ? 'bg-white shadow text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {ratio.value}
                    </button>
                ))}
            </div>
        </div>
        
        {/* TEMPLATES & UPLOAD BAR */}
        <div className="px-4 pb-3 overflow-x-auto scrollbar-hide flex gap-3">
             {/* Auto Button */}
             <button 
                onClick={() => { setSelectedTemplate(null); setUploadedRefUrl(null); }}
                className={`flex-shrink-0 w-20 h-20 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${selectedTemplate === null && uploadedRefUrl === null ? 'border-primary bg-blue-50' : 'border-dashed border-slate-200 text-slate-400'}`}
             >
                <Layout size={18} />
                <span className="text-[10px] font-bold">Auto</span>
             </button>

             {/* Upload Reference Button */}
             <div className="relative">
                 <button 
                    onClick={() => refFileInputRef.current?.click()}
                    className={`flex-shrink-0 w-20 h-20 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all ${uploadedRefUrl ? 'border-primary ring-2 ring-blue-100 overflow-hidden p-0' : 'border-dashed border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500'}`}
                 >
                    {uploadedRefUrl ? (
                        <img src={uploadedRefUrl} className="w-full h-full object-cover" />
                    ) : (
                        <>
                            {isUploadingRef ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                            <span className="text-[9px] font-bold text-center px-1 leading-tight">Upload<br/>Ref</span>
                        </>
                    )}
                 </button>
                 {/* Hidden Input */}
                 <input type="file" ref={refFileInputRef} onChange={handleReferenceUpload} className="hidden" accept="image/*" />
                 
                 {/* Clear Upload Button */}
                 {uploadedRefUrl && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); setUploadedRefUrl(null); }}
                        className="absolute -top-1 -right-1 bg-slate-800 text-white rounded-full p-0.5"
                    >
                        <X size={10} />
                    </button>
                 )}
             </div>

             {/* Preset Templates */}
             {TEMPLATES.map(t => (
                 <button 
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t.id); setUploadedRefUrl(null); }}
                    className={`flex-shrink-0 w-20 h-20 rounded-xl border-2 relative overflow-hidden transition-all group ${selectedTemplate === t.id ? 'border-primary ring-2 ring-blue-100' : 'border-transparent opacity-70 hover:opacity-100'}`}
                 >
                    <img src={t.url} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="text-white text-[9px] font-bold">{t.name}</span>
                    </div>
                    {selectedTemplate === t.id && <div className="absolute top-1 right-1 bg-primary text-white p-0.5 rounded-full"><Check size={10} /></div>}
                 </button>
             ))}
        </div>
      </div>

      {/* --- CHAT AREA --- */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              
              {msg.role === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mr-2 flex-shrink-0 mt-1 shadow-md">
                    <Bot size={16} className="text-white" />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className={`p-4 text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-slate-800 text-white rounded-2xl rounded-tr-sm' : 'bg-white text-slate-700 border border-slate-100 rounded-2xl rounded-tl-sm'}`}>
                  {msg.text}
                </div>
                {msg.mediaUrl && (
                  <div className={`relative overflow-hidden rounded-2xl border-4 border-white shadow-lg group ${msg.mediaType === 'image' ? 'w-64' : 'w-48'}`}>
                    <img src={msg.mediaUrl} alt="Generated content" className="w-full h-auto object-cover" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {/* Progress Indicator */}
        {isThinking && (
             <div className="flex items-start gap-3 w-full animate-in fade-in slide-in-from-bottom-2">
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-1">
                    <Loader2 size={16} className="text-slate-500 animate-spin" />
                </div>
                <div className="bg-white p-4 rounded-2xl rounded-tl-sm border border-blue-100 shadow-sm max-w-[80%]">
                    <p className="text-sm font-bold text-slate-800 mb-1">Working on it...</p>
                    <p className="text-xs text-blue-600 font-medium animate-pulse">{currentStep}</p>
                    <p className="text-[10px] text-red-400 mt-2 font-semibold">Do not close this tab or navigate away.</p>
                </div>
             </div>
        )}
        <div ref={chatEndRef} className="h-4" />
      </div>

      {/* --- INPUT AREA --- */}
      <div className="bg-white p-3 border-t border-slate-100">
        {/* WRAPPED IN FORM TO PREVENT DEFAULT SUBMIT RELOAD */}
        <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="relative flex items-center max-w-4xl mx-auto pr-20 md:pr-24"
        >
          <input 
            type="text" 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            placeholder={selectedPropId ? "Instructions (e.g. 'Make it look luxurious')..." : "Describe what to generate..."} 
            disabled={isThinking} 
            className="w-full bg-slate-50 border border-slate-200 py-3.5 pl-5 pr-4 rounded-full text-sm text-slate-700 focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50" 
          />
          <button 
            type="submit" 
            disabled={isThinking || (!input.trim() && !selectedPropId)} 
            className="absolute right-24 md:right-28 bg-slate-900 hover:bg-slate-700 text-white p-2 rounded-full transition-all disabled:opacity-50 disabled:bg-slate-300 shadow-lg shadow-slate-200"
          >
            <Send size={18} className="ml-0.5" />
          </button>
        </form>
      </div>

    </div>
  )
}