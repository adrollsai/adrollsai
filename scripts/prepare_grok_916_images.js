const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const sourceImages = [
    // 1. Luxury High-Rise Apartment Tower (Ananta Aspire)
    {
        name: 'scene1_luxury_apartment.jpg',
        url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1789990891091-Anata..jpg'
    },
    // 2. Ultra Luxury Kothi / Duplex Villa & Plot (New Chandigarh)
    {
        name: 'scene2_luxury_villa_kothi.jpg',
        url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/properties/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1781938801841-1.jpg'
    },
    // 3. Ultra Luxury Apartment Interior Living Room
    {
        name: 'scene3_luxury_interior.jpg',
        url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/properties/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1782544138940-17.jpg'
    },
    // 4. Modern Commercial / High Street Boulevard (The Marq / PR-7)
    {
        name: 'scene4_commercial_boulevard.jpg',
        url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1789804507073-1.jpg'
    },
    // 5. Homcom Prestigious Real Estate Skyline & Architecture
    {
        name: 'scene5_homcom_skyline.jpg',
        url: 'https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1779094420922-9o6kec.jpg'
    }
];

async function prepareImages() {
    console.log("=== Preparing 5 9:16 (1080x1920) Master Reference Images for Grok ===");
    const finalUrls = [];

    for (let i = 0; i < sourceImages.length; i++) {
        const item = sourceImages[i];
        console.log(`Processing Scene ${i + 1}: ${item.name}...`);
        
        const res = await fetch(item.url);
        const inputBuf = Buffer.from(await res.arrayBuffer());

        // Resize and crop to 1080x1920 (9:16 vertical video ratio)
        const outputBuf = await sharp(inputBuf)
            .resize(1080, 1920, {
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ quality: 92 })
            .toBuffer();

        const uploadFileName = `homcom_916_scene_${i + 1}_${Date.now()}.jpg`;
        const { data, error } = await supabase.storage
            .from('properties')
            .upload(uploadFileName, outputBuf, {
                contentType: 'image/jpeg',
                upsert: true
            });

        if (error) {
            console.error(`Upload error for scene ${i + 1}:`, error);
            throw error;
        }

        const publicUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/properties/${uploadFileName}`;
        console.log(`Scene ${i + 1} Ready -> ${publicUrl}`);
        finalUrls.push(publicUrl);
    }

    fs.writeFileSync('homcom_grok_images.json', JSON.stringify(finalUrls, null, 2));
    console.log("\n✅ All 5 9:16 Images successfully uploaded and saved to homcom_grok_images.json");
}

prepareImages().catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
