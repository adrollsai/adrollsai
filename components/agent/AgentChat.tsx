'use client';

import * as React from 'react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Send,
  Loader2,
  Sparkles,
  Paperclip,
  User,
  Wrench,
  FileSpreadsheet,
  ArrowRight,
  Square,
  Plus,
  Terminal,
  ChevronDown,
  ChevronUp,
  History,
  Trash2,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  BarChart2,
  Megaphone,
  PlusCircle,
  Rocket,
  Users,
  MessageSquare,
  Building2,
  PhoneCall,
  Globe,
  Video,
  Film,
  Code2,
  Play,
  FolderOpen,
  FileVideo,
  BrainCircuit,
  Compass,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  Copy,
  ExternalLink,
} from 'lucide-react';
import VoiceInputButton from './VoiceInputButton';
import HtmlArtifactPreview from './HtmlArtifactPreview';
import ActionConfirmationCard from './ActionConfirmationCard';
import ProgressTrackerCard from './ProgressTrackerCard';
import FileManagerDrawer from './FileManagerDrawer';
import AgentMarkdown from './AgentMarkdown';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
}

interface AgentChatProps {
  impersonateId?: string | null;
  impersonatedName?: string | null;
}

// DeepSeek's iconic geometric whale / dolphin mark
function DeepSeekIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="50" cy="50" r="48" fill="#4d6bfe" fillOpacity="0.12" />
      <path
        d="M48.2 16C33.8 16.5 21 25.6 15.6 38.8C10.2 52 13.1 67.3 22.8 77.8C32.5 88.3 47.6 92.6 61.2 88.7C74.8 84.8 85.1 73.2 87.2 59.2C88.1 53.3 87.2 47.1 84.6 41.7C82 36.3 77.8 32 72.8 29C65.5 24.6 56.7 22.9 48.2 24.2"
        stroke="#4d6bfe"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path d="M35 56C42 46 58 46 65 56" stroke="#4d6bfe" strokeWidth="7" strokeLinecap="round" />
      <circle cx="36" cy="46" r="4.5" fill="#4d6bfe" />
      <circle cx="64" cy="46" r="4.5" fill="#4d6bfe" />
    </svg>
  );
}

const QUICK_ACTIONS = [
  {
    icon: Film,
    label: 'Create 15s Property Reel',
    desc: 'Generate motion graphics & video overlays via Remotion & FFmpeg',
    prompt: 'Create a high-converting 15-second vertical video reel for our luxury property showcase with animated kinetic captions, brand logo, and WhatsApp CTA button.',
  },
  {
    icon: Rocket,
    label: 'Launch Meta Ad Campaign',
    desc: 'Use official Meta MCP to create targeted Instagram Reels ad',
    prompt: 'Use Meta Ads MCP to inspect active campaigns and launch a high-intent lead generation campaign on Instagram Reels with ₹1,500/day budget.',
  },
  {
    icon: MessageSquare,
    label: 'WhatsApp Broadcast Template',
    desc: 'Design and preview high-converting WhatsApp message card',
    prompt: 'Design an engaging WhatsApp marketing template with personalized name variable, image header, and quick-reply action buttons.',
  },
  {
    icon: PhoneCall,
    label: 'Configure Voice Calling Agent',
    desc: 'Update default inbound & new lead follow-up script & voice',
    prompt: 'Review and update my default AI voice calling agent configuration: set voice to Aditi, configure qualification questions for new leads, and enable auto-call.',
  },
];

