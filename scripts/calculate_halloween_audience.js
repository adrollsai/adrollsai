const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function cleanPhone(raw) {
  if (!raw) return null;
  let digits = raw.toString().replace(/[^0-9]/g, '');
  if (!digits || digits.length < 10) return null;
  // If Indian 10 digits
  if (digits.length === 10) {
    if (['6','7','8','9'].includes(digits[0])) return '91' + digits;
    return null;
  }
  // If 11 digits starting with 0
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
    if (['6','7','8','9'].includes(digits[0])) return '91' + digits;
  }
  // If 12 digits starting with 91
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  // International (e.g. UAE 971..., US 1..., etc.)
  if (digits.length >= 11 && (digits.startsWith('971') || digits.startsWith('1') || digits.startsWith('44'))) {
    return digits;
  }
  return digits;
}

async function fullCalculation() {
  // 1. Get all profiles to build client exclusion list
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, business_name, role, contact_number, whatsapp_phone_number, whatsapp_personal_number');

  const internalEmails = ['rchopra489@gmail.com', 'nobogent@gmail.com', 'meta-reviewer@nobogent.com'];
  const clientExclusionMap = new Map(); // phone -> client info

  profiles.forEach(p => {
    const isInternal = internalEmails.includes(p.email) || p.business_name?.toLowerCase() === 'nobogent';
    if (!isInternal) {
      [p.contact_number, p.whatsapp_phone_number, p.whatsapp_personal_number].forEach(raw => {
        const cp = cleanPhone(raw);
        if (cp && !cp.includes('5556633659') && !cp.includes('9999999999')) {
          clientExclusionMap.set(cp, {
            name: p.business_name || p.email,
            email: p.email,
            role: p.role,
            phone: cp
          });
        }
      });
    }
  });

  console.log(`Loaded ${clientExclusionMap.size} unique client exclusion numbers.`);

  // 2. Fetch all Nobogent leads
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

  console.log(`Total Nobogent leads: ${allLeads.length}`);

  // Categorize leads
  const categories = {
    csvRealtors: [],
    metaProduct: [],
    metaHiring: [],
    metaAgencyOwners: [],
    otherWebsite: []
  };

  allLeads.forEach(l => {
    const cp = cleanPhone(l.phone);
    const item = { ...l, cleanedPhone: cp };

    const ad = (l.ad_name || '').toLowerCase();
    const form = (l.form_name || '').toLowerCase();
    const src = (l.source || '').toLowerCase();
    const aud = (l.csv_audience || '').toLowerCase();

    // Check Hiring first
    if (ad.includes('hiring') || form.includes('hiring') || ad.includes('sales rockstar') || src.includes('hiring')) {
      categories.metaHiring.push(item);
    } else if (ad.includes('agency owners') || form.includes('agency') || form.includes('smma') || ad.includes('scale past') || src.includes('partner')) {
      categories.metaAgencyOwners.push(item);
    } else if (l.source === 'CSV Import' || l.csv_audience) {
      categories.csvRealtors.push(item);
    } else if (
      src.includes('facebook') || src.includes('meta') || src.includes('whatsapp') ||
      l.campaign_id || l.ad_name || l.form_name
    ) {
      categories.metaProduct.push(item);
    } else {
      categories.otherWebsite.push(item);
    }
  });

  console.log('\n--- CATEGORY ROW COUNTS ---');
  console.log(`CSV Realtor Leads: ${categories.csvRealtors.length}`);
  console.log(`Meta Product Leads: ${categories.metaProduct.length}`);
  console.log(`Meta Hiring Leads (EXCLUDED): ${categories.metaHiring.length}`);
  console.log(`Meta Agency Owners (Partner) Leads: ${categories.metaAgencyOwners.length}`);
  console.log(`Website / Direct Inbound Leads: ${categories.otherWebsite.length}`);

  // Analyze CSV Audiences
  const csvSubAudiences = {};
  categories.csvRealtors.forEach(l => {
    const k = l.csv_audience || 'Unassigned CSV';
    if (!csvSubAudiences[k]) csvSubAudiences[k] = { totalRows: 0, validPhones: new Set() };
    csvSubAudiences[k].totalRows++;
    if (l.cleanedPhone) csvSubAudiences[k].validPhones.add(l.cleanedPhone);
  });

  console.log('\n--- CSV REALTOR AUDIENCE BREAKDOWN ---');
  Object.entries(csvSubAudiences).forEach(([aud, data]) => {
    console.log(`• ${aud}: ${data.totalRows} leads (${data.validPhones.size} unique valid phones)`);
  });

  // Analyze Meta Product Ads
  const metaAds = {};
  categories.metaProduct.forEach(l => {
    const k = l.ad_name || l.campaign_id || 'Meta Ad / WhatsApp CTWA';
    if (!metaAds[k]) metaAds[k] = { totalRows: 0, validPhones: new Set() };
    metaAds[k].totalRows++;
    if (l.cleanedPhone) metaAds[k].validPhones.add(l.cleanedPhone);
  });

  console.log('\n--- TOP META PRODUCT CAMPAIGNS / ADS ---');
  Object.entries(metaAds)
    .sort((a,b) => b[1].totalRows - a[1].totalRows)
    .slice(0, 10)
    .forEach(([ad, data]) => {
      console.log(`• ${ad}: ${data.totalRows} leads (${data.validPhones.size} unique phones)`);
    });

  // Calculate unique sets
  const csvPhoneSet = new Set(categories.csvRealtors.map(l => l.cleanedPhone).filter(Boolean));
  const metaProductPhoneSet = new Set(categories.metaProduct.map(l => l.cleanedPhone).filter(Boolean));
  const metaAgencyPhoneSet = new Set(categories.metaAgencyOwners.map(l => l.cleanedPhone).filter(Boolean));
  const hiringPhoneSet = new Set(categories.metaHiring.map(l => l.cleanedPhone).filter(Boolean));

  // Overlap
  const csvAndMetaOverlap = [...csvPhoneSet].filter(p => metaProductPhoneSet.has(p));

  // Excluded clients check
  const excludedInCsv = [...csvPhoneSet].filter(p => clientExclusionMap.has(p));
  const excludedInMetaProduct = [...metaProductPhoneSet].filter(p => clientExclusionMap.has(p));
  const totalExcludedClients = new Set([...excludedInCsv, ...excludedInMetaProduct]);

  console.log('\n--- CLIENT EXCLUSIONS DETECTED ---');
  console.log(`Total client numbers found in target audience: ${totalExcludedClients.size}`);
  totalExcludedClients.forEach(p => {
    const client = clientExclusionMap.get(p);
    console.log(`• ${client.name} (${p}) - Role: ${client.role}`);
  });

  // Net Target Calculations:
  // Option A: CSV Realtors + Meta Nobogent Product (Strictly excluding hiring & agency owners & clients)
  const targetOptionA = new Set();
  [...csvPhoneSet, ...metaProductPhoneSet].forEach(p => {
    if (!clientExclusionMap.has(p) && !hiringPhoneSet.has(p)) {
      targetOptionA.add(p);
    }
  });

  // Option B: CSV Realtors + Meta Nobogent Product + Meta Agency Owners (excluding hiring & clients)
  const targetOptionB = new Set();
  [...csvPhoneSet, ...metaProductPhoneSet, ...metaAgencyPhoneSet].forEach(p => {
    if (!clientExclusionMap.has(p) && !hiringPhoneSet.has(p)) {
      targetOptionB.add(p);
    }
  });

  console.log('\n======================================================');
  console.log('                 FINAL DATA TOTALS                    ');
  console.log('======================================================');
  console.log(`1. CSV Realtors Leads:`);
  console.log(`   - Total DB rows: ${categories.csvRealtors.length}`);
  console.log(`   - Unique valid phone numbers: ${csvPhoneSet.size}`);
  console.log(`   - Client numbers excluded: ${excludedInCsv.length}`);
  console.log(`   - Net unique CSV realtors: ${[...csvPhoneSet].filter(p => !clientExclusionMap.has(p)).length}`);

  console.log(`\n2. Meta Nobogent Product Leads:`);
  console.log(`   - Total DB rows: ${categories.metaProduct.length}`);
  console.log(`   - Unique valid phone numbers: ${metaProductPhoneSet.size}`);
  console.log(`   - Client numbers excluded: ${excludedInMetaProduct.length}`);
  console.log(`   - Net unique Meta product leads: ${[...metaProductPhoneSet].filter(p => !clientExclusionMap.has(p)).length}`);

  console.log(`\n3. Overlap between CSV & Meta Product: ${csvAndMetaOverlap.length}`);

  console.log(`\n4. Excluded Categories:`);
  console.log(`   - Meta Hiring Leads (Sales Executive / Rockstar): ${categories.metaHiring.length} leads (${hiringPhoneSet.size} unique phones) -> EXCLUDED`);
  console.log(`   - Existing Clients: ${clientExclusionMap.size} client numbers checked, ${totalExcludedClients.size} matched in leads -> EXCLUDED`);
  console.log(`   - Aspiring Agency Owners (Sales Partner Program): ${categories.metaAgencyOwners.length} leads (${metaAgencyPhoneSet.size} unique phones)`);

  console.log(`\n🎯 TOTAL TARGET RECIPIENTS TO SEND (Strict - Nobogent Product + CSV Realtors):`);
  console.log(`   >>> ${targetOptionA.size} unique recipients <<<`);

  console.log(`\n🎯 IF Including Agency Owners as well:`);
  console.log(`   >>> ${targetOptionB.size} unique recipients <<<`);
}

fullCalculation().catch(console.error);

