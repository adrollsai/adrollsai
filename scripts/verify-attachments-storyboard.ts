/**
 * Gate for the attachment inventory and the storyboard approval.
 *
 * The two features share a purpose — make the operator's own footage usable, and put a free artefact
 * in front of them before any credits are spent — so they share a gate.
 *
 * Pure: no ffprobe, no vision model, no sandbox, no clock. The world is injected and faked here.
 */
import {
  aspectLabelFor,
  buildInventoryItem,
  inventoryAttachments,
  parseFfprobeJson,
  sourcesFromProduct,
  summariseInventory,
  usableSeconds,
  type InventoryDeps,
  type MediaProbe,
} from '../lib/agent/attachment-inventory';
import {
  buildStoryboard,
  storyboardApprovalRequest,
  storyboardSummary,
  toAnimaticSpec,
  type StoryboardBeatInput,
} from '../lib/agent/storyboard';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

// ── probing ────────────────────────────────────────────────────────────────
console.log('\n=== probing an attachment: measured, never guessed ===');

const ffprobeJson = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, duration: '12.5' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '12.52' },
});
const probed = parseFfprobeJson(ffprobeJson);
check('ffprobe output is parsed', probed !== null);
check('the length comes from the format', probed?.seconds === 12.52, String(probed?.seconds));
check('the frame size is kept', probed?.width === 1080 && probed?.height === 1920);
check('the audio stream is detected', probed?.hasAudio === true);

check('nonsense does not throw, it returns null', parseFfprobeJson('not json at all') === null);
check('a file with no duration returns null', parseFfprobeJson({ streams: [] }) === null);
check(
  'a silent clip reports hasAudio false',
  parseFfprobeJson(JSON.stringify({ streams: [{ codec_type: 'video', width: 1, height: 1 }], format: { duration: '4' } }))
    ?.hasAudio === false,
);

// ── aspect labels ──────────────────────────────────────────────────────────
console.log('\n=== aspect labels ===');
check('1080x1920 is 9:16', aspectLabelFor(1080, 1920) === '9:16', String(aspectLabelFor(1080, 1920)));
check('1080x1350 is 4:5', aspectLabelFor(1080, 1350) === '4:5', String(aspectLabelFor(1080, 1350)));
check('1920x1080 is 16:9', aspectLabelFor(1920, 1080) === '16:9', String(aspectLabelFor(1920, 1080)));
check('1080x1080 is 1:1', aspectLabelFor(1080, 1080) === '1:1', String(aspectLabelFor(1080, 1080)));
check('an odd frame reports its pixels', aspectLabelFor(1000, 401) === '1000x401', String(aspectLabelFor(1000, 401)));
check('missing dimensions give no label', aspectLabelFor(undefined, 1080) === undefined);

// ── building a row ─────────────────────────────────────────────────────────
console.log('\n=== a row says what it is and whether it can be used ===');

const clean = buildInventoryItem({
  source: { id: 'c1', kind: 'video', url: 'https://x/y.mp4' },
  probe: { seconds: 12.5, width: 1080, height: 1920, hasAudio: true },
  vision: { shows: 'the tower at dusk, no people' },
});
check('a clean clip is not a defect', clean.hasDefect === false);
check('the description is carried', clean.shows === 'the tower at dusk, no people');
check('the aspect is derived', clean.aspect === '9:16');

const unmeasured = buildInventoryItem({ source: { id: 'c2', kind: 'video' }, probe: null });
check('an unmeasurable clip is a defect', unmeasured.hasDefect === true);
check('and it is not given an invented length', unmeasured.seconds === undefined);

const watermarked = buildInventoryItem({
  source: { id: 'c3', kind: 'video' },
  probe: { seconds: 9, width: 1080, height: 1920, hasAudio: false },
  vision: { shows: 'b-roll of a street', hasWatermark: true },
});
check('a watermark makes it a defect', watermarked.hasDefect === true);

const burnedText = buildInventoryItem({
  source: { id: 'c4', kind: 'video' },
  probe: { seconds: 9, hasAudio: false },
  vision: { shows: 'a captioned reel', hasBurnedInText: true },
});
check('burned-in text makes it a defect', burnedText.hasDefect === true);

check(
  'an owner-supplied usable range wins for length',
  usableSeconds({ id: 'c', kind: 'video', seconds: 30, usableRange: { from: 4, to: 11 } }) === 7,
);
check('without a range the measured length is used', usableSeconds({ id: 'c', kind: 'video', seconds: 9 }) === 9);

// ── the async pass ─────────────────────────────────────────────────────────
console.log('\n=== the pass never lets one bad file kill the job ===');

