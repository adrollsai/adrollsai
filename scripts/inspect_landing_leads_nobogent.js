const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function printLanding() {
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const childId = 'b1645a6d-4b73-41ef-a197-8247d0168905';

  const { data: allLeads } = await supabase
    .from('leads')
    .select('*')
    .or(`user_id.eq.${nobogentId},user_id.eq.${childId},assigned_to.eq.${nobogentId},assigned_to.eq.${childId}`)
    .order('created_at', { ascending: false });

  const landingLeads = [];
  const instantLeads = [];

  allLeads?.forEach(l => {
    let cf = l.custom_fields;
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) { cf = {}; } }
    
    const src = (l.source || '').toLowerCase();
    const isLanding = src.includes('land') || src.includes('web') || src.includes('site') || cf?.landing_page || cf?.slug;
    const isInstant = l.form_id || l.facebook_lead_id || cf?.is_instant_form;

    if (isLanding) {
      landingLeads.push({ l, cf });
    }
    if (isInstant) {
      instantLeads.push({ l, cf });
    }
  });

  console.log(`=== SUMMARY FOR NOBOGENT ACCOUNT ===`);
  console.log(`Total Leads in Nobogent Account: ${allLeads?.length || 0}`);
  console.log(`Total Instant Form Leads: ${instantLeads.length}`);
  console.log(`Total Landing Page Leads: ${landingLeads.length}`);

  console.log(`\n=== DETAILS OF ALL LANDING PAGE LEADS (${landingLeads.length}) ===`);
  landingLeads.forEach(({ l, cf }, idx) => {
    console.log(`\n--- Landing Lead #${idx + 1} ---`);
    console.log(`ID: ${l.id}`);
    console.log(`Name: ${l.name}`);
    console.log(`Phone: ${l.phone}`);
    console.log(`Email: ${l.email || 'N/A'}`);
    console.log(`Created At: ${l.created_at} (${new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`);
    console.log(`Source: ${l.source}`);
    console.log(`Ad Name: ${l.ad_name || 'N/A'}`);
    console.log(`Campaign ID: ${l.campaign_id || 'N/A'}`);
    console.log(`Pipeline Stage: ${l.pipeline_stage || l.status}`);
    console.log(`Notes: ${l.notes || 'None'}`);
    console.log(`Custom Fields:`, JSON.stringify(cf, null, 2));
  });

  // Check landing_pages table to see what landing pages exist under Nobogent
  const { data: pages } = await supabase
    .from('landing_pages')
    .select('*')
    .or(`user_id.eq.${nobogentId},user_id.eq.${childId}`);

  console.log(`\n=== NOBOGENT LANDING PAGES CREATED IN PLATFORM (${pages?.length || 0}) ===`);
  pages?.forEach(p => {
    console.log(`- Page: "${p.title}" | Slug: "${p.slug}" | ID: ${p.id} | Views: ${p.views_count || 0} | Leads: ${p.leads_count || 0}`);
  });
}

printLanding().catch(console.error);
