const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

async function listModels() {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    console.log("Supported Models for key:\n");
    (data.models || []).forEach(m => {
      if (m.supportedGenerationMethods?.includes('bidiGenerateContent')) {
        console.log(`⭐ [LIVE WEBSOCKET SUPPORTED]: ${m.name}`);
      } else {
        console.log(`- ${m.name} (${m.supportedGenerationMethods?.join(', ')})`);
      }
    });
  } catch (e) {
    console.error("Error listing models:", e);
  }
}

listModels();
