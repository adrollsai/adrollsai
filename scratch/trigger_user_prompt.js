const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIE_API_KEY = process.env.KIE_API_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Setup constants for user/asset
const assetId = "9d9aafe3-e5b4-4e4d-9ee5-97d1dfc28e72";
const remainingTaskId = "f23cfb14-9ea9-4d69-9205-7be8505ff643";
const deleteTaskId = "ddc6915f-fdb6-4d76-9dcf-783d917525b0";

// JPEG images and voice references
const avatarJpgUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/29937131-1975-4c5f-9b78-e5b28f918d32/converted_img_379839c09cd6e0745614d5b8b05840b5.jpg";
const avatarAudioUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/logos/29937131-1975-4c5f-9b78-e5b28f918d32/1781764655124-avatar-voice-sample-29937131-1975-4c5f-9b78-e5b28f918d32-1781764654122.mp3";

const refImages = [
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/59cd329c-c1f5-45e1-9d41-a0642d5132f4-1781506309621-yevzdi.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/59cd329c-c1f5-45e1-9d41-a0642d5132f4-1781506309558-qm7uu.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/59cd329c-c1f5-45e1-9d41-a0642d5132f4-1781506309779-de9y9d.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/59cd329c-c1f5-45e1-9d41-a0642d5132f4-1781506309568-a9h9ri.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/59cd329c-c1f5-45e1-9d41-a0642d5132f4-1781506312617-yrrloi.jpg",
    "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/59cd329c-c1f5-45e1-9d41-a0642d5132f4-1781506309577-i07s6c.jpg"
];

const combinedRefImages = [avatarJpgUrl, ...refImages];

const userPrompt = `Use reference image ONLY for character facial appearance and identity consistency.

Use reference audio ONLY for voice characteristics.

Duration: 15 seconds
Aspect Ratio: 9:16

Setting: A luxurious white marble lobby with a private golden elevator door and wooden wall panels, matching Reference Image 4.

Presenter: A professional South Asian woman in her late 20s with long wavy dark hair and a warm smile, speaking directly to the camera in a natural, organic, UGC-like video that does not look AI. Delivery must be highly expressive, enthusiastic, and natural. Wearing a stylish emerald green designer dress.

B-Roll: Transition smoothly to the modern luxury villa exterior (matching Reference Image 1) and the expansive formal living room with high-gloss Italian Iceberg marble flooring (matching Reference Image 3) during corresponding dialogue cues. Only show the parts of the image that are actually visible in the reference image. Do not out-paint, extrapolate, or hallucinate areas outside the reference image borders.

Dialogue:
"न्यू चंडीगढ़ में चौदह करोड़ का अल्ट्रा लग्ज़री कोठी ढूंढ रहे हैं जो आपकी एलीट लेगेसी को मैच करे? इस एक कनाल मास्टरपीस में आपको मिलेगा इटैलियन आइसबर्ग मार्बल फ्लोर और एब्सोल्यूट एक्सक्लूसिविटी। आज ही द प्रो एस्टेट से कांटेक्ट करें।"`;

async function getNgrokUrl() {
    try {
        const res = await fetch("http://127.0.0.1:4040/api/tunnels");
        if (res.ok) {
            const data = await res.json();
            const publicUrl = data.tunnels?.[0]?.public_url;
            if (publicUrl) {
                console.log(`Found active ngrok public URL: ${publicUrl}`);
                return publicUrl;
            }
        }
    } catch (e) {
        console.warn("Could not query ngrok local API, using fallback.");
    }
    return "https://unincidental-supersarcastic-irvin.ngrok-free.dev";
}

async function triggerKieTask(payload) {
    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${KIE_API_KEY}`
        },
        body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
        throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.code !== 0 && data.code !== 200) {
        throw new Error(`Kie error: ${data.msg || data.error}`);
    }
    return data.data?.taskId;
}

async function run() {
    try {
        if (!KIE_API_KEY) {
            throw new Error("KIE_API_KEY is not defined in .env.local.");
        }

        const ngrokUrl = await getNgrokUrl();
        const callbackUrl = `${ngrokUrl}/api/video/callback`;
        console.log(`Using Callback URL: ${callbackUrl}`);

        // 1. Delete sibling task to make it a single-clip video task
        console.log(`Deleting duplicate task ${deleteTaskId} to enforce single-clip execution...`);
        const { error: deleteErr } = await supabase
            .from('video_tasks')
            .delete()
            .eq('id', deleteTaskId);

        if (deleteErr) {
            console.warn("Could not delete task (might already be deleted):", deleteErr);
        } else {
            console.log("Task deleted successfully.");
        }

        // 2. Prepare payload
        const payload = {
            model: "bytedance/seedance-2-fast",
            callBackUrl: callbackUrl,
            input: {
                prompt: userPrompt,
                aspect_ratio: "9:16",
                duration: 15,
                generate_audio: true,
                resolution: "480p",
                nsfw_checker: true,
                web_search: false,
                reference_image_urls: combinedRefImages.slice(0, 9),
                reference_audio_urls: [avatarAudioUrl]
            }
        };

        console.log("Submitting single task to Kie.ai...");
        const taskId = await triggerKieTask(payload);
        console.log(`Triggered on Kie.ai successfully! Task ID: ${taskId}`);

        // 3. Update the remaining video task record
        console.log(`Updating remaining task ${remainingTaskId} in database...`);
        const { error: updateErr } = await supabase
            .from('video_tasks')
            .update({
                last_task_id: taskId,
                prompts: [userPrompt],
                current_index: 0,
                status: 'Processing',
                last_successful_task_id: avatarJpgUrl
            })
            .eq('id', remainingTaskId);

        if (updateErr) {
            throw updateErr;
        }
        console.log("Updated video task row successfully.");

        // 4. Update parent asset status to Processing
        console.log(`Resetting parent asset ${assetId} status to 'Processing'...`);
        const { error: assetErr } = await supabase
            .from('assets')
            .update({ status: 'Processing' })
            .eq('id', assetId);

        if (assetErr) {
            throw assetErr;
        }
        console.log("Parent asset status updated.");

        console.log("\nSuccess! Video generation triggered and database records reset.");
    } catch (e) {
        console.error("Fatal Error:", e);
    }
}

run();
