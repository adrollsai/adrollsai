const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
process.env.AWS_ACCESS_KEY_ID = envConfig.REMOTION_AWS_ACCESS_KEY_ID || envConfig.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = envConfig.REMOTION_AWS_SECRET_ACCESS_KEY || envConfig.AWS_SECRET_ACCESS_KEY;
process.env.REMOTION_AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
process.env.REMOTION_AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const { createCollageImages } = require('./utils/collage-generator');

const refImages = [
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853507-yshfya.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853475-me71bg.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853444-37gqe.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1779799853541-oaefhg.jpg"
];

async function run() {
    console.log("Creating 9:16 grid collage for Ananta Aspire...");
    const collages = await createCollageImages(refImages, "2f62a259-f23b-48ee-a920-c436f36eaa4b");
    console.log("GENERATED COLLAGE URLS:", collages);
}

run();
