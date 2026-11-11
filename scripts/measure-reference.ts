import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { measureReference, diffSpec } from '../lib/agent/spec/measure';
import fs from 'fs';

(async () => {
  const src = process.argv[2] || '.work/regalia2/ref.mp4';
  console.log(`measuring: ${src}\n`);
  const m = await measureReference(src);

  console.log(`${m.width}x${m.height} @ ${m.fps.toFixed(3)}fps  ${m.durationSec.toFixed(2)}s  ${m.frameCount} frames`);
  console.log(`cuts measured: ${m.cuts.length} -> ${m.shots.length} shots\n`);
  console.log('  start   end   frames  score');
  m.shots.forEach((s, i) => {
    const sc = m.cuts[i - 1]?.score?.toFixed(1) ?? '-';
    console.log(`  ${s.start.toFixed(3).padStart(6)}  ${s.end.toFixed(3).padStart(6)}  ${String(s.frames).padStart(6)}  ${sc}`);
  });

  // Compare against what the model-derived spec claimed (15 segments).
  const specPath = '.work/spec-reel2.json';
  if (fs.existsSync(specPath)) {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const d = diffSpec(spec.segments, m);
    console.log(`\nSPEC vs MEASUREMENT`);
    console.log(`  ${d.summary}`);
    for (const x of d.missing.slice(0, 8)) console.log(`  MISSING  ${x.reason}`);
    for (const x of d.extra.slice(0, 8)) console.log(`  INVENTED ${x.reason}`);
  }
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
