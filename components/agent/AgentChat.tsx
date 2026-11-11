'use client';

import * as React from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Send,
  Loader2,
  Paperclip,
  Square,
  Plus,
  Terminal,
  ChevronDown,
  ChevronUp,
  Trash2,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  FolderPlus,
  FileVideo,
  FileSpreadsheet,
  BrainCircuit,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  Copy,
  RotateCcw,
  Bot,
  Search,
  Settings,
  Download,
  Film,
  Globe,
  Code2,
  PhoneCall,
  MessageSquare,
  BarChart2,
  Megaphone,
  PlusCircle,
  Rocket,
  Users,
  ShieldAlert,
  Wrench,
  Sparkles,
  ArrowDown,
  Layers,
  Activity,
  Maximize2,
  Play,
  FileEdit,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';
import VoiceInputButton from './VoiceInputButton';
import HtmlArtifactPreview from './HtmlArtifactPreview';
import ActionConfirmationCard from './ActionConfirmationCard';
import ProgressTrackerCard from './ProgressTrackerCard';
import FileManagerDrawer from './FileManagerDrawer';
import AgentMarkdown from './AgentMarkdown';
import { ThinkFeedRow, ToolFeedRow } from './FeedRows';
import HarnessTranscript from './HarnessTranscript';
import HarnessDetails from './HarnessDetails';
import { useHarnessSession } from '@/lib/agent/harness/useHarnessSession';
import { itemsToUIMessages } from '@/lib/agent/harness/projection';
import { AGENT_MODEL, displayNameFor } from '@/lib/agent/models';
import { resolveToolPresentation, summarizeToolInput } from '@/lib/agent/presentation';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';

interface WorkspaceFolder {
  id: string;
  name: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentChatProps {
  impersonateId?: string | null;
  impersonatedName?: string | null;
}

const DEFAULT_WORKSPACES: WorkspaceFolder[] = [
  { id: 'ws_default', name: 'General', createdAt: new Date().toISOString() },
];

function formatTimeAgo(isoString: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  } catch {
    return 'now';
  }
}

