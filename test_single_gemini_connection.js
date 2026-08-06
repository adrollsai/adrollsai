const ws = require('ws');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

function testSetupPayload(payload, label) {
  return new Promise((resolve) => {
    console.log(`\nTesting payload [${label}]...`);
    const socket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`);

    socket.on('open', () => {
      console.log(`[OPEN ${label}] Sending...`);
      socket.send(JSON.stringify(payload));
    });

    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`✅ [SUCCESS ${label}]:`, JSON.stringify(msg));
      socket.close();
      resolve(true);
    });

    socket.on('close', (code, reason) => {
      console.log(`❌ [CLOSE ${label}]: code=${code}, reason=${reason.toString()}`);
      resolve(false);
    });
  });
}

async function run() {
  await testSetupPayload({
    setup: {
      model: "models/gemini-2.0-flash-exp",
      generationConfig: {
        responseModalities: ["AUDIO", "TEXT"]
      }
    }
  }, "Basic 2.0-flash-exp");

  await testSetupPayload({
    setup: {
      model: "models/gemini-2.0-flash-exp",
      generationConfig: {
        responseModalities: ["AUDIO"]
      }
    }
  }, "Audio Only 2.0-flash-exp");
}

run();
