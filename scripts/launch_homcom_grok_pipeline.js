const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const kieApiKey = env.KIE_API_KEY;

const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
);

// Cloudflare R2 Client
const r2Endpoint = (env.R2_ENDPOINT || '').replace(/\/adrolls-storage\/?$/, '');
const r2 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
});
const R2_BUCKET = env.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = env.R2_PUBLIC_URL || env.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

// Homcom Account IDs
const HOMCOM_PARENT_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2';
const HOMCOM_AGENT_ID = '123d52f1-8014-422c-bc4f-1d4fbc5acb7f';

const scriptText = `🎬 HOMCOM REALTORS – YOUR SEARCH FOR THE RIGHT PROPERTY ENDS HERE!

Looking to buy or invest in real estate in the Tricity — with a budget starting from ₹1.5 Crore and onwards?

Whether you’re looking for a luxury apartment, a premium residential plot, an investment opportunity in LOI-based projects, or high-potential residential and commercial properties — finding the right opportunity can be challenging.

But now, your search is over!

Welcome to Homcom Realtors — your trusted real estate advisors, backed by extensive market experience and a wide inventory of carefully shortlisted property options.

Our experienced professionals understand your requirements, your investment goals, and your expectations — helping you explore the right opportunities that match your needs.

From premium homes to strategic investments and commercial properties, we bring you the right choices, expert guidance, and a more confident way to invest in real estate.

Stop searching endlessly. Start investing wisely!

Connect with Homcom Realtors today and discover the property opportunities that are right for you.

Homcom Realtors — Your Trusted Partners in Premium Real Estate.`;

// 9:16 reference images generated earlier
const grokImages = JSON.parse(fs.readFileSync('homcom_grok_images.json', 'utf8'));

const grokSceneConfigs = [
    {
        sceneId: 1,
        title: "Tricity Luxury Apartments Hook",
        imageUrl: grokImages[0],
        prompt: "Reference 9:16 image as identity lock. Photorealistic live-action documentary footage of a modern luxury high-rise apartment tower in Tricity with smooth cinematic slow upward drone tilt, clear natural sunlight, true-to-life architectural materials, real physical lighting, high-end commercial videography, absolutely NO text, NO titles, NO watermarks, NO subtitles."
    },
    {
        sceneId: 2,
        title: "Premium Plots and Luxury Kothis",
        imageUrl: grokImages[1],
        prompt: "Reference 9:16 image as identity lock. Ultrarealistic live-action tracking camera moving smoothly across a prestigious modern duplex Kothi villa in New Chandigarh with manicured green lawn, paved private driveway, real stone textures, crisp daylight, high quality luxury property tour, absolutely NO text, NO titles, NO watermarks, NO subtitles."
    },
    {
        sceneId: 3,
        title: "Shortlisted Luxury Interiors",
        imageUrl: grokImages[2],
        prompt: "Reference 9:16 image as identity lock. Ultrarealistic live-action interior gimbal pan gliding through an exquisite high-ceiling luxury apartment master living room, Italian polished marble floors reflecting natural daylight, expansive glass windows with lush green views, authentic architectural interior, absolutely NO text, NO titles, NO watermarks, NO subtitles."
    },
    {
        sceneId: 4,
        title: "Commercial and Strategic Investment Avenues",
        imageUrl: grokImages[3],
        prompt: "Reference 9:16 image as identity lock. Photorealistic live-action street-level tracking shot of a prestigious modern commercial boulevard and retail glass facade complex in Tricity, real reflections on glass windows, wide clean avenue, golden hour lighting, commercial investment documentary, absolutely NO text, NO titles, NO watermarks, NO subtitles."
    },
    {
        sceneId: 5,
        title: "Homcom Trusted Real Estate Advisory",
        imageUrl: grokImages[4],
        prompt: "Reference 9:16 image as identity lock. Ultrarealistic cinematic push-in shot across an executive luxury real estate advisory penthouse lounge with panoramic skyline views of Tricity at sunset, warm subtle lighting, sophisticated decor, high-end corporate presentation, absolutely NO text, NO titles, NO watermarks, NO subtitles."
    }
];

async function createGrokTask(config) {
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        input: {
            prompt: config.prompt,
            image_urls: [config.imageUrl],
            aspect_ratio: "9:16",
            duration: 15,
            resolution: "480p",
            nsfw_checker: true
        }
    };

    console.log(`[Grok] Dispatching Scene ${config.sceneId} (${config.title})...`);
    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${kieApiKey}` },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    const taskId = json.data?.taskId;
    if (!taskId) throw new Error(`Scene ${config.sceneId} create error: ${JSON.stringify(json)}`);
    console.log(`[Grok] Scene ${config.sceneId} Task ID: ${taskId}`);
    return { ...config, taskId };
}

async function pollGrokTask(config) {
    for (let p = 0; p < 60; p++) {
        await new Promise(r => setTimeout(r, 4000));
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${config.taskId}`, {
            headers: { "Authorization": `Bearer ${kieApiKey}` }
        });
        const json = await res.json();
        const state = json.data?.state;
        if (state === 'success' && json.data?.resultJson) {
            const parsed = JSON.parse(json.data.resultJson);
            const videoUrl = parsed.resultUrls?.[0] || parsed.url;
            console.log(`[Grok] Scene ${config.sceneId} SUCCESS! Video URL: ${videoUrl}`);
            return { ...config, videoUrl };
        } else if (state === 'fail') {
            throw new Error(`Scene ${config.sceneId} failed: ${json.data?.failMsg}`);
        }
        if ((p + 1) % 5 === 0) {
            console.log(`[Grok] Scene ${config.sceneId} still processing (poll ${p + 1}/60)...`);
        }
    }
    throw new Error(`Scene ${config.sceneId} timed out.`);
}

