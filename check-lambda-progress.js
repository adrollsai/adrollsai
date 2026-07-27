const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { getRenderProgress } = require('@remotion/lambda');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
process.env.AWS_ACCESS_KEY_ID = envConfig.REMOTION_AWS_ACCESS_KEY_ID || envConfig.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = envConfig.REMOTION_AWS_SECRET_ACCESS_KEY || envConfig.AWS_SECRET_ACCESS_KEY;

const renderId = "w62ro2grku";
const bucketName = envConfig.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
const functionName = "remotion-render-4-0-327-disk512mb-mem2048mb-60sec";
const region = envConfig.REMOTION_AWS_REGION || 'us-east-1';

async function check() {
    try {
        const prog = await getRenderProgress({ renderId, bucketName, functionName, region });
        console.log("LAMBDA RENDER PROGRESS:", JSON.stringify(prog, null, 2));
    } catch (e) {
        console.error("Error checking progress:", e);
    }
}

check();