let described = 0;
const deps: InventoryDeps = {
  async probe(url) {
    if (url.includes('boom')) throw new Error('ffprobe exploded');
    if (url.includes('empty')) return null;
    return { seconds: 10, width: 1080, height: 1920, hasAudio: true } as MediaProbe;
  },
  async describe() {
    described += 1;
    return { shows: 'a site visit' };
  },
};

const rows = await inventoryAttachments(
  [
    { id: 'ok', kind: 'video', url: 'https://x/ok.mp4' },
    { id: 'boom', kind: 'video', url: 'https://x/boom.mp4' },
    { id: 'empty', kind: 'video', url: 'https://x/empty.mp4' },
    { id: 'no-url', kind: 'video' },
  ],
  deps,
);
check('every source produces a row', rows.length === 4, String(rows.length));
check('a throwing probe is recorded, not thrown', rows[1]?.hasDefect === true);
check(
  'the throwing row says why',
  /ffprobe exploded/.test(rows[1]?.problem ?? ''),
  rows[1]?.problem,
);
check('a null probe is a defect', rows[2]?.hasDefect === true);
check('a source with no url is a defect', rows[3]?.hasDefect === true);
check('only the healthy clip was described', described === 1, String(described));
check('the healthy row is usable', rows[0]?.hasDefect === false);

const noVision = await inventoryAttachments([{ id: 'v', kind: 'video', url: 'https://x/v.mp4' }], {
  probe: async () => ({ seconds: 5, hasAudio: false }),
});
check('without a vision dep it still inventories', noVision[0]?.hasDefect === false && noVision[0]?.shows === undefined);

// ── the summary ────────────────────────────────────────────────────────────
console.log('\n=== the summary is written so the owner can correct it ===');
const summary = summariseInventory(rows, { ok: 'tower clip' });
check('it names the file the owner knows', /tower clip/.test(summary));
check('it explains why a file is unusable', /not used:/.test(summary), summary.split('\n').find((l) => l.includes('not used')));
check('it states the footage is free', /costs no credits/.test(summary));
check('it counts what can cover a beat', /1 of 4 can cover a beat/.test(summary), summary.split('\n').pop());
check('an empty inventory still says something', /No attachments/.test(summariseInventory([])));

// ── product media ──────────────────────────────────────────────────────────
console.log('\n=== a product row becomes sources in every column it uses ===');
const productSources = sourcesFromProduct({
  title: 'Red Rose City',
  video_urls: ['https://x/a.mp4', 'https://x/b.mp4'],
  product_videos: ['https://x/c.mp4'],
  video_url: 'https://x/d.mp4',
  images: ['https://x/1.jpg'],
  image_url: 'https://x/1.jpg',
  brochure_url: 'https://x/brochure.pdf',
});
check('the videos are collected', productSources.filter((s) => s.kind === 'video').length === 4, String(productSources.filter((s) => s.kind === 'video').length));
check('the duplicate image is collapsed', productSources.filter((s) => s.kind === 'image' && s.url === 'https://x/1.jpg').length === 1);
check('the brochure is picked up', productSources.some((s) => s.url === 'https://x/brochure.pdf'));
check('every source is named for the owner', productSources.every((s) => /Red Rose City/.test(s.name ?? '')));
check('junk values are skipped', sourcesFromProduct({ video_urls: ['not a url'], title: 'x' }).length === 0);
check('a null product yields nothing', sourcesFromProduct(null).length === 0);

// ── storyboard ─────────────────────────────────────────────────────────────
console.log('\n=== storyboard: the free artefact that decides the film ===');

const beats: StoryboardBeatInput[] = [
  { id: 'b1', seconds: 3, role: 'picture', label: 'THE 11:47 PM LEAD', source: 'generate', scene: 's1' },
  { id: 'b2', seconds: 5, role: 'picture', label: 'your own site footage', source: 'attachment', attachmentId: 'clip-2' },
  { id: 'b3', seconds: 4, role: 'audio-only', line: 'Meet Nobo.', source: 'generate' },
  { id: 'b4', seconds: 2.5, role: 'picture', label: 'END CARD', source: 'existing' },
];
const sb = buildStoryboard(beats);

