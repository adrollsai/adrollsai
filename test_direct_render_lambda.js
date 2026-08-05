const { renderMediaOnLambda } = require('@remotion/lambda');
const { speculateFunctionName } = require('@remotion/lambda-client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

async function testDirectRender() {
  const assetId = "e1f82e62-0117-4699-95b7-f41bfc1ec93d";
  const videoUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/explicit_mapped_voiceover_1785759164984.mp4";

  console.log(`[Test Direct Render] Dispatching render request directly to AWS Lambda...`);

  const functionName = speculateFunctionName({
    diskSizeInMb: 512,
    memorySizeInMb: 2048,
    timeoutInSeconds: 900,
  });

  const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
  const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
  const region = (process.env.REMOTION_AWS_REGION || 'us-east-1');

  try {
    const result = await renderMediaOnLambda({
      region,
      functionName,
      serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`,
      composition: 'CaptionsComposition',
      inputProps: {
        videoUrl,
        captions: [
          { start: 0, end: 1.5, text: "GNR HOMES MOHALI 🏡", emphasis: true },
          { start: 1.5, end: 3.5, text: "LUXURY 3BHK FLATS", emphasis: false }
        ],
        effects: [],
        theme: "classic",
        profile: {}
      },
      codec: 'h264',
      imageFormat: 'jpeg',
      maxRetries: 5,
      privacy: 'public',
      framesPerLambda: 300,
    });

    console.log("=== AWS LAMBDA RENDER DISPATCH SUCCESSFUL ===");
    console.log("Render ID:", result.renderId);
    console.log("Bucket:", result.bucketName);
  } catch (err) {
    console.error("=== AWS LAMBDA RENDER DISPATCH ERROR ===", err);
  }
}

testDirectRender();
