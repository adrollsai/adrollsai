'use client';

/**
 * Feed rows for the harness conversation.
 *
 * Extracted from AgentChat so that BOTH renderers share one implementation:
 * the live in-flight turn (AI-SDK message parts) and the replayed transcript
 * (projected harness items). Two copies of this is precisely how the two views
 * drift apart and start looking different.
 */
import { memo, useState } from 'react';
import { BrainCircuit, Film, Image as ImageIcon, Loader2, MessageSquare, Mic } from 'lucide-react';
import ActionConfirmationCard from './ActionConfirmationCard';
import { resolveToolPresentation, summarizeToolInput } from '@/lib/agent/presentation';

// DeepSeek Harness Feed Row for Thinking
function ThinkFeedRowInner({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const clean = text.replace(/<\/?think>/g, '').trim();
  if (!clean) return null;
  const isLong = clean.length > 120;
  const displayText = expanded || !isLong ? clean : clean.slice(0, 120) + '...';

  return (
    <div
      onClick={() => isLong && setExpanded(!expanded)}
      className={`group flex items-start gap-2 dsh-t-s py-1 px-2 rounded-[8px] transition select-text ${
        isLong ? 'cursor-pointer' : ''
      }`}
      style={{ color: 'var(--dsw-alias-label-tertiary)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="shrink-0 mt-[3px]">
        <BrainCircuit size={14} />
      </div>
      <div className="flex-1 min-w-0 leading-relaxed">
        <span className="dsh-strong" style={{ color: 'var(--dsw-alias-label-secondary)' }}>Thinking</span>
        <span className="mx-1.5" style={{ color: 'var(--dsw-alias-label-caption)' }}>·</span>
        <span className="italic">{displayText}</span>
        {isLong && (
          <span
            className="ml-1.5 dsh-t-xs"
            style={{ color: 'var(--dsw-alias-state-business-primary)' }}
          >
            {expanded ? 'less' : 'more'}
          </span>
        )}
      </div>
    </div>
  );
}

// DeepSeek Harness Feed Row for Tool Call
function ToolFeedRowInner({ tool, isLoading, onOptionSelect }: { tool: any; isLoading: boolean; onOptionSelect?: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  if (!tool || typeof tool !== 'object') return null;

  // AI SDK puts invocation inside toolInvocation
  const invocation = tool.toolInvocation || tool;
  const rawToolName =
    invocation.toolName ||
    tool.toolName ||
    (typeof tool.type === 'string' && tool.type.startsWith('tool-') ? tool.type.slice(5) : 'tool');
  const safeToolName = String(rawToolName || 'tool');

  const output =
    invocation.result !== undefined
      ? invocation.result
      : tool.output !== undefined
      ? tool.output
      : tool.result;
  const inputArgs =
    invocation.args !== undefined ? invocation.args : tool.input !== undefined ? tool.input : tool.args;

  // Tool is only pending if it is in call state or output is undefined while stream is loading
  const isPending =
    invocation.state === 'call' ||
    invocation.state === 'partial-call' ||
    (output === undefined && isLoading);
  const isError = Boolean(output && (output.error || output.success === false));

  // Presentation is data, not a chain of if/else — see lib/agent/presentation.tsx.
  // Unknown tools degrade to a generic row that still shows their real name.
  const { presentation } = resolveToolPresentation(safeToolName);
  const Icon = presentation.icon;
  const prefix = presentation.label;
  const summary = summarizeToolInput(presentation, inputArgs);

  const artifact = output?.artifact || (output?.actionPayload && output?.requiresApproval ? {
    type: 'action_confirmation',
    actionType: output.actionPayload.actionType,
    title: output.actionPayload.title,
    description: output.actionPayload.description,
    estimatedCost: output.actionPayload.estimatedCost,
    payload: output.actionPayload.payload,
  } : null);

  return (
    <div className="space-y-1">
      <div
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center justify-between dsh-t-s py-1.5 px-2 rounded-[8px] cursor-pointer transition select-none"
        style={{ color: 'var(--dsw-alias-label-secondary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className="shrink-0" style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
          <span className="dsh-strong shrink-0">{prefix}</span>
          {summary && (
            <>
              <span className="shrink-0" style={{ color: 'var(--dsw-alias-label-caption)' }}>·</span>
              <span className="dsh-mono dsh-t-xs truncate" style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
                {summary}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {isPending ? (
            <span
              className="flex items-center gap-1.5 dsh-t-xs"
              style={{ color: 'var(--dsw-alias-label-tertiary)' }}
            >
              <Loader2 size={12} className="animate-spin" />
              running
            </span>
          ) : isError ? (
            <span
              className="flex items-center gap-1.5 dsh-t-xs dsh-strong"
              style={{ color: 'var(--dsw-alias-state-error-primary)' }}
            >
              <span
                className="inline-block rounded-full"
                style={{ width: 6, height: 6, background: 'var(--dsw-alias-state-error-primary)' }}
              />
              failed
            </span>
          ) : (
            <span
              className="inline-block rounded-full"
              style={{ width: 6, height: 6, background: 'var(--dsw-alias-state-success-primary)' }}
              title="done"
            />
          )}
        </div>
      </div>

      {expanded && (
        <div
          className="ml-5 p-3 dsh-mono dsh-t-xs space-y-2 max-h-56 overflow-y-auto"
          style={{
            background: 'var(--dsw-alias-markdown-code-block)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 'var(--dsh-radius-md)',
            color: 'var(--dsw-alias-label-secondary)',
          }}
        >
          {inputArgs && (
            <div>
              <span className="dsh-label-caption dsh-t-xxxs uppercase dsh-strong block mb-0.5">Input:</span>
              <pre className="dsh-label-secondary whitespace-pre-wrap">{JSON.stringify(inputArgs, null, 2)}</pre>
            </div>
          )}
          {output && (
            <div className="dsh-border-t pt-1.5">
              <span className="dsh-label-caption dsh-t-xxxs uppercase dsh-strong block mb-0.5">Output:</span>
              <pre className="dsh-label-secondary whitespace-pre-wrap">{JSON.stringify(output, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Render Playable Video Artifact */}
      {artifact && artifact.type === 'video_player' && (
        <div className="my-3 overflow-hidden rounded-[12px] dsh-border bg-black max-w-sm">
          <div className="flex items-center justify-between px-3.5 py-2 dsh-surface-3 dsh-border-b dsh-t-xs dsh-label-secondary">
            <span className="dsh-strong flex items-center gap-1.5 dsh-accent">
              <Film size={14} />
              {artifact.title || 'Rendered Video'}
            </span>
            {artifact.duration && (
              <span className="dsh-t-xxxs dsh-chip px-2 py-0.5 rounded-full dsh-mono">
                {artifact.duration}
              </span>
            )}
          </div>
          <div className="p-2 flex justify-center bg-black">
            <video
              src={artifact.videoUrl}
              controls
              playsInline
              className="max-h-[380px] rounded-[8px]"
            />
          </div>
        </div>
      )}

      {/* Render Image Artifact */}
      {artifact && artifact.type === 'image_preview' && (
        <div className="my-3 overflow-hidden rounded-[12px] dsh-border bg-black max-w-sm">
          <div className="flex items-center justify-between px-3.5 py-2 dsh-surface-3 dsh-border-b dsh-t-xs dsh-label-secondary">
            <span className="dsh-strong flex items-center gap-1.5 dsh-accent">
              <ImageIcon size={14} />
              {artifact.title || 'Generated Image'}
            </span>
            <a
              href={artifact.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="dsh-t-xxxs dsh-label-tertiary dsh-interactive"
            >
              Open Full
            </a>
          </div>
          <div className="p-2 flex justify-center bg-black">
            <img
              src={artifact.imageUrl}
              alt={artifact.title || 'Generated Image'}
              className="max-h-[380px] rounded-[8px] object-contain"
            />
          </div>
        </div>
      )}

      {/* Render Playable Audio Artifact (voiceover / narration) */}
      {artifact && artifact.type === 'audio_player' && (
        <div className="my-3 overflow-hidden rounded-[12px] dsh-border dsh-surface-2 max-w-sm">
          <div className="flex items-center justify-between px-3.5 py-2 dsh-surface-3 dsh-border-b dsh-t-xs dsh-label-secondary">
            <span className="dsh-strong flex items-center gap-1.5 dsh-accent">
              <Mic size={14} />
              {artifact.title || 'Voiceover'}
            </span>
            <a
              href={artifact.audioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="dsh-t-xxxs dsh-label-tertiary dsh-interactive"
            >
              Download
            </a>
          </div>
          <div className="p-2.5 space-y-2">
            <audio src={artifact.audioUrl} controls preload="metadata" className="w-full" />
            {artifact.transcript && (
              <p className="dsh-t-xs dsh-label-tertiary italic leading-relaxed line-clamp-3">
                {artifact.transcript}
              </p>
            )}
          </div>
        </div>
      )}

      {artifact && artifact.type === 'whatsapp_preview' && (
        <div className="my-2 max-w-sm rounded-[12px] dsh-border dsh-surface-2 p-3">
          <div className="dsh-t-xs dsh-strong dsh-success mb-1 flex items-center gap-1">
            <MessageSquare size={12} />
            <span>WhatsApp Template ({artifact.templateName})</span>
          </div>
          <div className="rounded-[8px] dsh-surface-3 p-3 space-y-2 dsh-t-xs">
            {artifact.header && <p className="dsh-strong dsh-label-primary">{artifact.header}</p>}
            <p className="whitespace-pre-wrap dsh-label-primary">{artifact.body}</p>
            {artifact.footer && <p className="dsh-t-xxxs dsh-label-tertiary">{artifact.footer}</p>}
          </div>
        </div>
      )}

      {artifact && artifact.type === 'action_confirmation' && (
        <ActionConfirmationCard artifact={artifact as any} />
      )}

      {artifact && artifact.type === 'user_input_prompt' && (
        <div className="my-2 max-w-md rounded-[12px] dsh-border dsh-surface-2 p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 dsh-t-xs dsh-strong dsh-accent">
            <span className="w-2 h-2 rounded-full dsh-accent-bg animate-ping" />
            <span>Agent Input Request</span>
          </div>
          <p className="dsh-t-s dsh-label-primary dsh-strong">{artifact.question}</p>
          {artifact.context && (
            <p className="dsh-t-xs dsh-label-tertiary italic">{artifact.context}</p>
          )}
          {artifact.suggestedOptions && artifact.suggestedOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {artifact.suggestedOptions.map((opt: string, i: number) => (
                <button
                  key={i}
                  onClick={() => onOptionSelect && onOptionSelect(opt)}
                  className="px-2.5 py-1 rounded-full dsh-chip dsh-interactive dsh-t-xs"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Safely render a single message — if anything throws, show a fallback instead of crashing

/**
 * Memoised: the chat re-renders on every streamed token, so rows whose props
 * have not changed must not re-render. In the log view the projected item
 * objects keep their identity, so this actually short-circuits.
 */
export const ThinkFeedRow = memo(ThinkFeedRowInner);
export const ToolFeedRow = memo(ToolFeedRowInner);
