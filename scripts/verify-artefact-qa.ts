/**
 * Does the QA itself work? A grader that cannot fail is decoration.
 *
 * This feeds the graders the two artefacts the owner rejected — a silent film and a single-column page — and requires
 * them to be REFUSED, then feeds them a passing pair and requires them to be accepted. If this gate ever goes green
 * while silent films ship, the grader is broken, not the film.
 *
 *   npx esbuild scripts/verify-artefact-qa.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-artefact-qa.mjs && node .tmp-artefact-qa.mjs
 */
import { blocksDelivery, describeQa, gradePageHtml, gradeVideoProbe } from '../lib/automation/artefact-qa';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

// ── The film that was actually delivered: video only, no audio.
console.log('▸ the silent film that shipped is refused');
const silent = gradeVideoProbe({
  streams: [{ codec_type: 'video', codec_name: 'h264' }],
  durationSeconds: 15,
  distinctFrames: 3,
  sampledFrames: 3,
});
console.log(`  ${describeQa(silent)}`);
check('a film with no audio stream fails', silent.ok === false);
check('and the failure blocks delivery', blocksDelivery(silent) === true);
check('and says exactly what is wrong', silent.problems.some((p) => /audio stream/i.test(p)), silent.problems[0]);

// ── A film with audio, but silent audio (a stream that carries nothing).
console.log('\n▸ a film whose audio stream is silent is refused too');
const silentAudio = gradeVideoProbe({
  streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  durationSeconds: 15,
  meanVolumeDb: -91,
  maxVolumeDb: -87,
  distinctFrames: 3,
  sampledFrames: 3,
});
check('an inaudible track fails', silentAudio.ok === false, describeQa(silentAudio));
check('the presence of a stream is not enough on its own', silentAudio.problems.some((p) => /audible/.test(p)));

// ── A still image posing as a video.
console.log('\n▸ a slideshow of one frame is refused');
const staticFilm = gradeVideoProbe({
  streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  durationSeconds: 15,
  meanVolumeDb: -18,
  maxVolumeDb: -2,
  distinctFrames: 1,
  sampledFrames: 3,
});
check('identical sampled frames fail', staticFilm.ok === false, describeQa(staticFilm));

// ── A good film passes.
console.log('\n▸ a properly built film passes');
const good = gradeVideoProbe({
  streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  durationSeconds: 15,
  meanVolumeDb: -16.4,
  maxVolumeDb: -1.6,
  distinctFrames: 3,
  sampledFrames: 3,
});
check('video + audible audio + motion passes', good.ok === true, describeQa(good));
check('and is allowed to deliver', blocksDelivery(good) === false);

// ── The page that shipped: one hero, one column, no proof.
console.log('\n▸ the single-column page that shipped is refused');
const thinPage = gradePageHtml(`<!DOCTYPE html><html><head><style>
  :root{--ink:#fff;--brand:#0f172a;--step-4:clamp(38px,7vw,62px)}
  .cta{min-height:44px}@media(prefers-reduced-motion:reduce){*{transition-duration:.001ms}}
</style></head><body>
  <main>
    <header class="hero"><h1>Offer</h1><img src="https://example.com/hero.jpg" alt="x"></header>
    <section class="offerings"><p>Some words.</p></section>
    <section class="about"><p>More words.</p></section>
    <section class="contact"><p>Call us.</p></section>
  </main>
</body></html>`);
console.log(`  ${describeQa(thinPage)}`);
check('a page with one image and no proof fails', thinPage.ok === false);
check('the missing imagery is named', thinPage.problems.some((p) => /real_imagery/.test(p)), thinPage.problems.join('; '));

// ── A designed page passes.
console.log('\n▸ a properly designed page passes');
const designed = gradePageHtml(`<!DOCTYPE html><html><head><style>
  :root{--bg:#0b1220;--panel:#101b2e;--text:#f7f6f3;--muted:#a9b6c9;--accent:#7dd3fc}h1{font-size:clamp(38px,7vw,62px)}h2{font-size:clamp(28px,4vw,42px)}p{font-size:clamp(16px,1.9vw,18px)}
  .cta{min-height:44px}@media(prefers-reduced-motion:reduce){*{transition-duration:.001ms}}
</style></head><body><main>
  <header class="hero"><h1>Monthly Marketing Department</h1>
    <img src="https://example.com/hero.jpg" alt="team">
    <img src="https://example.com/detail.jpg" alt="detail"></header>
  <section class="offerings"><div class="card">A</div></section>
  <section class="proof"><ul><li>Launched in a week</li></ul></section>
  <section class="gallery"><img src="https://example.com/g.jpg" alt="work"></section>
  <section class="faq"><details><summary>Do I need an ad account?</summary><p>No.</p></details></section>
  <section class="cta-band"><a class="cta" href="#">Book a call</a></section>
  <section class="contact">Call</section>
</main></body></html>`);
check('imagery, sections and a FAQ pass', designed.ok === true, describeQa(designed));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
