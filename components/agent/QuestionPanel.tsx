'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, X, CornerDownLeft, Sparkles, Check } from 'lucide-react';
import { NoboOrb } from './NoboMascot';

/**
 * The agent's question, docked above the composer.
 *
 * Before this, `request_user_input` printed a small card in the middle of the
 * transcript and the user had to scroll to it, read it, and type a reply into the
 * composer — while the answer was usually one of two or three obvious choices.
 * This turns it into the thing it should be: a prompt that comes to you, offers
 * the likely answers as buttons, still lets you type your own, lets you skip, and
 * steps through several questions without a round trip each.
 *
 * Accessibility notes (these are load-bearing, not decoration):
 *  - a real dialog with `role="dialog"` and `aria-modal="false"` (it is not modal:
 *    the transcript behind it stays readable),
 *  - options are buttons with 44px minimum height, numbered so they can be picked
 *    from the keyboard with 1..9,
 *  - Escape dismisses, Enter submits the typed answer,
 *  - focus moves to the panel when it appears so a keyboard user is not left
 *    behind in the composer.
 */

export interface QuestionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface QuestionItem {
  question: string;
  context?: string;
  options: QuestionOption[];
}

export interface QuestionPayload {
  id: string;
  questions: QuestionItem[];
}

interface QuestionPanelProps {
  payload: QuestionPayload;
  disabled?: boolean;
  onSubmit: (answer: string) => void;
  onSkip: () => void;
}

/** Normalise whatever the tool sent into a list of questions. */
export function normalizeQuestions(artifact: any): QuestionPayload | null {
  if (!artifact || typeof artifact !== 'object') return null;

  const list: QuestionItem[] = [];

  if (Array.isArray(artifact.questions)) {
    for (const q of artifact.questions) {
      if (!q || typeof q !== 'object') continue;
      const question = String(q.question || q.prompt || '').trim();
      if (!question) continue;
      const rawOptions = Array.isArray(q.options) ? q.options : Array.isArray(q.suggestedOptions) ? q.suggestedOptions : [];
      list.push({
        question,
        context: q.context ? String(q.context) : undefined,
        options: toOptions(rawOptions),
      });
    }
  }

  if (list.length === 0) {
    const question = String(artifact.question || artifact.prompt || '').trim();
    if (!question) return null;
    list.push({
      question,
      context: artifact.context ? String(artifact.context) : undefined,
      options: toOptions(artifact.suggestedOptions),
    });
  }

  const id = String(artifact.inputRequestId || artifact.actionId || list.map((q) => q.question).join('|'));
  return { id, questions: list };
}

function toOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o, i) => {
      if (typeof o === 'string') {
        return { label: o, recommended: i === 0 } as QuestionOption;
      }
      if (o && typeof o === 'object') {
        const anyO = o as any;
        const label = String(anyO.label || anyO.value || anyO.title || '').trim();
        if (!label) return null;
        return {
          label,
          description: anyO.description ? String(anyO.description) : undefined,
          recommended: Boolean(anyO.recommended),
        } as QuestionOption;
      }
      return null;
    })
    .filter(Boolean) as QuestionOption[];
}

