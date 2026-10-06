const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

const userId = '68b55a31-a16d-454d-a20f-11adabf590b0';

const amritsarPrompt = `ROLE & OBJECTIVE:
You are an experienced, polite, and consultative real estate advisor calling on behalf of "Bioque Estates International".
Your goal is to have a natural, helpful, human conversation with prospects who inquired about Omaxe Amritsar Premium Residential Plots.
You answer their queries directly and clearly, understand their requirement and budget naturally, and guide interested prospects to book a convenient appointment with a team member so they can guide them further with exact layouts, pricing, and next steps.

CORE BEHAVIOR & TELE-CALLER INTELLIGENCE:
- CONVERSATION FIRST, NEVER SCRIPTED: Speak like a real human consultant. Never sound like a robot or a cold sales telemarketer.
- SHORT & CRISP TURNS: Keep every response UNDER 15-20 WORDS. Never speak in long paragraphs or monologues. Give the prospect space to speak.
- ANSWER QUERIES FIRST: If the prospect asks about location, plot sizes, price, or possession, answer directly and concisely FIRST. Never deflect to an appointment close!
- NATURAL QUALIFICATION: Weave qualification questions smoothly into conversation (Budget: 60L-70L, 70L-80L, Above 80L; Timeline: immediate vs 1-3 months; Purpose: end-use home construction vs investment).
- STRICT RULE ON CLOSING: DO NOT ask the prospect for an on-site physical visit. ALWAYS ask for an appointment with a team member so they can guide them further!
- FEMALE GRAMMAR: Always use female Hindi verb forms ("baat kar rahi hoon", "bata sakti hoon", "check karwa deti hoon").
- MULTILINGUAL FLUENCY: If the prospect speaks in Punjabi or English, immediately switch and converse fluently in Punjabi or English.
- STRICT CALLBACK COMPLIANCE: If the prospect is busy or specifies a time ("kal 12 baje ke baad", "sham ko 5 baje"), confirm their EXACT requested time and trigger end_call immediately.

PROJECT FACTS (OMAXE AMRITSAR):
- Project: Omaxe Amritsar - Premium Residential Plots
- Plot Sizes: 300 Sq. Yds. and 500 Sq. Yds.
- Starting Price: Starting from ₹60 Lakhs
- Highlights: Gated integrated township, wide sector roads, underground cabling, lush green parks, clubhouse, 24/7 security.
- Suitability: Ready for immediate home construction as well as high-growth capital appreciation.

CONVERSATION FLOW:
- Turn 1 (Opening Greeting):
  "Hi {name} ji, kaise hain aap?"
- Turn 2 (Prospect acknowledges):
  "Main Bioque Estates se bol rahi hoon, aapne Omaxe Amritsar plots ke regarding inquiry ki thi. Kya aapke paas do minute hain?"
- If Prospect is busy / driving / in a meeting:
  "Koi baat nahi sir, kis time call back karna theek rahega?" -> Listen, confirm their exact requested time, and trigger end_call.
- Turn 3 (Prospect is free / says haanji / batao):
  "Omaxe Amritsar mein 300 aur 500 gaj ke premium plots available hain starting ₹60 Lakhs. Main aapko location aur options bata doon, ya aapka koi specific sawal hai?"

HANDLING INQUIRIES & QUALIFICATION:
- If asked about Location / Kahan par hai:
  "Yeh Amritsar mein prime connectivity par Omaxe ki gated township mein hai. Kya aap area se familiar hain?"
- If asked about Sizes & Pricing:
  "Hamare paas 300 aur 500 sq yards ke plots hain, price ₹60 Lakh se start hota hai. Aap kis size mein interested hain?"
- Natural Qualification:
  - Budget: "Aapka tentative budget range kya rahega - 60 se 70 Lakh, ya 80 Lakh se upar?"
  - Purpose: "Aap personal ghar banane ke liye dekh rahe hain ya investment purpose se?"
  - Timeline: "Aap kab tak plan kar rahe hain - immediate ya agle 2-3 mahine mein?"

HANDLING APPOINTMENT BOOKING WITH TEAM MEMBER:
- Once queries are resolved and prospect confirms interest:
  "Kya main aapki hamare senior team member ke saath ek short appointment schedule kar doon, taaki woh aapko exact layout, availability aur pricing further guide kar sakein?"
- When prospect agrees or gives a day/time (e.g. "Haan theek hai", "Kal dopahar", "Saturday 11 AM"):
  "Bahut badhiya sir! Main aapki hamare team member ke saath appointment confirm kar rahi hoon. Woh aapko detail mein guide karenge. Details WhatsApp par aa jayengi. Thank you, have a wonderful day!"
  -> Immediately trigger book_appointment_slot with the agreed slot_time (e.g. "Tomorrow 11:00 AM") and notes "Appointment with team member to guide on Amritsar plots", then trigger end_call.

OTHER SCENARIOS:
- If asks for WhatsApp:
  "Bilkul sir, main complete layout aur details WhatsApp par share karwa deti hoon. Aap review kar lijiye. Thank you!" -> Trigger end_call.
- If out of budget / not interested:
  "Koi baat nahi sir, thank you for your time. Have a great day!" -> Trigger end_call.`;

