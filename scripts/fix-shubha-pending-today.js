const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';

async function fixShubhaPendingAndToday() {
  console.log('=== Step 1: Clear all Overdue Pending Leads (< 2026-08-31) for Shubha ===');
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, phone, next_followup, custom_fields')
      .eq('assigned_to', SHUBHA_ID)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  const todayStr = '2026-08-31';
  let clearedPending = 0;

  for (const l of allLeads) {
    let cf = l.custom_fields;
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) {} }
    const nextDate = l.next_followup || cf?.next_action_date;
    if (!nextDate) continue;

    const d = new Date(nextDate);
    const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    // If in the past (Pending), clear it to 0
    if (istStr < todayStr) {
      if (cf) {
        delete cf.next_action_date;
        delete cf.next_action_type;
        delete cf.next_followup;
      }
      await supabase.from('leads').update({ next_followup: null, custom_fields: cf }).eq('id', l.id);
      clearedPending++;
    }
  }
  console.log(`✅ Cleared ${clearedPending} overdue pending leads (Pending is now 0).`);

  // Step 2: Ensure the 2 Today leads are active for Today
  console.log('\n=== Step 2: Ensure 2 Today Actions are Set for Today ===');
  const todayLeadIds = [
    'b59c1bac-00d1-4e12-8806-99b5c6437894', // Kumar Sharma
    '63173616-eae1-4743-8137-edf373a4c550'  // Lead noted "To call tommorow" on Aug 30
  ];

  const todayTimestamp = '2026-08-31T05:30:00.000Z'; // 11:00 AM IST

  for (const leadId of todayLeadIds) {
    const { data: lead } = await supabase.from('leads').select('id, name, custom_fields').eq('id', leadId).single();
    if (lead) {
      let cf = lead.custom_fields || {};
      if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) { cf = {}; } }
      cf.next_action_date = todayTimestamp;
      cf.next_action_type = 'Call';
      await supabase.from('leads').update({
        next_followup: todayTimestamp,
        custom_fields: cf
      }).eq('id', leadId);
      console.log(`✅ Set Today action for ${lead.name} (${leadId})`);
    }
  }

  // Step 3: Verify counts
  console.log('\n=== Final Counts for Shubha ===');
  let pCount = 0;
  let tCount = 0;
  let sCount = 0;

  page = 0;
  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, next_followup, custom_fields')
      .eq('assigned_to', SHUBHA_ID)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      let cf = l.custom_fields;
      if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) {} }
      const nextDate = l.next_followup || cf?.next_action_date;
      if (!nextDate) return;

      const d = new Date(nextDate);
      const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      if (istStr < todayStr) pCount++;
      else if (istStr === todayStr) tCount++;
      else sCount++;
    });
    page++;
    if (data.length < 1000) break;
  }

  console.log(`Pending (P): ${pCount}`);
  console.log(`Today (T): ${tCount}`);
  console.log(`Scheduled (S): ${sCount}`);
}

fixShubhaPendingAndToday().catch(console.error);
