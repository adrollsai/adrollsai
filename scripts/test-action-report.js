const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const OWNER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

function parseActionDateFromText(text) {
  if (!text) return null;
  
  // 1. Match [Followup (Type) - DD/MM/YYYY, HH:MM:SS am/pm] or [Call Not Picked - DNP (DD/MM/YYYY, HH:MM:SS)]
  const bracketMatch = text.match(/\[(?:📝\s*Followup[^\-\]]*|⚠️\s*Call Not Picked[^\-\]]*)\s*-\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})/i);
  if (bracketMatch) {
    const day = parseInt(bracketMatch[1], 10);
    const month = parseInt(bracketMatch[2], 10) - 1;
    let year = parseInt(bracketMatch[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. Match Workveu format: 'Call on DD/MM/YYYY' or 'Call Not Picked on DD/MM/YYYY'
  const workveuMatch = text.match(/(?:Call on|Call Not Picked on|Follow up Date\s*:)\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})/i);
  if (workveuMatch) {
    const day = parseInt(workveuMatch[1], 10);
    const month = parseInt(workveuMatch[2], 10) - 1;
    let year = parseInt(workveuMatch[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

async function testActionReportCounts() {
  const { data: team } = await supabase.from('profiles').select('id, full_name, email').or('parent_id.eq.' + OWNER_ID + ',agency_id.eq.' + OWNER_ID + ',id.eq.' + OWNER_ID);
  const teamIds = team.map(t => t.id);

  // Fetch all leads
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('id, name, phone, assigned_to, user_id, notes, custom_fields').in('user_id', teamIds).order('id').range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  // Fetch all history
  let allHistory = [];
  page = 0;
  while (true) {
    const { data } = await supabase.from('lead_history').select('id, lead_id, user_id, action_type, description, created_at').in('user_id', teamIds).order('created_at', { ascending: false }).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allHistory = allHistory.concat(data);
    page++;
    if (data.length < 1000 || page >= 40) break;
  }

  console.log('Total leads:', allLeads.length, '| Total history:', allHistory.length);

  // Today filter: 2026-08-31 in IST
  const todayStr = '2026-08-31';

  const isToday = (d) => {
    if (!d) return false;
    const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
    return ist.toISOString().startsWith(todayStr);
  };

  const repActions = {};
  team.forEach(t => {
    repActions[t.id] = { name: t.full_name || t.email, calls: 0, site_visits: 0, whatsapp: 0, meetings: 0, dnp: 0, total: 0 };
  });

  const seenActionKeys = new Set();

  // 1. Process History
  allHistory.forEach(h => {
    const type = (h.action_type || '').toUpperCase();
    const desc = (h.description || '').toLowerCase();
    if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT', 'STAGE_CHANGE', 'ASSIGNMENT', 'NOTE'].includes(type)) return;
    if (desc.includes('facebook ad submission') || desc.includes('reopened from facebook') || desc.includes('bulk transferred')) return;

    const parsedDate = parseActionDateFromText(h.description);
    const effectiveDate = parsedDate || (h.created_at ? new Date(h.created_at) : null);

    if (!isToday(effectiveDate)) return;

    let cat = null;
    if (type === 'DNP' || desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) cat = 'dnp';
    else if (type === 'SITE_VISIT' || desc.includes('site visit') || desc.includes('visit done') || desc.includes('revisit')) cat = 'site_visits';
    else if (type === 'MEETING' || desc.includes('meeting')) cat = 'meetings';
    else if (type === 'WHATSAPP' || desc.includes('whatsapp') || desc.includes('message sent')) cat = 'whatsapp';
    else if (['CALL_FEEDBACK', 'CALL', 'OUTBOUND_CALL', 'CALL_LOG', 'FOLLOWUP', 'REMARK'].includes(type) || desc.includes('call') || desc.includes('followup') || desc.includes('feedback')) cat = 'calls';

    if (cat && repActions[h.user_id]) {
      const dedupKey = h.lead_id + '_' + cat + '_' + effectiveDate.toISOString().slice(0, 13);
      if (!seenActionKeys.has(dedupKey)) {
        seenActionKeys.add(dedupKey);
        repActions[h.user_id][cat]++;
        repActions[h.user_id].total++;
      }
    }
  });

  // 2. Process Notes blocks directly from Leads
  allLeads.forEach(l => {
    const notes = l.notes || '';
    if (!notes.includes('31/8/2026') && !notes.includes('31/08/2026') && !notes.includes('2026-08-31')) return;

    const chunks = notes.split(/(?=\[(?:📝|⚠️))/);
    chunks.forEach(chunk => {
      const parsedDate = parseActionDateFromText(chunk);
      if (!isToday(parsedDate)) return;

      const repMatch = chunk.match(/by\s+([^\]\:\n]+)/i);
      const repName = repMatch ? repMatch[1].trim().toLowerCase() : '';
      const matchedRep = team.find(t => {
        const fn = (t.full_name || '').toLowerCase();
        const em = t.email.toLowerCase();
        return (fn && repName.includes(fn)) || (fn && fn.includes(repName)) || (em && repName.includes(em));
      }) || (l.assigned_to ? team.find(t => t.id === l.assigned_to) : null);

      if (!matchedRep) return;

      const lowerChunk = chunk.toLowerCase();
      let cat = null;
      if (lowerChunk.includes('dnp') || lowerChunk.includes('not picked') || lowerChunk.includes('did not pick')) cat = 'dnp';
      else if (lowerChunk.includes('site visit') || lowerChunk.includes('visit done') || lowerChunk.includes('revisit')) cat = 'site_visits';
      else if (lowerChunk.includes('meeting')) cat = 'meetings';
      else if (lowerChunk.includes('whatsapp')) cat = 'whatsapp';
      else if (lowerChunk.includes('call') || lowerChunk.includes('followup') || lowerChunk.includes('feedback')) cat = 'calls';

      if (cat && repActions[matchedRep.id]) {
        const dedupKey = l.id + '_' + cat + '_' + parsedDate.toISOString().slice(0, 13);
        if (!seenActionKeys.has(dedupKey)) {
          seenActionKeys.add(dedupKey);
          repActions[matchedRep.id][cat]++;
          repActions[matchedRep.id].total++;
        }
      }
    });
  });

  console.log('=== CALCULATED AGENT ACTIONS TODAY ===');
  Object.values(repActions).filter(r => r.total > 0).forEach(r => {
    console.log(r.name.padEnd(20), '| Total:', r.total, '| Calls:', r.calls, '| Visits:', r.site_visits, '| WhatsApp:', r.whatsapp, '| Meetings:', r.meetings, '| DNP:', r.dnp);
  });
  console.log('Munender total actions today:', repActions['17cd53d4-fed6-4d71-87c3-ad69ab052553']?.total);
}
testActionReportCounts();