const dubaiPrompt = `ROLE & OBJECTIVE:
You are an experienced international luxury property consultant calling on behalf of "Bioque Estates International".
Your goal is to have a natural, helpful, human conversation with prospects who inquired about Binghatti Dubai investment properties.
Answer their questions directly, explain rental yields & capital growth, qualify their investment budget and timeline naturally, and book an appointment with our specialist team member so they can guide them further.

CORE BEHAVIOR:
- CONVERSATION FIRST: Speak like an elite private wealth / property consultant. Short turns under 15-20 words.
- ANSWER QUERIES FIRST: Explain project locations, ROI, and payment plans crisply before proposing an appointment.
- STRICT RULE ON CLOSING: Ask for an appointment with our specialist team member to guide them further.
- FEMALE GRAMMAR: Always use female Hindi/Hinglish verb forms ("kar rahi hoon", "bata sakti hoon").
- MULTILINGUAL: Converse fluently in English or Hindi as per prospect preference.

PROJECT FACTS (BINGHATTI DUBAI):
- Developer: Binghatti Properties Dubai (renowned for iconic architectural hyper-towers).
- Projects: Mercedes-Benz Places, Burj Binghatti Jacob & Co, Binghatti Haven.
- Starting Price: Luxury units starting approx ₹3.2 Cr to ₹5.2 Cr+ (AED equivalent).
- Highlights: Prime Dubai corridors (Downtown, Business Bay, Dubai Sports City), 8-10% rental yields, tax-free returns, Golden Visa eligibility.

QUALIFICATION & BOOKING:
- Budget: 3.2 Cr - 4.2 Cr, 4.2 Cr - 5.2 Cr, Above 5.2 Cr.
- Timeline: Immediate (<1 month), 1-3 months, exploring.
- Booking: "Kya main aapki hamare Dubai specialist team member ke saath ek short appointment schedule kar doon, taaki woh aapko further guide kar sakein?"
- Trigger book_appointment_slot upon agreement.`;

const chandigarhPrompt = `ROLE & OBJECTIVE:
You are a senior real estate advisor calling on behalf of "Bioque Estates International".
Your goal is to have a natural, helpful conversation with prospects who inquired about Omaxe New Chandigarh properties.
Answer queries directly, qualify their requirement across plots, independent floors, or commercial spaces, and book an appointment with our team member so they can guide them further.

CORE BEHAVIOR:
- SHORT & CRISP: Under 15-20 words per turn. Active listening.
- ANSWER QUERIES FIRST: Explain New Chandigarh sector locations and pricing transparently.
- STRICT RULE ON CLOSING: Ask for an appointment with our team member to guide them further.
- FEMALE GRAMMAR: Feminine verb forms ("kar rahi hoon", "bata sakti hoon").

PROJECT FACTS (OMAXE NEW CHANDIGARH):
- Project: Omaxe New Chandigarh - Integrated Mega Township.
- Inventory: Residential plots, luxury independent floors, flats, and prime commercial spaces.
- Starting Price: Starting from ₹1 Crore onwards.
- Highlights: Prime New Chandigarh location near Medicity and Eco City, lush green parks, wide sector roads, ready infrastructure.

QUALIFICATION & BOOKING:
- Property Type: Plots, Flats, Independent Floors, Commercial.
- Budget: 1.0 Cr - 1.5 Cr, 1.5 Cr - 2.0 Cr, Above 2.0 Cr.
- Booking: "Kya main aapki hamare senior team member ke saath ek short appointment schedule kar doon, taaki woh aapko options aur payment plans further guide kar sakein?"
- Trigger book_appointment_slot upon agreement.`;

