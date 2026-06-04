require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

// 1. Configuration & Clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const kieApiKey = process.env.KIE_API_KEY;

if (!supabaseUrl || !supabaseKey || !kieApiKey) {
    console.error("Error: Missing credentials in .env.local!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY);

const userId = "9bbf6e51-283e-48d1-bbb4-8dc546cc74b2";
const propertyId = "962a1c2f-6f47-49e5-9c8c-3bd0ac491bb3";

const scriptData = {
    title: "Ananta Aspire Exclusive Living",
    finalCaption: "Tired of crowded high-rises and zero privacy? Step into pure exclusivity at Ananta Aspire on the Chandigarh-Patiala Highway in Zirakpur. Experience the luxury of having just 2 apartments per floor, vast open layouts, and stunning green views. Backed by 20+ years of trusted expertise, Homcom Realtors is ready to help you unlock the perfect premium home your family deserves. Send us a message or click below to get exclusive pricing details today!",
    scenes: [
        {
            dialogue: "Tired of crowded high-rises and zero privacy? Step into pure exclusivity at Ananta Aspire on the Chandigarh-Patiala Highway in Zirakpur.",
            visuals: "An elegant Indian UGC creator standing in front of a modern premium apartment building, gesturing towards it."
        },
        {
            dialogue: "Experience the luxury of having just 2 apartments per floor, vast open layouts, and stunning green views. Homcom Realtors is ready to help you unlock the perfect premium home today!",
            visuals: "A close up of the presenter smiling, then cutting to show the lush green surroundings of the society."
        }
    ]
};

function extractVideoUrl(checkData) {
    if (!checkData) return null;
    const result = checkData.result || checkData.data?.result || checkData.data;
    if (result) {
        const url = result.video_url || result.videoUrl || result.output_url || result.outputUrl || result.url;
        if (url && typeof url === 'string' && url.startsWith('http')) return url;
        
        const urls = result.videoUrls || result.resultUrls || result.result_urls || result.fullResultUrls || result.full_result_urls;
        if (Array.isArray(urls) && urls.length > 0 && typeof urls[0] === 'string' && urls[0].startsWith('http')) {
            return urls[0];
        }
    }
    const resultJson = checkData.resultJson || checkData.data?.resultJson;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson);
            const parsedUrls = parsed.resultUrls || parsed.result_urls || parsed.fullResultUrls || parsed.full_result_urls || [parsed.url];
            const firstUrl = Array.isArray(parsedUrls) ? parsedUrls[0] : parsedUrls;
            if (firstUrl && typeof firstUrl === 'string' && firstUrl.startsWith('http')) return firstUrl;
        } catch (e) {}
    }
    return null;
}

