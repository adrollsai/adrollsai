'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, X, Share2, Building2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type Message = {
  id: number
  role: 'user' | 'ai'
  text: string
  mediaUrl?: string
  mediaType?: 'image' | 'video'
}

type Draft = { id: string, image_url: string, caption: string, status: string }
type Property = { id: string, title: string, address: string, description?: string }

export default function CreationPage() {
  const supabase = createClient()
  
  const [mode, setMode] = useState<'image' | 'video'>('image')
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: 'ai', text: 'Hi! Select a property and I will generate creative assets for it.' }
  ])
  
  // Data State
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [selectedPropId, setSelectedPropId] = useState<string>('')
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 1. Fetch Data
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch Properties for Selector
      const { data: props } = await supabase.from('properties').select('id, title, address, description').eq('user_id', user.id)
      if (props) setProperties(props)

      // Fetch Drafts
      const { data: draftsData } = await supabase.from('daily_drafts').select('*').eq('user_id', user.id).eq('status', 'pending')
      if (draftsData) setDrafts(draftsData)
    }
    init()
  }, [])

  // Scroll to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isThinking])

  // 2. Handle Send with Property Context
  const handleSend = async () => {
    if (isThinking) return
    
    // Construct the User's displayed message
    const userText = input.trim() || (selectedPropId ? "Create a design for this property." : "Surprise me.")
    const userMsg: Message = { id: Date.now(), role: 'user', text: userText }
    setMessages(prev => [...prev, userMsg])
    
    setInput('')
    setIsThinking(true)

    // Find selected property details
    const prop = properties.find(p => p.id === selectedPropId)
    
    // Construct the "Rich Prompt" for the AI
    let aiPrompt = input
    if (prop) {
        aiPrompt = `
          Property: ${prop.title} located at ${prop.address}. 
          Details: ${prop.description || ''}. 
          User Instructions: ${input || "Create a high-converting social media visual."}
        `
    }

    try {
      const startResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            message: aiPrompt, // We send the enhanced prompt
            mode: mode 
        })
      })
      
      const startData = await startResponse.json()
      const taskId = startData.taskId 

      // Wait loop
      await new Promise(resolve => setTimeout(resolve, 15000))

      const checkResponse = await fetch('/api/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      })

      const checkData = await checkResponse.json()
      let finalImageUrl = ''
      if (checkData.data && checkData.data.resultJson) {
         const resultObj = JSON.parse(checkData.data.resultJson)
         finalImageUrl = resultObj.resultUrls[0]
      }

      if (finalImageUrl) {
        const aiMsg: Message = { 
          id: Date.now() + 1, 
          role: 'ai', 
          text: "Here is the design based on your property data.",
          mediaType: mode,
          mediaUrl: finalImageUrl
        }
        setMessages(prev => [...prev, aiMsg])
      } else {
         throw new Error("Processing...")
      }

    } catch (error) {
      const errorMsg: Message = { id: Date.now() + 1, role: 'ai', text: "Generation failed or timed out." }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsThinking(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-surface">
      
      {/* --- PROPERTY SELECTOR HEADER --- */}
      <div className="bg-white px-5 py-3 shadow-sm z-10 space-y-3">
        
        {/* Title & Toggle */}
        <div className="flex justify-between items-center">
            <h1 className="text-lg font-bold text-slate-800">Creator</h1>
            <div className="bg-slate-100 p-1 rounded-full flex">
                <button onClick={() => setMode('image')} className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${mode === 'image' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Image</button>
                <button onClick={() => setMode('video')} className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${mode === 'video' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Video</button>
            </div>
        </div>

        {/* Dropdown */}
        <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select 
                value={selectedPropId}
                onChange={(e) => setSelectedPropId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 text-slate-700 text-sm rounded-xl py-2.5 pl-9 pr-4 appearance-none focus:ring-2 focus:ring-primary outline-none"
            >
                <option value="">-- Select Property (Optional) --</option>
                {properties.map(p => (
                    <option key={p.id} value={p.id}>
                        {p.title.substring(0, 25)}...
                    </option>
                ))}
            </select>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Drafts Scroll (Hidden if empty) */}
        {drafts.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2 mb-4 border-b border-slate-100">
                {drafts.map(d => (
                    <div key={d.id} className="w-40 flex-shrink-0 bg-white p-2 rounded-xl shadow-sm border border-slate-100">
                        <img src={d.image_url} className="w-full h-24 object-cover rounded-lg mb-2" />
                        <button className="w-full bg-slate-900 text-white text-[10px] py-1.5 rounded-lg">Post</button>
                    </div>
                ))}
            </div>
        )}

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
        {isThinking && <div className="flex gap-2 text-xs text-slate-400 ml-8"><Loader2 size={14} className="animate-spin" /> Designing...</div>}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-surface pb-6">
        <div className="relative flex items-center">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder={selectedPropId ? "Instructions (e.g. Add sunset vibe)..." : "Describe your idea..."} disabled={isThinking} className="w-full bg-white border-none py-3 pl-5 pr-12 rounded-full shadow-lg shadow-blue-50 text-sm text-slate-700 focus:ring-2 focus:ring-primary outline-none disabled:opacity-50" />
          <button onClick={handleSend} disabled={isThinking} className="absolute right-2 bg-primary hover:bg-blue-300 text-primary-text p-2 rounded-full transition-colors disabled:opacity-50"><Send size={16} strokeWidth={2.5} /></button>
        </div>
      </div>

    </div>
  )
}