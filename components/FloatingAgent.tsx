'use client'

import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, CheckCircle2, Eye, Rocket, AlertCircle, Sparkles, Activity, UserPlus, Users, Power, Image as ImageIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

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
function ImageGenerationCard({ propertyTitle, instructions, propertyDescription, imageUrls }: { propertyTitle: string, instructions: string, propertyDescription?: string, imageUrls?: string[] }) {
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

        let finalDescription = propertyDescription;
        let finalImages = imageUrls || [];

        if (!finalDescription || finalImages.length === 0) {
          const { data: property } = await supabase
            .from('properties')
            .select('*')
            .ilike('title', `%${propertyTitle.trim()}%`)
            .eq('user_id', user?.id)
            .maybeSingle();

          if (property) {
            finalDescription = finalDescription || property.description;
            if (finalImages.length === 0) {
              finalImages = property.prop_images || property.images || [];
            }
          }
        }

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
            propertyTitle,
            propertyDescription: finalDescription || '',
            propImages: finalImages,
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
          console.error("[UI] Design Studio Failed:", data);
          setStatus(`Failed: ${data.error || 'Unknown error'}`);
        }
      } catch (e: any) {
        console.error("[UI] Design Studio Connection Error:", e);
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
        <ImageIcon size={18} /> Design Studio
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
      <h5 className="font-bold text-[#003D6F] mb-1 flex items-center gap-2 text-[15px]"><Activity size={18} /> {activeCount} Active Campaigns</h5>
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
  const [executingTool, setExecutingTool] = useState<string | null>(null)
  const [toolStatus, setToolStatus] = useState<Record<string, 'success' | 'error'>>({})
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const router = useRouter()
  const supabase = createClient()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      setSession(currentSession)
      setLoading(false)
    }
    checkSession()
  }, [supabase])

  const [input, setInput] = useState('')
  const { messages, sendMessage, status, addToolOutput } = useChat({
    transport: new DefaultChatTransport({ api: '/api/agent' }),
  }) as any

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  if (loading || !session) return null

  const isLoading = status === 'submitted' || status === 'streaming'

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    const text = input
    setInput('')
    await sendMessage({ text })
  }


  const executeTool = async (tool: any, toolKey: string) => {
    try {
      setExecutingTool(toolKey)
      const toolName = tool.toolName || (tool.type?.startsWith('tool-') ? tool.type.slice(5) : 'unknown')
      const args = tool.input || tool.args || {}
      console.log(`[UI] Executing tool: ${toolName}`, args);

      let endpoint = ''
      if (toolName === 'draft_ad_campaign') endpoint = '/api/meta-ads/launch-campaign';
      else if (toolName === 'draft_social_post') endpoint = '/api/social/post';
      else if (toolName === 'update_lead_stage') endpoint = '/api/crm/update-stage';
      else if (toolName === 'toggle_campaign_status') endpoint = '/api/meta-ads/update-status';
      else if (toolName === 'invite_team_member') endpoint = '/api/team/create';

      if (!endpoint) throw new Error(`No endpoint defined for tool: ${toolName}`)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      })

      const result = await response.json()
      console.log(`[UI] Tool response:`, result);

      if (!response.ok) throw new Error(result.error || 'Failed')

      setToolStatus(prev => ({ ...prev, [toolKey]: 'success' }))

      addToolOutput({
        tool: toolName,
        toolCallId: tool.toolCallId,
        state: 'output-available',
        output: { success: true, result }
      })
    } catch (error: any) {
      console.error(`[UI] Tool execution error:`, error);
      setToolStatus(prev => ({ ...prev, [toolKey]: 'error' }))
    } finally {
      setExecutingTool(null)
    }
  }

  const renderText = (text: string) => text.split('\n').map((line, i) => <React.Fragment key={i}>{line}{i !== text.split('\n').length - 1 && <br />}</React.Fragment>)

  const renderToolCard = (tool: any, msgId: string, index: number) => {
    const toolKey = `${msgId}-${index}`
    const isExecuting = executingTool === toolKey
    const status = toolStatus[toolKey]
    const toolName = tool.toolName || (tool.type?.startsWith('tool-') ? tool.type.slice(5) : 'unknown')
    const args = tool.input || tool.args || {}

    const isFinished = tool.state === 'output-available' || tool.state === 'output-error' || status === 'success'

    if (toolName === 'check_live_campaigns') return (
      <div key={toolKey} className={`border rounded-2xl p-4 my-2 flex items-center gap-3 text-sm ${isFinished ? 'bg-green-50 border-green-100 text-green-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
        {isFinished ? <CheckCircle2 size={16} /> : <Loader2 className="animate-spin" size={16} />}
        {isFinished ? 'Analyzed live campaigns' : 'Analyzing live campaigns...'}
      </div>
    )

    if (toolName === 'get_product_details') return (
      <div key={toolKey} className={`border rounded-2xl p-4 my-2 flex items-center gap-3 text-sm ${isFinished ? 'bg-green-50 border-green-100 text-green-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
        {isFinished ? <CheckCircle2 size={16} /> : <Loader2 className="animate-spin" size={16} />}
        {isFinished ? `Gathered assets for: ${args.titleQuery || 'Product'}` : 'Grounding product context...'}
      </div>
    )

    if (toolName === 'get_campaign_details') return (
      <div key={toolKey} className={`border rounded-2xl p-4 my-2 flex items-center gap-3 text-sm ${isFinished ? 'bg-green-50 border-green-100 text-green-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
        {isFinished ? <CheckCircle2 size={16} /> : <Loader2 className="animate-spin" size={16} />}
        {isFinished ? `Analyzed existing ad creatives.` : 'Analyzing current ad performance...'}
      </div>
    )

    if (toolName === 'inspect_ad_creative') return (
      <div key={toolKey} className={`border rounded-2xl p-4 my-2 flex items-center gap-3 text-sm ${isFinished ? 'bg-green-50 border-green-100 text-green-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
        {isFinished ? <Eye size={16} /> : <Loader2 className="animate-spin" size={16} />}
        {isFinished ? `Completed visual inspection.` : 'Performing multimodal visual analysis...'}
      </div>
    )

    if (toolName === 'generate_ad_creative') return (
      <ImageGenerationCard
        key={toolKey}
        propertyTitle={args.propertyTitle}
        instructions={args.instructions}
        propertyDescription={args.propertyDescription}
        imageUrls={args.imageUrls}
      />
    )

    if (toolName === 'check_crm_leads') {
      if (!isFinished) return (
        <div key={toolKey} className="bg-blue-50 border border-blue-100 rounded-2xl p-4 my-2 flex items-center gap-3 text-blue-700 text-sm">
          <Loader2 className="animate-spin" size={16} /> Scanning CRM pipeline...
        </div>
      )
      return (
        <div key={toolKey} className="bg-white border border-[#e2e8f0] shadow-sm rounded-[24px] p-5 my-2 w-full max-w-[95%]">
          <h5 className="font-bold text-[#003D6F] mb-3 flex items-center gap-2 text-[15px]"><Users size={18} /> CRM Summary</h5>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-[#f0f9ff] p-4 rounded-2xl"><span className="text-xl font-bold">{args.totalLeads || 0}</span><br /><span className="text-[10px] text-slate-500 uppercase">Leads</span></div>
            <div className="bg-[#fff1f2] p-4 rounded-2xl"><span className="text-xl font-bold text-rose-600">{args.newLeads || 0}</span><br /><span className="text-[10px] text-slate-500 uppercase">New</span></div>
          </div>
        </div>
      )
    }
    if (toolName === 'draft_ad_campaign') return (
      <div key={toolKey} className="bg-white border border-[#e2e8f0] shadow-sm rounded-[24px] p-5 my-2 w-full max-w-[95%]">
        <div className="flex items-center gap-2 text-[#003D6F] mb-4">
          <Rocket size={18} />
          <h5 className="font-bold text-[15px]">Draft Meta Ad</h5>
        </div>

        <div className="bg-[#f8fafc] border border-slate-100 p-4 rounded-2xl mb-4 text-left">
          <h6 className="text-[14px] font-bold text-slate-800 mb-2">{args.campaignName || 'New Campaign'}</h6>
          <p className="text-[13px] text-slate-700 leading-relaxed font-medium mb-2">Headline: <span className="font-normal text-slate-600">{args.headline}</span></p>
          <div className="bg-white border border-slate-100 p-3 rounded-xl text-[13px] text-slate-600 italic mb-3">"{args.adCopy}"</div>

          {args.imageUrl && (
            <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 shadow-inner">
              <img src={args.imageUrl} alt="Ad Preview" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {status === 'success' ? (
          <div className="bg-green-50 text-green-700 p-3 rounded-full text-center text-sm font-medium flex items-center justify-center gap-2">
            <CheckCircle2 size={16} /> Campaign Launched
          </div>
        ) : status === 'error' ? (
          <div className="bg-red-50 text-red-700 p-3 rounded-full text-center text-sm font-medium">
            Error launching campaign
          </div>
        ) : (
          <button
            onClick={() => executeTool(tool, toolKey)}
            disabled={executingTool === toolKey}
            className="bg-[#003D6F] text-white w-full py-3 rounded-full font-bold shadow-md hover:bg-[#002a4d] transition-all flex items-center justify-center gap-2"
          >
            {executingTool === toolKey ? <Loader2 className="animate-spin" size={18} /> : <Rocket size={18} />}
            Confirm & Launch
          </button>
        )}
      </div>
    )

    // Default fallback for other tools
    return (
      <div key={toolKey} className="bg-white border border-slate-200 rounded-[24px] p-4 shadow-sm max-w-[90%]">
        <div className="flex items-center gap-2 text-[#003D6F] font-bold mb-2">
          <Loader2 className="animate-spin" size={14} />
          <span className="text-xs uppercase tracking-wider">Processing: {toolName.replace(/_/g, ' ')}</span>
        </div>
        <p className="text-xs text-slate-500">The agent is gathering information to assist you better...</p>
      </div>
    )
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} className="fixed bottom-32 right-4 md:right-6 z-[70] w-[340px] md:w-[400px] bg-[#f8fafc] rounded-[32px] shadow-2xl border border-slate-200/60 flex flex-col h-[550px] max-h-[75vh]">
            <div className="bg-white px-5 py-4 flex justify-between items-center border-b border-slate-100">
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-[#e0f2fe] rounded-full flex items-center justify-center text-[#003D6F] font-bold"><Sparkles size={18} /></div><h4 className="text-slate-800 font-bold text-base">AdRolls AI</h4></div>
              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-700 bg-slate-50 p-2 rounded-full"><X size={20} /></button>
            </div>
            <div ref={scrollRef} className="p-5 flex-1 overflow-y-auto flex flex-col gap-4">
              {messages.filter((m: any) => m.role !== 'system').map((msg: any) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} w-full`}>
                  {msg.parts.map((part: any, partIndex: number) => {
                    if (part.type === 'text' && part.text.trim()) {
                      return (
                        <div key={partIndex} className={`px-4 py-3 text-[15px] leading-relaxed max-w-[85%] shadow-sm my-1 ${msg.role === 'user' ? 'bg-[#003D6F] text-white rounded-[24px] rounded-br-sm' : 'bg-white border border-slate-100 text-slate-700 rounded-[24px] rounded-tl-sm'}`}>
                          {renderText(part.text)}
                        </div>
                      )
                    }
                    if (part.type.startsWith('tool-')) {
                      return renderToolCard(part, msg.id, partIndex)
                    }
                    return null
                  })}
                </div>
              ))}
              {isLoading && <div className="self-start bg-white border border-slate-100 px-4 py-3 rounded-[24px] shadow-sm text-slate-600 text-[14px] flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> Working...</div>}
            </div>
            <form onSubmit={handleSubmit} className="p-4 bg-white border-t border-slate-100 flex gap-2 shrink-0 rounded-b-[32px]">
              <input type="text" value={input} onChange={handleInputChange} placeholder="Message AI..." className="flex-1 bg-[#f1f5f9] rounded-full px-5 py-3 text-[15px] focus:outline-none" disabled={isLoading} />
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