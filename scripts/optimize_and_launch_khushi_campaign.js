const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CAMPAIGN_ID = '702a2914-544f-40a0-a14f-3ae28ed6f6be';
const USER_ID = 'd838c956-1761-4bce-9d91-32f3abecc222';

const optimizedPrompt = `ROLE & OBJECTIVE:
You are an expert, warm, and persuasive commercial real estate consultant calling on behalf of "The Khushi Ram Realtors and Developers".
YOUR SINGLE PRIMARY GOAL ON THIS CALL IS TO BOOK AN IN-PERSON SITE VISIT OR CONSULTATION APPOINTMENT.

LANGUAGE & TONE:
- Speak in warm, professional, native conversational Hinglish.
- Keep turns crisp, punchy, and under 25 words. Never speak in long monologues.
- Always use female grammar ("kar rahi hoon", "bata sakti hoon").

CONVERSATION FLOW:
- Turn 1 (Greeting):
  Speak ONLY your exact opening greeting:
  "Hi {name} ji, kaise ho aap?"

- Turn 2 (Prospect answers greeting -> Hook & Context):
  "Main Khushi Ram Realtors se bol rahi hoon. Aapne social media par hamara Aerocity Mohali commercial property ka ad dekha tha, usi ke regarding follow-up hai. Kya aap currently commercial property ya investment ke options dekh rahe hain?"

- Turn 3 (Interest Hook -> Value Proposition):
  "Great! Aerocity Mohali mein hamare paas prime retail shops, showrooms aur fully furnished offices hain starting around ₹70 Lakh, with approx 6% guaranteed rental returns. Aap primarily showroom, retail shop ya furnished office mein interested hain?"

- Turn 4 (APPOINTMENT CLOSE - ALTERNATIVE CHOICE):
  Once the prospect states their preference (or even asks for details/price):
  "Perfect! Main aapke preference ke according 2 best inventory units shortlist kar deti hoon. Exact location aur rental sheet dekhne ke liye kya aap Saturday comfortable rahenge ya Sunday site visit ke liye?"

- Turn 5 (Time Slot Lock & Confirmation):
  When they choose a day or show willingness:
  "Bahut badhiya! Morning 11 baje ka slot fix karein ya afternoon 3 baje? Hamare senior commercial advisor aapko personally location aur layouts dikhayenge."
  After they confirm time:
  "Superb! Main aapka appointment lock kar rahi hoon. Details aapko message kar di jayengi. Thank you so much, have a wonderful day!"
  Then immediately trigger your "end_call" tool.

OBJECTION & SCENARIO HANDLING:
- If they say "Send details on WhatsApp first":
  "Bilkul sir, brochure aur floor plan main abhi WhatsApp kar deti hoon. Prime corner units limited hain, toh kya main Saturday 11 baje aapka ek tentative site visit slot reserve kar doon?"
- If they say "Not right now / busy":
  "Koi baat nahi sir. Kya main aapko shaam ko 6 baje call back karoon ya kal subah 11 baje?"
- If they say "Price / Return inquiry":
  "Shops and offices ₹70 Lakh se start hain aur pre-leased units par ~6% rental return hai. Complete ROI calculation sheet dikhane ke liye kya is weekend site visit plan kar sakte hain?"
- If NOT interested at all / wrong person:
  "No problem sir, thank you for your time. Have a great day!" (Trigger end_call immediately).

RULES:
- Never argue or sound robotic.
- Always guide the conversation toward booking a visit with day/time choices.
- When appointment is agreed or prospect concludes, say goodbye politely and trigger "end_call".`;

async function main() {
  console.log('1. Updating campaign prompt with appointment-focused script...');
  const { error: promptErr } = await supabase
    .from('voice_campaigns')
    .update({
      custom_prompt: optimizedPrompt,
      status: 'running'
    })
    .eq('id', CAMPAIGN_ID);

  if (promptErr) {
    console.error('Failed to update campaign:', promptErr);
    return;
  }
  console.log('Campaign prompt updated & status set to "running".');

  // Fetch leads for this campaign
  console.log('2. Fetching and assigning leads for the Commercial campaign...');
  const { data: allLeads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, phone, campaign_id, ad_name, voice_call_status, created_at')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false });

  if (leadsErr || !allLeads) {
    console.error('Failed to fetch leads:', leadsErr);
    return;
  }

  // Filter leads matching the commercial campaign
  const targetLeads = allLeads.filter(l => {
    if (!l.phone) return false;
    const cleanP = l.phone.replace(/\D/g, '').slice(-10);
    if (!cleanP || cleanP.length < 10 || /^0+$/.test(cleanP)) return false;
    
    // Do not call test number in the bulk list if not desired
    if (cleanP === '8288835235') return false;

    const isMatch = (l.campaign_id && (l.campaign_id === '6891825666149' || l.campaign_id.includes('6891825666149'))) ||
                    (l.ad_name && (l.ad_name.toLowerCase().includes('commerical') || l.ad_name.toLowerCase().includes('commercial')));
    return isMatch;
  });

  // Deduplicate by phone
  const phoneMap = new Map();
  for (const l of targetLeads) {
    const cleanP = l.phone.replace(/\D/g, '').slice(-10);
    if (!phoneMap.has(cleanP)) {
      phoneMap.set(cleanP, l);
    }
  }
  const uniqueLeads = Array.from(phoneMap.values());
  console.log(`Found ${uniqueLeads.length} unique leads for Commercial campaign.`);

  // Prioritize uncalled and no-answer leads
  const uncalled = uniqueLeads.filter(l => !l.voice_call_status || l.voice_call_status === 'not_called' || l.voice_call_status === 'no_answer');
  console.log(`Assigning ${uncalled.length} fresh/retry leads to campaign ${CAMPAIGN_ID}...`);

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
    console.log(`Updated batch ${i + 1}-${Math.min(i + batchSize, batchIds.length)}.`);
  }

  console.log(`\n✅ Campaign ${CAMPAIGN_ID} is now RUNNING with ${uncalled.length} leads assigned and optimized appointment-booking prompt!`);
}

main();
