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

// Uploaded Avatar in Homcom Account
const AVATAR_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/1792386143538-avatar-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1792386143076.jpg';

// 9:16 Reference B-roll Images from Homcom Inventory
const grokImages = JSON.parse(fs.readFileSync('homcom_grok_images.json', 'utf8'));

const fullScriptText = `🎬 HOMCOM REALTORS – YOUR SEARCH FOR THE RIGHT PROPERTY ENDS HERE!

Looking to buy or invest in real estate in the Tricity — with a budget starting from ₹1.5 Crore and onwards?

Whether you’re looking for a luxury apartment, a premium residential plot, an investment opportunity in LOI-based projects, or high-potential residential and commercial properties — finding the right opportunity can be challenging.

But now, your search is over!

Welcome to Homcom Realtors — your trusted real estate advisors, backed by extensive market experience and a wide inventory of carefully shortlisted property options.

Our experienced professionals understand your requirements, your investment goals, and your expectations — helping you explore the right opportunities that match your needs.

From premium homes to strategic investments and commercial properties, we bring you the right choices, expert guidance, and a more confident way to invest in real estate.

Stop searching endlessly. Start investing wisely!

Connect with Homcom Realtors today and discover the property opportunities that are right for you.

Homcom Realtors — Your Trusted Partners in Premium Real Estate.`;

const avatarScenes = [
    {
        sceneId: 1,
        title: "Hook - Tricity Luxury Apartments",
        brollUrl: grokImages[0], // Luxury Apartment Exterior
        dialogue: "Looking to buy or invest in real estate in the Tricity, with a budget starting from 1.5 Crore and onwards?",
        prompt: `The presenter shown in Image 1 is the main character and is actively speaking from the very first frame at second 0.0 with natural fluid hand gestures, warm confident smile, and authentic facial micro-expressions directly to the camera in a modern luxury architectural interior. She speaks in an authentic, warm, charismatic Indian English voice with natural conversational cadence, rich vocal tone, and flawless lip synchronization saying: "Looking to buy or invest in real estate in the Tricity, with a budget starting from 1.5 Crore and onwards?". The camera cuts smoothly to showcase the luxury high-rise property B-roll from Image 2 while her authentic voice continues speaking. Photorealistic live-action documentary commercial, 35mm lens, natural daylight, perfectly synchronized lip movements, crisp audible voice. Absolutely NO static freeze, NO robotic stiffness, NO text, NO subtitles.`
    },
    {
        sceneId: 2,
        title: "Options - Luxury Plots & Kothis",
        brollUrl: grokImages[1], // Luxury Villa Kothi / Plot
        dialogue: "Whether you’re looking for a luxury apartment, a premium residential plot, an investment opportunity in LOI-based projects, or high-potential residential and commercial properties, finding the right opportunity can be challenging.",
        prompt: `The presenter shown in Image 1 is the main character and is actively speaking from the very first frame at second 0.0 with natural expressive hand gestures, warm engaging smile, and relaxed fluid posture. Speaking directly to the camera in a warm, polished Indian English voice with lively conversational cadence and perfect lip sync saying: "Whether you’re looking for a luxury apartment, a premium residential plot, an investment opportunity in LOI-based projects, or high-potential residential and commercial properties, finding the right opportunity can be challenging.". The camera transitions seamlessly to showcase the prestigious modern duplex Kothi villa and residential plot B-roll from Image 2 while her natural speech flows smoothly without interruption. 35mm cinematography, natural soft lighting, photorealistic live-action, crisp audio. Absolutely NO static freeze, NO robotic stiffness, NO text, NO subtitles.`
    },
    {
        sceneId: 3,
        title: "Welcome to Homcom Realtors",
        brollUrl: grokImages[2], // Luxury Interior
        dialogue: "But now, your search is over! Welcome to Homcom Realtors, your trusted real estate advisors, backed by extensive market experience and a wide inventory of carefully shortlisted property options.",
        prompt: `The presenter shown in Image 1 is the main character, welcoming the viewer warmly from second 0.0 with an open, friendly hand gesture and charming confident smile. Speaking in a clear, persuasive Indian English voice with natural vocal inflections and synced lips saying: "But now, your search is over! Welcome to Homcom Realtors, your trusted real estate advisors, backed by extensive market experience and a wide inventory of carefully shortlisted property options.". The shot cuts gracefully to reveal the stunning high-ceiling luxury apartment master interior from Image 2 while her voice continues seamlessly. Photorealistic commercial quality, authentic skin texture, natural room acoustics, crisp voice. Absolutely NO static freeze, NO robotic stiffness, NO text, NO subtitles.`
    },
    {
        sceneId: 4,
        title: "Expertise & Strategic Investments",
        brollUrl: grokImages[3], // Commercial Avenue
        dialogue: "Our experienced professionals understand your requirements, your investment goals, and your expectations, helping you explore the right opportunities that match your needs. From premium homes to strategic investments and commercial properties, we bring you the right choices, expert guidance, and a more confident way to invest in real estate.",
        prompt: `The presenter shown in Image 1 is the main character, speaking with professional authority and natural animated hand gestures. In an authentic, articulate Indian English voice with natural conversational cadence and perfect lip synchronization, she delivers: "Our experienced professionals understand your requirements, your investment goals, and your expectations, helping you explore the right opportunities that match your needs. From premium homes to strategic investments and commercial properties, we bring you the right choices, expert guidance, and a more confident way to invest in real estate.". The visual cuts smoothly to the prestigious commercial glass boulevard B-roll from Image 2 while her voiceover continues without dead air. 35mm lens, rich architectural details, live-action realism, clear natural speech. Absolutely NO static freeze, NO robotic stiffness, NO text, NO subtitles.`
    },
    {
        sceneId: 5,
        title: "Call to Action & Outro",
        brollUrl: grokImages[4], // Homcom Skyline / Consultation
        dialogue: "Stop searching endlessly. Start investing wisely! Connect with Homcom Realtors today and discover the property opportunities that are right for you. Homcom Realtors — Your Trusted Partners in Premium Real Estate.",
        prompt: `The presenter shown in Image 1 is the main character in an executive penthouse setting overlooking the Tricity skyline at sunset. From second 0.0, she speaks warmly and invitingly with natural expressive hand gestures and an authentic, friendly smile directly to the viewer in a natural Indian English voice with perfect lip sync saying: "Stop searching endlessly. Start investing wisely! Connect with Homcom Realtors today and discover the property opportunities that are right for you. Homcom Realtors — Your Trusted Partners in Premium Real Estate.". Dynamic camera glide with warm sunset ambient lighting, photorealistic live-action commercial, crystal clear vocal delivery. Absolutely NO static freeze, NO robotic stiffness, NO text, NO subtitles.`
    }
];

