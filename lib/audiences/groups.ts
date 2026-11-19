import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LEAD_PAGE_SIZE,
  MAX_LEADS_SCANNED,
  audienceNameFromTitle,
  audienceTitle,
  dateWindow,
  describeFilters,
  hasCategoryFilters,
  leadMatchesFilters,
  normaliseFilters,
  normalisePhone,
  tagForGroup,
  type AudienceFilters,
  type AudienceLead,
} from './filters';

/**
 * Audience groups: the ledger and the tagging.
 *
 * An audience group is not a table of its own. It is a TAG on leads (so the CRM filter and the
 * broadcast targeting can find them) plus one `automations` row named `Audience-Group: <name>` that
 * remembers the filters that produced it, so the group can be rebuilt tomorrow.
 *
 * That shape has a consequence worth stating plainly: creating a group MUTATES leads. It is
 * reversible (delete the group, or another sync overwrites the tag) and it messages nobody, so it is
 * not behind the approval gate — but it is the reason this module reports exactly how many leads it
 * touched instead of a cheerful "done".
 */

const TAG_BATCH = 50;

/** Fields the matching needs. Kept in one place so a new filter cannot silently read an unselected column. */
export const AUDIENCE_LEAD_COLUMNS =
  'id, name, phone, email, source, ad_name, form_name, csv_audience, pipeline_stage, property_id, custom_fields, created_at, whatsapp_enabled';

export interface FetchLeadsResult {
  leads: AudienceLead[];
  /** True when the account has more leads than the scan cap, so counts are a floor, not the truth. */
  capped: boolean;
}

/**
 * Read the leads an audience could contain.
 *
 * The cap is the UI's own 30k and is reported rather than applied silently: a count that quietly
 * stops at 30,000 is how "this group has 30,000 leads" gets said about an account with 46,000.
 */
export async function fetchLeadsForAudience(
  supabase: SupabaseClient,
  userId: string,
  opts: { maxLeads?: number } = {}
): Promise<FetchLeadsResult> {
  const cap = Math.min(opts.maxLeads ?? MAX_LEADS_SCANNED, MAX_LEADS_SCANNED);

  const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const total = count ?? 0;
  const pages = Math.min(Math.ceil(total / LEAD_PAGE_SIZE), Math.ceil(cap / LEAD_PAGE_SIZE));

  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) =>
      supabase
        .from('leads')
        .select(AUDIENCE_LEAD_COLUMNS)
        .eq('user_id', userId)
        .order('id')
        .range(p * LEAD_PAGE_SIZE, p * LEAD_PAGE_SIZE + LEAD_PAGE_SIZE - 1)
    )
  );

  const leads: AudienceLead[] = [];
  for (const result of results) {
    if (result.error) throw new Error(`could not read leads: ${result.error.message}`);
    leads.push(...((result.data ?? []) as AudienceLead[]));
  }
  return { leads, capped: total > leads.length };
}

export interface AudiencePreview {
  count: number;
  /** A few real names, so the agent can show the owner who this is. */
  sample: { id: string; name: string | null; phone: string | null }[];
  capped: boolean;
  scanned: number;
  /** Plain-English version of what the filters select. */
  selection: string;
  /** True when nothing was filtered, i.e. this is the whole book. */
  unfiltered: boolean;
}

export interface PreviewInput {
  filters?: unknown;
  manualPhoneNumbers?: string[];
  maxLeads?: number;
  filtersOrGroup?: AudienceFilters;
}

function manualPhoneSet(numbers: string[] | undefined): Set<string> {
  const set = new Set<string>();
  (numbers ?? []).forEach((n) => {
    const norm = normalisePhone(n);
    if (norm) set.add(norm);
  });
  return set;
}

/** What WOULD be in this audience — the free half, and the one the agent should call first. */
export async function previewAudience(
  supabase: SupabaseClient,
  userId: string,
  input: PreviewInput
): Promise<AudiencePreview> {
  const filters = input.filtersOrGroup ?? normaliseFilters(input.filters);
  const window = dateWindow(filters);
  const manual = manualPhoneSet(input.manualPhoneNumbers);
  const { leads, capped } = await fetchLeadsForAudience(supabase, userId, { maxLeads: input.maxLeads });

  const matched = leads.filter((lead) => leadMatchesFilters(lead, filters, window, { manualPhones: manual }));
  const unfiltered = !hasCategoryFilters(filters) && window.min === null && window.max === null && manual.size === 0;

  return {
    count: matched.length,
    sample: matched.slice(0, 5).map((l) => ({ id: String(l.id), name: l.name ?? null, phone: l.phone ?? null })),
    capped,
    scanned: leads.length,
    selection: manual.size ? `the ${manual.size} number(s) given by hand` : describeFilters(filters),
    unfiltered,
  };
}

export interface SaveAudienceInput {
  name: string;
  description?: string;
  filters?: unknown;
  manualPhoneNumbers?: string[];
  maxLeads?: number;
}

export interface SaveAudienceResult {
  id: string;
  name: string;
  leadCount: number;
  tagged: number;
  capped: boolean;
  created: boolean;
  selection: string;
}

