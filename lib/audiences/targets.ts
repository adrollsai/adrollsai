import {
  campaignNameOf,
  groupsOf,
  isInGroup,
  normalisePhone,
  type AudienceLead,
} from './filters';

/**
 * Who a campaign actually sends to.
 *
 * The WhatsApp broadcast route had this logic inline, and the Audience Maker had its own near-copy.
 * Both answered "does this lead belong?" — so a group could contain a lead the broadcast then
 * refused (no phone, WhatsApp disabled) while the UI still promised the full count. Here the answer
 * is one function, and the difference between "selected" and "reachable" is reported, not hidden.
 */

export interface AudienceGroupTarget {
  targetType: 'audience_group';
  audienceGroupName: string;
}

export interface CustomTarget {
  targetType: 'custom';
  csvAudiences?: string[];
  sources?: string[];
  pipelineStages?: string[];
  propertyIds?: string[];
  metaCampaigns?: string[];
}

export type AudienceTarget = AudienceGroupTarget | CustomTarget;

export interface RecipientCriteria {
  audienceFilter?: AudienceTarget | null;
  /** The older, single-value filters the UI still sends. */
  recipientStage?: string | null;
  recipientPropertyId?: string | null;
  recipientCsvAudience?: string | null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
}

/**
 * Does this lead match the audience being targeted?
 *
 * An audience group is matched by TAG (either storage), and a custom target requires every supplied
 * category to match — the UI's rule, kept. No filter at all means every lead, which is why the
 * caller is expected to say the number out loud before anything is sent.
 */
export function matchesAudienceTarget(lead: AudienceLead, criteria: RecipientCriteria): boolean {
  const target = criteria.audienceFilter ?? null;

  if (target?.targetType === 'audience_group') {
    return isInGroup(lead, target.audienceGroupName);
  }

  if (target?.targetType === 'custom') {
    if (list(target.csvAudiences).length) {
      const csvs = String(lead.csv_audience ?? '')
        .split(',')
        .map((s) => s.trim());
      if (!list(target.csvAudiences).some((aud) => csvs.includes(aud))) return false;
    }
    if (list(target.sources).length && !list(target.sources).includes(String(lead.source ?? ''))) return false;
    if (list(target.pipelineStages).length && !list(target.pipelineStages).includes(String(lead.pipeline_stage ?? ''))) return false;
    if (list(target.propertyIds).length && !list(target.propertyIds).includes(String(lead.property_id ?? ''))) return false;
    if (list(target.metaCampaigns).length) {
      const campaign = campaignNameOf(lead);
      if (!campaign || !list(target.metaCampaigns).includes(campaign)) return false;
    }
    return true;
  }

  if (criteria.recipientStage && criteria.recipientStage !== 'All') {
    if (String(lead.pipeline_stage ?? '') !== criteria.recipientStage) return false;
  }
  if (criteria.recipientPropertyId && String(lead.property_id ?? '') !== criteria.recipientPropertyId) return false;
  if (criteria.recipientCsvAudience) {
    const csvs = String(lead.csv_audience ?? '')
      .split(',')
      .map((s) => s.trim());
    if (!csvs.includes(criteria.recipientCsvAudience)) return false;
    // A lead tagged only through custom_fields.audience_groups still belongs to the group.
    if (!csvs.includes(criteria.recipientCsvAudience) && !groupsOf(lead).includes(criteria.recipientCsvAudience)) return false;
  }
  return true;
}

export interface SelectionSummary {
  selected: AudienceLead[];
  /** Matched the audience but cannot be messaged — said out loud rather than dropped in silence. */
  unreachable: { id: string; name: string | null; reason: string }[];
}

/** Select the recipients for a WhatsApp campaign, and say who could not be reached and why. */
export function selectCampaignRecipients(
  leads: AudienceLead[],
  criteria: RecipientCriteria,
  opts: { channel?: 'whatsapp' | 'call'; limit?: number } = {}
): SelectionSummary {
  const channel = opts.channel ?? 'whatsapp';
  const selected: AudienceLead[] = [];
  const unreachable: SelectionSummary['unreachable'] = [];

  for (const lead of leads) {
    if (!matchesAudienceTarget(lead, criteria)) continue;
    if (lead.whatsapp_enabled === false) {
      unreachable.push({ id: String(lead.id), name: lead.name ?? null, reason: 'WhatsApp is turned off for this lead' });
      continue;
    }
    if (!normalisePhone(lead.phone)) {
      unreachable.push({ id: String(lead.id), name: lead.name ?? null, reason: 'no usable phone number' });
      continue;
    }
    selected.push(lead);
    if (opts.limit && selected.length >= opts.limit) break;
  }

  return { selected, unreachable };
}

/** A sentence naming the audience, for a tool result or an approval card. */
export function describeTarget(criteria: RecipientCriteria): string {
  const target = criteria.audienceFilter ?? null;
  if (target?.targetType === 'audience_group') return `the audience group "${target.audienceGroupName}"`;
  if (target?.targetType === 'custom') {
    const parts: string[] = [];
    if (list(target.csvAudiences).length) parts.push(`list ${list(target.csvAudiences).join(' / ')}`);
    if (list(target.sources).length) parts.push(`source ${list(target.sources).join(' / ')}`);
    if (list(target.pipelineStages).length) parts.push(`stage ${list(target.pipelineStages).join(' / ')}`);
    if (list(target.propertyIds).length) parts.push(`property ${list(target.propertyIds).join(' / ')}`);
    if (list(target.metaCampaigns).length) parts.push(`campaign ${list(target.metaCampaigns).join(' / ')}`);
    return parts.length ? parts.join(' AND ') : 'every lead on the account';
  }
  if (criteria.recipientCsvAudience) return `the audience group "${criteria.recipientCsvAudience}"`;
  if (criteria.recipientStage && criteria.recipientStage !== 'All') return `every lead in stage ${criteria.recipientStage}`;
  if (criteria.recipientPropertyId) return `every lead for that property`;
  return 'every lead on the account';
}
