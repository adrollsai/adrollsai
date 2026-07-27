const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const assetId = "884bd839-900a-4556-b7dc-6222cd6a8e75";
const userId = "42d2e0c5-4fe6-4738-8a9f-63f09be01f12";
const propertyId = "8050efba-27eb-45e2-8149-28e24de74b99";

const taskIds = [
  '18126a4659789297734862469957cf76',
  '2ed33e7ba82850b148abd3011f24ea32',
  '0d93928bf420cbf5e16f123833720c19'
];

const propertyImages = [
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1780295493225-o6ys2sg.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1780295493238-s0890m.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1780295493198-8a5so8.jpg"
];

const grokPrompts = [
  "Reference 9:16 property image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring a modern Indian female presenter standing in front of luxury 2 BHK apartments in Sukh Valley Mohali with dramatic push-in camera zoom, warm sunlight, and elegant background music. Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind.",
  "Reference 9:16 interior image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring a smooth 360 orbital camera pan around a stunning 3D geometric backlit accent wall and premium marble flooring in a luxury Indian apartment with uplifting background music. Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind.",
  "Reference 9:16 gated society image as identity lock. Create an ultrarealistic live-action 9:16 commercial showing a wide cinematic tracking shot of the grand entrance gate and 40ft wide boulevard road of a gated society in Mohali with soft commercial background music. Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind."
];

async function main() {
    console.log("Inserting video_tasks for GNR Homes asset...");
    await supabaseAdmin.from('video_tasks').delete().eq('asset_id', assetId);

    for (let i = 0; i < taskIds.length; i++) {
        const tid = taskIds[i];
        const { data, error } = await supabaseAdmin
            .from('video_tasks')
            .insert({
                id: crypto.randomUUID(),
                user_id: userId,
                property_id: propertyId,
                asset_id: assetId,
                prompts: grokPrompts,
                current_index: i,
                last_task_id: tid,
                last_successful_task_id: propertyImages[i],
                aspect_ratio: "9:16",
                status: "Processing",
                final_caption: "Sukh Valley 2 BHK Flats by GNR Homes Mohali"
            })
            .select()
            .single();

        if (error) {
            console.error(`Error inserting row ${i}:`, error);
        } else {
            console.log(`Successfully inserted row ${i + 1}: ${data.id}`);
        }
    }
}

main().catch(console.error);
