const { generateText } = require('ai');
const { google } = require('@ai-sdk/google');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function testSchema() {
  const dummyBuffer = Buffer.from('fake video bytes');

  try {
    console.log("Testing generateText with type: 'file' data: buffer...");
    await generateText({
      model: google('gemini-2.5-flash'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'file', data: dummyBuffer, mimeType: 'video/mp4' }
          ]
        }
      ]
    });
    console.log("Success with type: file data: buffer!");
  } catch (err) {
    console.error("Error with type file data buffer:\n", err.message);
  }

  try {
    console.log("\nTesting generateText with Google Generative AI direct / file schema...");
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent([
      "Analyze this media and return json.",
      {
        inlineData: {
          data: dummyBuffer.toString("base64"),
          mimeType: "video/mp4"
        }
      }
    ]);
    console.log("Direct Google SDK Result:", result.response.text());
  } catch (err) {
    console.error("Direct Google SDK Error:", err.message);
  }
}

testSchema();
