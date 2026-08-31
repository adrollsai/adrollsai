const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const OWNER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

function parseActionDate(text, fallbackCreatedAt) {
  if (text) {
    // 1. Bracket notes format: [Followup (Call) - 31/8/2026, 12:10:24 pm] or [Call Not Picked - DNP (31/8/2026...)]
    const bracketMatch = text.match(/\[(?:📝\s*Followup[^\-\]]*|⚠️\s*Call Not Picked[^\-\]]*)\s*-\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})/i);
    if (bracketMatch) {
      const day = parseInt(bracketMatch[1], 10);
      const month = parseInt(bracketMatch[2], 10) - 1;
      let year = parseInt(bracketMatch[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }

    // 2. Workveu historical logs: 'Call on 30/07/2026' or 'Call Not Picked on 30/07/2026' or 'Follow up Date: 30/07/2026'
    const workveuMatch = text.match(/(?:Call on|Call Not Picked on|Follow up Date\s*:)\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})/i);
    if (workveuMatch) {
      const day = parseInt(workveuMatch[1], 10);
      const month = parseInt(workveuMatch[2], 10) - 1;
      let year = parseInt(workveuMatch[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  if (fallbackCreatedAt) {
    const d = new Date(fallbackCreatedAt);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function classifyAction(h) {
  const type = (h.action_type || '').toUpperCase();
  const desc = (h.description || '').toLowerCase();
  
  // Exclude purely automated system imports/webhooks
  if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT', 'ASSIGNMENT'].includes(type)) return null;
  if (desc.includes('facebook ad submission') || desc.includes('reopened from facebook') || desc.includes('bulk transferred') || desc.includes('transferred from')) return null;

  if (type === 'DNP' || desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) return 'dnp';
  if (type === 'SITE_VISIT' || desc.includes('site visit') || desc.includes('visit done') || desc.includes('revisit') || desc.includes('visit planned') || desc.includes('moved to visit')) return 'site_visits';
  if (type === 'MEETING' || desc.includes('meeting') || desc.includes('moved to meeting')) return 'meetings';
  if (type === 'WHATSAPP' || desc.includes('whatsapp') || desc.includes('message sent')) return 'whatsapp';
  
  // Any stage change, note, followup, call, or manual update counts as a call/followup attempt!
  return 'calls';
}

async function testActionReportCounts() {
  const { data: team } = await supabase.from('profiles').select('id, full_name, email').or('parent_id.eq.' + OWNER_ID + ',agency_id.eq.' + OWNER_ID + ',id.eq.' + OWNER_ID);
  const teamIds = team.map(t => t.id);

  // Fetch all leads
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('id, name, phone, assigned_to, user_id, notes, custom_fields, last_call_at').in('user_id', teamIds).order('id').range(page * 1000, (page + 1) * 1000 - 1);
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

  // 1. Process History Entries
  allHistory.forEach(h => {
    const cat = classifyAction(h);
    if (!cat) return;
    const effectiveDate = parseActionDate(h.description, h.created_at);
    if (!isToday(effectiveDate)) return;

    if (repActions[h.user_id]) {
      const dateKey = effectiveDate ? effectiveDate.toISOString().slice(0, 13) : h.id;
      const dedupKey = `${h.lead_id || h.id}_${cat}_${dateKey}`;
      if (!seenActionKeys.has(dedupKey)) {
        seenActionKeys.add(dedupKey);
        repActions[h.user_id][cat]++;
        repActions[h.user_id].total++;
      }
    }
  });

  // 2. Process Lead Notes Blocks (to guarantee zero missed followups)
  allLeads.forEach(l => {
    const notes = l.notes || '';
    if (notes.includes('[📝') || notes.includes('[⚠️')) {
      const chunks = notes.split(/(?=\[(?:📝|⚠️))/);
      chunks.forEach(chunk => {
        const effectiveDate = parseActionDate(chunk);
        if (!effectiveDate || !isToday(effectiveDate)) return;

        const repMatch = chunk.match(/by\s+([^\]\:\n]+)/i);
        const repName = repMatch ? repMatch[1].trim().toLowerCase() : '';
        const matchedRep = team.find(t => {
          const fn = (t.full_name || '').toLowerCase();
          const em = t.email.toLowerCase();
          return (fn && repName.includes(fn)) || (fn && fn.includes(repName)) || (em && repName.includes(em));
        }) || (l.assigned_to ? team.find(t => t.id === l.assigned_to) : null);

        if (!matchedRep) return;

        const lowerChunk = chunk.toLowerCase();
        let cat = 'calls';
        if (lowerChunk.includes('dnp') || lowerChunk.includes('not picked') || lowerChunk.includes('did not pick')) cat = 'dnp';
        else if (lowerChunk.includes('site visit') || lowerChunk.includes('visit done') || lowerChunk.includes('revisit')) cat = 'site_visits';
        else if (lowerChunk.includes('meeting')) cat = 'meetings';
        else if (lowerChunk.includes('whatsapp')) cat = 'whatsapp';

        if (repActions[matchedRep.id]) {
          const dateKey = effectiveDate.toISOString().slice(0, 13);
          const dedupKey = `${l.id}_${cat}_${dateKey}`;
          if (!seenActionKeys.has(dedupKey)) {
            seenActionKeys.add(dedupKey);
            repActions[matchedRep.id][cat]++;
            repActions[matchedRep.id].total++;
          }
        }
      });
    }

    // 3. Process Custom Fields Followups Array
    let cf = l.custom_fields;
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }
    if (cf && Array.isArray(cf.followups)) {
      cf.followups.forEach(f => {
        const fDate = f.date ? new Date(f.date) : parseActionDate(f.note);
        if (!fDate || !isToday(fDate)) return;

        const repName = (f.rep_name || f.by || '').toLowerCase();
        const matchedRep = team.find(t => {
          const fn = (t.full_name || '').toLowerCase();
          const em = t.email.toLowerCase();
          return (fn && repName.includes(fn)) || (fn && fn.includes(repName)) || (em && repName.includes(em));
        }) || (l.assigned_to ? team.find(t => t.id === l.assigned_to) : null);

        if (!matchedRep) return;

        let cat = 'calls';
        const fType = (f.type || f.stage || '').toLowerCase();
        if (fType.includes('dnp') || fType.includes('not picked')) cat = 'dnp';
        else if (fType.includes('visit')) cat = 'site_visits';
        else if (fType.includes('meeting')) cat = 'meetings';
        else if (fType.includes('whatsapp')) cat = 'whatsapp';

        if (repActions[matchedRep.id]) {
          const dateKey = fDate.toISOString().slice(0, 13);
          const dedupKey = `${l.id}_${cat}_${dateKey}`;
          if (!seenActionKeys.has(dedupKey)) {
            seenActionKeys.add(dedupKey);
            repActions[matchedRep.id][cat]++;
            repActions[matchedRep.id].total++;
          }
        }
      });
    }
  });

  console.log('=== ROBUST AGENT ACTIONS TODAY (ALL CHANNELS) ===');
  Object.values(repActions).filter(r => r.total > 0).forEach(r => {
    console.log(r.name.padEnd(20), '| Total:', r.total, '| Calls:', r.calls, '| Visits:', r.site_visits, '| WhatsApp:', r.whatsapp, '| Meetings:', r.meetings, '| DNP:', r.dnp);
  });
  console.log('Munender total actions today:', repActions['17cd53d4-fed6-4d71-87c3-ad69ab052553']?.total);
}
testActionReportCounts();
