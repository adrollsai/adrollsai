const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FB_GRAPH_URL = 'https://graph.facebook.com/v21.0';

async function launchProEstateCampaign() {
  console.log('=== STARTING PROESTATE 50CR CAMPAIGN LAUNCH ===');

  const profileId = '29937131-1975-4c5f-9b78-e5b28f918d32';
  const propertyId = '7bba5649-b64e-407c-bb7c-c1831d6600ca';
  const adAccountId = 'act_10151863832994480'; // Active prepaid account with verified Page rights
  const pageId = '561993100340763'; // The ProEstate
  const leadFormId = '1075798282147536'; // Verified High-Intent Qualifying Form

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single();

  if (pErr || !profile) {
    throw new Error('Could not find ProEstate profile: ' + (pErr?.message || 'not found'));
  }

  const token = profile.facebook_token;

  // 1. Update DB profile with active ad account
  await supabase
    .from('profiles')
    .update({ ad_account_id: adAccountId })
    .eq('id', profileId);
  console.log('✓ Updated ProEstate profile in DB with ad_account_id:', adAccountId);

  // 2. Create Campaign (Special Ad Category: HOUSING for GB & CA)
  console.log('\n--- STEP 1: CREATING CAMPAIGN ---');
  const campaignName = `The ProEstate - 2.75 Kanal Sector 33A Chandigarh (UK & Canada NRIs) - ${new Date().toISOString().slice(0, 10)}`;
  const dailyBudgetPaise = 1000 * 100; // Rs. 1000 daily budget = 100,000 paise

  const campPayload = {
    name: campaignName,
    objective: 'OUTCOME_LEADS',
    status: 'ACTIVE',
    buying_type: 'AUCTION',
    special_ad_categories: ['HOUSING'],
    special_ad_category_country: ['GB', 'CA'],
    daily_budget: dailyBudgetPaise,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    access_token: token
  };

  const campRes = await axios.post(`${FB_GRAPH_URL}/${adAccountId}/campaigns`, campPayload);
  const campaignId = campRes.data.id;
  console.log('✓ Campaign created successfully! Meta Campaign ID:', campaignId);

  // 3. Create Ad Set (Targeting UK & Canada)
  console.log('\n--- STEP 2: CREATING AD SET ---');
  const adsetName = 'UK & Canada NRIs - Luxury Real Estate (GB & CA Broad)';
  const adsetPayload = {
    name: adsetName,
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    destination_type: 'ON_AD',
    optimization_goal: 'LEAD_GENERATION',
    promoted_object: { page_id: pageId },
    targeting: {
      geo_locations: {
        countries: ['GB', 'CA']
      }
    },
    status: 'ACTIVE',
    access_token: token
  };

  const adsetRes = await axios.post(`${FB_GRAPH_URL}/${adAccountId}/adsets`, adsetPayload);
  const adsetId = adsetRes.data.id;
  console.log('✓ AdSet created successfully! Meta AdSet ID:', adsetId);

  // 4. Create Ad Creatives & Ads
  console.log('\n--- STEP 3: CREATING AD CREATIVES & ADS ---');
  const creativesConfig = [
    {
      name: 'Ad 1 - 2.75 Kanal Sector 33A Trophy Estate',
      imageHash: '8cf293cbd7c20b2be122564720f08499', // 1.jpeg
      headline: 'Sector 33A Chandigarh: 2.75 Kanal Trophy Estate',
      primaryText: `An unprecedented opportunity to acquire one of Chandigarh’s most coveted residential land parcels.\n\nLocated in prime Sector 33A, this rare 2.75 Kanal (~1,375 Sq. Yds) corner estate features two-side open access, majestic frontage, and complete privacy amidst Chandigarh’s elite residential belt.\n\n🏛️ Plot Size: 2.75 Kanal\n📍 Location: Sector 33A, Chandigarh\n✨ Orientation: Premium Corner Plot | Two-Side Open\n💎 Investment: ₹50 Crore (~£4.7M / ~$8.2M CAD)\n\nStrictly for discerning Ultra-High-Net-Worth NRIs seeking a landmark legacy residence in the City Beautiful.\n\nTap 'Learn More' to review the private dossier or connect directly on WhatsApp with our Senior Advisory Partner.`,
      description: 'Sector 33A | 2.75 Kanal Corner Plot | Private Portfolio'
    },
    {
      name: 'Ad 2 - Rare 2.75 Kanal Corner Residence',
      imageHash: 'ef1d2c9912ddbdffd3003e6166d0751b', // 2.jpeg
      headline: 'Rare 2.75 Kanal Corner Residence | Chandigarh',
      primaryText: `Properties of this scale and stature in Chandigarh’s inner sectors almost never enter the open market.\n\nThe ProEstate presents a bespoke 2.75 Kanal corner estate in prestigious Sector 33A, Chandigarh. Offering expansive dimensions, unmatched road frontage, and two-side open orientation—ideal for crafting an architectural masterpiece.\n\n• Prime Sector 33A Address\n• Expansive 2.75 Kanal Freehold Footprint\n• Two-Side Open Corner Positioning\n• Asking: ₹50 Crore (Clear Titles & Single Ownership)\n\nConfidential inquiries only. Dedicated video walkthroughs and legal dossiers available for UK & Canada based NRIs.\n\nClick below to register your confidential inquiry.`,
      description: 'Ultra-Luxury Estate | Sector 33A Chandigarh | ₹50 Cr'
    }
  ];

  const createdAds = [];
  const linkUrl = 'https://theproestate.in';

  for (const config of creativesConfig) {
    console.log(`\nCreating ${config.name}...`);
    const creativePayload = {
      name: config.name,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message: config.primaryText,
          name: config.headline,
          description: config.description,
          link: linkUrl,
          image_hash: config.imageHash,
          call_to_action: {
            type: 'LEARN_MORE',
            value: {
              lead_gen_form_id: leadFormId,
              link: linkUrl
            }
          }
        }
      },
      access_token: token
    };

    const crRes = await axios.post(`${FB_GRAPH_URL}/${adAccountId}/adcreatives`, creativePayload);
    const creativeId = crRes.data.id;
    console.log(`✓ Creative created! Meta Creative ID: ${creativeId}`);

    const adPayload = {
      name: config.name,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: 'ACTIVE',
      access_token: token
    };

    const adRes = await axios.post(`${FB_GRAPH_URL}/${adAccountId}/ads`, adPayload);
    console.log(`✓ Ad created & published! Meta Ad ID: ${adRes.data.id}`);
    createdAds.push({
      name: config.name,
      adId: adRes.data.id,
      creativeId
    });
  }

  // 5. Update Supabase properties table
  console.log('\n--- STEP 4: UPDATING DATABASE ---');
  await supabase
    .from('properties')
    .update({
      meta_campaign_id: campaignId,
      meta_campaign_status: 'ACTIVE',
      price: '₹50 Crore'
    })
    .eq('id', propertyId);
  console.log('✓ Updated properties table for Property:', propertyId);

  // 6. Record Campaign Job
  await supabase
    .from('campaign_jobs')
    .insert({
      user_id: profileId,
      target_user_id: profileId,
      campaign_id: campaignId,
      status: 'completed',
      message: 'The ProEstate 2.75 Kanal ₹50 Cr Chandigarh Campaign Launched for UK & Canada NRIs!',
      payload: {
        campaignId,
        adsetId,
        leadFormId,
        adAccountId,
        pageId,
        budget: '₹1,000/day',
        targetCountries: ['GB', 'CA'],
        ads: createdAds
      }
    });
  console.log('✓ Inserted campaign_job record in Supabase');

  console.log('\n=== CAMPAIGN SUCCESSFULLY LAUNCHED AND LIVE ON META! ===');
  console.log({
    campaignId,
    campaignName,
    adsetId,
    adAccountId,
    pageId,
    leadFormId,
    dailyBudget: '₹1,000',
    adsCount: createdAds.length,
    ads: createdAds
  });
}

launchProEstateCampaign().catch(err => {
  console.error('\n❌ CRITICAL LAUNCH ERROR:', err.response?.data || err.message);
  process.exit(1);
});

