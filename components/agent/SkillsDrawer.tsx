'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, BookOpen, Upload, Trash2, Check, Loader2, Power } from 'lucide-react';

/**
 * Skills, managed from inside the agent instead of a separate page.
 *
 * A skill is a written procedure the business owns — listing style, qualification
 * script, brand voice. The one-line description rides in every prompt; the body is
 * fetched only when the task matches, so twenty skills cost twenty sentences, not
 * twenty documents.
 *
 * Same API as /dashboard/skills; this is the drawer the agent tab shows so a user can
 * teach it something without leaving the conversation.
 */

interface Skill {
  id: string;
  name: string;
  description: string;
  source_filename: string | null;
  enabled: boolean;
  updated_at: string;
}

export default function SkillsDrawer({
  open,
  onClose,
  impersonateId,
}: {
  open: boolean;
  onClose: () => void;
  impersonateId?: string | null;
}) {
  // The account whose skills these are: a super admin inspecting a tenant reaches
  // the agent tab with ?impersonate=<uuid> and every call below must carry it.
  const impParam = impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : '';
  const impQuery = impersonateId ? `&impersonate=${encodeURIComponent(impersonateId)}` : '';
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent/skills${impParam}`);
      const data = await res.json();
      if (data.needsMigration) setNeedsMigration(true);
      setSkills(data.skills || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load skills');
    } finally {
      setLoading(false);
    }
  }, [impParam]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file');
    if (file instanceof File && !file.size) form.delete('file');
    const hasFile = form.get('file') instanceof File;
    const hasText = String(form.get('content') || '').trim().length > 0;
    if (!hasFile && !hasText) {
      setError('Pick a file or paste the procedure text.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (impersonateId && !form.get('impersonate')) form.append('impersonate', impersonateId);
      const res = await fetch(`/api/agent/skills${impParam}`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setNotice(`Saved "${data.name}" — the agent uses it from your next message.`);
      if (fileRef.current) fileRef.current.value = '';
      (e.target as HTMLFormElement).reset();
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(skill: Skill) {
    setBusy(true);
    try {
      await fetch(`/api/agent/skills${impParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: skill.id, enabled: !skill.enabled, impersonate: impersonateId || undefined }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setTimeout(() => setPendingDelete((p) => (p === id ? null : p)), 5000);
      return;
    }
    setPendingDelete(null);
    setBusy(true);
    try {
      await fetch(`/api/agent/skills?id=${encodeURIComponent(id)}${impQuery}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const field = {
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: 'var(--dsh-radius-sm)',
    color: 'var(--dsw-alias-label-primary)',
  } as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full sm:max-w-xl max-h-[88vh] overflow-y-auto p-5"
        style={{
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: 'var(--dsh-radius-lg) var(--dsh-radius-lg) 0 0',
          boxShadow: 'var(--dsw-shadow-lv2)',
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="dsh-t-base dsh-strong dsh-label-primary flex items-center gap-2">
              <BookOpen size={15} className="dsh-accent" /> Business skills
            </h3>
            <p className="dsh-t-xs dsh-label-tertiary mt-1">
              Teach the agent how <em>your</em> business does things. It sees the one-line summary every
              message and only reads the full text when the task matches.
            </p>
          </div>
          <button onClick={onClose} className="dsh-interactive p-1" title="Close">
            <X size={16} />
          </button>
        </div>

        {needsMigration && (
          <div className="mb-3 p-2.5 dsh-t-xs" style={{ ...field, borderColor: 'var(--dsw-alias-state-warn-primary)' }}>
            Skills storage is not set up yet — run <code className="dsh-mono">sql/migrations/15_agent_skills.sql</code>.
          </div>
        )}
        {error && (
          <div className="mb-3 p-2.5 dsh-t-xs dsh-danger" style={field}>
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-3 p-2.5 dsh-t-xs dsh-success" style={field}>
            {notice}
          </div>
        )}

        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full mb-3 py-2 dsh-btn-primary dsh-t-s dsh-strong flex items-center justify-center gap-2"
            style={{ borderRadius: 'var(--dsh-radius-sm)' }}
          >
            <Upload size={13} /> Add a skill
          </button>
        ) : (
          <form onSubmit={submit} className="mb-4 space-y-2 p-3" style={field}>
            <input
              name="name"
              placeholder="Name — e.g. Listing writing style"
              className="w-full p-2 dsh-t-s outline-none"
              style={field}
            />
            <input
              name="description"
              placeholder="When should the agent use it? — one line, e.g. 'when writing property descriptions'"
              className="w-full p-2 dsh-t-s outline-none"
              style={field}
            />
            <textarea
              name="content"
              rows={5}
              placeholder="Paste the procedure — the exact wording, the rules, the examples."
              className="w-full p-2 dsh-t-s outline-none resize-y dsh-mono"
              style={field}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="dsh-t-xxs dsh-label-tertiary flex items-center gap-1.5 cursor-pointer">
                <input
                  ref={fileRef}
                  type="file"
                  name="file"
                  accept=".md,.markdown,.txt,.json,.yaml,.yml,.csv,.tsv"
                  className="dsh-t-xxs"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 dsh-t-xs dsh-label-tertiary dsh-interactive"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-3 py-1.5 dsh-t-xs dsh-strong dsh-btn-primary flex items-center gap-1.5 disabled:opacity-40"
                  style={{ borderRadius: 'var(--dsh-radius-sm)' }}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                </button>
              </div>
            </div>
          </form>
        )}

        {loading ? (
          <p className="dsh-t-xs dsh-label-tertiary flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> loading…
          </p>
        ) : skills.length === 0 ? (
          <p className="dsh-t-xs dsh-label-tertiary">
            No skills yet. Add your first procedure and the agent will follow it.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {skills.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-2 p-2.5"
                style={{ ...field, opacity: s.enabled ? 1 : 0.6 }}
              >
                <div className="flex-1 min-w-0">
                  <p className="dsh-t-s dsh-strong dsh-label-primary truncate">{s.name}</p>
                  <p className="dsh-t-xxs dsh-label-tertiary line-clamp-2">{s.description}</p>
                </div>
                <button
                  onClick={() => toggle(s)}
                  disabled={busy}
                  className="p-1 dsh-interactive shrink-0"
                  title={s.enabled ? 'Disable for the agent' : 'Enable for the agent'}
                  style={{ color: s.enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' }}
                >
                  <Power size={13} />
                </button>
                <button
                  onClick={() => remove(s.id)}
                  disabled={busy}
                  className={`p-1 shrink-0 dsh-interactive-danger ${pendingDelete === s.id ? 'dsh-strong' : ''}`}
                  title={pendingDelete === s.id ? 'Click again to delete' : 'Delete skill'}
                >
                  {pendingDelete === s.id ? <Check size={13} /> : <Trash2 size={13} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
