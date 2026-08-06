const { getRenderProgress } = require('@remotion/lambda');
const { speculateFunctionName } = require('@remotion/lambda-client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

async function checkProgress() {
  const renderId = "q0por31f1z";
  const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
  const region = (process.env.REMOTION_AWS_REGION || 'us-east-1');
  const functionName = speculateFunctionName({
    diskSizeInMb: 512,
    memorySizeInMb: 2048,
    timeoutInSeconds: 900,
  });

  const progress = await getRenderProgress({
    renderId,
    bucketName,
    functionName,
    region,
  });

  console.log("=== REMOTION LAMBDA RENDER PROGRESS ===");
  console.log("Done:", progress.done);
  console.log("Overall Progress:", Math.round(progress.overallProgress * 100) + "%");
  console.log("Fatal Error Encountered:", progress.fatalErrorEncountered);
  if (progress.fatalErrorEncountered) {
    console.log("Errors:", JSON.stringify(progress.errors, null, 2));
  }
  if (progress.outputFile) {
    console.log("Output File URL:", progress.outputFile);
  }
}

checkProgress();
