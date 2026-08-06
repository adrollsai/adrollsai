const { generateText } = require('ai');
const { google } = require('@ai-sdk/google');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function testRealCaptionGen() {
  console.log("Fetching media for Nobogent video...");
  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov';
  
  const res = await fetch(videoUrl);
  console.log("Video Fetch Status:", res.status);
  
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = 'video/quicktime';
  console.log("Video buffer size:", (buffer.length / (1024 * 1024)).toFixed(2), "MB");

  const prompt = `You are a world-class Direct Response Copywriter. Analyze this video and write high-converting copy for real estate / Nobogent software.
Output ONLY a JSON object with: {"headline": "...", "primary_text": "...", "social_post_description": "..."}`;

  const mediaDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

  console.log("Calling Vercel AI SDK generateText with experimental_attachments...");
  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    messages: [
      {
        role: 'user',
        content: prompt,
        experimental_attachments: [
          {
            name: 'video.mov',
            contentType: mimeType,
            url: mediaDataUrl
          }
        ]
      }
    ]
  });

  console.log("AI GENERATION SUCCESS:\n", text);
}

testRealCaptionGen();
