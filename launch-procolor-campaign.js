const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FB_GRAPH_URL = 'https://graph.facebook.com/v19.0';

async function launchCampaign() {
  console.log('=== STARTING PROCOLOR CAMPAIGN LAUNCH ===');

  // 1. Fetch Profile
  const profileId = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single();

  if (pErr || !profile) {
    throw new Error('Could not find Procolor profile: ' + (pErr?.message || 'not found'));
  }

  const facebookToken = profile.facebook_token;
  const adAccountId = profile.ad_account_id; // 'act_266860069'
  const pageId = profile.selected_page_id; // '219848425178723'
  const pageToken = profile.selected_page_token || facebookToken;
  const businessName = profile.business_name || 'Procolor Film Academy';
  const contactNumber = profile.contact_number || '9569919985';
  const linkUrl = profile.custom_domain ? `https://${profile.custom_domain}` : 'https://www.procolorfilmacademy.com';
  const leadFormId = '1603036087997191'; // Sept cinematography course lead form

  console.log('Profile loaded:', {
    businessName,
    adAccountId,
    pageId,
    leadFormId,
    linkUrl
  });

  // 2. Verified Creatives
  const videoId = '1026909573772363'; // Already uploaded and ready on Meta
  const videoThumbUri = 'https://scontent.fixc1-8.fna.fbcdn.net/v/t15.5256-10/901235820_2372859940215497_9099161549405853954_n.jpg?_nc_cat=100&_nc_map=urlgen_bucketless&ccb=1-7&_nc_sid=e3495b&_nc_ohc=0lWQ4RRuO3EQ7kNvwG97W5K&_nc_oc=AdrPxvji9mywATqe3Jv81DJ3nTeEej4FxtgwvLbuuQGfFGTdoeVtziAzAbfFyBDzz1ozJPITL0Blp4FCk4_CyXiU&_nc_zt=23&_nc_ht=scontent.fixc1-8.fna&edm=AF0wKlEEAAAA&_nc_gid=MEtqQa2gOotWCCoPGUvXxw&_nc_tpa=Q5bMBQKj6fP5y2K4JSGOtshSuyJdc83-BNDqWP83mrmZO2NEYGygWw-Zd8rMP0zsnDDqNb2ffRI0zKlj&oh=00_AQQi4ByMpQq06E184xDdDlH6Mje9g1Q2pNzSZX2Q7OY90Q&oe=6B01D10C';
  const img1Hash = 'dd47e1703eaba029563544ae7e6a97de'; // dr1 (₹15,000 OFF December Batch)
  const img2Hash = 'cb6ebabf9752361055fcad4f6df6051a'; // dr3 (Short Film, Doc, Showreel, Placement)

  // 3. Create Campaign on Meta
  console.log('\n--- STEP 1: CREATING CAMPAIGN ---');
  const campaignName = `Procolor Academy - Cinematography Diploma (Dec Batch) - ${new Date().toISOString().slice(0, 10)}`;
  const dailyBudgetPaise = 500 * 100; // 500 INR in paise = 50,000

  const campaignPayload = {
    name: campaignName,
    objective: 'OUTCOME_LEADS',
    status: 'ACTIVE',
    buying_type: 'AUCTION',
    daily_budget: dailyBudgetPaise,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    special_ad_categories: [],
    access_token: facebookToken
  };

  const campRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(campaignPayload)
  });
  const campData = await campRes.json();
  if (!campRes.ok) {
    throw new Error('Meta Campaign creation failed: ' + JSON.stringify(campData));
  }
  const campaignId = campData.id;
  console.log('✓ Campaign created successfully! Meta Campaign ID:', campaignId);

  // 4. Create Ad Set on Meta
  console.log('\n--- STEP 2: CREATING AD SET ---');
  const adsetName = `Chandigarh 20km - Students 18-30 (Cinematography & Film)`;
  const targetingConfig = {
    geo_locations: {
      custom_locations: [
        {
          latitude: 30.7261,
          longitude: 76.7599,
          radius: 20,
          distance_unit: 'kilometer'
        }
      ],
      location_types: ['home']
    },
    age_min: 18,
    age_max: 30,
    targeting_automation: { advantage_audience: 0 },
    publisher_platforms: ['facebook', 'instagram'],
    device_platforms: ['mobile', 'desktop'],
    flexible_spec: [
      {
        interests: [
          { id: '6003429972457', name: 'Cinematography (films and television)' },
          { id: '6003714246353', name: 'Filmmaking (films and television)' },
          { id: '6003899195666', name: 'Photography (visual art)' },
          { id: '6003270811593', name: 'Higher education (education)' }
        ]
      }
    ]
  };

  const adsetPayload = {
    name: adsetName,
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    destination_type: 'ON_AD',
    optimization_goal: 'LEAD_GENERATION',
    promoted_object: { page_id: pageId },
    targeting: targetingConfig,
    status: 'ACTIVE',
    access_token: facebookToken
  };

  const adsetRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/adsets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adsetPayload)
  });
  const adsetData = await adsetRes.json();
  if (!adsetRes.ok) {
    console.error('AdSet creation failed:', adsetData);
    throw new Error('Meta AdSet creation failed: ' + JSON.stringify(adsetData));
  }
  const adsetId = adsetData.id;
  console.log('✓ AdSet created successfully! Meta AdSet ID:', adsetId);

  // 5. Create Creatives & Ads on Meta
  console.log('\n--- STEP 3: CREATING AD CREATIVES & ADS ---');
  const adsConfig = [
    {
      name: 'Ad 1 - Master Cinematography Video Ad',
      type: 'video',
      videoId: videoId,
      thumbUri: videoThumbUri,
      headline: 'Master Cinematography in 8 Weeks',
      primaryText: 'Learn to think, light, and shoot like a professional cinematographer. Train on Sony cinema cameras, prime lenses, gimbals, & studio lighting with industry mentors at Sector 35C, Chandigarh.\n\n🎬 8-Week Diploma (40 Practical Sessions)\n🎥 Real Shoots: Short Film & Documentary\n📜 Diploma Certificate & Placement Assistance\n\nAdmissions open for December batch. Limited seats!',
      description: '8-Week Diploma · Sector 35C, Chandigarh'
    },
    {
      name: 'Ad 2 - Special Offer ₹15k OFF (December Batch)',
      type: 'image',
      imageHash: img1Hash,
      headline: 'Get ₹15,000 OFF – December Batch',
      primaryText: '🔥 Special Launch Offer: Get ₹15,000 OFF on the 8-Week Diploma in Cinematography at Procolor Film Academy!\n\nLearn hands-on camera operation, lighting design, shot composition, and visual storytelling on professional Sony cinema gear in Sector 35C, Chandigarh.\n\n⚡ Small Batches with Personal Mentorship\n📞 Call 95699 19985 or tap Learn More to apply!',
      description: '₹15,000 OFF · Limited Seats Available'
    },
    {
      name: 'Ad 3 - Career Outcomes & Portfolio Ad',
      type: 'image',
      imageHash: img2Hash,
      headline: 'Graduate With a Complete Showreel',
      primaryText: 'Don\'t just get a certificate—graduate with a professional portfolio and career-ready skills.\n\nWhat you will graduate with:\n✔ Short Film & Documentary\n✔ Showreel-Ready Portfolio\n✔ Diploma Certificate from Procolor\n✔ Placement & Freelance Assistance\n\n📍 Sector 35C, Chandigarh. Apply now for the December batch!',
      description: 'Placement Assistance · 40 Sessions'
    }
  ];

  const createdAds = [];

  for (let i = 0; i < adsConfig.length; i++) {
    const config = adsConfig[i];
    console.log(`\nCreating ${config.name}...`);

    const ctaValue = {
      lead_gen_form_id: leadFormId,
      link: linkUrl
    };

    const creativePayload = {
      name: `${config.name} Creative`,
      object_story_spec: { page_id: pageId },
      access_token: facebookToken
    };

    if (config.type === 'video') {
      creativePayload.object_story_spec.video_data = {
        video_id: config.videoId,
        message: config.primaryText,
        title: config.headline,
        image_url: config.thumbUri,
        call_to_action: {
          type: 'LEARN_MORE',
          value: ctaValue
        }
      };
    } else {
      creativePayload.object_story_spec.link_data = {
        message: config.primaryText,
        name: config.headline,
        description: config.description,
        link: linkUrl,
        image_hash: config.imageHash,
        call_to_action: {
          type: 'LEARN_MORE',
          value: ctaValue
        }
      };
    }

    const crRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/adcreatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creativePayload)
    });
    const crData = await crRes.json();
    if (!crRes.ok) {
      console.error(`Creative failed for ${config.name}:`, crData);
      throw new Error(`Creative creation failed for ${config.name}: ` + JSON.stringify(crData));
    }
    const creativeId = crData.id;
    console.log(`✓ Creative created! Meta Creative ID: ${creativeId}`);

    // Create Ad
    const adPayload = {
      name: config.name,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: 'ACTIVE',
      access_token: facebookToken
    };

    const adRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adPayload)
    });
    let adData = await adRes.json();

    if (!adRes.ok) {
      console.warn(`Ad creation with ACTIVE returned error, trying PAUSED fallback:`, adData);
      const pausedAdPayload = { ...adPayload, status: 'PAUSED' };
      const retryRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pausedAdPayload)
      });
      adData = await retryRes.json();
      if (!retryRes.ok) {
        throw new Error(`Ad creation failed for ${config.name}: ` + JSON.stringify(adData));
      }
    }

    console.log(`✓ Ad created successfully! Meta Ad ID: ${adData.id}`);
    createdAds.push({
      name: config.name,
      adId: adData.id,
      creativeId: creativeId,
      type: config.type,
      headline: config.headline
    });
  }

  // 6. Record Job in Supabase
  console.log('\n--- STEP 4: RECORDING IN SUPABASE ---');
  const productId = 'cd40f892-81bc-4712-a40d-ac3163588628';
  
  // Update property
  await supabaseAdmin.from('properties').update({
    meta_campaign_id: campaignId,
    meta_campaign_status: 'ACTIVE'
  }).eq('id', productId);
  console.log('✓ Updated property with meta_campaign_id:', campaignId);

  // Insert completed campaign_job
  const { data: jobData, error: jobErr } = await supabaseAdmin.from('campaign_jobs').insert({
    user_id: profileId,
    target_user_id: profileId,
    status: 'completed',
    campaign_id: campaignId,
    message: `Campaign Launched Successfully with ${createdAds.length} Ads (1 Video Ad + 2 Direct-Response Image Ads)!`,
    payload: {
      campaignId,
      campaignName,
      adsetId,
      adsetName,
      adAccountId,
      dailyBudget: 500,
      currency: 'INR',
      targetLocation: '20km radius from Sector 35-C, Chandigarh',
      ageRange: '18-30',
      interests: ['Cinematography', 'Filmmaking', 'Photography', 'Higher education'],
      createdAds,
      productId,
      leadFormId
    }
  }).select('id').single();

  console.log('✓ Campaign job recorded in DB with Job ID:', jobData?.id || 'done');

  // 7. Verify Campaign Details from Meta
  console.log('\n--- STEP 5: VERIFYING CAMPAIGN ON META ---');
  const verifyRes = await fetch(`${FB_GRAPH_URL}/${campaignId}?fields=id,name,status,effective_status,objective,daily_budget,created_time&access_token=${facebookToken}`);
  const metaCampaign = await verifyRes.json();
  console.log('Meta Campaign Verified:', metaCampaign);

  const adsetVerifyRes = await fetch(`${FB_GRAPH_URL}/${adsetId}?fields=id,name,status,effective_status,targeting&access_token=${facebookToken}`);
  const metaAdset = await adsetVerifyRes.json();
  console.log('Meta AdSet Verified:', {
    id: metaAdset.id,
    name: metaAdset.name,
    status: metaAdset.status,
    effective_status: metaAdset.effective_status,
    geo_locations: metaAdset.targeting?.geo_locations,
    age_min: metaAdset.targeting?.age_min,
    age_max: metaAdset.targeting?.age_max
  });

  console.log('\n=== CAMPAIGN LAUNCH FINISHED SUCCESSFULLY ===');
  return {
    success: true,
    campaignId,
    campaignName,
    adsetId,
    adsetName,
    dailyBudget: 500,
    createdAds,
    metaCampaign
  };
}

launchCampaign().catch(err => {
  console.error('\n❌ CRITICAL LAUNCH ERROR:', err);
  process.exit(1);
});

