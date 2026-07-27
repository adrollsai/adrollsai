const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const kieApiKey = env.KIE_API_KEY;

async function main() {
    const text = "Are you tired of paying endless rent and want the pride of owning your own luxury home in Mohali? Introducing Sukh Valley by GNR HOMES, a premium pre-launch gated society project. Gorgeous 2 BHK flats featuring a beautiful 3D geometric backlit accent wall, premium marble flooring, and cozy bedrooms with elegant wood paneling. Gated society on 40ft road with 24/7 power and water, market at walking distance, and easy bank loan facilities. Prices starting from 53.90 Lacs onwards. Call or WhatsApp GNR HOMES at 7719430097 or 7087023926 for booking and exclusive deals!";

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
                text: text
            }],
            temperature: 1,
            scene: "Professional Indian real estate commercial voiceover studio",
            sample_context: "High converting luxury real estate marketing video"
        }
    };

    console.log("Sending TTS payload to Kie.ai...");
    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${kieApiKey}` },
        body: JSON.stringify(payload)
    });

    const json = await res.json();
    console.log("Kie Response:", JSON.stringify(json, null, 2));
    const taskId = json.data?.taskId;

    if (taskId) {
        console.log("Polling task", taskId);
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const statusRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                headers: { 'Authorization': `Bearer ${kieApiKey}` }
            });
            const statusJson = await statusRes.json();
            console.log(`Poll ${i + 1} State:`, statusJson.data?.state);
            if (statusJson.data?.state === 'success') {
                console.log("Result JSON:", statusJson.data.resultJson);
                break;
            }
        }
    }
}

main().catch(console.error);