async function main() {
    console.log("===============================================================================");
    console.log("🚀 STARTING HOMCOM REALTORS COMPLETE VIDEO PRODUCTION PIPELINE");
    console.log("===============================================================================\n");

    const workDir = path.join(process.cwd(), 'temp_homcom_video');
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const masterAudioWav = path.join(process.cwd(), 'temp_homcom_audio', 'homcom_voiceover_master.wav');
    if (!fs.existsSync(masterAudioWav)) {
        throw new Error(`Master audio not found at ${masterAudioWav}. Run generate_homcom_voiceover.js first!`);
    }

    const totalAudioDuration = parseFloat(
        execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${masterAudioWav}"`).toString().trim()
    );
    console.log(`Master Voiceover Audio Duration: ${totalAudioDuration}s\n`);

    console.log("=== STEP 1: Launching 5 Grok Imagine Video Tasks in Parallel ===");
    const launchedTasks = [];
    for (const cfg of grokSceneConfigs) {
        const launched = await createGrokTask(cfg);
        launchedTasks.push(launched);
    }

    console.log("\n=== STEP 2: Polling for all 5 Grok Scenes Completion ===");
    const completedScenes = await Promise.all(launchedTasks.map(task => pollGrokTask(task)));

    console.log("\n=== STEP 3: Downloading and Normalizing Video Clips to 9:16 (1080x1920) ===");
    const normalizedClips = [];
    // Calculate exact duration per scene so 5 scenes match total audio duration
    const targetClipDuration = totalAudioDuration / completedScenes.length; // ~14.312s each
    console.log(`Target duration per scene: ${targetClipDuration.toFixed(3)}s`);

    for (let i = 0; i < completedScenes.length; i++) {
        const scene = completedScenes[i];
        const rawClipPath = path.join(workDir, `raw_scene_${scene.sceneId}.mp4`);
        const normClipPath = path.join(workDir, `norm_scene_${scene.sceneId}.mp4`);

        console.log(`Downloading Scene ${scene.sceneId}...`);
        const videoRes = await fetch(scene.videoUrl);
        fs.writeFileSync(rawClipPath, Buffer.from(await videoRes.arrayBuffer()));

        // Scale to 1080x1920 (9:16) with high quality lanczos scaling, strip native audio, exact duration
        console.log(`Normalizing Scene ${scene.sceneId} to 1080x1920 30fps (duration: ${targetClipDuration.toFixed(2)}s)...`);
        execSync(
            `ffmpeg -y -i "${rawClipPath}" -t ${targetClipDuration} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30" -c:v libx264 -preset fast -crf 18 -an "${normClipPath}"`
        );
        normalizedClips.push(normClipPath);
    }

    console.log("\n=== STEP 4: Concatenating 5 Visual Clips ===");
    const concatListFile = path.join(workDir, 'video_concat.txt');
    let concatListStr = "";
    for (const clip of normalizedClips) {
        concatListStr += `file '${clip.replace(/\\/g, '/')}'\n`;
    }
    fs.writeFileSync(concatListFile, concatListStr);

    const mergedVisualsPath = path.join(workDir, 'merged_visuals.mp4');
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListFile}" -c copy "${mergedVisualsPath}"`);

    console.log("\n=== STEP 5: Creating Version 1 (Without Background Music) ===");
    const version1Path = path.join(workDir, 'homcom_realtors_without_bgm.mp4');
    execSync(
        `ffmpeg -y -i "${mergedVisualsPath}" -i "${masterAudioWav}" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest "${version1Path}"`
    );
    console.log(`✅ Version 1 Generated: ${version1Path}`);

    console.log("\n=== STEP 6: Creating Version 2 (With Relevant Ambient Background Music) ===");
    const bgmSource = path.join(process.cwd(), 'ambiment_bgm.mp3');
    const version2Path = path.join(workDir, 'homcom_realtors_with_bgm.mp4');

    if (!fs.existsSync(bgmSource)) {
        throw new Error(`Background music not found at ${bgmSource}`);
    }

    // Mix voiceover (loud & clear volume=1.0) with subtle ambient music (volume=0.12) and smooth 3s outro fade
    const fadeStart = Math.max(0, totalAudioDuration - 3);
    const audioFilter = `[1:a]volume=1.0[vocal];[2:a]atrim=0:${totalAudioDuration},volume=0.12,afade=t=out:st=${fadeStart}:d=3[music];[vocal][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`;

    execSync(
        `ffmpeg -y -i "${mergedVisualsPath}" -i "${masterAudioWav}" -i "${bgmSource}" -filter_complex "${audioFilter}" -map 0:v:0 -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${version2Path}"`
    );
    console.log(`✅ Version 2 Generated: ${version2Path}`);

    console.log("\n=== STEP 7: Uploading Both Videos to Cloudflare R2 ===");
    const timestamp = Date.now();
    const r2Key1 = `generated/homcom/homcom_realtors_clean_voiceover_${timestamp}.mp4`;
    const r2Key2 = `generated/homcom/homcom_realtors_with_bgm_${timestamp}.mp4`;

    console.log(`Uploading Version 1 to R2: ${r2Key1}...`);
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key1,
        Body: fs.readFileSync(version1Path),
        ContentType: 'video/mp4'
    }));
    const publicUrl1 = `${R2_PUBLIC_URL}/${r2Key1}`;
    console.log(`Public URL 1: ${publicUrl1}`);

    console.log(`Uploading Version 2 to R2: ${r2Key2}...`);
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key2,
        Body: fs.readFileSync(version2Path),
        ContentType: 'video/mp4'
    }));
    const publicUrl2 = `${R2_PUBLIC_URL}/${r2Key2}`;
    console.log(`Public URL 2: ${publicUrl2}`);

    // Generate thumbnail from first second of video
    const thumbnailPath = path.join(workDir, `thumbnail_${timestamp}.jpg`);
    execSync(`ffmpeg -y -ss 00:00:02 -i "${version2Path}" -vframes 1 -q:v 2 "${thumbnailPath}"`);
    const thumbR2Key = `generated/homcom/thumbnail_${timestamp}.jpg`;
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: thumbR2Key,
        Body: fs.readFileSync(thumbnailPath),
        ContentType: 'image/jpeg'
    }));
    const thumbUrl = `${R2_PUBLIC_URL}/${thumbR2Key}`;
    console.log(`Thumbnail URL: ${thumbUrl}`);

    console.log("\n=== STEP 8: Inserting Video Assets into Supabase Database ===");
    const targetAccounts = [HOMCOM_PARENT_ID, HOMCOM_AGENT_ID];

    for (const userId of targetAccounts) {
        // Asset 1: Clean Voiceover (No BGM)
        const assetId1 = crypto.randomUUID();
        const { error: err1 } = await supabase.from('assets').insert({
            id: assetId1,
            user_id: userId,
            property_id: null,
            type: 'video',
            status: 'Ready',
            url: publicUrl1,
            caption: scriptText,
            metadata: {
                title: "Homcom Realtors – Commercial Promo (Indian English Voiceover, Clean No BGM)",
                duration: totalAudioDuration,
                scenes: 5,
                engine: "Grok Imagine 1.5 + Gemini 3.1 Flash TTS",
                voice: "Aoede (Indian English)",
                bgm: false,
                aspectRatio: "9:16",
                resolution: "1080x1920",
                thumbnail_url: thumbUrl
            },
            created_at: new Date().toISOString()
        });
        if (err1) console.error(`Error inserting asset 1 for ${userId}:`, err1);
        else console.log(`Inserted Clean Video Asset ${assetId1} for user ${userId}`);

        // Asset 2: With BGM
        const assetId2 = crypto.randomUUID();
        const { error: err2 } = await supabase.from('assets').insert({
            id: assetId2,
            user_id: userId,
            property_id: null,
            type: 'video',
            status: 'Ready',
            url: publicUrl2,
            caption: scriptText,
            metadata: {
                title: "Homcom Realtors – Commercial Promo (Indian English Voiceover + Luxury Ambient BGM)",
                duration: totalAudioDuration,
                scenes: 5,
                engine: "Grok Imagine 1.5 + Gemini 3.1 Flash TTS",
                voice: "Aoede (Indian English)",
                bgm: true,
                aspectRatio: "9:16",
                resolution: "1080x1920",
                thumbnail_url: thumbUrl
            },
            created_at: new Date().toISOString()
        });
        if (err2) console.error(`Error inserting asset 2 for ${userId}:`, err2);
        else console.log(`Inserted BGM Video Asset ${assetId2} for user ${userId}`);
    }

    console.log("\n===============================================================================");
    console.log("🎉 ALL DONE! SUCCESS!");
    console.log(`Version 1 (Clean Voiceover): ${publicUrl1}`);
    console.log(`Version 2 (With Background Music): ${publicUrl2}`);
    console.log(`Thumbnail: ${thumbUrl}`);
    console.log("Both video assets are now live in Homcom Realtors Assets Dashboard!");
    console.log("===============================================================================");
}

main().catch(err => {
    console.error("Pipeline Failed:", err);
    process.exit(1);
});