/**
 * Create or refresh an audience group: tag the matching leads, then write the group row.
 *
 * The order matters. Tagging first means a crash leaves tagged leads with a stale row (visible and
 * fixable by re-running), never a group row claiming leads that were never tagged — which is how a
 * broadcast later "reaches nobody" while the UI insists the group has 400 people.
 */
export async function saveAudienceGroup(
  supabase: SupabaseClient,
  userId: string,
  input: SaveAudienceInput
): Promise<SaveAudienceResult> {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('an audience group needs a name');

  const filters = normaliseFilters(input.filters);
  const window = dateWindow(filters);
  const manual = manualPhoneSet(input.manualPhoneNumbers);
  const { leads, capped } = await fetchLeadsForAudience(supabase, userId, { maxLeads: input.maxLeads });

  const matched = leads.filter((lead) => leadMatchesFilters(lead, filters, window, { manualPhones: manual }));

  const updates: { id: string; csv_audience: string; custom_fields: Record<string, any> }[] = [];
  for (const lead of matched) {
    const tag = tagForGroup(lead, name);
    if (tag) updates.push({ id: String(lead.id), ...tag });
  }

  for (let i = 0; i < updates.length; i += TAG_BATCH) {
    const chunk = updates.slice(i, i + TAG_BATCH);
    const results = await Promise.all(
      chunk.map((item) =>
        supabase
          .from('leads')
          .update({ csv_audience: item.csv_audience, custom_fields: item.custom_fields })
          .eq('id', item.id)
          .eq('user_id', userId)
      )
    );
    const failure = results.find((r) => r.error);
    if (failure?.error) throw new Error(`could not tag ${chunk.length} lead(s): ${failure.error.message}`);
  }

  const config = {
    name,
    description: String(input.description ?? ''),
    filters,
    leadCount: matched.length,
    lastSyncedAt: new Date().toISOString(),
    capped,
  };
  const title = audienceTitle(name);
  const stats = JSON.stringify({ lead_count: matched.length, last_synced_at: config.lastSyncedAt });

  const { data: existing } = await supabase
    .from('automations')
    .select('id')
    .eq('user_id', userId)
    .eq('title', title)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from('automations')
      .update({ description: JSON.stringify(config), stats, is_active: true })
      .eq('id', existing.id)
      .eq('user_id', userId);
    if (error) throw new Error(`could not refresh the group row: ${error.message}`);
    return {
      id: String(existing.id),
      name,
      leadCount: matched.length,
      tagged: updates.length,
      capped,
      created: false,
      selection: describeFilters(filters),
    };
  }

  const { data: inserted, error } = await supabase
    .from('automations')
    .insert({
      user_id: userId,
      title,
      description: JSON.stringify(config),
      icon_name: 'Users',
      is_active: true,
      stats,
    })
    .select('id')
    .single();
  if (error || !inserted?.id) throw new Error(`could not save the group: ${error?.message ?? 'unknown error'}`);

  return {
    id: String(inserted.id),
    name,
    leadCount: matched.length,
    tagged: updates.length,
    capped,
    created: true,
    selection: describeFilters(filters),
  };
}

export interface AudienceGroupSummary {
  id: string;
  name: string;
  description: string;
  leadCount: number;
  lastSyncedAt: string | null;
  filters: AudienceFilters;
  selection: string;
}

/** Every group on the account, newest sync first. */
export async function listAudienceGroups(supabase: SupabaseClient, userId: string): Promise<AudienceGroupSummary[]> {
  const { data, error } = await supabase
    .from('automations')
    .select('id, title, description, stats, created_at')
    .eq('user_id', userId)
    .ilike('title', 'Audience-Group:%')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`could not read audience groups: ${error.message}`);

  return (data ?? []).map((row: any) => {
    let config: any = {};
    try {
      config = typeof row.description === 'string' ? JSON.parse(row.description || '{}') : row.description || {};
    } catch {
      config = {};
    }
    const filters = normaliseFilters(config?.filters);
    const leadCount = Number(config?.leadCount ?? 0);
    return {
      id: String(row.id),
      name: audienceNameFromTitle(row.title) ?? String(config?.name ?? ''),
      description: String(config?.description ?? ''),
      leadCount,
      lastSyncedAt: config?.lastSyncedAt ? String(config.lastSyncedAt) : null,
      filters,
      selection: describeFilters(filters),
    };
  });
}

/** Read one group by name (or id), so a tool can resolve "send the Diwali group a message". */
export async function findAudienceGroup(
  supabase: SupabaseClient,
  userId: string,
  ref: { id?: string; name?: string }
): Promise<AudienceGroupSummary | null> {
  const groups = await listAudienceGroups(supabase, userId);
  const wanted = String(ref.name ?? '').trim().toLowerCase();
  return (
    groups.find((g) => (ref.id ? g.id === ref.id : false)) ??
    groups.find((g) => (wanted ? g.name.trim().toLowerCase() === wanted : false)) ??
    null
  );
}

/** Delete a group row. The tags stay on the leads unless they are explicitly removed. */
export async function deleteAudienceGroup(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('automations').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(`could not delete the group: ${error.message}`);
}
