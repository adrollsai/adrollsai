const { generateText } = require('ai');
const { google } = require('@ai-sdk/google');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function findWorkingAiSdkSyntax() {
  const dummyBuffer = Buffer.from('fake video bytes');

  // Test 1: data: Uint8Array
  try {
    console.log("Test 1: data: new Uint8Array(dummyBuffer)...");
    await generateText({
      model: google('gemini-2.5-flash'),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'file', data: new Uint8Array(dummyBuffer), mimeType: 'video/mp4' }
        ]
      }]
    });
    console.log("Test 1 SUCCESS!");
  } catch (e) {
    console.log("Test 1 Error:", e.message);
  }

  // Test 2: data: URL object
  try {
    console.log("Test 2: data: URL object...");
    await generateText({
      model: google('gemini-2.5-flash'),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'file', data: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov', mimeType: 'video/mp4' }
        ]
      }]
    });
    console.log("Test 2 SUCCESS!");
  } catch (e) {
    console.log("Test 2 Error:", e.message);
  }

  // Test 3: data: Data URL (base64)
  try {
    console.log("Test 3: data: data:video/mp4;base64,...");
    await generateText({
      model: google('gemini-2.5-flash'),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'file', data: `data:video/mp4;base64,${dummyBuffer.toString('base64')}`, mimeType: 'video/mp4' }
        ]
      }]
    });
    console.log("Test 3 SUCCESS!");
  } catch (e) {
    console.log("Test 3 Error:", e.message);
  }

  // Test 4: Direct Google Gen AI API
  try {
    console.log("Test 4: Google Gen AI SDK @google/genai...");
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY });
    console.log("GoogleGenAI initialized successfully!");
  } catch (e) {
    console.log("Test 4 Error:", e.message);
  }
}

findWorkingAiSdkSyntax();
