const { generateText } = require('ai');
const { google } = require('@ai-sdk/google');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function testAttachmentsSyntax() {
  const dummyBuffer = Buffer.from('fake video bytes');

  // Test 1: experimental_attachments
  try {
    console.log("Test 1: experimental_attachments...");
    await generateText({
      model: google('gemini-2.5-flash'),
      messages: [{
        role: 'user',
        content: 'Analyze this video and generate copy.',
        experimental_attachments: [
          {
            name: 'video.mp4',
            contentType: 'video/mp4',
            url: `data:video/mp4;base64,${dummyBuffer.toString('base64')}`
          }
        ]
      }]
    });
    console.log("Test 1 SUCCESS!");
  } catch (e) {
    console.log("Test 1 Error:", e.message);
  }

  // Test 2: experimental_attachments with HTTP URL
  try {
    console.log("Test 2: experimental_attachments with HTTP URL...");
    await generateText({
      model: google('gemini-2.5-flash'),
      messages: [{
        role: 'user',
        content: 'Analyze this video and generate copy.',
        experimental_attachments: [
          {
            name: 'video.mp4',
            contentType: 'video/mp4',
            url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov'
          }
        ]
      }]
    });
    console.log("Test 2 SUCCESS!");
  } catch (e) {
    console.log("Test 2 Error:", e.message);
  }

  // Test 3: type: 'file' with data: Buffer / ArrayBuffer
  try {
    console.log("Test 3: type: 'file' with data: ArrayBuffer...");
    await generateText({
      model: google('gemini-2.5-flash'),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'file', data: dummyBuffer.buffer, mimeType: 'video/mp4' }
        ]
      }]
    });
    console.log("Test 3 SUCCESS!");
  } catch (e) {
    console.log("Test 3 Error:", e.message);
  }
}

testAttachmentsSyntax();
