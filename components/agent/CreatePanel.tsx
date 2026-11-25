'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Sparkles, ImageIcon, Film, Mic, Shuffle, Check, Loader2 } from 'lucide-react';
import { buildCreateIntent } from '@/lib/agent/create-intent';

/**
 * Create — a compact panel that opens above the composer.
 *
 * Design rules applied here, from published guidance rather than taste:
 *  • NN/g: a centred modal with a scrim is for a decision that blocks the flow. Creating
 *    something is a *workspace*, not an interruption — so this is an anchored sheet with
 *    no scrim, and the conversation stays visible behind it.
 *  • One surface, one border, one shadow. The previous version stacked bordered cards
 *    inside a bordered card, which is what made it look unfinished.
 *  • 8px spacing grid, 4px radius scale, and exactly one primary action.
 *  • Selection is shown with a neutral filled state and a tick — never by tinting a card
 *    in a *success* colour, which reads as validation, not selection. That green halo on
 *    "Image creative" was a semantic-token mistake, not a styling opinion.
 *  • Keyboard focus uses :focus-visible only, so clicking never paints an outline.
 */

type Kind = 'image' | 'video' | 'voiceover';

interface Template {
  id: string;
  name: string;
  category: string;
  thumb: string;
}

const KINDS: Array<{ id: Kind; label: string; hint: string; icon: any }> = [
  { id: 'image', label: 'Image', hint: 'poster, ad still', icon: ImageIcon },
  { id: 'video', label: 'Video', hint: 'script, voice, b-roll', icon: Film },
  { id: 'voiceover', label: 'Voiceover', hint: 'narration only', icon: Mic },
];

const RATIOS: Record<Kind, string[]> = {
  image: ['4:5', '9:16', '1:1', '16:9'],
  video: ['9:16', '16:9', '1:1'],
  voiceover: [],
};

const S = {
  surface: 'var(--dsw-alias-bg-layer-1)',
  raised: 'var(--dsw-alias-bg-layer-2)',
  line: 'var(--dsw-alias-border-l1)',
  text: 'var(--dsw-alias-label-primary)',
  muted: 'var(--dsw-alias-label-tertiary)',
  accent: 'var(--dsw-alias-state-success-primary)',
};