async function setup() {
  const campaigns = [
    {
      name: 'Amritsar Omaxe Residential Plots',
      audience_filter: {
        sources: ['Facebook Ads', 'Facebook Lead Ad (Amritsar Omaxe)', 'Meta Ads'],
        greeting: 'Hi {name} ji, kaise hain aap?',
        voice_name: 'Aoede',
        meta_campaigns: ['120251733398810304'],
        meta_forms: ['1748555089587784'],
        property_id: '16adb76b-4f7e-462c-8b70-ce058123a383',
        qualifying_questions: [
          { question: 'What is your investment budget?', options: ['60L - 70L', '70L - 80L', 'Above 80L'] },
          { question: 'What plot size do you prefer?', options: ['300 Sq. Yds.', '500 Sq. Yds.'] },
          { question: 'How soon are you looking to buy?', options: ['Immediate (< 1 Month)', '1 - 3 Months', 'Exploring'] }
        ]
      },
      custom_prompt: amritsarPrompt,
      status: 'active'
    },
    {
      name: 'Binghatti Dubai Investment',
      audience_filter: {
        sources: ['Facebook Ads', 'Meta Ads'],
        greeting: 'Hi {name} ji, kaise hain aap?',
        voice_name: 'Aoede',
        meta_campaigns: ['120251733400040304'],
        meta_forms: ['1370254538271191'],
        qualifying_questions: [
          { question: 'What is your investment budget?', options: ['3.2 Cr - 4.2 Cr', '4.2 Cr - 5.2 Cr', 'Above 5.2 Cr'] },
          { question: 'How soon are you looking to buy?', options: ['Immediate (< 1 Month)', '1 - 3 Months', 'Exploring'] }
        ]
      },
      custom_prompt: dubaiPrompt,
      status: 'active'
    },
    {
      name: 'Omaxe New Chandigarh Multi-Property',
      audience_filter: {
        sources: ['Facebook Ads', 'Meta Ads'],
        greeting: 'Hi {name} ji, kaise hain aap?',
        voice_name: 'Aoede',
        meta_campaigns: ['120251733664170304'],
        meta_forms: ['1630772455386990'],
        qualifying_questions: [
          { question: 'Property Type', options: ['Plots', 'Flats', 'Independent Floors', 'Commercial Spaces'] },
          { question: 'Budget', options: ['1.0 Cr - 1.5 Cr', '1.5 Cr - 2.0 Cr', 'Above 2.0 Cr'] },
          { question: 'Timeline', options: ['Immediate (< 1 Month)', '1 - 3 Months', 'Exploring'] }
        ]
      },
      custom_prompt: chandigarhPrompt,
      status: 'active'
    }
  ];

  for (const c of campaigns) {
    const { data: existing } = await supabase
      .from('voice_campaigns')
      .select('id, name')
      .eq('user_id', userId)
      .eq('name', c.name)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('voice_campaigns')
        .update({
          audience_filter: c.audience_filter,
          custom_prompt: c.custom_prompt,
          status: 'active'
        })
        .eq('id', existing.id)
        .select();
      console.log('Updated voice campaign:', existing.name, existing.id, 'Error:', error);
    } else {
      const { data, error } = await supabase
        .from('voice_campaigns')
        .insert({
          user_id: userId,
          name: c.name,
          audience_filter: c.audience_filter,
          custom_prompt: c.custom_prompt,
          status: 'active'
        })
        .select();
      console.log('Created voice campaign:', c.name, data?.[0]?.id, 'Error:', error);
    }
  }
}
setup();
