const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

async function testTranscription() {
  const assetId = 'e1f82e62-0117-4699-95b7-f41bfc1ec93d';
  const { data: asset } = await supabaseAdmin.from('assets').select('*').eq('id', assetId).single();

  const audioUrl = asset.metadata?.audioUrl || asset.url;
  console.log(`Testing Gemini Transcription with URL: ${audioUrl}`);

  const fs = require('fs');
  const os = require('os');
  const isAudio = audioUrl.includes('.mp3') || audioUrl.includes('voiceover');
  const ext = isAudio ? 'mp3' : 'mp4';
  const mimeType = isAudio ? 'audio/mp3' : 'video/mp4';

  const res = await fetch(audioUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tempPath = path.join(os.tmpdir(), `temp_media_${Date.now()}.${ext}`);
  fs.writeFileSync(tempPath, buffer);

  console.log(`Uploaded media to temp path (${buffer.length} bytes). Sending to Gemini FileManager...`);

  const uploadResponse = await fileManager.uploadFile(tempPath, {
    mimeType: mimeType,
    displayName: "Media for Transcription"
  });

  let file = await fileManager.getFile(uploadResponse.file.name);
  while (file.state === "PROCESSING") {
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 1000));
    file = await fileManager.getFile(uploadResponse.file.name);
  }

  console.log(`\nGemini File State: ${file.state}`);

  if (file.state === "SUCCEEDED" || file.state === "ACTIVE") {
    console.log("Generating Content with Gemini 3.5 Flash...");
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
    const result = await model.generateContent([
      { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
      { text: "Generate a precise transcript of this audio. For every segment of speech, provide start time, end time, and text in JSON format: { segments: [{ start: number, end: number, text: string }] }" }
    ]);

    console.log("🎉 Transcript Output:\n", result.response.text());
  }

  fs.unlinkSync(tempPath);
  await fileManager.deleteFile(file.name);
}

testTranscription();