check('every beat becomes a card', sb.cards.length === 4);
check('the total is the sum of the beats', sb.totalSeconds === 14.5, String(sb.totalSeconds));
check('timings are cumulative, not overlapping', sb.cards[1]?.startSeconds === 3 && sb.cards[1]?.endSeconds === 8);
check('the last card ends at the total', sb.cards[3]?.endSeconds === 14.5);
check('generated picture beats are counted', sb.generatedBeats === 1, String(sb.generatedBeats));
check('attachment beats are counted', sb.attachmentBeats === 1);
check('audio-only beats are counted', sb.audioOnlyBeats === 1);
check('generated seconds exclude the attachment', sb.generatedSeconds === 3, String(sb.generatedSeconds));
check('attachment seconds are counted separately', sb.attachmentSeconds === 5, String(sb.attachmentSeconds));
check(
  'the notes say the voice-only beat is budgeted',
  sb.notes.some((n) => /heard but not shown/.test(n)),
  sb.notes.find((n) => /heard but not shown/.test(n))?.slice(0, 60),
);

const sheet = storyboardSummary(sb);
check('the sheet has a timecode per beat', /0:03\.0–0:08\.0/.test(sheet), sheet.split('\n')[2]?.slice(0, 40));
check('the sheet marks generated beats', /GENERATE/.test(sheet));
check('the sheet marks the owner\'s footage', /YOUR FOOTAGE/.test(sheet));
check('the sheet says nothing is generated before approval', /Nothing is generated until this sheet is approved/.test(sheet));

const req = storyboardApprovalRequest(sb);
check('the approval carries the sheet', req.artefact === sheet);
check('it names what stays blocked', req.blockedUntilApproved.some((b) => /generation/.test(b)));

const req2 = storyboardApprovalRequest(buildStoryboard(beats));
check('an identical plan produces an identical fingerprint', req.fingerprintPayload === req2.fingerprintPayload);

const changed = buildStoryboard(beats.map((b) => (b.id === 'b1' ? { ...b, seconds: 4 } : b)));
const req3 = storyboardApprovalRequest(changed);
check('changing a timing changes the fingerprint', req.fingerprintPayload !== req3.fingerprintPayload);

const reworded = buildStoryboard(beats.map((b) => (b.id === 'b1' ? { ...b, label: 'A DIFFERENT HEADLINE' } : b)));
check(
  'changing the words also changes the fingerprint (it changes the film)',
  storyboardApprovalRequest(reworded).fingerprintPayload !== req.fingerprintPayload,
);

// ── animatic ───────────────────────────────────────────────────────────────
console.log('\n=== the animatic: real timings, greyscale, no media ===');
const animatic = toAnimaticSpec(sb);
check('one card per beat', animatic.cards.length === 4);
check('the animatic carries the real timings', animatic.cards[1]?.start === 3 && animatic.cards[1]?.dur === 5);
check('a card never has zero duration', animatic.cards.every((c) => c.dur >= 0.4));
check(
  'the attached beat is marked as the owner\'s footage',
  /YOUR FOOTAGE/.test(animatic.cards[1]?.watermark ?? ''),
  animatic.cards[1]?.watermark,
);
check('the voice-only beat is marked', /VOICE ONLY/.test(animatic.cards[2]?.watermark ?? ''));
check('a generated beat is marked as not-yet-made', /TO BE GENERATED/.test(animatic.cards[0]?.watermark ?? ''));

// ── the sandbox probe adapter ──────────────────────────────────────────────
console.log('\n=== the probe adapter: fetches safely and never guesses ===');

const {
  PROBE_DIR,
  downloadCommand,
  ffprobeJsonCommand,
  isFetchableUrl,
  probeFileName,
  probeWithSandbox,
  sandboxInventoryDeps,
} = await import('../lib/agent/attachment-probe');

check('http is fetchable', isFetchableUrl('http://x/y.mp4') === true);
check('https is fetchable', isFetchableUrl('https://x/y.mp4') === true);
check('a shell metacharacter is not a url', isFetchableUrl('https://x/y.mp4; rm -rf /') === true);
check('a file path is not fetchable', isFetchableUrl('/etc/passwd') === false);
check('an empty string is not fetchable', isFetchableUrl('') === false);

check(
  'the download fails on http errors instead of saving an error page',
  /--fail/.test(downloadCommand('https://x/y.mp4', '/tmp/a.mp4')),
  downloadCommand('https://x/y.mp4', '/tmp/a.mp4'),
);
check(
  'the download quotes its url',
  downloadCommand('https://x/a b.mp4', '/tmp/a.mp4').includes("'https://x/a b.mp4'"),
  downloadCommand('https://x/a b.mp4', '/tmp/a.mp4'),
);
check(
  'ffprobe asks for json and quotes the path',
  /-print_format json/.test(ffprobeJsonCommand('/tmp/a.mp4')) && ffprobeJsonCommand('/tmp/a.mp4').includes("'/tmp/a.mp4'"),
  ffprobeJsonCommand('/tmp/a.mp4'),
);
check('the probe dir is a temp path', PROBE_DIR.startsWith('/tmp/'), PROBE_DIR);
check('the filename is sanitised', probeFileName('../../etc/passwd', 'https://x/y.mp4') === '______etc_passwd.mp4', probeFileName('../../etc/passwd', 'https://x/y.mp4'));
check('a known extension is kept', probeFileName('clip', 'https://x/y.mov?token=1') === 'clip.mov', probeFileName('clip', 'https://x/y.mov?token=1'));

