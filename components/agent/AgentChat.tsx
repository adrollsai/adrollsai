'use client';

import * as React from 'react';
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
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
  Package,
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
  SendHorizontal,
  Pencil,
  Clock,
  X,
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
import CataloguePicker, { type CatalogueItem } from './CataloguePicker';
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
import { artifactFrom } from '@/lib/agent/tool-output';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';

interface WorkspaceFolder {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * Where the sidebar remembers which threads have been looked at.
 *
 * Read-tracking only, in this browser: see `sessionDot` for why there is no column for it.
 */
const SEEN_SESSIONS_KEY = 'nobo_agent_seen_sessions';

interface ChatSession {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  /** Approvals on this thread still waiting for the owner (from the sessions API). */
  pendingApprovals?: number;
  /** This thread's most recent run, if it has ever run. */
  lastRun?: { status: string; finishedAt: string | null } | null;
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
  /** Catalogue items attached as context for the next message (ids, so the agent can act on them). */
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
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
   *
   * A deep link counts as a choice FROM THE FIRST RENDER, not once its fetch resolves. Tapping
   * "Talk to CEO" navigates to ?ceo=1, and the CEO effect has to await a session list before it
   * can open the thread. In that gap the adopt-last-chat effect used to win the race and open a
   * previous conversation — the owner landed in the wrong chat, and the CEO thread replaced it
   * only when the fetch finally returned (reported as "after 10–15 seconds it opened the CEO
   * tile"). Reading the URL synchronously is what closes that gap.
   */
  const deepLink = React.useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return { ceo: params.get('ceo') === '1', session: params.get('session') || null };
    } catch {
      return { ceo: false, session: null };
    }
  }, []);
  const userChoseThreadRef = React.useRef(deepLink.ceo || Boolean(deepLink.session));
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
  const harness = useHarnessSession(impersonateId);
  const [logSessionId, setLogSessionId] = useState<string | null>(null);
  /**
   * The same id, readable synchronously.
   *
   * `handleNewSession` creates a session and then the FIRST message is sent in the same tick. React has not
   * re-rendered yet, so anything reading the state variable sees the previous value (usually null) — and the
   * request went out with no session id at all. The turn streamed, the reply appeared, and nothing was
   * persisted: no event log, no run, no sidebar tile, and after a refresh an owner saw their own question
   * and no answer. Measured on a real account: three sessions holding exactly one `session.opened` event.
   *
   * A ref is set at the moment of creation and is what the request body reads, so "the id exists" and "the
   * request carries it" can no longer disagree.
   */
  const logSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    logSessionIdRef.current = logSessionId;
  }, [logSessionId]);
  const logEnabled = harness.available === true && logSessionId !== null;
  const projected = harness.state && harness.state.sessionId === logSessionId ? harness.state : null;

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: apiEndpoint,
      /**
       * Read the id AT SEND TIME, not at transport-construction time.
       *
       * With a static object the value was frozen when the transport was built. A session created moments
       * earlier — during the same click — had not reached this closure yet, so the first message of every
       * new conversation went out with `sessionId: undefined`: the server had nothing to attach the turn
       * to, so nothing was written, and a refresh showed a question with no answer.
       */
      body: () => ({ sessionId: logSessionIdRef.current || undefined }),
    });
  }, [apiEndpoint]);

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
  const runStream = useRunStream(impersonateId);
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
  /**
   * The queue, made visible.
   *
   * A message typed while a turn was running went into `queueRef` and surfaced as nothing but a number in
   * the footer — "1 message queued — sends when this turn finishes". Its words were invisible, so it read as
   * a lost message, and there was no way to take it back, fix a typo in it, or send it now. A queue you
   * cannot see is a queue you cannot trust, and an owner who cannot see their own message assumes the app
   * swallowed it.
   *
   * So it is staged: each waiting message is listed above the composer with the three things anyone actually
   * wants — send it now, edit it (which puts it back in the box and takes it out of the queue), or delete it.
   * When the turn ends the queue still dispatches itself, and the message then appears in the transcript like
   * any other.
   */
  const [staged, setStaged] = useState<{ id: string; text: string }[]>([]);
  const handleSendRef = useRef<(text?: string) => Promise<void>>(async () => {});

  // Two-step delete confirmation: holds the id awaiting a second click.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Ask the server for the permanent CEO thread, and honour a deep link from the CEO
  // tab (?ceo=1). The server creates it on first look, so there is exactly one.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessionsUrl = impersonateId
          ? `/api/agent/v2/sessions?impersonate=${encodeURIComponent(impersonateId)}`
          : '/api/agent/v2/sessions';
        const res = await fetch(sessionsUrl);
        const data = await res.json();
        if (!alive || !data?.ceoSessionId) return;
        setCeoSessionId(data.ceoSessionId);
        const params = new URLSearchParams(window.location.search);
        if (params.get('ceo') === '1' || params.get('session') === data.ceoSessionId) {
          userChoseThreadRef.current = true;
          setActiveSessionId(data.ceoSessionId);
          setActiveWorkspaceId(CEO_WORKSPACE_ID);
        }
        /**
         * An instruction handed over by the CEO tab (?ask=…).
         *
         * The tab could show what was wrong and what it would do about it, and then left the owner to retype
         * it here. A finding's button — or the "Tell it what you want" box — now arrives as this parameter
         * and is SENT, not prefilled, so one click starts the work. Everything that spends money or messages
         * a customer still stops at the review gate, so a one-click instruction cannot spend silently.
         *
         * Sent once: the parameter is stripped from the URL immediately, so a refresh or a back-navigation
         * cannot fire the same instruction twice.
         */
        const ask = (params.get('ask') || '').trim();
        if (ask) {
          params.delete('ask');
          const query = params.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
          // A beat for the thread to be selected and the stream to attach; sending into a session that is
          // still switching is how a message lands in the wrong conversation.
          window.setTimeout(() => {
            void handleSendRef.current(ask);
          }, 500);
        }
      } catch {
        /* the tab still works without it; the row simply does not appear */
      }
    })();
    return () => {
      alive = false;
    };
    // A different tenant is a different permanent CEO thread.
  }, [impersonateId]);

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
  //
  // `useLayoutEffect`, not `useEffect`, and that matters for dark mode: the saved theme
  // lives in localStorage, so it can only be applied after the client renders. With a plain
  // effect that happens after the browser has already painted, and someone who chose dark
  // sees the whole light UI for a frame before it flips. A layout effect runs after the DOM
  // is committed but BEFORE paint, so the first frame they ever see is already theirs.
  //
  // It is isomorphic because this component still renders on the server, where layout
  // effects do not run and React would warn about one.
  const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useIsomorphicLayoutEffect(() => {
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
      // The staged row goes as it is dispatched; it reappears as a real message in the transcript.
      setStaged((prev) => prev.slice(1));
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
    // Refreshed whether or not this turn had a log id: a session created by this click still needs its tile,
    // and the previous condition meant a turn that failed to attach a log also never refreshed the list.
    if (wasStreaming.current && !isLoading) void harness.refresh();
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
  /**
   * Open the thread the URL asked for, and ONLY that one.
   *
   * This used to adopt "the most recent chat" on every visit, on the theory that the sidebar
   * should behave like a history. In practice it meant opening the agent tab dropped the owner
   * into whatever they were last doing — mid-conversation, with someone else's context, unsure
   * whether they were starting fresh — and it raced the CEO deep link (see `deepLink` above).
   *
   * The owner's rule now: opening the tab starts a NEW session. A thread is reopened only when a
   * link asks for it explicitly (?session=…), which is what the sidebar and the CEO tab use.
   * Nothing is created here either — a session row is written on the first message, so a visit
   * that sends nothing leaves no empty tile behind.
   */
  const adoptedSession = useRef(false);
  useEffect(() => {
    if (adoptedSession.current) return;
    if (harness.available !== true) return;

    /**
     * A link that names a thread opens THAT thread — and it is the only thing this effect does.
     *
     * Ordered before the `userChoseThreadRef` check on purpose. A deep link marks the thread as
     * chosen from the first render (so the old adopt-last-chat behaviour could not win the race), and
     * that same flag would otherwise make this effect return before it ever opened anything: the
     * conversation was in the sidebar, the pane showed the welcome screen.
     */
    if (deepLink.session && !deepLink.ceo) {
      const requestedId = deepLink.session;
      // Wait for the list before deciding: a second pass runs when the sessions arrive.
      if (!harness.sessions.some((s) => s.id === requestedId)) return;
      adoptedSession.current = true;
      userChoseThreadRef.current = true;
      setActiveSessionId(requestedId);
      setLogSessionId(requestedId);
      const workspaceId = harness.sessions.find((s) => s.id === requestedId)?.workspaceId;
      if (workspaceId) setActiveWorkspaceId(workspaceId);
      void harness.openSession(requestedId);
      return;
    }

    adoptedSession.current = true;
    // No deep link: a fresh thread, by design. Nothing to adopt and nothing to create — a session
    // row is written on the first message, so a visit that sends nothing leaves no empty tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harness.available, harness.sessions, logSessionId, deepLink.session, deepLink.ceo]);

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
      if (savedSess) {
        const parsedSess = JSON.parse(savedSess);
        // The mirrored list is only a head start for the tile rail — the server's list replaces
        // it a moment later. It is NOT a decision about which thread to open.
        if (Array.isArray(parsedSess) && parsedSess.length > 0) setSessions(parsedSess);
      }

      /**
       * Opening the agent tab starts a NEW thread.
       *
       * This used to call `setActiveSessionId(<last session in the mirror>)` and then load that
       * session's messages out of `nobo_msg_*`, so every visit resumed whatever the owner was
       * last doing — with its context on screen, looking like a brand-new chat. The owner's rule
       * is explicit: a fresh session per visit. A thread is reopened only by the sidebar or by a
       * link that names it, both of which go through the adopt effect above. Nothing is written
       * here, so a visit that sends no message leaves no empty tile behind.
       */
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

  /**
   * A cheap signature of "how much conversation is there", so the follow effect fires while the
   * agent is still writing.
   *
   * It used to depend on `messages.length` alone, which does not change when an assistant message
   * grows token by token — so a long answer scrolled out of view as it was written and the view
   * sat still. The last message's length is what changes during a stream; the item count covers
   * the log-backed path, where new rows arrive as separate items.
   */
  const followSignal = useMemo(() => {
    const last: any = messages[messages.length - 1];
    let lastLen = 0;
    try {
      if (typeof last?.content === 'string') lastLen = last.content.length;
      else if (Array.isArray(last?.parts)) {
        lastLen = last.parts.reduce(
          (n: number, part: any) => n + (typeof part?.text === 'string' ? part.text.length : 0),
          0
        );
      } else if (Array.isArray(last?.content)) {
        lastLen = last.content.reduce(
          (n: number, part: any) => n + (typeof part?.text === 'string' ? part.text.length : 0),
          0
        );
      }
    } catch {
      lastLen = 0;
    }
    return `${messages.length}:${lastLen}:${projected?.items?.length ?? 0}`;
  }, [messages, projected?.items]);

  useEffect(() => {
    // Only follow the conversation when there IS one. This ran on mount for an empty session too,
    // scrolling the welcome screen to its own bottom — which on a laptop-sized window clipped the top
    // of the mascot off the screen and pushed the "Get started" button up into the heading. A landing
    // page must not be scrolled by code the moment it appears.
    //
    // `isAutoScrollEnabled` is the whole of the "do not hijack me" rule: `handleScroll` clears it the
    // moment the reader scrolls up, and sets it again when they come back to the bottom. Nothing here
    // overrides that, so scrolling up to read is never fought.
    const empty = messages.length === 0 && !isLoading;
    if (!empty && isAutoScrollEnabled.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [followSignal, isLoading, messages.length]);

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

  /**
   * START THE SESSION WHILE THE OWNER IS STILL TYPING.
   *
   * Measured on the deployed app: Enter on an idle composer spent 6.4 seconds before the turn
   * request was even sent — POST /sessions took 2.9s, the new session's projection 2.0s, and the
   * runs refresh 1.2s, all sequential and all on the Enter path, because a turn cannot belong to a
   * session that does not exist yet. None of that depends on the message, so it now starts on the
   * first keystroke and Enter inherits a session that is already there.
   *
   * It publishes the same in-flight promise the "New session" button does, so a message sent while
   * creation is still running joins THAT session instead of creating a second one beside it.
   */
  const prewarmSession = () => {
    if (logSessionIdRef.current || sessionCreationRef.current) return;
    if (harness.available === false) return;
    const creation = harness.createSession({ workspaceId: activeWorkspaceId });
    sessionCreationRef.current = creation;
    void creation
      .then((serverId: string | null) => {
        if (sessionCreationRef.current === creation) sessionCreationRef.current = null;
        if (!serverId) return;
        // A different thread may have been opened while this was in flight; do not steal the pane.
        if (logSessionIdRef.current) return;
        setActiveSessionId(serverId);
        logSessionIdRef.current = serverId;
        setLogSessionId(serverId);
        void harness.refresh();
      })
      .catch(() => {
        if (sessionCreationRef.current === creation) sessionCreationRef.current = null;
      });
  };

  const handleSend = async (customPrompt?: string) => {
    /** The picked catalogue items, sent as context with the message. Shown as a chip, never typed into the box. */
  const withCatalogue = (text: string) =>
    catalogue.length
      ? text + ' ' + '[Catalogue context: ' + catalogue.map((item) => item.title + ' (id: ' + item.id + ')').join(', ') + ']'
      : text;
  const textToSend = customPrompt || input;
    if ((!textToSend.trim() && !attachedFile) || isUploading) return;

    let fullPrompt = withCatalogue(textToSend);
    if (attachedFile) {
      if (attachedFile.url) {
        fullPrompt = withCatalogue(`[Attached File: ${attachedFile.name} (${attachedFile.type})]\nURL: ${attachedFile.url}\n\nInstruction: ${textToSend || 'Please inspect this reference video/file and help me create content based on it.'}`);
      } else if (attachedFile.content) {
        fullPrompt = withCatalogue(`[Attached File: ${attachedFile.name} (${attachedFile.type})]\nContent preview:\n${attachedFile.content.slice(0, 2000)}\n\nInstruction: ${textToSend || 'Please inspect this file and help me process it.'}`);
      }
      setAttachedFile(null);
    }
    // The catalogue is context for THIS message, so it is spent when the message is sent — the next one
    // should not silently carry items the owner did not pick for it.
    if (catalogue.length) setCatalogue([]);

    // A turn is already running: queue this instead of dropping it, and send it
    // automatically when the current one ends.
    if (isLoading) {
      /**
       * STEERING, NOT QUEUEING.
       *
       * The owner's point, and it is the right one: if you notice mid-task that it has drifted, a correction
       * that only lands AFTER the task finishes has already cost the credits and the time spent on the wrong
       * work. The correction has to reach the model before its next step.
       *
       * The engine already supports exactly that — `runner.ts` calls `pullSteering()` at every step boundary
       * and turns any new `user.message` in the session log into an extra user turn before the next model
       * call. So while a durable run is in flight, the message is appended to the log and the running task
       * picks it up; it appears in the transcript immediately, because it IS a user message.
       *
       * Queueing stays as the fallback for a turn with no log to steer through: then it waits, visibly, with
       * send-now / edit / delete.
       */
      const liveSession = logSessionIdRef.current;
      if (harness.runInProgress && liveSession) {
        void harness.appendUserMessage(fullPrompt, undefined, liveSession);
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        toast.success('Delivered to the running task — it will see this before its next step.');
        return;
      }
      queueRef.current.push(fullPrompt);
      setQueuedCount(queueRef.current.length);
      setStaged((prev) => [...prev, { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text: fullPrompt }]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    ensureSessionRegistered(textToSend);
    setSecondsElapsed(0);
    isAutoScrollEnabled.current = true;

    /**
     * CLEAR THE BOX THE MOMENT THE OWNER SENDS, NOT WHEN THE SERVER ANSWERS.
     *
     * Measured in a real browser on an idle composer: pressing Enter left the typed text sitting in
     * the box for about five seconds, with no bubble, no spinner and no message — the clearing
     * happened after `createSession` and the run handshake had both returned. To anyone watching,
     * Enter had done nothing, and pressing it again queued the message twice. The send is now
     * acknowledged in the same frame; the text is put back if the turn is refused or fails, so
     * nothing is silently lost.
     */
    const sentText = fullPrompt;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

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
        logSessionIdRef.current = sid;
        setLogSessionId(sid);
      }
    }
    if (harness.available !== false && !sid) {
      sid = await harness.createSession({ workspaceId: activeWorkspaceId });
      if (sid) {
        setActiveSessionId(sid);
        logSessionIdRef.current = sid;
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
        // The box was cleared optimistically when Enter was pressed. Nothing was
        // accepted, so the text goes back rather than making the owner retype it.
        setInput((current) => (current.trim() ? current : sentText));
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

  /** The picked catalogue items, sent as context with the message. Shown as a chip, never typed into the box. */
  const withCatalogue = (text: string) =>
    catalogue.length
      ? text + ' ' + '[Catalogue context: ' + catalogue.map((item) => item.title + ' (id: ' + item.id + ')').join(', ') + ']'
      : text;
    const textToSend = input;
    let fullPrompt = withCatalogue(textToSend);
    if (attachedFile) {
      if (attachedFile.url) {
        fullPrompt = withCatalogue(`[Attached File: ${attachedFile.name} (${attachedFile.type})]\nURL: ${attachedFile.url}\n\nInstruction: ${
          textToSend || 'Please inspect this reference and act on it.'
        }`);
      } else if (attachedFile.content) {
        fullPrompt = withCatalogue(`[Attached File: ${attachedFile.name} (${attachedFile.type})]\nContent preview:\n${attachedFile.content.slice(
          0,
          2000
        )}\n\nInstruction: ${textToSend || 'Please inspect this file and act on it.'}`);
      }
      setAttachedFile(null);
    }
    if (catalogue.length) setCatalogue([]);

    let sid = logSessionId;
    if (harness.available === true && !sid) {
      sid = await harness.createSession({ workspaceId: activeWorkspaceId });
      if (sid) {
        setActiveSessionId(sid);
        logSessionIdRef.current = sid;
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
      logSessionIdRef.current = sessionId;
      setLogSessionId(sessionId);
      const nextState = await harness.openSession(sessionId);
      // Rebuild the model context from the log, otherwise the next follow-up
      // would be asked in isolation with no history.
      setMessages(nextState ? itemsToUIMessages(nextState.items) : []);
      return;
    }

    logSessionIdRef.current = null;

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
        freshSessionRef.current = serverId;
        setActiveSessionId(serverId);
        logSessionIdRef.current = serverId;
        setLogSessionId(serverId);
        // The sidebar list was fetched on mount, so a session created now has no tile until something asks
        // again — which is why a fresh conversation appeared to have vanished from the list.
        void harness.refresh();
        toast.success('Started a fresh session');
        return;
      }
      // Store reachable but creation failed — fall through to a local session
      // rather than trapping the user with no way to type.
    }

    const newId = 'session_' + Date.now();
    freshSessionRef.current = newId;
    setActiveSessionId(newId);
    logSessionIdRef.current = null;
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
        logSessionIdRef.current = null;
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
      pendingApprovals: s.pendingApprovals ?? 0,
      lastRun: s.lastRun ?? null,
    }));
  }, [harness.available, harness.sessions, sessions]);

  /* ── which threads the owner has actually looked at ───────────────────────
   * "Finished" is only worth a dot if nobody has read it, and there is no read state on
   * the server — adding one would mean a write on every tile click. So it is kept where
   * it belongs: in this browser. Opening a thread stamps it, and so does a run finishing
   * on the thread currently open, so watching a task to the end does not leave a green
   * dot behind on it.
   *
   * Being browser-only means it does not follow the owner between devices. That is the
   * right trade for a nudge: this dot is never a record of anything.
   */
  const [seenAt, setSeenAt] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEEN_SESSIONS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Merge under `prev` so a stamp written in this same commit is not lost.
        setSeenAt((prev) => ({ ...(parsed as Record<string, string>), ...prev }));
      }
    } catch {
      /* a corrupt value just means no dots — it must never break the sidebar */
    }
  }, []);

  const activeSessionFinishedAt = useMemo(() => {
    const current = allSessions.find((s) => s.id === activeSessionId);
    return current?.lastRun?.finishedAt ?? null;
  }, [allSessions, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    const now = new Date().toISOString();
    setSeenAt((prev) => ({ ...prev, [activeSessionId]: now }));
  }, [activeSessionId, activeSessionFinishedAt]);

  useEffect(() => {
    try {
      if (Object.keys(seenAt).length) {
        localStorage.setItem(SEEN_SESSIONS_KEY, JSON.stringify(seenAt));
      }
    } catch {
      /* storage full or blocked: the dots simply stop persisting */
    }
  }, [seenAt]);

  /**
   * The dot on a session tile.
   *
   *   'approval' — the agent has stopped and will not continue until the owner decides
   *   'done'     — it finished (completed, or stopped because the owner asked) and the
   *                owner has not looked at the thread since
   *   null       — nothing worth saying
   *
   * Approval wins when a thread is both: the one that needs a human is the one worth
   * interrupting for. The thread that is open never gets a dot — the owner is looking at
   * it, and a marker on the thing under your nose is noise.
   */
  const sessionDot = useCallback(
    (s: ChatSession): 'approval' | 'done' | null => {
      if ((s.pendingApprovals ?? 0) > 0) return 'approval';
      if (s.id === activeSessionId) return null;
      const run = s.lastRun;
      if (!run?.finishedAt) return null;
      // Only a thread that came to rest is "finished". `failed` and `dead` are not good
      // news to flag green, and `queued`/`running` are simply still working.
      if (run.status !== 'completed' && run.status !== 'cancelled') return null;
      const seen = seenAt[s.id];
      if (seen && new Date(seen).getTime() >= new Date(run.finishedAt).getTime()) return null;
      return 'done';
    },
    [activeSessionId, seenAt]
  );

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

      // `artifactFrom` unwraps the discovery proxy: a question asked through
      // `call_tool` keeps its artifact one level down, and reading only the top
      // level meant that question never reached the panel.
      const artifact: any = artifactFrom(item?.output);
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
  /**
   * A session created by this click has no history to wait for.
   *
   * The skeleton is meant for "we asked the server for this thread's history and it has not
   * answered yet". For a brand-new thread there is nothing to answer with, so the skeleton waited
   * for content that was never coming and sat there until the safety timeout — which is the
   * "it spins for a moment, then the UI appears" delay on New session. A fresh thread paints
   * immediately instead.
   */
  const freshSessionRef = React.useRef<string | null>(null);

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

  // A thread switch is a load: show the skeleton until something arrives — unless this is a
  // thread we just created, which has nothing to load.
  useEffect(() => {
    if (!activeSessionId || lastLoadedSessionRef.current === activeSessionId) return;
    lastLoadedSessionRef.current = activeSessionId;
    if (freshSessionRef.current === activeSessionId) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    // Short ceiling: a real load clears this on content (below). The old 5s ceiling is what made
    // an empty thread spin for five full seconds before showing an empty conversation.
    const safety = setTimeout(() => setHistoryLoading(false), 1500);
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
                  Nobo AI
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
                className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 flex items-center justify-center dsh-interactive"
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

          {/* Folder & Nested Sessions List.
              The CEO folder is normally excluded here: it has its own pinned row above, and
              showing it twice would be two ways to the same thread.

              That rule hid real threads. The pinned row opens the ONE permanent CEO
              conversation (ceoSessionId); any OTHER thread stored in the CEO folder had no
              route to it at all — the folder was gone from the tree and the pin pointed
              somewhere else. A live client's two campaign threads were exactly that: present,
              returned by the API, and invisible. So the folder stays excluded only while it
              holds nothing but the pinned conversation. */}
          <div className="space-y-2">
            {allWorkspaces
              .filter(
                (ws) =>
                  ws.id !== CEO_WORKSPACE_ID ||
                  allSessions.some((s) => s.workspaceId === CEO_WORKSPACE_ID && s.id !== ceoSessionId)
              )
              .map((ws) => {
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
                        className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 flex items-center justify-center rounded dsh-label-caption dsh-interactive"
                        title="New chat in this workspace"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteWorkspace(ws.id, e)}
                        className={`min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 flex items-center justify-center rounded-md dsh-label-caption dsh-interactive-danger transition-all duration-100 ease-out active:scale-90 hover:scale-110 ${pendingDelete === ws.id ? 'dsh-strong scale-110 ring-1 ring-current' : ''}`}
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
                        const dot = sessionDot(sess);
                        const dotLabel =
                          dot === 'approval'
                            ? 'Waiting for your approval'
                            : dot === 'done'
                              ? 'Finished — not read yet'
                              : '';
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
                              {dot && (
                                <span
                                  role="img"
                                  aria-label={dotLabel}
                                  title={dotLabel}
                                  className="shrink-0 rounded-full"
                                  style={{
                                    width: 6,
                                    height: 6,
                                    background:
                                      dot === 'approval'
                                        ? 'var(--nobo-dot-approval)'
                                        : 'var(--nobo-dot-done)',
                                  }}
                                />
                              )}
                              <span className="truncate">{sess.title}</span>
                            </div>

                            <div className="flex items-center gap-1.5 dsh-label-caption dsh-t-xxxs dsh-mono shrink-0 ml-1">
                              <span>{formatTimeAgo(sess.createdAt)}</span>
                              <button
                                onClick={(e) => handleDeleteSession(sess.id, e)}
                                className={`min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 flex items-center justify-center rounded-md dsh-label-caption dsh-interactive-danger transition-all duration-100 ease-out active:scale-90 active:brightness-125 ${pendingDelete === sess.id ? 'dsh-strong scale-110 ring-1 ring-current' : 'hover:scale-110'}`}
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
              className="flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-9 px-3 rounded-[8px] dsh-t-xs dsh-mono dsh-btn"
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

        {/* Floating Jump to Bottom Button.
            Centred above the composer, an arrow only — the same affordance the major chat UIs use.
            It was pinned to the right with a "Latest" label, which read as a button for something
            other than "scroll down". */}
        {showScrollBottomBtn && (
          <div className="absolute bottom-24 left-0 right-0 z-30 flex justify-center pointer-events-none">
            <button
              onClick={scrollToBottom}
              aria-label="Scroll to latest message"
              title="Scroll to latest message"
              className="pointer-events-auto h-8 w-8 rounded-full dsh-surface-2 dsh-border dsh-label-primary flex items-center justify-center dsh-interactive transition-colors"
              style={{ boxShadow: 'var(--dsw-shadow-lv2)' }}
            >
              <ArrowDown size={16} />
            </button>
          </div>
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
            {/**
             * Staged messages: waiting, visible, and disposable.
             *
             * A message sent mid-turn is not lost, it is waiting — and it says so, in its own words, with the
             * three actions that make a wait tolerable: send it now, edit it, or drop it.
             */}
            {staged.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {staged.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 rounded-[10px] px-2.5 py-1.5 dsh-chip dsh-t-xs"
                  >
                    <Clock size={12} className="mt-0.5 shrink-0 dsh-warn" />
                    <div className="min-w-0 flex-1">
                      <span className="dsh-label-caption dsh-t-xxxs block">
                        Waiting for this turn to finish{index === 0 ? '' : ` · #${index + 1}`}
                      </span>
                      <span className="block whitespace-pre-wrap break-words dsh-label-secondary">{item.text}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          // Dispatch now: it leaves the queue and starts a turn of its own, exactly as if the
                          // current one had finished.
                          queueRef.current = queueRef.current.filter((text) => text !== item.text);
                          setQueuedCount(queueRef.current.length);
                          setStaged((prev) => prev.filter((entry) => entry.id !== item.id));
                          void handleSendRef.current(item.text);
                        }}
                        className="rounded p-1 dsh-label-tertiary dsh-interactive"
                        title="Send it now"
                        aria-label="Send this message now"
                      >
                        <SendHorizontal size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          // Edit: back into the box to fix, and out of the queue so it is not sent twice.
                          queueRef.current = queueRef.current.filter((text) => text !== item.text);
                          setQueuedCount(queueRef.current.length);
                          setStaged((prev) => prev.filter((entry) => entry.id !== item.id));
                          setInput(item.text);
                          textareaRef.current?.focus();
                        }}
                        className="rounded p-1 dsh-label-tertiary dsh-interactive"
                        title="Edit it"
                        aria-label="Edit this message"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          queueRef.current = queueRef.current.filter((text) => text !== item.text);
                          setQueuedCount(queueRef.current.length);
                          setStaged((prev) => prev.filter((entry) => entry.id !== item.id));
                        }}
                        className="rounded p-1 dsh-label-caption dsh-interactive-danger"
                        title="Delete it"
                        aria-label="Delete this message"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Catalogue context, as chips you can take off again — the same shape as an attached file, so it
                reads as something the message carries rather than words in the box. */}
            {catalogue.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {catalogue.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-[10px] px-2.5 py-1 dsh-chip dsh-t-xs"
                    title={item.title}
                  >
                    <Package size={12} className="dsh-accent shrink-0" />
                    <span className="truncate">{item.title}</span>
                    <button
                      type="button"
                      onClick={() => setCatalogue((prev) => prev.filter((entry) => entry.id !== item.id))}
                      className="dsh-label-caption dsh-interactive-danger shrink-0"
                      aria-label={`Remove ${item.title}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <span className="dsh-t-xxxs dsh-label-caption">
                  sent as context for this message
                </span>
              </div>
            )}
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
              className="nobo-dock dsh-composer p-3.5 transition"
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
                  // Have a session ready before Enter is pressed — see prewarmSession.
                  prewarmSession();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  /**
                   * SAY WHICH ONE ENTER WILL DO.
                   *
                   * While a turn is running, Enter does not queue the message behind it — it STEERS
                   * the running task, because a correction that only lands after the work finishes
                   * has already cost the credits. That is by design and stays. The old placeholder
                   * said "Queued — sends when this run finishes" for both cases, so a message that
                   * had in fact been delivered to the running agent looked like it was waiting its
                   * turn, and an owner reading the box had no way to know which had happened.
                   */
                  isLoading && harness.runInProgress && logSessionId
                    ? 'Steering this run — Enter sends it at the next step'
                    : isLoading
                    ? 'Queued — sends when this run finishes'
                    : 'Ask Nobo anything…'
                }
                aria-label="Message the agent"
                rows={1}
                className="w-full resize-none bg-transparent outline-none dsh-t-base px-1 py-1 max-h-44"
                style={{ color: 'var(--dsw-alias-label-primary)' }}
              />

              <div className="flex items-center justify-between gap-2 pt-2.5 mt-1.5 dsh-border-t">
                <div className="flex items-center gap-1.5 sm:gap-2 text-xs">
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
                    className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-10 sm:h-10 rounded-full dsh-label-tertiary dsh-interactive flex items-center justify-center"
                    title="Attach file"
                    aria-label="Attach a file"
                  >
                    <Plus size={19} />
                  </button>

                  {/* The asset library, one tap from the composer. Until now the only way
                      in was the sidebar's Files item, which meant "attach the video I
                      already made" started by leaving the conversation. */}
                  <button
                    type="button"
                    onClick={() => setShowFileManager(true)}
                    className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-10 sm:h-10 rounded-full dsh-label-tertiary dsh-interactive flex items-center justify-center"
                    title="Pick from your asset library"
                    aria-label="Pick from your asset library"
                  >
                    <FolderOpen size={18} />
                  </button>

                  {/* Catalogue context. The agent can search the catalogue with a tool, but it has to
                      guess what to search for; pointing at the row you are already looking at is
                      unambiguous, and the id it carries is what every downstream tool keys on. */}
                  <button
                    type="button"
                    onClick={() => setCatalogueOpen(true)}
                    className="nobo-tap relative min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-10 sm:h-10 rounded-full dsh-label-tertiary dsh-interactive flex items-center justify-center"
                    title={catalogue.length ? catalogue.length + ' catalogue item(s) attached' : 'Attach catalogue items as context'}
                    aria-label="Attach catalogue items as context"
                  >
                    <Package size={18} />
                    {catalogue.length > 0 && (
                      <span
                        className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black text-white"
                        style={{ background: 'var(--dsw-alias-brand-primary)' }}
                      >
                        {catalogue.length}
                      </span>
                    )}
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
                    className="flex items-center gap-2 min-h-[44px] sm:min-h-9 px-3.5 dsh-t-xs dsh-strong transition"
                    style={{
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-secondary)',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      borderRadius: 'var(--dsh-radius-full)',
                    }}
                    title="Start a creative job — pick dimensions and a reference, then talk it through"
                  >
                    <Sparkles size={14} />
                    Create
                  </button>


                  {/* Permission mode — a status chip, not a control. There is no
                      permission-preset system wired yet, so this must not look
                      clickable. Hidden on phones: at 390px wide it wrapped onto
                      two lines and pushed the send button off the row. */}
                  <span
                    className="hidden sm:flex items-center gap-1 px-3 py-1.5 dsh-t-xs dsh-mono"
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

                <div className="flex items-center gap-2">
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
                    className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-9 sm:h-9 rounded-full dsh-btn flex items-center justify-center disabled:opacity-40"
                    title="Run in the background (survives closing this tab)"
                  >
                    <Rocket size={14} />
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
                      className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-9 sm:h-9 rounded-full dsh-btn-primary flex items-center justify-center"
                      title="Stop"
                    >
                      <Square size={13} className="fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={(!input.trim() && !attachedFile) || isUploading}
                      className="nobo-tap min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-9 sm:h-9 rounded-full dsh-btn-primary flex items-center justify-center"
                      title={isLoading ? 'Queue message (sends when the current turn finishes)' : 'Send'}
                    >
                      <Send size={14} />
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
                <span className="hidden sm:inline">Nobo AI can make mistakes.</span>
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
      {/* Catalogue context picker. The chosen items are appended to the message as a context line, so the
          owner can see exactly what was handed over and edit it like any other text  nothing is silently
          attached behind their back. */}
      <CataloguePicker
        open={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        selected={catalogue}
        impersonateId={impersonateId}
        onConfirm={(items) => {
          // Held as composer context, like an attachment. It used to be pasted into the text box, which
          // read as though the owner had typed "[Catalogue context: …]" themselves and left them editing
          // machine text instead of their own instruction.
          setCatalogue(items);
        }}
      />

      <FileManagerDrawer
        isOpen={showFileManager}
        onClose={() => setShowFileManager(false)}
        userId={impersonateId}
        onSelectAsset={(url, name) => {
          // Picked from the library: it becomes a real attachment, so the composer shows
          // what is going to be sent and the agent receives the URL in the same shape as a
          // freshly uploaded file. The textual reference stays as well — that line is what
          // tells the agent to USE the asset, not merely look at it.
          const isVideo = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(name) || /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(url);
          const isImage = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(name) || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(url);
          setAttachedFile({
            name,
            url,
            type: isVideo ? 'video' : isImage ? 'image' : 'file',
          });
          setInput((prev) => (prev ? `${prev} [Use Asset: ${name} (${url})]` : `Please use asset: ${name} (${url})`));
          toast.success(`Attached ${name} from your library`);
        }}
      />

      <CreatePanel open={createOpen} onClose={() => setCreateOpen(false)} onSend={handleSend} />
      <SkillsDrawer open={skillsOpen} onClose={() => setSkillsOpen(false)} impersonateId={impersonateId} />
    </div>
  );
}

