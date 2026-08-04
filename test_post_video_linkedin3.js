const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testLinkedInVideoRestPosts() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const { data: profile } = await supabaseAdmin.from('profiles').select('linkedin_token, linkedin_id, linkedin_urn').eq('id', userId).single();

  const accessToken = profile.linkedin_token;
  let urn = profile.linkedin_urn || `urn:li:person:${profile.linkedin_id}`;
  if (!urn.startsWith('urn:li:')) urn = `urn:li:person:${urn}`;

  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov';
  
  console.log("Downloading video buffer...");
  const fileRes = await fetch(videoUrl);
  const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
  const fileSizeBytes = fileBuffer.length;

  console.log("Video Size:", fileSizeBytes, "bytes");

  // 1. Initialize Upload on REST Videos API
  console.log("Initializing LinkedIn Video upload via rest/videos...");
  const initRes = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
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

  const initData = await initRes.json();
  console.log("Init Data:", JSON.stringify(initData, null, 2));

  const videoUrn = initData.value.video; // "urn:li:video:D56..."
  const uploadInstructions = initData.value.uploadInstructions;

  console.log("Video URN obtained:", videoUrn);

  // 2. Upload video binary chunk(s)
  for (let i = 0; i < uploadInstructions.length; i++) {
    const instr = uploadInstructions[i];
    const chunk = fileBuffer.subarray(instr.firstByte, instr.lastByte + 1);
    console.log(`Uploading chunk ${i+1}/${uploadInstructions.length} (${chunk.length} bytes)...`);

    const chunkRes = await fetch(instr.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: chunk
    });
    console.log(`Chunk ${i+1} upload status:`, chunkRes.status);
  }

  // 3. Finalize / Poll Video Status on rest/videos/{videoUrn}
  console.log("Polling video status on LinkedIn rest/videos API...");
  let videoStatus = 'PROCESSING';
  let attempts = 0;

  while (videoStatus !== 'AVAILABLE' && attempts < 20) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch(`https://api.linkedin.com/rest/videos/${encodeURIComponent(videoUrn)}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Linkedin-Version': '202604',
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });
    const statusData = await statusRes.json();
    videoStatus = statusData.status;
    console.log(`Poll #${attempts + 1} video status:`, videoStatus);

    if (videoStatus === 'AVAILABLE') break;
    attempts++;
  }

  // 4. Create LinkedIn Video Post with videoUrn
  console.log("Publishing LinkedIn Video Post with URN:", videoUrn);
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
        id: videoUrn,
        title: "Nobogent AI Demo Video"
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

testLinkedInVideoRestPosts();
