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
 * Helper to identify automated or generic DNP text lines
 */
function isGenericDnpText(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (t === 'call not picked (dnp)' || t === 'call not picked' || t === 'dnp' || t === 'did not pick') return true;
  if (t.startsWith('next action scheduled for') && !t.includes('remarks:')) return true;
  return false;
}

/**
 * Checks if the last interaction or status of the lead was DNP
 */
export function isLeadLastStatusDnp(lead: any): boolean {
  if (!lead) return false;
  const cf = parseCustomFields(lead.custom_fields);
  if (cf.last_call_dnp === true) return true;
  const stage = (lead.pipeline_stage || lead.status || '').toLowerCase();
  if (stage === 'never picked' || stage === 'dnp') return true;
  if (lead.notes && typeof lead.notes === 'string') {
    const firstNote = lead.notes.trim().split(/\n\n+|---+/)[0] || '';
    const lower = firstNote.toLowerCase();
    if (lower.includes('call not picked') || lower.includes('dnp') || lower.includes('did not pick')) {
      return true;
    }
  }
  return false;
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

      // Check if this entry is a DNP log
      const isDnpLog = lower.includes('call not picked') || lower.includes('dnp') || lower.includes('did not pick');

      // Extract timestamp if present in header, e.g. [📝 Followup (Call) - 24/8/2026, 3:20:01 pm by ...]
      let entryTimeStr: string | null = null;
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
          entryTimeStr = parsed.toISOString();
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

      let manualRemarkPortion = '';
      if (body.includes('Remarks:')) {
        const remIdx = body.indexOf('Remarks:');
        manualRemarkPortion = body.slice(remIdx + 8).trim();
      }

      // If it is a DNP log, only use it if it has an actual human written remark
      if (isDnpLog) {
        if (manualRemarkPortion && !isGenericDnpText(manualRemarkPortion)) {
          rawRemark = manualRemarkPortion;
          if (entryTimeStr) remarkTimeStr = entryTimeStr;
          break;
        }
        // Pure DNP log without extra manual remark: skip and look for previous human remark!
        continue;
      }

      const candidate = manualRemarkPortion || body || entry;
      if (candidate && !isGenericDnpText(candidate)) {
        rawRemark = candidate;
        if (entryTimeStr) remarkTimeStr = entryTimeStr;
        break; // Found newest valid manual remark!
      }
    }
  }

  // 2. Fallback to custom_fields.last_followup_remark or cf.last_remark (if not generic DNP text)
  if (!rawRemark) {
    const candidateRemark = (cf.last_followup_remark || cf.last_remark || lead.last_followup_remark || lead.last_call_remark || '').trim();
    if (candidateRemark && !isGenericDnpText(candidateRemark)) {
      rawRemark = candidateRemark;
      if (cf.last_followup_at) remarkTimeStr = cf.last_followup_at;
    }
  }

  // 3. Fallback to summary
  if (!rawRemark && lead.summary && typeof lead.summary === 'string' && lead.summary.trim()) {
    const sum = lead.summary.trim();
    if (!isGenericDnpText(sum)) {
      rawRemark = sum;
    }
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

/**
 * Robust extractor for the Next Action Remark.
 * Checks explicit custom fields, specific note tags, and falls back to the latest followup remark.
 */
export function getLeadNextActionRemark(lead: any): string | null {
  if (!lead) return null;
  const cf = parseCustomFields(lead.custom_fields);

  // 1. Explicit next action remark fields
  if (cf.next_action_remark && typeof cf.next_action_remark === 'string' && cf.next_action_remark.trim() && !isGenericDnpText(cf.next_action_remark)) {
    return cf.next_action_remark.trim();
  }
  if (cf.next_remarks && typeof cf.next_remarks === 'string' && cf.next_remarks.trim() && !isGenericDnpText(cf.next_remarks)) {
    return cf.next_remarks.trim();
  }
  if (lead.next_action_remark && typeof lead.next_action_remark === 'string' && lead.next_action_remark.trim() && !isGenericDnpText(lead.next_action_remark)) {
    return lead.next_action_remark.trim();
  }
  if (lead.next_remarks && typeof lead.next_remarks === 'string' && lead.next_remarks.trim() && !isGenericDnpText(lead.next_remarks)) {
    return lead.next_remarks.trim();
  }

  // 2. Scan lead.notes for explicit Next Action remark patterns
  if (lead.notes && typeof lead.notes === 'string' && lead.notes.trim()) {
    const notesStr = lead.notes.trim();

    const patterns = [
      /next action note:\s*([^.\n\]]+)/i,
      /next action remark:\s*([^.\n\]]+)/i,
      /next remarks?:\s*([^.\n\]]+)/i,
      /\|\s*Next:\s*([^.\n\]]+)/i,
      /\[Next Action\]:\s*([^\n]+)/i
    ];

    for (const pattern of patterns) {
      const match = notesStr.match(pattern);
      if (match && match[1] && match[1].trim() && !isGenericDnpText(match[1])) {
        return match[1].trim();
      }
    }

    // 3. Fallback: Check the latest followup note entry (which was entered when setting the action)
    const entries = notesStr.split(/\n\n+|---+|\n(?=\[\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i].trim();
      if (!entry) continue;
      const lower = entry.toLowerCase();

      // Skip opening or non-followup headers
      if (
        lower.startsWith('[opening remarks]') ||
        lower.startsWith('advertisment') ||
        lower.startsWith('[followups taken]') ||
        lower.startsWith('lead created from')
      ) {
        continue;
      }

      if (isGenericDnpText(entry)) continue;

      let body = entry.includes(']:') ? entry.split(']:').slice(1).join(']:').trim() : entry;
      if (body.startsWith('Stage:')) {
        const dotIdx = body.indexOf('.');
        if (dotIdx !== -1) body = body.slice(dotIdx + 1).trim();
      }
      if (body.startsWith('Status:')) {
        const dotIdx = body.indexOf('.');
        if (dotIdx !== -1) body = body.slice(dotIdx + 1).trim();
      }

      let manualPortion = '';
      if (body.includes('Remarks:')) {
        const rIdx = body.indexOf('Remarks:');
        manualPortion = body.slice(rIdx + 8).trim();
      }

      const candidate = (manualPortion || body).trim();
      if (candidate && !isGenericDnpText(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
