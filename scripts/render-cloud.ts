/**
 * Render a compiled spec inside an E2B sandbox.
 *
 *   npm run spec:render:cloud -- --spec .work/spec.json --presenter <url> --music <url>
 *
 * Assets are given as public URLs; the sandbox downloads them itself, which is
 * faster than uploading from here and keeps our egress out of the path.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'fs';
import path from 'path';
import { renderSpecInSandbox, type AssetRef } from '../lib/agent/spec/render-cloud';
import type { Spec } from '../lib/agent/spec/schema';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function multi(name: string): AssetRef[] {
  return (arg(name) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

(async () => {
  const specPath = arg('spec') || '.work/spec-final.json';
  if (!fs.existsSync(specPath)) {
    console.error(`spec not found: ${specPath} — run spec:compile first`);
    process.exit(1);
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Spec;

  const rendererSource = fs.readFileSync(path.join(process.cwd(), 'scripts/render-spec.py'), 'utf8');

  const userId = arg('user') || process.env.RENDER_CLOUD_USER || 'cloud-render-test';
  const presenterUrl = arg('presenter');
  const musicUrl = arg('music');

  console.log(`spec: ${specPath} (${spec.segments.length} shots, ${spec.compiledFrom.durationSec}s)`);
  console.log(`user: ${userId}`);

  const started = Date.now();
  try {
    const result = await renderSpecInSandbox({
      spec,
      rendererSource,
      userId,
      stills: multi('stills'),
      clips: multi('clips'),
      presenter: presenterUrl ? { url: presenterUrl } : undefined,
      music: musicUrl ? { url: musicUrl } : undefined,
      workers: arg('workers') ? Number(arg('workers')) : undefined,
      onEvent: (m) => console.log(`  ${m}`),
    });

    console.log('\n=== cloud render complete ===');
    console.log(`url        ${result.url}`);
    console.log(`geometry   ${result.width}x${result.height}, ${result.frames} frames, ${result.durationSec.toFixed(2)}s`);
    console.log(`workers    ${result.workers}`);
    console.log(`size       ${(result.bytes / 1048576).toFixed(1)} MB`);
    console.log(`sandbox    ${result.sandboxSeconds}s  ->  ₹${result.costInr.toFixed(3)}`);
    console.log(`wall clock ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (e: any) {
    console.error('\nFAILED:', e?.message || e);
    process.exit(1);
  }
})();
