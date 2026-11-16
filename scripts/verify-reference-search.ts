/**
 * Does the agent really get usable reference creatives off the open web?
 *
 * "Whichever the agent finds good for the use case, it uses that" only works if the URLs it receives
 * are fetchable by a generator. This exercises the REAL tool through the REAL orchestrator and then
 * fetches every URL it returns, because a reference URL that 404s is worse than no reference.
 *
 *   npx esbuild scripts/verify-reference-search.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-ref-search.mjs && node .tmp-ref-search.mjs
 *
 * Costs a handful of image downloads and R2 writes. No generation, no credits.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { googleImagesConfigured, parseBingImages } from '../lib/agent/tools/reference_search';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor Film Academy

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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const ctx = await createAgentContext(sb as any, ORG, {
  intentText: 'make an ad for the cinematography diploma, find a good reference first',
});
const tool = (ctx.tools as any).find_reference_creatives;
check('the tool is available on a creative request', Boolean(tool?.execute), ctx.toolGroups.join(','));
check(
  'the prompt tells the agent to use it',
  /find_reference_creatives/.test(String(ctx.systemPrompt)),
  'a tool it is never told about is a tool it will not use',
);

if (!tool?.execute) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log('\n▸ a real image search — real ads, for inspiration');
const result = await tool.execute(
  { query: 'creative ads for cinematography course', kind: 'image', limit: 3 },
  {} as any,
);
console.log(`  success=${result?.success} count=${result?.count ?? 0}`);
for (const ref of result?.references ?? []) {
  console.log(`   - [${ref.licence} / ${ref.purpose}] ${String(ref.title).slice(0, 52)}`);
  console.log(`     ${ref.url}`);
}

check('the search succeeds', result?.success === true, String(result?.error ?? ''));
check('it returns at least one reference', (result?.count ?? 0) >= 1, `${result?.count ?? 0}`);

const refs: any[] = result?.references ?? [];
check(
  'every reference is re-hosted on OUR storage, not hotlinked',
  refs.every((r) => /r2\.dev|cloudflarestorage/i.test(String(r.url))),
  refs[0]?.url ?? 'none',
);
check(
  'every reference carries its source and a stated purpose',
  refs.every((r) => /^https?:\/\//.test(String(r.sourceUrl)) && typeof r.purpose === 'string'),
  refs.map((r) => r.purpose).join(', '),
);
check(
  'inspiration results are marked do-not-deliver',
  refs.filter((r) => r.purpose === 'inspiration').every((r) => r.doNotDeliver === true),
  'a competitor ad is not a licence',
);
check(
  'and the note forbids passing them as reference plates',
  refs.some((r) => r.purpose === 'inspiration')
    ? /Do NOT pass these as\s+referenceImageUrls/i.test(String(result?.note ?? ''))
    : true,
  String(result?.note ?? '').slice(0, 70),
);

// ── The engine question the owner actually raised: where did this come from?
console.log('\n▸ it searched a real web image index, and says which');
const engines: string[] = result?.engines ?? [];
console.log(`  engines: ${engines.join(', ') || '(none)'}`);
check('at least one real web engine answered', engines.length >= 1, engines.join(', '));
check(
  'the engines are web image indexes, not the CC stock library',
  engines.every((e) => /google-images|bing-images|duckduckgo-images/.test(e)),
  engines.join(', '),
);
check(
  'each reference names the engine that found it',
  refs.every((r) => /google-images|bing-images|duckduckgo-images/.test(String(r.source ?? ''))),
  [...new Set(refs.map((r) => r.source))].join(', '),
);
check(
  'and NOT ONE of them is CC stock standing in for a web result',
  refs.every((r) => r.licence !== 'cc0' && r.licence !== 'pdm' && r.licence !== 'by' && r.licence !== 'by-sa'),
  'this is the bug the owner caught: a web search returning a stock photo of a camera',
);
check(
  'Google Images takes priority when the deployment is keyed for it',
  googleImagesConfigured({ GOOGLE_CSE_KEY: 'k', GOOGLE_CSE_CX: 'c' } as any) === true &&
    googleImagesConfigured({} as any) === false,
  googleImagesConfigured() ? 'keyed — Google Images is the primary engine' : 'no key — Bing + DuckDuckGo',
);

console.log('\n▸ the URLs a viewer would receive actually resolve');
for (const ref of refs) {
  const res = await fetch(ref.url, { method: 'HEAD' }).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  const size = Number(res?.headers.get('content-length') ?? 0);
  check(
    `  ${String(ref.title).slice(0, 34)} is fetchable and is an image`,
    Boolean(res?.ok) && /^image\//i.test(type),
    `HTTP ${res?.status} ${type} ${(size / 1024).toFixed(0)}KB`,
  );
}

console.log('\n▸ licensedOnly still gives reusable media with attribution rules');
const licenced = await tool.execute(
  { query: 'cinematographer', kind: 'image', limit: 2, licensedOnly: true },
  {} as any,
);
check('a licensed-only search succeeds', licenced?.success === true, String(licenced?.error ?? ''));
check(
  'its references are licenced-reference, not inspiration',
  (licenced?.references ?? []).every((r: any) => r.purpose === 'licenced-reference' && r.doNotDeliver === false),
  (licenced?.references ?? []).map((r: any) => r.licence).join(', '),
);
check(
  'and it never labels a licensed item as inspiration',
  (licenced?.references ?? []).every((r: any) => r.licence !== 'inspiration'),
);

console.log('\n▸ video references are guidance, not a fake index');
const videoRes = await tool.execute({ query: 'cinematic reel', kind: 'video', limit: 2 }, {} as any);
check('a video search returns guidance rather than pretending', /search_24fps_motion_graphics/.test(String(videoRes?.guidance ?? '')));
check('and it returns no fabricated video URLs', (videoRes?.references ?? []).length === 0);

console.log('\n▸ a hopeless query never fabricates, and never hides behind stock');
const none = await tool.execute({ query: 'zzzqqqxxxyyy nonexistent subject 9921', kind: 'image', limit: 2 }, {} as any);
// The honest contract is not "always zero results" — it is "never invent one, and never quietly swap in
// public-domain stock to look successful". Either it says it found nothing, or what it returned really
// came off a web image index.
const saidNothing = none?.success === false && /No web reference found/i.test(String(none?.error ?? ''));
const webOnly = (none?.references ?? []).length === 0 ||
  (none?.references ?? []).every((r: any) => /^https?:\/\//.test(String(r.url)) && r.licence === 'inspiration');
check(
  'it either says it found nothing, or returns only real web references',
  saidNothing || webOnly,
  saidNothing ? String(none?.error ?? '').slice(0, 70) : `${(none?.references ?? []).length} web result(s)`,
);

console.log('\n▸ the results parser, on real markup, with no network');
// A trimmed copy of an actual Bing attribute (Facebook ad, lookaside wrapper + thumbnail), so the parser is
// pinned to the shape that exists rather than to a shape I imagined.
const FIXTURE =
  '<a class="iusc" m="{&quot;cid&quot;:&quot;1&quot;,&quot;purl&quot;:&quot;https://www.facebook.com/somepage/photos/1/&quot;,' +
  '&quot;murl&quot;:&quot;https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1&quot;,' +
  '&quot;turl&quot;:&quot;https://ts4.mm.bing.net/th?id=OIP.abc&amp;pid=15.1&quot;,' +
  '&quot;t&quot;:&quot;Learn Cinematography&quot;}"></a>' +
  '<a class="iusc" m="{&quot;murl&quot;:&quot;https://cdn.example.com/poster.jpg&quot;,' +
  '&quot;purl&quot;:&quot;https://example.com/course&quot;,&quot;t&quot;:&quot;Film School Poster&quot;}"></a>';
const parsed = parseBingImages(FIXTURE, 3);
check('the parser reads Bing results out of real markup', parsed.length === 2, `${parsed.length} parsed`);
check(
  'it keeps the full-size URL, the page it came from and the thumbnail fallback',
  parsed[0]?.url.startsWith('https://lookaside.fbsbx.com') &&
    parsed[0]?.landingUrl === 'https://www.facebook.com/somepage/photos/1/' &&
    /^https:\/\/ts4\.mm\.bing\.net/.test(String(parsed[0]?.thumbnail)),
  `${parsed[0]?.creator} / thumb=${Boolean(parsed[0]?.thumbnail)}`,
);
check('html entities in the markup are decoded, not left raw', parsed[0]?.thumbnail?.includes('&pid=') === true);
check('a plain CDN result parses too', parsed[1]?.url === 'https://cdn.example.com/poster.jpg');
check('and every parsed result is labelled inspiration, never a licence', parsed.every((p) => p.licence === 'inspiration'));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
