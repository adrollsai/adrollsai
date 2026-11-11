/**
 * Compile a reference video into an executable spec.
 *
 *   npm run spec:compile -- <video-url-or-file> [--have presenter_static,broll_video] [--out spec.json]
 *
 * --have declares what footage you actually have, so the compiler can tell you up
 * front which of the reference's effects you cannot reproduce. That report is the
 * point: it is the difference between "this will look weaker and here is exactly
 * why" and two hours of discovering it.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'fs';
import path from 'path';
import { compileSpec } from '../lib/agent/spec/compile';
import { assessFeasibility, validateSpec, type AssetRequirement } from '../lib/agent/spec/schema';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('usage: npm run spec:compile -- <video-url-or-file> [--have a,b] [--out file.json]');
    process.exit(1);
  }

  // A local file has to be reachable by Gemini, so it needs a URL. Fail clearly
  // rather than uploading from here and hiding the cost.
  const referenceUrl = /^https?:\/\//i.test(input) ? input : null;
  if (!referenceUrl) {
    console.error(
      `"${input}" is a local file. The analyst needs a public URL (R2, CDN, or the app's own asset URL).\n` +
        `Upload it first, then pass that URL.`
    );
    process.exit(1);
  }

  console.log(`compiling: ${referenceUrl}`);
  const result = await compileSpec({ referenceUrl });
  console.log(`analyst: ${result.model}`);
  const m = result.measurement;
  console.log(
    `measured: ${m.width}x${m.height} @ ${m.fps.toFixed(2)}fps, ${m.durationSec.toFixed(2)}s, ` +
      `${m.shots.length} shots, ${m.cuts.length} cuts\n`
  );

  if (result.problems.length) {
    console.log('SPEC REJECTED — it is not executable as written:');
    for (const p of result.problems) console.log(`  - ${p}`);
    if (result.rawJson) {
      const dump = path.resolve('.work/spec-rejected.json');
      fs.mkdirSync(path.dirname(dump), { recursive: true });
      fs.writeFileSync(dump, result.rawJson);
      console.log(`\nraw output kept at ${dump}`);
    }
    process.exit(1);
  }

  const have = (arg('have') || '').split(',').map((s) => s.trim()).filter(Boolean) as AssetRequirement[];
  const feasibility = assessFeasibility(result.spec, have);
  result.spec.feasibility = feasibility;

  const out = arg('out') || '.work/spec.json';
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result.spec, null, 2));

  console.log(`duration   ${result.spec.compiledFrom.durationSec}s  ${result.spec.compiledFrom.aspect}`);
  console.log(`requires   ${result.spec.requires.join(', ') || '(none declared)'}`);
  console.log(`type       ${result.spec.style.typeFamily} / ${result.spec.style.typeCase} / ${result.spec.style.typeTexture}`);
  console.log(`focus      ${result.spec.style.focus}`);
  console.log(`music      ${result.spec.audio.music ? `${result.spec.audio.music.genre} @ ${result.spec.audio.music.bpm}bpm` : 'none'}`);
  console.log(`vo         ${result.spec.audio.vo ? `${result.spec.audio.vo.language} @ ${result.spec.audio.vo.wordsPerSecond} wps` : 'none'}`);
  console.log(`shots      ${result.spec.segments.length} (measured — not model-invented)`);
  console.log(`text events ${result.spec.textEvents.length}`);
  console.log('');

  for (const s of result.spec.segments) {
    const when = `${s.start.toFixed(2)}-${s.end.toFixed(2)}s`.padEnd(15);
    const op = String(s.operation).padEnd(14);
    const mot = String(s.params.motion || '').padEnd(11);
    console.log(`  SHOT ${when}${op}${mot}${s.params.note || ''}`);
  }

  console.log('');
  for (const t of result.spec.textEvents) {
    const when = `${t.start.toFixed(2)}-${t.end.toFixed(2)}s`.padEnd(15);
    console.log(
      `  TEXT ${when}${String(t.role).padEnd(11)}${t.behindSubject ? 'BEHIND ' : '       '}${t.lines.join(' / ').slice(0, 46)}`
    );
  }

  if (result.spec.verification) {
    console.log(`\nVERIFICATION vs measurement: ${result.spec.verification.summary}`);
  }

  console.log(`\nFEASIBILITY with [${have.join(', ') || 'no assets declared'}]:`);
  if (feasibility.ok) {
    console.log('  buildable as written.');
  } else {
    console.log(`  MISSING: ${feasibility.missing.join(', ')}`);
    for (const d of feasibility.degradations) console.log(`  - ${d}`);
  }

  // The analyst call is already metered inside analyzeVideoWithGemini.

  console.log(`\nwrote ${out}`);
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
