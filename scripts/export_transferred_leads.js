const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const gunheerId = 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab';

  // 1. Fetch exact transfer records from 2026-09-24T05:16:51.446072+00:00
  const { data: trans, error: transErr } = await supabase
    .from('lead_history')
    .select('lead_id, created_at, description')
    .eq('action_type', 'TRANSFER')
    .eq('created_at', '2026-09-24T05:16:51.446072+00:00');

  if (transErr) throw transErr;
  console.log('Total transfer records found:', trans.length);

  const leadIds = trans.map(t => t.lead_id);

  // 2. Fetch all leads from leads table
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, name, phone, email, pipeline_stage, status, ad_name, form_name, source, assigned_to, user_id, created_at, custom_fields, notes')
    .in('id', leadIds);

  if (leadsErr) throw leadsErr;
  console.log('Total leads found in DB:', leads.length);

  // 3. Verify assigned_to for all 116 leads
  const assignedToGunheer = leads.filter(l => l.assigned_to === gunheerId);
  const notAssignedToGunheer = leads.filter(l => l.assigned_to !== gunheerId);

  console.log('Leads currently assigned to Gunheer:', assignedToGunheer.length);
  console.log('Leads NOT assigned to Gunheer:', notAssignedToGunheer.length);

  // 4. Fetch Gunheer actions on these leads
  const { data: gunheerActions } = await supabase
    .from('lead_history')
    .select('lead_id, action_type, description, created_at')
    .eq('user_id', gunheerId)
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false });

  const actionsByLead = {};
  (gunheerActions || []).forEach(a => {
    if (!actionsByLead[a.lead_id]) actionsByLead[a.lead_id] = [];
    actionsByLead[a.lead_id].push(a);
  });

  // 5. Generate CSV content
  const headers = [
    'S_No',
    'Lead_ID',
    'Lead_Name',
    'Phone',
    'Email',
    'Pipeline_Stage',
    'Campaign_Ad_Name',
    'Form_Name',
    'Currently_Assigned_To',
    'Verified_In_Gunheer_CRM',
    'Gunheer_Contacted',
    'Gunheer_Latest_Action',
    'Direct_CRM_Link'
  ];

  function escapeCsv(val) {
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""').replace(/\r?\n/g, ' ');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str + '"';
    }
    return str;
  }

  const rows = [headers.join(',')];

  leads.forEach((l, idx) => {
    const leadActions = actionsByLead[l.id] || [];
    const contacted = leadActions.length > 0 ? 'YES' : 'NO';
    const latestAction = leadActions.length > 0 
      ? `[${leadActions[0].created_at}] ${leadActions[0].action_type}: ${leadActions[0].description}`
      : 'Not yet contacted by Gunheer';

    const row = [
      idx + 1,
      escapeCsv(l.id),
      escapeCsv(l.name || 'Unnamed Lead'),
      escapeCsv(l.phone || ''),
      escapeCsv(l.email || ''),
      escapeCsv(l.pipeline_stage || 'New Lead'),
      escapeCsv(l.ad_name || ''),
      escapeCsv(l.form_name || ''),
      escapeCsv(l.assigned_to === gunheerId ? 'Gunheer' : l.assigned_to),
      l.assigned_to === gunheerId ? 'YES' : 'NO',
      contacted,
      escapeCsv(latestAction),
      escapeCsv(`https://app.nobogent.com/dashboard/crm/${l.id}`)
    ];
    rows.push(row.join(','));
  });

  const csvContent = rows.join('\n');
  const outputPath = 'bluesquare_amish_to_gunheer_116_leads.csv';
  fs.writeFileSync(outputPath, csvContent, 'utf8');
  console.log('CSV written successfully to:', outputPath);
  console.log('File size in bytes:', fs.statSync(outputPath).size);
}

run().catch(console.error);
