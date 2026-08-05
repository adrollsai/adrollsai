const ws = require('ws');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const models = [
  'models/gemini-2.0-flash-exp',
  'models/gemini-2.0-flash-001',
  'models/gemini-2.0-flash',
  'models/gemini-2.0-flash-lite-001',
  'models/gemini-2.0-flash-lite',
  'models/gemini-2.5-flash',
  'models/gemini-3.1-flash-live-preview',
  'models/gemini-3.5-flash',
  'models/gemini-2.0-flash-thinking-exp-01-21',
  'models/gemini-2.0-flash-exp-001',
  'models/gemini-2.0-flash-realtime'
];

function testModel(model) {
  return new Promise((resolve) => {
    const socket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`);

    socket.on('open', () => {
      socket.send(JSON.stringify({
        setup: {
          model: model,
          generationConfig: {
            responseModalities: ["AUDIO"]
          }
        }
      }));
    });

    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`🎉🎉🎉 MATCH FOUND! Model "${model}" returned:`, Object.keys(msg));
      socket.close();
      resolve(model);
    });

    socket.on('close', (code, reason) => {
      // console.log(`❌ "${model}": ${reason.toString()}`);
      resolve(null);
    });

    socket.on('error', () => {
      resolve(null);
    });
  });
}

async function run() {
  console.log("Searching for working Gemini Live model...");
  for (const m of models) {
    const res = await testModel(m);
    if (res) {
      console.log(`\nSUCCESS! Working model is: "${res}"`);
      break;
    } else {
      console.log(`- Tried ${m}: Failed`);
    }
  }
}

run();
