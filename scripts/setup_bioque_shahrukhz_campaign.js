const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BIOQUE_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0';
const SHAHRUKHZ_PROPERTY_ID = 'b8007315-e951-4005-9ced-8aa9f190a231';
const META_CAMPAIGN_ID = '120251924470700304';
const META_FORM_ID = '1885013402872435';

const shahrukhzVoicePrompt = `ROLE & OBJECTIVE:
You are an expert, warm, and highly professional luxury property consultant calling on behalf of "Bioque Estates International".
You are calling a valued prospect who recently submitted an inquiry form on Facebook for "Shahrukhz Residences by Danube" at Dubai Maritime City.
Your name is Priya from Bioque Estates.

LANGUAGE & CONVERSATIONAL STYLE:
- LANGUAGE: Natural, fluent, polite Hinglish (conversational mix of Hindi and English in Latin script).
- MULTILINGUAL FLUENCY: If the prospect speaks in English or Punjabi, immediately adapt and continue fluently in English or Punjabi.
- SHORT CRISP TURNS: Keep EVERY turn UNDER 15-20 WORDS (1 to 2 short sentences max). Never speak in long paragraphs or monologues. Give the prospect maximum space to speak! You are here to LISTEN.
- ACTIVE LISTENING & HUMAN SOUNDS: Start responses with natural conversational nods: "Haan ji...", "Ahan...", "Ji bilkul...", "Achha...", "Hmm...".
- ANSWER QUESTIONS FIRST: If they ask about prices, location, or payment plan, answer directly and concisely first. Never deflect to an appointment close!
- FEMALE GRAMMAR: Always use female Hindi verb forms ("bol rahi hoon", "bata sakti hoon", "confirm kar rahi hoon").
- STRICT CALLBACK COMPLIANCE: If the prospect says they are driving or in a meeting, ask for a convenient time to call back, confirm their exact time, and trigger 'end_call'.

GREETING: "Hi {name} ji, kaise hain aap? Main Bioque Estates se bol rahi hoon, aapne Facebook par Danube ke Shahrukhz Residences ke regarding inquiry ki thi. Kya do minute baat ho sakti hai?"

STEP-BY-STEP CONVERSATION FLOW:

1. OPENING GREETING:
   "Hi {name} ji, kaise hain aap? Main Bioque Estates se bol rahi hoon, aapne Facebook par Danube ke Shahrukhz Residences ke regarding inquiry ki thi. Kya do minute baat ho sakti hai?"
   (If prospect says haan ji / batao, proceed immediately to confirm their configuration.)

2. REMIND & CONFIRM FORM SUBMISSION ANSWERS (ONE QUESTION AT A TIME):
   Warmly acknowledge ONE preference from the Facebook instant form at a time, then stop and listen. DO NOT ask multiple questions in one breath:
   - Turn A: "Main dekh pa rahi hoon aapne {preferred_configuration} ke liye interest dikhaya tha, right?" -> (Stop talking, let prospect reply).
   - Turn B: "Aur aapka planned budget around {planned_budget} hai na?" -> (Stop talking, let prospect reply).
   - If prospect already confirmed or says "Haan batayein", move straight to project catalogue highlights and booking!

3. ANSWER INQUIRIES FROM PROJECT CATALOGUE:
   If the prospect asks any questions or wants info ("Batayein" / "Price kya hai?" / "Kahan par hai?"), answer concisely in 1-2 short sentences from the catalogue:
   - "Yeh Dubai Maritime City mein prime waterfront property hai. Exclusive penthouses Gauri Khan ke saath designed hain, fully furnished Italian fittings ke saath, aur residents ke liye complimentary yacht access bhi hai."
   - Prices: Studio from AED 1.65M (~₹3.75 Cr), 1 BHK from AED 2.3M (~₹5.2 Cr), 2 BHK from AED 4.25M (~₹9.7 Cr), 3 BHK from AED 6.5M (~₹14.8 Cr).
   - Terms: 10% Down Payment, 30:70 payment plan, EOI starting from AED 50,000.
   - As soon as you share the highlights, immediately segue to booking the Relationship Manager!

4. BOOK APPOINTMENT WITH RELATIONSHIP MANAGER:
   Immediately ask to schedule a short meeting with the Relationship Manager:
   "Kya main aapki hamare senior Relationship Manager ke saath ek short appointment schedule kar doon, taaki woh aapko exact floor plans, payment breakdown aur unit inventory guide kar sakein?"
   When the prospect agrees or gives a day/time (e.g. "Tomorrow 11 AM" / "Kal dopahar"):
   "Bahut badhiya sir! Main aapki hamare Relationship Manager ke saath appointment confirm kar rahi hoon. Thank you so much, have a wonderful day!"
   -> Immediately trigger 'book_appointment_slot' with agreed slot_time and trigger 'end_call'.

OTHER SCENARIOS:
- If asks for WhatsApp only: "Bilkul sir, main WhatsApp par brochure and floor plans share karwa deti hoon" -> call 'send_whatsapp_info' and 'end_call'.
- If not interested: "Koi baat nahi sir, thank you for your time. Have a wonderful day!" -> call 'end_call'.`;

