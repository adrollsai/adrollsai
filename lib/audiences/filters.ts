/**
 * What an audience group IS, decided in one place.
 *
 * The Audience Maker (app/api/audiences), its count preview (app/api/audiences/count) and the
 * WhatsApp broadcast targeting all answered "does this lead belong?" — each with its own copy of the
 * rules. Three copies of a definition drift: the count said 412, the broadcast reached 408, and
 * nobody could say which was right. This module is the single answer, and it is pure so a gate can
 * prove it.
 *
 * Two things are deliberately preserved from the original UI behaviour, because a group an owner
 * built by hand and a group the agent builds must be the SAME group:
 *   1. a lead carries its groups twice — in `csv_audience` (comma list, what the CRM filter reads)
 *      and in `custom_fields.audience_groups` (array, what the broadcast targeting reads). Both are
 *      written together; matching accepts either.
 *   2. `matchMode: 'AND'` means every supplied category must match, `'OR'` means any one of them.
 *      A category with no values is not a filter at all, so it never fails an AND.
 */

export const AUDIENCE_GROUP_PREFIX = 'Audience-Group: ';

/** How many leads a group sync will look at. The UI has always capped at 30k; say so, never silently. */
export const MAX_LEADS_SCANNED = 30_000;
export const LEAD_PAGE_SIZE = 1_000;

export type AudienceMatchMode = 'OR' | 'AND';

export type AudienceDateRange = 'all' | '7d' | '30d' | '90d' | 'custom';

export interface AudienceFilters {
  matchMode: AudienceMatchMode;
  campaigns: string[];
  forms: string[];
  sources: string[];
  pipelineStages: string[];
  propertyIds: string[];
  csvAudiences: string[];
  dateRange: AudienceDateRange;
  startDate: string | null;
  endDate: string | null;
}

export const EMPTY_FILTERS: AudienceFilters = {
  matchMode: 'OR',
  campaigns: [],
  forms: [],
  sources: [],
  pipelineStages: [],
  propertyIds: [],
  csvAudiences: [],
  dateRange: 'all',
  startDate: null,
  endDate: null,
};

/** Digits, last ten — the same normalisation the CRM has always used to compare numbers. */
export function normalisePhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? '').trim()).filter(Boolean);
}

/** Read filters off a request body, a stored group, or a tool's arguments — tolerantly, never throwing. */
export function normaliseFilters(raw: unknown): AudienceFilters {
  const input = (raw ?? {}) as Record<string, unknown>;
  const matchMode = String(input.matchMode ?? 'OR').toUpperCase() === 'AND' ? 'AND' : 'OR';
  const dateRangeRaw = String(input.dateRange ?? 'all');
  const allowedDates: AudienceDateRange[] = ['7d', '30d', '90d', 'custom'];
  const dateRange: AudienceDateRange = allowedDates.includes(dateRangeRaw as AudienceDateRange)
    ? (dateRangeRaw as AudienceDateRange)
    : 'all';
  return {
    matchMode,
    campaigns: stringList(input.campaigns),
    forms: stringList(input.forms),
    sources: stringList(input.sources),
    pipelineStages: stringList(input.pipelineStages),
    propertyIds: stringList(input.propertyIds),
    csvAudiences: stringList(input.csvAudiences),
    dateRange,
    startDate: input.startDate ? String(input.startDate) : null,
    endDate: input.endDate ? String(input.endDate) : null,
  };
}

/** Is there anything to filter ON? A group with no filters means "every lead", which is allowed but loud. */
export function hasCategoryFilters(filters: AudienceFilters): boolean {
  return (
    filters.campaigns.length > 0 ||
    filters.forms.length > 0 ||
    filters.sources.length > 0 ||
    filters.pipelineStages.length > 0 ||
    filters.propertyIds.length > 0 ||
    filters.csvAudiences.length > 0
  );
}

export function dateWindow(filters: AudienceFilters, now: Date = new Date()): { min: Date | null; max: Date | null } {
  let min: Date | null = null;
  let max: Date | null = null;
  const days = filters.dateRange === '7d' ? 7 : filters.dateRange === '30d' ? 30 : filters.dateRange === '90d' ? 90 : 0;
  if (days) min = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  if (filters.dateRange === 'custom') {
    if (filters.startDate) {
      const d = new Date(filters.startDate);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(0, 0, 0, 0);
        min = d;
      }
    }
    if (filters.endDate) {
      const d = new Date(filters.endDate);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        max = d;
      }
    }
  }
  return { min, max };
}

export interface AudienceLead {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  ad_name?: string | null;
  form_name?: string | null;
  csv_audience?: string | null;
  pipeline_stage?: string | null;
  property_id?: string | null;
  custom_fields?: unknown;
  created_at?: string | null;
  whatsapp_enabled?: boolean | null;
}

/** custom_fields arrives as jsonb, a JSON string, or null depending on the writer. */
export function customFieldsOf(lead: AudienceLead): Record<string, any> {
  const raw = lead?.custom_fields;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, any>) : {};
}

/**
 * The campaign a lead came from.
 *
 * `ad_name` first, then the two places the Meta webhook stashes it. This is the lookup the UI used,
 * kept identical: an owner filtering by campaign expects the same leads the CRM labelled with it.
 */
export function campaignNameOf(lead: AudienceLead): string | null {
  const direct = lead.ad_name ? String(lead.ad_name).trim() : '';
  if (direct) return direct;
  const cf = customFieldsOf(lead);
  const fromSource = cf?.lead_source_details ? String(cf.lead_source_details).trim() : '';
  if (fromSource) return fromSource;
  const origin = cf?.meta_ad_origin?.campaign_name ? String(cf.meta_ad_origin.campaign_name).trim() : '';
  return origin || null;
}

