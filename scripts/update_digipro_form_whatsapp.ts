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
  console.log('🚀 ATTACHING WHATSAPP REDIRECT FORM (2599398420577509) TO UAE ADS');
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
  const newFormId = "2599398420577509";

  // Creatives Definitions with EXACT verified image hashes
  const creativesDef = [
    {
      name: "DigiPro - Dubai Business Launchpad (4Q + WhatsApp)",
      image_hash: "fb412846fb907e4307be1c69719dbf1d",
      headline: "🇦🇪 Start Your Dubai Business from AED 3,999",
      description: "100% Foreign Ownership | 0% Personal Tax",
      primaryText: `🇦🇪 Launch or Expand Your Business in Dubai – Starting at Just AED 3,999! 🚀\n\nExperience seamless, hassle-free company formation in the world’s leading business hub with DigiPro Business Services LLC.\n\n💼 ALL-IN-ONE BUSINESS SETUP INCLUDES:\n✅ 100% Foreign Company Ownership\n✅ 0% Personal & Capital Gains Tax\n✅ Fast-Track Trade License & Approvals\n✅ UAE Residence / Investor Visa & Emirates ID\n✅ Guaranteed Corporate Bank Account Assistance\n✅ Complete PRO Services & Legal Documentation\n\n🎯 Tailored specifically for Business Owners, Entrepreneurs & Investors expanding into the UAE.\n\n👉 Click "Learn More" to check your eligibility, get an instant package quote, and speak directly with our senior UAE licensing specialist!`
    },
    {
      name: "DigiPro - Dubai Business Success Starts Here (4Q + WhatsApp)",
      image_hash: "61f12ae499f9122cd29b66112afe14ec",
      headline: "Dubai Company Setup | Packages from AED 3,999",
      description: "Fast Trade License & Investor Visa Support",
      primaryText: `🌟 Dubai Business Success Starts Here! 🇦🇪\n\nScale your venture in the UAE with expert guidance from DigiPro Business Services. Comprehensive company registration packages starting from just AED 3,999.\n\n🔑 WHY SET UP WITH DIGIPRO?\n• 100% Foreign Ownership in Top UAE Freezones & Mainland\n• Fast Processing & Instant Government Approvals\n• Complete Investor & Partner Residence Visas\n• Seamless Corporate Bank Account Opening Support\n• Dedicated Business Setup Consultant assigned to you\n\nStop worrying about complicated legalities. We handle every detail from licensing to visas.\n\n👉 Tap "Learn More" now to claim your exclusive setup consultation and quote!`
    },
    {
      name: "DigiPro - Dubai Dreams Business Launchpad (4Q + WhatsApp)",
      image_hash: "971db3d768840b1ced5aaf6ece7cbc30",
      headline: "Turn Your Dubai Business Vision into Reality",
      description: "UAE Setup Packages Starting from AED 3,999",
      primaryText: `🇦🇪 Ready to Take Your Business Global through Dubai? 💼✨\n\nJoin thousands of successful entrepreneurs who established their tax-free business in Dubai with DigiPro.\n\n💰 PACKAGES STARTING FROM AED 3,999\n✅ Complete Trade License issuance\n✅ UAE Residence Visa + Emirates ID processing\n✅ Freezone & Mainland options available\n✅ Multi-currency Corporate Bank Account guidance\n✅ 100% tax-efficient legal structuring\n\nWhether you're based in India, UAE, or anywhere worldwide, our experts manage your complete setup remotely or locally.\n\n👉 Click "Learn More" to get started with your high-intent setup questionnaire today!`
    }
  ];

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

  // Update the 3 Ads in UAE Adset
  const adsToUpdate = [
    { id: '120252584939940286', name: 'DigiPro - Dubai Business Launchpad (From 3999 AED) - UAE / Dubai', creativeId: newCreativeIds[0].id },
    { id: '120252584941120286', name: 'DigiPro - Dubai Business Success Starts Here - UAE / Dubai', creativeId: newCreativeIds[1].id },
    { id: '120252584942450286', name: 'DigiPro - Dubai Dreams Business Launchpad - UAE / Dubai', creativeId: newCreativeIds[2].id }
  ];

  for (const ad of adsToUpdate) {
    const updateAdRes = await metaFetch(`https://graph.facebook.com/v21.0/${ad.id}`, {
      creative: { creative_id: ad.creativeId },
      access_token: token
    });
    console.log(`✓ Ad [${ad.id}] updated with new creative ${ad.creativeId} (Form: ${newFormId})`);
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 3 ACTIVE UAE ADS SUCCESSFULLY LINKED TO WHATSAPP REDIRECT FORM!');
  console.log('================================================================');
}

main().catch(console.error);
