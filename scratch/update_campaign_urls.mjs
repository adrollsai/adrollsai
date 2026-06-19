/**
 * One-off script to update landing page URLs for all ads in:
 * Campaign: "Realty Nation - AI Smart Campaign - 2026-06-16 - 9274"
 * New URL: https://app.realtynationmohali.com/highland-mayfield-0310
 */

const SUPABASE_URL = 'https://dvygrupphzjitzbrtlve.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eWdydXBwaHpqaXR6YnJ0bHZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTM4OTkxNiwiZXhwIjoyMDgwOTY1OTE2fQ.WfJTY1EDtVAIePBlf97wVAiZlxNKUWydcXP-LcEiCDA';
const FB_GRAPH_URL = 'https://graph.facebook.com/v19.0';

const CAMPAIGN_NAME = 'Realty Nation - AI Smart Campaign - 2026-06-16 - 9274';
const NEW_URL = 'https://app.realtynationmohali.com/highland-mayfield-0310';

async function supabaseQuery(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  return res.json();
}

async function main() {
  console.log('=== Update Campaign Landing Page URLs ===\n');

  // Step 1: Find Realty Nation profile(s) - search by business_name
  console.log('Step 1: Finding Realty Nation account...');
  const profiles = await supabaseQuery('profiles', 'select=id,business_name,facebook_token,ad_account_id&business_name=ilike.*realty*nation*');
  
  if (!profiles || profiles.length === 0) {
    console.log('No profiles found with "Realty Nation" in business name. Searching all profiles with facebook_token...');
    // Fallback: search all profiles that have a facebook_token
    const allProfiles = await supabaseQuery('profiles', 'select=id,business_name,facebook_token,ad_account_id&facebook_token=not.is.null&ad_account_id=not.is.null');
    console.log(`Found ${allProfiles.length} profiles with Facebook tokens:`);
    for (const p of allProfiles) {
      console.log(`  - ${p.business_name || '(no name)'} | ID: ${p.id} | Ad Account: ${p.ad_account_id}`);
    }
    
    // Try to find the campaign in each account
    for (const p of allProfiles) {
      console.log(`\nSearching for campaign in account: ${p.business_name || p.id}...`);
      const found = await findAndUpdateCampaign(p.facebook_token, p.ad_account_id);
      if (found) {
        console.log('\n✅ Done!');
        return;
      }
    }
    console.log('\n❌ Campaign not found in any account.');
    return;
  }

  console.log(`Found ${profiles.length} Realty Nation profile(s):`);
  for (const p of profiles) {
    console.log(`  - ${p.business_name} | ID: ${p.id} | Ad Account: ${p.ad_account_id}`);
  }

  for (const profile of profiles) {
    if (!profile.facebook_token || !profile.ad_account_id) {
      console.log(`  Skipping ${profile.business_name} - missing token or ad account`);
      continue;
    }
    const found = await findAndUpdateCampaign(profile.facebook_token, profile.ad_account_id);
    if (found) {
      console.log('\n✅ Done!');
      return;
    }
  }

  console.log('\n❌ Campaign not found in Realty Nation account(s).');
}