/** Groups a lead belongs to, from both places they are stored. */
export function groupsOf(lead: AudienceLead): string[] {
  const fromCsv = String(lead.csv_audience ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const cf = customFieldsOf(lead);
  const stored = cf?.audience_groups;
  const fromFields = Array.isArray(stored) ? stored.map((g) => String(g).trim()).filter(Boolean) : stored ? [String(stored).trim()].filter(Boolean) : [];
  return Array.from(new Set([...fromCsv, ...fromFields]));
}

export function isInGroup(lead: AudienceLead, groupName: string): boolean {
  const wanted = String(groupName ?? '').trim();
  if (!wanted) return false;
  return groupsOf(lead).includes(wanted);
}

export interface MatchOptions {
  /** Numbers typed by hand are matched INSTEAD of the filters (the UI's rule). */
  manualPhones?: Set<string>;
  /** When neither filters nor manual phones are given, every lead matches. Default true. */
  matchAllWhenUnfiltered?: boolean;
}

/**
 * Does this lead belong in the audience described by these filters?
 *
 * Order matters and is the UI's: a hand-typed number wins outright; then dates (a hard boundary);
 * then the category filters under OR/AND.
 */
export function leadMatchesFilters(
  lead: AudienceLead,
  filters: AudienceFilters,
  window: { min: Date | null; max: Date | null },
  opts: MatchOptions = {}
): boolean {
  const manual = opts.manualPhones ?? new Set<string>();
  const phone = normalisePhone(lead.phone);
  if (manual.size > 0 && phone && manual.has(phone)) return true;

  const categories = hasCategoryFilters(filters);
  const dated = window.min !== null || window.max !== null;
  if (!categories && !dated && manual.size === 0) return opts.matchAllWhenUnfiltered !== false;

  if (dated && lead.created_at) {
    const created = new Date(lead.created_at);
    if (!Number.isNaN(created.getTime())) {
      if (window.min && created < window.min) return false;
      if (window.max && created > window.max) return false;
    }
  }
  if (!categories) return true;

  const tests: boolean[] = [];
  if (filters.campaigns.length) {
    const campaign = campaignNameOf(lead);
    tests.push(Boolean(campaign && filters.campaigns.includes(campaign)));
  }
  if (filters.forms.length) tests.push(Boolean(lead.form_name && filters.forms.includes(String(lead.form_name).trim())));
  if (filters.sources.length) tests.push(Boolean(lead.source && filters.sources.includes(String(lead.source))));
  if (filters.pipelineStages.length) {
    tests.push(Boolean(lead.pipeline_stage && filters.pipelineStages.includes(String(lead.pipeline_stage))));
  }
  if (filters.propertyIds.length) tests.push(Boolean(lead.property_id && filters.propertyIds.includes(String(lead.property_id))));
  if (filters.csvAudiences.length) {
    const csvs = String(lead.csv_audience ?? '')
      .split(',')
      .map((s) => s.trim());
    tests.push(filters.csvAudiences.some((aud) => csvs.includes(aud)));
  }

  if (!tests.length) return true;
  return filters.matchMode === 'AND' ? tests.every(Boolean) : tests.some(Boolean);
}

/** The tag a lead needs in order to belong to `groupName`, or null when it already does. */
export function tagForGroup(lead: AudienceLead, groupName: string): { csv_audience: string; custom_fields: Record<string, any> } | null {
  const name = String(groupName ?? '').trim();
  if (!name) return null;

  const currentCsv = String(lead.csv_audience ?? '');
  const csvParts = currentCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nextCsv = csvParts.includes(name) ? currentCsv : csvParts.length ? `${currentCsv}, ${name}` : name;

  const cf = { ...customFieldsOf(lead) };
  const stored = cf.audience_groups;
  const groups = Array.isArray(stored) ? stored.map((g) => String(g)) : stored ? [String(stored)] : [];
  const nextGroups = groups.includes(name) ? groups : [...groups, name];
  cf.audience_groups = nextGroups;

  const csvChanged = nextCsv !== currentCsv;
  const groupsChanged = nextGroups.length !== groups.length;
  if (!csvChanged && !groupsChanged) return null;
  return { csv_audience: nextCsv, custom_fields: cf };
}

export function audienceTitle(name: string): string {
  return `${AUDIENCE_GROUP_PREFIX}${String(name ?? '').trim()}`;
}

/** "Audience-Group: Diwali buyers" -> "Diwali buyers". Null when the row is not an audience group. */
export function audienceNameFromTitle(title: string | null | undefined): string | null {
  const raw = String(title ?? '');
  if (!raw.toLowerCase().startsWith(AUDIENCE_GROUP_PREFIX.trim().toLowerCase())) return null;
  return raw.replace(/^Audience-Group:\s*/i, '').trim() || null;
}

/** A sentence describing what this audience selects, for a tool result a person can read. */
export function describeFilters(filters: AudienceFilters): string {
  const parts: string[] = [];
  const join = (label: string, values: string[]) => {
    if (values.length) parts.push(`${label} ${values.join(' / ')}`);
  };
  join('campaign', filters.campaigns);
  join('form', filters.forms);
  join('source', filters.sources);
  join('stage', filters.pipelineStages);
  join('property', filters.propertyIds);
  join('list', filters.csvAudiences);
  if (filters.dateRange !== 'all') {
    parts.push(
      filters.dateRange === 'custom'
        ? `created ${filters.startDate ?? 'any time'} to ${filters.endDate ?? 'now'}`
        : `created in the last ${filters.dateRange}`
    );
  }
  if (!parts.length) return 'every lead on the account (no filters given)';
  return `${parts.join(` ${filters.matchMode === 'AND' ? 'AND' : 'OR'} `)}`;
}
