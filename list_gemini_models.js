const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

async function listModels() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  console.log(`Checking available Gemini models for API key ending with ...${apiKey.slice(-6)}`);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  if (data.models) {
    console.log("Available Gemini Models:\n", data.models.map(m => m.name));
  } else {
    console.error("Failed to list models:", data);
  }
}

listModels();
