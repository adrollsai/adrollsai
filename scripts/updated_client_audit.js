const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function cleanPhone(raw) {
  if (!raw) return null;
  let digits = raw.toString().replace(/[^0-9]/g, '');
  if (!digits || digits.length < 10) return null;
  if (digits.length === 10) {
    if (['6','7','8','9'].includes(digits[0])) return '91' + digits;
    return null;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
    if (['6','7','8','9'].includes(digits[0])) return '91' + digits;
  }
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length >= 11 && (digits.startsWith('971') || digits.startsWith('1') || digits.startsWith('44'))) return digits;
  return digits.length === 10 ? '91' + digits : (digits.length > 10 ? digits : null);
}

async function runUpdatedAudit() {
  // 1. Build comprehensive Client Exclusion List (all profiles, properties, closed deals, partner onboardings)
  const clientExclusionMap = new Map();

  const { data: profiles } = await supabase.from('profiles').select('*');
  const internalEmails = ['rchopra489@gmail.com', 'nobogent@gmail.com', 'meta-reviewer@nobogent.com'];

  profiles?.forEach(p => {
    const isInternal = internalEmails.includes(p.email) || p.business_name?.toLowerCase() === 'nobogent';
    if (!isInternal) {
      [p.contact_number, p.whatsapp_phone_number, p.whatsapp_personal_number, p.voice_twilio_number, p.old_voice_twilio_number].forEach(raw => {
        const cp = cleanPhone(raw);
        if (cp && !cp.includes('5556633659') && !cp.includes('9999999999')) {
          clientExclusionMap.set(cp, `${p.business_name || p.email} (${p.role || 'client'})`);
        }
      });
    }
  });

  // Properties table
  const { data: properties } = await supabase.from('properties').select('title, contact_phone, whatsapp_number, user_id');
  properties?.forEach(prop => {
    if (prop.user_id !== 'bc63c065-9bcc-4793-bedc-f0960406425b') {
      [prop.contact_phone, prop.whatsapp_number].forEach(raw => {
        const cp = cleanPhone(raw);
        if (cp && !cp.includes('5556633659') && !cp.includes('9999999999')) {
          if (!clientExclusionMap.has(cp)) clientExclusionMap.set(cp, `Property: ${prop.title}`);
        }
      });
    }
  });

  // Nobogent closed deals / partner agreements / meeting done
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const { data: dealLeads } = await supabase
    .from('leads')
    .select('name, phone, pipeline_stage, status')
    .eq('user_id', nobogentId)
    .or('pipeline_stage.eq.Deal/Token,pipeline_stage.eq.Sales Partner,pipeline_stage.eq.Meeting Done,status.eq.Deal/Token,status.eq.Partner Onboarding');

  dealLeads?.forEach(dl => {
    const cp = cleanPhone(dl.phone);
    if (cp && !cp.includes('9999999999')) {
      clientExclusionMap.set(cp, `Nobogent Closed Deal/Partner: ${dl.name} (${dl.pipeline_stage})`);
    }
  });

  console.log(`Total Master Client Exclusion Phone Numbers: ${clientExclusionMap.size}`);

  // 2. Fetch all Nobogent leads
  let allLeads = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email, source, ad_name, form_name, csv_audience')
      .eq('user_id', nobogentId)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  // 3. Separate categories
  const csvRealtorPhones = new Set();
  const metaProductPhones = new Set();
  const hiringPhones = new Set();
  const agencyPhones = new Set();

  allLeads.forEach(l => {
    const cp = cleanPhone(l.phone);
    if (!cp) return;

    const ad = (l.ad_name || '').toLowerCase();
    const form = (l.form_name || '').toLowerCase();
    const src = (l.source || '').toLowerCase();

    if (ad.includes('hiring') || form.includes('hiring') || ad.includes('sales rockstar') || src.includes('hiring')) {
      hiringPhones.add(cp);
    } else if (ad.includes('agency owners') || form.includes('agency') || form.includes('smma') || ad.includes('scale past') || src.includes('partner')) {
      agencyPhones.add(cp);
    } else if (l.source === 'CSV Import' || l.csv_audience) {
      csvRealtorPhones.add(cp);
    } else if (src.includes('facebook') || src.includes('meta') || src.includes('whatsapp') || l.ad_name || l.form_name) {
      metaProductPhones.add(cp);
    }
  });

  // Calculate final exclusions
  const matchedClientsInAudience = [];
  clientExclusionMap.forEach((desc, phone) => {
    if (csvRealtorPhones.has(phone) || metaProductPhones.has(phone)) {
      matchedClientsInAudience.push({ phone, desc });
    }
  });

  console.log(`\nMatched Existing Clients in Target Leads: ${matchedClientsInAudience.length}`);
  matchedClientsInAudience.forEach(m => {
    console.log(`  - ${m.phone}: ${m.desc}`);
  });

  // Filtered sets
  const finalCsvRealtors = [...csvRealtorPhones].filter(p => !clientExclusionMap.has(p) && !hiringPhones.has(p));
  const finalMetaProduct = [...metaProductPhones].filter(p => !clientExclusionMap.has(p) && !hiringPhones.has(p));

  const combinedFinal = new Set([...finalCsvRealtors, ...finalMetaProduct]);

  console.log('\n================ UPDATED FINAL TOTALS ================');
  console.log(`Master Client Exclusion List: ${clientExclusionMap.size} phone numbers`);
  console.log(`Net CSV Realtor Contacts: ${finalCsvRealtors.length}`);
  console.log(`Net Meta Product Contacts: ${finalMetaProduct.length}`);
  console.log(`Net Total Target Contacts (CSV + Meta Product): ${combinedFinal.size}`);
}

runUpdatedAudit().catch(console.error);
