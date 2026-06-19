const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

console.log("R2_ACCESS_KEY_ID:", process.env.R2_ACCESS_KEY_ID);
console.log("R2_SECRET_ACCESS_KEY:", process.env.R2_SECRET_ACCESS_KEY ? "EXISTS (length: " + process.env.R2_SECRET_ACCESS_KEY.length + ")" : "MISSING");
console.log("R2_BUCKET_NAME:", process.env.R2_BUCKET_NAME);
console.log("R2_ENDPOINT:", process.env.R2_ENDPOINT);