export default function QuestionPanel({ payload, disabled = false, onSubmit, onSkip }: QuestionPanelProps) {
  const total = payload.questions.length;
  const [index, setIndex] = React.useState(0);
  const [custom, setCustom] = React.useState('');
  const [answers, setAnswers] = React.useState<Record<number, string>>({});
  const [touched, setTouched] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // A new question set resets the walkthrough.
  React.useEffect(() => {
    setIndex(0);
    setCustom('');
    setAnswers({});
    setTouched(false);
  }, [payload.id]);

  React.useEffect(() => {
    panelRef.current?.focus();
  }, [payload.id]);

  const current = payload.questions[Math.min(index, total - 1)];
  const selected = answers[index];

  const record = (value: string) => {
    setAnswers((prev) => ({ ...prev, [index]: value }));
    setCustom('');
    setTouched(false);
  };

  const advanceOrSubmit = () => {
    const answer = answers[index];
    if (!answer) return;
    if (index < total - 1) {
      setIndex(index + 1);
      return;
    }
    // One message with every answer, labelled so the agent can tell them apart.
    const text =
      total === 1
        ? answer
        : payload.questions
            .map((q, i) => `${i + 1}. ${q.question}\n   → ${answers[i] || '(skipped)'}`)
            .join('\n');
    onSubmit(text);
  };

  const submitCustom = () => {
    const value = custom.trim();
    if (!value) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    record(value);
    // Typing the answer and pressing Enter should move on immediately.
    if (index < total - 1) {
      setIndex(index + 1);
    } else {
      const next = { ...answers, [index]: value };
      const text =
        total === 1
          ? value
          : payload.questions.map((q, i) => `${i + 1}. ${q.question}\n   → ${next[i] || '(skipped)'}`).join('\n');
      onSubmit(text);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSkip();
      return;
    }
    // 1..9 pick an option without reaching for the mouse.
    const n = Number(e.key);
    if (!e.metaKey && !e.ctrlKey && Number.isInteger(n) && n >= 1 && n <= current.options.length) {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT') return; // typing digits into the answer field
      e.preventDefault();
      record(current.options[n - 1].label);
      if (index < total - 1) setIndex(index + 1);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={total > 1 ? `Question ${index + 1} of ${total}` : 'A question from the agent'}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="nobo-question mb-2 outline-none"
    >
      {/* header */}
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <NoboOrb size="xs" state="talking" />
        <div className="min-w-0 flex-1">
          <p className="dsh-t-xxxs dsh-mono uppercase tracking-wider" style={{ color: 'var(--dsw-alias-label-caption)' }}>
            {total > 1 ? `Question ${index + 1} of ${total}` : 'One quick question'}
          </p>
          <p className="mt-0.5 dsh-t-s dsh-strong" style={{ color: 'var(--dsw-alias-label-primary)' }}>
            {current.question}
          </p>
          {current.context && (
            <p className="mt-1 dsh-t-xs" style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
              {current.context}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip this question"
          title="Skip"
          className="nobo-icon-btn shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* options */}
      {current.options.length > 0 && (
        <div className="px-4 pt-3 space-y-1.5">
          {current.options.map((opt, i) => {
            const isSelected = selected === opt.label;
            return (
              <button
                key={`${opt.label}_${i}`}
                type="button"
                disabled={disabled}
                onClick={() => {
                  record(opt.label);
                  if (index < total - 1) setIndex(index + 1);
                }}
                aria-pressed={isSelected}
                className="nobo-option"
                data-selected={isSelected ? 'true' : 'false'}
              >
                <span className="nobo-option-index" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="nobo-option-label">
                    {opt.label}
                    {opt.recommended && !isSelected && (
                      <span className="nobo-option-badge">
                        <Sparkles size={10} /> Suggested
                      </span>
                    )}
                  </span>
                  {opt.description && <span className="nobo-option-desc">{opt.description}</span>}
                </span>
                {isSelected && (
                  <span className="nobo-option-check" aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* free text */}
      <div className="px-4 pt-3">
        <div className="nobo-question-input">
          <input
            ref={inputRef}
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              if (touched) setTouched(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitCustom();
              }
            }}
            placeholder={current.options.length ? 'Or type your own answer…' : 'Type your answer…'}
            aria-label="Your answer"
            aria-invalid={touched || undefined}
            className="nobo-question-field"
          />
          <CornerDownLeft size={14} aria-hidden="true" style={{ color: 'var(--dsw-alias-label-caption)' }} />
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <button type="button" onClick={onSkip} className="nobo-question-skip">
            Skip this question
          </button>
          {total > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIndex(Math.max(0, index - 1))}
                disabled={index === 0}
                aria-label="Previous question"
                className="nobo-icon-btn"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="dsh-t-xxs dsh-mono" style={{ color: 'var(--dsw-alias-label-caption)' }}>
                {index + 1}/{total}
              </span>
              <button
                type="button"
                onClick={() => setIndex(Math.min(total - 1, index + 1))}
                disabled={index >= total - 1}
                aria-label="Next question"
                className="nobo-icon-btn"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={advanceOrSubmit}
          disabled={disabled || !selected}
          className="nobo-question-submit"
        >
          {index < total - 1 ? 'Next' : 'Send answer'}
        </button>
      </div>
    </div>
  );
}