async function createGrokAvatarTask(scene) {
    const payload = {
        model: "grok-imagine-video-1-5-preview",
        input: {
            prompt: scene.prompt,
            image_urls: [AVATAR_URL, scene.brollUrl],
            aspect_ratio: "9:16",
            duration: 15,
            resolution: "480p",
            nsfw_checker: true
        }
    };

    console.log(`[Avatar Grok] Dispatching Scene ${scene.sceneId} (${scene.title})...`);
    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${kieApiKey}` },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    const taskId = json.data?.taskId;
    if (!taskId) throw new Error(`Scene ${scene.sceneId} task creation error: ${JSON.stringify(json)}`);
    console.log(`[Avatar Grok] Scene ${scene.sceneId} Task ID: ${taskId}`);
    return { ...scene, taskId };
}

async function pollGrokAvatarTask(scene) {
    for (let p = 0; p < 65; p++) {
        await new Promise(r => setTimeout(r, 4000));
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${scene.taskId}`, {
            headers: { "Authorization": `Bearer ${kieApiKey}` }
        });
        const json = await res.json();
        const state = json.data?.state;
        if (state === 'success' && json.data?.resultJson) {
            const parsed = JSON.parse(json.data.resultJson);
            const videoUrl = parsed.resultUrls?.[0] || parsed.url;
            console.log(`[Avatar Grok] Scene ${scene.sceneId} SUCCESS! Video URL: ${videoUrl}`);
            return { ...scene, videoUrl };
        } else if (state === 'fail') {
            throw new Error(`Scene ${scene.sceneId} failed: ${json.data?.failMsg}`);
        }
        if ((p + 1) % 5 === 0) {
            console.log(`[Avatar Grok] Scene ${scene.sceneId} still processing (poll ${p + 1}/65)...`);
        }
    }
    throw new Error(`Scene ${scene.sceneId} timed out.`);
}

