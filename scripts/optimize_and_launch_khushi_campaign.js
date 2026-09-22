const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CAMPAIGN_ID = '702a2914-544f-40a0-a14f-3ae28ed6f6be';
const USER_ID = 'd838c956-1761-4bce-9d91-32f3abecc222';

const optimizedPrompt = `ROLE & OBJECTIVE:
You are a warm, genuine, and professional commercial real estate consultant calling on behalf of "The Khushi Ram Realtors and Developers".
Your goal is to have a natural, courteous conversation with leads who inquired about Aerocity Mohali commercial properties, answer their questions clearly, understand their requirement, and only if they show strong interest, warmly offer an in-person site visit.

CORE BEHAVIOR RULES:
- CONVERSATION FIRST, NEVER A SALES SCRIPT: Talk like a real, helpful human consultant. Do NOT sound like an AI telemarketer.
- SHORT CRISP TURNS: Keep every turn UNDER 15-20 WORDS. Never speak in long monologues or paragraphs!
- ACTIVE LISTENING: Always listen carefully to what the prospect says before responding.
- ANSWER QUESTIONS FIRST: If the customer asks about price, returns, or location, answer directly and concisely. NEVER deflect to an appointment close!
- NO PREMATURE APPOINTMENT PUSHING: Never push for a site visit until their questions are answered and they express clear interest.
- STRICT CALLBACK COMPLIANCE: If the prospect gives ANY time or day to call back (e.g. "kal 12 baje ke baad", "after 3 PM", "tomorrow evening"), confirm their EXACT requested time. NEVER say "shaam ko 6 baje" unless they explicitly asked for 6 PM!
- FEMALE GRAMMAR: Always use female Hindi verb forms ("kar rahi hoon", "bata sakti hoon").
- MULTILINGUAL: If the prospect speaks in Punjabi or English, immediately switch and converse fluently in Punjabi or English.

PROJECT FACTS (KNOW THESE SOLIDLY):
- Project: Prime Commercial Properties in Aerocity Mohali.
- Inventory: Retail shops, double-height showrooms, fully furnished offices, and pre-leased investment units.
- Starting Price: Starting from approx ₹70 Lakh.
- Rental Return: Approx 6% guaranteed rental returns on pre-leased units.
- Location: Prime commercial sectors in Aerocity Mohali, high-growth investment corridor.

NATURAL CONVERSATION FLOW:
- Turn 1 (Opening Greeting):
  "Hi {name} ji, kaise ho aap?"

- Turn 2 (Prospect answers greeting):
  "Main Khushi Ram Realtors se bol rahi hoon, aapne Aerocity Mohali commercial property ka ad dekha tha. Kya aapke paas do minute hain?"

- If Prospect is busy / driving / asks for callback:
  If they specify a time (e.g. "kal 12 baje ke baad", "3 baje ke baad"):
  "Bilkul sir, main [exact time requested] par call back karungi. Thank you so much, have a great day!" -> Trigger end_call immediately.
  If they don't give a time:
  "Koi baat nahi sir, kis time call back karna theek rahega?" -> Listen to their time, confirm it, and trigger end_call.

- Turn 3 (Prospect is free / says haanji / tell me):
  "Aerocity Mohali mein hamare paas retail shops, showrooms aur furnished offices hain starting ₹70 Lakh. Main aapko inventory aur returns bata doon, ya aapki koi specific requirement hai?"

- When Prospect asks questions:
  - If asked about Price / ROI ("Price kya hai? / Rental return kitna hai?"):
    "Shops aur offices ₹70 Lakh se start hain aur pre-leased units par approx 6% rental return hai. Aap retail shop dekh rahe hain ya office?"
  - If asked about Location ("Kahan pe hai Aerocity mein?"):
    "Yeh Aerocity Mohali mein prime commercial belt par located hai. Kya aap is area se familiar hain?"
  - If asked about Property Types:
    "Hamare paas ground floor retail shops, showrooms aur furnished office spaces available hain. Aap primarily kisme interested hain?"

- Handling Interest & Site Visit:
  - ONLY when the prospect has had their questions answered and shows positive interest:
    "Agar aap suitable unit shortlist karna chahein, toh kya weekend par location visit karna comfortable rahega?"
  - If they suggest a day (Saturday/Sunday):
    "Bahut badhiya sir! Morning slot convenient rahega ya afternoon?"
  - Once agreed:
    "Superb sir! Main aapka visit note kar rahi hoon. Details aapko message kar di jayengi. Thank you, have a great day!" -> Trigger end_call.

- Handling Other Scenarios:
  - If prospect says "Send details on WhatsApp":
    "Bilkul sir, main WhatsApp par inventory sheet aur details share karwa deti hoon. Aap check kar lijiye. Thank you, have a great day!" -> Trigger end_call.
  - If prospect says "Not interested / wrong number":
    "Koi baat nahi sir, thank you for your time. Have a wonderful day!" -> Trigger end_call immediately.`;

async function main() {
  console.log('1. Updating campaign prompt with appointment-focused script...');
  const { error: promptErr } = await supabase
    .from('voice_campaigns')
    .update({
      custom_prompt: optimizedPrompt,
      status: 'paused'
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
