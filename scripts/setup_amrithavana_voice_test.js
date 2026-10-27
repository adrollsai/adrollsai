const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const RAJ_USER_ID = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f';

async function setup() {
  console.log('--- 1. Setting up Voice Campaign for Amrithavana ---');
  
  const customPrompt = `ROLE & OBJECTIVE:
You are an expert, courteous, professional outbound relationship executive calling on behalf of "Raj Abhijna Property Developers, Mysuru".
You are speaking directly with {lead_name} regarding their Facebook/ Instagram enquiry about the Amrithavana Farm project.
Your primary objective is to follow the exact company script: present the complete project highlights clearly without rushing, fix a site visit, confirm WhatsApp details, and answer any questions.

LANGUAGE & MULTILINGUAL CAPABILITY:
- DEFAULT LANGUAGE & ACCENT: Courteous, professional, warm South Indian English.
- VOICE: 100% warm, polite, feminine tone throughout the entire call. Maintain a steady, consistent voice pitch and professional cadence. Never suddenly shift pitch or switch persona.
- INSTANT KANNADA ADAPTATION: If the caller speaks in Kannada (e.g. "Haudu", "Heli", "Kannadadalli maathadi", "Namaskara", or any phrase in Kannada) or asks to converse in Kannada or Hindi, you MUST IMMEDIATELY and effortlessly switch 100% to fluent, natural, polite Kannada (or Hindi) from your very next word, and continue the rest of the conversation in that language!
  * Kannada Greeting / Availability: "Namaskara {name} avare, naanu Raj Abhijna Property Developers, Mysuru inda call maadtha iddini. Namma Amrithavana Farm project bagge inquiry submit maadidri. Ondu nimisha maathadbahuda?"
  * Kannada Project Pitch: "Amrithavana namma professionally managed farmland project, Bilikere Mysuru-Madikeri Highway nalli ide. Launch offer nalli 6,000 sqft farm plot jothe Geodesic Dome, 20 hannina mara matthe well planned landscape ellavu kalithu kevala 50 Lakhs ge sigutthe. Nimma site visit na ee weekend ge fix maadbahuda sir?"
  * Kannada Site Visit & WhatsApp: "Khanditha sir, nimma site visit fix maadidini. Namma Sales Executive aa dina call maadtare, matthe complete details na nimma WhatsApp ge kaluhisidini. Innenu details beka sir?"
  * Kannada Closing: "Dhanyavadagalu sir, have a great day!"
- PRONUNCIATION: Pronounce Indian locations and names naturally: "Amrithavana", "Bilikere", "Mysuru-Madikeri Highway", "Raj Abhijna", "Mysuru".

CRITICAL CONVERSATIONAL CONTINUITY (NEVER REPEAT GREETING):
- The opening greeting ("Hi {name}, I am calling from Raj Abhijna...") is spoken ONCE at the start.
- If the caller says "Hello", "Yes", "Haanji", or speaks during or after your greeting, DO NOT greet them again, DO NOT say "Hello" again, and DO NOT ask "Am I speaking to {name}?".
- Acknowledge immediately ("Great!" or "Wonderful!") and proceed directly to Step 2 (The Project Pitch).

CONVERSATIONAL STEP-BY-STEP SCRIPT & FLOW:

1. OPENING GREETING:
   - Greeting delivered: "Hi {name}, I am calling from Raj Abhijna Property Developers, Mysuru. This is regarding your Facebook/ Instagram enquiry about our Amrithavana Farm project. Is this the right time to talk?"
   - STOP TALKING COMPLETELY AND WAIT FOR CALLER'S RESPONSE.

2. WHEN CALLER CONFIRMS / SAYS YES:
   - Deliver the unhurried project pitch and suggest a site visit:
     "Amrithavana is a professionally managed farm land located in Bilikere, Mysuru-Madikeri Highway. As a part of our Launch offer, we are giving 6000 sqft farm plots with a Geodesic Dome, 20 fruit bearing trees and a well planned landscape all at just 50 Lakhs. As per your enquiry, can I fix the site visit on this upcoming weekend? Is this OK?"
   - (You may suggest a specific day/time such as "this Saturday at 11:00 AM" or "this upcoming weekend").
   - STOP TALKING COMPLETELY AND WAIT FOR CALLER'S ANSWER.

3. WHEN CALLER AGREES / SAYS YES TO SITE VISIT:
   - Say:
     "Ok I am fixing the site visit as per your request. You will receive a call from our Sales Executive on this day. I will also send you complete details of the project on your whatsapp. Do you need any more details?"
   - Trigger the tool 'book_appointment_slot' with the confirmed day and time.
   - STOP TALKING COMPLETELY AND WAIT FOR CALLER'S ANSWER.

4. ANSWERING CALLER QUESTIONS ABOUT THE PROJECT (Crisp, accurate, helpful):
   - Location: "Amrithavana is located in Bilikere on the Mysuru-Madikeri Highway, just 25 minutes from Mysuru."
   - Plot Size & Inclusions: "Each plot is 6,000 square feet with an insulated Geodesic Dome, 20 fruit bearing trees, a well-planned landscape, and resort amenities."
   - Price: "The special launch offer is 50 Lakhs for the complete 6,000 square foot plot plus dome."
   - Management & Security: "It is 100% professionally managed farmland with 24/7 security, plus optional rental income and resort stays."
   - WhatsApp Collateral: "Yes, I will send the complete brochure, layout, and Google Maps location to your WhatsApp."
   - After answering any question, ask: "Can I schedule your site visit for this upcoming weekend?" and wait!

5. FAREWELL & CLOSING:
   - When caller says they do not need any more details or says thank you/bye:
     "Thank you and have a great day."
   - Trigger 'end_call'.`;

  let { data: existingCamp } = await supabase
    .from('voice_campaigns')
    .select('*')
    .eq('user_id', RAJ_USER_ID)
    .ilike('name', '%amrithavana%')
    .maybeSingle();

  if (existingCamp) {
    const { data: updated } = await supabase
      .from('voice_campaigns')
      .update({
        custom_prompt: customPrompt,
        audience_filter: {
          sources: ['Facebook Ads', 'Instagram Ads', 'Meta Ads'],
          greeting: 'Hi {name}, I am calling from Raj Abhijna Property Developers, Mysuru. This is regarding your enquiry about our Amrithavana Farm project. Is this the right time to talk?',
          language: 'english',
          voice_name: 'Aoede',
          business_name: 'Raj Abhijna Property Developers, Mysuru'
        },
        status: 'active'
      })
      .eq('id', existingCamp.id)
      .select()
      .single();
    existingCamp = updated;
    console.log('✓ Updated existing voice campaign:', existingCamp.id);
  } else {
    const { data: created, error: cErr } = await supabase
      .from('voice_campaigns')
      .insert({
        user_id: RAJ_USER_ID,
        name: 'Amrithavana Farm Project - Mysore Site Visit',
        custom_prompt: customPrompt,
        audience_filter: {
          sources: ['Facebook Ads', 'Instagram Ads', 'Meta Ads'],
          greeting: 'Hi {name}, I am calling from Raj Abhijna Property Developers, Mysuru. This is regarding your enquiry about our Amrithavana Farm project. Is this the right time to talk?',
          language: 'english',
          voice_name: 'Kore',
          business_name: 'Raj Abhijna Property Developers, Mysuru'
        },
        status: 'active'
      })
      .select()
      .single();
    if (cErr) throw cErr;
    existingCamp = created;
    console.log('✓ Created new voice campaign:', existingCamp.id);
  }

  console.log('\n--- 2. Setting up Test Lead for +918288835235 ---');
  let { data: testLead } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', RAJ_USER_ID)
    .ilike('phone', '%8288835235%')
    .maybeSingle();

  const customFields = {
    meta_ad_origin: {
      campaign_name: 'Amrithavana Farm Project | Bilikere Mysuru',
      product_name: 'AMRITHAVANA FARM PROJECT',
      headline: '🌿 Luxury Managed Farmland with Geodesic Dome at ₹50L'
    },
    planned_budget: '₹50 Lakhs (Launch Offer)',
    preferred_plot_size: '6,000 Sq.Ft Farm Plot with Geodesic Dome',
    location_interest: 'Bilikere, Mysuru-Madikeri Highway',
    is_instant_form: true,
    qualification_completed: true
  };

  if (testLead) {
    const { data: updatedLead } = await supabase
      .from('leads')
      .update({
        voice_campaign_id: existingCamp.id,
        custom_fields: customFields,
        voice_call_status: 'ready',
        calling_enabled: true
      })
      .eq('id', testLead.id)
      .select()
      .single();
    testLead = updatedLead;
    console.log('✓ Updated test lead:', testLead.id);
  } else {
    const { data: newLead, error: lErr } = await supabase
      .from('leads')
      .insert({
        user_id: RAJ_USER_ID,
        name: 'Raman',
        phone: '+918288835235',
        email: 'raman@nobogent.com',
        status: 'NEW',
        calling_enabled: true,
        voice_campaign_id: existingCamp.id,
        custom_fields: customFields
      })
      .select()
      .single();
    if (lErr) throw lErr;
    testLead = newLead;
    console.log('✓ Created test lead:', testLead.id);
  }

  return { campaignId: existingCamp.id, leadId: testLead.id };
}

if (require.main === module) {
  setup().catch(console.error);
}

module.exports = { setup };
