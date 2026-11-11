import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Flow awareness for the agent.
 *
 * The app already has a working automation system: `utils/whatsapp/flow-runner.ts`
 * executes flows stored as rows in `automations` (title `Flow:*`), matching real
 * triggers (a Meta ad campaign, an inbound keyword, a CRM lead, a template
 * button) and running real actions including `aiCallNode` -> triggerOutboundCall.
 * `Group-Distribution:*` rows route leads to agents.
 *
 * The agent could see none of it. Asked to "add a follow-up flow", it would have
 * cheerfully authored a duplicate of one already running, and two flows matching
 * the same campaign both fire — the lead gets messaged and called twice.
 *
 * So this module is deliberately READ-ONLY. It exists so the agent knows what is
 * already live before it proposes anything. Creating or editing flows needs a
 * validated authoring path plus the approval card, which is a separate step.
 */

interface ParsedFlow {
  id: string;
  title: string;
  active: boolean;
  kind: 'whatsapp-flow' | 'lead-routing' | 'other';
  triggerType: string | null;
  campaignId: string | null;
  keywords: string[];
  nodeTypes: string[];
}

function parseFlow(row: any): ParsedFlow {
  const title = String(row.title || '');
  const kind: ParsedFlow['kind'] = title.startsWith('Flow:')
    ? 'whatsapp-flow'
    : title.startsWith('Group-Distribution:')
      ? 'lead-routing'
      : 'other';

  let triggerType: string | null = null;
  let campaignId: string | null = null;
  let keywords: string[] = [];
  const nodeTypes: string[] = [];

  try {
    const d = JSON.parse(row.description || '{}');
    const nodes: any[] = d.xyNodes || d.nodes || [];
    for (const n of nodes) {
      const t = String(n?.type || '');
      if (t) nodeTypes.push(t);
      const cfg = n?.data || n?.config || {};
      if (t === 'triggerNode' || t.startsWith('trigger_')) {
        // NOTE: never fall back to the raw node type here. `triggerNode` would
        // become the literal string "Node", which the agent would then report to
        // the user as their trigger. If the flow does not name a trigger type,
        // say so honestly.
        // React-Flow nodes often repeat their own type inside `data`, so both
        // `cfg.triggerType` and `cfg.type` can literally be "triggerNode". That
        // is not a trigger name and must never be shown to the user as one.
        const namedRaw = cfg.triggerType || cfg.type;
        const named =
          namedRaw && !/^trigger(node)?$/i.test(String(namedRaw)) ? String(namedRaw) : null;
        triggerType =
          named ??
          // A node carrying a templateName and buttons but no explicit type is a
          // template-button flow — infer it rather than reporting nothing.
          (cfg.templateName || (Array.isArray(cfg.buttons) && cfg.buttons.length > 0)
            ? 'whatsapp_broadcast'
            : t === 'triggerNode'
              ? null
              : t.replace(/^trigger_?/, '') || null);
        campaignId = cfg.campaignId ? String(cfg.campaignId) : null;
        const raw = cfg.keywords || cfg.keyword;
        if (Array.isArray(raw)) keywords = raw.map(String);
        else if (typeof raw === 'string') keywords = raw.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!triggerType && d.trigger) {
      // Same trap as the node config: this can be the literal node type.
      const t = String(d.trigger.type || '');
      triggerType = t && !/^trigger(node)?$/i.test(t) ? t : null;
    }
  } catch {
    /* description is not JSON — treat as an opaque rule */
  }

  return { id: row.id, title, active: Boolean(row.is_active), kind, triggerType, campaignId, keywords, nodeTypes };
}

/** Human label for a raw trigger id. */
function triggerLabel(t: string | null): string {
  if (!t) return 'no trigger type set';
  const k = t.toLowerCase();
  if (k.includes('meta_ad') || k.includes('click_to_whatsapp') || k === 'ctwa') return 'Meta ad click / click-to-WhatsApp';
  if (k.includes('whatsapp_inbound')) return 'inbound WhatsApp message';
  if (k.includes('crm_lead') || k === 'crm_lead') return 'a new CRM lead';
  if (k.includes('template') || k.includes('broadcast') || k.includes('quick_reply')) return 'WhatsApp template button';
  if (k.includes('ig_comment')) return 'Instagram comment';
  if (k.includes('fb_comment')) return 'Facebook comment';
  if (k.includes('ig_dm') || k.includes('messenger')) return 'Instagram / Messenger DM';
  return t;
}

export function createAutomationTools(supabase: SupabaseClient, userId: string) {
  async function loadFlows(): Promise<ParsedFlow[]> {
    const { data, error } = await supabase
      .from('automations')
      .select('id, title, is_active, description')
      .eq('user_id', userId)
      .order('is_active', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(parseFlow);
  }

  return {
    list_automation_flows: tool({
      description:
        'The automations / flows / workflows / sequences this business has built: what triggers them, ' +
        'what they do, and whether they are active. THIS is the tool for "what automations are running", ' +
        '"which flows exist", or "is anything automated". Not to be confused with list_scheduled_tasks, ' +
        'which is only one-off timers the agent set.',
      inputSchema: z.object({
        includeInactive: z.boolean().default(false).describe('Include disabled flows as well'),
      }),
      execute: async ({ includeInactive = false }) => {
        try {
          const all = await loadFlows();
          const flows = includeInactive ? all : all.filter((f) => f.active);
          const live = all.filter((f) => f.active);

          const whatsapp = flows.filter((f) => f.kind === 'whatsapp-flow');
          const routing = flows.filter((f) => f.kind === 'lead-routing');

          const answer =
            all.length === 0
              ? 'This account has no automations yet.'
              : `${live.length} active automation${live.length === 1 ? '' : 's'}` +
                ` (${whatsapp.filter((f) => f.active).length} WhatsApp flow${whatsapp.filter((f) => f.active).length === 1 ? '' : 's'}, ` +
                `${routing.filter((f) => f.active).length} lead-routing rule${routing.filter((f) => f.active).length === 1 ? '' : 's'})` +
                (includeInactive ? `, plus ${all.length - live.length} disabled.` : '.');

          return {
            success: true,
            answer,
            totalCount: all.length,
            activeCount: live.length,
            whatsappFlows: whatsapp.map((f) => ({
              id: f.id,
              name: f.title.replace(/^Flow:\s*/, ''),
              active: f.active,
              trigger: triggerLabel(f.triggerType),
              campaignId: f.campaignId,
              keywords: f.keywords,
              steps: f.nodeTypes.filter((t) => t !== 'triggerNode').length,
              actions: f.nodeTypes.filter((t) => t !== 'triggerNode'),
            })),
            leadRoutingRules: routing.map((f) => ({
              id: f.id,
              name: f.title.replace(/^Group-Distribution:\s*/, ''),
              active: f.active,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not list automations' };
        }
      },
    }),

    check_flow_conflicts: tool({
      description:
        'Before proposing a new automation, checks whether an ACTIVE flow would already fire on the same trigger — the same Meta campaign, the same inbound keyword, or the same CRM-lead event. Two active flows on one trigger double-message and double-call the lead, so always run this and tell the user which existing flow would clash.',
      inputSchema: z.object({
        triggerType: z
          .enum(['meta_ad', 'whatsapp_inbound', 'crm_lead', 'whatsapp_broadcast'])
          .describe('The trigger the new flow would use'),
        campaignId: z.string().optional().describe('For meta_ad: the specific campaign id it would fire on'),
        keywords: z.array(z.string()).optional().describe('For whatsapp_inbound: the keywords it would listen for'),
      }),
      execute: async ({ triggerType, campaignId, keywords }) => {
        try {
          const all = await loadFlows();
          const active = all.filter((f) => f.active && f.kind === 'whatsapp-flow');

          const norm = (t: string | null) => String(t || '').toLowerCase();
          const matches: ParsedFlow[] = [];

          for (const f of active) {
            const t = norm(f.triggerType);
            if (triggerType === 'meta_ad') {
              const isAdTrigger = t.includes('meta_ad') || t.includes('click_to_whatsapp');
              if (!isAdTrigger) continue;
              // Same campaign is a direct clash; a flow with no campaign bound
              // catches every ad, so it clashes too.
              if (!f.campaignId || !campaignId || f.campaignId === campaignId) matches.push(f);
            } else if (triggerType === 'whatsapp_inbound') {
              if (!t.includes('whatsapp_inbound')) continue;
              const overlap = (keywords || []).filter((k) =>
                f.keywords.some((fk) => fk.toLowerCase() === k.toLowerCase())
              );
              // A keyword-less inbound flow catches everything.
              if (f.keywords.length === 0 || overlap.length > 0) matches.push(f);
            } else if (triggerType === 'crm_lead') {
              if (t.includes('crm_lead')) matches.push(f);
            } else if (triggerType === 'whatsapp_broadcast') {
              if (t.includes('template') || t.includes('broadcast') || t.includes('quick_reply')) matches.push(f);
            }
          }

          const names = matches.map((m) => m.title.replace(/^Flow:\s*/, ''));
          const answer =
            matches.length === 0
              ? `No active flow currently fires on ${triggerLabel(triggerType)}${campaignId ? ` for campaign ${campaignId}` : ''} — this trigger is free.`
              : `${matches.length} active flow${matches.length === 1 ? '' : 's'} already fire on ${triggerLabel(triggerType)}: ` +
                `${names.join(', ')}. Adding another would double-message the same leads — ${matches.length === 1 ? 'modify that flow' : 'consolidate them'} instead of creating a new one.`;

          return {
            success: true,
            hasConflict: matches.length > 0,
            answer,
            conflictingFlows: matches.map((m) => ({
              id: m.id,
              name: m.title.replace(/^Flow:\s*/, ''),
              trigger: triggerLabel(m.triggerType),
              campaignId: m.campaignId,
              keywords: m.keywords,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not check flow conflicts' };
        }
      },
    }),
  };
}
