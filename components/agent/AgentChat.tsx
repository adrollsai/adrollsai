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
  Bot,
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
} from 'lucide-react';
import VoiceInputButton from './VoiceInputButton';
import HtmlArtifactPreview from './HtmlArtifactPreview';
import ActionConfirmationCard from './ActionConfirmationCard';
import ProgressTrackerCard from './ProgressTrackerCard';
import NoboMascot from './NoboMascot';
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
}

const QUICK_ACTIONS = [
  { label: 'Meta Ads performance & spend (last 25 days)', prompt: 'Connect to Meta Ads MCP, check total spend, impressions, clicks, leads, and cost per lead for the last 25 days, and break down active campaigns.' },
  { label: 'Follow up with qualified leads', prompt: 'Find all leads in the qualified stage in my CRM and suggest a personalized WhatsApp & call followup strategy.' },
  { label: 'Create 15s product/service reel script', prompt: 'Search my top catalog offering and generate a high-converting 15-second video script and angle for social media reels.' },
  { label: 'Preview WhatsApp broadcast message', prompt: 'Create an engaging WhatsApp broadcast template preview with CTA buttons for our latest offering.' },
];

function getToolDisplayInfo(rawName: string) {
  switch (rawName) {
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
    case 'voice_trigger_call':
      return { label: 'Voice AI • Telephony Calling', Icon: PhoneCall };
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

  // Determine state with precision
  const isOutputAvailable =
    tool.state === 'output-available' ||
    tool.state === 'result' ||
    tool.state === 'approval-responded' ||
    output !== undefined;

  const isError =
    tool.state === 'output-error' ||
    (isOutputAvailable && output && (output.success === false || !!output.error));

  const isApprovalRequired =
    tool.state === 'approval-requested' ||
    (output?.requiresApproval && output?.actionPayload);

  // Spinner MUST only spin if the stream is currently loading AND no output is available yet
  const isExecuting = !isOutputAvailable && !isError && !isApprovalRequired && isLoading;
  const isDone = (isOutputAvailable || !isLoading) && !isError && !isApprovalRequired;

  const artifact = output?.artifact || (output?.actionPayload && output?.requiresApproval ? {
    type: 'action_confirmation',
    actionId: output.actionPayload.payload?.actionId || `act_${idx}`,
    title: output.actionPayload.title,
    description: output.actionPayload.description,
    estimatedCost: output.actionPayload.estimatedCost,
    actionType: output.actionPayload.actionType,
    payload: output.actionPayload.payload,
    status: 'pending',
  } : null);

  return (
    <div key={idx} className="my-2.5 text-xs">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer select-none ${
          isError
            ? 'bg-rose-50/80 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/50 hover:bg-rose-100/60'
            : isApprovalRequired
            ? 'bg-amber-50/80 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/50 hover:bg-amber-100/60'
            : isExecuting
            ? 'bg-blue-50/80 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/50'
            : 'bg-slate-100/90 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200/90 dark:border-slate-700/80 hover:bg-slate-200/70 dark:hover:bg-slate-800'
        }`}
      >
        <div className="shrink-0">
          {isExecuting ? (
            <Loader2 size={13} className="text-blue-600 dark:text-blue-400 animate-spin" />
          ) : isError ? (
            <AlertCircle size={13} className="text-rose-600 dark:text-rose-400" />
          ) : isApprovalRequired ? (
            <ShieldAlert size={13} className="text-amber-600 dark:text-amber-400" />
          ) : (
            <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
          )}
        </div>

        <span className="font-semibold text-[11px] tracking-tight">{label}</span>

        <span className="text-[10px] ml-1 font-medium">
          {isExecuting ? (
            <span className="text-blue-600 dark:text-blue-400">Executing...</span>
          ) : isError ? (
            <span className="text-rose-600 dark:text-rose-400 font-bold">Failed</span>
          ) : isApprovalRequired ? (
            <span className="text-amber-600 dark:text-amber-400 font-bold">Approval Required</span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ Done</span>
          )}
        </span>

        <div className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-1">
          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </div>

      {/* Collapsible Details Drawer */}
      {isExpanded && (
        <div className="mt-2 p-3 rounded-xl bg-slate-900 text-slate-200 text-[11px] border border-slate-800 space-y-2 max-w-xl font-mono animate-in fade-in-50 duration-150">
          {inputArgs && Object.keys(inputArgs).length > 0 && (
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">
                Inputs / Parameters:
              </span>
              <pre className="p-2 rounded bg-slate-950 overflow-x-auto text-[10px] text-blue-300 leading-snug">
                {JSON.stringify(inputArgs, null, 2)}
              </pre>
            </div>
          )}

          {output && (
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">
                Execution Result:
              </span>
              <pre className="p-2 rounded bg-slate-950 overflow-x-auto text-[10px] text-emerald-300 leading-snug max-h-48">
                {JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Render interactive rich cards if requested */}
      {artifact && artifact.type === 'html_sandbox' && (
        <HtmlArtifactPreview
          title={artifact.title}
          html={artifact.html}
          description={artifact.description}
        />
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

export default function AgentChat({ impersonateId }: AgentChatProps) {
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string; type: string } | null>(null);
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);
  const [showSessionDrawer, setShowSessionDrawer] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<Array<{ time: string; message: string; type: 'info' | 'tool' | 'error' | 'thought' }>>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('default');
  const [impersonatedBusiness, setImpersonatedBusiness] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Construct URL with impersonate query param so agent backend switches context
  const apiEndpoint = useMemo(() => {
    return impersonateId ? `/api/agent/v2/chat?impersonate=${encodeURIComponent(impersonateId)}` : '/api/agent/v2/chat';
  }, [impersonateId]);

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({ api: apiEndpoint });
  }, [apiEndpoint]);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: chatTransport,
    onError: (err: any) => {
      console.error('[Nobo Agent Stream Error]:', err);
      addLog(`Error encountered: ${err.message || 'Stream interrupted'}`, 'error');
      toast.error(err.message || 'Failed to get response from Nobo');
    },
  }) as any;

  const isLoading = status === 'submitted' || status === 'streaming';

  const sessionStorageKey = useMemo(() => {
    return impersonateId ? `nobogent_agent_sessions_${impersonateId}` : 'nobogent_agent_sessions';
  }, [impersonateId]);

  // Load and save sessions in local storage scoped to current impersonated tenant
  useEffect(() => {
    try {
      const saved = localStorage.getItem(sessionStorageKey);
      if (saved) {
        setSessions(JSON.parse(saved));
      } else {
        const initial = [{ id: 'default', title: 'Main Workspace Chat', createdAt: new Date().toISOString() }];
        setSessions(initial);
        localStorage.setItem(sessionStorageKey, JSON.stringify(initial));
      }
    } catch {}
  }, [sessionStorageKey]);

  // Track live execution logs
  useEffect(() => {
    if (status === 'submitted') {
      addLog('User instruction received. Formulating execution plan...', 'thought');
    } else if (status === 'streaming') {
      addLog('Executing tools & coordinating response...', 'info');
    }
  }, [status]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const addLog = (message: string, type: 'info' | 'tool' | 'error' | 'thought' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setExecutionLogs((prev) => [...prev.slice(-40), { time, message, type }]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isSpreadsheet = file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.tsv');
    const isImage = file.type.startsWith('image/');

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setAttachedFile({
        name: file.name,
        content,
        type: isSpreadsheet ? 'spreadsheet' : isImage ? 'image' : 'text',
      });
      addLog(`File attached: ${file.name} (${file.size} bytes)`, 'info');
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
      addLog(`Dispatched multi-modal task with attached ${attachedFile.name}`, 'info');
      setAttachedFile(null);
    }

    setInput('');
    addLog(`Task: "${textToSend.slice(0, 60)}..."`, 'info');
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
    addLog('Started new clean task thread.', 'info');
    localStorage.setItem(sessionStorageKey, JSON.stringify(updated));
    setShowSessionDrawer(false);
    toast.success('Started a new conversation');
  };

  const handleInterrupt = () => {
    if (stop) {
      stop();
      addLog('Execution interrupted by user.', 'error');
      toast.info('Nobo paused execution');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] max-w-5xl mx-auto bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden relative">
      {/* Top Header Controls */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <NoboMascot size="sm" state={isLoading ? 'thinking' : 'idle'} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Nobo</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                AI Business Partner
              </span>
              {impersonatedBusiness && (
                <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 dark:bg-violet-950/80 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                  <Building2 size={11} />
                  <span>Viewing: {impersonatedBusiness}</span>
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Autonomous Digital Employee • DeepSeek v4.1 • Meta MCP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* New Chat Button */}
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-semibold transition"
            title="Start a new clean chat"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">New Task</span>
          </button>

          {/* History/Sessions toggle */}
          <button
            onClick={() => setShowSessionDrawer(!showSessionDrawer)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Chat History"
          >
            <History size={16} />
          </button>

          {/* Live Activity Logs Drawer Toggle */}
          <button
            onClick={() => setShowLogsDrawer(!showLogsDrawer)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
              showLogsDrawer
                ? 'bg-slate-800 text-white border-slate-700'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Terminal size={14} className={isLoading ? 'text-emerald-400 animate-pulse' : ''} />
            <span className="hidden sm:inline">Activity Logs</span>
            {showLogsDrawer ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Main Message Stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto my-auto py-8">
            <NoboMascot size="lg" state="idle" message={`Hi! I'm Nobo, your AI business partner for ${impersonatedBusiness || 'your company'}.`} className="mb-4" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">
              What can I accomplish for you today?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
              I have direct control over your CRM, Meta Ads via official MCP, WhatsApp broadcasts with live previews, telephony calling, video rendering, and dynamic code execution.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(action.prompt)}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 text-slate-700 dark:text-slate-300 transition group flex flex-col justify-between"
                >
                  <span className="text-xs font-semibold group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    {action.label}
                  </span>
                  <ArrowRight size={13} className="text-slate-400 group-hover:text-blue-500 group-hover:translate-x-0.5 transition self-end mt-2" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m: any, idx: number) => {
            const isUser = m.role === 'user';
            return (
              <div key={idx} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="shrink-0 mt-0.5">
                    <NoboMascot size="sm" state={isLoading && idx === messages.length - 1 ? 'thinking' : 'idle'} />
                  </div>
                )}

                {(() => {
                  const textParts = Array.isArray(m.parts)
                    ? m.parts
                        .filter((p: any) => p.type === 'text' && p.text)
                        .map((p: any) => p.text)
                        .join('')
                    : '';
                  const messageText = (typeof m.content === 'string' && m.content.trim())
                    ? m.content
                    : textParts;

                  return (
                    <div className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-br-none shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-bl-none border border-slate-200/80 dark:border-slate-800 shadow-xs'
                    }`}>
                      {messageText ? (
                        isUser ? (
                          <div className="whitespace-pre-wrap">{messageText}</div>
                        ) : (
                          <AgentMarkdown content={messageText} />
                        )
                      ) : isUser ? (
                        <div className="whitespace-pre-wrap italic opacity-80">Sent instruction...</div>
                      ) : null}

                      {!isUser && m.parts && m.parts.map((part: any, pIdx: number) => {
                        if (part.type === 'tool-invocation') {
                          return <ToolExecutionCard key={pIdx} tool={part.toolInvocation} idx={pIdx} isLoading={isLoading} />;
                        }
                        if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
                          return <ToolExecutionCard key={pIdx} tool={part} idx={pIdx} isLoading={isLoading} />;
                        }
                        return null;
                      })}
                    </div>
                  );
                })()}

                {isUser && (
                  <div className="w-7 h-7 rounded-lg bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                    <User size={14} />
                  </div>
                )}
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex gap-3 justify-start items-center text-slate-400 text-xs py-2">
            <NoboMascot size="sm" state="thinking" message="Executing multi-step mission..." />
          </div>
        )}
      </div>

      {/* Live Activity & Execution Logs Drawer */}
      {showLogsDrawer && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-300 p-3 h-48 overflow-y-auto font-mono text-xs space-y-1.5 transition-all animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center justify-between pb-1 border-b border-slate-800 text-[11px] text-slate-400">
            <span className="font-bold flex items-center gap-1.5 text-slate-300">
              <Terminal size={13} className="text-emerald-400" />
              Live Omni-Agent Execution Journal
            </span>
            <span className="text-[10px] text-slate-500">{executionLogs.length} events</span>
          </div>
          {executionLogs.length === 0 ? (
            <p className="text-slate-600 italic py-2">No activity logged yet.</p>
          ) : (
            executionLogs.map((log, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] leading-tight">
                <span className="text-slate-500 shrink-0">[{log.time}]</span>
                <span className={`shrink-0 font-bold uppercase text-[9px] px-1 py-0.2 rounded ${
                  log.type === 'thought' ? 'bg-violet-900/60 text-violet-300' :
                  log.type === 'tool' ? 'bg-blue-900/60 text-blue-300' :
                  log.type === 'error' ? 'bg-rose-900/60 text-rose-300' :
                  'bg-emerald-900/60 text-emerald-300'
                }`}>
                  {log.type}
                </span>
                <span className="text-slate-200 break-words flex-1">{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Chat History Sessions Drawer */}
      {showSessionDrawer && (
        <div className="absolute top-14 right-4 z-30 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-3 space-y-2 animate-in fade-in-50 duration-150">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <History size={13} />
              Saved Chat Threads
            </h4>
            <button
              onClick={() => {
                localStorage.removeItem(sessionStorageKey);
                setSessions([]);
                setMessages([]);
                toast.success('History cleared');
              }}
              className="text-[10px] text-rose-500 hover:text-rose-600 flex items-center gap-1"
            >
              <Trash2 size={11} /> Clear
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setActiveSessionId(s.id);
                  setShowSessionDrawer(false);
                }}
                className={`w-full text-left p-2 rounded-lg text-xs transition ${
                  activeSessionId === s.id
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="truncate">{s.title}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{new Date(s.createdAt).toLocaleDateString()}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        {attachedFile && (
          <div className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300 text-xs">
            {attachedFile.type === 'spreadsheet' ? <FileSpreadsheet size={14} /> : <ImageIcon size={14} />}
            <span className="font-medium truncate max-w-xs">{attachedFile.name}</span>
            <button
              onClick={() => setAttachedFile(null)}
              className="ml-1 text-slate-400 hover:text-rose-500 font-bold"
            >
              ×
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          {/* File Attachment Button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv,.xlsx,.tsv,.txt,image/*"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
            title="Attach CSV, Excel, or Image"
          >
            <Paperclip size={18} />
          </button>

          {/* Voice Input */}
          <VoiceInputButton
            onTranscript={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))}
          />

          {/* Main Prompt Input */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              impersonatedBusiness
                ? `Ask Nobo anything for ${impersonatedBusiness}... (e.g. check ad spend, review CPL, draft flyer)`
                : 'Tell the agent what to do (e.g. check ad spend, launch broadcast, parse CSV)...'
            }
            disabled={isLoading}
            className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition"
          />

          {/* Submit or Stop Button */}
          {isLoading ? (
            <button
              type="button"
              onClick={handleInterrupt}
              className="p-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition shrink-0"
              title="Pause execution"
            >
              <Square size={16} className="fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() && !attachedFile}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 text-white transition shrink-0 shadow-sm"
              title="Send task to Nobo"
            >
              <Send size={16} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
