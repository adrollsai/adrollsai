const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

console.log("NEXT_PUBLIC_APP_URL:", process.env.NEXT_PUBLIC_APP_URL);
console.log("NEXT_PUBLIC_SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log("STITCHER_WORKER_URL:", process.env.STITCHER_WORKER_URL);
console.log("REMOTION_RENDERER_URL:", process.env.REMOTION_RENDERER_URL);
