const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const sharp = require('sharp');

const propertyImages = [
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624036-1w7tqd.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-g0ofd.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-1u4ncjp.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-5hsho.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-n2dyb.jpg"
];

const videos = [
  { url: "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-c890a11f-84ce-4592-ab8f-8682927b1a9d-1780468110459.mp4", label: "Profile character video" },
  { url: "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/c890a11f-84ce-4592-ab8f-8682927b1a9d/1781854790292-videoad.mp4", label: "Uploaded library video (30s)" },
  { url: "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/c890a11f-84ce-4592-ab8f-8682927b1a9d/trimmed_videoad_ref.mp4", label: "Trimmed videoad ref (R2)" },
  { url: "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/c890a11f-84ce-4592-ab8f-8682927b1a9d/trimmed_ref_v2_66eb6cbfe3e13fc81bab413b27538140.mp4", label: "Trimmed profile ref (R2)" }
];

async function checkImage(url, idx) {
    try {
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());
        const metadata = await sharp(buffer).metadata();
        console.log(`Image ${idx + 1}: Width: ${metadata.width}px | Height: ${metadata.height}px | URL: ${url}`);
    } catch (e) {
        console.error(`Failed to check image ${idx + 1}:`, e.message);
    }
}

async function checkVideo(url, label) {
    const tempFile = path.join(os.tmpdir(), `dim_check_${Date.now()}.mp4`);
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.statusText);
        fs.writeFileSync(tempFile, Buffer.from(await res.arrayBuffer()));
        
        const ffprobeBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffprobe-static', 
            os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe'
        );
        
        const cmd = `"${ffprobeBinary}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${tempFile}"`;
        
        await new Promise((resolve) => {
            exec(cmd, (err, stdout) => {
                if (err) {
                    console.log(`${label} dimensions: Error running ffprobe`);
                } else {
                    console.log(`${label} dimensions: ${stdout.trim()} | URL: ${url}`);
                }
                resolve();
            });
        });
    } catch (e) {
        console.error(`Failed to check ${label}:`, e.message);
    } finally {
        try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (err) {}
    }
}

async function run() {
    console.log("=== Checking Image Dimensions ===");
    for (let i = 0; i < propertyImages.length; i++) {
        await checkImage(propertyImages[i], i);
    }
    
    console.log("\n=== Checking Video Dimensions ===");
    for (const v of videos) {
        await checkVideo(v.url, v.label);
    }
}

run();
