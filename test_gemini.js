const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const genAI = new GoogleGenerativeAI(geminiApiKey);

const transcript = [
  { role: 'agent', message: 'Hi Rahul chopra! Main Nobogent se AI booking assistant baat kar raha hoon...' },
  { role: 'user', message: 'Hello, आप कैसे हो?' },
  { role: 'agent', message: 'Main bilkul theek hoon, shukriya! Aap sunayein, kya hum aaj ki 5 baje ki consultation call confirm kar sakte hain?' },
  { role: 'user', message: 'अ, मैं-- हमारी बात इतनी कुछ बढ़ सकती है। अ, हमें कोई specific features के बारे में बताया था। आपको पता है कौन सा feature बताया था मैंने आपको?' },
  { role: 'agent', message: 'Haan Rahul, aapne specifically AI calling feature ke baare mein bataya tha. Humari platform par aap apni marketing ko automate kar sakte hain. Chaliye, aaj shaam ko 5 baje is feature ko...' },
  { role: 'user', message: 'Okay, thank you.' },
  { role: 'agent', message: 'Great! Toh aaj shaam...' },
  { role: 'user', message: 'और, और मैंने आप-- मैंने अपना, अ, WhatsApp पे nickname क्या बताया था मैंने अपना?' },
  { role: 'agent', message: 'Aapne WhatsApp par apna nickname "Manu" bataya tha.' },
  { role: 'user', message: 'हम्म, ठीक है। Okay, bye.' },
  { role: 'agent', message: 'Okay Rahul, no problem. Main aapko 5 baje call karunga. Have a great day!' },
  { role: 'user', message: 'Thank you.' },
  { role: 'agent', message: 'You\'re welcome Rahul. Main aapko 5 baje call karunga. Have a great day!' }
];

async function run() {
  const formattedTranscript = transcript
    .map(t => `${t.role === 'agent' ? 'Agent' : 'Lead'}: ${t.message}`)
    .join('\n');

  const systemTime = new Date('2026-07-08T06:23:00.000Z'); // ISO UTC time during last call

  const geminiPrompt = `
You are analyzing a phone call transcript between an AI voice agent and a lead.
Here is the transcript:
${formattedTranscript}

Extract the following details as a valid JSON object ONLY. Do not use markdown tags, ticks, or backticks:
{
  "summary": "A clear, concise paragraph summary of the call",
  "callback_time": "ISO-8601 string of requested callback date/time if the lead explicitly asked to be called back at a specific time, otherwise null. Current system UTC time is: ${systemTime.toISOString()}",
  "booking_time": "ISO-8601 string of the agreed appointment/meeting slot if the lead explicitly agreed to book an appointment/consultation/meeting at a specific time, otherwise null. Current system UTC time is: ${systemTime.toISOString()}",
  "is_qualified": true/false (true if the lead confirmed interest, answered questions, agreed to a callback, or is qualified)
}
`;

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(geminiPrompt);
  const text = result.response.text();
  console.log('Gemini JSON output:\n', text);
}

run().catch(console.error);
