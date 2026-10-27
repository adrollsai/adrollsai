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
  console.log('🚀 DEPLOYING OPTIMIZED 1-TAP HIGH-INTENT FORM FOR DIGIPRO UAE');
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

  // Get Page Access Token
  const accRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);
  const accJson = await accRes.json();
  const targetPage = accJson.data.find((x: any) => x.id === pageId);
  const pageToken = targetPage.access_token;

  const whatsappNumber = '971551102916';
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hi DigiPro, I just submitted my inquiry for Dubai business setup.')}`;

  console.log('1. Page:', targetPage.name);
  console.log('2. WhatsApp Redirect Destination:', whatsappUrl);

  // 1. CREATE OPTIMIZED LEADGEN FORM (ZERO-TYPING, 1-TAP QUALIFIERS, NO AUTO-CLOSE DEATH TRAP)
  const formPayload = {
    name: "DigiPro UAE | High Intent (1-Tap Activity + Budget + WhatsApp)",
    is_optimized_for_quality: true,
    privacy_policy: {
      url: "https://www.digiprouae.com/privacy-policy",
      link_text: "Privacy Policy"
    },
    follow_up_action_url: whatsappUrl,
    thank_you_page: {
      title: "You're Pre-Qualified for Dubai Business Setup (E1)",
      body: "Thank you! Our senior UAE licensing specialist is ready to assist you right away. Tap the button below to connect with us directly on WhatsApp for your custom package and pricing breakdown.",
      button_text: "Chat on WhatsApp",
      button_type: "VIEW_WEBSITE",
      website_url: whatsappUrl
    },
    questions: [
      // QUESTION 1: 1-Tap Business Activity Selector (Replaces typing company name)
      {
        key: "business_activity",
        label: "What type of business are you launching or expanding in Dubai?",
        type: "CUSTOM",
        options: [
          { key: "trading_ecommerce", value: "Trading, E-Commerce & Commercial" },
          { key: "it_software_media", value: "IT, Tech, Software & Digital Marketing" },
          { key: "consulting_services", value: "Consulting, Management & Professional Services" },
          { key: "general_retail_other", value: "General Commercial, Retail or Other" }
        ]
      },
      // QUESTION 2: Structure / License Type
      {
        key: "setup_type",
        label: "Which UAE business structure or license do you require?",
        type: "CUSTOM",
        options: [
          { key: "freezone", value: "Freezone License (100% Foreign Ownership + 0% Personal Tax)" },
          { key: "mainland", value: "Mainland LLC (Trade across all UAE & Local Market)" },
          { key: "license_visa", value: "Complete Package (Trade License + Investor Residence Visa)" },
          { key: "advisory", value: "Need Expert Consultation to decide the right option" }
        ]
      },
      // QUESTION 3: Budget Range (Captured for Sales Tagging, NOT auto-closed)
      {
        key: "planned_budget",
        label: "What is your planned budget for UAE business setup & licensing?",
        type: "CUSTOM",
        options: [
          { key: "budget_starter", value: "AED 3,999 - AED 6,500 (Starter Setup / Trade License)" },
          { key: "budget_complete", value: "AED 6,500 - AED 12,000 (Trade License + Investor Visa)" },
          { key: "budget_corporate", value: "AED 12,000+ (Mainland / Multi-Shareholder / Golden Visa)" },
          { key: "budget_lowest", value: "Under AED 3,999 (Looking for lowest possible package)" }
        ]
      },
      // QUESTION 4: Timeline Urgency (Captured for Sales Tagging, NOT auto-closed)
      {
        key: "timeline_to_setup",
        label: "When are you planning to start your business in Dubai?",
        type: "CUSTOM",
        options: [
          { key: "time_immediate", value: "Immediately / Within 15 Days" },
          { key: "time_1_3", value: "Within 1 - 3 Months" },
          { key: "time_later", value: "In 3+ Months / Just Exploring" }
        ]
      },
      // Contact Fields
      { key: "full_name", type: "FULL_NAME" },
      { key: "phone_number", type: "PHONE" },
      { key: "email", type: "EMAIL" }
    ],
    access_token: pageToken
  };

  const formRes = await metaFetch(`https://graph.facebook.com/v21.0/${pageId}/leadgen_forms`, formPayload);
  const newFormId = formRes.id;
  console.log(`\n✓ New Form Successfully Created: ID ${newFormId}`);
  console.log(`  Name: ${formPayload.name}`);

  // 2. CREATE 3 CREATIVES LINKED TO THIS NEW FORM (Verified Image Hashes)
  const creativesDef = [
    {
      name: "DigiPro - Dubai Business Launchpad (Optimized 1-Tap + WA)",
      image_hash: "fb412846fb907e4307be1c69719dbf1d",
      headline: "🇦🇪 Start Your Dubai Business from AED 3,999",
      description: "100% Foreign Ownership | 0% Personal Tax",
      primaryText: `🇦🇪 Launch or Expand Your Business in Dubai – Starting at Just AED 3,999! 🚀\n\nExperience seamless, hassle-free company formation in the world’s leading business hub with DigiPro Business Services LLC.\n\n💼 ALL-IN-ONE BUSINESS SETUP INCLUDES:\n✅ 100% Foreign Company Ownership\n✅ 0% Personal & Capital Gains Tax\n✅ Fast-Track Trade License & Approvals\n✅ UAE Residence / Investor Visa & Emirates ID\n✅ Guaranteed Corporate Bank Account Assistance\n✅ Complete PRO Services & Legal Documentation\n\n🎯 Tailored specifically for Business Owners, Entrepreneurs & Investors expanding into the UAE.\n\n👉 Click "Learn More" to check your eligibility, get an instant package quote, and speak directly with our senior UAE licensing specialist!`
    },
    {
      name: "DigiPro - Dubai Business Success Starts Here (Optimized 1-Tap + WA)",
      image_hash: "61f12ae499f9122cd29b66112afe14ec",
      headline: "Dubai Company Setup | Packages from AED 3,999",
      description: "Fast Trade License & Investor Visa Support",
      primaryText: `🌟 Dubai Business Success Starts Here! 🇦🇪\n\nScale your venture in the UAE with expert guidance from DigiPro Business Services. Comprehensive company registration packages starting from just AED 3,999.\n\n🔑 WHY SET UP WITH DIGIPRO?\n• 100% Foreign Ownership in Top UAE Freezones & Mainland\n• Fast Processing & Instant Government Approvals\n• Complete Investor & Partner Residence Visas\n• Seamless Corporate Bank Account Opening Support\n• Dedicated Business Setup Consultant assigned to you\n\nStop worrying about complicated legalities. We handle every detail from licensing to visas.\n\n👉 Tap "Learn More" now to claim your exclusive setup consultation and quote!`
    },
    {
      name: "DigiPro - Dubai Dreams Business Launchpad (Optimized 1-Tap + WA)",
      image_hash: "971db3d768840b1ced5aaf6ece7cbc30",
      headline: "Turn Your Dubai Business Vision into Reality",
      description: "UAE Setup Packages Starting from AED 3,999",
      primaryText: `🇦🇪 Ready to Take Your Business Global through Dubai? 💼✨\n\nJoin thousands of successful entrepreneurs who established their tax-free business in Dubai with DigiPro.\n\n💰 PACKAGES STARTING FROM AED 3,999\n✅ Complete Trade License issuance\n✅ UAE Residence Visa + Emirates ID processing\n✅ Freezone & Mainland options available\n✅ Multi-currency Corporate Bank Account guidance\n✅ 100% tax-efficient legal structuring\n\nWhether you're based in India, UAE, or anywhere worldwide, our experts manage your complete setup remotely or locally.\n\n👉 Click "Learn More" to get started with your high-intent setup questionnaire today!`
    }
  ];

  console.log('\n--- Step 2: Creating Creatives ---');
  const newCreativeIds: any[] = [];
  for (const c of creativesDef) {
    const creativePayload = {
      name: c.name,
      object_story_spec: {
        page_id: pageId,
        instagram_user_id: instagramUserId,
        link_data: {
          image_hash: c.image_hash,
          link: "https://www.digiprouae.com/",
          message: c.primaryText,
          name: c.headline,
          description: c.description,
          call_to_action: {
            type: "LEARN_MORE",
            value: {
              lead_gen_form_id: newFormId
            }
          }
        }
      },
      access_token: token
    };

    const crRes = await metaFetch(`https://graph.facebook.com/v21.0/${adAcc}/adcreatives`, creativePayload);
    console.log(`✓ Creative Created [${crRes.id}]: ${c.name}`);
    newCreativeIds.push({ id: crRes.id, name: c.name });
  }

  // 3. ATTACH TO THE 3 ACTIVE UAE ADS
  console.log('\n--- Step 3: Updating Active UAE Ads ---');
  const adsToUpdate = [
    { id: '120252584939940286', name: 'DigiPro - Dubai Business Launchpad (From 3999 AED) - UAE / Dubai', creativeId: newCreativeIds[0].id },
    { id: '120252584941120286', name: 'DigiPro - Dubai Business Success Starts Here - UAE / Dubai', creativeId: newCreativeIds[1].id },
    { id: '120252584942450286', name: 'DigiPro - Dubai Dreams Business Launchpad - UAE / Dubai', creativeId: newCreativeIds[2].id }
  ];

  for (const ad of adsToUpdate) {
    await metaFetch(`https://graph.facebook.com/v21.0/${ad.id}`, {
      creative: { creative_id: ad.creativeId },
      access_token: token
    });
    console.log(`✓ Ad [${ad.id}] updated with Creative [${ad.creativeId}] -> Linked to Form [${newFormId}]`);
  }

  console.log('\n================================================================');
  console.log('🎉 OPTIMIZED DIGIPRO CAMPAIGN IS LIVE!');
  console.log('================================================================');
  console.log('Active Form ID:         ', newFormId);
  console.log('Question 1:             1-Tap Business Activity (No typing dropoff)');
  console.log('Question 2:             Jurisdiction / License Type');
  console.log('Question 3:             Budget Tier (Captured for CRM tagging)');
  console.log('Question 4:             Setup Urgency (Captured for CRM tagging)');
  console.log('End Screen Action:      "Chat on WhatsApp" -> https://wa.me/971551102916');
  console.log('Welcome WA Automation:  Approved Template "digipro_lead_welcome" Active');
  console.log('Targeting:              Strict UAE (Dubai & Abu Dhabi) Founders/CEOs');
  console.log('India AdSet:            PAUSED (Zero cheap junk)');
  console.log('================================================================');
}

main().catch(console.error);