async function findAndUpdateCampaign(token, adAccountId) {
  // Step 2: Search for the campaign
  console.log(`  Fetching campaigns from ad account ${adAccountId}...`);
  
  const campaignsUrl = `${FB_GRAPH_URL}/${adAccountId}/campaigns?fields=id,name,status&limit=100&access_token=${token}`;
  const campaignsRes = await fetch(campaignsUrl);
  const campaignsData = await campaignsRes.json();

  if (campaignsData.error) {
    console.log(`  Error fetching campaigns: ${campaignsData.error.message}`);
    return false;
  }

  const campaigns = campaignsData.data || [];
  console.log(`  Found ${campaigns.length} campaigns.`);

  const targetCampaign = campaigns.find(c => c.name === CAMPAIGN_NAME);
  if (!targetCampaign) {
    // Print campaign names for debugging
    console.log('  Available campaigns:');
    for (const c of campaigns) {
      console.log(`    - [${c.status}] ${c.name} (${c.id})`);
    }
    return false;
  }

  console.log(`\n  ✅ Found campaign: "${targetCampaign.name}" (ID: ${targetCampaign.id}, Status: ${targetCampaign.status})`);

  // Step 3: Get all ads in the campaign with their creative details
  console.log('\n  Step 3: Fetching ads in campaign...');
  const adsUrl = `${FB_GRAPH_URL}/${targetCampaign.id}?fields=ads{id,name,status,creative{id,name,object_story_spec,image_url,thumbnail_url}}&access_token=${token}`;
  const adsRes = await fetch(adsUrl);
  const adsData = await adsRes.json();

  if (adsData.error) {
    console.log(`  Error fetching ads: ${adsData.error.message}`);
    return false;
  }

  const ads = adsData.ads?.data || [];
  console.log(`  Found ${ads.length} ads.`);

  if (ads.length === 0) {
    console.log('  No ads found in this campaign.');
    return true;
  }

  // Step 4: For each ad, update the creative with the new link URL
  console.log(`\n  Step 4: Updating each ad's creative with new URL: ${NEW_URL}\n`);

  let successCount = 0;
  let failCount = 0;

  for (const ad of ads) {
    const creative = ad.creative;
    if (!creative) {
      console.log(`  ⚠️  Ad "${ad.name}" (${ad.id}) has no creative, skipping.`);
      continue;
    }

    console.log(`  Processing ad: "${ad.name}" (${ad.id})`);
    console.log(`    Creative ID: ${creative.id}`);

    const storySpec = creative.object_story_spec;
    if (!storySpec) {
      console.log(`    ⚠️  No object_story_spec found, skipping.`);
      continue;
    }

    const linkData = storySpec.link_data;
    if (linkData) {
      console.log(`    Current link: ${linkData.link || '(none)'}`);
    }

    // Build updated object_story_spec
    const updatedStorySpec = { ...storySpec };
    if (updatedStorySpec.link_data) {
      updatedStorySpec.link_data = { ...updatedStorySpec.link_data, link: NEW_URL };
      // Update call_to_action link if present
      if (updatedStorySpec.link_data.call_to_action?.value?.link) {
        updatedStorySpec.link_data.call_to_action = {
          ...updatedStorySpec.link_data.call_to_action,
          value: { ...updatedStorySpec.link_data.call_to_action.value, link: NEW_URL }
        };
      }
    } else if (updatedStorySpec.video_data) {
      updatedStorySpec.video_data = { ...updatedStorySpec.video_data };
      if (updatedStorySpec.video_data.call_to_action?.value?.link) {
        updatedStorySpec.video_data.call_to_action = {
          ...updatedStorySpec.video_data.call_to_action,
          value: { ...updatedStorySpec.video_data.call_to_action.value, link: NEW_URL }
        };
      }
    }

    // Create a new creative with updated link
    const newCreativePayload = {
      name: `Updated Creative - ${ad.name} - ${Date.now()}`,
      object_story_spec: JSON.stringify(updatedStorySpec),
      access_token: token,
    };

    const createCreativeUrl = `${FB_GRAPH_URL}/${adAccountId}/adcreatives`;
    const createRes = await fetch(createCreativeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCreativePayload),
    });
    const createData = await createRes.json();

    if (createData.error) {
      console.log(`    ❌ Failed to create new creative: ${createData.error.message}`);
      failCount++;
      continue;
    }

    const newCreativeId = createData.id;
    console.log(`    New creative ID: ${newCreativeId}`);

    // Update the ad to use the new creative
    const updateAdUrl = `${FB_GRAPH_URL}/${ad.id}`;
    const updateRes = await fetch(updateAdUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creative: { creative_id: newCreativeId },
        access_token: token,
      }),
    });
    const updateData = await updateRes.json();

    if (updateData.error) {
      console.log(`    ❌ Failed to update ad: ${updateData.error.message}`);
      failCount++;
    } else {
      console.log(`    ✅ Ad updated successfully!`);
      successCount++;
    }
  }

  console.log(`\n  Summary: ${successCount} ads updated, ${failCount} failed out of ${ads.length} total.`);
  return true;
}

main().catch(console.error);
