const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalizePhone(p) {
  if (!p) return null;
  let digits = p.toString().replace(/[^0-9]/g, '');
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '+91' + digits.slice(1);
  if (digits.length > 10 && !digits.startsWith('91')) return '+' + digits;
  if (digits.length === 12) return '+' + digits;
  return digits.length >= 10 ? '+' + digits : null;
}

async function detailedAudit() {
  console.log('================ AUDITING EXISTING CLIENT NUMBERS ================');
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, business_name, role, contact_number, whatsapp_phone_number, whatsapp_personal_number');

  const clientPhoneSet = new Set();
  const clientDetails = [];

  // Identify clients: profiles that are NOT Nobogent internal admins
  const internalEmails = ['rchopra489@gmail.com', 'nobogent@gmail.com', 'meta-reviewer@nobogent.com'];
  
  profiles.forEach(p => {
    const isInternal = internalEmails.includes(p.email) || p.business_name?.toLowerCase() === 'nobogent';
    if (!isInternal) {
      const numbers = [p.contact_number, p.whatsapp_phone_number, p.whatsapp_personal_number].filter(Boolean);
      numbers.forEach(raw => {
        const norm = normalizePhone(raw);
        if (norm && !norm.includes('5556633659') && !norm.includes('9999999999')) {
          clientPhoneSet.add(norm);
          clientDetails.push({ name: p.business_name || p.email, phone: norm, role: p.role });
        }
      });
    }
  });

  console.log(`Identified ${clientDetails.length} client phone records (${clientPhoneSet.size} unique client numbers):`);
  clientDetails.forEach(c => console.log(`  - [${c.role}] ${c.name}: ${c.phone}`));

  console.log('\n================ AUDITING NOBOGENT LEADS ================');
  const nobogentIds = ['bc63c065-9bcc-4793-bedc-f0960406425b', 'b1645a6d-4b73-41ef-a197-8247d0168905'];
  
  let allLeads = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email, source, ad_name, form_id, form_name, campaign_id, user_id, assigned_to, created_at, custom_fields, notes, status, pipeline_stage, csv_audience')
      .or(`user_id.eq.${nobogentIds[0]},user_id.eq.${nobogentIds[1]},assigned_to.eq.${nobogentIds[0]},assigned_to.eq.${nobogentIds[1]}`)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`Total Nobogent Leads fetched: ${allLeads.length}`);

  // Categorize
  const csvRealtorLeads = [];
  const metaHiringLeads = [];
  const metaAgencyLeads = [];
  const metaProductLeads = [];
  const websiteInboundLeads = [];
  const otherLeads = [];

  allLeads.forEach(l => {
    const norm = normalizePhone(l.phone);
    const item = { ...l, normalizedPhone: norm };
    const src = (l.source || '').toLowerCase();
    const ad = (l.ad_name || '').toLowerCase();
    const form = (l.form_name || '').toLowerCase();
    const aud = (l.csv_audience || '').toLowerCase();

    // Check if CSV
    if (l.source === 'CSV Import' || l.csv_audience) {
      csvRealtorLeads.push(item);
    } else if (ad.includes('hiring') || form.includes('hiring') || ad.includes('sales rockstar')) {
      metaHiringLeads.push(item);
    } else if (ad.includes('agency owners') || form.includes('agency') || form.includes('smma') || ad.includes('scale past')) {
      metaAgencyLeads.push(item);
    } else if (
      src.includes('facebook') || src.includes('meta') || src.includes('whatsapp') ||
      l.campaign_id || l.ad_name || l.form_name || src.includes('hero') || src.includes('cta') || src.includes('landing')
    ) {
      metaProductLeads.push(item);
    } else {
      otherLeads.push(item);
    }
  });

  console.log('\n--- BREAKDOWN SUMMARY ---');
  console.log(`1. CSV Realtor Leads: ${csvRealtorLeads.length} total`);
  console.log(`2. Meta Hiring Leads (TO EXCLUDE): ${metaHiringLeads.length} total`);
  console.log(`3. Meta Agency Owners Leads: ${metaAgencyLeads.length} total`);
  console.log(`4. Meta Nobogent Product Leads: ${metaProductLeads.length} total`);
  console.log(`5. Other / Uncategorized Leads: ${otherLeads.length} total`);

  // Unique phone counts for CSV
  const csvPhones = new Set(csvRealtorLeads.map(l => l.normalizedPhone).filter(Boolean));
  console.log(`\nUnique phone numbers in CSV Realtor Leads: ${csvPhones.size}`);

  // Unique phone counts for Meta Product
  const metaProductPhones = new Set(metaProductLeads.map(l => l.normalizedPhone).filter(Boolean));
  console.log(`Unique phone numbers in Meta Nobogent Product Leads: ${metaProductPhones.size}`);

  // Unique phone counts for Meta Agency
  const metaAgencyPhones = new Set(metaAgencyLeads.map(l => l.normalizedPhone).filter(Boolean));
  console.log(`Unique phone numbers in Meta Agency Owners Leads: ${metaAgencyPhones.size}`);

  // Check overlap between CSV and Meta Product
  const overlap = [...csvPhones].filter(p => metaProductPhones.has(p));
  console.log(`Overlap between CSV and Meta Product: ${overlap.length}`);

  // Combined candidates without agency
  const combinedCandidatesNoAgency = new Set([...csvPhones, ...metaProductPhones]);
  console.log(`Combined unique candidates (CSV + Meta Product, excluding Agency): ${combinedCandidatesNoAgency.size}`);

  // Combined candidates with agency
  const combinedCandidatesWithAgency = new Set([...csvPhones, ...metaProductPhones, ...metaAgencyPhones]);
  console.log(`Combined unique candidates (CSV + Meta Product + Meta Agency): ${combinedCandidatesWithAgency.size}`);

  // Exclude client numbers
  const excludedClientsFound = [];
  clientPhoneSet.forEach(clientPhone => {
    if (combinedCandidatesWithAgency.has(clientPhone)) {
      excludedClientsFound.push(clientPhone);
    }
  });

  console.log(`\nClient numbers matched in lead database to be excluded: ${excludedClientsFound.length}`);
  excludedClientsFound.forEach(p => {
    const client = clientDetails.find(c => c.phone === p);
    console.log(`  - Excluded Client: ${client?.name} (${p})`);
  });

  // Net final counts
  const finalNoAgency = [...combinedCandidatesNoAgency].filter(p => !clientPhoneSet.has(p));
  const finalWithAgency = [...combinedCandidatesWithAgency].filter(p => !clientPhoneSet.has(p));

  console.log('\n================ FINAL AUDIT RESULT ================');
  console.log(`CSV Realtor unique numbers: ${[...csvPhones].filter(p => !clientPhoneSet.has(p)).length} (after client exclusions)`);
  console.log(`Meta Product unique numbers: ${[...metaProductPhones].filter(p => !clientPhoneSet.has(p)).length} (after client exclusions)`);
  console.log(`Meta Agency unique numbers: ${[...metaAgencyPhones].filter(p => !clientPhoneSet.has(p)).length} (after client exclusions)`);
  console.log(`\nTotal TARGET Audience (CSV + Meta Product): ${finalNoAgency.length}`);
  console.log(`Total TARGET Audience (CSV + Meta Product + Agency): ${finalWithAgency.length}`);

  // Detail on Meta Product Ads included
  console.log('\n--- Meta Product Ads Included: ---');
  const metaProductAdCounts = {};
  metaProductLeads.forEach(l => {
    const k = `${l.ad_name || 'NO_AD'} (Form: ${l.form_name || 'NO_FORM'}, Source: ${l.source})`;
    metaProductAdCounts[k] = (metaProductAdCounts[k] || 0) + 1;
  });
  Object.entries(metaProductAdCounts).sort((a,b) => b[1] - a[1]).forEach(([k, c]) => {
    console.log(`  [${c}] ${k}`);
  });

  // Detail on CSV Audiences included
  console.log('\n--- CSV Realtor Audiences Included: ---');
  const csvAudCounts = {};
  csvRealtorLeads.forEach(l => {
    const k = l.csv_audience || 'No csv_audience tag';
    csvAudCounts[k] = (csvAudCounts[k] || 0) + 1;
  });
  Object.entries(csvAudCounts).sort((a,b) => b[1] - a[1]).forEach(([k, c]) => {
    console.log(`  [${c}] ${k}`);
  });
}

detailedAudit().catch(console.error);