async function main() {
    console.log("===============================================================================");
    console.log("🌟 HOMCOM REALTORS AVATAR VIDEO PRODUCTION (NATIVE VOICE + RELEVANT B-ROLL)");
    console.log("===============================================================================\n");

    const workDir = path.join(process.cwd(), 'temp_homcom_avatar');
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    console.log("=== STEP 1: Launching 5 Grok Avatar Tasks in Parallel ===");
    console.log(`Using Profile Model Avatar: ${AVATAR_URL}\n`);
    const launched = [];
    for (const sc of avatarScenes) {
        const item = await createGrokAvatarTask(sc);
        launched.push(item);
    }

    console.log("\n=== STEP 2: Polling for all 5 Grok Avatar Scenes Completion ===");
    const completed = await Promise.all(launched.map(t => pollGrokAvatarTask(t)));

    console.log("\n=== STEP 3: Downloading and Normalizing Avatar Clips with Native Spoken Audio ===");
    const normalizedClips = [];

    for (let i = 0; i < completed.length; i++) {
        const sc = completed[i];
        const rawPath = path.join(workDir, `raw_avatar_scene_${sc.sceneId}.mp4`);
        const normPath = path.join(workDir, `norm_avatar_scene_${sc.sceneId}.mp4`);

        console.log(`Downloading Scene ${sc.sceneId}...`);
        const vRes = await fetch(sc.videoUrl);
        fs.writeFileSync(rawPath, Buffer.from(await vRes.arrayBuffer()));

        // Scale to 1080x1920 (9:16), 30fps, normalize audio to aac 48kHz stereo, keep native spoken voice!
        console.log(`Normalizing Scene ${sc.sceneId} (scaling to 1080x1920 30fps + high quality audio)...`);
        execSync(
            `ffmpeg -y -i "${rawPath}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k -ar 48000 -ac 2 "${normPath}"`
        );
        normalizedClips.push(normPath);
    }

    console.log("\n=== STEP 4: Concatenating 5 Avatar Clips into Master Seamless Video ===");
    const concatListFile = path.join(workDir, 'avatar_concat_list.txt');
    let concatListStr = "";
    for (const clip of normalizedClips) {
        concatListStr += `file '${clip.replace(/\\/g, '/')}'\n`;
    }
    fs.writeFileSync(concatListFile, concatListStr);

    const version1Path = path.join(workDir, 'homcom_realtors_avatar_without_bgm.mp4');
    // Version 1: Concatenated Avatar Clips with Native Voice (No BGM, zero separate voiceover!)
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListFile}" -c copy "${version1Path}"`);
    console.log(`✅ Version 1 Generated (Avatar Native Spoken Voice, No BGM): ${version1Path}`);

    const totalVideoDuration = parseFloat(
        execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${version1Path}"`).toString().trim()
    );
    console.log(`Total Master Avatar Video Duration: ${totalVideoDuration.toFixed(2)}s`);

    console.log("\n=== STEP 5: Creating Version 2 (Avatar Native Spoken Voice + Added Relevant Luxury BGM) ===");
    const bgmSource = path.join(process.cwd(), 'ambiment_bgm.mp3');
    const version2Path = path.join(workDir, 'homcom_realtors_avatar_with_bgm.mp4');

    if (!fs.existsSync(bgmSource)) {
        throw new Error(`Background music not found at ${bgmSource}`);
    }

    // Mix avatar native spoken audio (volume=1.0) with subtle ambient luxury music (volume=0.10) and smooth 3s outro fade
    const fadeStart = Math.max(0, totalVideoDuration - 3);
    const audioFilter = `[0:a]volume=1.0[vocal];[1:a]atrim=0:${totalVideoDuration},volume=0.10,afade=t=out:st=${fadeStart}:d=3[music];[vocal][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`;

    execSync(
        `ffmpeg -y -i "${version1Path}" -i "${bgmSource}" -filter_complex "${audioFilter}" -map 0:v:0 -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${version2Path}"`
    );
    console.log(`✅ Version 2 Generated (Avatar Native Spoken Voice + Luxury BGM): ${version2Path}`);

    console.log("\n=== STEP 6: Uploading Both Videos to Cloudflare R2 ===");
    const timestamp = Date.now();
    const r2Key1 = `generated/homcom/homcom_realtors_avatar_clean_${timestamp}.mp4`;
    const r2Key2 = `generated/homcom/homcom_realtors_avatar_with_bgm_${timestamp}.mp4`;

    console.log(`Uploading Version 1 (Avatar Native Audio, Clean) to R2...`);
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key1,
        Body: fs.readFileSync(version1Path),
        ContentType: 'video/mp4'
    }));
    const publicUrl1 = `${R2_PUBLIC_URL}/${r2Key1}`;
    console.log(`Public URL 1: ${publicUrl1}`);

    console.log(`Uploading Version 2 (Avatar Native Audio + BGM) to R2...`);
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key2,
        Body: fs.readFileSync(version2Path),
        ContentType: 'video/mp4'
    }));
    const publicUrl2 = `${R2_PUBLIC_URL}/${r2Key2}`;
    console.log(`Public URL 2: ${publicUrl2}`);

    // Generate high quality thumbnail
    const thumbnailPath = path.join(workDir, `avatar_thumbnail_${timestamp}.jpg`);
    execSync(`ffmpeg -y -ss 00:00:02 -i "${version2Path}" -vframes 1 -q:v 2 "${thumbnailPath}"`);
    const thumbR2Key = `generated/homcom/avatar_thumbnail_${timestamp}.jpg`;
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: thumbR2Key,
        Body: fs.readFileSync(thumbnailPath),
        ContentType: 'image/jpeg'
    }));
    const thumbUrl = `${R2_PUBLIC_URL}/${thumbR2Key}`;
    console.log(`Thumbnail URL: ${thumbUrl}`);

    console.log("\n=== STEP 7: Inserting Avatar Video Assets into Supabase Database ===");
    const targetAccounts = [HOMCOM_PARENT_ID, HOMCOM_AGENT_ID];

    for (const userId of targetAccounts) {
        // Asset 1: Clean Avatar Native Spoken Voice (No BGM)
        const assetId1 = crypto.randomUUID();
        const { error: err1 } = await supabase.from('assets').insert({
            id: assetId1,
            user_id: userId,
            property_id: null,
            type: 'video',
            status: 'Ready',
            url: publicUrl1,
            caption: fullScriptText,
            metadata: {
                title: "Homcom Realtors – Model Avatar Commercial (Native Spoken Delivery, Clean No BGM)",
                duration: totalVideoDuration,
                scenes: 5,
                engine: "Grok Imagine 1.5 Video",
                presenter: "Homcom Profile Model Avatar",
                voiceType: "Native Model Speech (No Separate TTS)",
                bgm: false,
                aspectRatio: "9:16",
                resolution: "1080x1920",
                thumbnail_url: thumbUrl
            },
            created_at: new Date().toISOString()
        });
        if (err1) console.error(`Error inserting asset 1 for ${userId}:`, err1);
        else console.log(`Inserted Clean Avatar Video Asset ${assetId1} for user ${userId}`);

        // Asset 2: With BGM
        const assetId2 = crypto.randomUUID();
        const { error: err2 } = await supabase.from('assets').insert({
            id: assetId2,
            user_id: userId,
            property_id: null,
            type: 'video',
            status: 'Ready',
            url: publicUrl2,
            caption: fullScriptText,
            metadata: {
                title: "Homcom Realtors – Model Avatar Commercial (Native Spoken Delivery + Luxury Ambient BGM)",
                duration: totalVideoDuration,
                scenes: 5,
                engine: "Grok Imagine 1.5 Video",
                presenter: "Homcom Profile Model Avatar",
                voiceType: "Native Model Speech (No Separate TTS)",
                bgm: true,
                aspectRatio: "9:16",
                resolution: "1080x1920",
                thumbnail_url: thumbUrl
            },
            created_at: new Date().toISOString()
        });
        if (err2) console.error(`Error inserting asset 2 for ${userId}:`, err2);
        else console.log(`Inserted BGM Avatar Video Asset ${assetId2} for user ${userId}`);
    }

    console.log("\n===============================================================================");
    console.log("🎉 ALL DONE! MODEL AVATAR COMMERCIALS READY!");
    console.log(`Version 1 (Native Spoken Voice, Clean No BGM): ${publicUrl1}`);
    console.log(`Version 2 (Native Spoken Voice + Luxury BGM): ${publicUrl2}`);
    console.log(`Thumbnail: ${thumbUrl}`);
    console.log("Both model avatar videos are live in Homcom Realtors Assets Dashboard!");
    console.log("===============================================================================");
}

main().catch(err => {
    console.error("Pipeline Failed:", err);
    process.exit(1);
});