// a sandbox whose download succeeds and whose probe returns real ffprobe json
const okSandbox = {
  async exec(command: string) {
    if (command.startsWith('curl')) return { stdout: '', stderr: '', exitCode: 0 };
    if (command.startsWith('ffprobe')) return { stdout: ffprobeJson, stderr: '', exitCode: 0 };
    return { stdout: '', stderr: '', exitCode: 0 };
  },
};
const probedClip = await probeWithSandbox(okSandbox as any, 'https://x/ok.mp4', { id: 'ok' });
check('a good clip probes to a length', probedClip?.seconds === 12.52, String(probedClip?.seconds));

const failCurl = { async exec(c: string) { return { stdout: '', stderr: '', exitCode: c.startsWith('curl') ? 22 : 0 }; } };
check('a failed download probes to null, not a guess', (await probeWithSandbox(failCurl as any, 'https://x/no.mp4')) === null);

const badJson = {
  async exec(c: string) {
    return { stdout: c.startsWith('ffprobe') ? 'not json' : '', stderr: '', exitCode: 0 };
  },
};
check('unparseable probe output gives null', (await probeWithSandbox(badJson as any, 'https://x/weird.mp4')) === null);

const thrower = { async exec(): Promise<never> { throw new Error('sandbox died'); } };
check('a dead sandbox gives null rather than throwing', (await probeWithSandbox(thrower as any, 'https://x/y.mp4')) === null);

check('a non-http url short-circuits before any command runs', (await probeWithSandbox(thrower as any, 'file:///etc/passwd')) === null);

const probeDeps = sandboxInventoryDeps(okSandbox as any);
check('the deps expose probe', typeof probeDeps.probe === 'function');
check('describe is absent when not supplied', probeDeps.describe === undefined);
const depsWithVision = sandboxInventoryDeps(okSandbox as any, async () => ({ shows: 'a thing' }));
check('describe is present when supplied', typeof depsWithVision.describe === 'function');

// ── the animatic ───────────────────────────────────────────────────────────
console.log('\n=== the animatic: a real, renderable, deterministic artefact ===');

const { renderAnimaticHtml, escapeHtml, cssId } = await import('../lib/agent/animatic');
const spec = toAnimaticSpec(sb);
const html = renderAnimaticHtml(spec, { width: 1920, height: 1080, title: 'TEST ANIMATIC' });

