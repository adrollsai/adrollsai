const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';

function parseNextAction(text) {
  if (!text) return null;
  
  // 1. Match 'Next Action: Call on 9/14/2026, 3:04:00 PM' or 'Next Action: Call on 8/31/2026, 2:00:00 PM'
  const match = text.match(/Next Action:\s*([A-Za-z]+)\s*on\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4}),?\s*([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*(am|pm)?/i);
  if (match) {
    const actionType = match[1];
    const month = parseInt(match[2], 10) - 1; // M/D/YYYY from toLocaleDateString en-US
    const day = parseInt(match[3], 10);
    let year = parseInt(match[4], 10);
    if (year < 100) year += 2000;
    let hour = parseInt(match[5], 10);
    const minute = parseInt(match[6], 10);
    const ampm = match[8]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const d = new Date(year, month, day, hour, minute);
    if (!isNaN(d.getTime())) {
      return { date: d.toISOString(), type: actionType };
    }
  }

  // 2. Match ISO date in notes: Next action scheduled for 2026-09-08T05:30:00.000Z (Call)
  const isoMatch = text.match(/Next action scheduled for\s*(\d{4}-\d{2}-\d{2}T[^\s\)]+)(?:\s*\(([^\)]+)\))?/i);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d.getTime())) {
      return { date: d.toISOString(), type: isoMatch[2] || 'Call' };
    }
  }

  return null;
}

async function restoreShubha() {
  const { data: history } = await supabase
    .from('lead_history')
    .select('*')
    .eq('user_id', SHUBHA_ID)
    .order('created_at', { ascending: false });

  console.log('Total history entries by Shubha:', history?.length);

  const leadScheduledMap = new Map();

  history.forEach(h => {
    if (!h.lead_id || leadScheduledMap.has(h.lead_id)) return;
    const parsed = parseNextAction(h.description);
    if (parsed) {
      leadScheduledMap.set(h.lead_id, {
        date: parsed.date,
        type: parsed.type,
        loggedAt: h.created_at,
        desc: h.description
      });
    }
  });

  // Also check lead notes for any scheduled followups logged by Shubha
  let page = 0;
  let allShubhaLeads = [];
  while (true) {
    const { data } = await supabase.from('leads').select('id, name, notes, custom_fields').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allShubhaLeads = allShubhaLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  allShubhaLeads.forEach(l => {
    if (leadScheduledMap.has(l.id)) return;
    const notes = l.notes || '';
    if ((notes.includes('Next action scheduled for') || notes.includes('Next Action:')) && (notes.includes('Shubha') || notes.includes('sbg9319@gmail.com'))) {
      const parsed = parseNextAction(notes);
      if (parsed) {
        leadScheduledMap.set(l.id, {
          date: parsed.date,
          type: parsed.type,
          loggedAt: l.created_at,
          desc: 'From Lead Notes'
        });
      }
    }
  });

  console.log('Total Real Scheduled Actions to Restore for Shubha:', leadScheduledMap.size);

  let restored = 0;
  const entries = Array.from(leadScheduledMap.entries());
  for (let i = 0; i < entries.length; i += 50) {
    const chunk = entries.slice(i, i + 50);
    await Promise.all(chunk.map(async ([leadId, sched]) => {
      const { data: lead } = await supabase.from('leads').select('id, custom_fields').eq('id', leadId).single();
      if (lead) {
        let cf = lead.custom_fields || {};
        if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) { cf = {}; } }
        cf.next_action_date = sched.date;
        cf.next_action_type = sched.type;

        await supabase.from('leads').update({
          next_followup: sched.date,
          custom_fields: cf
        }).eq('id', leadId);
        restored++;
      }
    }));
  }

  console.log(`Successfully restored ${restored} scheduled next actions for Shubha.`);

  // Today / Scheduled check in IST
  const todayStr = '2026-08-31';
  let todayCount = 0;
  let futureCount = 0;

  for (const [leadId, sched] of leadScheduledMap.entries()) {
    const d = new Date(sched.date);
    const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (istStr === todayStr) {
      todayCount++;
      console.log('TODAY ACTION:', sched.type, '|', sched.date, '|', sched.desc.slice(0, 90));
    } else if (istStr > todayStr) {
      futureCount++;
    }
  }

  console.log(`Shubha Today Scheduled Actions: ${todayCount}`);
  console.log(`Shubha Future Scheduled Actions: ${futureCount}`);
}

restoreShubha().catch(console.error);