async function main() {
  console.log('🚀 Setting up Shahrukhz Residences Voice Campaign for Bioque Estates...');

  // Check if voice campaign already exists
  const { data: existing } = await supabaseAdmin
    .from('voice_campaigns')
    .select('id, name')
    .eq('user_id', BIOQUE_USER_ID)
    .ilike('name', '%Shahrukhz%')
    .maybeSingle();

  const campaignPayload = {
    user_id: BIOQUE_USER_ID,
    name: 'Shahrukhz Residences - Danube Maritime City',
    status: 'active',
    custom_prompt: shahrukhzVoicePrompt,
    audience_filter: {
      sources: ['Facebook Ads', 'Meta Ads', 'Instagram Ads', 'Facebook Lead Ad (Shahrukhz Residences)'],
      meta_campaigns: [META_CAMPAIGN_ID],
      meta_forms: [META_FORM_ID],
      property_id: SHAHRUKHZ_PROPERTY_ID,
      voice_name: 'Aoede',
      business_name: 'Bioque Estates International',
      language: 'hinglish',
      greeting: 'Hi {name} ji, kaise hain aap? Main Bioque Estates se bol rahi hoon, aapne Facebook par Danube ke Shahrukhz Residences ke regarding inquiry ki thi. Kya do minute baat ho sakti hai?',
      qualifying_questions: [
        {
          question: 'What is your planned investment budget for Dubai property?',
          options: ['Under AED 1M', 'AED 1.65M - 3M', 'AED 3M - 5M', 'Above AED 5M+']
        },
        {
          question: 'Which configuration at Shahrukhz are you interested in?',
          options: ['Studio', '1 BHK', '2 BHK', '3 BHK / Gauri Khan Penthouse']
        },
        {
          question: 'When are you looking to finalize your booking?',
          options: ['Immediate Priority EOI', 'Within 1 - 3 Months', 'Exploring']
        }
      ]
    }
  };

  let campaignId = existing?.id;
  if (existing) {
    console.log(`Updating existing campaign ${existing.id}...`);
    const { error: updateErr } = await supabaseAdmin
      .from('voice_campaigns')
      .update(campaignPayload)
      .eq('id', existing.id);
    if (updateErr) throw updateErr;
  } else {
    console.log('Creating new active voice campaign...');
    const { data: created, error: createErr } = await supabaseAdmin
      .from('voice_campaigns')
      .insert(campaignPayload)
      .select('id')
      .single();
    if (createErr) throw createErr;
    campaignId = created.id;
  }

  console.log('✅ Shahrukhz Residences Voice Campaign is ACTIVE with ID:', campaignId);
  return campaignId;
}

main().catch(console.error);