async function run() {
    try {
        console.log("=========================================");
        console.log("STARTING DIRECT VIDEO CREATION FLOW");
        console.log(`Subaccount ID: ${userId}`);
        console.log(`Property ID:   ${propertyId}`);
        console.log("=========================================\n");

        // 1. Fetch profile and property
        console.log("[1/9] Fetching profile details...");
        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            throw new Error(`Failed to fetch profile: ${profileErr?.message || 'Not found'}`);
        }

        console.log("  Profile character_url:", profile.character_url);
        console.log("  Profile voice sample:", profile.character_audio_url);

        console.log("[2/9] Fetching property details...");
        const { data: property, error: propErr } = await supabase
            .from('properties')
            .select('*')
            .eq('id', propertyId)
            .single();

        if (propErr || !property) {
            throw new Error(`Failed to fetch property: ${propErr?.message || 'Not found'}`);
        }
        console.log(`  Property Title: ${property.title}`);
        console.log(`  Found ${property.images?.length || 0} property images.`);

        // 2. Formulate prompts via Gemini
        console.log("[3/9] Synthesizing scene prompts using Gemini...");
        const prompts = [];
        const geminiModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        
        const descriptionsText = (property.images || [])
            .slice(0, 4)
            .map((img, i) => `- Reference Image ${i + 1} URL: "${img}"`)
            .join('\n');

        const characterDescription = profile.character_description || "A young Indian female UGC content creator";

        for (let i = 0; i < scriptData.scenes.length; i++) {
            const scene = scriptData.scenes[i];
            const promptTemplate = `You are a professional Prompt Engineer for Video Generative AI.
Translate the following specific scene from a script into a simple, high-performing generative prompt for Bytedance/Kie.ai Seedance 2.0.

Scene Number: ${i + 1} of ${scriptData.scenes.length}
Scene Dialogue: "${scene.dialogue}"
Scene Visuals: "${scene.visuals}"
Business name: "${profile.business_name}"
Product context: "Product: ${property.title}. Description: ${property.description.substring(0, 500)}..."

CREATOR CHARACTER:
- Description: "${characterDescription}"
- Reference Video Available: Yes

REFERENCE IMAGES & DETAILS:
${descriptionsText}

YOUR INSTRUCTIONS:
1. Generate a structured generative video prompt. Do NOT use markdown headers (like #, ##) or code blocks or bracketed blocks like [Action]. Follow the exact structure shown below.
2. Output the prompt following this EXACT format:

Use reference video only for character appearance.
Use reference audio only for voice characteristics.

Character maintains eye contact with camera throughout. He/She is wearing a professional beige linen blazer in a modern white interior office.

Dialogue:
"${scene.dialogue}"

Speech Style:
High-energy UGC style, exceptionally warm and welcoming tone, professional presentation, natural gestures, and excellent projection.

Action:
Speaking directly to the viewer with high energy and natural hand gestures. Dynamic cuts between close-up and medium shots. In the background, modern surroundings are visible.

Camera:
Dynamic multi-shot setup, switching from a detailed close-up shot to a medium shot, keeping face centered.

Style:
Premium UGC video advertisement, realistic motion, high-end professional presentation, warm inviting lighting.

Avoid:
No overlay Text, No overlay captions`;

            console.log(`  Synthesizing prompt for Scene ${i + 1}...`);
            const result = await geminiModel.generateContent(promptTemplate);
            const promptText = result.response.text().trim();
            prompts.push(promptText);
        }

        console.log("\n--- Synthesized Prompts: ---");
        prompts.forEach((p, idx) => {
            console.log(`\nScene ${idx + 1} Prompt:\n${p}\n-----------------`);
        });

        // 3. Create placeholder asset in DB
        console.log("\n[4/9] Creating placeholder asset in Supabase database...");
        const { data: newAsset, error: assetErr } = await supabase
            .from('assets')
            .insert({
                user_id: userId,
                property_id: propertyId,
                type: 'video',
                status: 'Processing',
                url: 'https://designs.adrolls.in/processing',
                caption: scriptData.finalCaption
            })
            .select()
            .single();

        if (assetErr || !newAsset) {
            throw new Error(`Failed to create asset: ${assetErr?.message}`);
        }
        console.log(`  Created asset placeholder with ID: ${newAsset.id}`);

        // 4. Submit tasks to Kie.ai
        console.log("[5/9] Submitting tasks to Kie.ai parallelly...");
        const taskIds = [];
        const callbackUrl = "https://app.adrolls.in/api/video/callback";

        for (let i = 0; i < prompts.length; i++) {
            const payload = {
                model: "bytedance/seedance-2-fast",
                callBackUrl: callbackUrl,
                input: {
                    prompt: prompts[i],
                    aspect_ratio: "9:16",
                    duration: 15,
                    generate_audio: true,
                    resolution: "480p",
                    nsfw_checker: true,
                    web_search: false,
                    reference_video_urls: [profile.character_url],
                    reference_audio_urls: [profile.character_audio_url]
                }
            };
            if (property.images && property.images.length > 0) {
                payload.input.reference_image_urls = property.images.slice(0, 9);
            }

            console.log(`  Submitting task for Scene ${i + 1}...`);
            const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${kieApiKey}`
                },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            if (!res.ok || (result.code !== 0 && result.code !== 200)) {
                console.error("Kie.ai Task Creation Failed. Response payload:", JSON.stringify(result));
                throw new Error(`Kie.ai task creation failed: ${result.msg || result.error || res.statusText}`);
            }

            const taskId = result.data?.taskId;
            console.log(`  Successfully submitted! Kie Task ID: ${taskId}`);
            taskIds.push(taskId);
        }

        // 5. Insert rows in video_tasks table
        console.log("[6/9] Recording task state in video_tasks database table...");
        for (let i = 0; i < taskIds.length; i++) {
            const { error: taskInsertErr } = await supabase
                .from('video_tasks')
                .insert({
                    id: crypto.randomUUID(),
                    user_id: userId,
                    property_id: propertyId,
                    asset_id: newAsset.id,
                    prompts: prompts,
                    current_index: i,
                    last_task_id: taskIds[i],
                    last_successful_task_id: profile.character_url,
                    aspect_ratio: "9:16",
                    status: 'Processing',
                    final_caption: scriptData.finalCaption
                });

            if (taskInsertErr) {
                console.error(`  Warning: Failed to save video_task row for Scene ${i + 1}:`, taskInsertErr.message);
            }
        }
        console.log("  Successfully registered all tasks in DB.");

        // 6. Live polling and monitoring loop
        console.log("\n=========================================");
        console.log("[7/9] ENTERING LIVE MONITORING LOOP");
        console.log("We will poll Kie.ai for task updates every 15 seconds.");
        console.log("=========================================\n");

        const finalClips = new Array(taskIds.length).fill(null);
        let completed = 0;
        let failed = false;
        let failMessage = "";

        const startTime = Date.now();

        while (completed < taskIds.length && !failed) {
            // Check status of each incomplete task
            for (let i = 0; i < taskIds.length; i++) {
                if (finalClips[i] !== null) continue; // Scene already done

                const taskId = taskIds[i];
                const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${kieApiKey}` }
                });

                if (!response.ok) {
                    console.log(`  [Scene ${i + 1}] API request failed. Retrying...`);
                    continue;
                }

                const checkData = await response.json();
                const status = checkData.status || checkData.data?.status || checkData.data?.state;

                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(`  [${elapsed}s elapsed] Scene ${i + 1} status: ${status || 'Unknown'}`);

                if (status === 'succeeded' || status === 'completed' || status === 'success') {
                    const videoUrl = extractVideoUrl(checkData);
                    if (videoUrl) {
                        console.log(`  🌟 Scene ${i + 1} succeeded! Clip URL: ${videoUrl}`);
                        finalClips[i] = videoUrl;
                        completed++;
                    } else {
                        console.log(`  [Scene ${i + 1}] Status is success, but URL is not present yet.`);
                    }
                } else if (status === 'failed' || status === 'error') {
                    failed = true;
                    failMessage = checkData.failMsg || checkData.error || checkData.msg || "Unknown Kie.ai Error";
                    console.log(`  ❌ Scene ${i + 1} failed: ${failMessage}`);
                    break;
                }
            }

            if (completed < taskIds.length && !failed) {
                await new Promise(resolve => setTimeout(resolve, 15000));
            }
        }

        if (failed) {
            throw new Error(`Kie.ai generation failed: ${failMessage}`);
        }

        console.log("\n=========================================");
        console.log("[8/9] BOTH CLIPS COMPLETED SUCCESSFULLY!");
        console.log("Commencing local download and stitching...");
        console.log("=========================================\n");

        const tempDir = path.join(os.tmpdir(), `test_stitch_${newAsset.id}`);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const localFiles = [];
        for (let i = 0; i < finalClips.length; i++) {
            const clipUrl = finalClips[i];
            const localPath = path.join(tempDir, `scene_${i}.mp4`);
            console.log(`Downloading scene ${i + 1} from ${clipUrl}...`);
            const response = await fetch(clipUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(localPath, buffer);
            localFiles.push(localPath);
        }

        // Generate concat list
        const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
        const concatTxtPath = path.join(tempDir, 'concat.txt');
        fs.writeFileSync(concatTxtPath, concatContent);

        // Run FFmpeg
        const outputPath = path.join(tempDir, 'stitched.mp4');
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const cmd = `"${ffmpegBinary}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy "${outputPath}"`;
        console.log(`Running FFmpeg stitch command: ${cmd}`);

        await new Promise((resolve, reject) => {
            exec(cmd, (execErr, stdout, stderr) => {
                if (execErr) {
                    reject(execErr);
                } else {
                    resolve();
                }
            });
        });
        console.log("FFmpeg completed stitching successfully!");

        // Upload to R2
        console.log("\n[9/9] Uploading final stitched video to Cloudflare R2...");
        const finalFileName = `adrolls-storage/generated/${userId}/stitched_${Date.now()}.mp4`;
        const stitchedBuffer = fs.readFileSync(outputPath);

        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: finalFileName,
            Body: stitchedBuffer,
            ContentType: 'video/mp4'
        }));

        const persistedUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
        console.log(`  Stitched video uploaded to R2: ${persistedUrl}`);

        // Update database asset record to Draft
        console.log("Updating database asset record to Draft...");
        const { data: finalAsset, error: updateErr } = await supabase
            .from('assets')
            .update({
                url: persistedUrl,
                status: 'Draft',
                metadata: {} // Clear errors
            })
            .eq('id', newAsset.id)
            .select()
            .single();

        if (updateErr) {
            throw updateErr;
        }

        console.log("Asset updated in DB successfully!");

        // Clean up video_tasks
        console.log("Cleaning up video tasks from database...");
        await supabase
            .from('video_tasks')
            .delete()
            .eq('asset_id', newAsset.id);

        // Cleanup local temp directory
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {}

        console.log("\n=========================================");
        console.log("🏆 VIDEO GENERATION AND STITCHING SUCCESSFUL!");
        console.log(`Asset ID:  ${finalAsset.id}`);
        console.log(`Final URL: ${persistedUrl}`);
        console.log("=========================================");

    } catch (err) {
        console.error("\n❌ Execution failed:", err.message);
        // Clean up placeholder asset if it was created
        // We will attempt to mark it failed in DB
        process.exit(1);
    }
}

run();
