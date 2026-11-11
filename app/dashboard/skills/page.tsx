'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Business skills — the client's own written procedures, available to the agent.
 *
 * Same idea as the harness's own skill catalogue: a one-line description is always
 * visible to the agent, the full body is fetched only when the task matches. That
 * is what lets a business upload twenty procedures without slowing every message
 * down, and it is why the upload form asks for a description separately.
 */

interface Skill {
  id: string;
  name: string;
  description: string;
  source_filename: string | null;
  enabled: boolean;
  updated_at: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/skills');
      const data = await res.json();
      if (data.needsMigration) setNeedsMigration(true);
      setSkills(data.skills || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load skills');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(form: FormData) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/agent/skills', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setNotice(`Saved "${data.name}". The agent will use it from the next message.`);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file');
    if (file instanceof File && !file.size) form.delete('file');
    const hasFile = form.get('file') instanceof File;
    const hasText = String(form.get('content') || '').trim().length > 0;
    if (!hasFile && !hasText) {
      setError('Pick a file or paste the skill text.');
      return;
    }
    await upload(form);
  }

  async function toggle(skill: Skill) {
    setBusy(true);
    try {
      await fetch('/api/agent/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: skill.id, enabled: !skill.enabled }),
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
      await fetch(`/api/agent/skills?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Skills</h1>
      <p className="mt-2 text-sm text-slate-600">
        Teach the agent how <em>your</em> business does things. A skill is a written procedure — your
        listing format, your lead-qualification script, your brand voice. The agent reads the
        one-line description on every message and only opens the full text when the task matches.
      </p>

      {needsMigration && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Skills storage is not set up on this database yet. Run{' '}
          <code className="font-mono">sql/migrations/15_agent_skills.sql</code>.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>
      )}
      {notice && (
        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded-lg border border-slate-200 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Name</span>
            <input
              name="name"
              placeholder="Listing writing style"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">When should the agent use it?</span>
            <input
              name="description"
              placeholder="Use whenever writing a property listing"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="font-medium">Upload a file</span>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".md,.markdown,.txt,.json,.yaml,.yml,.csv,.tsv"
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:text-white"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Markdown, text, JSON, YAML or CSV. For Word or PDF, export to text first.
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium">…or paste it</span>
          <textarea
            name="content"
            rows={6}
            placeholder={'# Listing writing style\n\nAlways lead with the locality...'}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition active:scale-95 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save skill'}
        </button>
      </form>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Uploaded skills {skills.length ? `(${skills.length})` : ''}
      </h2>

      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          None yet. Until you add one, the agent uses its own judgement.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
          {skills.map((s) => (
            <li key={s.id} className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.name}
                  {!s.enabled && <span className="ml-2 text-xs text-slate-400">(disabled)</span>}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{s.description}</p>
                {s.source_filename && (
                  <p className="mt-1 text-[11px] text-slate-400">from {s.source_filename}</p>
                )}
              </div>
              <button
                onClick={() => toggle(s)}
                disabled={busy}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs transition active:scale-95"
              >
                {s.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => remove(s.id)}
                disabled={busy}
                className={`rounded-md border px-2.5 py-1 text-xs transition active:scale-90 ${
                  pendingDelete === s.id
                    ? 'border-red-500 bg-red-500 text-white'
                    : 'border-slate-300 text-red-600'
                }`}
              >
                {pendingDelete === s.id ? 'Confirm' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
