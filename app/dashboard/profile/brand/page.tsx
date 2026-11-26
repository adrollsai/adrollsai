'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, Palette, Save, Sparkles } from 'lucide-react';

/**
 * BRAND KIT — the page the owner went looking for and could not find.
 *
 * It shows the two things the image pipeline actually obeys, and lets them be edited:
 *   1. brand colour (profiles.brand_color) — drives the palette
 *   2. standing rules, one per line — stored as `creative_directives` on the active playbook, which
 *      lib/automation/creative-directives enforces and generate_ai_image now reads
 *
 * Catalogue images are deliberately absent: they belong to a listing (a course, a product), not to the brand. The agent
 * passes them as references when it makes a creative ABOUT that item, which is a different job.
 *
 * Kept as its own light-theme page so it cannot destabilise the very large profile page.
 */
interface BrandKit {
  brandColor: string;
  logoUrl: string;
  businessName: string;
  rulesText: string;
  activeSources: string[];
}

export default function BrandKitPage() {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [color, setColor] = useState('#0F172A');
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
      setColor(data.brandColor || '#0F172A');
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

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/profile/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandColor: color, rulesText: rules }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save');
      setSaved(true);
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
              What the AI copies when it makes your images and videos{kit?.businessName ? ` — ${kit.businessName}` : ''}
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

            {/* 1. Colour */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-black text-slate-900">Brand colour</h2>
              <p className="text-xs text-slate-500 font-medium">
                This drives the palette of every generated image — accents, overlays and type highlights.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#0F172A'}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  className="h-11 w-14 rounded-xl border border-slate-200 bg-white cursor-pointer"
                  aria-label="Brand colour"
                />
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  placeholder="#0F172A"
                  className="h-11 px-3 w-40 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 bg-white"
                />
                <div className="h-11 flex-1 rounded-xl border border-slate-200" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? color : '#0F172A' }} />
              </div>
            </section>

            {/* 2. Rules */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Sparkles size={15} className="text-indigo-600" /> Brand rules
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                One rule per line, in your own words. These are enforced on every generated image.
              </p>
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={6}
                placeholder={'Always use navy and gold\nNever use stock photos of people\nNo gradients on text\nKeep the logo top-left'}
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
              {kit?.activeSources?.length ? (
                <span className="text-[11px] font-semibold text-slate-500">
                  In use right now: {kit.activeSources.join(' · ')}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
