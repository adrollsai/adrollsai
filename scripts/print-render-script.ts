/**
 * Prints the shell scripts the render tool generates, one per file, so they can
 * be syntax-checked with `bash -n` before they ever reach a sandbox.
 *
 *   node .tmp-print-render.cjs
 */
import fs from 'fs';
import { buildHyperFramesRenderScript } from '../lib/agent/tools/hyperframes-render';

const variants: Record<string, string> = {
  'default': buildHyperFramesRenderScript({ projectDir: 'demo', durationSeconds: 15 }),
  'tuned': buildHyperFramesRenderScript({
    projectDir: 'demo',
    durationSeconds: 15,
    fps: 24,
    quality: 'draft',
  }),
  'span': buildHyperFramesRenderScript({
    projectDir: 'demo',
    durationSeconds: 15,
    fps: 30,
    quality: 'looks',
    startSeconds: 2,
    endSeconds: 6,
  }),
  'audio': buildHyperFramesRenderScript({
    projectDir: 'demo',
    durationSeconds: 15,
    audioUrl: 'https://example.com/music.mp3',
  }),
};

fs.mkdirSync('.tmp-render-scripts', { recursive: true });
for (const [name, script] of Object.entries(variants)) {
  const file = `.tmp-render-scripts/${name}.sh`;
  fs.writeFileSync(file, script, 'utf8');
  console.log(`${name}: ${script.split('\n').length} lines -> ${file}`);
}

// Show the flag line so the plan is visible without running a sandbox.
console.log('\n--- tuned render command ---');
console.log(
  variants.tuned
    .split('\n')
    .filter((l) => l.includes('render-plan:') || l.includes('$HF render'))
    .join('\n')
);
console.log('\n--- span render command ---');
console.log(variants.span.split('\n').filter((l) => l.includes('$HF render')).join('\n'));
