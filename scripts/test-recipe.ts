/**
 * Runs the stored recipe standalone, exactly as the agent would receive it,
 * to prove it works BEFORE the agent is told to rely on it.
 *
 *   npm run test:recipe
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import {
  getOrCreateSandbox,
  touchSandbox,
  uploadSandboxArtifactToR2,
  pauseSandbox,
} from '../lib/agent/sandbox';
import { getRecipeByName } from '../lib/agent/recipes';

const SOURCE =
  process.env.DEMO_SOURCE_VIDEO ||
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/demo-behind/1794247488701_src.mp4';
const USER = 'demo-behind';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

(async () => {
  const recipe = getRecipeByName('text-behind-subject');
  if (!recipe) throw new Error('recipe missing');

  const sandbox = await getOrCreateSandbox(USER);
  touchSandbox(USER, 30 * 60 * 1000);

  for (const f of recipe.files) {
    await sandbox.files.write(`/home/user/${f.path}`, f.content);
  }
  console.log(`wrote recipe file(s): ${recipe.files.map((f) => f.path).join(', ')}`);

  const script = `
export PATH=/usr/local/bin:$PATH
set -e
cd /home/user
pip install --quiet --disable-pip-version-check mediapipe opencv-python-headless pillow numpy 2>&1 | tail -2
[ -f model.tflite ] || curl -fsSL "${MODEL_URL}" -o model.tflite
[ -f src.mp4 ] || curl -fsSL -A "Mozilla/5.0" "${SOURCE}" -o src.mp4
echo "== running recipe verbatim"
time python3 behind.py --src src.mp4 --out recipe_out.mp4 --line1 "NOBOGENT" --line2 "BEHIND THE HEAD"
ls -l recipe_out.mp4
`;
  const run = await sandbox.commands.run(script, {
    timeoutMs: 1_200_000,
    onStdout: (d: string) => process.stdout.write(d),
  } as any);

  if (run.exitCode !== 0) {
    console.error('\nRECIPE FAILED');
    console.error((run.stderr || '').slice(-3000));
    await pauseSandbox(USER);
    process.exit(1);
  }

  const url = await uploadSandboxArtifactToR2('recipe_out.mp4', USER);
  await sandbox.commands.run('cd /home/user && cp behind_work/out/00060.png recipe_frame.png', { timeoutMs: 30_000 });
  const bytes = await sandbox.files.read('recipe_frame.png', { format: 'bytes' } as any);
  fs.mkdirSync('.demo', { recursive: true });
  fs.writeFileSync('.demo/recipe_frame.png', Buffer.from(bytes as any));

  await pauseSandbox(USER);
  console.log('\n=== RECIPE OUTPUT');
  console.log('video:', url);
  console.log('frame: .demo/recipe_frame.png');
})().catch(async (e) => {
  console.error('recipe test failed:', e?.message || e);
  if (e?.stdout) console.error('--- sandbox stdout ---\n' + String(e.stdout).slice(-3000));
  if (e?.stderr) console.error('--- sandbox stderr ---\n' + String(e.stderr).slice(-3000));
  process.exit(1);
});