check('the composition declares its id', html.includes('data-composition-id="animatic"'));
check('the composition duration is the film length', html.includes('data-duration="14.5"'), html.match(/data-duration="([\d.]+)"/)?.[1]);
check('every card is a timed clip', (html.match(/class="clip card"/g) || []).length === 4, String((html.match(/class="clip card"/g) || []).length));
check('the first card starts at zero', html.includes('data-start="0"'));
check('the second card starts at beat 1 end', html.includes('data-start="3"'));
check('timings carry no floating point noise', !html.includes('2.9999999') && !html.includes('0.30000000004'));
check(
  'the timeline is registered PAUSED on __timelines',
  /window\.__timelines\['animatic'\]/.test(html) && /gsap\.timeline\(\{ paused: true \}\)/.test(html),
);
check('there is one tween per card', (html.match(/tl\.fromTo\('#card-/g) || []).length === 4, String((html.match(/tl\.fromTo\('#card-/g) || []).length));
check('the palette is greyscale', !/#[0-9a-f]{6}/i.test(html.replace(/#(1a1a1c|202024|171719|232326|101012|e8e8ea|f2f2f4|7a7a80|9a9aa2|5f5f66)/gi, '')));
check('the animatic is labelled as one', html.includes('TEST ANIMATIC'));
check('a card carries its watermark', /YOUR FOOTAGE/.test(html));
check('a voice-only card is marked', /VOICE ONLY/.test(html));

const again = renderAnimaticHtml(spec, { width: 1920, height: 1080, title: 'TEST ANIMATIC' });
check('the same spec renders byte-identically', again === html);

check('a dimension choice changes the canvas', renderAnimaticHtml(spec, { width: 1080, height: 1920 }).includes('data-width="1080"'));

const hostile = renderAnimaticHtml({
  total: 3,
  cards: [{ id: 'x"><script>alert(1)</script>', start: 0, dur: 3, text: '<img src=x onerror=alert(1)>', tone: 'card', watermark: '</div>' }],
});
check('owner text is escaped, not injected', !hostile.includes('<img src=x') && hostile.includes('&lt;img src=x'));
check('the card id is neutralised for the selector', /id="card-x___script_alert_1___script_"/.test(hostile), hostile.match(/id="card-[^"]*"/)?.[0]);
check('escapeHtml handles the classic set', escapeHtml('&<>"\'') === '&amp;&lt;&gt;&quot;&#39;', escapeHtml('&<>"\''));
check('cssId strips selectors', cssId('a#b.c d') === 'a_b_c_d', cssId('a#b.c d'));

// ── the approval wiring ────────────────────────────────────────────────────
console.log('\n=== the storyboard approval: one plan, one yes, spent once ===');

const gate = await import('../lib/agent/storyboard-gate');

function fakeStore(rows: { actionId?: string; actionPayload: unknown }[] = []) {
  const state = { rows, pending: [] as any[], consumed: [] as string[] };
  return {
    state,
    async approved() {
      return state.rows;
    },
    async recordPending(request: any) {
      state.pending.push(request);
      return { actionId: 'act-1' };
    },
    async consumeApproval(actionId: string) {
      state.consumed.push(actionId);
    },
  };
}

check('the action type is one the gate already knows', gate.STORYBOARD_ACTION_TYPE === 'create_asset');

const submitted = await gate.submitStoryboardApproval({ store: fakeStore() as any, storyboard: sb });
check('submitting shows the sheet', submitted.artefact === storyboardSummary(sb));
check('an approval id comes back', submitted.actionId === 'act-1');
check('it is marked as blocking', submitted.blocked === true);
check('the message says nothing is spent yet', /Nothing is spent before that|nothing will be generated/i.test(submitted.message));

const noStore = await gate.submitStoryboardApproval({ store: null, storyboard: sb });
check('with no store it fails CLOSED', noStore.blocked === true && noStore.actionId === null);
check('and it asks for a reply instead of proceeding', /approved/i.test(noStore.message));

const storeA = fakeStore();
await gate.submitStoryboardApproval({ store: storeA as any, storyboard: sb });
check('the pending request carries the fingerprint', typeof storeA.state.pending[0]?.toolInput?.storyboardFingerprint === 'string');
check('the pending request says WHY', /Nothing is generated until you approve/.test(storeA.state.pending[0]?.why ?? ''));

const notApproved = await gate.isStoryboardApproved({ store: fakeStore() as any, storyboard: sb });
check('an empty store is not approved', notApproved.approved === false);
check('and says so plainly', /has not been approved yet/.test(notApproved.because), notApproved.because);

const fp = gate.approvalPayloadFor(sb).storyboardFingerprint;
const approvedStore = fakeStore([{ actionId: 'act-9', actionPayload: { kind: 'storyboard', storyboardFingerprint: fp } }]);
const yes = await gate.isStoryboardApproved({ store: approvedStore as any, storyboard: sb });
check('a matching fingerprint is approved', yes.approved === true);
check('the action id is returned so it can be spent', yes.actionId === 'act-9');

const changedPlan = buildStoryboard(beats.map((b) => (b.id === 'b1' ? { ...b, seconds: 9 } : b)));
const stale = await gate.isStoryboardApproved({ store: approvedStore as any, storyboard: changedPlan });
check('an approval for a DIFFERENT plan does not count', stale.approved === false);
check('and the refusal explains it changed', /DIFFERENT plan/.test(stale.because), stale.because);

const noStoreCheck = await gate.isStoryboardApproved({ store: null, storyboard: sb });
check('with no store nothing is approved', noStoreCheck.approved === false);

check(
  'a nested payload is still found',
  gate.fingerprintOfPayload({ toolInput: { storyboardFingerprint: 'abc' } }) === 'abc',
);
check('a payload with no fingerprint returns null', gate.fingerprintOfPayload({ something: 1 }) === null);
check('a non-object payload returns null', gate.fingerprintOfPayload('nope') === null);

await gate.consumeStoryboardApproval({ store: approvedStore as any, actionId: 'act-9' });
check('consuming marks it spent', approvedStore.state.consumed.includes('act-9'));
const consumeNull = fakeStore();
await gate.consumeStoryboardApproval({ store: consumeNull as any, actionId: null });
check('consuming nothing is a no-op', consumeNull.state.consumed.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
