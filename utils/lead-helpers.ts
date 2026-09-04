/**
 * Centralized Lead Presentation & Computed Attributes Helper
 * Powers CRM List/Card Views, Analytics Action Manager, and Lead Details.
 */

export function parseCustomFields(cf: any): Record<string, any> {
  if (!cf) return {};
  if (typeof cf === 'object' && cf !== null) return cf;
  if (typeof cf === 'string') {
    try {
      let parsed = JSON.parse(cf);
      while (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      return parsed || {};
    } catch (e) {
      return {};
    }
  }
  return {};
}

/**
 * Checks if a lead has visited or had a visit conducted
 */
export function hasLeadVisited(lead: any): boolean {
  if (!lead) return false;
  const cf = parseCustomFields(lead.custom_fields);

  if (cf.has_visited === true || cf.visited === true) return true;

  const stage = (lead.pipeline_stage || lead.status || '').toLowerCase().trim();
  if (
    !stage.includes('planned') && 
    !stage.includes('scheduled') && 
    (
      stage.includes('visit done') || 
      stage === 'visited' || 
      stage.includes('revisit done') || 
      stage.includes('re-visited') ||
      stage.includes('appointment done') || 
      stage.includes('site visit done')
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Computes total followups taken on this lead
 */
export function getLeadFollowupCount(lead: any): number {
  if (!lead) return 0;
  const cf = parseCustomFields(lead.custom_fields);

  // 1. Explicit followup count field
  if (cf.followup_count !== undefined && cf.followup_count !== null && Number(cf.followup_count) > 0) {
    return Number(cf.followup_count);
  }
  if (cf.followups_count !== undefined && cf.followups_count !== null && Number(cf.followups_count) > 0) {
    return Number(cf.followups_count);
  }
  if (lead.followup_count !== undefined && lead.followup_count !== null && Number(lead.followup_count) > 0) {
    return Number(lead.followup_count);
  }

  // 2. Count distinct followup entries from lead.notes
  if (lead.notes && typeof lead.notes === 'string') {
    const entries = lead.notes.trim().split(/\n\n+/);
    const count = entries.filter((e: string) => {
      const text = e.trim().toLowerCase();
      if (!text) return false;
      if (
        text.startsWith('[opening remarks]') || 
        text.startsWith('advertisment') || 
        text.startsWith('ad name') || 
        text.startsWith('lead created from')
      ) {
        return false;
      }
      return (
        text.includes('followup') || 
        text.includes('call') || 
        text.includes('dnp') || 
        text.includes('visit') || 
        text.includes('remark') || 
        text.includes(']:')
      );
    }).length;

    return count;
  }

  return 0;
}

/**
 * Computes reopen count for this lead
 */
export function getLeadReopenCount(lead: any): number {
  if (!lead) return 0;
  const cf = parseCustomFields(lead.custom_fields);

  if (cf.reopened_count !== undefined && cf.reopened_count !== null && Number(cf.reopened_count) > 0) {
    return Number(cf.reopened_count);
  }
  if (Array.isArray(cf.reopened_sources) && cf.reopened_sources.length > 0) {
    return cf.reopened_sources.length;
  }
  if (lead.reopened_count !== undefined && lead.reopened_count !== null && Number(lead.reopened_count) > 0) {
    return Number(lead.reopened_count);
  }

  return 0;
}

/**
 * Extracts the latest manual/followup remark (strictly prioritizing the newest note, not the oldest).
 */
export function getLeadLatestRemark(lead: any, currentRole?: string): { remark: string | null; formattedTime: string; timestamp: number } {
  if (!lead) return { remark: null, formattedTime: '', timestamp: 0 };
  const cf = parseCustomFields(lead.custom_fields);

  const isAgent = currentRole === 'agent';
  const cutoff = cf.history_visible_from;
  const cutoffTime = cutoff ? new Date(cutoff).getTime() : null;

  let rawRemark: string | null = null;
  let remarkTimeStr: string | null = null;

  // 1. Scan lead.notes from the TOP (index 0) forward (newest remarks are prepended!)
  if (lead.notes && typeof lead.notes === 'string' && lead.notes.trim()) {
    const cleaned = lead.notes.trim();
    const entries = cleaned.split(/\n\n+|---+|\n(?=\[\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i].trim();
      if (!entry) continue;
      const lower = entry.toLowerCase();

      // Skip system or opening entries
      if (
        lower.startsWith('[opening remarks]') || 
        lower.startsWith('advertisment') || 
        lower.startsWith('[followups taken]') || 
        lower.startsWith('lead created from')
      ) {
        continue;
      }

      // Extract timestamp if present in header, e.g. [📝 Followup (Call) - 24/8/2026, 3:20:01 pm by ...]
      const timeMatch = entry.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?)?/i);
      if (timeMatch) {
        const [_, d, m, y, h, min, ampm] = timeMatch;
        let hour = h ? parseInt(h, 10) : 0;
        if (ampm) {
          if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
          if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
        }
        const parsed = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hour, min ? parseInt(min, 10) : 0);
        if (!isNaN(parsed.getTime())) {
          remarkTimeStr = parsed.toISOString();
        }
      }

      // Extract clean body
      let body = entry.includes(']:') ? entry.split(']:').slice(1).join(']:').trim() : entry;
      if (body.startsWith('Stage:')) {
        const dotIdx = body.indexOf('.');
        if (dotIdx !== -1) body = body.slice(dotIdx + 1).trim();
      }
      if (body.startsWith('Status:')) {
        const dotIdx = body.indexOf('.');
        if (dotIdx !== -1) body = body.slice(dotIdx + 1).trim();
      }
      if (body.includes('Remarks:')) {
        const remIdx = body.indexOf('Remarks:');
        body = body.slice(remIdx + 8).trim();
      }

      rawRemark = body || entry;
      break; // Found newest valid remark!
    }
  }

  // 2. Fallback to custom_fields.last_followup_remark or cf.last_remark
  if (!rawRemark) {
    rawRemark = (cf.last_followup_remark || cf.last_remark || lead.last_followup_remark || lead.last_call_remark || '').trim() || null;
    if (cf.last_followup_at) remarkTimeStr = cf.last_followup_at;
  }

  // 3. Fallback to summary
  if (!rawRemark && lead.summary && typeof lead.summary === 'string' && lead.summary.trim()) {
    rawRemark = lead.summary.trim();
  }

  if (!remarkTimeStr) {
    if (cf.last_followup_at) remarkTimeStr = cf.last_followup_at;
    else if (cf.last_action_date) remarkTimeStr = cf.last_action_date;
    else if (lead.last_call_at) remarkTimeStr = lead.last_call_at;
    else if (lead.updated_at && rawRemark) remarkTimeStr = lead.updated_at;
  }

  // If agent role and cutoff is active, verify remark timestamp is post-cutoff
  if (isAgent && cutoffTime && remarkTimeStr) {
    const t = new Date(remarkTimeStr).getTime();
    if (t < cutoffTime) {
      return { remark: null, formattedTime: '', timestamp: 0 };
    }
  }

  let formattedTime = '';
  let timestamp = 0;
  if (remarkTimeStr) {
    try {
      const d = new Date(remarkTimeStr);
      if (!isNaN(d.getTime())) {
        timestamp = d.getTime();
        formattedTime = d.toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }
    } catch (e) {}
  }

  return { remark: rawRemark, formattedTime, timestamp };
}
