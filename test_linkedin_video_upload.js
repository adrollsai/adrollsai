const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testLinkedInVideo() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // Nobogent account
  const { data: profile } = await supabaseAdmin.from('profiles').select('linkedin_token, linkedin_id, linkedin_urn').eq('id', userId).single();

  console.log("LinkedIn Profile:", {
    hasToken: !!profile?.linkedin_token,
    linkedin_id: profile?.linkedin_id,
    linkedin_urn: profile?.linkedin_urn
  });

  if (!profile?.linkedin_token) {
    console.error("No LinkedIn token!");
    return;
  }

  let urn = profile.linkedin_urn || `urn:li:person:${profile.linkedin_id}`;
  if (!urn.startsWith('urn:li:')) urn = `urn:li:person:${urn}`;

  console.log("Using URN:", urn);

  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov';
  const fileRes = await fetch(videoUrl);
  const fileBlob = await fileRes.arrayBuffer();
  const fileSizeBytes = fileBlob.byteLength;
  console.log("Video Size:", fileSizeBytes, "bytes");

  // Test 1: rest/videos?action=initializeUpload with fileSizeBytes
  console.log("\n--- TEST 1: rest/videos?action=initializeUpload with fileSizeBytes ---");
  const initRes1 = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${profile.linkedin_token}`,
      'Linkedin-Version': '202604',
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: urn,
        fileSizeBytes: fileSizeBytes
      }
    })
  });
  console.log("Test 1 Status:", initRes1.status);
  const text1 = await initRes1.text();
  console.log("Test 1 Response:\n", text1);

  // Test 2: v2/assets?action=registerUpload (Legacy v2 API)
  console.log("\n--- TEST 2: v2/assets?action=registerUpload ---");
  const initRes2 = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${profile.linkedin_token}`,
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
  console.log("Test 2 Status:", initRes2.status);
  const text2 = await initRes2.text();
  console.log("Test 2 Response:\n", text2);
}

testLinkedInVideo();
