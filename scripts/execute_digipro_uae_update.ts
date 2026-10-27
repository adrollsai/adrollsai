import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function metaFetch(url: string, payload: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Meta API Error (${res.status}): ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

async function main() {
  console.log('================================================================');
  console.log('🚀 EXECUTING DIGIPRO UAE TARGETING, ADSET & FORM IMPROVEMENTS');
  console.log('================================================================');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('facebook_token, ad_account_id, selected_page_id')
    .eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c')
    .single();

  if (error || !profile) {
    throw new Error('Could not fetch Digipro profile: ' + JSON.stringify(error));
  }

  const token = profile.facebook_token;
  const adAcc = profile.ad_account_id.startsWith('act_') ? profile.ad_account_id : `act_${profile.ad_account_id}`;
  const pageId = profile.selected_page_id;
  const instagramUserId = "17841462288531383";

  const campaignId = '120252584916540286';
  const uaeAdsetId = '120252584927560286';
  const indiaAdsetId = '120252584938330286';

  // Get Page Token
  const accRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);
  const accJson = await accRes.json();
  const targetPage = accJson.data.find((x: any) => x.id === pageId);
  if (!targetPage) {
    throw new Error('Could not find Page in user accounts.');
  }
  const pageToken = targetPage.access_token;
  console.log(`✓ Authenticated with Page: ${targetPage.name} (${pageId})`);

  // =========================================================================
  // 1. TURN ON CAMPAIGN & UAE ADSET, TURN OFF INDIA ADSET
  // =========================================================================
  console.log('\n--- Step 1: Updating Campaign & AdSet Statuses ---');

  // Turn ON Campaign
  const campRes = await metaFetch(`https://graph.facebook.com/v21.0/${campaignId}`, {
    status: 'ACTIVE',
    access_token: token
  });
  console.log(`✓ Campaign [${campaignId}] set to ACTIVE`);

  // Pause India AdSet
  const pauseIndiaRes = await metaFetch(`https://graph.facebook.com/v21.0/${indiaAdsetId}`, {
    status: 'PAUSED',
    access_token: token
  });
  console.log(`✓ India AdSet [${indiaAdsetId}] set to PAUSED`);

  // Ensure UAE AdSet is ACTIVE
  const activeUaeRes = await metaFetch(`https://graph.facebook.com/v21.0/${uaeAdsetId}`, {
    status: 'ACTIVE',
    access_token: token
  });
  console.log(`✓ UAE AdSet [${uaeAdsetId}] set to ACTIVE`);

  // =========================================================================
  // 2. TURN OFF ADVANTAGE+ & APPLY NARROW LAYERED TARGETING TO UAE ADSET
  // =========================================================================
  console.log('\n--- Step 2: Applying Narrow Layered Targeting (Advantage+ OFF) ---');

  const narrowLayeredTargeting = {
    geo_locations: {
      countries: ['AE'],
      location_types: ['home', 'recent']
    },
    age_min: 26,
    age_max: 65,
    flexible_spec: [
      // Layer 1: Core Business / Entrepreneurship / Investor Intent
      {
        interests: [
          { id: "6003371567474", name: "Entrepreneurship (business and finance)" },
          { id: "6002884511422", name: "Small business (business and finance)" },
          { id: "6003462661944", name: "Trade (economics)" },
          { id: "6003102820440", name: "creative entrepreneurship (business and financial industries)" },
          { id: "6003587074473", name: "Investor (investing)" },
          { id: "6003318751818", name: "angel investor (business finance)" },
          { id: "6003284619527", name: "venture capital (business finance)" },
          { id: "6003325004380", name: "Start-up company (business and finance)" },
          { id: "6003140995966", name: "Company (business and finance)" }
        ]
      },
      // Layer 2: Decision Maker / Business Ownership / Senior Position MUST ALSO MATCH
      {
        work_positions: [
          { id: "138050029568986", name: "Owner and Founder" },
          { id: "221853711359062", name: "CEO & Founder" },
          { id: "103113219728224", name: "Chief executive officer" },
          { id: "103189639738794", name: "MD/CEO" },
          { id: "874842615892965", name: "Managing Director" },
          { id: "183861164967987", name: "Managing Director" },
          { id: "149657818421934", name: "Director (business)" },
          { id: "149598488387016", name: "Owner and CEO" },
          { id: "145883162179925", name: "Chief Executive Officer (CEO) & Founder" },
          { id: "110722838955052", name: "Owner" },
          { id: "108731319151154", name: "Partner" },
          { id: "143212149039647", name: "Managing Partner" },
          { id: "133337610036491", name: "Founder, Director, CEO" }
        ],
        behaviors: [
          { id: "6002714898572", name: "Small business owners" },
          { id: "6015683810783", name: "Facebook Page admins" },
          { id: "6022788483583", name: "Frequent international travelers" }
        ]
      }
    ],
    device_platforms: ['mobile', 'desktop'],
    publisher_platforms: ['facebook', 'instagram'],
    targeting_automation: { advantage_audience: 0 } // Strict Advantage+ OFF
  };

  const updateTargetingRes = await metaFetch(`https://graph.facebook.com/v21.0/${uaeAdsetId}`, {
    targeting: narrowLayeredTargeting,
    access_token: token
  });
  console.log(`✓ UAE AdSet Targeting updated successfully (Advantage+ audience disabled, 2-layer intersection active).`);

  // =========================================================================
  // 3. CREATE NEW 4-QUESTION HIGHER INTENT LEAD FORM (WITH COMPANY NAME SHORT ANSWER)
  // =========================================================================
  console.log('\n--- Step 3: Creating New 4-Question Higher Intent Lead Form ---');

  const newFormPayload = {
    name: "DigiPro UAE | High Intent (4 Qualifying Qs: Company Name + Setup Intent)",
    is_optimized_for_quality: true, // Higher intent review screen + slide to confirm
    privacy_policy: {
      url: "https://www.digiprouae.com/privacy-policy",
      link_text: "Privacy Policy"
    },
    follow_up_action_url: "https://www.digiprouae.com",
    thank_you_page: {
      title: "You're Pre-Qualified for Dubai Business Setup (E1)",
      body: "Thank you! Our senior UAE licensing specialist will review your proposed business details and connect with you via WhatsApp/Call with your complete package quote and timeline breakdown.",
      button_text: "Visit DigiPro UAE",
      button_type: "VIEW_WEBSITE",
      website_url: "https://www.digiprouae.com"
    },
    non_lead_thank_you_page: {
      title: "Thank You for Your Interest (E2)",
      body: "DigiPro UAE business setup packages start from AED 3,999. Based on your selections, our packages may not be the right fit at this time. You can visit our website to explore our services.",
      button_text: "Visit Website",
      button_type: "VIEW_WEBSITE",
      website_url: "https://www.digiprouae.com"
    },
    questions: [
      // QUESTION 1: Short Answer - Company Name / Proposed Business Activity
      {
        key: "company_name",
        label: "What is your Company Name or Proposed Business Activity in Dubai?",
        type: "CUSTOM"
      },
      // QUESTION 2: Jurisdiction & Setup Type
      {
        key: "setup_type",
        label: "Which UAE business structure or license do you require?",
        type: "CUSTOM",
        options: [
          { key: "freezone", value: "Freezone License (100% Foreign Ownership + 0% Personal Tax)", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "mainland", value: "Mainland LLC (Trade across all UAE & Local Market)", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "license_visa", value: "Complete Package (Trade License + Investor Residence Visa)", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "advisory", value: "Need Expert Consultation to decide the right option", action: "SUBMIT_FORM", lead_filter: "LEAD" }
        ]
      },
      // QUESTION 3: Budget Qualification (Disqualifying below minimum AED 3,500)
      {
        key: "planned_budget",
        label: "What is your planned budget for UAE business setup & licensing?",
        type: "CUSTOM",
        options: [
          { key: "budget_starter", value: "AED 3,999 - AED 6,500 (Starter Setup / Trade License)", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "budget_complete", value: "AED 6,500 - AED 12,000 (Trade License + Investor Visa)", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "budget_corporate", value: "AED 12,000+ (Mainland / Multi-Shareholder / Golden Visa)", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "budget_low", value: "Under AED 3,500 (Below minimum threshold)", action: "CLOSE_FORM", lead_filter: "NON_LEAD" }
        ]
      },
      // QUESTION 4: Timeline Urgency (Disqualifying casual tire-kickers)
      {
        key: "timeline_to_setup",
        label: "When are you planning to start your business in Dubai?",
        type: "CUSTOM",
        options: [
          { key: "time_immediate", value: "Immediately / Within 15 Days", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "time_1_3", value: "Within 1 - 3 Months", action: "SUBMIT_FORM", lead_filter: "LEAD" },
          { key: "time_casual", value: "Just exploring / No immediate plans", action: "CLOSE_FORM", lead_filter: "NON_LEAD" }
        ]
      },
      // CONTACT FIELDS
      { key: "full_name", type: "FULL_NAME" },
      { key: "phone_number", type: "PHONE" },
      { key: "email", type: "EMAIL" }
    ],
    access_token: pageToken
  };

  const formRes = await metaFetch(`https://graph.facebook.com/v21.0/${pageId}/leadgen_forms`, newFormPayload);
  const newFormId = formRes.id;
  console.log(`✓ New 4-Question Form Created: ID ${newFormId}`);

  // =========================================================================
  // 4. CREATE NEW AD CREATIVES WITH THIS NEW FORM
  // =========================================================================
  console.log('\n--- Step 4: Creating New Creatives Linked to New 4-Question Form ---');

  const creativesDef = [
    {
      name: "DigiPro - Dubai Business Launchpad (4Q)",
      hash: "fb412846fb907e4307be1c69719dbf1d",
      headline: "🇦🇪 Start Your Dubai Business from AED 3,999",
      description: "100% Foreign Ownership | 0% Personal Tax",
      primaryText: `🇦🇪 Launch or Expand Your Business in Dubai – Starting at Just AED 3,999! 🚀\n\nExperience seamless, hassle-free company formation in the world’s leading business hub with DigiPro Business Services LLC.\n\n💼 ALL-IN-ONE BUSINESS SETUP INCLUDES:\n✅ 100% Foreign Company Ownership\n✅ 0% Personal & Capital Gains Tax\n✅ Fast-Track Trade License & Approvals\n✅ UAE Residence / Investor Visa & Emirates ID\n✅ Guaranteed Corporate Bank Account Assistance\n✅ Complete PRO Services & Legal Documentation\n\n🎯 Tailored specifically for Business Owners, Entrepreneurs & Investors expanding into the UAE.\n\n👉 Click "Learn More" to check your eligibility, get an instant package quote, and speak directly with our senior UAE licensing specialist!`
    },
    {
      name: "DigiPro - Dubai Business Success Starts Here (4Q)",
      hash: "61f12ae499f9122cd29b66112afe14ec",
      headline: "Dubai Company Setup | Packages from AED 3,999",
      description: "Fast Trade License & Investor Visa Support",
      primaryText: `🌟 Dubai Business Success Starts Here! 🇦🇪\n\nScale your venture in the UAE with expert guidance from DigiPro Business Services. Comprehensive company registration packages starting from just AED 3,999.\n\n🔑 WHY SET UP WITH DIGIPRO?\n• 100% Foreign Ownership in Top UAE Freezones & Mainland\n• Fast Processing & Instant Government Approvals\n• Complete Investor & Partner Residence Visas\n• Seamless Corporate Bank Account Opening Support\n• Dedicated Business Setup Consultant assigned to you\n\nStop worrying about complicated legalities. We handle every detail from licensing to visas.\n\n👉 Tap "Learn More" now to claim your exclusive setup consultation and quote!`
    },
    {
      name: "DigiPro - Dubai Dreams Business Launchpad (4Q)",
      hash: "971db3d768840b1ced5aaf6ece7cbc30",
      headline: "Turn Your Dubai Business Vision into Reality",
      description: "UAE Setup Packages Starting from AED 3,999",
      primaryText: `🇦🇪 Ready to Take Your Business Global through Dubai? 💼✨\n\nJoin thousands of successful entrepreneurs who established their tax-free business in Dubai with DigiPro.\n\n💰 PACKAGES STARTING FROM AED 3,999\n✅ Complete Trade License issuance\n✅ UAE Residence Visa + Emirates ID processing\n✅ Freezone & Mainland options available\n✅ Multi-currency Corporate Bank Account guidance\n✅ 100% tax-efficient legal structuring\n\nWhether you're based in India, UAE, or anywhere worldwide, our experts manage your complete setup remotely or locally.\n\n👉 Click "Learn More" to get started with your high-intent setup questionnaire today!`
    }
  ];

  const newCreativeIds: Array<{ name: string; id: string }> = [];
  for (const c of creativesDef) {
    const payload = {
      name: c.name,
      access_token: token,
      object_story_spec: {
        page_id: pageId,
        instagram_user_id: instagramUserId,
        link_data: {
          link: "https://www.digiprouae.com/",
          message: c.primaryText,
          name: c.headline,
          description: c.description,
          image_hash: c.hash,
          call_to_action: {
            type: "LEARN_MORE",
            value: {
              lead_gen_form_id: newFormId
            }
          }
        }
      }
    };

    const crRes = await metaFetch(`https://graph.facebook.com/v21.0/${adAcc}/adcreatives`, payload);
    console.log(`✓ Creative Created: [${c.name}] -> ID ${crRes.id}`);
    newCreativeIds.push({ name: c.name, id: crRes.id });
  }

  // =========================================================================
  // 5. UPDATE ADS IN UAE ADSET TO USE THE NEW CREATIVES
  // =========================================================================
  console.log('\n--- Step 5: Updating Live Ads in UAE AdSet ---');

  const uaeAds = [
    { id: '120252584939940286', name: 'DigiPro - Dubai Business Launchpad (From 3999 AED) - UAE / Dubai', creativeId: newCreativeIds[0].id },
    { id: '120252584941120286', name: 'DigiPro - Dubai Business Success Starts Here - UAE / Dubai', creativeId: newCreativeIds[1].id },
    { id: '120252584942450286', name: 'DigiPro - Dubai Dreams Business Launchpad - UAE / Dubai', creativeId: newCreativeIds[2].id }
  ];

  for (const ad of uaeAds) {
    const updateAdRes = await metaFetch(`https://graph.facebook.com/v21.0/${ad.id}`, {
      creative: { creative_id: ad.creativeId },
      status: 'ACTIVE',
      access_token: token
    });
    console.log(`✓ Ad [${ad.name}] (${ad.id}) updated to Creative ${ad.creativeId}`);
  }

  // =========================================================================
  // 6. VERIFY FINAL STATUSES
  // =========================================================================
  console.log('\n--- Step 6: Verifying Account & Campaign Status ---');
  const finalCamp = await (await fetch(`https://graph.facebook.com/v21.0/${campaignId}?fields=id,name,status,effective_status&access_token=${token}`)).json();
  const finalUaeAs = await (await fetch(`https://graph.facebook.com/v21.0/${uaeAdsetId}?fields=id,name,status,effective_status,targeting&access_token=${token}`)).json();
  const finalIndiaAs = await (await fetch(`https://graph.facebook.com/v21.0/${indiaAdsetId}?fields=id,name,status,effective_status&access_token=${token}`)).json();

  console.log('Campaign Status:', finalCamp.status, `(Effective: ${finalCamp.effective_status})`);
  console.log('UAE AdSet Status:', finalUaeAs.status, `(Effective: ${finalUaeAs.effective_status})`);
  console.log('India AdSet Status:', finalIndiaAs.status, `(Effective: ${finalIndiaAs.effective_status})`);
  console.log('UAE Advantage Audience setting:', finalUaeAs.targeting?.targeting_automation);
  console.log('New Form ID:', newFormId);

  console.log('\n================================================================');
  console.log('🎉 ALL TASKS COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
