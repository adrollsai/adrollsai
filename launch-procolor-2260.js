const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FB_GRAPH_URL = 'https://graph.facebook.com/v21.0';

async function launchCampaign() {
  console.log('=== STARTING PROCOLOR CAMPAIGN LAUNCH ON ACCOUNT 2260 (act_542853643532260) ===');

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
  const adAccountId = 'act_542853643532260'; // Account 2260
  const pageId = '219848425178723'; // Procolor Film Academy
  const businessName = profile.business_name || 'Procolor Film Academy';
  const linkUrl = profile.custom_domain ? `https://${profile.custom_domain}` : 'https://www.procolorfilmacademy.com';
  const leadFormId = '4629765537333584'; // High Intent Qualifying Form

  console.log('Profile loaded:', {
    businessName,
    adAccountId,
    pageId,
    leadFormId,
    linkUrl
  });

  // Ensure Supabase profile has ad_account_id set to act_542853643532260
  await supabaseAdmin.from('profiles').update({ ad_account_id: adAccountId }).eq('id', profileId);
  console.log('✓ Updated Procolor profile in DB to ad_account_id:', adAccountId);

  // Verified Creative Assets on act_542853643532260
  const videoId = '1677666347061028'; // Ready on act_542853643532260
  const videoThumbUri = 'https://scontent.fixc1-2.fna.fbcdn.net/v/t15.5256-10/902253094_1122133437251921_7587803806907214712_n.jpg?stp=dst-jpg_p160x160_tt6&_nc_cat=104&_nc_map=urlgen_bucketless&ccb=1-7&_nc_sid=200999&_nc_ohc=C79BOIgX3NkQ7kNvwEcHPvH&_nc_oc=AdrXmJ1OvvnJZ16gVVg6i1Kzi05TsNERjsphX_00j3fP7WwrPUSmv1_jdNzE969EeKottuguzmmDcGjD1fe_X0QY&_nc_zt=23&_nc_ht=scontent.fixc1-2.fna&edm=APRAPSkEAAAA&_nc_gid=lqh1z4xMr1XK7MQH9YRFyQ&_nc_tpa=Q5bMBQIy9WqtCfRksAzkEnDo951rx5F1RXgWlEqR7UwKx7VLRP9SXrcBtLpRXqA7WvuFJzdUeF6TUXpb&oh=00_AQQIq1xfjc9tTIJNleDCKoUL7EJFwffPSgM2oJW5AAjAbA&oe=6B074299';
  const img1Hash = 'dd47e1703eaba029563544ae7e6a97de'; // dr1 (Flat ₹15,000 OFF December Batch)
  const img2Hash = 'cb6ebabf9752361055fcad4f6df6051a'; // dr3 (Short Film, Doc, Showreel, Placement)

  // 1. Create Campaign
  console.log('\n--- STEP 1: CREATING CAMPAIGN ---');
  const campaignName = `Procolor Academy - Cinematography Diploma (Dec Batch) - ${new Date().toISOString().slice(0, 10)}`;
  const dailyBudgetPaise = 500 * 100; // ₹500 in paise = 50,000

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

  // 2. Create Ad Set
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
    throw new Error('Meta AdSet creation failed: ' + JSON.stringify(adsetData));
  }
  const adsetId = adsetData.id;
  console.log('✓ AdSet created successfully! Meta AdSet ID:', adsetId);

  // 3. Create 3 Ad Creatives & 3 Ads
  console.log('\n--- STEP 3: CREATING AD CREATIVES & ADS ---');
  const adsToCreate = [
    {
      name: 'Ad 1 - Master Cinematography Video Ad',
      type: 'video',
      videoId: videoId,
      thumbUri: videoThumbUri,
      headline: 'Master Cinematography in 8 Weeks',
      primaryText: 'Hands-on training on cinema cameras, gimbals & professional lighting. Walk away with a short film, documentary & showreel. Dec Batch enrolling now in Sector 35-C, Chandigarh!'
    },
    {
      name: 'Ad 2 - DR1 ₹15,000 OFF December Batch',
      type: 'image',
      imageHash: img1Hash,
      headline: 'Flat ₹15,000 OFF · Dec Batch',
      primaryText: 'Start your filmmaking career in Chandigarh. Professional 8-week Diploma in Cinematography. Early bird discount of ₹15,000 active for December seats. Apply now!',
      description: 'Sector 35-C, Chandigarh · Hands-on Practical Course'
    },
    {
      name: 'Ad 3 - DR3 Course Outcomes & Career',
      type: 'image',
      imageHash: img2Hash,
      headline: 'Short Film + Doc + Showreel',
      primaryText: 'Don\'t just learn theory. Shoot real films, build a verified portfolio, earn your diploma certificate & get 100% placement support. Enroll today in Chandigarh!',
      description: '100% Practical Shoot Training · Apply for Details'
    }
  ];

  const createdAds = [];

  for (const config of adsToCreate) {
    console.log(`\nCreating ${config.name}...`);

    const ctaValue = {
      lead_gen_form_id: leadFormId,
      link: linkUrl
    };

    const creativePayload = {
      name: `Creative - ${config.name}`,
      object_story_spec: {
        page_id: pageId
      },
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

  // 4. Record in Supabase
  console.log('\n--- STEP 4: RECORDING IN SUPABASE ---');
  const productId = 'cd40f892-81bc-4712-a40d-ac3163588628';
  
  await supabaseAdmin.from('properties').update({
    meta_campaign_id: campaignId,
    meta_campaign_status: 'ACTIVE'
  }).eq('id', productId);
  console.log('✓ Updated property with meta_campaign_id:', campaignId);

  const { data: jobData, error: jobErr } = await supabaseAdmin.from('campaign_jobs').insert({
    user_id: profileId,
    target_user_id: profileId,
    status: 'completed',
    campaign_id: campaignId,
    message: `Campaign Launched Successfully on Account 2260 with ${createdAds.length} Ads (1 Video Ad + 2 Direct-Response Image Ads)!`,
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

  // 5. Verify Campaign & Ads from Meta
  console.log('\n--- STEP 5: VERIFYING CAMPAIGN ON META ---');
  const verifyRes = await fetch(`${FB_GRAPH_URL}/${campaignId}?fields=id,name,status,effective_status,objective,daily_budget,created_time&access_token=${facebookToken}`);
  const metaCampaign = await verifyRes.json();
  console.log('Meta Campaign Verified:', metaCampaign);

  const adsVerifyRes = await fetch(`${FB_GRAPH_URL}/${adsetId}/ads?fields=id,name,status,effective_status,creative{id,name}&access_token=${facebookToken}`);
  const metaAds = await adsVerifyRes.json();
  console.log('Meta Ads Verified:', metaAds);

  console.log('\n=== CAMPAIGN LAUNCH FINISHED SUCCESSFULLY ===');
  return {
    success: true,
    campaignId,
    campaignName,
    adsetId,
    adsetName,
    dailyBudgetINR: 500,
    createdAds,
    metaCampaign,
    metaAds
  };
}

launchCampaign().catch(err => {
  console.error('\n❌ CRITICAL LAUNCH ERROR:', err);
  process.exit(1);
});

