const { generateText } = require('ai');
const { google } = require('@ai-sdk/google');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

async function testGemini() {
  try {
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      prompt: 'Write a 1-line slogan for real estate'
    });
    console.log("Gemini 2.5 Flash Result:", text);
  } catch (err) {
    console.error("Gemini 2.5 Flash Error:", err);
  }

  try {
    const { text } = await generateText({
      model: google('gemini-2.0-flash'),
      prompt: 'Write a 1-line slogan for real estate'
    });
    console.log("Gemini 2.0 Flash Result:", text);
  } catch (err) {
    console.error("Gemini 2.0 Flash Error:", err);
  }
}

testGemini();
