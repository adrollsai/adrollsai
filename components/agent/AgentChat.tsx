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
  BookOpen,
  Mic,
  Crown,
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
import CreatePanel from './CreatePanel';
import ProgressTrackerCard from './ProgressTrackerCard';
import FileManagerDrawer from './FileManagerDrawer';
import SkillsDrawer from './SkillsDrawer';
import DictateButton from './DictateButton';
import AgentMarkdown from './AgentMarkdown';
import AgentWelcome from './AgentWelcome';
import QuestionPanel, { normalizeQuestions, type QuestionPayload } from './QuestionPanel';
import { NoboOrb } from './NoboMascot';
import { ThinkFeedRow, ToolFeedRow } from './FeedRows';
import HarnessTranscript from './HarnessTranscript';
import HarnessDetails from './HarnessDetails';
import { useHarnessSession } from '@/lib/agent/harness/useHarnessSession';
import { useRunStream, stripPersistedPrefix, logStreamMetrics } from '@/lib/agent/harness/useRunStream';
import { itemsToUIMessages, type HarnessState } from '@/lib/agent/harness/projection';
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

/**
 * The CEO thread's folder.
 *
 * It has to exist in the workspace list, not just be assigned. Code that selected it used
 * an id nothing else knew about, so the rail highlighted nothing and the first-workspace
 * effect on mount overwrote the choice — which is exactly what "the CEO tab doesn't
 * activate" looked like from the outside.
 */
