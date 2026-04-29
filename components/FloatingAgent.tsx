'use client'

import React, { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// --- TYPES ---
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: { name: string; arguments: string }[];
}

export default function FloatingAgent() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [mood, setMood] = useState('idle') // idle, happy, cool
  const [confirmedTools, setConfirmedTools] = useState<Record<string, boolean>>({})

  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // --- MOOD LOGIC (Reacts to scroll) ---
  useEffect(() => {
    const handleScroll = () => {
      const scrollP = window.scrollY
      const windowH = window.innerHeight
      const docH = document.body.scrollHeight
      const scrollPercent = scrollP / (docH - windowH)

      if (scrollPercent < 0.3) setMood('idle')
      else if (scrollPercent >= 0.3 && scrollPercent < 0.85) setMood('happy')
      else setMood('cool')
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // --- NATIVE SSE STREAM HANDLER ---
  const sendMessage = async (e?: React.FormEvent, presetInput?: string) => {
    e?.preventDefault()
    const textToSend = presetInput || input
    if (!textToSend.trim() || isLoading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: textToSend }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })) })
      })

      if (!response.ok) throw new Error('Network response was not ok')
      
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      
      let assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', tool_calls: [] }
      setMessages(prev => [...prev, assistantMsg])

      let done = false
      let toolCallAccumulator: Record<number, { name: string, arguments: string }> = {}

      while (!done) {
        const { value, done: readerDone } = await reader!.read()
        done = readerDone
        if (value) {
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim()
              if (payload === '[DONE]') continue

              try {
                const data = JSON.parse(payload)
                const delta = data.choices?.[0]?.delta

                if (delta?.content) {
                  assistantMsg.content += delta.content
                }

                if (delta?.tool_calls) {
                  for (const tool of delta.tool_calls) {
                    if (!toolCallAccumulator[tool.index]) {
                      toolCallAccumulator[tool.index] = { name: tool.function.name, arguments: '' }
                    }
                    if (tool.function?.arguments) {
                      toolCallAccumulator[tool.index].arguments += tool.function.arguments
                    }
                  }
                  assistantMsg.tool_calls = Object.values(toolCallAccumulator).map(t => ({...t}))
                }

                // Update UI smoothly
                setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...assistantMsg } : m))
              } catch (err) {
                // Ignore incomplete JSON chunks
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Agent Error:", error)
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Oops, I encountered an error. Let's try again!" }])
    } finally {
      setIsLoading(false)
    }
  }

  // --- TOOL UI RENDERER ---
  const renderToolCard = (tool: { name: string, arguments: string }, msgId: string, index: number) => {
    const toolKey = `${msgId}-${index}`
    let args: any = {}
    
    try {
       args = JSON.parse(tool.arguments)
    } catch(e) {
       // JSON still streaming/incomplete
       return (
         <div key={toolKey} className="bg-white border border-slate-200 rounded-lg p-3 my-2 flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="animate-spin" size={16} /> Preparing {tool.name.replace(/_/g, ' ')}...
         </div>
       )
    }

    const isConfirmed = confirmedTools[toolKey]

    const handleConfirm = () => {
        // Here you would normally trigger another API route to actually execute the task.
        // For now, we update the UI to show success.
        setConfirmedTools(prev => ({ ...prev, [toolKey]: true }))
        
        // Notify the AI that we did it
        const systemMsg: Message = { id: Date.now().toString(), role: 'system', content: `User confirmed execution of ${tool.name}` }
        setMessages(prev => [...prev, systemMsg])
    }

    if (tool.name === 'draft_ad_campaign') {
      return (
        <div key={toolKey} className="bg-white border border-blue-200 shadow-sm rounded-lg p-4 my-2 text-sm text-left">
          <h5 className="font-bold text-[#003D6F] mb-3 flex items-center gap-2">🎯 Meta Ad Campaign Draft</h5>
          <div className="space-y-1 text-slate-600 mb-3">
            <p><strong className="text-slate-800">Campaign:</strong> {args.campaignName}</p>
            <p><strong className="text-slate-800">Audience:</strong> {args.targetAudience}</p>
            <p><strong className="text-slate-800">Budget:</strong> ₹{args.dailyBudget} / day</p>
            <div className="bg-slate-50 p-2 mt-2 rounded border border-slate-100 italic text-xs">
               "{args.adCopy}"
            </div>
          </div>
          {isConfirmed ? (
            <button disabled className="w-full bg-green-50 text-green-700 py-2 rounded-md font-medium flex items-center justify-center gap-2 border border-green-200">
               <CheckCircle2 size={16} /> Launched Successfully
            </button>
          ) : (
            <button onClick={handleConfirm} className="w-full bg-[#003D6F] hover:bg-[#002a4d] text-white py-2 rounded-md font-medium transition-colors">
              Confirm & Launch Ad
            </button>
          )}
        </div>
      )
    }

    if (tool.name === 'draft_social_post') {
      return (
        <div key={toolKey} className="bg-white border border-pink-200 shadow-sm rounded-lg p-4 my-2 text-sm text-left">
          <h5 className="font-bold text-pink-600 mb-3 flex items-center gap-2">📱 Social Media Draft</h5>
          <div className="space-y-1 text-slate-600 mb-3">
            <p><strong className="text-slate-800">Platform:</strong> {args.platform}</p>
            <div className="bg-pink-50 p-2 mt-2 rounded border border-pink-100 italic text-xs whitespace-pre-wrap">
               {args.caption}
            </div>
          </div>
          {isConfirmed ? (
             <button disabled className="w-full bg-green-50 text-green-700 py-2 rounded-md font-medium flex items-center justify-center gap-2 border border-green-200">
               <CheckCircle2 size={16} /> Posted Successfully
            </button>
          ) : (
            <button onClick={handleConfirm} className="w-full bg-pink-600 hover:bg-pink-700 text-white py-2 rounded-md font-medium transition-colors">
              Confirm & Post Now
            </button>
          )}
        </div>
      )
    }

    if (tool.name === 'schedule_cron_task') {
      return (
        <div key={toolKey} className="bg-white border border-purple-200 shadow-sm rounded-lg p-4 my-2 text-sm text-left">
          <h5 className="font-bold text-purple-700 mb-3 flex items-center gap-2">⏳ Scheduled Task Draft</h5>
          <div className="space-y-1 text-slate-600 mb-3">
            <p><strong className="text-slate-800">Task:</strong> {args.taskType}</p>
            <p><strong className="text-slate-800">Frequency:</strong> {args.frequency}</p>
          </div>
           {isConfirmed ? (
             <button disabled className="w-full bg-green-50 text-green-700 py-2 rounded-md font-medium flex items-center justify-center gap-2 border border-green-200">
               <CheckCircle2 size={16} /> Task Scheduled
            </button>
          ) : (
            <button onClick={handleConfirm} className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-md font-medium transition-colors">
              Confirm Schedule
            </button>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-32 right-4 md:right-6 z-[70] w-[320px] md:w-[380px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden font-sans flex flex-col h-[500px] max-h-[70vh]"
          >
            {/* Header */}
            <div className="bg-[#003D6F] p-4 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white font-bold">
                  <span className="text-xs">AI</span>
                </div>
                <div>
                  <h4 className="text-white font-bold text-sm">AdRolls Mentor</h4>
                  <p className="text-blue-200 text-xs flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"/> Online
                  </p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Chat Body */}
            <div ref={scrollRef} className="p-4 flex-1 bg-slate-50 overflow-y-auto flex flex-col gap-3">
              {messages.length === 0 && (
                <>
                  <div className="bg-white p-3 rounded-tr-xl rounded-bl-xl rounded-br-xl shadow-sm border border-slate-100 self-start max-w-[85%] text-slate-700 text-sm">
                    Hey! I'm Rolls. 🐶 I'm your AI operating partner. I can help you analyze leads, draft high-converting ads, or schedule follow-ups. What are we building today?
                  </div>
                  <div className="flex flex-col gap-2 mt-2">
                    <button onClick={() => sendMessage(undefined, "Draft a Meta Ad for my newest property.")} className="text-xs bg-blue-50 border border-blue-100 text-blue-700 px-3 py-2 rounded-lg text-left hover:bg-blue-100 transition-colors">
                      🚀 Draft a new Meta Ad
                    </button>
                    <button onClick={() => sendMessage(undefined, "What should my marketing strategy be for this week?")} className="text-xs bg-blue-50 border border-blue-100 text-blue-700 px-3 py-2 rounded-lg text-left hover:bg-blue-100 transition-colors">
                      🧠 Advise me on strategy
                    </button>
                  </div>
                </>
              )}

              {messages.filter(m => m.role !== 'system').map((msg, i) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-[90%] ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
                  {msg.content && (
                     <div className={`p-3 text-sm shadow-sm ${msg.role === 'user' ? 'bg-[#003D6F] text-white rounded-tl-xl rounded-bl-xl rounded-br-xl' : 'bg-white text-slate-700 border border-slate-100 rounded-tr-xl rounded-bl-xl rounded-br-xl'}`}>
                       {msg.content}
                     </div>
                  )}
                  
                  {/* Render Tool Cards if the AI called tools */}
                  {msg.tool_calls?.map((tool, index) => renderToolCard(tool, msg.id, index))}
                </div>
              ))}
              
              {isLoading && (
                 <div className="self-start bg-white p-3 rounded-tr-xl rounded-bl-xl rounded-br-xl shadow-sm border border-slate-100 text-slate-500">
                   <Loader2 className="animate-spin" size={16} />
                 </div>
              )}
            </div>

            {/* Input Footer */}
            <form onSubmit={sendMessage} className="p-3 border-t border-slate-100 bg-white flex gap-2 shrink-0">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask your mentor..." 
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#003D6F]"
                disabled={isLoading}
              />
              <button disabled={!input.trim() || isLoading} type="submit" className="bg-[#003D6F] text-white p-2 rounded-lg hover:bg-[#002a4d] disabled:opacity-50 transition-colors">
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- THE DOG BUTTON (Mascot) --- */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 md:right-6 z-[60] cursor-pointer group flex flex-col items-end"
      >
        <motion.div 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-20 h-20 md:w-24 md:h-24 relative filter drop-shadow-xl"
        >
          {/* Your exact SVG from before */}
          <svg viewBox="0 0 200 200" className="w-full h-full overflow-visible">
              <path d="M50,140 Q45,130 50,125 Q40,120 55,115 Q50,105 65,105 Q80,100 120,100 Q135,105 130,115 Q145,120 135,125 Q145,130 140,140 Q145,155 135,165 Q120,175 100,175 Q80,175 65,165 Q55,155 50,140 Z" fill="white" stroke="black" strokeWidth="4" strokeLinejoin="round"/>
              <path d="M70,115 Q85,110 100,112 Q115,110 130,115 Q135,130 125,140 Q115,150 100,150 Q85,150 75,140 Q65,130 70,115 Z" fill="#8B4513" opacity="1" stroke="black" strokeWidth="2" strokeLinejoin="round"/>
              <g transform="translate(0, 5)">
                  <path d="M70,175 Q68,182 75,185 Q82,188 90,185 Q92,178 90,175" fill="white" stroke="black" strokeWidth="3" />
                  <path d="M110,175 Q108,182 115,185 Q122,188 130,185 Q132,178 130,175" fill="white" stroke="black" strokeWidth="3" />
              </g>
              <path d="M72,132 Q100,142 128,132" stroke="#B22B31" strokeWidth="8" strokeLinecap="round" fill="none" />
              <circle cx="100" cy="138" r="6" fill="#F4B429" stroke="black" strokeWidth="2" />
              <motion.g transform="translate(0, -15)" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}>
                  <path d="M55,75 Q45,95 50,110 Q55,125 70,120 Q80,115 75,90" fill="#8B4513" stroke="black" strokeWidth="3" strokeLinejoin="round"/>
                  <path d="M145,75 Q155,95 150,110 Q145,125 130,120 Q120,115 125,90" fill="#8B4513" stroke="black" strokeWidth="3" strokeLinejoin="round"/>
                  <path d="M100,50 Q120,50 135,65 Q145,80 140,100 Q135,120 115,135 Q100,140 85,135 Q65,120 60,100 Q55,80 65,65 Q80,50 100,50 Z" fill="white" stroke="black" strokeWidth="3" strokeLinejoin="round"/>
                  <path d="M90,55 Q100,40 110,55" stroke="black" strokeWidth="3" fill="white"/>
                  <ellipse cx="80" cy="90" rx="18" ry="22" fill="#8B4513" transform="rotate(-10 80 90)" />
                  <ellipse cx="120" cy="90" rx="18" ry="22" fill="#8B4513" transform="rotate(10 120 90)" />
                  <ellipse cx="75" cy="115" rx="8" ry="5" fill="#FFC0CB" opacity="0.6" />
                  <ellipse cx="125" cy="115" rx="8" ry="5" fill="#FFC0CB" opacity="0.6" />
                  <motion.g animate={{ scaleY: [1, 1, 0.1, 1] }} transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.95, 1] }}>
                      <circle cx="82" cy="92" r="7" fill="black" />
                      <circle cx="118" cy="92" r="7" fill="black" />
                      <circle cx="84" cy="90" r="2.5" fill="white" />
                      <circle cx="120" cy="90" r="2.5" fill="white" />
                  </motion.g>
                  <ellipse cx="100" cy="105" rx="14" ry="10" fill="#F3F4F6" stroke="black" strokeWidth="1" />
                  <ellipse cx="100" cy="100" rx="7" ry="5" fill="black" />
                  <path d="M92,112 Q100,118 108,112" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                  <motion.path d="M96,114 Q100,128 104,114" fill="#FB7185" stroke="black" strokeWidth="1" animate={{ opacity: mood === 'happy' ? 1 : 0 }} />
              </motion.g>
              <motion.g initial={{ y: -150, opacity: 0 }} animate={mood === 'cool' ? { y: -15, opacity: 1 } : { y: -150, opacity: 0 }} transition={{ type: "spring", stiffness: 120, damping: 12 }}>
                  <rect x="60" y="80" width="40" height="20" fill="black" />
                  <rect x="60" y="80" width="5" height="5" fill="white" opacity="0.4" />
                  <rect x="65" y="85" width="5" height="5" fill="white" opacity="0.4" />
                  <rect x="105" y="80" width="40" height="20" fill="black" />
                  <rect x="105" y="80" width="5" height="5" fill="white" opacity="0.4" />
                  <rect x="110" y="85" width="5" height="5" fill="white" opacity="0.4" />
                  <rect x="100" y="82" width="5" height="5" fill="black" />
                  <rect x="145" y="80" width="10" height="5" fill="black" />
                  <rect x="50" y="80" width="10" height="5" fill="black" />
              </motion.g>
          </svg>
        </motion.div>
        
        {!isOpen && (
            <div className="mt-1 bg-[#003D6F] px-3 py-1 rounded-full shadow-lg border border-white/20 animate-in fade-in zoom-in duration-300">
            <p className="text-white font-bold text-[10px] md:text-xs whitespace-nowrap">
                Ask your Mentor!
            </p>
            </div>
        )}
      </div>
    </>
  )
}