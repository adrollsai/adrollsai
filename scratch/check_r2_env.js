require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

console.log("R2 Endpoint:", process.env.R2_ENDPOINT);
console.log("R2 Bucket:", process.env.R2_BUCKET_NAME);
console.log("R2 Access Key:", process.env.R2_ACCESS_KEY_ID ? "PRESENT" : "MISSING");
console.log("R2 Secret Key:", process.env.R2_SECRET_ACCESS_KEY ? "PRESENT" : "MISSING");

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function testUpload() {
    try {
        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: "generated/test_upload_connection.txt",
            Body: "Hello from test connection script",
            ContentType: "text/plain"
        });
        await r2.send(command);
        console.log("Upload Success!");
    } catch (err) {
        console.error("Upload Failed:", err);
    }
}

testUpload();
