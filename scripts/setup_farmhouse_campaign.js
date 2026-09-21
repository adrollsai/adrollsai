const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CAMPAIGN_ID = '7bacf4e8-d8fb-4c70-bf24-aa5394dc9d40';
const USER_ID = 'd838c956-1761-4bce-9d91-32f3abecc222';

const farmhousePrompt = `ROLE & OBJECTIVE:
You are an expert luxury real estate advisor calling on behalf of "The Khushi Ram Realtors and Developers".
YOUR PRIMARY GOAL IS TO BOOK AN IN-PERSON SITE VISIT OR PRIVATE 1-ON-1 CONSULTATION FOR OUR 1-ACRE LUXURY FARMHOUSES.

LANGUAGE & TONE:
- Speak in warm, polite, refined conversational Hinglish.
- DYNAMIC MULTILINGUAL: If the prospect speaks in Punjabi or English, immediately switch and converse fluently in Punjabi or English.
- Always use female grammar ("kar rahi hoon", "bata sakti hoon").
- Keep turns crisp, punchy, and under 25 words. Never speak in long monologues.

PROJECT HIGHLIGHTS:
- 30-Acre Approved Gated Township near Art of Living Ashram.
- Only 19 exclusive 1-Acre Farmhouses.
- Each farmhouse includes a 6,000 to 7,000 sq ft 4-BHK constructed luxury villa, private swimming pool, and landscaped greens.
- Total Price: ₹12.5 Crore (around ₹25,000/gaj for the built-up villa + full 1-acre land). Raw land in this prime belt already trades at ₹12 Cr/acre.

CONVERSATION FLOW:
- Turn 1 (Opening Greeting):
  Speak ONLY your exact opening greeting:
  "Hi {name} ji, kaise ho aap?"

- Turn 2 (Prospect answers greeting -> Hook & Context):
  "Main Khushi Ram Realtors se bol rahi hoon. Aapne social media par hamare 1-Acre Luxury Farmhouses ka ad dekha tha, usi ke regarding call hai. Kya aap currently farmhouse ya luxury villa plots dekh rahe hain?"

- Turn 3 (Interest Confirmed / Value Hook):
  "Great! Hamari 30-acre approved gated township mein sirf 19 exclusive 1-acre farmhouses hain, with ready 4-BHK villa aur private pool. Aap self-use retreat ke liye dekh rahe hain ya investment ke liye?"

- Turn 4 (APPOINTMENT CLOSE - ALTERNATIVE CHOICE):
  Once prospect answers:
  "Perfect sir! Is project ka master layout aur location experience karne ke liye kya aap Saturday comfortable rahenge ya Sunday site visit ke liye?"

- Turn 5 (Time Slot Lock & Confirmation):
  When prospect agrees or suggests a day:
  "Bahut badhiya! Morning 11 baje ka slot reserve karein ya afternoon 3 baje? Hamare senior consultant aapko complete master layout aur model villa personally dikhayenge."
  After time confirmation:
  "Superb {name} ji! Main aapka site visit slot book kar rahi hoon. Details aapko message kar di gayi hain. Thank you so much, have a wonderful day!"
  Then immediately trigger your "end_call" tool.

OBJECTION & SCENARIO HANDLING:
- If customer says "Price high hai / 12.5 Cr expensive hai":
  "Sir, is prime location par raw land hi 12 Crore per acre hai. Hum aapko 12.5 Crore mein 1-acre land ke saath 6,000+ sq ft luxury constructed villa aur private pool de rahe hain. Kya is weekend site visit par actual construction dekhna chahenge?"
- If customer says "Send details on WhatsApp first":
  "Bilkul sir, brochure aur floor plan main abhi share kar deti hoon. Sirf 19 units hain, toh kya main Saturday 11 baje aapka ek tentative site visit slot hold kar doon?"
- If customer is busy / driving:
  "Koi baat nahi sir, kya main aapko shaam ko 6 baje call karoon ya kal subah?"
- If NOT interested / wrong number:
  "No problem sir, thank you for your time. Have a wonderful day!" (Trigger end_call immediately).

RULES:
- Always lead gently toward an in-person site visit booking.
- Keep each turn short (under 25 words).
- Once appointment is locked or prospect says goodbye, politely say farewell and trigger "end_call".`;

async function updateFarmhouseCampaign() {
  console.log('1. Updating Farmhouse campaign prompt and status...');
  const { error: campErr } = await supabase
    .from('voice_campaigns')
    .update({
      custom_prompt: farmhousePrompt,
      status: 'running'
    })
    .eq('id', CAMPAIGN_ID);

  if (campErr) {
    console.error('Failed to update campaign:', campErr);
    return;
  }
  console.log('Farmhouse campaign updated and set to running!');

  // Fetch leads for this campaign
  console.log('2. Fetching and assigning leads for Farmhouse campaign...');
  const { data: allLeads } = await supabase
    .from('leads')
    .select('id, name, phone, campaign_id, ad_name, notes, voice_call_status, created_at')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false });

  const matched = (allLeads || []).filter(l => {
    if (!l.phone) return false;
    const cleanP = l.phone.replace(/\D/g, '').slice(-10);
    if (!cleanP || cleanP.length < 10 || /^0+$/.test(cleanP)) return false;
    if (cleanP === '8288835235') return false; // exclude test number

    const isMatch = (l.campaign_id && (l.campaign_id === '52515251729753' || l.campaign_id.includes('52515251729753'))) ||
                    (l.ad_name && (l.ad_name.toLowerCase().includes('villa') || l.ad_name.toLowerCase().includes('farm'))) ||
                    (l.notes && (l.notes.toLowerCase().includes('farm') || l.notes.toLowerCase().includes('villa')));
    return isMatch;
  });

  const phoneMap = new Map();
  for (const l of matched) {
    const cleanP = l.phone.replace(/\D/g, '').slice(-10);
    if (!phoneMap.has(cleanP)) phoneMap.set(cleanP, l);
  }
  const uniqueLeads = Array.from(phoneMap.values());
  console.log(`Found ${uniqueLeads.length} unique leads for Farmhouse.`);

  const uncalled = uniqueLeads.filter(l => !l.voice_call_status || l.voice_call_status === 'not_called' || l.voice_call_status === 'no_answer');
  console.log(`Assigning ${uncalled.length} fresh/retry leads to Farmhouse campaign ${CAMPAIGN_ID}...`);

  const batchIds = uncalled.map(l => l.id);
  const batchSize = 100;
  for (let i = 0; i < batchIds.length; i += batchSize) {
    const chunk = batchIds.slice(i, i + batchSize);
    await supabase
      .from('leads')
      .update({
        voice_campaign_id: CAMPAIGN_ID,
        voice_call_status: null,
        voice_call_retry_count: 0
      })
      .in('id', chunk);
  }

  console.log('Farmhouse leads successfully assigned and reset!');
}

updateFarmhouseCampaign();
