const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';

async function findTodayAndPending() {
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, phone, notes, next_followup, custom_fields, created_at')
      .eq('assigned_to', SHUBHA_ID)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  const todayStr = '2026-08-31';
  const pendingLeads = [];
  const todayLeads = [];
  const scheduledLeads = [];

  allLeads.forEach(l => {
    let cf = l.custom_fields;
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) {} }
    const nextDate = l.next_followup || cf?.next_action_date;
    if (!nextDate) return;

    const d = new Date(nextDate);
    const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    if (istStr < todayStr) {
      pendingLeads.push({ id: l.id, name: l.name, phone: l.phone, nextDate, notes: l.notes?.slice(0, 100) });
    } else if (istStr === todayStr) {
      todayLeads.push({ id: l.id, name: l.name, phone: l.phone, nextDate, notes: l.notes?.slice(0, 100) });
    } else {
      scheduledLeads.push({ id: l.id, name: l.name, phone: l.phone, nextDate });
    }
  });

  console.log('--- 11 PENDING LEADS (< 2026-08-31) ---');
  console.log('Count:', pendingLeads.length);
  pendingLeads.forEach(p => console.log(p.id, '|', p.name, '|', p.nextDate, '|', p.notes?.replace(/\n/g, ' ')));

  console.log('\n--- TODAY LEADS (2026-08-31) ---');
  console.log('Count:', todayLeads.length);
  todayLeads.forEach(t => console.log(t.id, '|', t.name, '|', t.nextDate, '|', t.notes?.replace(/\n/g, ' ')));

  console.log('\n--- SEARCHING FOR SHUBHA SECOND TODAY LEAD IN HISTORY ---');
  const { data: hist } = await supabase.from('lead_history').select('*').eq('user_id', SHUBHA_ID).gte('created_at', '2026-08-28T00:00:00.000Z');
  hist.forEach(h => {
    const desc = h.description || '';
    if (desc.toLowerCase().includes('tomorrow') || desc.includes('31/8') || desc.includes('31/08') || desc.includes('8/31') || desc.includes('today')) {
      console.log('Potential Today History:', h.created_at, '| Lead ID:', h.lead_id, '|', desc);
    }
  });
}

findTodayAndPending().catch(console.error);
