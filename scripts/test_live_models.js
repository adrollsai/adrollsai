const ws = require('ws');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const key = process.env.GEMINI_API_KEY;

const models = [
  'models/gemini-2.0-flash-realtime-exp',
  'models/gemini-2.0-flash',
  'models/gemini-2.5-flash',
  'models/gemini-3.1-flash-live-preview'
];

async function testModel(model) {
  return new Promise((resolve) => {
    const socket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`);
    socket.on('open', () => {
      socket.send(JSON.stringify({
        setup: {
          model: model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
          }
        }
      }));
    });
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.setupComplete) {
        console.log('✅ Model works:', model);
        socket.close();
        resolve(true);
      }
    });
    socket.on('close', (code, reason) => {
      console.log('❌ Model failed:', model, 'Code:', code, 'Reason:', reason.toString());
      resolve(false);
    });
    socket.on('error', (err) => {
      console.log('❌ Model error:', model, err.message);
      resolve(false);
    });
  });
}

(async () => {
  for (const m of models) {
    await testModel(m);
  }
})();
