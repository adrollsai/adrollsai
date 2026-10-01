'use client';

import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';
import VoiceInputButton from './VoiceInputButton';
import HtmlArtifactPreview from './HtmlArtifactPreview';
import ActionConfirmationCard from './ActionConfirmationCard';
import ProgressTrackerCard from './ProgressTrackerCard';
import NoboMascot from './NoboMascot';
import { toast } from 'sonner';

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
}

const QUICK_ACTIONS = [
  { label: 'Follow up with qualified leads', prompt: 'Find all leads in the qualified stage in my CRM and suggest a personalized WhatsApp & call followup strategy.' },
  { label: 'Meta Ads performance & CPL audit', prompt: 'Connect to Meta Ads MCP, list my active campaigns, and give me a complete breakdown of ad spend and cost per lead.' },
  { label: 'Create 15s product/service reel script', prompt: 'Search my top catalog offering and generate a high-converting 15-second video script and angle for social media reels.' },
  { label: 'Preview WhatsApp broadcast message', prompt: 'Create an engaging WhatsApp broadcast template preview with CTA buttons for our latest offering.' },
];

export default function AgentChat() {
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string; type: string } | null>(null);
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);
  const [showSessionDrawer, setShowSessionDrawer] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<Array<{ time: string; message: string; type: 'info' | 'tool' | 'error' | 'thought' }>>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('default');

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: '/api/agent/v2/chat' }),
  }) as any;

  const isLoading = status === 'submitted' || status === 'streaming';

  // Load and save sessions in local storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nobogent_agent_sessions');
      if (saved) {
        setSessions(JSON.parse(saved));
      } else {
        const initial = [{ id: 'default', title: 'Main Workspace Chat', createdAt: new Date().toISOString() }];
        setSessions(initial);
        localStorage.setItem('nobogent_agent_sessions', JSON.stringify(initial));
      }
    } catch {}
  }, []);

  // Track live execution logs
  useEffect(() => {
    if (status === 'submitted') {
      addLog('User instruction received. Formulating execution plan...', 'thought');
    } else if (status === 'streaming') {
      addLog('Streaming reasoning & coordinating agent tools...', 'info');
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
    localStorage.setItem('nobogent_agent_sessions', JSON.stringify(updated));
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

  const renderToolCall = (tool: any, idx: number) => {
    const toolName = tool.toolName || (tool.type?.startsWith('tool-') ? tool.type.slice(5) : 'action');
    const state = tool.state;
    const output = tool.result || tool.output;

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
      <div key={idx} className="my-2 text-xs">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          <Wrench size={12} className={state === 'result' ? 'text-emerald-500' : 'text-blue-500 animate-spin'} />
          <span className="font-mono font-medium">{toolName}</span>
          {state === 'result' ? (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold ml-1">✓ Done</span>
          ) : (
            <span className="text-[10px] text-blue-500 ml-1">Executing...</span>
          )}
        </div>

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
            <NoboMascot size="lg" state="idle" message="Hi! I'm Nobo, your AI business partner." className="mb-4" />
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
                    <div className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-br-none shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-bl-none border border-slate-200/80 dark:border-slate-800'
                    }`}>
                      {messageText ? (
                        <div className="whitespace-pre-wrap">{messageText}</div>
                      ) : isUser ? (
                        <div className="whitespace-pre-wrap italic opacity-80">Sent instruction...</div>
                      ) : null}

                      {!isUser && m.parts && m.parts.map((part: any, pIdx: number) => {
                        if (part.type === 'tool-invocation') {
                          return renderToolCall(part.toolInvocation, pIdx);
                        }
                        if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
                          return renderToolCall(part, pIdx);
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
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-200 max-h-48 overflow-y-auto p-3 font-mono text-[11px]">
          <div className="flex items-center justify-between text-slate-400 pb-2 mb-2 border-b border-slate-800 text-[10px] uppercase font-bold tracking-wider">
            <span className="flex items-center gap-1.5">
              <Terminal size={12} className="text-emerald-400" /> Live Agent Execution Logs
            </span>
            <button onClick={() => setExecutionLogs([])} className="hover:text-slate-200 flex items-center gap-1">
              <Trash2 size={11} /> Clear
            </button>
          </div>
          {executionLogs.length === 0 ? (
            <p className="text-slate-500 italic">No activity logs recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {executionLogs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-500 select-none">[{log.time}]</span>
                  <span className={log.type === 'error' ? 'text-rose-400' : log.type === 'thought' ? 'text-amber-300' : 'text-slate-300'}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Attached file chip */}
      {attachedFile && (
        <div className="px-4 py-1.5 bg-blue-50 dark:bg-blue-950/40 border-t border-blue-100 dark:border-blue-900 flex items-center justify-between text-xs text-blue-700 dark:text-blue-300">
          <div className="flex items-center gap-2">
            {attachedFile.type === 'image' ? <ImageIcon size={14} /> : <FileSpreadsheet size={14} />}
            <span className="font-semibold">{attachedFile.name}</span>
            <span className="text-[10px] opacity-75">({attachedFile.type})</span>
          </div>
          <button
            onClick={() => setAttachedFile(null)}
            className="hover:text-rose-500 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bottom Input Area */}
      <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".csv,.xlsx,.tsv,.txt,.jpg,.jpeg,.png,.webp"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-full text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Attach CSV, Excel, or property image"
          >
            <Paperclip size={18} />
          </button>

          <VoiceInputButton
            onTranscript={(transcript) => {
              setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
            }}
            disabled={isLoading}
          />

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell the agent what to do (e.g. check ad CPL, launch broadcast, parse CSV)..."
            disabled={isLoading}
            className="flex-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />

          {isLoading ? (
            <button
              type="button"
              onClick={handleInterrupt}
              className="p-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-500/20 transition flex items-center justify-center shrink-0"
              title="Interrupt / Stop Agent"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={(!input.trim() && !attachedFile) || isLoading}
              className="p-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 disabled:opacity-40 transition flex items-center justify-center shrink-0"
              title="Send Message"
            >
              <Send size={18} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
