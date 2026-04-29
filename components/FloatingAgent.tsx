'use client'

import React, { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, CheckCircle2, AlertCircle, Sparkles, Activity, UserPlus, Users, Power, Image as ImageIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: { name: string; arguments: string }[];
}

const TOOL_PROGRESS_MESSAGES: Record<string, string> = {
  'draft_ad_campaign': 'Drafting Meta Ad...',
  'draft_social_post': 'Writing Social Post...',
  'check_live_campaigns': 'Fetching Meta Campaigns...',
  'check_crm_leads': 'Analyzing CRM Leads...',
  'update_lead_stage': 'Updating CRM Record...',
  'toggle_campaign_status': 'Connecting to Meta...',
  'invite_team_member': 'Preparing Invitation...',
  'generate_ad_creative': 'Initializing AI Designer...',
  'get_product_details': 'Fetching product assets...'
};

// --- WIDGET: IMAGE GENERATOR ---
function ImageGenerationCard({ propertyTitle, instructions }: { propertyTitle: string, instructions: string }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Gathering product assets...');
  const hasStarted = useRef(false); 
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    if (hasStarted.current || taskId) return;
    hasStarted.current = true;

    const startGeneration = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: property } = await supabase
          .from('properties')
          .select('*')
          .ilike('title', `%${propertyTitle.trim()}%`)
          .eq('user_id', user?.id)
          .maybeSingle();

        const { data: profile } = await supabase
          .from('profiles')
          .select('logo_url, phone')
          .eq('id', user?.id)
          .single();

        setStatus('Initializing AI Designer...');

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
             propertyTitle: property?.title || propertyTitle, 
             propertyDescription: property?.description || '',
             propImages: property?.prop_images || property?.images || [], 
             logoUrl: profile?.logo_url,
             contactNumber: profile?.phone,
             userInstructions: instructions,
             model: 'nano-banana-2',
             aspectRatio: '1:1'
          })
        });
        
        const data = await res.json();
        if (data.taskId) {
           setTaskId(data.taskId);
           setCaption(data.caption);
           setStatus('Generating pixels (this takes ~10s)...');
        } else {
           setStatus('Failed to start generation.');
        }
      } catch (e) {
        setStatus('Error connecting to image server.');
      }
    };
    
    startGeneration();
  }, [propertyTitle, instructions, taskId]);

  useEffect(() => {
    if (!taskId || imageUrl) return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/check-status', {
           method: 'POST', 
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ taskId }) 
        });
        const data = await res.json();
        const generatedImg = data.imageUrl || data.images?.[0] || data.result?.images?.[0];
        
        if (generatedImg) {
           clearInterval(poll);
           setImageUrl(generatedImg);
           setStatus('Complete');
        } else if (data.status === 'failed' || data.status === 'error') {
           clearInterval(poll);
           setStatus('Generation failed. Please try again.');
        }
      } catch (e) {
        console.error(e);
      }
    }, 4000);

    return () => clearInterval(poll);
  }, [taskId, imageUrl]);

  return (
    <div className="bg-white border border-[#e2e8f0] shadow-sm rounded-[24px] p-5 my-2 w-full max-w-[95%]">
      <h5 className="font-bold text-[#003D6F] mb-3 flex items-center gap-2 text-[15px]">
        <ImageIcon size={18}/> Design Studio
      </h5>
      {!imageUrl ? (
        <div className="bg-[#f8fafc] border border-slate-100 rounded-2xl p-6 flex flex-col items-center justify-center text-center">
           <Loader2 className="animate-spin text-pink-500 mb-3" size={28} />
           <p className="text-sm font-medium text-slate-700 animate-pulse">{status}</p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col gap-3">
           <img src={imageUrl} alt="Generated Ad" className="w-full h-auto aspect-square rounded-2xl object-cover border border-slate-200 shadow-sm" />
           {caption && (
             <div className="bg-[#f0f9ff] border border-blue-100 p-3 rounded-2xl text-[12px] text-slate-700 whitespace-pre-wrap leading-relaxed">
               {caption}
             </div>
           )}
           <button onClick={() => router.push('/dashboard/assets')} className="bg-[#003D6F] text-white w-full py-3 mt-1 rounded-full font-medium transition-colors hover:bg-[#002a4d]">
              Save & Manage Asset
           </button>
        </motion.div>
      )}
    </div>
  )
}

