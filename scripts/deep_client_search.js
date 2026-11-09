const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function cleanPhone(raw) {
  if (!raw) return null;
  let digits = raw.toString().replace(/[^0-9]/g, '');
  if (!digits || digits.length < 10) return null;
  if (digits.length === 10 && ['6','7','8','9'].includes(digits[0])) return '91' + digits;
  if (digits.length === 11 && digits.startsWith('0') && ['6','7','8','9'].includes(digits[1])) return '91' + digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length >= 11 && (digits.startsWith('971') || digits.startsWith('1') || digits.startsWith('44'))) return digits;
  return digits.length >= 10 ? digits : null;
}

async function deepClientSearch() {
  console.log('=== 1. ALL PROFILES IN DATABASE ===');
  const { data: profiles } = await supabase.from('profiles').select('*');
  console.log(`Total profiles: ${profiles.length}`);

  const clientMap = new Map();

  profiles.forEach(p => {
    const isNobogent = p.id === 'bc63c065-9bcc-4793-bedc-f0960406425b' || 
                       p.email === 'rchopra489@gmail.com' || 
                       p.email === 'nobogent@gmail.com' ||
                       p.business_name?.toLowerCase() === 'nobogent';

    // Collect all phone numbers associated with this profile
    const numbers = [
      p.contact_number,
      p.whatsapp_phone_number,
      p.whatsapp_personal_number,
      p.voice_twilio_number,
      p.old_voice_twilio_number
    ].filter(Boolean);

    numbers.forEach(num => {
      const cp = cleanPhone(num);
      if (cp && !cp.includes('5556633659') && !cp.includes('9999999999')) {
        clientMap.set(cp, {
          source: `Profile: ${p.business_name || p.email} (${p.role})`,
          business: p.business_name,
          email: p.email,
          role: p.role,
          isNobogent
        });
      }
    });
  });

  console.log(`Unique phone numbers from profiles: ${clientMap.size}`);

  console.log('\n=== 2. PHONE NUMBERS FROM PROPERTIES TABLE ===');
  const { data: properties } = await supabase.from('properties').select('id, user_id, title, contact_phone, whatsapp_number');
  properties?.forEach(prop => {
    [prop.contact_phone, prop.whatsapp_number].filter(Boolean).forEach(num => {
      const cp = cleanPhone(num);
      if (cp && !cp.includes('5556633659') && !cp.includes('9999999999')) {
        if (!clientMap.has(cp)) {
          clientMap.set(cp, {
            source: `Property: ${prop.title} (User: ${prop.user_id})`,
            business: prop.title,
            isNobogent: prop.user_id === 'bc63c065-9bcc-4793-bedc-f0960406425b'
          });
        }
      }
    });
  });

  console.log(`Unique numbers after properties: ${clientMap.size}`);

  console.log('\n=== 3. PHONE NUMBERS FROM NOBOGENT CLOSED/DEAL LEADS ===');
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const { data: dealLeads } = await supabase
    .from('leads')
    .select('id, name, phone, pipeline_stage, status, notes')
    .eq('user_id', nobogentId)
    .or('pipeline_stage.eq.Deal/Token,pipeline_stage.eq.Sales Partner,pipeline_stage.eq.Meeting Done,status.eq.Deal/Token,status.eq.Partner Onboarding');

  dealLeads?.forEach(dl => {
    console.log(`Nobogent Deal/Partner Lead: ${dl.name} | ${dl.phone} | Stage: ${dl.pipeline_stage} | Status: ${dl.status} | Notes: ${dl.notes?.slice(0, 80)}`);
    const cp = cleanPhone(dl.phone);
    if (cp) {
      clientMap.set(cp, {
        source: `Nobogent Closed Deal/Partner: ${dl.name}`,
        business: dl.name,
        isNobogent: false
      });
    }
  });

  console.log('\n=== 4. LIST ALL IDENTIFIED CLIENT NUMBERS (EXCLUDING NOBOGENT INTERNAL) ===');
  const clientNumbers = [];
  clientMap.forEach((val, phone) => {
    if (!val.isNobogent) {
      clientNumbers.push({ phone, ...val });
    }
  });

  console.log(`Total identified client exclusion numbers: ${clientNumbers.length}`);
  clientNumbers.forEach(c => {
    console.log(`  - ${c.phone} : ${c.source}`);
  });

  // Now check which leads in Nobogent match ANY of these client numbers
  const { data: noboLeads } = await supabase
    .from('leads')
    .select('id, name, phone, source, ad_name, csv_audience')
    .eq('user_id', nobogentId);

  const matchedLeads = [];
  noboLeads?.forEach(l => {
    const cp = cleanPhone(l.phone);
    if (cp && clientNumbers.some(c => c.phone === cp)) {
      const match = clientNumbers.find(c => c.phone === cp);
      matchedLeads.push({ lead: l, match });
    }
  });

  console.log(`\n=== MATCHED LEADS IN NOBOGENT: ${matchedLeads.length} ===`);
  matchedLeads.forEach(m => {
    console.log(`  * Lead: "${m.lead.name}" (${m.lead.phone}) | Matched Client: "${m.match.source}" | Source: ${m.lead.source} | Ad: ${m.lead.ad_name}`);
  });
}

deepClientSearch().catch(console.error);

