'use client';

/**
 * WHATSAPP DEPTH: a template gallery, and a broadcast composer that does not send anything.
 *
 * The tab was functional but thin — live conversations, a single template send and WABA status. The
 * two things an owner actually opens WhatsApp for were missing: what templates do I have and what
 * state is Meta keeping them in, and "message this audience". Both are here, and they reuse what
 * already exists rather than growing a second implementation:
 *
 *   - GET/POST /api/whatsapp/templates — the same route the chat picker uses, so a template this
 *     screen submits is the template the conversation can send, in the same WABA;
 *   - POST /api/whatsapp/broadcasts/preview — the REAL audience resolver, i.e. exactly the filters
 *     the sender would apply, so the number shown is the number that would be messaged.
 *
 * WHY THE COMPOSER CANNOT SEND
 * Everything that messages customers goes through the review gate (an approval card in the agent
 * conversation, approved by a human). A "Send" button here would be a bypass dressed as convenience,
 * so the last step is "Prepare for approval": it states the audience, the exact rendered message and
 * the count, and hands the job to the conversation that owns the gate. Nothing leaves this component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, Clock, FileText, Loader2, Send, ShieldAlert, XCircle } from 'lucide-react';

interface TemplateComponent {
  type?: string;
  text?: string;
  format?: string;
  buttons?: Array<{ text?: string; type?: string; url?: string; phone_number?: string }>;
}

interface WhatsAppTemplate {
  id?: string;
  name: string;
  language?: string;
  status?: string;
  category?: string;
  components?: TemplateComponent[];
}

interface AudienceLead {
  id: string;
  name: string;
  phone: string;
  formattedPhone: string;
  hasValidPhone: boolean;
  stage: string;
  source: string;
}

const STATUS_STYLE: Record<string, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  PAUSED: 'bg-slate-100 text-slate-600 border-slate-200',
};

function statusIcon(status?: string) {
  const upper = String(status ?? '').toUpperCase();
  if (upper === 'APPROVED') return <BadgeCheck size={12} />;
  if (upper === 'REJECTED') return <XCircle size={12} />;
  return <Clock size={12} />;
}

function bodyOf(template: WhatsAppTemplate): string {
  const body = (template.components ?? []).find((c) => String(c.type ?? '').toUpperCase() === 'BODY');
  return String(body?.text ?? '');
}

function buttonsOf(template: WhatsAppTemplate): string[] {
  const buttons = (template.components ?? []).find((c) => String(c.type ?? '').toUpperCase() === 'BUTTONS');
  return (buttons?.buttons ?? []).map((b) => String(b.text ?? '')).filter(Boolean);
}

/** Fill {{1}}, {{2}} … with what the owner typed, for the preview only. */
function renderBody(body: string, values: string[], lead?: AudienceLead): string {
  return body
    .replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, index) => {
      const value = values[Number(index) - 1];
      return value?.trim() ? value : `{{${index}}}`;
    })
    .replace(/\{\{\s*lead\.name\s*\}\}/gi, lead?.name ?? '{{lead.name}}')
    .replace(/\{\{\s*lead\.phone\s*\}\}/gi, lead?.phone ?? '{{lead.phone}}');
}

export interface WhatsAppGrowthToolsProps {
  /** A super-admin inspecting a tenant passes this through, exactly like the rest of the tab. */
  impersonateId?: string | null;
  /** Where to hand the prepared broadcast. The gate lives in that conversation. */
  agentHref?: string;
  onClose?: () => void;
}

