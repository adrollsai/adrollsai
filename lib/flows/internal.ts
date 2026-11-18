import type { SupabaseClient } from '@supabase/supabase-js';
import type { InternalAction } from './scheduling';

/**
 * Flow steps that touch the CRM and nobody else.
 *
 * "Transfer to a human" is the case that forced this module to exist: the node was declared
 * unsupported, so a flow whose whole purpose was "hand this to a person" could be built, saved and
 * never run. A handoff does not need approval because it messages no customer and costs nothing —
 * but it still has to actually happen.
 *
 * Everything here writes to a record the owner already owns. Nothing here can reach a customer, so
 * nothing here is behind the approval gate. That is the line.
 */

export interface InternalOutcome {
  ok: boolean;
  detail: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Write one internal action against a lead, and say plainly what was written. */
export async function applyInternalAction(
  supabase: SupabaseClient,
  input: { userId: string; leadId: string; flowId?: string | null; internal: InternalAction }
): Promise<InternalOutcome> {
  const { userId, leadId, internal } = input;
  const value = String(internal.value ?? '').trim();
  const tag = input.flowId ? ` (flow ${input.flowId.slice(0, 8)})` : '';

  if (internal.kind === 'assign') {
    if (!value || !UUID.test(value)) {
      // An agent name is not an id. Assigning is only honest when we know who to assign to, so the
      // step degrades into a note that names the problem instead of writing a broken row.
      return note(supabase, leadId, `A human needs to take this conversation over. The flow asked to assign "${value || 'nobody'}", which is not an agent id.${tag}`);
    }
    const { error } = await supabase.from('leads').update({ assigned_to: value }).eq('id', leadId).eq('user_id', userId);
    if (error) return { ok: false, detail: `could not assign the lead: ${error.message}` };
    return { ok: true, detail: `assigned the lead to agent ${value}` };
  }

  if (internal.kind === 'stage') {
    if (!value) return { ok: false, detail: 'the step asked for a stage but named none' };
    const { error } = await supabase.from('leads').update({ pipeline_stage: value }).eq('id', leadId).eq('user_id', userId);
    if (error) return { ok: false, detail: `could not move the lead to "${value}": ${error.message}` };
    return { ok: true, detail: `moved the lead to stage "${value}"` };
  }

  if (internal.kind === 'tag') {
    if (!value) return { ok: false, detail: 'the step asked for a tag but named none' };
    const { data } = await supabase.from('leads').select('custom_fields').eq('id', leadId).eq('user_id', userId).maybeSingle();
    const existing = ((data as any)?.custom_fields ?? {}) as Record<string, unknown>;
    const tags = Array.isArray(existing.tags) ? (existing.tags as string[]) : [];
    if (!tags.includes(value)) tags.push(value);
    const { error } = await supabase
      .from('leads')
      .update({ custom_fields: { ...existing, tags } })
      .eq('id', leadId)
      .eq('user_id', userId);
    if (error) return { ok: false, detail: `could not tag the lead: ${error.message}` };
    return { ok: true, detail: `tagged the lead "${value}"` };
  }

  return note(supabase, leadId, value || `A human needs to take this conversation over.${tag}`);
}

async function note(supabase: SupabaseClient, leadId: string, description: string): Promise<InternalOutcome> {
  const { error } = await supabase.from('lead_history').insert({
    lead_id: leadId,
    action_type: 'REMARK',
    description,
  });
  if (error) return { ok: false, detail: `could not write the note: ${error.message}` };
  return { ok: true, detail: description };
}