function SafeMessageRenderer({ m, mIdx, messages, isLoading, handleSend, handleCopyMessage, copiedIndex, reload }: any) {
  try {
    if (!m || typeof m !== 'object') return null;
    const isUser = m.role === 'user';

    if (isUser) {
      const rawUserText = (typeof m.content === 'string' ? m.content : '') || (typeof m.parts?.[0]?.text === 'string' ? m.parts[0].text : '') || '';

      // Clean out any raw base64 data preview strings from messages to avoid DOM layout freezes
      const sanitizedText = rawUserText.replace(/Content preview:\s*data:[^;\n]+;base64,[A-Za-z0-9+/=]+/g, '[Embedded Media Data]');

      const attachmentMatch = sanitizedText.match(/\[Attached File:\s*([^()\]]+)\s*\(([^)]+)\)\]/i);
      const urlMatch = sanitizedText.match(/URL:\s*(https?:\/\/[^\s\n]+)/i);

      // Clean user prompt text without attachment boilerplate
      let displayText = sanitizedText
        .replace(/\[Attached File:[^\]]+\]/gi, '')
        .replace(/URL:\s*https?:\/\/[^\s\n]+/gi, '')
        .replace(/Instruction:\s*/gi, '')
        .trim();

      const fileName = attachmentMatch ? attachmentMatch[1].trim() : null;
      const fileType = attachmentMatch ? attachmentMatch[2].trim() : null;
      const fileUrl = urlMatch ? urlMatch[1].trim() : null;

      return (
        <div key={m.id || mIdx} className="my-3 flex justify-end font-sans">
          <div className="flex flex-col items-end max-w-[80%]">
            <div
              className="rounded-[16px] px-4 py-2.5 dsh-t-prose break-words space-y-1.5"
              style={{
                background: 'var(--dsw-alias-bg-layer-2)',
                border: '1px solid var(--dsw-alias-border-l1)',
                color: 'var(--dsw-alias-label-primary)',
              }}
            >
              {fileName && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] dsh-chip dsh-t-xs dsh-mono">
                  {fileType === 'video' ? <FileVideo size={13} className="dsh-accent" /> : <Paperclip size={13} className="dsh-accent" />}
                  <span className="font-semibold truncate max-w-[240px]">{fileName}</span>
                  {fileUrl && (
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 dsh-t-xxxs dsh-accent underline"
                    >
                      view
                    </a>
                  )}
                </div>
              )}
              {displayText && <AgentMarkdown content={displayText} />}
            </div>
            <button
              onClick={() => handleCopyMessage(sanitizedText, mIdx)}
              className="mt-1 dsh-label-caption dsh-interactive p-0.5"
              title="Copy"
            >
              {copiedIndex === mIdx ? <Check size={12} className="dsh-success" /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      );
    }

    // Assistant Message
    const parts = Array.isArray(m.parts) ? m.parts.filter((p: any) => p && typeof p === 'object') : [];
    const hasReasoningPart = parts.some((p: any) => p.type === 'reasoning' || p.type === 'thinking');

    let fallbackReasoning = '';
    let rawText = '';
    try {
      rawText = (typeof m.content === 'string' ? m.content : '') || parts.filter((p: any) => p.type === 'text').map((p: any) => typeof p.text === 'string' ? p.text : '').join('') || '';
      if (!hasReasoningPart && rawText.includes('<think>')) {
        const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
        if (thinkMatch) {
          fallbackReasoning = thinkMatch[1].trim();
          rawText = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
        }
      }
    } catch (e) {}
    const finalTexts = rawText.replace(/<\/?think>/g, '').trim();

    return (
      <div key={m.id || mIdx} className="space-y-1 my-3">
        {fallbackReasoning && <ThinkFeedRow text={fallbackReasoning} />}

        {parts.map((part: any, pIdx: number) => {
          try {
            if (!part || typeof part !== 'object') return null;
            const partType = typeof part.type === 'string' ? part.type : '';
            if (partType === 'reasoning' || partType === 'thinking') {
              const thoughtText = typeof part.text === 'string' ? part.text : typeof part.reasoning === 'string' ? part.reasoning : '';
              if (!thoughtText.trim()) return null;
              return <ThinkFeedRow key={pIdx} text={thoughtText} />;
            }
            if (partType === 'tool-call' || partType === 'tool-invocation' || partType.startsWith('tool-')) {
              return (
                <ToolFeedRow
                  key={pIdx}
                  tool={part}
                  isLoading={isLoading && mIdx === messages.length - 1}
                  onOptionSelect={handleSend}
                />
              );
            }
          } catch (e) {}
          return null;
        })}

        {finalTexts && (
          <div className="pt-2 dsh-t-prose dsh-label-primary">
            <AgentMarkdown content={finalTexts} />
            {!isLoading && (
              <div className="flex items-center gap-3 pt-2 dsh-label-caption dsh-t-xs">
                <button onClick={() => handleCopyMessage(finalTexts, mIdx)} className="dsh-interactive" title="Copy">
                  {copiedIndex === mIdx ? <Check size={13} className="dsh-success" /> : <Copy size={13} />}
                </button>
                {mIdx === messages.length - 1 && reload && (
                  <button onClick={() => reload()} className="dsh-interactive" title="Retry">
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  } catch (renderErr: any) {
    console.error('[SafeMessageRenderer] crash on message', mIdx, renderErr);
    return (
      <div key={m?.id || mIdx} className="my-2 px-3 py-2 rounded-[8px] dsh-surface-2 dsh-border dsh-t-xs dsh-label-caption dsh-mono">
        ⚠ Message {mIdx + 1} could not be rendered. <span className="dsh-danger">{String(renderErr?.message || '').slice(0, 80)}</span>
      </div>
    );
  }
}

export default function AgentChat({ impersonateId, impersonatedName }: AgentChatProps) {
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    url?: string;
    content?: string;
    type: string;
    size?: number;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Start collapsed on phones: the rail is an overlay there, and covering the
  // conversation the moment the page loads is both confusing and slow-feeling.
  useEffect(() => {
    try {
      if (window.innerWidth < 768) setSidebarOpen(false);
    } catch {}
  }, []);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'trajectory'>('chat');
  // The third column of the AppFrame. `activeTab` is kept for the header
  // control's visual state but the panel is what it actually toggles.
  const [showDetails, setShowDetails] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  // Workspaces state (DeepSeek Harness style)
  const [workspaces, setWorkspaces] = useState<WorkspaceFolder[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('ws_general');
  // Workspace folders collapse, so a long session list cannot swamp the rail.
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set());
  const toggleWorkspaceCollapsed = (id: string) =>
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sessions state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session_init');

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionStorageKey = useMemo(() => {
    return impersonateId ? `nobo_harness_sessions_${impersonateId}` : 'nobo_harness_sessions';
  }, [impersonateId]);

  const workspaceStorageKey = useMemo(() => {
    return impersonateId ? `nobo_harness_workspaces_${impersonateId}` : 'nobo_harness_workspaces';
  }, [impersonateId]);

  const lastSessionStorageKey = useMemo(() => {
    return impersonateId ? `nobo_harness_last_sess_${impersonateId}` : 'nobo_harness_last_sess';
  }, [impersonateId]);

  // Construct API endpoint
  const apiEndpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (impersonateId) params.append('impersonate', impersonateId);
    const qs = params.toString();
    return qs ? `/api/agent/v2/chat?${qs}` : '/api/agent/v2/chat';
  }, [impersonateId]);

  // ── durable session log ────────────────────────────────────────────────
  // When the store is available the conversation lives in the event log and
  // the UI is a projection over it. When it is not (migration not applied) we
  // fall back to the previous localStorage behaviour so nothing breaks.
  const harness = useHarnessSession();
  const [logSessionId, setLogSessionId] = useState<string | null>(null);
  const logEnabled = harness.available === true && logSessionId !== null;
  const projected = harness.state && harness.state.sessionId === logSessionId ? harness.state : null;

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: apiEndpoint,
      body: {
        sessionId: logSessionId || undefined,
      },
    });
  }, [apiEndpoint, logSessionId]);

  const handleError = useCallback((err: any) => {
    console.error('[Nobo Harness Error]:', err);
    toast.error(err?.message || 'Connection interrupted');
  }, []);

  const { messages, sendMessage, status, stop, setMessages, reload } = useChat({
    transport: chatTransport,
    onError: handleError,
  }) as any;

  // A durable run counts as "busy" exactly like a streaming turn, so the
  // composer, spinner and live indicator all behave the same either way.
  const isLoading =
    status === 'submitted' || status === 'streaming' || harness.runInProgress === true;

  // ── Follow-up queue ──────────────────────────────────────────────────
  // Sending while a turn is streaming used to be blocked outright, so a user
  // who thought of a correction had to wait for the agent to finish. Messages
  // composed mid-turn are now queued and dispatched the moment the turn ends,
  // in the order they were typed.
  const [queuedCount, setQueuedCount] = useState(0);
  const queueRef = useRef<string[]>([]);
  const handleSendRef = useRef<(text?: string) => Promise<void>>(async () => {});

  // Two-step delete confirmation: holds the id awaiting a second click.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Theme. Light is the default; the choice persists per browser.
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    let initial: 'light' | 'dark' = 'light';
    try {
      const saved = localStorage.getItem('nobo_agent_theme');
      if (saved === 'dark' || saved === 'light') initial = saved;
    } catch {}
    setTheme(initial);
    document.querySelector('.dsh')?.setAttribute('data-theme', initial);
  }, []);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('nobo_agent_theme', next);
    } catch {}
    document.querySelector('.dsh')?.setAttribute('data-theme', next);
  };

  useEffect(() => {
    handleSendRef.current = handleSend;
  });

  useEffect(() => {
    if (isLoading || isUploading) return;
    if (queueRef.current.length === 0) return;
    const next = queueRef.current.shift() as string;
    setQueuedCount(queueRef.current.length);
    void handleSendRef.current(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isUploading]);

  // When a run finishes, the turn is in the log — reload the projection so the
  // live view is replaced by the authoritative replay view.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !isLoading && logSessionId) {
      void harness.openSession(logSessionId);
    }
    wasStreaming.current = isLoading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, logSessionId]);

  const setMessagesRef = useRef(setMessages);
  setMessagesRef.current = setMessages;

  // Load Workspaces and Sessions ONCE on mount
  useEffect(() => {
    try {
      const savedWs = localStorage.getItem(workspaceStorageKey);
      const dummyNames = ['sanjay talwar', 'Himanshu video', 'UST video demo', 'Chess', 'real estate template'];
      let initialWs = DEFAULT_WORKSPACES;
      if (savedWs) {
        const parsedWs = JSON.parse(savedWs);
        const cleanWs = Array.isArray(parsedWs) ? parsedWs.filter((w: any) => !dummyNames.includes(w.name)) : [];
        if (cleanWs.length > 0) {
          initialWs = cleanWs;
        }
      }
      setWorkspaces(initialWs);
      setActiveWorkspaceId(initialWs[0]?.id || 'ws_default');
      localStorage.setItem(workspaceStorageKey, JSON.stringify(initialWs));

      const savedSess = localStorage.getItem(sessionStorageKey);
      const lastSessionId = localStorage.getItem(lastSessionStorageKey);
      let targetSessionId = activeSessionId;

      if (savedSess) {
        const parsedSess = JSON.parse(savedSess);
        if (Array.isArray(parsedSess) && parsedSess.length > 0) {
          setSessions(parsedSess);
          const matched = lastSessionId && parsedSess.find((s: any) => s.id === lastSessionId);
          targetSessionId = matched ? matched.id : parsedSess[0].id;
        }
      }

      setActiveSessionId(targetSessionId);

      // ALWAYS restore messages on initial mount so refreshing/backgrounding never wipes the screen
      const savedMsgs = localStorage.getItem(`nobo_msg_${targetSessionId}`);
      if (savedMsgs) {
        try {
          const parsed = JSON.parse(savedMsgs);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessagesRef.current(parsed);
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Request browser notification permission so push alerts pop up smoothly
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []); // Run strictly once on mount to avoid infinite render loops

  // Persist messages so switching tabs or closing app does not lose history
  // Debounced and skipped during live streaming to prevent blocking main thread
  useEffect(() => {
    if (!messages || messages.length === 0 || !activeSessionId) return;
    if (isLoading) return; // Do not synchronously serialize large JSON arrays during active streaming!

    const timer = setTimeout(() => {
      try {
        localStorage.setItem(`nobo_msg_${activeSessionId}`, JSON.stringify(messages));
        localStorage.setItem(lastSessionStorageKey, activeSessionId);
      } catch (e) {}
    }, 400);

    return () => clearTimeout(timer);
  }, [messages, activeSessionId, lastSessionStorageKey, isLoading]);

  // Switch session chat messages when activeSessionId changes
  const currentSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentSessionIdRef.current === null) {
      currentSessionIdRef.current = activeSessionId;
      return;
    }
    if (currentSessionIdRef.current !== activeSessionId) {
      currentSessionIdRef.current = activeSessionId;
      try {
        localStorage.setItem(lastSessionStorageKey, activeSessionId);
        const saved = localStorage.getItem(`nobo_msg_${activeSessionId}`);
        if (saved) {
          setMessagesRef.current(JSON.parse(saved));
        } else {
          setMessagesRef.current([]);
        }
      } catch (e) {
        setMessagesRef.current([]);
      }
    }
  }, [activeSessionId, lastSessionStorageKey]);

  // Auto-recover messages if tab was backgrounded or Chrome reconnected
  useEffect(() => {
    const handleVisibility = () => {
      if (isLoading) return; // Never overwrite while stream is actively receiving chunks
      if (document.visibilityState === 'visible' && activeSessionId) {
        try {
          const saved = localStorage.getItem(`nobo_msg_${activeSessionId}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setMessagesRef.current(parsed);
            }
          }
        } catch (e) {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeSessionId, isLoading]);

  // Live timer while agent is executing
  useEffect(() => {
    if (!isLoading) {
      return;
    }
    const timer = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isLoading]);

  // Smart Auto-Scroll: Detect user scroll up and don't hijack!
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 60;
    isAutoScrollEnabled.current = atBottom;
    setShowScrollBottomBtn((prev) => (prev !== !atBottom ? !atBottom : prev));
  }, []);

  useEffect(() => {
    if (isAutoScrollEnabled.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isLoading]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
      isAutoScrollEnabled.current = true;
      setShowScrollBottomBtn(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isSpreadsheet = file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.tsv');
    const isImage = file.type.startsWith('image/') || Boolean(file.name.match(/\.(png|jpe?g|webp|gif|svg)$/i));
    const isVideo = file.type.startsWith('video/') || Boolean(file.name.match(/\.(mp4|mov|webm|mkv|avi)$/i));
    const fileType = isVideo ? 'video' : isImage ? 'image' : isSpreadsheet ? 'spreadsheet' : 'file';

    // If small text/csv file (< 300KB), read directly as text preview
    if ((isSpreadsheet || file.type.startsWith('text/')) && file.size < 300_000) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setAttachedFile({
          name: file.name,
          content,
          type: fileType,
          size: file.size,
        });
        toast.success(`Attached ${file.name}`);
      };
      reader.readAsText(file);
      if (e.target) e.target.value = '';
      return;
    }

    // For videos, images, and binary media: stream upload directly to Cloudflare R2
    setIsUploading(true);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const toastId = toast.loading(`Uploading ${file.name} (${sizeMb} MB)...`);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'agent_uploads');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Upload failed');
      }

      setAttachedFile({
        name: file.name,
        url: data.url,
        type: fileType,
        size: file.size,
      });
      toast.success(`Attached ${file.name}`, { id: toastId });
    } catch (err: any) {
      toast.error(`Upload error: ${err.message}`, { id: toastId });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  // Register session immediately on prompt
  const ensureSessionRegistered = (promptText: string) => {
    const existing = sessions.find((s) => s.id === activeSessionId);
    if (!existing) {
      const title = promptText.length > 32 ? promptText.slice(0, 32) + '...' : promptText;
      const newSession: ChatSession = {
        id: activeSessionId,
        title,
        workspaceId: activeWorkspaceId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const updated = [newSession, ...sessions];
      setSessions(updated);
      try {
        localStorage.setItem(sessionStorageKey, JSON.stringify(updated));
      } catch (e) {}
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if ((!textToSend.trim() && !attachedFile) || isUploading) return;

    let fullPrompt = textToSend;
    if (attachedFile) {
      if (attachedFile.url) {
        fullPrompt = `[Attached File: ${attachedFile.name} (${attachedFile.type})]\nURL: ${attachedFile.url}\n\nInstruction: ${textToSend || 'Please inspect this reference video/file and help me create content based on it.'}`;
      } else if (attachedFile.content) {
        fullPrompt = `[Attached File: ${attachedFile.name} (${attachedFile.type})]\nContent preview:\n${attachedFile.content.slice(0, 2000)}\n\nInstruction: ${textToSend || 'Please inspect this file and help me process it.'}`;
      }
      setAttachedFile(null);
    }

    // A turn is already running: queue this instead of dropping it, and send it
    // automatically when the current one ends.
    if (isLoading) {
      queueRef.current.push(fullPrompt);
      setQueuedCount(queueRef.current.length);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    ensureSessionRegistered(textToSend);
    setSecondsElapsed(0);
    isAutoScrollEnabled.current = true;

    // ── durable log ──────────────────────────────────────────────────────
    // Ensure a real session exists BEFORE the request so the turn has somewhere
    // to land, then pass its id explicitly: React state will not have flushed
    // by the time we call sendMessage in this same tick.
    let sid = logSessionId;
    if (harness.available === true && !sid) {
      sid = await harness.createSession({ workspaceId: activeWorkspaceId });
      if (sid) {
        setActiveSessionId(sid);
        setLogSessionId(sid);
      }
    }

    // NOTE: no appendUserMessage here in the durable path.
    //
    // POST /api/agent/v2/runs appends `user.message` itself, so writing it here
    // too produced two identical bubbles in the transcript. The append below is
    // only for the streaming fallback, where no run is created.

    // Immediately save user prompt to localStorage so tab reload or backgrounding NEVER loses the session
    try {
      localStorage.setItem(lastSessionStorageKey, activeSessionId);
      const userMsg = {
        id: 'msg_u_' + Date.now(),
        role: 'user',
        content: fullPrompt,
        parts: [{ type: 'text', text: fullPrompt }],
        createdAt: new Date(),
      };
      const existing = Array.isArray(messages) ? messages : [];
      localStorage.setItem(`nobo_msg_${activeSessionId}`, JSON.stringify([...existing, userMsg]));
    } catch (e) {}

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // ── Durable by default ───────────────────────────────────────────────
    // Every message becomes a queued run, so nothing depends on a single HTTP
    // request surviving: the run is checkpointed, retried and continued by the
    // worker whether this tab stays open, sleeps, or the request is killed.
    // The transcript below streams from the event log over Realtime, so the
    // user still watches thinking blocks and tool rows land as they happen.
    if (harness.available === true && sid) {
      const run = await harness.startRun(fullPrompt);
      if (run) {
        toast.success('Running in the background — safe to close this tab.');
        return;
      }
      // Do NOT fall through to a live turn here. The usual reason the queue refuses is
      // that a run is already working on this chat (a reload, a second tab, or another
      // device), and a fallback would start a SECOND run against the same event log —
      // interleaving the transcript, which is the failure this guard exists to prevent.
      // Queue it instead: the message is kept and delivered when the current run ends.
      queueRef.current.push(fullPrompt);
      setQueuedCount(queueRef.current.length);
      setInput('');
      toast.info('A run is already working on this chat — queued as a follow-up.');
      return;
    }

    // Fallback only when the durable queue is unavailable.
    if (harness.available === true && sid) {
      void harness.appendUserMessage(
        fullPrompt,
        attachedFile
          ? [{ name: attachedFile.name, url: attachedFile.url, type: attachedFile.type, size: attachedFile.size }]
          : undefined,
        sid
      );
    }
    await sendMessage({ text: fullPrompt }, sid ? { body: { sessionId: sid } } : undefined);
  };

  /**
   * Open a session. With the log available this loads the projection, which is
   * the same view a reload or another device would see.
   */
  /**
   * Queue the current prompt as a durable background run.
   *
   * Nothing streams here: a worker picks the run up, advances it in bounded
   * slices, and appends each step to the log. The transcript updates because it
   * is a projection of that log — so the tab can be closed and the work carries
   * on. This is how a task gets to run for hours.
   */
  const handleStartRun = async () => {
    if ((!input.trim() && !attachedFile) || isUploading) return;

    const textToSend = input;
    let fullPrompt = textToSend;
    if (attachedFile) {
      if (attachedFile.url) {
        fullPrompt = `[Attached File: ${attachedFile.name} (${attachedFile.type})]\nURL: ${attachedFile.url}\n\nInstruction: ${
          textToSend || 'Please inspect this reference and act on it.'
        }`;
      } else if (attachedFile.content) {
        fullPrompt = `[Attached File: ${attachedFile.name} (${attachedFile.type})]\nContent preview:\n${attachedFile.content.slice(
          0,
          2000
        )}\n\nInstruction: ${textToSend || 'Please inspect this file and act on it.'}`;
      }
      setAttachedFile(null);
    }

    let sid = logSessionId;
    if (harness.available === true && !sid) {
      sid = await harness.createSession({ workspaceId: activeWorkspaceId });
      if (sid) {
        setActiveSessionId(sid);
        setLogSessionId(sid);
      }
    }

    if (!sid) {
      toast.error('Background runs need the session log — is the database migrated?');
      return;
    }

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const run = await harness.startRun(fullPrompt);
    if (run) {
      toast.success('Queued as a background run — you can close the tab.');
    }
  };

  const handleOpenSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setSecondsElapsed(0);
    isAutoScrollEnabled.current = true;

    if (harness.available === true) {
      setLogSessionId(sessionId);
      const nextState = await harness.openSession(sessionId);
      // Rebuild the model context from the log, otherwise the next follow-up
      // would be asked in isolation with no history.
      setMessages(nextState ? itemsToUIMessages(nextState.items) : []);
      return;
    }

    setLogSessionId(null);
    try {
      const saved = localStorage.getItem(`nobo_msg_${sessionId}`);
      setMessages(saved ? JSON.parse(saved) : []);
    } catch {
      setMessages([]);
    }
  };

  const handleNewSession = async (targetWsId?: string) => {
    const wsId = targetWsId || activeWorkspaceId;
    setActiveWorkspaceId(wsId);
    setMessages([]);
    setSecondsElapsed(0);
    isAutoScrollEnabled.current = true;

    if (harness.available === true) {
      const serverId = await harness.createSession({ workspaceId: wsId });
      if (serverId) {
        setActiveSessionId(serverId);
        setLogSessionId(serverId);
        toast.success('Started a fresh session');
        return;
      }
      // Store reachable but creation failed — fall through to a local session
      // rather than trapping the user with no way to type.
    }

    const newId = 'session_' + Date.now();
    setActiveSessionId(newId);
    setLogSessionId(null);
    try {
      localStorage.setItem(lastSessionStorageKey, newId);
    } catch (e) {}
    toast.success('Started a fresh session');
  };

  const handleCreateWorkspace = async () => {
    const trimmed = newWorkspaceName.trim();
    if (!trimmed) return;
    setNewWorkspaceName('');
    setShowNewWorkspaceModal(false);

    if (harness.available === true) {
      await harness.createWorkspace(trimmed);
      toast.success(`Workspace "${trimmed}" created`);
      return;
    }

    const newWs: WorkspaceFolder = {
      id: 'ws_' + Date.now(),
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    const updated = [...workspaces, newWs];
    setWorkspaces(updated);
    setActiveWorkspaceId(newWs.id);
    try {
      localStorage.setItem(workspaceStorageKey, JSON.stringify(updated));
    } catch (e) {}
    toast.success(`Workspace "${trimmed}" created`);
  };

  const handleDeleteWorkspace = (wsId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Two-step confirm: deletion takes sessions with it and cannot be undone.
    if (pendingDelete !== wsId) {
      setPendingDelete(wsId);
      setTimeout(() => setPendingDelete((p) => (p === wsId ? null : p)), 5000);
      return;
    }
    setPendingDelete(null);
    const target = workspaces.find((w) => w.id === wsId);
    let updated = workspaces.filter((w) => w.id !== wsId);
    if (updated.length === 0) {
      updated = [{ id: 'ws_default', name: 'General', createdAt: new Date().toISOString() }];
    }
    setWorkspaces(updated);
    try {
      localStorage.setItem(workspaceStorageKey, JSON.stringify(updated));
    } catch (e) {}

    // Clean up sessions under this workspace
    const remainingSessions = sessions.filter((s) => s.workspaceId !== wsId);
    setSessions(remainingSessions);
    try {
      localStorage.setItem(sessionStorageKey, JSON.stringify(remainingSessions));
    } catch (e) {}

    if (activeWorkspaceId === wsId) {
      const nextWs = updated[0];
      setActiveWorkspaceId(nextWs.id);
      const nextSession = remainingSessions.find((s) => s.workspaceId === nextWs.id);
      if (nextSession) {
        setActiveSessionId(nextSession.id);
      } else {
        handleNewSession(nextWs.id);
      }
    }
    toast.success(`Deleted workspace "${target?.name || ''}"`);
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Two-step confirm so a stray click cannot wipe a conversation.
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setTimeout(() => setPendingDelete((p) => (p === id ? null : p)), 5000);
      return;
    }
    setPendingDelete(null);

    if (harness.available === true) {
      await harness.removeSession(id);
      // Clear the local mirror too. `allSessions` is merged from the harness list
      // AND this component's own list, so without this the row stayed on screen
      // after a successful delete and looked like the button did nothing.
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (harness.error) {
        toast.error(harness.error || 'Could not delete that chat');
        return;
      }
      toast.success('Chat deleted');
      if (logSessionId === id) {
        setLogSessionId(null);
        setMessages([]);
        await handleNewSession();
      }
      return;
    }

    const updated = sessions.filter((s) => s.id !== id);
    setSessions(updated);
    try {
      localStorage.setItem(sessionStorageKey, JSON.stringify(updated));
    } catch (e) {}
    if (activeSessionId === id) {
      void handleNewSession();
    }
  };

  const handleCopyMessage = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // The event log is authoritative for the session tree once it is available.
  // The localStorage lists survive only as the pre-migration fallback.
  const allSessions: ChatSession[] = useMemo(() => {
    if (harness.available !== true) return sessions;
    return harness.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      workspaceId: s.workspaceId,
      createdAt: s.updatedAt,
      updatedAt: s.updatedAt,
    }));
  }, [harness.available, harness.sessions, sessions]);

  const allWorkspaces: WorkspaceFolder[] = useMemo(() => {
    if (harness.available !== true) return workspaces;
    if (!harness.workspaces.length) return DEFAULT_WORKSPACES;
    return harness.workspaces.map((w) => ({ id: w.id, name: w.name, createdAt: '' }));
  }, [harness.available, harness.workspaces, workspaces]);

  const visibleSessions = useMemo(() => {
    return allSessions.filter((s) => {
      const matchesWs = s.workspaceId === activeWorkspaceId;
      if (searchQuery.trim()) {
        return s.title.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return matchesWs;
    });
  }, [allSessions, activeWorkspaceId, searchQuery]);

  const activeSessionObj = allSessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' }}>
      {/* Mobile scrim: on a phone the sidebar floats over the chat, so tapping
          outside it must close it. Hidden from md upwards where it is docked. */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: 'rgba(15, 23, 42, 0.32)' }}
        />
      )}

      {/* 1. DeepSeek Harness Left Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
        style={{
          background: 'var(--dsw-alias-bg-layer-1)',
          // A firmer divider than the hairline used inside panels: this is the
          // one structural seam in the layout, so the rail reads as its own
          // surface instead of blending into the conversation.
          borderRight: '1px solid var(--dsw-alias-border-l2)',
          boxShadow: '1px 0 0 0 rgba(15, 23, 42, 0.03)',
        }}
      >
        {/* Brand & New Session Button */}
        <div className="p-3" style={{ borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>
          <div className="flex items-center justify-between px-1 mb-3">
            <div className="flex items-center gap-2">
              <div
                className="relative flex items-center justify-center w-6 h-6"
                style={{
                  borderRadius: 'var(--dsh-radius-sm)',
                  background: 'var(--dsw-alias-bg-layer-3)',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  color: 'var(--dsw-alias-label-secondary)',
                }}
              >
                <Bot size={14} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="dsh-t-s dsh-strong dsh-label-primary tracking-tight">
                  Nobogent
                </span>
                <span
                  className="dsh-t-xxxs dsh-mono px-1.5 py-[1px] uppercase"
                  style={{
                    borderRadius: 'var(--dsh-radius-xs)',
                    background: 'var(--dsw-alias-bg-layer-3)',
                    color: 'var(--dsw-alias-label-tertiary)',
                    letterSpacing: '0.04em',
                  }}
                >
                  Harness
                </span>
              </div>
            </div>

            <button
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              aria-label="Hide sidebar"
              className="p-1 hover:opacity-70 transition"
              style={{ color: 'var(--dsw-alias-label-tertiary)', borderRadius: 'var(--dsh-radius-sm)' }}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          <button
            onClick={() => handleNewSession()}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 transition dsh-t-s dsh-strong"
            style={{
              borderRadius: 'var(--dsh-radius-sm)',
              background: 'var(--dsw-alias-button-primary-fill)',
              color: 'var(--dsw-alias-button-primary-text)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dsw-alias-button-primary-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--dsw-alias-button-primary-fill)')}
          >
            <Plus size={15} />
            <span>New session</span>
          </button>
        </div>

        {/* Workspaces Section */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span
              className="dsh-t-xxs dsh-strong uppercase"
              style={{ color: 'var(--dsw-alias-label-caption)', letterSpacing: '0.05em' }}
            >
              Workspaces
            </span>
            <div className="flex items-center gap-2" style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
              <Search size={13} className="cursor-pointer" />
              <button
                onClick={() => setShowNewWorkspaceModal(true)}
                className="dsh-interactive"
                title="New workspace folder"
              >
                <FolderPlus size={13} />
              </button>
            </div>
          </div>

          {/* Folder & Nested Sessions List */}
          <div className="space-y-2">
            {allWorkspaces.map((ws) => {
              const isWsActive = ws.id === activeWorkspaceId;
              const wsSessions = allSessions.filter((s) => {
                if (s.workspaceId !== ws.id) return false;
                if (searchQuery.trim()) {
                  return s.title.toLowerCase().includes(searchQuery.toLowerCase());
                }
                return true;
              });

              return (
                <div key={ws.id} className="space-y-1">
                  {/* Workspace Folder Header */}
                  <div
                    onClick={() => {
                      setActiveWorkspaceId(ws.id);
                      toggleWorkspaceCollapsed(ws.id);
                    }}
                    title={collapsedWorkspaces.has(ws.id) ? 'Expand folder' : 'Collapse folder'}
                    className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs cursor-pointer transition select-none ${
                      isWsActive
                        ? 'dsh-selected dsh-border-l2 dsh-label-primary dsh-strong'
                        : 'dsh-label-tertiary dsh-interactive border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                      {collapsedWorkspaces.has(ws.id) ? (
                        <ChevronRight size={13} className="shrink-0 dsh-label-caption" />
                      ) : (
                        <ChevronDown size={13} className="shrink-0 dsh-label-caption" />
                      )}
                      <FolderOpen size={14} className={isWsActive ? 'dsh-accent shrink-0' : 'shrink-0 dsh-label-caption'} />
                      <span className="truncate font-medium">{ws.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {wsSessions.length > 0 && (
                        <span className="dsh-t-xxxs dsh-mono dsh-chip px-1.5 py-0.5 rounded">
                          {wsSessions.length}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNewSession(ws.id);
                        }}
                        className="p-1 rounded dsh-label-caption dsh-interactive"
                        title="New chat in this workspace"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteWorkspace(ws.id, e)}
                        className={`p-1 rounded-md dsh-label-caption dsh-interactive-danger transition-all duration-100 ease-out active:scale-90 hover:scale-110 ${pendingDelete === ws.id ? 'dsh-strong scale-110 ring-1 ring-current' : ''}`}
                        title={pendingDelete === ws.id ? 'Click again to delete' : 'Delete workspace folder'}
                      >
                        {pendingDelete === ws.id ? <Check size={13} /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>

                  {/* Indented Sessions inside this folder */}
                  {wsSessions.length > 0 && !collapsedWorkspaces.has(ws.id) && (
                    <div className="pl-3.5 space-y-0.5 dsh-tree-rail ml-3 py-0.5">
                      {wsSessions.map((sess) => {
                        const isSelected = sess.id === activeSessionId;
                        return (
                          <div
                            key={sess.id}
                            onClick={() => {
                              setActiveWorkspaceId(ws.id);
                              void handleOpenSession(sess.id);
                            }}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer transition group/sess ${
                              isSelected
                                ? 'dsh-selected dsh-label-primary dsh-strong dsh-border-l2'
                                : 'dsh-label-tertiary dsh-interactive'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                              <MessageSquare
                                size={12}
                                className={isSelected ? 'dsh-accent shrink-0' : 'shrink-0 dsh-label-caption'}
                              />
                              <span className="truncate">{sess.title}</span>
                            </div>

                            <div className="flex items-center gap-1.5 dsh-label-caption dsh-t-xxxs dsh-mono shrink-0 ml-1">
                              <span>{formatTimeAgo(sess.createdAt)}</span>
                              <button
                                onClick={(e) => handleDeleteSession(sess.id, e)}
                                className={`p-1 rounded-md dsh-label-caption dsh-interactive-danger transition-all duration-100 ease-out active:scale-90 active:brightness-125 ${pendingDelete === sess.id ? 'dsh-strong scale-110 ring-1 ring-current' : 'hover:scale-110'}`}
                                title={pendingDelete === sess.id ? 'Click again to delete' : 'Delete chat session'}
                              >
                                {pendingDelete === sess.id ? (
                                  <Check size={12} />
                                ) : (
                                  <Trash2 size={12} />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar Bottom Controls */}
        <div className="p-3 dsh-border-t space-y-1.5 dsh-t-xs dsh-label-tertiary">
          <button
            onClick={() => setShowFileManager(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] dsh-interactive"
          >
            <FolderOpen size={15} className="dsh-warn" />
            <span>File & Asset Manager</span>
          </button>

          <a
            href="/dashboard"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] dsh-label-tertiary dsh-interactive"
          >
            <PanelLeftClose size={15} />
            <span>Exit to Dashboard</span>
          </a>
        </div>
      </div>

      {/* 2. Main Chat Canvas */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header Bar */}
        <div
          className="h-12 flex items-center justify-between px-4 shrink-0"
          style={{
            // Chrome sits one step above the content surface so the header reads
            // as a distinct band rather than part of the transcript.
            borderBottom: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
          }}
        >
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1 rounded-[8px] dsh-label-tertiary dsh-interactive"
              >
                <PanelLeftOpen size={16} />
              </button>
            )}

            {/* Escape hatch. The harness fills the viewport and hides the
                dashboard chrome, so without this there is no way back to the
                rest of the app. */}
            <a
              href="/dashboard"
              className="flex items-center gap-1.5 px-2 py-1 rounded-[8px] dsh-t-xs dsh-label-secondary dsh-interactive shrink-0"
              title="Back to dashboard"
            >
              <ArrowLeft size={14} />
              <span className="hidden sm:inline">Dashboard</span>
            </a>

            <button
              type="button"
              onClick={toggleTheme}
              className="px-2 py-1 rounded-[8px] dsh-t-xs dsh-label-secondary dsh-interactive shrink-0"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>

            <div className="flex items-center gap-2 max-w-md truncate text-xs">
              <span className="font-bold dsh-label-primary truncate">
                {activeSessionObj?.title || 'New Session'}
              </span>
              <span className="dsh-label-caption dsh-mono hidden sm:inline">
                • Autonomous Operator
              </span>
              <span className="dsh-success dsh-mono dsh-t-xxxs hidden md:inline flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full dsh-success-bg animate-pulse inline-block" />
                Live
              </span>
            </div>
          </div>

          {/* Chat | Trajectory — toggles the third column */}
          <div
            className="flex items-center gap-1 p-0.5 dsh-t-xs dsh-strong"
            style={{
              background: 'var(--dsw-alias-bg-layer-2)',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 'var(--dsh-radius-sm)',
            }}
          >
            <button
              onClick={() => {
                setActiveTab('chat');
                setShowDetails(false);
              }}
              className="px-3 py-1 transition"
              style={{
                borderRadius: 'var(--dsh-radius-xs)',
                background: activeTab === 'chat' ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
                color:
                  activeTab === 'chat'
                    ? 'var(--dsw-alias-label-primary)'
                    : 'var(--dsw-alias-label-tertiary)',
              }}
            >
              Chat
            </button>
            <button
              onClick={() => {
                setActiveTab('trajectory');
                setShowDetails(true);
              }}
              className="px-3 py-1 transition"
              style={{
                borderRadius: 'var(--dsh-radius-xs)',
                background: activeTab === 'trajectory' ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
                color:
                  activeTab === 'trajectory'
                    ? 'var(--dsw-alias-label-primary)'
                    : 'var(--dsw-alias-label-tertiary)',
              }}
            >
              Trajectory
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLogsDrawer(!showLogsDrawer)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] dsh-t-xs dsh-mono dsh-btn"
            >
              <span>Session log</span>
              <Download size={12} />
            </button>
          </div>
        </div>

        {/* Chronological Event Feed */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-5 dsh-t-prose"
        >
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && !(logEnabled && (projected?.items.length ?? 0) > 0) ? (
              <div className="py-20 flex flex-col items-center justify-center text-center font-sans">
                <div className="w-12 h-12 rounded-[16px] dsh-surface-2 dsh-label-tertiary flex items-center justify-center mb-4">
                  <Bot size={26} />
                </div>
                <h3 className="dsh-t-xl dsh-label-primary mb-2">Nobogent Harness</h3>
                <p className="dsh-t-s dsh-label-tertiary max-w-sm mb-6">
                  Autonomous sandbox operator for code-based video compilation, motion graphics, and workflows.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left max-w-lg">
                  <button
                    onClick={() => handleSend('i want you to make a video for wishing happy diwali to our clients on behalf of nobogent, 15 sec would be enough make it in 9:16')}
                    className="p-3 rounded-[12px] dsh-surface-2 dsh-border dsh-interactive text-left"
                  >
                    <p className="dsh-t-s dsh-strong dsh-label-primary">Happy Diwali Video (9:16)</p>
                    <p className="dsh-t-xs dsh-label-tertiary mt-0.5">Render 15s vertical motion graphics greeting</p>
                  </button>
                  <button
                    onClick={() => handleSend('Use Meta Ads MCP to inspect active campaigns and launch a high-intent lead generation campaign on Instagram Reels with ₹1,500/day budget.')}
                    className="p-3 rounded-[12px] dsh-surface-2 dsh-border dsh-interactive text-left"
                  >
                    <p className="dsh-t-s dsh-strong dsh-label-primary">Launch Meta Campaign</p>
                    <p className="dsh-t-xs dsh-label-tertiary mt-0.5">Targeted leadgen on Instagram Reels</p>
                  </button>
                </div>
              </div>
            ) : logEnabled ? (
              // Log-backed session: the committed transcript is a projection of
              // the event log, and only the in-flight turn comes from the live
              // stream. On finish the projection is reloaded and replaces it.
              <>
                <HarnessTranscript items={projected?.items ?? []} onOptionSelect={handleSend} />
                {/* Opening a session fetches the projection; without this the
                    pane sat blank for a beat and looked broken. */}
                {(projected?.items?.length ?? 0) === 0 && harness.loading && (
                  <div className="space-y-3 pt-4 animate-pulse" aria-label="Loading conversation">
                    {[72, 88, 54].map((w, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <div
                          className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: 'var(--dsw-alias-border-l2)' }}
                        />
                        <div
                          className="h-3 rounded-full"
                          style={{ width: `${w}%`, background: 'var(--dsw-alias-bg-layer-3)' }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {isLoading &&
                  messages.length > 0 &&
                  messages[messages.length - 1]?.role === 'assistant' && (
                    // Only ever render the live ASSISTANT message here. The
                    // committed projection already contains the user's message,
                    // so rendering the live user message too made it appear
                    // twice until the projection caught up.
                    <SafeMessageRenderer
                      m={messages[messages.length - 1]}
                      mIdx={messages.length - 1}
                      messages={messages}
                      isLoading={isLoading}
                      handleSend={handleSend}
                      handleCopyMessage={handleCopyMessage}
                      copiedIndex={copiedIndex}
                      reload={reload}
                    />
                  )}
              </>
            ) : (
              messages.map((m: any, mIdx: number) => (
                <SafeMessageRenderer
                  key={m?.id || mIdx}
                  m={m}
                  mIdx={mIdx}
                  messages={messages}
                  isLoading={isLoading}
                  handleSend={handleSend}
                  handleCopyMessage={handleCopyMessage}
                  copiedIndex={copiedIndex}
                  reload={reload}
                />
              ))
            )}

            {/* Live status strip. The previous indicator was one small line that
                scrolled out of view, so a background run looked like nothing was
                happening at all. This stays pinned under the transcript with the
                elapsed time, what is going on, and a Stop control. */}
            {isLoading && (
              <div
                className="sticky bottom-0 mt-3 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 dsh-t-s"
                style={{
                  background: 'var(--dsw-alias-bg-layer-2)',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  boxShadow: 'var(--dsw-shadow-lv1)',
                }}
                role="status"
                aria-live="polite"
              >
                <Loader2 size={14} className="animate-spin shrink-0" />
                <span className="dsh-strong" style={{ color: 'var(--dsw-alias-label-primary)' }}>
                  {harness.runInProgress ? 'Agent is working' : 'Working'}
                </span>
                <span className="dsh-tnum" style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
                  {secondsElapsed}s
                </span>
                <span className="hidden sm:inline" style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
                  · {harness.runInProgress ? 'background run — safe to close this tab' : 'step by step'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (harness.runInProgress) void harness.cancelRun();
                    else stop();
                  }}
                  className="ml-auto shrink-0 px-2 py-1 rounded-[6px] dsh-t-xs dsh-label-secondary dsh-interactive"
                >
                  Stop
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Floating Jump to Bottom Button */}
        {showScrollBottomBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-24 right-8 z-30 p-2 rounded-full dsh-btn-primary flex items-center gap-1 text-xs font-mono"
          >
            <ArrowDown size={14} />
            <span>Latest</span>
          </button>
        )}

        {/* 3. DeepSeek Signature Input Dock */}
        <div
          className="p-4 pb-4 shrink-0"
          style={{
            // A boundary line plus a gradient fade gives the dock its own zone.
            // Before this the transcript simply ran into the input and the whole
            // screen read as one undifferentiated mass.
            borderTop: '1px solid var(--dsw-alias-border-l1)',
            background:
              'linear-gradient(to top, var(--dsw-alias-bg-base) 72%, transparent)',
          }}
        >
          <div className="max-w-3xl mx-auto">
            {isUploading && (
              <div className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-[12px] dsh-chip dsh-accent dsh-t-xs animate-pulse">
                <Loader2 size={13} className="animate-spin dsh-accent" />
                <span>Uploading media directly to cloud storage...</span>
              </div>
            )}

            {attachedFile && !isUploading && (
              <div className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-[12px] dsh-chip dsh-t-xs">
                {attachedFile.type === 'video' ? <FileVideo size={14} /> : <ImageIcon size={14} />}
                <span className="truncate max-w-xs">{attachedFile.name}</span>
                {attachedFile.url && <span className="dsh-t-xxxs dsh-success dsh-mono">(Ready)</span>}
                <button onClick={() => setAttachedFile(null)} className="dsh-label-caption dsh-interactive-danger">
                  ×
                </button>
              </div>
            )}

            {/* Background-run status. The worker keeps going when this tab
                closes; this is just a window onto it. */}
            {harness.activeRun && (
              <div
                className="mb-2 flex items-center gap-2 px-3 py-1.5 dsh-chip dsh-t-xs"
                style={{ borderRadius: 'var(--dsh-radius-sm)' }}
              >
                {harness.runInProgress ? (
                  <Loader2 size={13} className="animate-spin dsh-accent shrink-0" />
                ) : harness.activeRun.status === 'failed' ? (
                  <AlertCircle size={13} className="dsh-danger shrink-0" />
                ) : (
                  <CheckCircle2 size={13} className="dsh-success shrink-0" />
                )}
                <span className="dsh-strong">
                  {harness.runInProgress
                    ? harness.activeRun.status === 'queued'
                      ? 'Queued for background execution'
                      : 'Running in background'
                    : `Background run ${harness.activeRun.status}`}
                </span>
                {harness.activeRun.continuations > 0 && (
                  <span className="dsh-t-xxxs dsh-label-caption dsh-tnum">
                    slice {harness.activeRun.continuations + 1}
                  </span>
                )}
                {harness.activeRun.error && (
                  <span className="dsh-t-xxxs dsh-danger truncate max-w-[16rem]">{harness.activeRun.error}</span>
                )}
                {harness.runInProgress && !harness.activeRun.cancelRequested && (
                  <button
                    onClick={() => void harness.cancelRun()}
                    className="dsh-t-xxxs dsh-label-tertiary dsh-interactive-danger px-1.5 py-0.5"
                    style={{ borderRadius: 'var(--dsh-radius-xs)' }}
                  >
                    Stop
                  </button>
                )}
                {harness.activeRun.cancelRequested && harness.runInProgress && (
                  <span className="dsh-t-xxxs dsh-warn">stopping after this step…</span>
                )}
              </div>
            )}

            {/* Rounded Dock Container */}
            <div
              className="p-3 transition"
              style={{
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid var(--dsw-alias-border-l2)',
                borderRadius: 'var(--dsh-radius-lg)',
                boxShadow: 'var(--dsw-shadow-lv2)',
              }}
            >
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
                  isLoading
                    ? 'Type a correction — it queues and sends when this run finishes'
                    : 'Describe the outcome you want — e.g. "Bhai Dooj image creative, then post it to Facebook"'
                }
                aria-label="Message the agent"
                rows={1}
                className="w-full resize-none bg-transparent outline-none dsh-t-base px-1 py-1 max-h-44"
                style={{ color: 'var(--dsw-alias-label-primary)' }}
              />

              <div className="flex items-center justify-between pt-2 mt-1 dsh-border-t">
                <div className="flex items-center gap-2 text-xs">
                  {/* File attach + */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="*/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 rounded-full dsh-label-tertiary dsh-interactive"
                    title="Attach file"
                  >
                    <Plus size={16} />
                  </button>

                  {/* Mode Pill */}
                  {/* Permission mode — a status chip, not a control. There is no
                      permission-preset system wired yet, so this must not look
                      clickable. */}
                  <span
                    className="flex items-center gap-1 px-2.5 py-1 dsh-t-xs dsh-mono"
                    style={{
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-tertiary)',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      borderRadius: 'var(--dsh-radius-full)',
                    }}
                  >
                    Full access
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Model badge — the agent always runs on the multimodal
                      flash model, so images attached to a message are seen
                      directly. Static label, not a control. */}
                  <span
                    className="flex items-center gap-1.5 dsh-t-xs dsh-mono"
                    style={{ color: 'var(--dsw-alias-label-tertiary)' }}
                    title="Vision-enabled agent model"
                  >
                    <span
                      className="inline-block rounded-full"
                      style={{ width: 5, height: 5, background: 'var(--dsw-alias-state-success-primary)' }}
                    />
                    <span>{displayNameFor(AGENT_MODEL)}</span>
                  </span>

                  {/* Background run — hands the turn to the worker so it can
                      keep going after this tab closes. */}
                  <button
                    type="button"
                    onClick={handleStartRun}
                    disabled={(!input.trim() && !attachedFile) || isUploading || harness.runInProgress}
                    className="w-7 h-7 rounded-full dsh-btn flex items-center justify-center disabled:opacity-40"
                    title="Run in the background (survives closing this tab)"
                  >
                    <Rocket size={12} />
                  </button>

                  {/* Send / Stop Button. While a turn runs, typing shows Send
                      again (the message queues) and an empty box shows Stop. */}
                  {isLoading && !input.trim() && !attachedFile ? (
                    <button
                      type="button"
                      onClick={() => {
                        // A durable run is cancelled via the run API; the stream
                        // controller only knows about live in-request turns.
                        if (harness.runInProgress) void harness.cancelRun();
                        else stop();
                      }}
                      className="w-7 h-7 rounded-full dsh-btn-primary flex items-center justify-center"
                      title="Stop"
                    >
                      <Square size={12} className="fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={(!input.trim() && !attachedFile) || isUploading}
                      className="w-7 h-7 rounded-full dsh-btn-primary flex items-center justify-center"
                      title={isLoading ? 'Queue message (sends when the current turn finishes)' : 'Send'}
                    >
                      <Send size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Status Metadata Bar */}
            <div className="mt-2 text-center dsh-t-xxxs dsh-mono dsh-label-caption truncate">
              {queuedCount > 0 ? (
                <span className="dsh-accent">
                  {queuedCount} message{queuedCount > 1 ? 's' : ''} queued — will send when this turn finishes
                </span>
              ) : (
                <>Nobogent Autonomous Operator • Standard mode • Full Access</>
              )}
            </div>
          </div>
        </div>
      </div>

      {showDetails && (
        <HarnessDetails
          title={projected?.title || activeSessionObj?.title || 'New session'}
          status={projected?.status || (isLoading ? 'running' : 'idle')}
          workspaceId={projected?.workspaceId || activeWorkspaceId}
          items={projected?.items ?? []}
          logBacked={logEnabled}
          onClose={() => setShowDetails(false)}
        />
      )}

      {/* Create Workspace Folder Modal */}
      {showNewWorkspaceModal && (
        <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm dsh-card rounded-[16px] p-5 space-y-4">
            <h4 className="dsh-t-s dsh-strong dsh-label-primary flex items-center gap-2">
              <FolderPlus size={16} className="dsh-accent" />
              Create Workspace Folder
            </h4>
            <input
              type="text"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="e.g. Diwali Campaigns, Mohali Reels..."
              className="w-full px-3 py-2 rounded-[12px] dsh-surface-2 dsh-border dsh-t-s outline-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateWorkspace();
              }}
            />
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                onClick={() => setShowNewWorkspaceModal(false)}
                className="px-3 py-1.5 rounded-[10px] dsh-strong dsh-label-tertiary dsh-interactive"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkspace}
                className="px-3 py-1.5 rounded-[10px] dsh-btn-primary dsh-strong"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File & Asset Manager Drawer */}
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
