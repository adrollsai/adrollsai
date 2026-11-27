'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, Palette, Plus, Save, Sparkles, Trash2 } from 'lucide-react';

/**
 * BRAND KIT — the page the owner went looking for and could not find.
 *
 * It shows and edits exactly what the image pipeline obeys: an ordered PALETTE (hex + role), and free-text rules. The
 * palette exists because a real brand is not one colour — one client's is scarlet primary, charcoal, wisteria blue,
 * off-white, with logo accents allowed only as thin stripes, balanced roughly 60/25/15. A single swatch could not express
 * that, and "still not taking the brand guidelines" was the result.
 *
 * Everything saved here lands in `creative_directives` on the active playbook, which is the single place
 * `lib/automation/creative-directives` enforces and every generation path reads (agent image tool, agent composer, and the
 * Creation tab). An account with nothing set produces no brand rule at all — no invented styling.
 */
interface PaletteEntry {
  hex: string;
  role: string;
}

interface BrandKit {
  brandColor: string;
  logoUrl: string;
  businessName: string;
  palette: PaletteEntry[];
  rulesText: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

export default function BrandKitPage() {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[]>([{ hex: '#0F172A', role: 'primary' }]);
  const [rules, setRules] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/profile/brand-kit', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load the brand kit');
      setKit(data);
      setPalette(
        Array.isArray(data.palette) && data.palette.length
          ? data.palette
          : [{ hex: data.brandColor || '#0F172A', role: 'primary' }]
      );
      setRules(data.rulesText || '');
    } catch (err: any) {
      setError(err?.message || 'Could not load the brand kit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (index: number, patch: Partial<PaletteEntry>) =>
    setPalette((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));

  const addColour = () =>
    setPalette((prev) => (prev.length >= 8 ? prev : [...prev, { hex: '#FFFFFF', role: prev.length === 0 ? 'primary' : 'accent' }]));

  const removeColour = (index: number) =>
    setPalette((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const cleaned = palette
        .map((entry) => ({ hex: String(entry.hex || '').trim().toUpperCase(), role: String(entry.role || '').trim() }))
        .filter((entry) => HEX.test(entry.hex));

      if (!cleaned.length) throw new Error('Add at least one colour (like #E13C3C) before saving.');

      const res = await fetch('/api/profile/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ palette: cleaned, rulesText: rules, brandColor: cleaned[0].hex }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save');
      setSaved(true);
      void load();
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/profile" className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 transition">
            <ArrowLeft size={16} className="text-slate-600" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Palette size={18} className="text-indigo-600" /> Brand Kit
            </h1>
            <p className="text-xs font-semibold text-slate-500">
              What the AI follows for every image and video{kit?.businessName ? ` — ${kit.businessName}` : ''}. Used by the
              agent and by the Creation tab.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 flex items-center justify-center gap-2 text-slate-500">
            <Loader2 className="animate-spin" size={16} /> Loading your brand kit…
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold rounded-2xl p-4">{error}</div>
            )}

            {/* 1. Palette */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black text-slate-900">Palette</h2>
                  <p className="text-xs text-slate-500 font-medium">
                    The first colour is the primary. Give each one its job — “primary accent, CTAs”, “dark backgrounds”,
                    “accents only as thin stripes”.
                  </p>
                </div>
                <button
                  onClick={addColour}
                  disabled={palette.length >= 8}
                  className="shrink-0 inline-flex items-center gap-1 px-3 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-bold text-slate-700"
                >
                  <Plus size={13} /> Add colour
                </button>
              </div>

              <div className="space-y-2">
                {palette.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={HEX.test(entry.hex) ? entry.hex : '#000000'}
                      onChange={(e) => update(index, { hex: e.target.value.toUpperCase() })}
                      className="h-10 w-12 rounded-lg border border-slate-200 bg-white cursor-pointer"
                      aria-label={`Colour ${index + 1}`}
                    />
                    <input
                      value={entry.hex}
                      onChange={(e) => update(index, { hex: e.target.value.toUpperCase() })}
                      placeholder="#E13C3C"
                      className="h-10 px-2 w-28 rounded-lg border border-slate-200 text-xs font-bold text-slate-800 bg-white"
                    />
                    <input
                      value={entry.role}
                      onChange={(e) => update(index, { role: e.target.value })}
                      placeholder={index === 0 ? 'primary accent, CTAs' : 'secondary / accent / background'}
                      className="h-10 px-3 flex-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 bg-white"
                    />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 w-14 text-center">
                      {index === 0 ? 'primary' : `colour ${index + 1}`}
                    </span>
                    <button
                      onClick={() => removeColour(index)}
                      disabled={palette.length <= 1}
                      className="p-2 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-40"
                      aria-label="Remove colour"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-1 h-3 rounded-full overflow-hidden border border-slate-200">
                {palette.filter((entry) => HEX.test(entry.hex)).map((entry, i) => (
                  <div key={i} className="flex-1" style={{ backgroundColor: entry.hex }} />
                ))}
              </div>
            </section>

            {/* 2. Rules */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Sparkles size={15} className="text-indigo-600" /> Brand rules
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                One rule per line, in your own words. These are enforced on every image and video.
              </p>
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={6}
                placeholder={'About 60% neutral, 25% primary, 15% secondary\nAccent colours only as thin stripes\nHeadlines heavy condensed, tight tracking\nNo gradients on text, no neon, no stock handshakes'}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-800 leading-relaxed"
              />
              <p className="text-[11px] text-slate-400 font-semibold">Up to 20 rules. Blank lines are ignored.</p>
            </section>

            <div className="flex items-center gap-3">
              <button
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-bold transition"
              >
                {saving ? <Loader2 className="animate-spin" size={15} /> : saved ? <Check size={15} /> : <Save size={15} />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save brand kit'}
              </button>
              <span className="text-[11px] font-semibold text-slate-500">
                {palette.filter((e) => HEX.test(e.hex)).length} colour(s)
                {rules.trim() ? ` · ${rules.split('\n').filter((l) => l.trim()).length} rule(s)` : ''}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
