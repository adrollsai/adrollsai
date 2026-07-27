const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const kieApiKey = env.KIE_API_KEY;

const assetId = "884bd839-900a-4556-b7dc-6222cd6a8e75";
const userId = "42d2e0c5-4fe6-4738-8a9f-63f09be01f12";
const propertyId = "8050efba-27eb-45e2-8149-28e24de74b99";

const propertyImages = [
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1780295493225-o6ys2sg.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1780295493238-s0890m.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1780295493198-8a5so8.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1780295493252-45wazg.jpg"
];

const scriptCaption = "Are you tired of paying endless rent and want the pride of owning your own luxury home in Mohali? Introducing Sukh Valley by GNR HOMES, a premium pre-launch gated society project. Gorgeous 2 BHK flats featuring a beautiful 3D geometric backlit accent wall, premium marble flooring, and cozy bedrooms with elegant wood paneling. Gated society on 40ft road with 24/7 power and water, market at walking distance, and easy bank loan facilities. Prices starting from 53.90 Lacs onwards. Call or WhatsApp GNR HOMES at 7719430097 or 7087023926 for booking and exclusive deals!";

async function createKieTask(payload) {
    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${kieApiKey}` },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    return { taskId: json.data?.taskId, error: json.msg !== 'success' ? (json.msg || 'Error') : null };
}

async function main() {
    console.log("=== STEP 1: Launching Async Gemini TTS Voiceover ===");
    const ttsPayload = {
        model: "google/gemini-3-1-flash-tts",
        input: {
            speakers: [{
                speaker_id: "Speaker 1",
                voice_name: "Aoede",
                audio_profile: "",
                style: "Confident",
                pace: "Natural",
                accent: "Neutral"
            }],
            dialogue_turns: [{
                speaker_id: "Speaker 1",
                text: scriptCaption
            }],
            temperature: 1,
            scene: "Professional Indian real estate commercial voiceover studio",
            sample_context: "Luxury real estate marketing video"
        }
    };

    const { taskId: ttsTaskId, error: ttsErr } = await createKieTask(ttsPayload);
    console.log("TTS Task ID:", ttsTaskId, "Err:", ttsErr);

    console.log("\n=== STEP 2: Building Grok Video Scene Prompts ===");
    const grokPrompts = [
        "Reference 9:16 property image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring a modern Indian female presenter standing in front of luxury 2 BHK apartments in Sukh Valley Mohali with dramatic push-in camera zoom, warm sunlight, and elegant background music. Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind.",
        "Reference 9:16 interior image as identity lock. Create an ultrarealistic live-action 9:16 commercial featuring a smooth 360 orbital camera pan around a stunning 3D geometric backlit accent wall and premium marble flooring in a luxury Indian apartment with uplifting background music. Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind.",
        "Reference 9:16 gated society image as identity lock. Create an ultrarealistic live-action 9:16 commercial showing a wide cinematic tracking shot of the grand entrance gate and 40ft wide boulevard road of a gated society in Mohali with soft commercial background music. Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind."
    ];

    const callbackUrl = "https://nobogent.vercel.app/api/video/callback";
    const taskIds = [];

    console.log("\n=== STEP 3: Launching 3 Grok Video Tasks in Parallel ===");
    for (let i = 0; i < grokPrompts.length; i++) {
        const imgUrl = propertyImages[i % propertyImages.length];
        console.log(`Launching Grok Scene ${i + 1}/3 with image ${imgUrl.slice(-20)}...`);
        
        const payload = {
            model: "grok-imagine-video-1-5-preview",
            callBackUrl: callbackUrl,
            input: {
                prompt: grokPrompts[i],
                image_urls: [imgUrl],
                aspect_ratio: "9:16",
                duration: 15,
                resolution: "480p",
                nsfw_checker: true
            }
        };

        const { taskId, error } = await createKieTask(payload);
        if (error || !taskId) {
            console.error(`Failed to launch Scene ${i + 1}:`, error);
        } else {
            console.log(`Scene ${i + 1} Task ID: ${taskId}`);
            taskIds.push(taskId);
        }
    }

    if (taskIds.length !== 3) {
        throw new Error("Failed to launch all 3 Grok scenes!");
    }

    console.log("\n=== STEP 4: Inserting video_tasks tracking rows into Supabase ===");
    // Clear old video_tasks if any for this asset
    await supabaseAdmin.from('video_tasks').delete().eq('asset_id', assetId);

    for (let index = 0; index < taskIds.length; index++) {
        const taskId = taskIds[index];
        const { data, error } = await supabaseAdmin
            .from('video_tasks')
            .insert({
                id: crypto.randomUUID(),
                user_id: userId,
                property_id: propertyId,
                asset_id: assetId,
                prompts: grokPrompts,
                current_index: index,
                last_task_id: taskId,
                last_successful_task_id: propertyImages[index % propertyImages.length],
                aspect_ratio: "9:16",
                status: "Processing",
                final_caption: scriptCaption,
                audio_url: ttsTaskId ? `tts:${ttsTaskId}` : null
            })
            .select()
            .single();

        if (error) {
            console.error(`Error inserting video_tasks row ${index}:`, error);
        } else {
            console.log(`Successfully created video_tasks record ${index + 1}: ${data.id}`);
        }
    }

    console.log("\n=== SUCCESS! GNR Homes Video Tasks Dispatched & Tracked ===");
    console.log("Asset ID:", assetId);
    console.log("Task IDs:", taskIds);
}

main().catch(console.error);
