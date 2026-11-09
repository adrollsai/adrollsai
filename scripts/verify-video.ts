/**
 * Proves the video path: download → Gemini Files API → gemini-3.8-flash.
 *
 * Uses a small, long-standing public test video. Prints exactly what the model
 * said so the result can be judged rather than trusted.
 *
 * Run: npm run verify:video
 */
import { analyzeVideoWithGemini } from '../utils/gemini-video-analysis';

// Next loads .env.local automatically; a standalone node script does not.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const TEST_VIDEO = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';

async function main() {
  console.log('analysing:', TEST_VIDEO);

  const result = await analyzeVideoWithGemini({
    videoUrl: TEST_VIDEO,
    prompt:
      'Describe this video in 4 short bullets: what device/product is shown, what happens, what text appears on screen, and roughly how long it is.',
  });

  console.log(`\nmodel: ${result.model}`);
  console.log(`uploaded to Files API: ${result.uploaded}`);
  console.log('\nanalysis:\n' + result.analysis + '\n');

  const ok = result.analysis.length > 40;
  console.log(ok ? 'PASS — Gemini returned a substantive analysis' : 'FAIL — analysis too short');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('FAIL —', err?.message || err);
  process.exit(1);
});