export default function CreatePanel({
  open,
  onClose,
  onSend,
  businessName,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  businessName?: string;
}) {
  const [kind, setKind] = useState<Kind>('image');
  const [ratio, setRatio] = useState('9:16');
  const [resolution, setResolution] = useState<'480p' | '720p'>('720p');
  const [seconds, setSeconds] = useState(15);
  const [refMode, setRefMode] = useState<'random' | 'pick' | 'none'>('random');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    if (!open || templates.length) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/agent/reference-templates');
        const data = await res.json();
        if (alive) setTemplates(Array.isArray(data.templates) ? data.templates : []);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [open, templates.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const chosen = useMemo(() => templates.find((t) => t.id === templateId) || null, [templates, templateId]);

  if (!open) return null;

  const submit = () => {
    onSend(
      buildCreateIntent({
        kind,
        ratio,
        resolution,
        seconds,
        refMode,
        reference: chosen ? { id: chosen.id, name: chosen.name, category: chosen.category } : null,
        brief,
        businessName,
      })
    );
    onClose();
  };

  const segment = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 8px',
    borderRadius: 8,
    border: `1px solid ${active ? S.text : S.line}`,
    background: active ? S.text : 'transparent',
    color: active ? S.surface : S.text,
    transition: 'all 120ms ease',
  });

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    borderRadius: 999,
    border: `1px solid ${active ? S.text : S.line}`,
    background: active ? S.raised : 'transparent',
    color: active ? S.text : S.muted,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '18px',
  });

  return (
    <div
      className="fixed z-[75] left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-24px))]"
      style={{ bottom: 104 }}
      role="dialog"
      aria-label="Create something"
    >
      <div
        style={{
          background: S.raised,
          border: `1px solid ${S.line}`,
          borderRadius: 14,
          boxShadow: '0 18px 50px -12px rgba(0,0,0,0.28)',
          maxHeight: 'min(64vh, 620px)',
          overflowY: 'auto',
        }}
      >
        {/* header */}
        <div className="flex items-center justify-between" style={{ padding: '14px 16px 0' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Sparkles size={15} style={{ color: S.text }} />
            <span style={{ fontSize: 14, fontWeight: 650, color: S.text }}>Create</span>
          </div>
          <button
            onClick={onClose}
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ padding: 4, borderRadius: 6, color: S.muted }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'grid', gap: 16 }}>
          {/* what */}
          <div style={{ display: 'flex', gap: 8 }}>
            {KINDS.map((k) => {
              const Icon = k.icon;
              const active = kind === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => {
                    setKind(k.id);
                    setRatio(RATIOS[k.id][0] || '');
                  }}
                  style={segment(active)}
                  aria-pressed={active}
                >
                  <div className="flex flex-col items-center" style={{ gap: 3 }}>
                    <Icon size={15} />
                    <span style={{ fontSize: 12.5, fontWeight: 650 }}>{k.label}</span>
                    <span style={{ fontSize: 10.5, opacity: active ? 0.75 : 0.6 }}>{k.hint}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* size */}
          {RATIOS[kind].length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <Label>Size</Label>
              <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
                {RATIOS[kind].map((r) => (
                  <button key={r} onClick={() => setRatio(r)} style={chip(ratio === r)} aria-pressed={ratio === r}>
                    {r}
                  </button>
                ))}
                {kind === 'video' && (
                  <>
                    <span style={{ width: 1, height: 18, background: S.line, margin: '0 2px' }} />
                    {(['480p', '720p'] as const).map((r) => (
                      <button key={r} onClick={() => setResolution(r)} style={chip(resolution === r)}>
                        {r}
                      </button>
                    ))}
                    <span style={{ fontSize: 12, color: S.muted, marginLeft: 2 }}>{seconds}s</span>
                  </>
                )}
              </div>
              {kind === 'video' && (
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={5}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                  style={{ width: '100%', accentColor: S.accent }}
                  aria-label="Duration"
                />
              )}
            </div>
          )}

          {/* reference */}
          {kind !== 'voiceover' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <Label>Reference</Label>
              <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
                <button onClick={() => setRefMode('random')} style={chip(refMode === 'random')}>
                  <span className="inline-flex items-center" style={{ gap: 5 }}>
                    <Shuffle size={11} /> Pick for me
                  </span>
                </button>
                <button onClick={() => setRefMode('pick')} style={chip(refMode === 'pick')}>
                  Choose one
                </button>
                <button onClick={() => setRefMode('none')} style={chip(refMode === 'none')}>
                  Brand only
                </button>
              </div>

              {refMode === 'pick' && (
                <div
                  className="grid grid-cols-5"
                  style={{ gap: 6, maxHeight: 148, overflowY: 'auto', paddingRight: 2 }}
                >
                  {templates.length === 0 && (
                    <span className="col-span-5 inline-flex items-center" style={{ gap: 6, fontSize: 12, color: S.muted }}>
                      <Loader2 size={12} className="animate-spin" /> loading catalogue
                    </span>
                  )}
                  {templates.map((t) => {
                    const active = templateId === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTemplateId(t.id)}
                        title={`${t.name} · ${t.category}`}
                        style={{
                          position: 'relative',
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: `2px solid ${active ? S.text : 'transparent'}`,
                        }}
                      >
                        <img src={t.thumb} alt={t.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover' }} />
                        {active && (
                          <span
                            className="absolute inline-flex items-center justify-center"
                            style={{ top: 4, right: 4, width: 16, height: 16, borderRadius: 999, background: S.text }}
                          >
                            <Check size={10} style={{ color: S.surface }} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* brief */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>Brief <span style={{ textTransform: 'none', letterSpacing: 0, color: S.muted }}>optional</span></Label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={2}
              placeholder="Diwali offer, 3BHK in Mohali, under 1.2 crore, Hinglish voice"
              style={{
                width: '100%',
                resize: 'none',
                padding: '9px 11px',
                background: S.surface,
                border: `1px solid ${S.line}`,
                borderRadius: 8,
                color: S.text,
                fontSize: 13,
                lineHeight: '19px',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* footer */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '12px 16px', borderTop: `1px solid ${S.line}`, gap: 12 }}
        >
          <span style={{ fontSize: 11.5, color: S.muted, lineHeight: '16px' }}>
            Nothing is charged until you approve the plan.
          </span>
          <button
            onClick={submit}
            disabled={refMode === 'pick' && !templateId}
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              background: S.text,
              color: S.surface,
              fontSize: 13,
              fontWeight: 650,
              opacity: refMode === 'pick' && !templateId ? 0.45 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--dsw-alias-label-tertiary)',
      }}
    >
      {children}
    </span>
  );
}