// --- WIDGET: CAMPAIGNS ---
function LiveCampaignsCard() {
  const [campaigns, setCampaigns] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/meta-ads/campaigns')
      .then(res => res.json())
      .then(data => { setCampaigns(data.campaigns || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="bg-white border border-[#e2e8f0] shadow-sm rounded-[24px] p-5 my-2 w-full max-w-[95%] flex items-center gap-3 text-slate-500 text-[14px]"><Loader2 className="animate-spin text-[#003D6F]" size={18} /> Pulling live campaigns...</div>
  const activeCount = campaigns?.filter(c => c.effective_status === 'ACTIVE').length || 0;

  return (
    <div className="bg-white border border-[#e2e8f0] shadow-sm rounded-[24px] p-5 my-2 w-full max-w-[95%]">
      <h5 className="font-bold text-[#003D6F] mb-1 flex items-center gap-2 text-[15px]"><Activity size={18}/> {activeCount} Active Campaigns</h5>
      {campaigns && campaigns.length > 0 ? (
        <div className="flex flex-col gap-3 max-h-[200px] overflow-y-auto pr-1">
          {campaigns.map((c: any) => (
            <div key={c.id} className="bg-[#f8fafc] border border-slate-100 p-3.5 rounded-2xl flex flex-col gap-1.5">
              <div className="flex justify-between items-start gap-2">
                <strong className="text-slate-800 text-[13px] leading-tight">{c.name}</strong>
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${c.effective_status === 'ACTIVE' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-slate-200 text-slate-600'}`}>{c.effective_status}</span>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-[13px] text-slate-500">No campaigns found.</p>}
    </div>
  )
}

export default function FloatingAgent() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [streamingToolName, setStreamingToolName] = useState<string | null>(null)
  const [executingTool, setExecutingTool] = useState<string | null>(null)
  const [toolStatus, setToolStatus] = useState<Record<string, 'success' | 'error'>>({})
  const router = useRouter()
  const supabase = createClient()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, streamingToolName])

  // --- MCP: AUTOMATIC DATA RESOLUTION ---
  const handleMcpDetailsFetch = async (args: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data } = await supabase
        .from('properties')
        .select('title, description, prop_images, images')
        .ilike('title', `%${args.titleQuery}%`)
        .eq('user_id', user?.id)
        .maybeSingle();

      if (data) {
        return `Found product. Title: ${data.title}. Description: ${data.description}. Assets: ${JSON.stringify(data.prop_images || data.images)}`;
      }
      return "Product details not found in inventory. Please ask the user to clarify.";
    } catch (e) { return "Error accessing database."; }
  }

  const sendMessage = async (e?: React.FormEvent, presetInput?: string) => {
    e?.preventDefault()
    const textToSend = presetInput || input
    if (!textToSend.trim() || isLoading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: textToSend }
    const currentMessages = [...messages, userMsg];
    setMessages(currentMessages)
    setInput('')
    setIsLoading(true)

    try {
      const formattedHistory = currentMessages.map(m => {
        let content = m.content;
        if (!content && m.tool_calls && m.tool_calls.length > 0) {
           content = `[Action executed: ${m.tool_calls[0].name}]`;
        }
        return { role: m.role, content: content || " " };
      });

      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: formattedHistory })
      })

      if (!response.ok) throw new Error('API Error')
      
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', tool_calls: [] }
      setMessages(prev => [...prev, assistantMsg])

      let done = false
      let toolCallAccumulator: Record<number, { name: string, arguments: string }> = {}
      let buffer = ''

      while (!done) {
        const { value, done: readerDone } = await reader!.read()
        done = readerDone
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' 

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (trimmedLine.startsWith('data: ')) {
              const payload = trimmedLine.slice(6).trim()
              if (payload === '[DONE]') continue
              try {
                const data = JSON.parse(payload)
                const delta = data.choices?.[0]?.delta
                if (delta?.content) assistantMsg.content += delta.content
                if (delta?.tool_calls) {
                  for (const tool of delta.tool_calls) {
                    if (!toolCallAccumulator[tool.index]) {
                        toolCallAccumulator[tool.index] = { name: tool.function.name || '', arguments: '' }
                        if (tool.function.name) setStreamingToolName(tool.function.name)
                    }
                    if (tool.function?.arguments) toolCallAccumulator[tool.index].arguments += tool.function.arguments
                  }
                  assistantMsg.tool_calls = Object.values(toolCallAccumulator).map(t => ({...t}))
                }
                setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...assistantMsg } : m))
              } catch (err) { }
            }
          }
        }
      }

      // --- CRITICAL MCP LOGIC: Auto-reply if AI calls get_product_details ---
      const detailsTool = assistantMsg.tool_calls?.find(t => t.name === 'get_product_details');
      if (detailsTool) {
        const args = JSON.parse(detailsTool.arguments);
        const resolvedData = await handleMcpDetailsFetch(args);
        // Automatically send the data back to the AI to trigger generation
        sendMessage(undefined, resolvedData); 
      }

    } catch (error) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Error connecting to server." }])
    } finally {
      setIsLoading(false)
      setStreamingToolName(null)
    }
  }

  const executeTool = async (tool: { name: string, arguments: string }, toolKey: string) => {
    setExecutingTool(toolKey)
    try {
      const args = JSON.parse(tool.arguments)
      let endpoint = '';
      if (tool.name === 'draft_ad_campaign') endpoint = '/api/meta-ads/launch-campaign';
      else if (tool.name === 'draft_social_post') endpoint = '/api/post-universal';
      else if (tool.name === 'update_lead_stage') endpoint = '/api/crm/update-stage';
      else if (tool.name === 'toggle_campaign_status') endpoint = '/api/meta-ads/update-status';
      else if (tool.name === 'invite_team_member') endpoint = '/api/team/create';

      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      if (!response.ok) throw new Error('Failed')
      setToolStatus(prev => ({ ...prev, [toolKey]: 'success' }))
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `Success.` }])
    } catch (error) {
      setToolStatus(prev => ({ ...prev, [toolKey]: 'error' }))
    } finally {
      setExecutingTool(null)
    }
  }

  const renderText = (text: string) => text.split('\n').map((line, i) => <React.Fragment key={i}>{line}{i !== text.split('\n').length - 1 && <br />}</React.Fragment>)

  const renderToolCard = (tool: { name: string, arguments: string }, msgId: string, index: number) => {
    const toolKey = `${msgId}-${index}`
    const isExecuting = executingTool === toolKey
    const status = toolStatus[toolKey]

    if (tool.name === 'check_live_campaigns') return <LiveCampaignsCard key={toolKey} />
    if (tool.name === 'get_product_details') return (
       <div key={toolKey} className="bg-blue-50 border border-blue-100 rounded-2xl p-4 my-2 flex items-center gap-3 text-blue-700 text-sm">
          <Loader2 className="animate-spin" size={16} /> Grounding product context...
       </div>
    )

    let args: any = {}
    try { args = JSON.parse(tool.arguments) } catch(e) { return null }

    if (tool.name === 'generate_ad_creative') return <ImageGenerationCard key={toolKey} propertyTitle={args.propertyTitle} instructions={args.instructions} />

    if (tool.name === 'check_crm_leads') {
      return (
        <div key={toolKey} className="bg-white border border-[#e2e8f0] shadow-sm rounded-[24px] p-5 my-2 w-full max-w-[95%]">
          <h5 className="font-bold text-[#003D6F] mb-3 flex items-center gap-2 text-[15px]"><Users size={18}/> CRM Summary</h5>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-[#f0f9ff] p-4 rounded-2xl"><span className="text-xl font-bold">{args.totalLeads}</span><br/><span className="text-[10px] text-slate-500 uppercase">Leads</span></div>
            <div className="bg-[#fff1f2] p-4 rounded-2xl"><span className="text-xl font-bold text-rose-600">{args.newLeads}</span><br/><span className="text-[10px] text-slate-500 uppercase">New</span></div>
          </div>
        </div>
      )
    }

    const renderActionBtn = (defaultText: string, confirmColor: string = "bg-[#003D6F] hover:bg-[#002a4d]") => {
      if (status === 'success') return <button disabled className="w-full mt-3 bg-[#dcfce7] text-[#166534] py-3 rounded-full font-medium flex items-center justify-center gap-2"><CheckCircle2 size={18} /> Done</button>
      if (status === 'error') return <button onClick={() => executeTool(tool, toolKey)} className="w-full mt-3 bg-[#fee2e2] text-[#991b1b] py-3 rounded-full font-medium flex items-center justify-center gap-2"><AlertCircle size={18} /> Error</button>
      return <button onClick={() => executeTool(tool, toolKey)} disabled={isExecuting} className={`w-full mt-3 text-white py-3 rounded-full font-medium transition-colors flex justify-center items-center gap-2 ${confirmColor}`}>{isExecuting ? "Processing..." : defaultText}</button>
    }

    if (tool.name === 'draft_ad_campaign') return (
      <div key={toolKey} className="bg-white border border-[#e2e8f0] shadow-sm rounded-[24px] p-5 my-2 text-sm text-left w-full max-w-[95%]">
        <h5 className="font-bold text-[#003D6F] mb-3 flex items-center gap-2"><Sparkles size={18}/> Draft Meta Ad</h5>
        <div className="space-y-2 text-slate-600 mb-4">
          <p><strong>Target:</strong> {args.targetAudience}</p>
          <div className="bg-[#f8fafc] p-3 rounded-2xl italic">{args.adCopy}</div>
        </div>
        {renderActionBtn("Confirm & Launch")}
      </div>
    )

    return null
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} className="fixed bottom-32 right-4 md:right-6 z-[70] w-[340px] md:w-[400px] bg-[#f8fafc] rounded-[32px] shadow-2xl border border-slate-200/60 flex flex-col h-[550px] max-h-[75vh]">
            <div className="bg-white px-5 py-4 flex justify-between items-center border-b border-slate-100">
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-[#e0f2fe] rounded-full flex items-center justify-center text-[#003D6F] font-bold"><Sparkles size={18}/></div><h4 className="text-slate-800 font-bold text-base">AdRolls AI</h4></div>
              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-700 bg-slate-50 p-2 rounded-full"><X size={20} /></button>
            </div>
            <div ref={scrollRef} className="p-5 flex-1 overflow-y-auto flex flex-col gap-4">
              {messages.filter(m => m.role !== 'system').map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} w-full`}>
                  {msg.content && msg.content !== " " && (
                    <div className={`px-4 py-3 text-[15px] leading-relaxed max-w-[85%] shadow-sm ${msg.role === 'user' ? 'bg-[#003D6F] text-white rounded-[24px] rounded-br-sm' : 'bg-white border border-slate-100 text-slate-700 rounded-[24px] rounded-tl-sm'}`}>{renderText(msg.content)}</div>
                  )}
                  {msg.tool_calls?.map((tool, index) => renderToolCard(tool, msg.id, index))}
                </div>
              ))}
              {isLoading && <div className="self-start bg-white border border-slate-100 px-4 py-3 rounded-[24px] shadow-sm text-slate-600 text-[14px] flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> {streamingToolName ? TOOL_PROGRESS_MESSAGES[streamingToolName] || 'Working...' : 'Thinking...'}</div>}
            </div>
            <form onSubmit={sendMessage} className="p-4 bg-white border-t border-slate-100 flex gap-2 shrink-0 rounded-b-[32px]">
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message AI..." className="flex-1 bg-[#f1f5f9] rounded-full px-5 py-3 text-[15px] focus:outline-none" disabled={isLoading} />
              <button disabled={!input.trim() || isLoading} type="submit" className="bg-[#003D6F] text-white w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-50"><Send size={18} /></button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
      <div onClick={() => setIsOpen(!isOpen)} className="fixed bottom-20 right-4 md:right-6 z-[60] cursor-pointer group flex flex-col items-end">
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="w-20 h-20 relative filter drop-shadow-xl">
          <svg viewBox="0 0 200 200" className="w-full h-full overflow-visible">
            <path d="M50,140 Q45,130 50,125 Q40,120 55,115 Q50,105 65,105 Q80,100 120,100 Q135,105 130,115 Q145,120 135,125 Q145,130 140,140 Q145,155 135,165 Q120,175 100,175 Q80,175 65,165 Q55,155 50,140 Z" fill="white" stroke="black" strokeWidth="4" />
            <circle cx="100" cy="138" r="6" fill="#F4B429" stroke="black" strokeWidth="2" />
            <motion.g animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 4 }}>
              <path d="M100,50 Q120,50 135,65 Q145,80 140,100 Q135,120 115,135 Q100,140 85,135 Q65,120 60,100 Q55,80 65,65 Q80,50 100,50 Z" fill="white" stroke="black" strokeWidth="3" />
              <motion.g animate={{ scaleY: [1, 1, 0.1, 1] }} transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.95, 1] }}><circle cx="82" cy="92" r="7" fill="black" /><circle cx="118" cy="92" r="7" fill="black" /></motion.g>
            </motion.g>
          </svg>
        </motion.div>
      </div>
    </>
  )
}