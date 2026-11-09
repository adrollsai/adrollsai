/**
 * Proves the vision path end to end: an image part sent through the SAME
 * provider the agent uses (`createOpenAI` → api.deepseek.com) and the same
 * model (`deepseek-flash`).
 *
 * It generates a solid, unmistakable image in memory and asks the model what it
 * shows. A correct answer means images really are analysed; a failure here means
 * the agent is blind no matter what the UI claims.
 *
 * Run: node scripts/verify-vision.mjs
 */
import fs from 'node:fs';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import sharp from 'sharp';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const key = get('DEEPSEEK_API_KEY');
if (!key) {
  console.error('no DEEPSEEK_API_KEY');
  process.exit(1);
}

// A large magenta square with a solid cyan circle in the middle: two obvious
// colours and two obvious shapes, so a correct answer cannot be a lucky guess.
const size = 256;
const svg = `<svg width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#ff00ff"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="80" fill="#00ffff"/>
</svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
console.log(`test image: ${png.length} bytes PNG (magenta square, cyan circle)`);

const deepseek = createOpenAI({ baseURL: 'https://api.deepseek.com', apiKey: key });

const model = deepseek.chat('deepseek-flash');

try {
  const result = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this image. Name the background colour and the shape in the middle. Two short facts only.' },
          { type: 'image', image: png, mediaType: 'image/png' },
        ],
      },
    ],
  });

  const text = (result.text || '').trim();
  console.log('\nmodel reply:\n' + text + '\n');

  const lower = text.toLowerCase();
  const sawMagenta = /magenta|pink|purple|fuchsia/.test(lower);
  const sawCyan = /cyan|blue|turquoise|teal|aqua/.test(lower);
  const sawCircle = /circle|round|dot|sphere|ellipse/.test(lower);

  const ok = sawCircle && (sawMagenta || sawCyan);
  console.log(ok ? 'PASS — the model genuinely saw the image' : 'FAIL — reply does not describe the image');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error('FAIL — generateText threw:', err?.message || err);
  process.exit(1);
}
