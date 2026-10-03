const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function analyze() {
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const childId = 'b1645a6d-4b73-41ef-a197-8247d0168905';

  // Fetch all leads for Nobogent
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .or(`user_id.eq.${nobogentId},user_id.eq.${childId},assigned_to.eq.${nobogentId},assigned_to.eq.${childId}`)
    .order('created_at', { ascending: false });

  if (error || !leads) {
    console.error('Error fetching leads:', error);
    return;
  }

  console.log(`=== TOTAL NOBOGENT LEADS IN DATABASE: ${leads.length} ===\n`);

  const instantFormLeads = [];
  const landingPageLeads = [];
  const whatsappCtwaLeads = [];
  const otherLeads = [];

  for (const l of leads) {
    let cf = l.custom_fields;
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf); } catch(e) { cf = {}; }
    }
    const sourceLower = (l.source || '').toLowerCase();
    const hasFormId = !!(l.form_id || l.facebook_lead_id);
    const isInstantForm = hasFormId || cf?.is_instant_form === true || sourceLower.includes('instant') || (sourceLower.includes('facebook') && hasFormId);
    const isLanding = sourceLower.includes('land') || sourceLower.includes('web') || sourceLower.includes('site') || cf?.landing_page || cf?.slug || (l.notes && l.notes.includes('Landing Page'));
    const isWhatsApp = sourceLower.includes('whatsapp') || cf?.ctwa_clid || cf?.is_ctwa;

    if (isLanding) {
      landingPageLeads.push({ lead: l, cf });
    } else if (isInstantForm) {
      instantFormLeads.push({ lead: l, cf });
    } else if (isWhatsApp) {
      whatsappCtwaLeads.push({ lead: l, cf });
    } else {
      otherLeads.push({ lead: l, cf });
    }
  }

  console.log(`📊 BREAKDOWN BY DESTINATION / INGESTION CHANNEL:`);
  console.log(`- 🌐 Landing Page Leads: ${landingPageLeads.length}`);
  console.log(`- 📋 Instant Form (Meta Lead Ad) Leads: ${instantFormLeads.length}`);
  console.log(`- 💬 WhatsApp (CTWA) Leads: ${whatsappCtwaLeads.length}`);
  console.log(`- 📁 Other / Direct: ${otherLeads.length}`);

  console.log(`\n======================================================`);
  console.log(`🌐 ALL LANDING PAGE LEADS (${landingPageLeads.length}):`);
  console.log(`======================================================`);
  landingPageLeads.forEach((item, idx) => {
    const l = item.lead;
    const cf = item.cf;
    console.log(`\n[#${idx + 1}] Lead Name: "${l.name}" | Phone: ${l.phone} | Email: ${l.email || 'N/A'}`);
    console.log(`    Created At: ${l.created_at} (${new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`);
    console.log(`    Source Field: "${l.source}"`);
    console.log(`    Ad / Campaign Name: "${l.ad_name || 'N/A'}" | Campaign ID: "${l.campaign_id || 'N/A'}"`);
    console.log(`    Pipeline Stage: "${l.pipeline_stage || l.status}"`);
    console.log(`    Landing Page / Slug: "${cf?.landing_page_slug || cf?.landing_page_id || cf?.slug || l.source}"`);
    console.log(`    UTM / URL Details: ${JSON.stringify({
      utm_source: cf?.utm_source,
      utm_campaign: cf?.utm_campaign,
      utm_content: cf?.utm_content,
      source_url: cf?.source_url || cf?.page_url,
      referrer: cf?.referrer
    }, null, 2)}`);
  });

  console.log(`\n======================================================`);
  console.log(`📋 INSTANT FORM LEADS (${instantFormLeads.length}):`);
  console.log(`======================================================`);
  instantFormLeads.forEach((item, idx) => {
    const l = item.lead;
    console.log(`\n[#${idx + 1}] Lead Name: "${l.name}" | Phone: ${l.phone} | Created At: ${l.created_at}`);
    console.log(`    Form Name: "${l.form_name}" (ID: ${l.form_id})`);
    console.log(`    Ad Name: "${l.ad_name}" | Campaign ID: "${l.campaign_id}"`);
    console.log(`    Pipeline Stage: "${l.pipeline_stage || l.status}"`);
  });

  console.log(`\n======================================================`);
  console.log(`💬 WHATSAPP (CTWA) LEADS (${whatsappCtwaLeads.length}):`);
  console.log(`======================================================`);
  whatsappCtwaLeads.forEach((item, idx) => {
    const l = item.lead;
    console.log(`[#${idx + 1}] "${l.name}" (${l.phone}) - Created: ${l.created_at} - Ad: ${l.ad_name}`);
  });
}

analyze().catch(console.error);