const CEO_WORKSPACE_ID = 'ws_ceo';

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
  // The working — reasoning rows and tool rows — starts collapsed. A long agent turn is mostly
  // feed, and scrolling past it to find your own last message is the worst part of the thread.
  // The reply itself never hides; only the working does. A turn still in flight stays open so
  // you can watch it happen.
  const [feedOpen, setFeedOpen] = useState(false);
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
              className="nobo-bubble-user rounded-[16px] px-4 py-2.5 dsh-t-prose break-words space-y-1.5"
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
              className="mt-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 dsh-label-caption dsh-interactive flex items-center justify-center"
              title="Copy"
              aria-label="Copy this message"
            >
              {copiedIndex === mIdx ? <Check size={14} className="dsh-success" /> : <Copy size={14} />}
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

    const isLiveTurn = Boolean(isLoading) && mIdx === messages.length - 1;
    const feedItemCount = parts.filter((p: any) => {
      const t = typeof p?.type === 'string' ? p.type : '';
      return t === 'reasoning' || t === 'thinking' || t === 'tool-call' || t === 'tool-invocation' || t.startsWith('tool-');
    }).length;
    const hasFeed = feedItemCount > 0 || Boolean(fallbackReasoning);
    const feedVisible = feedOpen || isLiveTurn;

    return (
      <div key={m.id || mIdx} className="space-y-1 my-3">
        {hasFeed && !isLiveTurn && (
          <button
            type="button"
            onClick={() => setFeedOpen((v) => !v)}
            aria-expanded={feedOpen}
            title={feedOpen ? 'Hide the working' : 'Show the working behind this reply'}
            className="dsh-interactive dsh-label-caption dsh-t-xs flex items-center gap-1.5 py-1"
          >
            {feedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>
              {feedOpen
                ? 'Hide working'
                : `${feedItemCount || 1} step${(feedItemCount || 1) === 1 ? '' : 's'} of working`}
            </span>
          </button>
        )}

        {feedVisible && fallbackReasoning && <ThinkFeedRow text={fallbackReasoning} />}

        {feedVisible && parts.map((part: any, pIdx: number) => {
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
                  onResume={handleSend}
                />
              );
            }
          } catch (e) {}
          return null;
        })}

        {finalTexts && (
          <div className="flex items-start gap-2.5 pt-2">
            {/* The mascot doubles as the assistant avatar, so a reply is visibly
                Nobo's and reads as a conversation rather than a wall of tool logs. */}
            <div className="pt-0.5">
              <NoboOrb size="sm" state={isLoading && mIdx === messages.length - 1 ? 'talking' : 'idle'} />
            </div>
            <div className="nobo-bubble-agent min-w-0 flex-1 dsh-t-prose dsh-label-primary">
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
  /**
   * True once the user has picked a thread themselves (a session, the CEO thread, or a
   * deep link). The mount effect below restores "the last session" on every load; without
   * this flag it also overwrites a choice the user just made by hand, which is what made
   * clicking CEO look like a dead button.
   */
  const userChoseThreadRef = React.useRef(false);
  // The permanent CEO thread. Created server-side on first load and refusal-protected
  // there too, so this is a view of something the user cannot accidentally destroy.
  const [ceoSessionId, setCeoSessionId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * A "New session" that has been started but has not answered yet.
   *
   * Creating a session is a POST plus a projection fetch. A message typed during
   * that window used to create a SECOND session beside it — an empty tile left
   * behind, and the reply in a thread nobody was looking at.
   */
  const sessionCreationRef = useRef<Promise<string | null> | null>(null);

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

  // ── the live turn stream ────────────────────────────────────────────────
  //
  // The reply now arrives over SSE straight from the model
  // (`/api/agent/v2/runs/stream`), not through the event log. Realtime stays
  // connected purely as the reconnect path: if this stream drops, the
  // projection — a fold of the log, which the runner still writes once per
  // step — catches the transcript up and the durable run finishes the work.
  const runStream = useRunStream();
  const liveTurn = runStream.message;
  const sendRunStream = runStream.send;
  const stopRunStream = runStream.stop;
  const resetRunStream = runStream.reset;

  // A durable run counts as "busy" exactly like a streaming turn, so the
  // composer, spinner and live indicator all behave the same either way.
  const isLoading =
    status === 'submitted' ||
    status === 'streaming' ||
    runStream.streaming ||
    harness.runInProgress === true;

  /**
   * Show the user's own message the instant they send it.
   *
   * The server appends `user.message` using the id we hand it, so the fold of
   * the log produces exactly this item — the optimistic row is not a guess, it
   * is the same row arriving early, and Realtime confirming it is a no-op.
   * Without it a brand-new session shows the reply typing into an empty pane,
   * because nothing has come back over Realtime yet.
   */
  const appendOptimisticUser = useCallback(
    (sessionId: string, id: string, text: string, attachment: any) => {
      harness.setProjectedState((prev) => {
        const base: HarnessState =
          prev && prev.sessionId === sessionId
            ? prev
            : ({
                sessionId,
                title: 'New session',
                workspaceId: activeWorkspaceId,
                status: 'idle',
                items: [],
                toolIndex: {},
                seenIds: {},
                resolvedCalls: {},
                version: 0,
              } as HarnessState);
        if (base.seenIds[id]) return base;
        return {
          ...base,
          items: [
            ...base.items,
            {
              kind: 'user' as const,
              id,
              text,
              attachments: attachment
                ? [
                    {
                      name: attachment.name,
                      url: attachment.url,
                      type: attachment.type,
                      size: attachment.size,
                    },
                  ]
                : undefined,
            },
          ],
          seenIds: { ...base.seenIds, [id]: true },
          version: base.version + 1,
        };
      });
    },
    [harness, activeWorkspaceId]
  );

  /** Take it back when the server refused the turn — nothing was committed. */
  const dropOptimisticUser = useCallback(
    (sessionId: string, id: string) => {
      harness.setProjectedState((prev) => {
        if (!prev || prev.sessionId !== sessionId || !prev.seenIds[id]) return prev;
        const seenIds = { ...prev.seenIds };
        delete seenIds[id];
        return {
          ...prev,
          items: prev.items.filter((item) => item.id !== id),
          seenIds,
          version: prev.version + 1,
        };
      });
    },
    [harness]
  );

  // The turn in flight, minus everything the committed projection already shows.
  //
  // The runner persists a step the moment it finishes, and the projection renders
  // it immediately; the live stream meanwhile holds the whole assistant turn so
  // far. In a multi-step answer step 1 therefore exists in both places and the
  // reader sees the same paragraph twice. Only prose and thinking belong in the
  // overlay: tool rows and run status already come from the log, once each.
  const persistedTexts = useMemo(() => {
    const text: string[] = [];
    const reasoning: string[] = [];
    // Only the tail matters: the overlay can only be re-showing what this turn
    // already committed, and looking further back invites a false match against
    // an older reply that happened to start with the same words.
    const tail = (projected?.items ?? []).slice(-12);
    for (const item of tail) {
      if (item.kind === 'assistant' && item.text.trim()) text.push(item.text.trim());
      else if (item.kind === 'reasoning' && item.text.trim()) reasoning.push(item.text.trim());
    }
    return { text, reasoning };
  }, [projected?.items]);

  const liveOverlay = useMemo(() => {
    const stripped = stripPersistedPrefix(liveTurn, persistedTexts);
    const parts = (stripped?.parts ?? []).filter((p: any) => {
      const type = typeof p?.type === 'string' ? p.type : '';
      return type === 'text' || type === 'reasoning' || type === 'thinking';
    });
    if (!parts.length) return null;
    return { ...(stripped as any), parts };
  }, [liveTurn, persistedTexts]);

  const liveThread = useMemo(() => {
    const base = Array.isArray(messages) ? messages : [];
    return liveOverlay ? [...base, liveOverlay] : base;
  }, [messages, liveOverlay]);

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

  // Ask the server for the permanent CEO thread, and honour a deep link from the CEO
  // tab (?ceo=1). The server creates it on first look, so there is exactly one.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/agent/v2/sessions');
        const data = await res.json();
        if (!alive || !data?.ceoSessionId) return;
        setCeoSessionId(data.ceoSessionId);
        const params = new URLSearchParams(window.location.search);
        if (params.get('ceo') === '1' || params.get('session') === data.ceoSessionId) {
          userChoseThreadRef.current = true;
          setActiveSessionId(data.ceoSessionId);
          setActiveWorkspaceId(CEO_WORKSPACE_ID);
        }
      } catch {
        /* the tab still works without it; the row simply does not appear */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Create panel: the front door to a production job (kind, dimensions, reference, brief).
  const [createOpen, setCreateOpen] = useState(false);
  // Business skills live here, beside the files, because that is where a user looks
  // for "things I have taught the agent".
  const [skillsOpen, setSkillsOpen] = useState(false);
  // Voice dialogue: talk to the agent instead of typing.
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceActivity, setVoiceActivity] = useState<string | null>(null);

  // While a turn is running, the voice panel is told what is happening so it can say it
  // out loud rather than going silent.
  useEffect(() => {
    setVoiceActivity(isLoading ? 'finishing your request' : null);
  }, [isLoading]);

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

  // ── the send queue ───────────────────────────────────────────────────────
  //
  // A message typed while the agent is working is queued instead of dropped, and this effect
  // sends it when the turn ends. It only listened for the isLoading transition, which lost
  // messages two ways:
  //
  //   - queued while the flag was set for a reason that never flipped back, the effect never
  //     re-ran and the message sat there forever. Seen in production: the footer said
  //     "1 message queued — will send when this turn finishes" and the turn finished and
  //     nothing was sent. The same dead end swallowed an APPROVAL resume, which is how a
  //     tapped Approve produced no work.
  //
  //   - React can batch the flag back to false inside the same commit that queued the item, so
  //     there is no transition to observe at all.
  //
  // So queuedCount is a dependency too (queueing re-runs this effect immediately), the send is
  // on a short timer rather than in the effect body, and a lock stops a double flush.
  const flushingRef = useRef(false);
  // The timer fires after the render that scheduled it, so it must read the live flags rather
  // than the ones captured in this closure.
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const isUploadingRef = useRef(isUploading);
  isUploadingRef.current = isUploading;
  useEffect(() => {
    if (isLoading || isUploading) return;
    if (queueRef.current.length === 0) return;
    if (flushingRef.current) return;
    const timer = setTimeout(() => {
      if (isLoadingRef.current || isUploadingRef.current) return;
      const next = queueRef.current.shift();
      if (!next) return;
      flushingRef.current = true;
      setQueuedCount(queueRef.current.length);
      Promise.resolve(handleSendRef.current(next)).finally(() => {
        flushingRef.current = false;
      });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isUploading, queuedCount]);

  // When a run finishes, the turn is in the log — reload the projection so the
  // live stream overlay is replaced by the authoritative replay view.
  const wasStreaming = useRef(false);
  const metricsRef = useRef(runStream.metrics);
  metricsRef.current = runStream.metrics;
  useEffect(() => {
    if (wasStreaming.current && !isLoading && logSessionId) {
      // Time-to-first-token and tokens/sec for the turn that just ended, so a
      // slow reply is a number in the console and not only a feeling.
      logStreamMetrics('turn finished', metricsRef.current);
      void harness.openSession(logSessionId);
      // The server names a session from its first message (`maybeAutoTitle`), and
      // that write lands DURING the turn. The sidebar list was only fetched on
      // mount, so the tile kept saying "New session" until a full page reload —
      // which is exactly what made naming look broken. Refetch it now.
      void harness.refresh();
    }
    wasStreaming.current = isLoading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, logSessionId]);

  // Adopt an existing session on load.
  //
  // Without this `logSessionId` stayed null until the user sent something, and the
  // send path then created a brand-new session — so every page load plus one
  // message left another empty "New session" tile behind. Reopening the most
  // recent chat instead makes the sidebar behave like a history, not a log of
  // visits.
  const adoptedSession = useRef(false);
  useEffect(() => {
    if (adoptedSession.current) return;
    if (harness.available !== true) return;
    // The user has already picked a thread (a session, CEO, or a deep link), or
    // has just created one. Adopting "the most recent chat" on top of that threw
    // the choice away — clicking New session right after load created a real
    // session, and then this effect opened a different one, so the pane went
    // blank and the reply landed in a conversation nobody was looking at.
    if (userChoseThreadRef.current) {
      adoptedSession.current = true;
      return;
    }
    if (logSessionId) {
      adoptedSession.current = true;
      return;
    }
    const list = harness.sessions;
    if (!Array.isArray(list)) return;

    adoptedSession.current = true;
    if (list.length === 0) return; // nothing to adopt; a session is made on first send

    let lastId: string | null = null;
    try {
      lastId = localStorage.getItem(lastSessionStorageKey);
    } catch {
      /* storage blocked — fall through to the newest */
    }
    const target = list.find((s) => s.id === lastId) || list[0];
    if (!target) return;

    setActiveSessionId(target.id);
    setLogSessionId(target.id);
    if (target.workspaceId) setActiveWorkspaceId(target.workspaceId);
    void harness.openSession(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harness.available, harness.sessions, logSessionId, lastSessionStorageKey]);

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
      // Only restore a default when the user has not already chosen a thread. Choosing the
      // CEO thread sets a workspace this effect knows nothing about, and used to be wiped
      // here a moment later.
      if (!userChoseThreadRef.current) {
        setActiveWorkspaceId(initialWs[0]?.id || 'ws_default');
      }
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

      setActiveSessionId(userChoseThreadRef.current ? activeSessionId : targetSessionId);

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
    // by the time we send in this same tick.
    //
    // `!== false`, not `=== true`. The availability probe is its own round trip;
    // while it is still in flight `available` is null, and requiring `true` made
    // the first message of a freshly loaded tab silently take the legacy path —
    // which is not the streaming transport at all. Asking the server settles it:
    // a real session comes back only when the store exists.
    let sid = logSessionId;
    if (!sid && sessionCreationRef.current) {
      // "New session" was clicked a moment ago and is still resolving. Use THAT
      // session rather than creating another one beside it.
      sid = await sessionCreationRef.current;
      if (sid) {
        setActiveSessionId(sid);
        setLogSessionId(sid);
      }
    }
    if (harness.available !== false && !sid) {
      sid = await harness.createSession({ workspaceId: activeWorkspaceId });
      if (sid) {
        setActiveSessionId(sid);
        setLogSessionId(sid);
      }
    }
    // Wherever this message is going, that thread is now the user's choice — the
    // adoption effect must not switch away from it mid-turn.
    if (sid) userChoseThreadRef.current = true;

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

    // ── Live turn, durable underneath ────────────────────────────────────
    //
    // The reply is streamed straight from the model to this browser over SSE.
    // The run behind it is still durable: `/runs/stream` claims a `harness_runs`
    // row before the first token, so if this tab closes the checkpoint is
    // re-queued and the cron worker carries the task on. The event log is
    // written once per finished step — never per token — so the wire speed is
    // the model's, not Postgres's.
    if (harness.available !== false && sid) {
      // The client owns the id its bubble is rendered with, so the optimistic
      // row and the persisted row are the same row. Without that the bubble
      // appears twice the moment Realtime echoes the insert back.
      const userMessageId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? `u_${crypto.randomUUID()}`
          : `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      appendOptimisticUser(sid, userMessageId, fullPrompt, attachedFile);

      const result = await sendRunStream({
        sessionId: sid,
        text: fullPrompt,
        messageId: userMessageId,
        goal: fullPrompt,
        attachments: attachedFile
          ? [
              {
                name: attachedFile.name,
                url: attachedFile.url,
                type: attachedFile.type,
                size: attachedFile.size,
              },
            ]
          : undefined,
      });

      if (result.outcome === 'streaming') return;

      if (result.outcome === 'steered' || result.outcome === 'queued') {
        // Deliberately NOT an error: the message was accepted and the work is
        // happening. A red banner here is what made a working agent look broken.
        if (result.notice) toast.info(result.notice);
        return;
      }

      if (result.outcome === 'refused' || result.outcome === 'error') {
        // The optimistic bubble has to go: nothing was committed, and leaving it
        // behind would look like the agent silently ignored the message.
        dropOptimisticUser(sid, userMessageId);
        toast.error(result.error || 'The agent could not start that turn.');
        // Re-read the log so the pane shows what actually exists.
        void harness.refreshProjection();
        return;
      }
      return;
    }

    // Fallback only when the session log is unavailable.
    await sendMessage({ text: fullPrompt });
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
    // A deliberate choice: the "adopt the most recent chat" effect must not undo it.
    userChoseThreadRef.current = true;
    setActiveSessionId(sessionId);
    setSecondsElapsed(0);
    isAutoScrollEnabled.current = true;
    // Any overlay belongs to the session we are leaving.
    resetRunStream();

    if (harness.available !== false) {
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
    // A deliberate choice: the "adopt the most recent chat" effect must not undo it.
    userChoseThreadRef.current = true;
    const wsId = targetWsId || activeWorkspaceId;
    setActiveWorkspaceId(wsId);
    setMessages([]);
    setSecondsElapsed(0);
    isAutoScrollEnabled.current = true;
    resetRunStream();

    // `!== false`, not `=== true`: on a freshly loaded tab the availability probe
    // is still in flight when the first click lands, and requiring `true` made
    // "New session" quietly create a browser-local session instead of a real one
    // — which then lost the argument with the effect that adopts the most recent
    // thread, so the click looked like it did nothing.
    if (harness.available !== false) {
      // The creation is a POST plus a projection fetch. A message typed in that
      // window used to see `logSessionId` still null and create a SECOND session,
      // leaving an empty tile behind and putting the reply in a thread the user
      // was not looking at. Handing the in-flight promise to the send path makes
      // it wait for this session instead of starting another.
      const creation = harness.createSession({ workspaceId: wsId });
      sessionCreationRef.current = creation;
      const serverId = await creation;
      if (sessionCreationRef.current === creation) sessionCreationRef.current = null;
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

    // The CEO thread is permanent. The store refuses it as well; this is the polite
    // half of the same rule, so the user gets a reason instead of a dead button.
    if (ceoSessionId && id === ceoSessionId) {
      toast.error('The CEO thread is permanent — it holds what the agent knows about your business.');
      return;
    }

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
        // Deleting a chat must leave you with one FEWER chat, not a fresh empty
        // one. This used to call handleNewSession(), which created a row
        // server-side — so the list never shrank: delete one, gain one.
        //
        // A session is now created lazily on the next send (see handleSend), so
        // the sidebar stays empty until the owner actually starts talking.
        setLogSessionId(null);
        setMessages([]);
        setActiveSessionId(`session_${Date.now()}`);
      }
      void harness.refresh();
      return;
    }

    const updated = sessions.filter((s) => s.id !== id);
    setSessions(updated);
    try {
      localStorage.setItem(sessionStorageKey, JSON.stringify(updated));
    } catch (e) {}
    if (activeSessionId === id) {
      // Same rule without the event log: clear the view, create nothing.
      setMessages([]);
      try {
        localStorage.removeItem(`nobo_msg_${id}`);
      } catch (e) {}
      setActiveSessionId(`session_${Date.now()}`);
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

  /* ── the agent's unanswered question, if there is one ────────────────────
   * `request_user_input` writes a `user_input_prompt` artifact into the tool
   * output. The panel below the transcript reads the LAST one and only shows it
   * while nothing newer has been said, so it never nags about a question that has
   * already been answered.
   */
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(null);
  const pendingQuestion: QuestionPayload | null = useMemo(() => {
    const items = projected?.items ?? [];

    for (let i = items.length - 1; i >= 0; i--) {
      const item: any = items[i];
      // Anything the user said after the question means it was answered.
      if (item?.kind === 'user') return null;
      if (item?.kind !== 'tool') continue;

      const artifact = item?.output?.artifact;
      if (artifact?.type !== 'user_input_prompt') continue;

      const payload = normalizeQuestions(artifact);
      if (!payload) return null;
      if (dismissedQuestionId && payload.id === dismissedQuestionId) return null;
      return payload;
    }
    return null;
  }, [projected?.items, dismissedQuestionId]);

  /**
   * True while a thread's history is being fetched.
   *
   * Opening a session used to render an empty pane and then pop the history in a moment
   * later, which reads as a broken tab. The harness path had a skeleton; the plain message
   * path had nothing. This drives one skeleton for both, and it clears itself as soon as
   * anything arrives — or after a short timeout, so a session that is genuinely empty shows
   * the welcome card rather than a spinner forever.
   */
  const [historyLoading, setHistoryLoading] = useState(false);
  const lastLoadedSessionRef = React.useRef<string | null>(null);

  const allWorkspaces: WorkspaceFolder[] = useMemo(() => {
    const base =
      harness.available !== true
        ? workspaces
        : !harness.workspaces.length
          ? DEFAULT_WORKSPACES
          : harness.workspaces.map((w) => ({ id: w.id, name: w.name, createdAt: '' }));
    // The CEO folder is always present while its thread exists, so selecting it is a
    // selection of something real.
    if (!ceoSessionId) return base.filter((w) => w.id !== CEO_WORKSPACE_ID);
    const others = base.filter((w) => w.id !== CEO_WORKSPACE_ID);
    return [{ id: CEO_WORKSPACE_ID, name: 'CEO', createdAt: '' }, ...others];
  }, [harness.available, harness.workspaces, workspaces, ceoSessionId]);

  // A thread switch is a load: show the skeleton until something arrives.
  useEffect(() => {
    if (!activeSessionId || lastLoadedSessionRef.current === activeSessionId) return;
    lastLoadedSessionRef.current = activeSessionId;
    setHistoryLoading(true);
    const safety = setTimeout(() => setHistoryLoading(false), 5000);
    return () => clearTimeout(safety);
  }, [activeSessionId]);

  // …and clear it the moment there is something to show.
  useEffect(() => {
    if (messages.length > 0 || (projected?.items?.length ?? 0) > 0) setHistoryLoading(false);
  }, [messages.length, projected?.items?.length]);

  const visibleSessions = useMemo(() => {    return allSessions.filter((s) => {
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
        className={`nobo-sidebar fixed inset-y-0 left-0 z-40 w-64 flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
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
              className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 flex items-center justify-center hover:opacity-70 transition"
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
                className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-7 sm:h-7 flex items-center justify-center dsh-interactive"
                title="New workspace folder"
              >
                <FolderPlus size={13} />
              </button>
            </div>
          </div>

          {/* The CEO thread — permanent, pinned, and not part of the workspace tree.
              It is the standing conversation about the business: never deleted, never
              filed away, always one click from anywhere in the agent. */}
          {ceoSessionId && (
            <div className="mb-2">
              <button
                onClick={() => {
                  userChoseThreadRef.current = true;
                  setActiveSessionId(ceoSessionId);
                  setActiveWorkspaceId(CEO_WORKSPACE_ID);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[10px] transition ${
                  activeSessionId === ceoSessionId ? 'dsh-strong' : ''
                }`}
                style={{
                  background:
                    activeSessionId === ceoSessionId
                      ? 'var(--dsw-alias-state-warn-tertiary)'
                      : 'var(--dsw-alias-bg-layer-2)',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  color:
                    activeSessionId === ceoSessionId
                      ? 'var(--dsw-alias-state-warn-secondary)'
                      : 'var(--dsw-alias-label-primary)',
                }}
                title="Your permanent conversation about the business"
              >
                <Crown size={14} className="shrink-0" />
                <span className="dsh-t-s dsh-strong truncate flex-1 text-left">CEO</span>
                <span className="dsh-t-xxxs dsh-label-caption dsh-mono">always on</span>
              </button>
            </div>
          )}

          {/* Folder & Nested Sessions List. The CEO folder is excluded here: it has its
              own pinned row above, and showing it twice would be two ways to the same
              thread. */}
          <div className="space-y-2">
            {allWorkspaces.filter((ws) => ws.id !== CEO_WORKSPACE_ID).map((ws) => {
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
                        className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-7 sm:h-7 flex items-center justify-center rounded dsh-label-caption dsh-interactive"
                        title="New chat in this workspace"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteWorkspace(ws.id, e)}
                        className={`min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-7 sm:h-7 flex items-center justify-center rounded-md dsh-label-caption dsh-interactive-danger transition-all duration-100 ease-out active:scale-90 hover:scale-110 ${pendingDelete === ws.id ? 'dsh-strong scale-110 ring-1 ring-current' : ''}`}
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
                                className={`min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-7 sm:h-7 flex items-center justify-center rounded-md dsh-label-caption dsh-interactive-danger transition-all duration-100 ease-out active:scale-90 active:brightness-125 ${pendingDelete === sess.id ? 'dsh-strong scale-110 ring-1 ring-current' : 'hover:scale-110'}`}
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
            onClick={() => setSkillsOpen(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] dsh-interactive"
            title="Procedures you have taught the agent"
          >
            <BookOpen size={15} className="dsh-accent" />
            <span>Business Skills</span>
          </button>

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

            {/* Theme is a preference, not a primary action. On a phone it pushed the session
                title into a hard clip ("Hi — in one sentence, what can you do for my busin"),
                so it steps aside below sm. */}
            <button
              type="button"
              onClick={toggleTheme}
              className="hidden sm:inline-flex px-2 py-1 rounded-[8px] dsh-t-xs dsh-label-secondary dsh-interactive shrink-0"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>

            <div className="flex items-center gap-2 min-w-0 flex-1 max-w-md text-xs">
              <span className="font-bold dsh-label-primary truncate min-w-0">
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

          {/* Chat | Trajectory and the session log in ONE right-hand cluster. They used
              to be two children of a space-between header, so the pill floated in the
              middle of the bar and the three groups read as three unrelated things. */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="flex items-center gap-1 p-0.5 dsh-t-xs dsh-strong shrink-0 text-[11px] sm:text-[13px]"
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
                className="px-3 min-w-[44px] min-h-[44px] sm:min-h-9 flex items-center justify-center transition"
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
                className="px-3 min-w-[44px] min-h-[44px] sm:min-h-9 flex items-center justify-center transition"
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

            <button
              onClick={() => setShowLogsDrawer(!showLogsDrawer)}
              aria-label="Open the session log"
              className="flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-9 px-2 sm:px-2.5 rounded-[8px] dsh-t-xs dsh-mono dsh-btn"
            >
              <span className="hidden sm:inline">Session log</span>
              <Download size={13} />
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
            {historyLoading && messages.length === 0 && (projected?.items?.length ?? 0) === 0 ? (
              // One skeleton for BOTH paths. Previously only the log-backed path had one,
              // so a plain session opened onto a blank pane and filled in a beat later.
              <div className="space-y-3 pt-6" aria-label="Loading conversation" role="status">
                <div className="flex items-center gap-2.5 pb-2">
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
                  <span className="dsh-t-xs dsh-label-tertiary">Loading this conversation…</span>
                </div>
                {[72, 88, 54, 80].map((w, i) => (
                  <div key={i} className="flex items-start gap-2.5 animate-pulse">
                    <div
                      className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: 'var(--dsw-alias-border-l2)' }}
                    />
                    <div className="h-3 rounded-full" style={{ width: `${w}%`, background: 'var(--dsw-alias-bg-layer-3)' }} />
                  </div>
                ))}
              </div>
            ) : messages.length === 0 && !(logEnabled && (projected?.items.length ?? 0) > 0) ? (
              <AgentWelcome
                disabled={isLoading || isUploading}
                onPrompt={(text) => handleSend(text)}
                onGetStarted={() => {
                  const el = textareaRef.current;
                  if (el) {
                    el.focus();
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }
                }}
              />
            ) : logEnabled ? (
              // Log-backed session: the committed transcript is a projection of
              // the event log, and only the in-flight turn comes from the live
              // stream. On finish the projection is reloaded and replaces it.
              <>
                <HarnessTranscript
                  items={projected?.items ?? []}
                  onOptionSelect={handleSend}
                  onResume={handleSend}
                />
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
                {liveOverlay && (
                  // The turn in flight, streamed straight from the model. It is
                  // rendered last, and only carries what the committed
                  // projection has not already shown — see `liveOverlay`.
                  <SafeMessageRenderer
                    m={liveOverlay}
                    mIdx={liveThread.length - 1}
                    messages={liveThread}
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

            {/* Live status strip. Hidden when a durable run is already reported below: two
                "working" rows, each with its own Stop, was the most confusing thing on a
                phone — the agent looked busy twice. */}
            {isLoading && !harness.activeRun && (
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
                <span className="nobo-thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
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
                    // Stop the live SSE turn too: aborting the request stops
                    // paying for tokens nobody will read, and the runner
                    // re-queues whatever it had already completed.
                    stopRunStream();
                    stop();
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
                    className="ml-auto dsh-t-xs dsh-label-tertiary dsh-interactive-danger px-3 min-h-[44px] sm:min-h-8 flex items-center"
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

            {/* The agent's question, brought to the composer instead of buried in
                the transcript. Answers, custom text and skip all route through the
                same handleSend the composer uses. */}
            {pendingQuestion && (
              <QuestionPanel
                payload={pendingQuestion}
                disabled={isUploading}
                onSubmit={(answer) => {
                  setDismissedQuestionId(pendingQuestion.id);
                  void handleSend(answer);
                }}
                onSkip={() => {
                  setDismissedQuestionId(pendingQuestion.id);
                  void handleSend('Skip that question — use your best judgement and carry on.');
                }}
              />
            )}

            {/* Rounded Dock Container */}
            <div
              className="nobo-dock dsh-composer p-3 transition"
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
                    ? 'Queued — sends when this run finishes'
                    : 'Ask Nobo anything…'
                }
                aria-label="Message the agent"
                rows={1}
                className="w-full resize-none bg-transparent outline-none dsh-t-base px-1 py-1 max-h-44"
                style={{ color: 'var(--dsw-alias-label-primary)' }}
              />

              <div className="flex items-center justify-between pt-2 mt-1 dsh-border-t">
                <div className="flex items-center gap-1 sm:gap-2 text-xs">
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
                    className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-9 sm:h-9 rounded-full dsh-label-tertiary dsh-interactive flex items-center justify-center"
                    title="Attach file"
                    aria-label="Attach a file"
                  >
                    <Plus size={18} />
                  </button>

                  {/* Dictation: speak, and the words land in the box to edit and send.
                      Part of the composer, so it is in every session automatically. */}
                  <DictateButton
                    disabled={isLoading || isUploading}
                    onText={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))}
                  />

                  {/* Create — the fixed-form Creation tab cannot bend, so this seeds
                      the same job as a conversation the user can keep editing. */}
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="flex items-center gap-1.5 min-h-[44px] sm:min-h-9 px-3 dsh-t-xs dsh-strong transition"
                    style={{
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-secondary)',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      borderRadius: 'var(--dsh-radius-full)',
                    }}
                    title="Start a creative job — pick dimensions and a reference, then talk it through"
                  >
                    <Sparkles size={13} />
                    Create
                  </button>


                  {/* Permission mode — a status chip, not a control. There is no
                      permission-preset system wired yet, so this must not look
                      clickable. Hidden on phones: at 390px wide it wrapped onto
                      two lines and pushed the send button off the row. */}
                  <span
                    className="hidden sm:flex items-center gap-1 px-2.5 py-1 dsh-t-xs dsh-mono"
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
                      directly. Static label, not a control. Hidden on phones so
                      the send button keeps its place on the row. */}
                  <span
                    className="hidden sm:flex items-center gap-1.5 dsh-t-xs dsh-mono"
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
                    disabled={(!input.trim() && !attachedFile) || isUploading || isLoading}
                    className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 rounded-full dsh-btn flex items-center justify-center disabled:opacity-40"
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
                        // A durable run is cancelled via the run API; the live
                        // stream is cancelled by aborting its request.
                        if (harness.runInProgress) void harness.cancelRun();
                        stopRunStream();
                        stop();
                      }}
                      className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 rounded-full dsh-btn-primary flex items-center justify-center"
                      title="Stop"
                    >
                      <Square size={12} className="fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={(!input.trim() && !attachedFile) || isUploading}
                      className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 rounded-full dsh-btn-primary flex items-center justify-center"
                      title={isLoading ? 'Queue message (sends when the current turn finishes)' : 'Send'}
                    >
                      <Send size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom status metadata bar. The static mode line is a desktop nicety — on a
                phone it only ever showed a clipped "Full Acc…" under the composer. */}
            <div className="mt-2 text-center dsh-t-xxxs dsh-mono dsh-label-caption truncate">
              {queuedCount > 0 ? (
                <span className="dsh-accent">
                  {queuedCount} message{queuedCount > 1 ? 's' : ''} queued — sends when this turn finishes
                </span>
              ) : (
                <span className="hidden sm:inline">Nobogent Autonomous Operator • Standard mode • Full Access</span>
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

      <CreatePanel open={createOpen} onClose={() => setCreateOpen(false)} onSend={handleSend} />
      <SkillsDrawer open={skillsOpen} onClose={() => setSkillsOpen(false)} />
    </div>
  );
}

