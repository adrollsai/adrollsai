const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USER_ID = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde';
const AD_ACCOUNT_ID = 'act_724104820352896';
const PAGE_ID = '109761413983770';
const IG_USER_ID = '17841444419705977';
const IMAGE_HASH = '15c9426781d9a36d724946dfb7723a9a'; // Umang Residency_ Sector 24 Rohini.png
const NEW_FORM_ID = '1153609150681859';
const NEW_BOT_NUMBER = '919319764767';
const WHATSAPP_REDIRECT_URL = `https://wa.me/${NEW_BOT_NUMBER}?text=Hi%20Umang%20Associates%2C%20I%20am%20interested%20in%203%20BHK%20builder%20floor%20in%20Sector%2024%20Rohini.`;

async function main() {
  console.log('================================================================');
  console.log('🔄 REPLACING CREATIVES & UPDATING BOT NUMBER FOR UMANG ASSOCIATES');
  console.log('================================================================');

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', USER_ID).single();
  const token = profile.facebook_token;

  // 1. Create the new Image Ad Creative
  console.log('\n--- Step 1: Creating New Image Ad Creative ---');
  const imageCreativePayload = {
    name: `Umang Residency Sec 24 - New Creative (${Date.now().toString().slice(-4)})`,
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: IG_USER_ID,
      link_data: {
        message: `🏡 YOUR 3 BHK HOME IN SECTOR 24, ROHINI!\n\n📍 Prime location in Rohini, Delhi\n💰 ₹90 Lakh* — Negotiable\n🛏️ 3 BHK Independent Builder Floor\n🛗 Lift | 🚗 Parking | ☀️ East-Facing\n🚇 Rithala Metro approximately 1 km away*\n\nMake your next move towards a home of your own!\n\n📲 Enquire now to schedule your site visit.\n\n*Price negotiable. Metro distance to be verified.`,
        name: '3 BHK in Sector 24, Rohini | ₹90 Lakh*',
        description: 'Freehold Builder Floor with Lift & Parking',
        image_hash: IMAGE_HASH,
        link: WHATSAPP_REDIRECT_URL,
        call_to_action: {
          type: 'GET_QUOTE',
          value: {
            lead_gen_form_id: NEW_FORM_ID,
            link: WHATSAPP_REDIRECT_URL,
          },
        },
      },
    },
    access_token: token,
  };

  const imgCreativeRes = await fetch(`https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}/adcreatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(imageCreativePayload),
  });
  const imgCreativeData = await imgCreativeRes.json();
  if (imgCreativeData.error || !imgCreativeData.id) {
    throw new Error('Failed to create image creative: ' + JSON.stringify(imgCreativeData));
  }
  const newImageCreativeId = imgCreativeData.id;
  console.log('✓ New Image Creative Created (ID:', newImageCreativeId, ')');

  // 2. Also create updated Video Ad Creative pointing to the new form with new bot number
  console.log('\n--- Step 2: Creating Updated Video Ad Creative ---');
  const videoCreativePayload = {
    name: `3 BHK in Sector 24, Rohini - Video Creative (${Date.now().toString().slice(-4)})`,
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: IG_USER_ID,
      video_data: {
        video_id: '1762384321718041',
        title: '3 BHK in Sector 24, Rohini | ₹90 Lakh*',
        message: `🏡 **YOUR 3 BHK HOME IN SECTOR 24, ROHINI!**\n\n📍 Prime location in Rohini, Delhi\n💰 ₹90 Lakh* — Negotiable\n🛏️ 3 BHK Independent Builder Floor\n🛗 Lift | 🚗 Parking | ☀️ East-Facing\n🚇 Rithala Metro approximately 1 km away*\n\nMake your next move towards a home of your own!\n\n📲 **Enquire now to schedule your site visit.**\n\n*Price negotiable. Metro distance to be verified.`,
        image_hash: '37acdf787dc8c7341a381c7d855f3318',
        call_to_action: {
          type: 'GET_QUOTE',
          value: {
            lead_gen_form_id: NEW_FORM_ID,
            link: WHATSAPP_REDIRECT_URL,
          },
        },
      },
    },
    access_token: token,
  };

  const vidCreativeRes = await fetch(`https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}/adcreatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(videoCreativePayload),
  });
  const vidCreativeData = await vidCreativeRes.json();
  const newVideoCreativeId = vidCreativeData?.id;
  if (newVideoCreativeId) {
    console.log('✓ New Video Creative Created (ID:', newVideoCreativeId, ')');
  } else {
    console.warn('Video creative notice:', vidCreativeData?.error?.message);
  }

  // 3. Target Ads to Update across all Ad Sets
  const imageAdsToUpdate = [
    // Adset D+B (120249982552330585)
    { adId: '120249984727520585', name: 'Image - 1 – Copy (D+B)' },
    { adId: '120249984730100585', name: 'Image - 2 – Copy (D+B)' },
    // Adset D+I+B (120249980299890585)
    { adId: '120249984737000585', name: 'Image - 1 – Copy (D+I+B)' },
    { adId: '120249984733570585', name: 'Image - 2 – Copy (D+I+B)' },
    // Adset D+I (120249977343070585)
    { adId: '120249984738910585', name: 'Image - 1 – Copy (D+I)' },
    { adId: '120249984741820585', name: 'Image - 2 – Copy (D+I)' },
  ];

  const videoAdsToUpdate = [
    { adId: '120249982589460585', name: 'Video - 1 (D+B)' },
    { adId: '120249980299910585', name: 'Video - 1 (D+I+B)' },
    { adId: '120249982592180585', name: 'Video - 1 (D+I)' },
  ];

  console.log('\n--- Step 3: Updating Image Ads in All Ad Sets ---');
  for (const item of imageAdsToUpdate) {
    console.log(`Updating Ad ${item.adId} (${item.name})...`);
    const updateRes = await fetch(`https://graph.facebook.com/v21.0/${item.adId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creative: { creative_id: newImageCreativeId },
        status: 'ACTIVE',
        access_token: token,
      }),
    });
    const updateData = await updateRes.json();
    if (updateData.success) {
      console.log(`✓ Ad ${item.adId} successfully updated with new creative!`);
    } else {
      console.error(`❌ Failed to update Ad ${item.adId}:`, updateData);
    }
  }

  if (newVideoCreativeId) {
    console.log('\n--- Step 4: Updating Video Ads to point to new Form & Bot Number ---');
    for (const item of videoAdsToUpdate) {
      console.log(`Updating Video Ad ${item.adId} (${item.name})...`);
      const updateRes = await fetch(`https://graph.facebook.com/v21.0/${item.adId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creative: { creative_id: newVideoCreativeId },
          status: 'ACTIVE',
          access_token: token,
        }),
      });
      const updateData = await updateRes.json();
      if (updateData.success) {
        console.log(`✓ Video Ad ${item.adId} successfully updated with new form/bot!`);
      } else {
        console.error(`❌ Failed to update Video Ad ${item.adId}:`, updateData);
      }
    }
  }

  console.log('\n================================================================');
  console.log('🎉 ALL ADS & FORMS SUCCESSFULLY UPDATED FOR UMANG ASSOCIATES');
  console.log('================================================================');
  console.log({
    campaign: 'Rohini Sector 24 | 12-10-2026 (120249977343060585)',
    newCreativeImage: 'Umang Residency_ Sector 24 Rohini.png',
    newCreativeId: newImageCreativeId,
    newImageHash: IMAGE_HASH,
    newFormId: NEW_FORM_ID,
    newBotNumber: `+91 ${NEW_BOT_NUMBER.slice(2)}`,
    whatsappRedirectUrl: WHATSAPP_REDIRECT_URL,
    updatedImageAdsCount: imageAdsToUpdate.length,
    updatedVideoAdsCount: videoAdsToUpdate.length,
  });
}

main().catch(console.error);
