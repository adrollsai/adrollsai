const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIE_API_KEY = process.env.KIE_API_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Define values for ProEstate
const userId = "29937131-1975-4c5f-9b78-e5b28f918d32";
const assetId = "9d9aafe3-e5b4-4e4d-9ee5-97d1dfc28e72";

// Converted JPEG avatar url we generated and verified earlier
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

// Clean reference images list
const combinedRefImages = [avatarJpgUrl, ...refImages];

async function getNgrokUrl() {
    try {
        console.log("Checking active ngrok tunnels...");
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

async function triggerTask(payload) {
    console.log("Launching Kie task...");
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
            throw new Error("KIE_API_KEY is not defined.");
        }

        const ngrokUrl = await getNgrokUrl();
        const callbackUrl = `${ngrokUrl}/api/video/callback`;
        console.log(`Using callback URL: ${callbackUrl}`);

        // Fetch current tasks
        const { data: tasks, error } = await supabase
            .from('video_tasks')
            .select('*')
            .eq('asset_id', assetId);

        if (error || !tasks || tasks.length === 0) {
            throw new Error(`Failed to load video tasks: ${error?.message || 'No tasks found'}`);
        }

        console.log(`Found ${tasks.length} clips to trigger.`);

        for (const task of tasks) {
            const index = task.current_index;
            const prompt = task.prompts[index];

            console.log(`\n--- Triggering Clip ${index + 1} (Task ID: ${task.id}) ---`);
            
            const payload = {
                model: "bytedance/seedance-2-fast",
                callBackUrl: callbackUrl,
                input: {
                    prompt: prompt,
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

            const newTaskId = await triggerTask(payload);
            console.log(`Successfully triggered task on Kie.ai! New Task ID: ${newTaskId}`);

            // Update database row
            const { error: updateErr } = await supabase
                .from('video_tasks')
                .update({
                    last_task_id: newTaskId,
                    status: 'Processing',
                    last_successful_task_id: avatarJpgUrl // Store avatar url for retry consistency
                })
                .eq('id', task.id);

            if (updateErr) {
                console.error(`Error updating video task row:`, updateErr);
            } else {
                console.log(`Updated video task row in DB successfully.`);
            }
        }

        // Update parent asset status to Processing
        const { error: assetUpdateErr } = await supabase
            .from('assets')
            .update({ status: 'Processing' })
            .eq('id', assetId);

        if (assetUpdateErr) {
            console.error(`Error updating parent asset status:`, assetUpdateErr);
        } else {
            console.log(`Updated parent asset 9d9aafe3-e5b4-4e4d-9ee5-97d1dfc28e72 status to 'Processing'.`);
        }

        console.log("\nAll clips re-triggered successfully!");
    } catch (e) {
        console.error("Fatal run error:", e);
    }
}

run();
