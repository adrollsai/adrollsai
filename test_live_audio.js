const ws = require('ws');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

function testLiveAudio() {
  const modelName = "models/gemini-3.1-flash-live-preview";
  console.log(`Testing audio output for model "${modelName}"...`);
  const socket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`);

  let audioBytesReceived = 0;

  socket.on('open', () => {
    console.log("[OPEN] Connected. Sending setup...");
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
    
    if (msg.setupComplete) {
      console.log("✅ Setup Complete received! Sending initial turn prompt...");
      socket.send(JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: "Hello! Please say Namaste Rahul ji in a warm voice!" }]
            }
          ],
          turnComplete: true
        }
      }));
    }

    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.text) console.log(`[TEXT]: ${part.text}`);
        if (part.inlineData && part.inlineData.data) {
          const len = Buffer.from(part.inlineData.data, 'base64').length;
          audioBytesReceived += len;
          console.log(`🔊 [AUDIO RECEIVED]: ${len} bytes (Total: ${audioBytesReceived} bytes)`);
        }
      }
    }
  });

  socket.on('close', (code, reason) => {
    console.log(`[CLOSE]: code=${code}, reason=${reason.toString()}, totalAudioBytes=${audioBytesReceived}`);
  });

  setTimeout(() => {
    console.log("Finished test, closing socket...");
    socket.close();
  }, 10000);
}

testLiveAudio();
