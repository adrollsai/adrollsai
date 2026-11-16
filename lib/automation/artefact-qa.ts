/**
 * Artefact QA: the checks that decide whether a file or a page is ALLOWED OUT.
 *
 * This is the missing piece the owner identified. Every gate in this repo before this one graded the CODE — that a
 * prompt names a tool, that a stylesheet carries a token, that a tool is registered. None of them looked at what came
 * out, so a film with no audio stream and type painted through type both shipped, and a page that was one generic
 * template shipped because its CSS contained the tokens the test wanted.
 *
 * The contract here is deliberately unforgiving:
 *   - a film must CARRY its audio, not intend it (an MP4 with one h264 stream has no narration and no music);
 *   - a film must not be a still image pretending to be motion;
 *   - a page must be DESIGNED — real imagery, several distinct section shapes, a proof or FAQ block — not a
 *     single-column template with nice spacing.
 *
 * Callers are expected to REFUSE delivery when these fail. A check that only warns is decoration.
 */

export interface QaFinding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface QaResult {
  ok: boolean;
  findings: QaFinding[];
  /** One-line reasons, for a tool result or a chat message. */
  problems: string[];
}

/** Which of these findings are fatal for DELIVERY (as opposed to worth reporting on a draft). */
export const DELIVERY_BLOCKERS = ['audio_stream', 'audible', 'not_static', 'video_stream'];

const finding = (check: string, ok: boolean, detail: string): QaFinding => ({ check, ok, detail });

const result = (findings: QaFinding[]): QaResult => ({
  ok: findings.every((f) => f.ok),
  findings,
  problems: findings.filter((f) => !f.ok).map((f) => `${f.check}: ${f.detail}`),
});

/**
 * Grade a rendered film from the numbers ffprobe and ffmpeg report.
 *
 * `probe` is the output of `ffprobe -show_entries stream=codec_type,codec_name -show_entries format=duration`, and
 * `loudness` the output of `ffmpeg -af volumedetect`. They are passed in rather than executed here so this module
 * stays pure and testable, and so the caller (a sandbox tool) runs the commands where the file actually lives.
 */
export function gradeVideoProbe(input: {
  streams: Array<{ codec_type?: string; codec_name?: string }>;
  durationSeconds?: number | null;
  meanVolumeDb?: number | null;
  maxVolumeDb?: number | null;
  distinctFrames?: number | null;
  sampledFrames?: number | null;
}): QaResult {
  const video = input.streams.find((s) => String(s.codec_type).toLowerCase() === 'video');
  const audio = input.streams.find((s) => String(s.codec_type).toLowerCase() === 'audio');
  const findings: QaFinding[] = [];

  findings.push(finding('video_stream', Boolean(video), video ? `${video.codec_name}` : 'no video stream'));
  findings.push(
    finding(
      'audio_stream',
      Boolean(audio),
      audio ? String(audio.codec_name) : 'no audio stream — a film with no audio has no narration and no music, whatever was intended',
    ),
  );

  const duration = Number(input.durationSeconds);
  findings.push(
    finding('duration', Number.isFinite(duration) && duration > 1, Number.isFinite(duration) ? `${duration}s` : 'unknown duration'),
  );

  if (audio) {
    const mean = input.meanVolumeDb ?? NaN;
    const max = input.maxVolumeDb ?? NaN;
    // Silence measures about -91 dB; the house target is around -16 LUFS with a peak near -1.5 dB.
    findings.push(finding('audible', Number.isFinite(mean) && mean > -45, `${mean} dB mean`));
    findings.push(finding('not_clipped', !(Number.isFinite(max) && max > -0.1), `${max} dB peak`));
  }

  if (Number.isFinite(Number(input.distinctFrames)) && Number.isFinite(Number(input.sampledFrames))) {
    findings.push(
      finding(
        'not_static',
        Number(input.distinctFrames) >= 2,
        `${input.distinctFrames} distinct of ${input.sampledFrames} sampled frames`,
      ),
    );
  }

  return result(findings);
}

/**
 * Grade a generated page's HTML.
 *
 * Structural only, and honest about it: whether it LOOKS good needs a screenshot and eyes. What this refuses is the
 * page the owner actually received — a single column of text with one stock hero and nothing else — and the
 * placeholder or em-dash copy that makes a page read as machine-written.
 */
export function gradePageHtml(html: string): QaResult {
  const source = String(html ?? '');
  const body = source.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  // `placeholder="..."` is an input hint, not unfinished copy. The first version of this check flagged every form.
  const copy = body.replace(/placeholder="[^"]*"/gi, '');

  const sections = new Set(
    (source.match(/class="(hero|offerings|proof|countdown|mentor|gallery|logos|testimonials|faq|about|register|cta-band|contact)[^"]*"/g) ?? []).map(
      (match) => match.replace(/class="|"$/g, '').split(' ')[0],
    ),
  );
  const images = (body.match(/<img\b[^>]*src="https?:\/\//gi) ?? []).length;

  const findings: QaFinding[] = [
    finding('hero_image', images >= 1 || /hero__media/i.test(body), `${images} image(s)`),
    finding('several_sections', sections.size >= 5, `${sections.size} distinct section shapes`),
    // One hero photo and nothing else is the template the owner called "shit".
    finding('real_imagery', images >= 2, `${images} image(s) on the page`),
    finding(
      'proof_or_faq',
      /<details\b/i.test(body) || /class="[^"]*testimonials?/i.test(source),
      'a proof or FAQ block, because a page with no answer to "why believe you" does not convert',
    ),
    finding('no_placeholder_copy', !/lorem ipsum|\[needs:|TODO|XXX/i.test(copy), 'no unfinished copy'),
    finding('no_em_dash', !/—/.test(body), 'an em dash in visible copy is the commonest machine-written tell'),
    finding('contrast_tokens', /--ink:/.test(source) && /--brand:/.test(source), 'measured palette tokens'),
    finding('touch_targets', /min-height:\s*44px/.test(source), '44 px minimum action size'),
    finding('reduced_motion', /prefers-reduced-motion/.test(source), 'motion can be switched off'),
    finding('type_scale', /--step-4:clamp/.test(source), 'a real type scale, not one size'),
  ];

  return result(findings);
}

/** Did anything fail that should stop a DELIVERY render? Drafts warn, deliveries refuse. */
export function blocksDelivery(qa: QaResult): boolean {
  return qa.findings.some((f) => !f.ok && DELIVERY_BLOCKERS.includes(f.check));
}

/** A short, human sentence for a tool result. */
export function describeQa(qa: QaResult): string {
  if (qa.ok) return 'QA passed.';
  return `QA failed: ${qa.problems.slice(0, 4).join('; ')}${qa.problems.length > 4 ? ` (+${qa.problems.length - 4} more)` : ''}`;
}
