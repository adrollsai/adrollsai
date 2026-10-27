const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const apiKey = process.env.GEMINI_API_KEY;

async function analyzeAudio(filename) {
  console.log(`Analyzing ${filename}...`);
  const audioData = fs.readFileSync(filename).toString('base64');
  const payload = {
    contents: [{
      parts: [
        { text: 'Analyze this phone call recording carefully and explain in detail: 1. Exactly who speaks in the first 0-10 seconds? Describe each voice: male or female, what exact words they say, their volume, pitch, tone, and clarity. 2. When does another voice speak or take over? What gender is that voice? What do they say? 3. Address this exact listener feedback: "No volume, first female voice spoke in most feeble voice and then male voice started". Based on the actual audio, explain why the listener heard this.' },
        { inline_data: { mime_type: 'audio/mp3', data: audioData } }
      ]
    }]
  };
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  console.log(`\n=== ANALYSIS FOR ${filename} ===\n`);
  console.log(data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data));
}

async function main() {
  await analyzeAudio('test_recording_rajiv.mp3');
  await analyzeAudio('test_recording_raman.mp3');
}

main().catch(console.error);
