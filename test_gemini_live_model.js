const ws = require('ws');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const modelsToTest = [
  'models/gemini-2.0-flash-realtime-exp',
  'models/gemini-2.0-flash',
  'models/gemini-2.0-flash-lite-preview-02-05',
  'models/gemini-2.0-flash-live-preview',
  'models/gemini-2.0-flash-thinking-exp',
  'models/gemini-exp-1206'
];

function testModel(modelName) {
  return new Promise((resolve) => {
    console.log(`Testing model: "${modelName}"...`);
    const socket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`);

    let resolved = false;
    socket.on('open', () => {
      socket.send(JSON.stringify({
        setup: {
          model: modelName,
          generationConfig: {
            responseModalities: ["AUDIO"]
          }
        }
      }));
    });

    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`✅ [SUCCESS] Model "${modelName}" returned:`, Object.keys(msg));
      if (!resolved) {
        resolved = true;
        socket.close();
        resolve({ model: modelName, success: true });
      }
    });

    socket.on('close', (code, reason) => {
      if (!resolved) {
        resolved = true;
        console.log(`❌ [FAILED] Model "${modelName}": code=${code}, reason=${reason.toString()}`);
        resolve({ model: modelName, success: false, reason: reason.toString() });
      }
    });
  });
}

async function runTests() {
  for (const m of modelsToTest) {
    await testModel(m);
  }
}

runTests();
