const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkManualFollowups() {
  const phones = [
    { name: 'Yadvinder Singh', phone: '9417371445' },
    { name: 'Nitish Bhardwaj', phone: '8607157777' },
    { name: 'Rohit Bakshi', phone: '9878808506' },
    { name: 'Dinesh Ahuja', phone: '9416029386' },
    { name: 'Ritu Rite', phone: '9317526229' },
    { name: 'Amber Singh', phone: '9501602786' },
    { name: 'A Sachdeva', phone: '9878017943' },
    // Also include other leads in the same campaign if any were manually followed up
    { name: 'Sunny Singh (D+I+B)', phone: '9779777997' },
    { name: 'Anita way (Broad)', phone: '8078695965' },
    { name: 'Aarav yadav (D+I+B)', phone: '7667592413' },
    { name: 'aaliya (D+I+B)', phone: '8757936200' },
    { name: 'Nishant Jain (D+I+B)', phone: '9565547736' },
    { name: 'sashish (D+I+B)', phone: '9882394823' },
    { name: 'Arvind Kumar (D+B)', phone: '9041016946' },
    { name: 'Amit singh (D+B)', phone: '8512451258' }
  ];

  for (const item of phones) {
    const { data: dbLeads } = await supabaseAdmin.from('leads').select('*').ilike('phone', `%${item.phone}%`);
    const lead = dbLeads?.[0];
    if (!lead) {
      console.log(`\n========================================`);
      console.log(`Lead: ${item.name} (${item.phone}) -> NOT FOUND IN CRM`);
      continue;
    }

    // Assignee name
    let assignee = 'Unassigned';
    if (lead.assigned_to) {
      const { data: prof } = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', lead.assigned_to).single();
      assignee = prof?.full_name || prof?.email;
    }

    console.log(`\n======================================================`);
    console.log(`LEAD: ${lead.name} | Phone: ${lead.phone}`);
    console.log(`Stage: ${lead.pipeline_stage} | Status: ${lead.status} | Assignee: ${assignee}`);
    console.log(`Ad Name: ${lead.ad_name} | Created At: ${lead.created_at}`);

    // Parse custom fields
    let cf = lead.custom_fields;
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
    }
    console.log(`Follow-up Count: ${cf?.followup_count || 0}`);
    console.log(`Last Follow-up Type: ${cf?.last_followup_type}`);
    console.log(`Last Follow-up At: ${cf?.last_followup_at}`);
    console.log(`Last Follow-up Remark: ${cf?.last_followup_remark}`);
    console.log(`Next Action: ${cf?.next_action_type} on ${cf?.next_action_date} (${cf?.next_action_remark || ''})`);

    // Fetch lead_history entries
    const { data: history } = await supabaseAdmin
      .from('lead_history')
      .select('*')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: true });

    console.log(`\n--- ALL ACTIVITY / TIMELINE LOGS (${history?.length || 0}) ---`);
    if (history && history.length > 0) {
      for (const h of history) {
        let agent = h.user_id;
        if (h.user_id) {
          const { data: prof } = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', h.user_id).single();
          if (prof) agent = `${prof.full_name || ''} <${prof.email}>`;
        }
        console.log(`[${h.created_at}] [${h.action_type}] by ${agent}:`);
        console.log(`   ${h.description}`);
      }
    }

    // Call logs in call_logs table
    const { data: callLogs } = await supabaseAdmin
      .from('call_logs')
      .select('*')
      .ilike('phone_number', `%${item.phone}%`);
    if (callLogs && callLogs.length > 0) {
      console.log(`\n--- CALL LOGS TABLE ENTRIES (${callLogs.length}) ---`);
      for (const cl of callLogs) {
        console.log(`[${cl.started_at}] Type: ${cl.call_type} | Duration: ${cl.duration}s | Status: ${cl.status}`);
      }
    }

    console.log(`\n--- FULL RAW CRM NOTES ---`);
    console.log(lead.notes || '(None)');
  }
}

checkManualFollowups().catch(console.error);
