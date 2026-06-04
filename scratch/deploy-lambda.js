require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { deployFunction, deploySite, getOrCreateBucket } = require('@remotion/lambda');
const path = require('path');

const region = process.env.REMOTION_AWS_REGION || 'us-east-1';
const functionName = process.env.REMOTION_AWS_FUNCTION_NAME || 'remotion-render-3-16-0';

async function run() {
    console.log("=========================================");
    console.log("REMOTION AWS LAMBDA DEPLOYMENT");
    console.log(`Region:        ${region}`);
    console.log(`Function Name: ${functionName}`);
    console.log("=========================================\n");

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        console.error("Error: AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) are missing in environment!");
        process.exit(1);
    }

    try {
        // 1. Get or create S3 Bucket for Remotion chunks
        console.log("[1/3] Querying or creating Remotion S3 bucket...");
        const { bucketName, alreadyExisted } = await getOrCreateBucket({ region });
        console.log(`  S3 Bucket Name: ${bucketName} (Already existed: ${alreadyExisted})`);

        // 2. Deploy Lambda function containing headless Chromium and FFmpeg
        console.log("\n[2/3] Deploying serverless rendering function to AWS Lambda...");
        const deployFuncResult = await deployFunction({
            region,
            functionName,
            createCloudWatchLogGroup: true,
            memorySizeInMb: 2048, // 2GB is optimal for performance & CPU allocation
            timeoutInSeconds: 240, // 4 minutes max timeout
            diskSizeInMb: 512
        });
        console.log(`  Lambda function deployed successfully!`, deployFuncResult);

        // 3. Compile the React compositions and deploy static bundle to S3
        console.log("\n[3/3] Compiling React compositions and deploying site bundle to S3...");
        const entryPoint = path.resolve(__dirname, '../remotion/index.ts');
        
        console.log(`  Webpack entryPoint: ${entryPoint}`);
        const { siteName } = await deploySite({
            entryPoint,
            bucketName,
            region
        });
        console.log(`  Remotion site bundle deployed successfully! Site Name: ${siteName}`);

        console.log("\n=========================================");
        console.log("🏆 DEPLOYMENT COMPLETED SUCCESSFULLY!");
        console.log(`S3 Bucket:     ${bucketName}`);
        console.log(`Site ID:       ${siteName}`);
        console.log(`Lambda Func:   ${functionName}`);
        console.log("=========================================");

    } catch (err) {
        console.error("\n❌ Deployment failed:", err);
        process.exit(1);
    }
}

run();
