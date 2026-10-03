const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectNobogent() {
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const childId = 'b1645a6d-4b73-41ef-a197-8247d0168905';

  // 1. Check user profile details (tokens, pages, pixels, ad accounts)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, business_name, role, selected_page_id, selected_page_token, facebook_token, ad_account_id, pixel_id, default_pixel_id')
    .eq('id', nobogentId)
    .single();

  console.log('=== NOBOGENT PROFILE ===');
  console.log({
    id: profile?.id,
    email: profile?.email,
    business_name: profile?.business_name,
    role: profile?.role,
    selected_page_id: profile?.selected_page_id,
    has_page_token: !!profile?.selected_page_token,
    has_facebook_token: !!profile?.facebook_token,
    ad_account_id: profile?.ad_account_id,
    pixel_id: profile?.pixel_id,
    default_pixel_id: profile?.default_pixel_id
  });

  // 2. Check campaigns in campaigns table
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*')
    .or(`user_id.eq.${nobogentId},user_id.eq.${childId}`);

  console.log('\n=== CAMPAIGNS IN DB FOR NOBOGENT ===');
  console.log(`Total campaigns: ${campaigns?.length || 0}`);
  campaigns?.forEach(c => {
    console.log(`- Campaign: "${c.name}" (ID: ${c.id}, Meta ID: ${c.meta_campaign_id}, Status: ${c.status})`);
  });

  // 3. Check all leads for Nobogent
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, name, phone, email, source, ad_name, form_id, form_name, campaign_id, created_at, custom_fields, notes, pixel_id, property_id')
    .or(`user_id.eq.${nobogentId},user_id.eq.${childId},assigned_to.eq.${nobogentId},assigned_to.eq.${childId}`)
    .order('created_at', { ascending: false });

  console.log(`\n=== TOTAL LEADS FOR NOBOGENT IN DB: ${leads?.length || 0} ===`);

  if (leads && leads.length > 0) {
    leads.forEach((l, idx) => {
      let cf = l.custom_fields;
      if (typeof cf === 'string') {
        try { cf = JSON.parse(cf); } catch(e) {}
      }
      console.log(`\n[Lead #${idx + 1}] Name: ${l.name} | Phone: ${l.phone} | Created: ${l.created_at}`);
      console.log(`  Source: ${l.source}`);
      console.log(`  Form Name: ${l.form_name} | Form ID: ${l.form_id}`);
      console.log(`  Ad Name: ${l.ad_name} | Campaign ID: ${l.campaign_id}`);
      console.log(`  Pixel ID: ${l.pixel_id}`);
      console.log('  Custom Fields:', JSON.stringify(cf, null, 2));
    });
  }

  // 4. Also check if there are ANY leads in the entire database with source like 'landing', 'website', 'web', 'lander', etc.
  const { data: landingLeads } = await supabase
    .from('leads')
    .select('id, name, phone, email, source, user_id, ad_name, form_id, form_name, created_at, custom_fields')
    .or('source.ilike.%land%,source.ilike.%web%,source.ilike.%site%,source.ilike.%form%')
    .order('created_at', { ascending: false })
    .limit(20);

  console.log(`\n=== SAMPLE LANDING/WEB LEADS ACROSS DB (limit 20) ===`);
  console.log(`Found: ${landingLeads?.length || 0}`);
  landingLeads?.forEach(l => {
    console.log(`- Lead: ${l.name} | Phone: ${l.phone} | User ID: ${l.user_id} | Source: ${l.source} | Form: ${l.form_name || l.form_id} | Ad: ${l.ad_name}`);
  });
}

inspectNobogent().catch(console.error);