function getToolDisplayInfo(rawName: string) {
  switch (rawName) {
    case 'sandbox_bash_run':
      return { label: 'E2B Cloud Sandbox • Bash Terminal', Icon: Terminal };
    case 'sandbox_render_video':
      return { label: 'Hyperframes • Video Render Engine', Icon: Film };
    case 'sandbox_write_and_run':
      return { label: 'E2B Cloud Sandbox • Code Execution', Icon: Code2 };
    case 'deepseek_web_search':
      return { label: 'DeepSeek Search • Web Live Intelligence', Icon: Globe };
    case 'deepseek_web_fetch':
      return { label: 'DeepSeek Fetch • Web Reader & Scraper', Icon: Globe };
    case 'list_user_files':
      return { label: 'File Manager • Asset Explorer', Icon: FolderOpen };
    case 'organize_or_move_file':
      return { label: 'File Manager • Organize & Move', Icon: FolderOpen };
    case 'delete_user_file':
      return { label: 'File Manager • Delete Asset', Icon: Trash2 };
    case 'generate_ai_video_clip':
      return { label: 'Grok AI Video • Motion Studio', Icon: Video };
    case 'generate_ai_image':
      return { label: 'GPT Image 2.5 • Creative Studio', Icon: ImageIcon };
    case 'update_default_voice_settings':
      return { label: 'Voice Agent • Default Inbound Bot Config', Icon: PhoneCall };
    case 'launch_bulk_calling_campaign':
      return { label: 'Voice AI • Outbound Campaign Blast', Icon: PhoneCall };
    case 'create_whatsapp_template':
      return { label: 'WhatsApp • Meta Template Generator', Icon: MessageSquare };
    case 'send_single_whatsapp_message':
      return { label: 'WhatsApp • 1-on-1 Direct Outreach', Icon: MessageSquare };
    case 'meta_mcp_get_insights':
      return { label: 'Meta Ads • Performance Insights', Icon: BarChart2 };
    case 'meta_mcp_list_campaigns':
      return { label: 'Meta Ads • Campaign Explorer', Icon: Megaphone };
    case 'meta_mcp_create_campaign':
      return { label: 'Meta Ads • Campaign Generator', Icon: PlusCircle };
    case 'meta_mcp_launch_leadgen_campaign':
      return { label: 'Meta Ads • LeadGen Launcher', Icon: Rocket };
    case 'execute_data_code':
      return { label: 'Data Analytics Engine', Icon: Terminal };
    case 'get_crm_leads':
      return { label: 'CRM • Lead Directory', Icon: Users };
    case 'send_whatsapp_message':
      return { label: 'WhatsApp • Outreach', Icon: MessageSquare };
    case 'request_human_approval':
      return { label: 'Safety Guard • Human Approval', Icon: ShieldAlert };
    default:
      return {
        label: rawName.replace(/^tool-/, '').replace(/_/g, ' '),
        Icon: Wrench,
      };
  }
}