export default function WhatsAppGrowthTools({ impersonateId, agentHref = '/dashboard/agent', onClose }: WhatsAppGrowthToolsProps) {
  const [section, setSection] = useState<'templates' | 'broadcast'>('templates');

  // ── templates ───────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesNote, setTemplatesNote] = useState<string>('');
  const [form, setForm] = useState({ name: '', category: 'MARKETING', bodyText: '', footerText: '' });
  const [submitting, setSubmitting] = useState(false);

  const withImpersonate = useCallback(
    (path: string) => (impersonateId ? `${path}${path.includes('?') ? '&' : '?'}impersonate=${encodeURIComponent(impersonateId)}` : path),
    [impersonateId]
  );

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch(withImpersonate('/api/whatsapp/templates'), { cache: 'no-store' });
      const data = await res.json();
      const list: WhatsAppTemplate[] = Array.isArray(data?.templates) ? data.templates : [];
      setTemplates(list);
      /**
       * The route answers `source: 'fallback_unconfigured'` when no WABA is connected, and it hands
       * back example templates so a picker is never empty. Those are NOT this account's templates,
       * so they are labelled as examples instead of being passed off as approved ones.
       */
      setTemplatesNote(
        data?.source === 'fallback_unconfigured'
          ? 'No WhatsApp Business account is connected yet, so these are example templates — nothing here can be sent.'
          : data?.error
            ? `Meta did not answer: ${data.error}`
            : ''
      );
    } catch (err: any) {
      setTemplatesNote(`Could not load templates: ${err?.message ?? err}`);
    } finally {
      setTemplatesLoading(false);
    }
  }, [withImpersonate]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const submitTemplate = async () => {
    if (!form.name.trim() || !form.bodyText.trim()) {
      toast.error('A template needs a name and message text.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(withImpersonate('/api/whatsapp/templates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          bodyText: form.bodyText,
          buttons: form.footerText.trim() ? [{ type: 'QUICK_REPLY', text: form.footerText.trim() }] : undefined,
          ...(impersonateId ? { impersonate: impersonateId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Meta refused the template.');
        return;
      }
      // Meta's own verdict, quoted as it answered: a template is not usable until Meta approves it.
      const status = String(data?.status ?? data?.template?.status ?? '').toUpperCase();
      toast.success(
        status === 'APPROVED'
          ? 'Meta approved this template.'
          : `Submitted to Meta for review${status ? ` (status: ${status})` : ''}. It cannot be broadcast until Meta approves it.`
      );
      setForm({ name: '', category: 'MARKETING', bodyText: '', footerText: '' });
      await loadTemplates();
    } catch (err: any) {
      toast.error(`Could not submit the template: ${err?.message ?? err}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── broadcast ───────────────────────────────────────────────────────────
  const [stage, setStage] = useState('All');
  const [preview, setPreview] = useState<{
    totalMatching: number;
    validPhoneCount: number;
    missingPhoneCount: number;
    sampleLeads: AudienceLead[];
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [variables, setVariables] = useState<string[]>(['', '', '']);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => String(t.status ?? '').toUpperCase() === 'APPROVED'),
    [templates]
  );
  const chosen = useMemo(
    () => templates.find((t) => t.name === templateName) ?? null,
    [templates, templateName]
  );
  const placeholderCount = useMemo(() => {
    const body = chosen ? bodyOf(chosen) : '';
    const matches = body.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
    return Math.max(0, new Set(matches).size);
  }, [chosen]);

  const previewAudience = async () => {
    setPreviewing(true);
    try {
      const res = await fetch('/api/whatsapp/broadcasts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientStage: stage,
          ...(impersonateId ? { impersonateId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Could not work out the audience.');
        return;
      }
      setPreview({
        totalMatching: Number(data.totalMatching ?? 0),
        validPhoneCount: Number(data.validPhoneCount ?? 0),
        missingPhoneCount: Number(data.missingPhoneCount ?? 0),
        sampleLeads: Array.isArray(data.sampleLeads) ? data.sampleLeads : [],
      });
    } catch (err: any) {
      toast.error(`Could not work out the audience: ${err?.message ?? err}`);
    } finally {
      setPreviewing(false);
    }
  };

  /**
   * The last step deliberately does not send.
   *
   * A bulk template send is what `request_human_approval` exists for: the owner sees the audience,
   * the template and the count on a card and approves it once. This hands that instruction to the
   * conversation that owns the gate, with the numbers already worked out so the agent does not have
   * to guess them.
   */
  const prepareForApproval = () => {
    if (!chosen) {
      toast.error('Choose a template first.');
      return;
    }
    if (!preview || preview.validPhoneCount === 0) {
      toast.error('Check the audience first — there is nobody with a usable number yet.');
      return;
    }
    const instruction = [
      `Prepare a WhatsApp broadcast for approval. Do not send it until I approve the card.`,
      `Template: ${chosen.name}${chosen.language ? ` (${chosen.language})` : ''}`,
      `Audience: ${stage === 'All' ? 'every lead in this account' : `leads at stage "${stage}"`} — ${preview.validPhoneCount} reachable of ${preview.totalMatching} matching (${preview.missingPhoneCount} have no usable number).`,
      placeholderCount
        ? `Template variables: ${Array.from({ length: placeholderCount }, (_, i) => `{{${i + 1}}}=${variables[i]?.trim() || '(ask me)'}`).join(', ')}`
        : 'The template has no variables.',
      `Show me the approval card with the audience, the rendered message and the count.`,
    ].join('\n');
    const url = `${agentHref}?ask=${encodeURIComponent(instruction)}`;
    window.location.href = url;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-indigo-600" />
          <h2 className="text-sm font-black text-slate-900">Templates &amp; broadcasts</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSection('templates')}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
              section === 'templates' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            Template gallery
          </button>
          <button
            type="button"
            onClick={() => setSection('broadcast')}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
              section === 'broadcast' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            Broadcast composer
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="text-[11px] font-bold text-slate-400 hover:text-slate-700 px-1">
              Close
            </button>
          )}
        </div>
      </div>

      {templatesNote && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800 font-semibold">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          <span>{templatesNote}</span>
        </div>
      )}

      {section === 'templates' ? (
        <div className="p-4 space-y-4">
          {templatesLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold">
              <Loader2 size={13} className="animate-spin" /> Loading templates from Meta…
            </div>
          ) : templates.length === 0 ? (
            <p className="text-xs text-slate-500">
              This account has no WhatsApp templates yet. Create one below — Meta reviews it before it can be used.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((template) => {
                const status = String(template.status ?? 'PENDING').toUpperCase();
                return (
                  <div key={`${template.name}-${template.language ?? ''}`} className="border border-slate-200 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">{template.name}</p>
                        <p className="text-[10px] text-slate-400 font-semibold">
                          {template.language ?? 'en'} · {template.category ?? 'MARKETING'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                          STATUS_STYLE[status] ?? STATUS_STYLE.PAUSED
                        }`}
                      >
                        {statusIcon(status)} {status}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-600 whitespace-pre-wrap line-clamp-4">{bodyOf(template) || '(no body)'}</p>
                    {buttonsOf(template).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {buttonsOf(template).map((label, i) => (
                          <span key={`${template.name}-btn-${i}`} className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">New template</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="template_name (lowercase, underscores)"
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"
              />
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"
              >
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
              </select>
            </div>
            <textarea
              value={form.bodyText}
              onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
              placeholder="Hi {{1}}, this is {{2}} — here is what you asked for."
              rows={3}
              className="mt-2 w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"
            />
            <input
              value={form.footerText}
              onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))}
              placeholder="Optional quick-reply button label"
              className="mt-2 w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"
            />
            <button
              type="button"
              onClick={submitTemplate}
              disabled={submitting}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider bg-slate-900 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Submit to Meta
            </button>
            <p className="mt-1.5 text-[10px] text-slate-400">
              Submitting creates a template for review. It messages nobody, and Meta decides when — or whether — it is usable.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-bold text-slate-600">
              Audience
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value);
                  setPreview(null);
                }}
                className="mt-1 w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold"
              >
                <option value="All">Every lead in this account</option>
                <option value="New Lead">Stage: New Lead</option>
                <option value="Contacted">Stage: Contacted</option>
                <option value="Qualified">Stage: Qualified</option>
                <option value="Site Visit">Stage: Site Visit</option>
                <option value="Booked">Stage: Booked</option>
                <option value="Lost">Stage: Lost</option>
              </select>
            </label>
            <label className="text-[11px] font-bold text-slate-600">
              Template (approved only)
              <select
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="mt-1 w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold"
              >
                <option value="">Choose a template…</option>
                {approvedTemplates.map((t) => (
                  <option key={`${t.name}-${t.language ?? ''}`} value={t.name}>
                    {t.name} ({t.language ?? 'en'})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {approvedTemplates.length === 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2 font-semibold">
              No approved template on this account yet. A broadcast can only use a template Meta has approved — create one in the
              gallery and wait for its verdict.
            </p>
          )}

          {placeholderCount > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {Array.from({ length: placeholderCount }, (_, i) => (
                <label key={`var-${i + 1}`} className="text-[11px] font-bold text-slate-600">
                  {`{{${i + 1}}}`}
                  <input
                    value={variables[i] ?? ''}
                    onChange={(e) => setVariables((v) => Object.assign([...v], { [i]: e.target.value }))}
                    className="mt-1 w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"
                    placeholder="value"
                  />
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={previewAudience}
              disabled={previewing}
              className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider bg-indigo-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {previewing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Check the audience
            </button>
            {preview && (
              <span className="text-[11px] font-bold text-slate-600">
                {preview.validPhoneCount} reachable of {preview.totalMatching} matching
                {preview.missingPhoneCount > 0 ? ` · ${preview.missingPhoneCount} with no usable number` : ''}
              </span>
            )}
          </div>

          {preview && preview.sampleLeads.length > 0 && chosen && (
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/60">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                What {preview.sampleLeads[0].name} would receive
              </p>
              <div className="bg-[#DCF8C6] rounded-lg px-3 py-2 text-[12px] text-slate-800 whitespace-pre-wrap">
                {renderBody(bodyOf(chosen), variables, preview.sampleLeads[0])}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">
                to {preview.sampleLeads[0].name} · {preview.sampleLeads[0].formattedPhone || preview.sampleLeads[0].phone}
              </p>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={prepareForApproval}
              disabled={!chosen || !preview}
              className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider bg-slate-900 text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
            >
              <ShieldAlert size={12} /> Prepare for approval
            </button>
            <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed">
              This does not send anything. A bulk message goes through the approval card in the agent conversation, with the
              audience, the message and the count in front of you — that is the gate, and there is no way round it here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
