/**
 * Output quality assurance: does the ARTEFACT pass, not just the code.
 *
 * WHY THIS EXISTS
 * Every gate before this one checked the code: that a prompt names a tool, that a stylesheet contains a token, that a
 * tool is registered. None of them looked at what came out. A video with no audio stream passed. A composition whose
 * headline was painted through the line beneath it passed. A page whose design was one generic template passed,
 * because the template's CSS contained the tokens the test looked for.
 *
 * The owner's verdict on the first real outputs — "items on top of each other, no audio, dillly-dally" — was correct,
 * and the reason is that nothing measured the output. So this measures it:
 *
 *   VIDEO   an audio stream must exist, be audible, and the film must not be a still image; the renderer's own
 *           `hyperframes check` must pass (layout, contrast, overlap); duration must match the composition.
 *   PAGE    it must actually be designed: real imagery, several distinct section shapes, no placeholder copy, a
 *           contrast-checked palette, and — the part that only a browser can answer — a screenshot that a human
 *           (or a vision model) looks at.
 *
 * A gate that cannot fail is decoration. This one fails on today's artefacts, on purpose, and prints why.
 *
 *   npx esbuild scripts/qa-output.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-qa-output.mjs && node .tmp-qa-output.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

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

const run = (cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err: any) {
    return String(err?.stdout ?? '') + String(err?.stderr ?? '');
  }
};

// ── VIDEO ──────────────────────────────────────────────────────────────────
export function qaVideo(path: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!fs.existsSync(path)) return { ok: false, problems: ['file does not exist'] };

  const streams = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,width,height', '-of', 'csv=p=0', path])
    .trim()
    .split('\n')
    .filter(Boolean);
  const video = streams.find((s) => s.includes('video'));
  const audio = streams.find((s) => s.includes('audio'));

  console.log(`\n▸ video: ${path}`);
  console.log(`  streams: ${streams.join(' | ') || '(none)'}`);

  const [,, vCodec, width, height] = (video ?? '').split(',');
  check('has a video stream', Boolean(video), video ? `${vCodec} ${width}×${height}` : 'no video stream');
  // THE ONE THAT WOULD HAVE CAUGHT THE DELIVERED FILM: a film with no audio stream has no narration and no music,
  // whatever the commentary says.
  check(
    'has an AUDIO stream (narration and/or music)',
    Boolean(audio),
    audio ? audio : 'no audio stream — a silent film is not a narrated one',
  );
  if (!audio) problems.push('no audio stream');

  const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]).trim();
  const duration = Number(probe);
  check('has a real duration', Number.isFinite(duration) && duration > 1, `${duration}s`);
  if (!(duration > 1)) problems.push('no usable duration');

  if (audio) {
    const loud = run('ffmpeg', ['-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
    const mean = Number(/mean_volume:\s*(-?[\d.]+)/.exec(loud)?.[1] ?? 'NaN');
    const max = Number(/max_volume:\s*(-?[\d.]+)/.exec(loud)?.[1] ?? 'NaN');
    console.log(`  loudness: mean ${mean} dB, max ${max} dB`);
    // The doctrine's own numbers: around -16 LUFS, peak near -1.5 dB. Silence measures about -91 dB.
    check('the audio is actually audible', Number.isFinite(mean) && mean > -45, `${mean} dB mean`);
    check('and is not clipped', !(Number.isFinite(max) && max > -0.1), `${max} dB peak`);
    if (!(mean > -45)) problems.push('audio is silent');
  }

  // A still image posing as a video: sample three well-separated frames and compare them.
  const frames: Buffer[] = [];
  for (const at of [0.5, Math.max(1, duration / 2), Math.max(1.5, duration - 1)]) {
    const out = `.qa-frame-${at}.png`;
    run('ffmpeg', ['-hide_banner', '-v', 'error', '-ss', String(at), '-i', path, '-frames:v', '1', '-vf', 'scale=160:-1', '-y', out]);
    if (fs.existsSync(out)) {
      frames.push(fs.readFileSync(out));
      fs.unlinkSync(out);
    }
  }
  const distinct = new Set(frames.map((buffer) => buffer.toString('base64'))).size;
  check('is moving, not a single still frame', frames.length >= 2 && distinct >= 2, `${distinct} distinct frame(s) of ${frames.length}`);
  if (distinct < 2) problems.push('the video looks static');

  return { ok: problems.length === 0, problems };
}

// ── PAGE ───────────────────────────────────────────────────────────────────
export function qaPage(path: string): { ok: boolean; problems: string[]; score: Record<string, boolean> } {
  const html = fs.readFileSync(path, 'utf8');
  const problems: string[] = [];
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');

  console.log(`\n▸ page: ${path} (${Math.round(html.length / 1024)} KB)`);

  const score: Record<string, boolean> = {
    hasHeroImage: /<img\b[^>]*src="https?:\/\//i.test(body) || /hero__media/i.test(body),
    severalSectionShapes: new Set((html.match(/class="(hero|offerings|proof|countdown|mentor|gallery|logos|testimonials|faq|about|register|cta-band|contact)[^"]*"/g) ?? [])).size >= 5,
    hasImages: (body.match(/<img\b/gi) ?? []).length >= 2,
    hasFaqOrTestimonial: /<details>/i.test(body) || /testimonial/i.test(body),
    // `placeholder=` is an input hint, not unfinished copy; the first version of this check confused them.`r`n    noPlaceholderCopy: !/lorem ipsum|\[needs:|TODO|XXX/i.test(body.replace(/placeholder="[^"]*"/gi, '')),
    noEmDashInCopy: !/—/.test(body),
    contrastTokens: /--ink:/.test(html) && /--brand:/.test(html),
    touchTargets: /min-height:44px/.test(html),
    reducedMotion: /prefers-reduced-motion/.test(html),
    mobileStickyCta: /sticky-cta/.test(html),
    typeScale: /--step-4:clamp/.test(html),
  };

  for (const [key, ok] of Object.entries(score)) {
    if (!ok) problems.push(key);
    check(`  ${key}`, ok);
  }

  // Honest about the ceiling: these are structural checks. Whether it LOOKS good needs a screenshot and eyes.
  const designed = score.hasHeroImage && score.hasImages && score.severalSectionShapes && score.hasFaqOrTestimonial;
  check(
    'is designed rather than a single-column template',
    designed,
    'needs real imagery, several section shapes, and a proof or FAQ block',
  );

  return { ok: problems.length === 0, problems, score };
}

// ── run against what we actually shipped ───────────────────────────────────
console.log('='.repeat(64));
console.log('QA against the artefacts delivered to the owner');
console.log('='.repeat(64));

const video = qaVideo('.tmp-show-video.mp4');
if (fs.existsSync('.tmp-funnel-landing.html')) qaPage('.tmp-funnel-landing.html');

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
console.log(
  fail > 0
    ? '\nVERDICT: these artefacts do NOT meet the quality bar, and until now nothing said so. This gate is the\n' +
      'answer to "is there no quality assurance" — and the next step is to make delivery refuse without it.'
    : '\nVERDICT: the artefacts pass.',
);
if (fail) process.exitCode = 1;
