const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
console.log("Using API Key:", apiKey ? apiKey.substring(0, 10) + "..." : "undefined");

const genAI = new GoogleGenerativeAI(apiKey);

async function run() {
    console.log("Listing available models from Gemini API...");
    // Unfortunately genAI.listModels() isn't directly exposed on GoogleGenerativeAI without importing client, but we can do a request.
    // Or we can just test calling gemini-3-flash-preview directly and see what error it returns!
    try {
        console.log("Testing call to gemini-3-flash-preview...");
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const result = await model.generateContent("Say hello!");
        console.log("Result (gemini-3-flash-preview):", result.response.text());
    } catch (e) {
        console.error("Failed calling gemini-3-flash-preview:", e.message);
    }

    try {
        console.log("Testing call to gemini-1.5-flash...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Say hello!");
        console.log("Result (gemini-1.5-flash):", result.response.text());
    } catch (e) {
        console.error("Failed calling gemini-1.5-flash:", e.message);
    }
    
    try {
        console.log("Testing call to gemini-2.5-flash...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent("Say hello!");
        console.log("Result (gemini-2.5-flash):", result.response.text());
    } catch (e) {
        console.error("Failed calling gemini-2.5-flash:", e.message);
    }
}

run().catch(console.error);