function ToolExecutionCard({ tool, idx, isLoading }: { tool: any; idx: number; isLoading: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const rawToolName = tool.toolName || (typeof tool.type === 'string' && tool.type.startsWith('tool-') ? tool.type.slice(5) : 'action');
  const { label, Icon } = getToolDisplayInfo(rawToolName);

  const output = tool.output !== undefined ? tool.output : tool.result;
  const inputArgs = tool.input !== undefined ? tool.input : tool.args;

  const isPending = output === undefined && isLoading;
  const isSuccess = output && !output.error && output.success !== false;
  const isError = output && (output.error || output.success === false);

  const artifact = output?.artifact || (output?.actionPayload && output?.requiresApproval ? {
    type: 'action_confirmation',
    actionType: output.actionPayload.actionType,
    title: output.actionPayload.title,
    description: output.actionPayload.description,
    estimatedCost: output.actionPayload.estimatedCost,
    payload: output.actionPayload.payload,
  } : null);

  return (
    <div className="my-2 text-xs">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#16181d] border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer transition select-none"
      >
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
          <Icon size={14} className="text-[#4d6bfe]" />
          <span className="font-medium text-[11px]">{label}</span>
        </div>

        <div className="flex items-center gap-2">
          {isPending ? (
            <span className="flex items-center gap-1 text-[10px] text-[#4d6bfe] font-mono">
              <Loader2 size={11} className="animate-spin" />
              Running
            </span>
          ) : isError ? (
            <span className="flex items-center gap-1 text-[10px] text-rose-500 font-mono">
              <AlertCircle size={11} />
              Failed
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-mono">
              <CheckCircle2 size={11} />
              Done
            </span>
          )}
          {isExpanded ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
        </div>
      </div>

      {isExpanded && (
        <div className="mt-1.5 p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono space-y-2 max-h-56 overflow-y-auto">
          {inputArgs && (
            <div>
              <span className="text-slate-500 text-[10px] uppercase font-bold block mb-1">Inputs:</span>
              <pre className="text-slate-400 whitespace-pre-wrap">{JSON.stringify(inputArgs, null, 2)}</pre>
            </div>
          )}
          {output && (
            <div className="border-t border-slate-800 pt-2">
              <span className="text-slate-500 text-[10px] uppercase font-bold block mb-1">Output:</span>
              <pre className="text-emerald-400 whitespace-pre-wrap">{JSON.stringify(output, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Artifact Renderers */}
      {artifact && artifact.type === 'video_player' && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-black shadow-lg">
          <div className="flex items-center justify-between px-3.5 py-2 bg-slate-950/90 border-b border-slate-800 text-xs text-slate-200">
            <span className="font-semibold flex items-center gap-1.5 text-[#4d6bfe]">
              <Film size={14} />
              {artifact.title || 'Rendered Video'}
            </span>
            {artifact.duration && (
              <span className="text-[10px] bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full font-mono">
                {artifact.duration}
              </span>
            )}
          </div>
          <video controls playsInline className="w-full max-h-[380px] object-contain" src={artifact.videoUrl} />
        </div>
      )}

      {artifact && artifact.type === 'image_preview' && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 shadow-lg">
          <div className="px-3.5 py-2 bg-slate-950 border-b border-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <ImageIcon size={14} className="text-violet-400" />
            {artifact.title || 'Generated Image'}
          </div>
          <img src={artifact.imageUrl} alt={artifact.title || 'Preview'} className="w-full max-h-[380px] object-cover" />
        </div>
      )}

      {artifact && artifact.type === 'html_sandbox' && (
        <HtmlArtifactPreview title={artifact.title} html={artifact.html} description={artifact.description} />
      )}

      {artifact && artifact.type === 'action_confirmation' && (
        <ActionConfirmationCard artifact={artifact as any} />
      )}

      {artifact && artifact.type === 'progress_tracker' && (
        <ProgressTrackerCard {...artifact} />
      )}
    </div>
  );
}

export default function AgentChat({ impersonateId, impersonatedName }: AgentChatProps) {
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string; type: string } | null>(null);
  const [deepThinkActive, setDeepThinkActive] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<Array<{ time: string; message: string; type: 'info' | 'tool' | 'error' | 'thought' }>>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('default');
  const [impersonatedBusiness, setImpersonatedBusiness] = useState<string | null>(impersonatedName || null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch client details if impersonating
  useEffect(() => {
    if (!impersonateId) {
      setImpersonatedBusiness(null);
      return;
    }
    const fetchProfile = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('profiles')
          .select('business_name, email')
          .eq('id', impersonateId)
          .single();
        if (data) {
          setImpersonatedBusiness(data.business_name || data.email);
        }
      } catch (err) {
        console.warn('Failed to fetch impersonated profile', err);
      }
    };
    fetchProfile();
  }, [impersonateId]);

  // Construct URL with query parameters
  const apiEndpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (impersonateId) params.append('impersonate', impersonateId);
    if (deepThinkActive) params.append('reasoning', '1');
    const qs = params.toString();
    return qs ? `/api/agent/v2/chat?${qs}` : '/api/agent/v2/chat';
  }, [impersonateId, deepThinkActive]);

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: apiEndpoint,
      body: {
        preferReasoning: deepThinkActive,
      },
    });
  }, [apiEndpoint, deepThinkActive]);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: chatTransport,
    onError: (err: any) => {
      console.error('[DeepSeek Stream Error]:', err);
      const msg = err?.message || 'Connection interrupted';
      addLog(`Stream error: ${msg}`, 'error');
      toast.error(msg);
    },
  }) as any;

  const isLoading = status === 'submitted' || status === 'streaming';

  const sessionStorageKey = useMemo(() => {
    return impersonateId ? `deepseek_sessions_${impersonateId}` : 'deepseek_sessions';
  }, [impersonateId]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(sessionStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
        }
      }
    } catch (e) {}
  }, [sessionStorageKey]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const addLog = (message: string, type: 'info' | 'tool' | 'error' | 'thought' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setExecutionLogs((prev) => [...prev.slice(-40), { time, message, type }]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isSpreadsheet = file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.tsv');
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4') || file.name.endsWith('.mov') || file.name.endsWith('.webm');

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setAttachedFile({
        name: file.name,
        content,
        type: isSpreadsheet ? 'spreadsheet' : isVideo ? 'video' : isImage ? 'image' : 'text',
      });
      addLog(`File attached: ${file.name} (${file.size} bytes, ${isVideo ? 'video' : isImage ? 'image' : 'data'})`, 'info');
      toast.success(`Attached ${file.name}`);
    };

    if (isSpreadsheet || file.type.startsWith('text/')) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if ((!textToSend.trim() && !attachedFile) || isLoading) return;

    let fullPrompt = textToSend;
    if (attachedFile) {
      fullPrompt = `[Attached File: ${attachedFile.name} (${attachedFile.type})]\nContent preview:\n${attachedFile.content.slice(0, 3000)}\n\nInstruction: ${textToSend || 'Please inspect this file and help me process it.'}`;
      addLog(`Dispatched task with attached ${attachedFile.name}`, 'info');
      setAttachedFile(null);
    }

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    addLog(`Task dispatched: "${textToSend.slice(0, 60)}..."`, 'info');
    await sendMessage({ text: fullPrompt });
  };

  const handleNewChat = () => {
    const newId = 'session_' + Date.now();
    const newSession: ChatSession = {
      id: newId,
      title: `Task Thread #${sessions.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    setActiveSessionId(newId);
    setMessages([]);
    setExecutionLogs([]);
    addLog('Started fresh task session.', 'info');
    localStorage.setItem(sessionStorageKey, JSON.stringify(updated));
    toast.success('Started a new conversation');
  };

  const handleInterrupt = () => {
    if (stop) {
      stop();
      addLog('Execution interrupted by user.', 'error');
      toast.info('DeepSeek paused execution');
    }
  };

  return (
    <div className="flex h-full w-full bg-[#fdfdfe] dark:bg-[#0d0e12] text-slate-800 dark:text-slate-100 overflow-hidden font-sans">
      {/* 1. DeepSeek Signature Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#f8faff] dark:bg-[#111318] border-r border-slate-200/80 dark:border-slate-800/80 flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
      >
        {/* Sidebar Brand & New Chat */}
        <div className="p-3 border-b border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center justify-between px-1 mb-3">
            <div className="flex items-center gap-2">
              <DeepSeekIcon className="w-7 h-7" />
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                  deepseek
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-[#4d6bfe]/10 text-[#4d6bfe]">
                  {deepThinkActive ? 'R1' : 'V3'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:border-[#4d6bfe] hover:text-[#4d6bfe] dark:hover:border-[#4d6bfe] shadow-xs transition"
          >
            <Plus size={15} />
            <span>New chat</span>
          </button>
        </div>

        {/* Sessions History List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Recent Tasks
          </div>
          {sessions.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-slate-400">
              No recent conversations
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setActiveSessionId(s.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-left transition group ${
                  activeSessionId === s.id
                    ? 'bg-[#4d6bfe]/10 text-[#4d6bfe] font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <span className="truncate pr-2">{s.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = sessions.filter((x) => x.id !== s.id);
                    setSessions(next);
                    localStorage.setItem(sessionStorageKey, JSON.stringify(next));
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition"
                >
                  <Trash2 size={12} />
                </button>
              </button>
            ))
          )}
        </div>

        {/* Sidebar Bottom Controls */}
        <div className="p-3 pb-24 md:pb-28 border-t border-slate-200/60 dark:border-slate-800/60 space-y-2">
          {/* File Manager Button */}
          <button
            onClick={() => setShowFileManager(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition"
          >
            <FolderOpen size={16} className="text-amber-500" />
            <span>File & Asset Manager</span>
          </button>

          {/* E2B Sandbox Indicator */}
          <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              E2B MicroVM Ready
            </span>
            <span className="font-mono text-[10px] text-emerald-600/70">Sandboxed</span>
          </div>

          {/* Impersonated Client Badge */}
          {impersonatedBusiness && (
            <div className="px-2.5 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-[11px] text-violet-700 dark:text-violet-300 flex items-center gap-1.5 truncate">
              <Building2 size={13} className="shrink-0" />
              <span className="truncate font-semibold">{impersonatedBusiness}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Main DeepSeek Chat Canvas */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Minimal Bar */}
        <div className="h-12 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between px-4 bg-white/70 dark:bg-[#0d0e12]/70 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Toggle Sidebar"
            >
              {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                DeepSeek Harness
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                {deepThinkActive ? 'deepseek-reasoner' : 'deepseek-chat'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLogsDrawer(!showLogsDrawer)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                showLogsDrawer
                  ? 'bg-slate-800 text-white border-slate-700'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Terminal size={13} className={isLoading ? 'text-emerald-400 animate-pulse' : ''} />
              <span className="hidden sm:inline">Logs</span>
            </button>
          </div>
        </div>

        {/* Conversation Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 ? (
              /* DeepSeek Signature Empty State */
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-3xl bg-[#4d6bfe]/10 text-[#4d6bfe] flex items-center justify-center mb-4 shadow-sm">
                  <DeepSeekIcon className="w-10 h-10" />
                </div>

                <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mb-2">
                  Hi, I'm DeepSeek.
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-8">
                  How can I help you create, automate, or launch today?
                </p>

                {/* 2x2 Quick Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                  {QUICK_ACTIONS.map((item, i) => {
                    const ActionIcon = item.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => handleSend(item.prompt)}
                        className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#13151b] hover:border-[#4d6bfe] dark:hover:border-[#4d6bfe] hover:shadow-md transition text-left group flex items-start gap-3"
                      >
                        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-[#4d6bfe] shrink-0 group-hover:bg-[#4d6bfe] group-hover:text-white transition">
                          <ActionIcon size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-[#4d6bfe] transition">
                            {item.label}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                            {item.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              messages.map((m: any, idx: number) => {
                const isUser = m.role === 'user';
                return (
                  <div key={idx} className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {!isUser && (
                      <div className="shrink-0 mt-0.5">
                        <div className="w-7 h-7 rounded-full bg-[#4d6bfe] text-white flex items-center justify-center shadow-xs">
                          <DeepSeekIcon className="w-5 h-5 text-white" />
                        </div>
                      </div>
                    )}

                    <div className={`max-w-[85%] ${isUser ? 'order-1' : ''}`}>
                      {/* DeepSeek Signature Thinking Process Block */}
                      {m.reasoning && (
                        <div className="mb-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/60 dark:bg-[#16181d] p-3 text-xs">
                          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-medium mb-1.5">
                            <BrainCircuit size={13} className="text-[#4d6bfe]" />
                            <span>Thinking Process</span>
                          </div>
                          <div className="text-slate-600 dark:text-slate-400 italic font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                            {m.reasoning}
                          </div>
                        </div>
                      )}

                      {/* Tool Calls */}
                      {Array.isArray(m.parts) &&
                        m.parts
                          .filter((p: any) => p.type === 'tool-call' || p.type?.startsWith('tool-'))
                          .map((tool: any, tIdx: number) => (
                            <ToolExecutionCard key={tIdx} tool={tool} idx={tIdx} isLoading={isLoading} />
                          ))}

                      {/* Message Content */}
                      {m.content && (
                        <div
                          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                            isUser
                              ? 'bg-[#eef3ff] dark:bg-[#1b2234] text-slate-900 dark:text-slate-100 font-medium'
                              : 'bg-transparent text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <AgentMarkdown content={m.content} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                <Loader2 size={14} className="animate-spin text-[#4d6bfe]" />
                <span>DeepSeek is thinking...</span>
              </div>
            )}
          </div>
        </div>

        {/* 3. DeepSeek Signature Floating Input Dock */}
        <div className="p-4 pb-24 md:pb-28 shrink-0 bg-gradient-to-t from-white via-white dark:from-[#0d0e12] dark:via-[#0d0e12] to-transparent">
          <div className="max-w-3xl mx-auto">
            {/* Attached File Preview Strip */}
            {attachedFile && (
              <div className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300 text-xs">
                {attachedFile.type === 'video' ? (
                  <FileVideo size={14} className="text-[#4d6bfe]" />
                ) : attachedFile.type === 'spreadsheet' ? (
                  <FileSpreadsheet size={14} />
                ) : (
                  <ImageIcon size={14} />
                )}
                <span className="font-semibold truncate max-w-xs">{attachedFile.name}</span>
                <button onClick={() => setAttachedFile(null)} className="ml-1 text-slate-400 hover:text-rose-500 font-bold">
                  ×
                </button>
              </div>
            )}

            {/* Input Box Container */}
            <div className="relative rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#16181d] shadow-lg hover:border-slate-300 dark:hover:border-slate-700 transition focus-within:border-[#4d6bfe] dark:focus-within:border-[#4d6bfe] p-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  impersonatedBusiness
                    ? `Message DeepSeek for ${impersonatedBusiness}...`
                    : 'Message DeepSeek (attach video clips, images, or instructions)...'
                }
                rows={1}
                className="w-full resize-none bg-transparent outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 px-1 py-1 max-h-44"
              />

              {/* Bottom Buttons Bar Inside Box */}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100 dark:border-slate-800/60">
                <div className="flex items-center gap-1.5">
                  {/* DeepThink (R1) Toggle Pill */}
                  <button
                    type="button"
                    onClick={() => {
                      setDeepThinkActive(!deepThinkActive);
                      toast.info(deepThinkActive ? 'Switched to DeepSeek-V3 (Fast Mode)' : 'Activated DeepThink R1 (Deep Reasoning)');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
                      deepThinkActive
                        ? 'bg-[#4d6bfe] text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                    title="DeepThink (R1) - Chain of Thought"
                  >
                    <BrainCircuit size={13} />
                    <span>DeepThink (R1)</span>
                  </button>

                  {/* Web Search Toggle Pill */}
                  <button
                    type="button"
                    onClick={() => {
                      setSearchActive(!searchActive);
                      toast.info(searchActive ? 'Search disabled' : 'Search enabled');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
                      searchActive
                        ? 'bg-[#4d6bfe] text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                    title="DeepSeek Web Search"
                  >
                    <Globe size={13} />
                    <span>Search</span>
                  </button>

                  {/* File Manager Button */}
                  <button
                    type="button"
                    onClick={() => setShowFileManager(true)}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    title="File & Asset Manager"
                  >
                    <FolderOpen size={16} />
                  </button>

                  {/* Attach Button */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".csv,.xlsx,.tsv,.txt,image/*,video/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    title="Attach Video, Image, or CSV"
                  >
                    <Paperclip size={16} />
                  </button>

                  {/* Voice Input Button */}
                  <VoiceInputButton onTranscript={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))} />
                </div>

                {/* Send / Stop Button */}
                {isLoading ? (
                  <button
                    type="button"
                    onClick={handleInterrupt}
                    className="w-8 h-8 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow transition"
                    title="Stop generation"
                  >
                    <Square size={14} className="fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!input.trim() && !attachedFile}
                    className="w-8 h-8 rounded-full bg-[#4d6bfe] hover:bg-[#3d5bfe] disabled:opacity-40 disabled:hover:bg-[#4d6bfe] text-white flex items-center justify-center shadow-md transition"
                    title="Send message"
                  >
                    <Send size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* File & Asset Manager Modal Drawer */}
      <FileManagerDrawer
        isOpen={showFileManager}
        onClose={() => setShowFileManager(false)}
        userId={impersonateId}
        onSelectAsset={(url, name) => {
          setInput((prev) => (prev ? `${prev} [Use Asset: ${name} (${url})]` : `Please use asset: ${name} (${url})`));
          toast.success(`Selected ${name}`);
        }}
      />
    </div>
  );
}
