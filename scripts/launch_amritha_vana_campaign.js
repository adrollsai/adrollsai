const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USER_ID = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f'; // Raj Abhijna
const META_GRAPH_VERSION = 'v21.0';

async function launchCampaign() {
  console.log('================================================================');
  console.log('🚀 LAUNCHING HIGH INTENT INSTANT FORM CAMPAIGN: AMRITHA VANA');
  console.log('================================================================');

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', USER_ID)
    .single();

  if (error || !profile) {
    throw new Error('Profile not found for Raj Abhijna: ' + error?.message);
  }

  const token = profile.facebook_token;
  const pageToken = profile.selected_page_token;
  const pageId = profile.selected_page_id;
  const adAccountId = profile.ad_account_id;

  console.log('Account Details:');
  console.log(`- Business: ${profile.business_name}`);
  console.log(`- Ad Account: ${adAccountId}`);
  console.log(`- Page ID: ${pageId}`);

  // Creative Hashes & Metadata uploaded previously
  const creatives = [
    {
      id: 'glamping',
      name: 'Ad 1 - Luxury Glamping & Dome Retreat',
      imageHash: '9c90d1f18b8eebb117f49d9adc4b026f',
      headline: 'Amritha Vana | Farm Plot + Dome ₹50L',
      primaryText: `Own your private nature retreat just 25 kms from Mysore Palace! 🌿🏡

Amritha Vana brings you an exclusive 40-acre nature sanctuary on the Mysore-Madikeri Road:
✨ 6,000 Sq.Ft Farm Plot with Luxury Geodesic Dome
✨ Special Launch Package: ₹50 Lakhs (First 20 Sites Only)
✨ Includes 20 Fruit Trees, Kitchen Garden, Gazebo & Fireplace
✨ Optional 600 Sq.Ft Villa with Resort Time-Share & Rental Income
✨ 100% Clear Title, Picketed Fence & Gated Community

Escape city noise and invest in an appreciating green sanctuary.

👉 Tap 'Learn More' to download the masterplan & claim the launch offer!`,
      description: 'Launch Offer ₹50L | First 20 Sites',
    },
    {
      id: 'retreat',
      name: 'Ad 2 - 40-Acre Nature Living & Farm Retreat',
      imageHash: '6f0dc3ffa05e5dc268f9430bc19e56ea',
      headline: '40-Acre Luxury Farm Living | Mysore',
      primaryText: `Experience true nature living at Amritha Vana, Mysore-Madikeri Road 🍃

Wake up to birdsong, misty mornings, and fresh organic greens on your own 6,000 sq.ft farm estate.

🌾 Min 6,000 Sq.Ft Residential Farm Plot + Dome
🌾 Launch Price: ₹50 Lakhs (Plot + Dome Included)
🌾 20 Fruit Trees, Organic Kitchen Garden & Private Fountain
🌾 7 Days Complimentary Stay / Yr + Passive Resort Revenue
🌾 Located on Mysore-Madikeri Highway, 25 mins from Mysore Palace

Limited to only 20 early investor plots at this launch price.

👉 Tap 'Learn More' to view plot layouts, brochure, and schedule a private site visit!`,
      description: '6,000 Sq.Ft Farm Plot + Dome @ ₹50L',
    },
    {
      id: 'golden_horizon',
      name: 'Ad 3 - Golden Horizon Farmland Investment',
      imageHash: 'd30011348fff3358a5adff8c94a01c8b',
      headline: 'Luxury Farm Plots | Mysore-Madikeri Rd',
      primaryText: `Looking for a high-yield farmland investment with luxury living? 🌳

Amritha Vana offers a unique Land + Dome + Managed Resort Time-Share Model:
🔹 6,000 Sq.Ft Farm Plot + Geodesic Dome @ ₹50 Lakhs
🔹 Optional 600 Sq.Ft Luxury Villa & Private Pool
🔹 Professional Resort Operations: Earn passive rental income + 7 days free personal stay every year!
🔹 Situated near KR Nagara Junction, behind Coffee Day on Mysore-Madikeri Road

Enjoy high capital appreciation with guaranteed resort operations.

👉 Tap 'Learn More' to get pricing sheets and masterplan on WhatsApp!`,
      description: 'Launch Offer ₹50 Lakhs | Limited Sites',
    },
  ];

  // 1. Create High Intent Instant Lead Form
  console.log('\n--- Step 1: Creating Official High Intent Instant Lead Form ---');
  const formPayload = {
    name: `Amritha Vana - High Intent Form - ${Date.now().toString().slice(-4)}`,
    is_optimized_for_quality: true, // Higher intent review screen!
    question_page_custom_headline: 'Amritha Vana – Luxury Farm Project',
    question_page_custom_text: 'Confirm your details to receive official brochures, layout plans and launch pricing on WhatsApp.',
    follow_up_action_url: 'https://wa.me/918288835235?text=Hi%2C%20I%20have%20submitted%20my%20details%20for%20Amritha%20Vana%20Mysore%20farm%20plots.',
    privacy_policy: {
      url: 'https://rajinfrastructure.com/privacy',
      link_text: 'Privacy Policy',
    },
    questions: [
      { type: 'FULL_NAME', key: 'full_name' },
      { type: 'PHONE', key: 'phone_number' },
      { type: 'CITY', key: 'city' },
      {
        type: 'CUSTOM',
        label: 'What is your primary interest in Amritha Vana?',
        options: [
          { value: 'Luxury Weekend Farmhouse with Dome', key: 'weekend_farmhouse' },
          { value: 'Farm Plot with Resort Rental Income', key: 'resort_rental_income' },
          { value: 'Nature Living & Organic Farming', key: 'nature_living' },
          { value: 'Long-term Land Investment', key: 'land_investment' },
        ],
      },
      {
        type: 'CUSTOM',
        label: 'Preferred plot configuration & budget?',
        options: [
          { value: '₹50 Lakhs (6000 Sq.Ft Plot + Dome Launch Offer)', key: 'plot_dome_50l' },
          { value: '₹50L - ₹90L (Plot + Luxury Villa Construction)', key: 'plot_villa_90l' },
          { value: 'Multiple Plots / 12,000+ Sq.Ft', key: 'multiple_plots' },
        ],
      },
      {
        type: 'CUSTOM',
        label: 'When would you like to schedule a site visit?',
        options: [
          { value: 'This Coming Weekend', key: 'this_weekend' },
          { value: 'Within The Next 7-10 Days', key: 'next_7_10_days' },
          { value: 'Next Month / Virtual Presentation First', key: 'next_month_virtual' },
        ],
      },
    ],
    access_token: pageToken || token,
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

  // 2. Create Campaign (CBO with ₹1,000 Daily Budget)
  console.log('\n--- Step 2: Creating Meta Ads Campaign ---');
  const campaignName = 'Amritha Vana Mysore - Luxury Farm Retreats (High Intent HNI)';
  const dailyBudgetInr = 1000; // ₹1,000 / day
  const dailyBudgetSubunits = Math.round(dailyBudgetInr * 100);

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

  // Target Location Coordinates (Latitude & Longitude)
  const customLocations = [
    {
      latitude: 12.342025,
      longitude: 76.43143,
      radius: 35,
      distance_unit: 'kilometer',
    }, // Amritha Vana Project & immediate catchment (Mysore-Madikeri Rd, Bilikere, KR Nagara, Hunsur)
    {
      latitude: 12.3051,
      longitude: 76.6551,
      radius: 25,
      distance_unit: 'kilometer',
    }, // Mysore Urban Core (VV Mohalla, Jayalakshmipuram, Gokulam, Yadavagiri, Vijayanagar, Chamundi)
    {
      latitude: 12.4244,
      longitude: 75.7382,
      radius: 25,
      distance_unit: 'kilometer',
    }, // Madikeri / Coorg Estate belt
    {
      latitude: 12.9716,
      longitude: 77.5946,
      radius: 30,
      distance_unit: 'kilometer',
    }, // Bengaluru - Mysore Expressway Corridor & South/West Bengaluru HNI catchments
  ];

  // 3. Create Ad Set 1: Broad Audience (Lat/Long Precise Geo)
  console.log('\n--- Step 3: Creating Ad Set 1 (Broad Audience Geo Lat/Long) ---');
  const adSet1Payload = {
    name: 'AdSet 1 - Broad Geo (Lat/Long Mysore & Catchments)',
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    destination_type: 'ON_AD',
    promoted_object: { page_id: pageId },
    targeting: {
      geo_locations: { custom_locations: customLocations },
      age_min: 28,
      age_max: 65,
      targeting_automation: { advantage_audience: 0 },
      publisher_platforms: ['facebook', 'instagram'],
      device_platforms: ['mobile', 'desktop'],
    },
    status: 'ACTIVE',
    access_token: token,
  };

  const adset1Res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adsets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adSet1Payload),
  });
  const adset1Data = await adset1Res.json();
  if (adset1Data.error || !adset1Data.id) {
    throw new Error('Failed to create AdSet 1: ' + JSON.stringify(adset1Data));
  }
  const adSet1Id = adset1Data.id;
  console.log(`✓ AdSet 1 Created: ${adSet1Payload.name} (ID: ${adSet1Id})`);

  // 4. Create Ad Set 2: Detailed Targeting (HNIs - Demographics & Luxury Behaviors)
  console.log('\n--- Step 4: Creating Ad Set 2 (Detailed Targeting - HNI Demographics & Behaviors) ---');
  const adSet2Payload = {
    name: 'AdSet 2 - HNI Detailed (Luxury Behaviors, HNWIs & Property Investors)',
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    destination_type: 'ON_AD',
    promoted_object: { page_id: pageId },
    targeting: {
      geo_locations: { custom_locations: customLocations },
      age_min: 30,
      age_max: 65,
      targeting_automation: { advantage_audience: 0 },
      publisher_platforms: ['facebook', 'instagram'],
      device_platforms: ['mobile', 'desktop'],
      flexible_spec: [
        {
          behaviors: [
            { id: '6022788483583', name: 'Frequent international travellers' },
            { id: '6002714895372', name: 'Frequent travellers' },
          ],
          interests: [
            { id: '6007695620311', name: 'High-net-worth individual (business and finance)' },
            { id: '6003446239080', name: 'Property investing (investing)' },
            { id: '6007828099136', name: 'Luxury goods (retail)' },
            { id: '6004048615096', name: 'Luxury vehicle (vehicles)' },
            { id: '6003510075864', name: 'Golf (sport)' },
            { id: '6003071837444', name: 'Real estate investment association' },
          ],
        },
      ],
    },
    status: 'ACTIVE',
    access_token: token,
  };

  const adset2Res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adsets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adSet2Payload),
  });
  const adset2Data = await adset2Res.json();
  if (adset2Data.error || !adset2Data.id) {
    throw new Error('Failed to create AdSet 2: ' + JSON.stringify(adset2Data));
  }
  const adSet2Id = adset2Data.id;
  console.log(`✓ AdSet 2 Created: ${adSet2Payload.name} (ID: ${adSet2Id})`);

  // 5. Create Ad Creatives and Ads under both Ad Sets
  console.log('\n--- Step 5: Creating Ad Creatives and Ads for Both Ad Sets ---');
  const createdAds = [];

  for (const item of creatives) {
    console.log(`\nCreating Creative & Ads for: ${item.name}`);

    // Create Ad Creative
    const creativePayload = {
      name: `${item.name} - Creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message: item.primaryText,
          name: item.headline,
          description: item.description,
          image_hash: item.imageHash,
          link: formPayload.follow_up_action_url,
          call_to_action: {
            type: 'LEARN_MORE',
            value: {
              lead_gen_form_id: leadFormId,
              link: formPayload.follow_up_action_url,
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

    // Create Ad in AdSet 1 (Broad)
    const ad1Payload = {
      name: `${item.name} [Broad Geo]`,
      adset_id: adSet1Id,
      creative: { creative_id: creativeId },
      status: 'ACTIVE',
      access_token: token,
    };
    const ad1Res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ad1Payload),
    });
    const ad1Data = await ad1Res.json();
    if (ad1Data.error || !ad1Data.id) {
      throw new Error(`Failed to create Ad 1 for ${item.name}: ` + JSON.stringify(ad1Data));
    }
    console.log(`✓ Ad Launched in AdSet 1 (ID: ${ad1Data.id})`);

    // Create Ad in AdSet 2 (Detailed HNI)
    const ad2Payload = {
      name: `${item.name} [HNI Detailed]`,
      adset_id: adSet2Id,
      creative: { creative_id: creativeId },
      status: 'ACTIVE',
      access_token: token,
    };
    const ad2Res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ad2Payload),
    });
    const ad2Data = await ad2Res.json();
    if (ad2Data.error || !ad2Data.id) {
      throw new Error(`Failed to create Ad 2 for ${item.name}: ` + JSON.stringify(ad2Data));
    }
    console.log(`✓ Ad Launched in AdSet 2 (ID: ${ad2Data.id})`);

    createdAds.push({
      creativeId,
      name: item.name,
      adInSet1: ad1Data.id,
      adInSet2: ad2Data.id,
    });
  }

  console.log('\n================================================================');
  console.log('🎉 CAMPAIGN LAUNCH SUCCESSFUL!');
  console.log('================================================================');
  console.log({
    campaignId,
    campaignName,
    status: 'ACTIVE',
    dailyBudget: `₹${dailyBudgetInr}/day`,
    leadFormId,
    formName: formPayload.name,
    adSets: [
      { id: adSet1Id, name: adSet1Payload.name, targeting: 'Broad Geo (Lat/Long)' },
      { id: adSet2Id, name: adSet2Payload.name, targeting: 'HNI Behaviors & Demographics' },
    ],
    totalAdsLaunched: createdAds.length * 2,
    ads: createdAds,
  });
}

launchCampaign().catch((err) => {
  console.error('\n❌ CAMPAIGN LAUNCH FAILED:', err);
  process.exit(1);
});
