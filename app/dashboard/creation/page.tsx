'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Building2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// --- TYPES ---
type Message = {
  id: number
  role: 'user' | 'ai'
  text: string
  mediaUrl?: string
  mediaType?: 'image' | 'video'
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

// --- THE AI DESIGN BRAIN (Reference Styles) ---
const DESIGN_STYLES = [
  {
    name: "The Investor (Split Layout)",
    prompt: "Design a high-contrast real estate flyer optimized for investors. \n\nVISUAL STYLE:\n- Use a split layout: Top 60% property photos, Bottom 40% solid background.\n- Use Bold, Green/Teal typography.\n- Vibe: Professional, High ROI, Urgent."
  },
  {
    name: "Luxury Full-Bleed",
    prompt: "Create a premium, cinematic real estate poster. \n\nVISUAL STYLE:\n- Use the best property photo as a full-screen background.\n- Overlay a sleek, semi-transparent glass card at the bottom.\n- Vibe: Expensive, Elegant, Serif Fonts, Minimalist."
  },
  {
    name: "Modern Geometric",
    prompt: "Design a trendy, modern social media graphic. \n\nVISUAL STYLE:\n- Use a geometric frame or border around the property photos.\n- Use a clean white background for the text area.\n- Vibe: Fresh, Gen-Z, Pop of Color, Sans-Serif."
  }
]

export default function CreationPage() {
  const supabase = createClient()
  
  // State
  const [mode, setMode] = useState<'image' | 'video'>('image')
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: 'ai', text: 'Select a property, and I will design a creative asset for it. You can add specific instructions like "make it dark theme" or "no price".' }
  ])
  
  // Data State
  const [properties, setProperties] = useState<Property[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selectedPropId, setSelectedPropId] = useState<string>('')
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 1. Fetch Data (Profile + Properties)
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Get Profile
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (profileData) setProfile(profileData)

      // Get Properties (Explicit Selection to ensure fields are grabbed)
      const { data: props } = await supabase
        .from('properties')
        .select('id, title, address, price, images, image_url, description, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      
      if (props) {
        console.log("--- DEBUG: LOADED PROPERTIES ---")
        console.log(props) // Check your Browser Console for this!
        setProperties(props)
      }
    }
    init()
  }, [])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isThinking])

  // Helper: Detect Aspect Ratio
  const detectAspectRatio = (text: string, currentMode: string) => {
    const t = text.toLowerCase()
    if (t.includes('landscape') || t.includes('horizontal') || t.includes('wide')) return '16:9'
    if (t.includes('portrait') || t.includes('vertical') || t.includes('tall')) return '9:16'
    if (t.includes('square') || t.includes('1:1')) return '1:1'
    
    return currentMode === 'video' ? '9:16' : '1:1'
  }

  // 2. Handle Send
  const handleSend = async () => {
    if (isThinking) return
    
    const userText = input.trim() || (selectedPropId ? "Generate a creative design." : "Surprise me.")
    const userMsg: Message = { id: Date.now(), role: 'user', text: userText }
    setMessages(prev => [...prev, userMsg])
    
    setInput('')
    setIsThinking(true)

    try {
      // A. Validation
      const prop = properties.find(p => p.id === selectedPropId)
      if (!prop) throw new Error("Please select a property first.")

      console.log("--- DEBUG: SENDING PROPERTY DATA ---")
      console.log("Title:", prop.title)
      console.log("Desc:", prop.description)

      // B. Build Image Array (Top 2 Photos + Logo)
      let propImages: string[] = []
      if (prop.images && prop.images.length > 0) {
        propImages = prop.images.slice(0, 2)
      } else if (prop.image_url) {
        propImages = [prop.image_url]
      }

      // Add Logo (Unless user opted out)
      if (profile?.logo_url && !userText.toLowerCase().includes("no logo")) {
        propImages.push(profile.logo_url)
      }

      // C. Detect Dimensions
      const targetRatio = detectAspectRatio(userText, mode)
      const orientationText = targetRatio === '16:9' ? 'Landscape' : targetRatio === '9:16' ? 'Portrait' : 'Square'

      // D. Pick Random Style
      const randomStyle = DESIGN_STYLES[Math.floor(Math.random() * DESIGN_STYLES.length)]
      
      // E. Construct the Master Prompt
      let finalPrompt = randomStyle.prompt
        .replace('[LOCATION]', prop.address)
        .replace('[PRICE]', prop.price)
        .replace('[PHONE]', profile?.contact_number || "DM for info")
      
      finalPrompt += `
        \n--- GENERATION SPECS ---
        TARGET DIMENSION: ${orientationText} (${targetRatio}). Ensure layout fits this shape.
        PROPERTY TITLE: "${prop.title}"
        PROPERTY DESCRIPTION: "${prop.description || ''}"
        USER EXTRA INSTRUCTIONS: "${userText}"
        BRAND NAME: "${profile?.business_name || "Real Estate"}"
        BRAND COLOR: "${profile?.brand_color || "Teal"}"
        Use the provided input images (Property Photos + Logo).
      `

      // F. Send to API (Forwarding raw ingredients too)
      const startResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            // RAW INGREDIENTS (For n8n Logic)
            userInstructions: userText,
            propertyDescription: prop.description || "",
            propertyTitle: prop.title || "",
            contactNumber: profile?.contact_number || "",
            businessName: profile?.business_name || "",
            
            // COMPILED PROMPT (For fallback)
            message: finalPrompt, 
            
            // TECHNICAL SPECS
            mode: mode,
            imageUrls: propImages, 
            aspectRatio: targetRatio 
        })
      })
      
      const startData = await startResponse.json()
      
      let finalImageUrl = ''

      // CASE 1: Immediate Result (Synchronous n8n flow)
      // Your current n8n flow finishes and returns { "text": "...", "image": "URL" }
      if (startData.image) {
        finalImageUrl = startData.image
      } 
      // CASE 2: Async Result (Polling required)
      else if (startData.taskId) {
        const taskId = startData.taskId 
        let attempts = 0
        const maxAttempts = 30 // 30 * 4s = 120s timeout

        // Polling Loop
        while (attempts < maxAttempts) {
            attempts++
            // Wait 4 seconds between checks
            await new Promise(resolve => setTimeout(resolve, 4000))

            const checkResponse = await fetch('/api/check-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId })
            })

            const checkData = await checkResponse.json()
            
            // Success Check
            if (checkData.data && checkData.data.resultJson) {
                try {
                    const resultObj = JSON.parse(checkData.data.resultJson)
                    if (resultObj.resultUrls?.[0]) {
                        finalImageUrl = resultObj.resultUrls[0]
                        break // EXIT LOOP
                    }
                } catch(e) { console.error("JSON Parse Error in polling", e)}
            } 
            else if (checkData.data && checkData.data.state === 'success' && checkData.data.resultUrl) {
                finalImageUrl = checkData.data.resultUrl
                break // EXIT LOOP
            }
            else if (checkData.data && checkData.data.state === 'failed') {
                throw new Error("Generation failed: " + (checkData.data.failMsg || "Unknown error"))
            }
            
            // If still 'processing' or 'queueing', the loop continues...
        }
      }

      if (finalImageUrl) {
        // Auto-Save to Drafts (Only if not already saved by n8n)
        // Since n8n flow also has "Create a row", we might duplicate it, 
        // but frontend doesn't know what n8n did. This is a safe backup.
        if (profile) {
            await supabase.from('daily_drafts').insert({
                user_id: profile.id,
                image_url: finalImageUrl,
                caption: `🔥 ${prop.title}! ${prop.price}. Contact: ${profile.contact_number}`,
                status: 'pending'
            })
        }

        const aiMsg: Message = { 
          id: Date.now() + 1, 
          role: 'ai', 
          text: `I've created a ${orientationText} design using the "${randomStyle.name}" style. It's saved to your Drafts!`,
          mediaType: mode,
          mediaUrl: finalImageUrl
        }
        setMessages(prev => [...prev, aiMsg])
      } else {
         throw new Error("Generation timed out. Please check your Assets tab later.")
      }

    } catch (error: any) {
      const errorMsg: Message = { id: Date.now() + 1, role: 'ai', text: "Error: " + error.message }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsThinking(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-surface">
      
      {/* --- HEADER --- */}
      <div className="bg-white px-5 py-3 shadow-sm z-10 space-y-3">
        <div className="flex justify-between items-center">
            <h1 className="text-lg font-bold text-slate-800">Creator</h1>
            <div className="bg-slate-100 p-1 rounded-full flex">
                <button onClick={() => setMode('image')} className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${mode === 'image' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Image</button>
                <button onClick={() => setMode('video')} className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${mode === 'video' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Video</button>
            </div>
        </div>

        {/* Property Selector */}
        <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select 
                value={selectedPropId}
                onChange={(e) => setSelectedPropId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 text-slate-700 text-sm rounded-xl py-2.5 pl-9 pr-4 appearance-none focus:ring-2 focus:ring-primary outline-none"
            >
                <option value="">-- Select Property (Required) --</option>
                {properties.map(p => (
                    <option key={p.id} value={p.id}>
                        {p.title}
                    </option>
                ))}
            </select>
        </div>
      </div>

      {/* --- CHAT --- */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {msg.role === 'ai' && <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center mr-2 flex-shrink-0 mt-1"><Bot size={14} className="text-primary-text" /></div>}
              <div className="flex flex-col gap-2">
                <div className={`p-3 text-sm font-medium leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-slate-800 text-white rounded-2xl rounded-tr-sm' : 'bg-white text-slate-700 border border-slate-100 rounded-2xl rounded-tl-sm'}`}>
                  {msg.text}
                </div>
                {msg.mediaUrl && (
                  <div className={`overflow-hidden rounded-2xl border-4 border-white shadow-md bg-slate-100 ${msg.mediaType === 'image' ? 'w-48 h-48' : 'w-36 h-64'}`}>
                    <img src={msg.mediaUrl} alt="Generated content" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {isThinking && <div className="flex gap-2 text-xs text-slate-400 ml-8"><Loader2 size={14} className="animate-spin" /> Designing with your photos...</div>}
        <div ref={chatEndRef} />
      </div>

      {/* INPUT */}
      <div className="p-4 bg-surface pb-6">
        <div className="relative flex items-center">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder={selectedPropId ? "Instructions (e.g. no price)..." : "Select a property above..."} disabled={isThinking || !selectedPropId} className="w-full bg-white border-none py-3 pl-5 pr-12 rounded-full shadow-lg shadow-blue-50 text-sm text-slate-700 focus:ring-2 focus:ring-primary outline-none disabled:opacity-50" />
          <button onClick={handleSend} disabled={isThinking || !selectedPropId} className="absolute right-2 bg-primary hover:bg-blue-300 text-primary-text p-2 rounded-full transition-colors disabled:opacity-50"><Send size={16} strokeWidth={2.5} /></button>
        </div>
      </div>

    </div>
  )
}