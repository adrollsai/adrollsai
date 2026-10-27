const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USER_ID = 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59'; // Red Rose City
const META_GRAPH_VERSION = 'v21.0';

// Uploaded Creative Image Hashes from Meta
const IMAGE_HASHES = {
  rera_milestone: 'c3cc3163c50dcd7f20a2e4c663618686', // WhatsApp Image 2026-10-19 at 15.41.20.jpeg
  possession_ready: 'd96e34064a1ef081f5193119b7b015a8', // WhatsApp Image 2026-10-19 at 15.41.21 (1).jpeg
  wide_roads: '0abf18d141057fd3b9a71917ceb2779d', // WhatsApp Image 2026-10-19 at 15.41.21 (2).jpeg
  plotted_township: 'f6ecc25bd0d1bf44d27210be99f26f92', // WhatsApp Image 2026-10-19 at 15.41.21.jpeg
};

const VIDEO_ID = '1781415843125024'; // Walkthrough video uploaded to Meta Ad Account
const LEAD_FORM_ID = '1468092991837188'; // High Intent Form with 3 questions (including short answer) + WhatsApp bot redirect

async function launchCampaign() {
  console.log('================================================================');
  console.log('🚀 LAUNCHING HIGH INTENT INSTANT FORM CAMPAIGN: RED ROSE CITY');
  console.log('================================================================');

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', USER_ID)
    .single();

  if (error || !profile) {
    throw new Error('Profile not found for Red Rose City: ' + error?.message);
  }

  const token = profile.facebook_token;
  const pageId = profile.selected_page_id; // 1324728424052099
  const adAccountId = profile.ad_account_id; // act_808548219009737
  const botWhatsAppUrl = 'https://wa.me/917888804312?text=Hi%2C%20I%20have%20submitted%20my%20details%20for%20Red%20Rose%20City%20plots.';

  console.log('Account Details:');
  console.log(`- Business: ${profile.business_name}`);
  console.log(`- Ad Account: ${adAccountId}`);
  console.log(`- Page ID: ${pageId}`);
  console.log(`- WhatsApp Bot: ${profile.whatsapp_phone_number} (Redirect: ${botWhatsAppUrl})`);
  console.log(`- Lead Form ID: ${LEAD_FORM_ID}`);

  // Creative Definitions
  const creatives = [
    {
      id: 'walkthrough_video',
      type: 'video',
      name: 'Ad 1 - 21-Acre Township Tour & Walkthrough (Video)',
      videoId: VIDEO_ID,
      imageHash: IMAGE_HASHES.possession_ready,
      headline: 'RERA Approved Plots in Dera Bassi',
      primaryText: `🏡 Step inside Red Rose City by Alpine Nest Homes – Sector 9, Gulabgarh Road, Dera Bassi!

A 21-Acre RERA-Approved Plotted Township with unmatched infrastructure:
✨ Possession-Ready Residential Plots (100–150 Sq. Yd.)
✨ 45 & 30 Ft Wide Internal Roads
✨ 4 Lush Green Parks & Open Landscaped Spaces
✨ 2 Grand Gated Entries with 24×7 Security
✨ High Street Market & 2 Commercial Zones Inside
✨ Just 800m from Zirakpur-Ambala Highway | 15 mins to Mohali Airport

Build your dream home today in a fully established, ready-to-move-in township.

👉 Tap 'Learn More' to download masterplan, plot availability & price sheet on WhatsApp!`,
      description: '100–150 Sq. Yd. | RERA Approved | Dera Bassi',
    },
    {
      id: 'possession_ready_plots',
      type: 'image',
      name: 'Ad 2 - Possession Ready Plots Sector 9',
      imageHash: IMAGE_HASHES.possession_ready,
      headline: 'Possession Ready Plots | Sec 9 Dera Bassi',
      primaryText: `Why wait years for development when you can build your home today? 🏗️🏡

Red Rose City offers ready-to-build residential plots in Dera Bassi’s prime residential hub:
📍 Sector 9, Gulabgarh Road, Dera Bassi (Behind Populated Colonies)
✅ Plot Sizes: 100, 125 & 150 Sq. Yd. with Wide 20-25 Ft Frontage
✅ 45 & 30 Ft Wide Internal Roads
✅ Gated & Walled Township with 2 Grand Entrance Gates & CCTV Security
✅ 4 Beautiful Parks, Walking Tracks & Kids Play Zones
✅ Daily Convenience Shops & High Street Commercial Market
✅ 15 Mins from Chandigarh / Mohali Airport

Limited plots remaining at exclusive launch rates.

👉 Tap 'Learn More' to book your site visit & get location coordinates on WhatsApp!`,
      description: 'Immediate Possession | 100-150 Sq. Yd. Plots',
    },
    {
      id: 'rera_milestone',
      type: 'image',
      name: 'Ad 3 - RERA Approved 21-Acre Township',
      imageHash: IMAGE_HASHES.rera_milestone,
      headline: 'RERA Approved 21-Acre Township',
      primaryText: `Official Milestone: RERA Approved Township in Sector 9, Dera Bassi! 📜🏛️

Invest with 100% peace of mind at Red Rose City by Alpine Nest Homes (RERA No: PBRERA-SAS79-PR1428-082026):
🔹 Possession-Ready Residential Plots (100 to 150 Sq. Yd.)
🔹 Fully Approved Layout with Leading Bank Loan Approvals
🔹 40+ Ft Wide Internal Roads, Underground Electrification & Water Supply
🔹 Surrounded by Populated Colonies, Schools, Hospitals & Markets
🔹 Direct Connectivity to Zirakpur-Ambala Expressway

Lock in launch pricing before the upcoming price revision.

👉 Tap 'Learn More' to check available plot numbers & receive the official brochure on WhatsApp!`,
      description: 'RERA: PBRERA-SAS79-PR1428-082026',
    },
    {
      id: 'wide_roads',
      type: 'image',
      name: 'Ad 4 - 45 & 30 Ft Wide Roads Township',
      imageHash: IMAGE_HASHES.wide_roads,
      headline: '45 & 30 Ft Wide Internal Roads',
      primaryText: `रेड रोज़ सिटी – चौड़ी सड़कें, खुला और व्यवस्थित माहौल! 🛣️🌳

45 और 30 फीट की खुली अंदरूनी सड़कें जो आपके परिवार को दें एक सुरक्षित और भव्य जीवनशैली:
🌟 21 एकड़ में सुनियोजित आवासीय टाउनशिप
🌟 100 से 150 वर्ग गज के रेरा-स्वीकृत प्लॉट्स
🌟 4 सुंदर पार्क्स, कमर्शियल मार्केट और 24×7 सिक्योरिटी
🌟 ज़ीरकपुर-अंबाला हाईवे और एयरपोर्ट से बेहतरीन कनेक्टिविटी
🌟 आसपास बसावट, स्कूल, हॉस्पिटल और सभी दैनिक सुविधाएं उपलब्ध

आज ही अपना प्लॉट चुनें और अपने सपनों का आशियाना बनाएं।

👉 'Learn More' पर क्लिक करें और व्हाट्सऐप पर ब्रोशर व रेट लिस्ट प्राप्त करें!`,
      description: 'सेक्टर 9, गुलाबगढ़ रोड, डेरा बस्सी',
    },
    {
      id: 'plotted_township',
      type: 'image',
      name: 'Ad 5 - 21 Acre Plotted Township',
      imageHash: IMAGE_HASHES.plotted_township,
      headline: '21 एकड़ में अपना नया आशियाना',
      primaryText: `21 एकड़ में अपना नया आशियाना – भरोसे और सुरक्षा के साथ निवेश! 🏡✨

रेड रोज़ सिटी (बाय अल्पाइन नेस्ट होम्स), सेक्टर 9, गुलाबगढ़ रोड, डेरा बस्सी:
🌿 100 से 150 वर्ग गज के आवासीय प्लॉट्स
🌿 रेरा स्वीकृत एवं बैंक लोन सुविधा उपलब्ध
🌿 गेटेड बाउंड्री वॉल, 2 भव्य मुख्य द्वार एवं राउंड-द-क्लॉक गार्ड्स
🌿 हाई स्ट्रीट मार्केट, ग्रीन पार्क्स और बच्चों के लिए प्ले एरिया
🌿 आज प्लॉट खरीदें, कल अपना घर बनाना शुरू करें!

सीमित इन्वेंटरी विशेष लॉन्च ऑफर पर उपलब्ध।

👉 'Learn More' पर टैप करें और व्हाट्सऐप पर तुरंत प्लॉट लेआउट व रेट्स देखें!`,
      description: '100-150 वर्ग गज प्लॉट्स | रेरा स्वीकृत',
    },
  ];

  // 1. Create Campaign (CBO with ₹1,000 Daily Budget)
  console.log('\n--- Step 1: Creating Meta Ads Campaign ---');
  const campaignName = 'Red Rose City Dera Bassi - RERA Plots (High Intent HNI)';
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

  // Target Location Coordinates (Dera Bassi, Zirakpur, Chandigarh, Mohali, Panchkula, Ambala)
  const customLocations = [
    {
      latitude: 30.5826,
      longitude: 76.8443,
      radius: 25,
      distance_unit: 'kilometer',
    }, // Dera Bassi, Gulabgarh, Zirakpur, Lalru, Banur core belt
    {
      latitude: 30.7333,
      longitude: 76.7794,
      radius: 25,
      distance_unit: 'kilometer',
    }, // Chandigarh Urban Core (Sectors 1-40, Manimajra, IT Park)
    {
      latitude: 30.6799,
      longitude: 76.7221,
      radius: 25,
      distance_unit: 'kilometer',
    }, // Mohali, Aerocity, Airport Road, IT City HNI corridor
    {
      latitude: 30.6942,
      longitude: 76.8606,
      radius: 20,
      distance_unit: 'kilometer',
    }, // Panchkula (Sectors 1-25, MDC, Pinjore)
    {
      latitude: 30.3782,
      longitude: 76.7767,
      radius: 25,
      distance_unit: 'kilometer',
    }, // Ambala Cantt & City (Prime high-intent investor catchment for Dera Bassi)
  ];

  // 2. Create Ad Set 1: Broad Audience (Lat/Long Precise Geo)
  console.log('\n--- Step 2: Creating Ad Set 1 (Broad Geo - Dera Bassi & Tricity / Ambala) ---');
  const adSet1Payload = {
    name: 'AdSet 1 - Broad Geo (Dera Bassi, Tricity & Ambala)',
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

  // 3. Create Ad Set 2: Detailed Targeting (HNIs - Demographics & Luxury Behaviors)
  console.log('\n--- Step 3: Creating Ad Set 2 (Detailed Targeting - HNI Demographics & Behaviors) ---');
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

  // 4. Create Ad Creatives and Ads under both Ad Sets
  console.log('\n--- Step 4: Creating Ad Creatives and Ads for Both Ad Sets ---');
  const createdAds = [];

  for (const item of creatives) {
    console.log(`\nCreating Creative & Ads for: ${item.name}`);

    // Create Ad Creative (Video vs Image)
    const creativePayload = {
      name: `${item.name} - Creative`,
      access_token: token,
    };

    if (item.type === 'video') {
      creativePayload.object_story_spec = {
        page_id: pageId,
        video_data: {
          video_id: item.videoId,
          message: item.primaryText,
          title: item.headline,
          image_hash: item.imageHash,
          call_to_action: {
            type: 'LEARN_MORE',
            value: {
              lead_gen_form_id: LEAD_FORM_ID,
            },
          },
        },
      };
    } else {
      creativePayload.object_story_spec = {
        page_id: pageId,
        link_data: {
          message: item.primaryText,
          name: item.headline,
          description: item.description,
          image_hash: item.imageHash,
          link: botWhatsAppUrl,
          call_to_action: {
            type: 'LEARN_MORE',
            value: {
              lead_gen_form_id: LEAD_FORM_ID,
              link: botWhatsAppUrl,
            },
          },
        },
      };
    }

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
      type: item.type,
      adInSet1: ad1Data.id,
      adInSet2: ad2Data.id,
    });
  }

  console.log('\n================================================================');
  console.log('🎉 RED ROSE CITY CAMPAIGN LAUNCH SUCCESSFUL!');
  console.log('================================================================');
  console.log({
    campaignId,
    campaignName,
    status: 'ACTIVE',
    dailyBudget: `₹${dailyBudgetInr}/day`,
    leadFormId: LEAD_FORM_ID,
    adSets: [
      { id: adSet1Id, name: adSet1Payload.name, targeting: 'Broad Geo (Dera Bassi & Tricity/Ambala)' },
      { id: adSet2Id, name: adSet2Payload.name, targeting: 'HNI Luxury Behaviors & Investors' },
    ],
    totalAdsLaunched: createdAds.length * 2,
    ads: createdAds,
  });
}

launchCampaign().catch((err) => {
  console.error('\n❌ CAMPAIGN LAUNCH FAILED:', err);
  process.exit(1);
});
