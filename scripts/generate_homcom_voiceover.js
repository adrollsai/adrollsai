const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { execSync } = require('child_process');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const kieApiKey = env.KIE_API_KEY;

const segments = [
    {
        id: 1,
        text: "Looking to buy or invest in real estate in the Tricity — with a budget starting from 1.5 Crore and onwards?"
    },
    {
        id: 2,
        text: "Whether you’re looking for a luxury apartment, a premium residential plot, an investment opportunity in LOI-based projects, or high-potential residential and commercial properties — finding the right opportunity can be challenging."
    },
    {
        id: 3,
        text: "But now, your search is over! Welcome to Homcom Realtors — your trusted real estate advisors, backed by extensive market experience and a wide inventory of carefully shortlisted property options."
    },
    {
        id: 4,
        text: "Our experienced professionals understand your requirements, your investment goals, and your expectations — helping you explore the right opportunities that match your needs. From premium homes to strategic investments and commercial properties, we bring you the right choices, expert guidance, and a more confident way to invest in real estate."
    },
    {
        id: 5,
        text: "Stop searching endlessly. Start investing wisely! Connect with Homcom Realtors today and discover the property opportunities that are right for you. Homcom Realtors — Your Trusted Partners in Premium Real Estate."
    }
];

async function generateSegmentTTS(segment) {
    const payload = {
        model: "google/gemini-3-1-flash-tts",
        input: {
            speakers: [{
                speaker_id: "Speaker 1",
                voice_name: "Aoede",
                audio_profile: "",
                style: "",
                pace: "Natural",
                accent: "Neutral"
            }],
            dialogue_turns: [{
                speaker_id: "Speaker 1",
                text: segment.text
            }],
            temperature: 1,
            scene: "A confident, polished Indian voiceover artist speaking fluent Indian English in a professional recording studio. Warm, clear, enthusiastic, natural Indian vocal cadence, and convincing tone for a high-converting commercial.",
            sample_context: "High converting luxury marketing video commercial with natural Indian English delivery"
        }
    };

    console.log(`[TTS] Dispatching Segment ${segment.id}...`);
    const createRes = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${kieApiKey}` },
        body: JSON.stringify(payload)
    });
    const createJson = await createRes.json();
    const taskId = createJson.data?.taskId;
    if (!taskId) throw new Error(`Failed to create task for Segment ${segment.id}: ${JSON.stringify(createJson)}`);
    console.log(`[TTS] Segment ${segment.id} Task ID: ${taskId}`);

    for (let p = 0; p < 25; p++) {
        await new Promise(r => setTimeout(r, 2500));
        const statusRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            headers: { "Authorization": `Bearer ${kieApiKey}` }
        });
        const statusJson = await statusRes.json();
        const state = statusJson.data?.state;
        if (state === 'success' && statusJson.data?.resultJson) {
            const parsed = JSON.parse(statusJson.data.resultJson);
            const audioUrl = parsed.resultUrls?.[0] || parsed.url;
            console.log(`[TTS] Segment ${segment.id} SUCCESS -> ${audioUrl}`);
            return { id: segment.id, url: audioUrl };
        } else if (state === 'fail') {
            throw new Error(`Segment ${segment.id} failed: ${statusJson.data?.failMsg}`);
        }
    }
    throw new Error(`Segment ${segment.id} timed out.`);
}

async function main() {
    console.log("=== STEP 1: Generating 5 Voiceover Segments with Gemini 3.1 Flash TTS ===");
    const workDir = path.join(process.cwd(), 'temp_homcom_audio');
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const results = [];
    // Generate sequentially to guarantee pristine quality
    for (const seg of segments) {
        const res = await generateSegmentTTS(seg);
        results.push(res);
    }

    console.log("\n=== STEP 2: Downloading and measuring audio files ===");
    const audioFiles = [];
    for (const res of results) {
        const audioBuf = Buffer.from(await (await fetch(res.url)).arrayBuffer());
        const filePath = path.join(workDir, `segment_${res.id}.wav`);
        fs.writeFileSync(filePath, audioBuf);
        audioFiles.push(filePath);

        // Get duration using ffprobe
        const probeOut = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
        console.log(`Segment ${res.id} duration: ${probeOut}s -> ${filePath}`);
    }

    // Build FFmpeg concat list with subtle 0.3s pause between segments
    const concatTxtPath = path.join(workDir, 'concat_list.txt');
    let concatContent = "";
    for (const f of audioFiles) {
        concatContent += `file '${f.replace(/\\/g, '/')}'\n`;
    }
    fs.writeFileSync(concatTxtPath, concatContent);

    const masterWav = path.join(workDir, 'homcom_voiceover_master.wav');
    const masterMp3 = path.join(workDir, 'homcom_voiceover_master.mp3');

    console.log("\n=== STEP 3: Concatenating into Master Voiceover File ===");
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatTxtPath}" -c:a pcm_s16le "${masterWav}"`);
    execSync(`ffmpeg -y -i "${masterWav}" -b:a 192k "${masterMp3}"`);

    const totalDur = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${masterWav}"`).toString().trim();
    console.log(`\n✅ Master Voiceover Generated! Total Duration: ${totalDur}s`);
    console.log(`Master Audio: ${masterWav}`);
    console.log(`Master MP3: ${masterMp3}`);
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
