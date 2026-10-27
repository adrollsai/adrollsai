const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DECCAN_USER_ID = '93c65dee-87a5-48e3-a2d2-406182a33b37';
const META_GRAPH_VERSION = 'v21.0';

async function launchDeccanNagpurCampaign() {
  console.log('================================================================');
  console.log('🚀 LAUNCHING NAGPUR PLOTS HIGH INTENT CAMPAIGN ON DECCAN REALTORS');
  console.log('================================================================');

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', DECCAN_USER_ID)
    .single();

  if (error || !profile) {
    throw new Error('Profile not found for Deccan Realtors: ' + error?.message);
  }

  const token = profile.facebook_token;
  const pageToken = profile.selected_page_token || profile.facebook_token;
  const pageId = profile.selected_page_id; // '1233494216519110'
  const adAccountId = profile.ad_account_id; // 'act_1724043552166595'
  const instagramId = '17841436111522920';

  console.log('Account Details:');
  console.log(`- Business: ${profile.business_name}`);
  console.log(`- Ad Account: ${adAccountId}`);
  console.log(`- Page ID: ${pageId}`);
  console.log(`- Instagram ID: ${instagramId}`);

  // Load uploaded creatives
  const uploadedCreatives = JSON.parse(fs.readFileSync('deccan_uploaded_creatives.json', 'utf8'));
  console.log('\nLoaded Uploaded Creatives:');
  uploadedCreatives.forEach(c => console.log(`- ${c.filename}: Hash ${c.imageHash}`));

  const creativeMap = {};
  uploadedCreatives.forEach(c => {
    creativeMap[c.filename] = c.imageHash;
  });

  const adSpecs = [
    {
      id: 'luxury_nagpur_plots',
      name: 'Ad 1 - Luxury Nagpur Plots (Starting 20L | 90% Loan)',
      imageHash: creativeMap['Luxury Nagpur Plots Advertisement.png'],
      headline: 'Plots in Nagpur from ₹20 Lakhs | 90% Loan',
      description: 'NMRDA Approved | 90% Bank Loan',
      primaryText: `🌳 Own Your Prime Residential Plot in Nagpur Starting at Just ₹20 Lakhs!

Deccan Realtors presents exclusive, sanctioned residential plots situated in Nagpur's fastest-growing development corridors. Secure your piece of land with minimal initial investment and easy financing!

✨ Key Project Highlights:
🔹 Starting Price: Only ₹20 Lakhs
🔹 Easy Financing: Up to 90% Bank Loan Assistance from Leading Banks
🔹 Prime Strategic Locations: Rapid connectivity to MIHAN, Wardha Road & Outer Ring Road
🔹 100% Clear Titles with Immediate Registry & NMRDA/RL Sanction
🔹 Complete Infrastructure: Wide Tar Roads, Underground Electricity, Water Supply & Green Parks
🔹 Perfect for Immediate Villa Construction or High Capital Appreciation

Central India's growth capital is expanding rapidly. Lock in early investor rates now.

👉 Tap 'Learn More' to get instant plot layout maps, pricing sheets & loan eligibility on WhatsApp!`,
    },
    {
      id: 'navigate_next_move',
      name: 'Ad 2 - Navigate Your Next Move (Nagpur Plots from 20L)',
      imageHash: creativeMap['Navigate Your Next Move in Nagpur.png'],
      headline: 'Prime Nagpur Plots @ ₹20L | 90% Loan Facility',
      description: 'Up to 90% Loan | Ready Possession',
      primaryText: `🏡 Build Your Dream Villa in Nagpur | Plots Starting from ₹20 Lakhs!

Looking for verified, high-appreciation residential land in Nagpur? Deccan Realtors helps you make safe, high-yield property decisions with 100% title transparency.

🌟 Why Buyers Choose This Project:
✅ Affordable Luxury: Gated layout plots starting from ₹20 Lakhs
✅ 90% Bank Loan Approved: Minimal down payment with flexible EMI plans
✅ Rapid Growth Corridor: Minutes from Metro, educational hubs, and IT parks
✅ Ready-to-Build Infrastructure: Gated security, streetlights, landscaped gardens & water lines
✅ Complete legal due diligence & doorstep loan processing support

Take the right step toward building your family home or securing a high-yield real estate asset.

👉 Tap 'Learn More' to check available plot dimensions & download the project brochure!`,
    },
    {
      id: 'sunset_poster',
      name: 'Ad 3 - Premium Nagpur Plot Investment (Sunset Horizon)',
      imageHash: creativeMap['Premium Nagpur Plot Investment Sunset Poster.png'],
      headline: 'Nagpur Plot Investment | ₹20L Onwards (90% Loan)',
      description: 'High Appreciation | 90% Loan Facility',
      primaryText: `📈 High-Yield Plot Investment in Nagpur – Starting ₹20 Lakhs with 90% Bank Loan!

With the boom in infrastructure, Samruddhi Expressway connectivity, and the expansion of the MIHAN SEZ, Nagpur is delivering exceptional returns for smart property investors.

🌟 Investment Highlights:
🔹 Fully Developed Residential Plots from ₹20 Lakhs
🔹 Hassle-Free 90% Bank Loan facility from Top Nationalized & Private Banks
🔹 NMRDA Sanctioned & 100% Clear Title Documentation
🔹 Fast Capital Appreciation with High Rental & Resale Demand
🔹 Full End-to-End Advisory, Site Visits & Legal Guidance by Deccan Realtors

Don't wait to buy real estate—buy real estate and wait!

👉 Tap 'Learn More' to see available plot numbers, pricing breakdown, and schedule your private site visit!`,
    },
  ];

  // 1. Create High Intent Instant Lead Form
  console.log('\n--- Step 1: Creating High Intent Instant Lead Form on Meta ---');
  const formPayload = {
    name: `Deccan Realtors - Nagpur Plots (Starting 20L | 90% Loan) - High Intent - ${Date.now().toString().slice(-4)}`,
    is_optimized_for_quality: true, // Higher intent review screen!
    question_page_custom_headline: 'Nagpur Prime Plots from ₹20 Lakhs | Up to 90% Bank Loan',
    question_page_custom_text: 'Confirm your preferences below to receive verified title plot layouts, brochure & loan EMI calculation on WhatsApp.',
    follow_up_action_url: 'https://wa.me/917058222685?text=Hi%20Deccan%20Realtors%2C%20I%20have%20inquired%20for%20Nagpur%20Plots%20starting%20at%2020L.',
    privacy_policy: {
      url: 'https://deccanrealtors.com',
      link_text: 'Privacy Policy',
    },
    questions: [
      {
        type: 'CUSTOM',
        label: 'What is your budget range for Nagpur plots?',
        options: [
          { value: '₹20 Lakhs – ₹30 Lakhs (Starting Range)', key: 'budget_20_30l' },
          { value: '₹30 Lakhs – ₹45 Lakhs', key: 'budget_30_45l' },
          { value: '₹45 Lakhs – ₹70 Lakhs', key: 'budget_45_70l' },
          { value: 'Above ₹70 Lakhs+ / Need 90% Bank Loan', key: 'budget_70l_plus_loan' },
        ],
      },
      {
        type: 'CUSTOM',
        label: 'When do you plan to finalize your plot purchase?',
        options: [
          { value: 'Immediately (Ready for site visit this week)', key: 'timeline_immediate' },
          { value: 'Within 15 - 30 Days', key: 'timeline_15_30_days' },
          { value: 'Within 1 - 3 Months', key: 'timeline_1_3_months' },
          { value: 'Just exploring / Future planning', key: 'timeline_exploring' },
        ],
      },
      {
        type: 'CUSTOM',
        label: 'What is your primary purpose of buying?',
        options: [
          { value: 'Immediate Home Construction (Residential Villa)', key: 'purpose_home_construction' },
          { value: 'High-Return Investment & Capital Appreciation', key: 'purpose_investment_roi' },
          { value: 'Long-Term Wealth Creation', key: 'purpose_wealth_creation' },
          { value: 'Farmhouse / Weekend Retreat', key: 'purpose_weekend_retreat' },
        ],
      },
      { type: 'FULL_NAME', key: 'full_name' },
      { type: 'PHONE', key: 'phone_number' },
      { type: 'EMAIL', key: 'email' },
      { type: 'CITY', key: 'city' },
    ],
    thank_you_page: {
      title: "You're Pre-Qualified for Plot Allotment!",
      body: 'Thank you for your interest! Our senior property advisor at Deccan Realtors will connect with you on WhatsApp and call with layout plans, available plot numbers, and bank loan eligibility details.',
      button_text: 'Connect on WhatsApp',
      button_type: 'VIEW_WEBSITE',
      website_url: 'https://wa.me/917058222685?text=Hi%20Deccan%20Realtors%2C%20I%20have%20inquired%20for%20Nagpur%20Plots%20starting%20at%2020L.',
    },
    access_token: pageToken,
  };

  const formRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}/leadgen_forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formPayload),
  });
  const formData = await formRes.json();
  if (formData.error || !formData.id) {
    throw new Error('Failed to create lead form: ' + JSON.stringify(formData));
  }
  const leadFormId = formData.id;
  console.log(`✓ High Intent Lead Form Created: ID ${leadFormId}`);

  // 2. Create Campaign (CBO with ₹500 Daily Budget)
  console.log('\n--- Step 2: Creating Meta Ads Campaign ---');
  const campaignName = 'Deccan Realtors - Nagpur Prime Plots (Starting 20L | 90% Loan) - High Intent HNI';
  const dailyBudgetInr = 500; // ₹500 / day
  const dailyBudgetSubunits = Math.round(dailyBudgetInr * 100); // 50000 paise

  const campaignPayload = {
    name: campaignName,
    objective: 'OUTCOME_LEADS',
    status: 'ACTIVE',
    buying_type: 'AUCTION',
    daily_budget: dailyBudgetSubunits.toString(),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    special_ad_categories: [],
    access_token: token,
  };

  const campRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(campaignPayload),
  });
  const campData = await campRes.json();
  if (campData.error || !campData.id) {
    throw new Error('Failed to create campaign: ' + JSON.stringify(campData));
  }
  const campaignId = campData.id;
  console.log(`✓ Campaign Created: ${campaignName} (ID: ${campaignId})`);

  // 3. Create Ad Set: Single AdSet with HNI Targeting as in Shahrukhz Broad Adset + Nagpur Lat/Long Radius
  console.log('\n--- Step 3: Creating Single Ad Set (HNI Targeting + Nagpur 35km Lat/Long Radius) ---');
  const customLocations = [
    {
      latitude: 21.1458,
      longitude: 79.0882,
      radius: 35,
      distance_unit: 'kilometer',
    },
  ];

  const adSetPayload = {
    name: 'AdSet - HNI Broad Geo (Nagpur 35km Lat/Long)',
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    destination_type: 'ON_AD',
    promoted_object: { page_id: pageId },
    targeting: {
      geo_locations: {
        custom_locations: customLocations,
        location_types: ['home', 'recent'],
      },
      age_min: 25,
      age_max: 65,
      targeting_automation: { advantage_audience: 1 },
      publisher_platforms: ['facebook', 'instagram'],
      facebook_positions: [
        'feed',
        'instream_video',
        'marketplace',
        'story',
        'search',
        'biz_disco_feed',
        'facebook_reels',
        'facebook_reels_overlay',
        'profile_feed',
        'notification',
      ],
      instagram_positions: [
        'stream',
        'story',
        'explore',
        'reels',
        'explore_home',
        'profile_feed',
        'ig_search',
      ],
      device_platforms: ['mobile', 'desktop'],
      flexible_spec: [
        {
          user_adclusters: [
            {
              id: '6661019705983',
              name: 'Household income (India): Top 10%',
            },
          ],
          behaviors: [
            {
              id: '6002714895372',
              name: 'Frequent Travelers',
            },
            {
              id: '6022788483583',
              name: 'Frequent international travelers',
            },
            {
              id: '6028974370383',
              name: 'People who prefer high-value goods in India',
            },
          ],
        },
      ],
    },
    status: 'ACTIVE',
    access_token: token,
  };

  const adsetRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adsets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adSetPayload),
  });
  const adsetData = await adsetRes.json();
  if (adsetData.error || !adsetData.id) {
    throw new Error('Failed to create AdSet: ' + JSON.stringify(adsetData));
  }
  const adSetId = adsetData.id;
  console.log(`✓ AdSet Created: ${adSetPayload.name} (ID: ${adSetId})`);

  // 4. Create Ad Creatives and Ads under the Ad Set
  console.log('\n--- Step 4: Creating Ad Creatives and Ads ---');
  const createdAds = [];

  for (const item of adSpecs) {
    console.log(`\nCreating Creative & Ad for: ${item.name}`);

    // Create Ad Creative
    const creativePayload = {
      name: `${item.name} - Creative`,
      object_story_spec: {
        page_id: pageId,
        instagram_user_id: instagramId,
        link_data: {
          message: item.primaryText,
          name: item.headline,
          description: item.description,
          image_hash: item.imageHash,
          link: 'https://deccanrealtors.com',
          call_to_action: {
            type: 'LEARN_MORE',
            value: {
              lead_gen_form_id: leadFormId,
              link: 'https://deccanrealtors.com',
            },
          },
        },
      },
      access_token: token,
    };

    const creativeRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adcreatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creativePayload),
    });
    const creativeData = await creativeRes.json();
    if (creativeData.error || !creativeData.id) {
      throw new Error(`Failed to create creative for ${item.name}: ` + JSON.stringify(creativeData));
    }
    const creativeId = creativeData.id;
    console.log(`✓ Creative Created (ID: ${creativeId})`);

    // Create Ad in the single AdSet
    const adPayload = {
      name: item.name,
      adset_id: adSetId,
      creative: { creative_id: creativeId },
      status: 'ACTIVE',
      access_token: token,
    };

    const adRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adPayload),
    });
    const adData = await adRes.json();
    if (adData.error || !adData.id) {
      throw new Error(`Failed to create Ad for ${item.name}: ` + JSON.stringify(adData));
    }
    console.log(`✓ Ad Launched (ID: ${adData.id})`);

    createdAds.push({
      id: adData.id,
      name: item.name,
      creativeId: creativeId,
      imageHash: item.imageHash,
    });
  }

  const summary = {
    timestamp: new Date().toISOString(),
    account: {
      business_name: profile.business_name,
      ad_account_id: adAccountId,
      page_id: pageId,
      page_name: profile.selected_page_name,
      instagram_id: instagramId,
    },
    campaign: {
      id: campaignId,
      name: campaignName,
      objective: 'OUTCOME_LEADS',
      status: 'ACTIVE',
      daily_budget: `₹${dailyBudgetInr}/day`,
    },
    adset: {
      id: adSetId,
      name: adSetPayload.name,
      geo_targeting: 'Nagpur (Lat: 21.1458, Lng: 79.0882, Radius: 35km)',
      hni_targeting: 'Household Income Top 10%, Frequent Travelers, International Travelers, High-Value Goods Buyers',
      status: 'ACTIVE',
    },
    lead_form: {
      id: leadFormId,
      name: formPayload.name,
      type: 'Higher Intent / Optimized for Quality (Review Screen)',
      questions: [
        'What is your budget range for Nagpur plots?',
        'When do you plan to finalize your plot purchase?',
        'What is your primary purpose of buying?',
        'Full name',
        'Phone number',
        'Email',
        'City',
      ],
    },
    ads: createdAds,
  };

  fs.writeFileSync('deccan_campaign_launch_summary.json', JSON.stringify(summary, null, 2));

  console.log('\n================================================================');
  console.log('🎉 CAMPAIGN LAUNCH COMPLETE!');
  console.log('================================================================');
  console.log(JSON.stringify(summary, null, 2));
}

launchDeccanNagpurCampaign().catch(err => {
  console.error('\n❌ CAMPAIGN LAUNCH FAILED:', err);
  process.exit(1);
});
