const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function run() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
        console.error("No Gemini API key found in env.");
        return;
    }
    console.log("Using API key starting with:", apiKey.substring(0, 8));
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    console.log("Calling Gemini...");
    const result = await model.generateContent("Say hello in a friendly way!");
    console.log("Response:", result.response.text());
}

run().catch(console.error);
