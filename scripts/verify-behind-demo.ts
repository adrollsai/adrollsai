/**
 * Verifies the "text behind subject" demo the same way the agent is now
 * instructed to: probe the container for video+audio, then have Gemini actually
 * watch the finished file and report whether the effect happened.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getOrCreateSandbox, touchSandbox, pauseSandbox } from '../lib/agent/sandbox';
import { analyzeVideoWithGemini } from '../utils/gemini-video-analysis';

const USER = 'demo-behind';
const RESULT_URL =
  process.env.DEMO_RESULT_VIDEO ||
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/demo-behind/1794247487309_final.mp4';

(async () => {
  // 1. Container integrity: both streams present?
  const sandbox = await getOrCreateSandbox(USER);
  touchSandbox(USER, 300_000);
  const probe = await sandbox.commands.run(
    `cd /home/user && ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,duration -of default=nw=1 final.mp4 && echo "---" && ffprobe -v error -select_streams a -show_entries stream=codec_name,channels -of default=nw=1 final.mp4`,
    { timeoutMs: 60_000 }
  );
  console.log('=== container probe');
  console.log((probe.stdout || '').trim());
  await pauseSandbox(USER);

  // 2. Does it actually look right? Let Gemini watch the finished video.
  console.log('\n=== Gemini watch');
  try {
    const analysis = await analyzeVideoWithGemini({
      videoUrl: RESULT_URL,
      prompt:
        'Look at this video and answer precisely: (1) Is there large text on screen? What does it say? ' +
        '(2) Is the text partially hidden BEHIND the woman\'s head and hair, i.e. does her head occlude the middle of the text while the rest of the text remains visible on the background? ' +
        '(3) Are there visible artefacts: a glowing halo/outline around her hair, flickering edges, or text bleeding onto her face? ' +
        '(4) Does the picture otherwise look normal and in focus? Be blunt and specific.',
    });
    console.log(typeof analysis === 'string' ? analysis : JSON.stringify(analysis, null, 2));
  } catch (err: any) {
    console.error('gemini verification failed:', err?.message || err);
  }
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
