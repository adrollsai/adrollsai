const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testLinkedInVideoPublishWithPolling() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const { data: profile } = await supabaseAdmin.from('profiles').select('linkedin_token, linkedin_id, linkedin_urn').eq('id', userId).single();

  const accessToken = profile.linkedin_token;
  let urn = profile.linkedin_urn || `urn:li:person:${profile.linkedin_id}`;
  if (!urn.startsWith('urn:li:')) urn = `urn:li:person:${urn}`;

  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov';
  
  console.log("Downloading video buffer...");
  const fileRes = await fetch(videoUrl);
  const fileBlob = await fileRes.arrayBuffer();

  // 1. Register Upload
  console.log("Registering LinkedIn video upload...");
  const regRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-video"],
        owner: urn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent"
          }
        ]
      }
    })
  });

  const regData = await regRes.json();
  const uploadUrl = regData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  const assetUrn = regData.value.asset;

  console.log("Asset URN:", assetUrn);

  // 2. Upload Video Binary
  console.log("Uploading video binary to LinkedIn...");
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream'
    },
    body: fileBlob
  });

  console.log("Binary Upload Status:", uploadRes.status);

  // 3. Poll Asset Processing Status until AVAILABLE
  console.log("Polling LinkedIn asset status...");
  let isAvailable = false;
  let attempts = 0;
  while (!isAvailable && attempts < 15) {
    await new Promise(r => setTimeout(r, 4000));
    const assetCheckRes = await fetch(`https://api.linkedin.com/v2/assets/${encodeURIComponent(assetUrn)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const assetData = await assetCheckRes.json();
    const status = assetData?.recipes?.[0]?.status || assetData?.status;
    console.log(`Poll #${attempts + 1} status:`, status);

    if (status === 'ALLOWED' || status === 'AVAILABLE' || assetCheckRes.status === 200) {
      isAvailable = true;
      break;
    }
    attempts++;
  }

  // 4. Publish Post via /rest/posts
  console.log("Publishing LinkedIn Video Post...");
  const postPayload = {
    author: urn,
    commentary: "Automate your real estate sales & marketing with Nobogent AI! 🚀 Watch how Nobogent handles calls, CRM, & ads from one dashboard.",
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED'
    },
    lifecycleState: 'PUBLISHED',
    content: {
      media: {
        id: assetUrn
      }
    }
  };

  const publishRes = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Linkedin-Version': '202604',
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postPayload)
  });

  console.log("Publish Status:", publishRes.status);
  if (!publishRes.ok) {
    const errText = await publishRes.text();
    console.error("Publish Error Details:\n", errText);
  } else {
    const postId = publishRes.headers.get('x-restli-id');
    console.log("🎉 SUCCESS! Published LinkedIn Video Post ID:", postId);
  }
}

testLinkedInVideoPublishWithPolling();
