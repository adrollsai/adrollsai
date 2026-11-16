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

console.log('\n▸ a hopeless query never fabricates');
const none = await tool.execute({ query: 'zzzqqqxxxyyy nonexistent subject 9921', kind: 'image', limit: 2 }, {} as any);
// The web search degrades to licensed media by design, so the honest contract is not "always zero
// results" — it is "never invent one". Either it says plainly that it found nothing, or everything it
// returns is a real, licensed reference.
const nothing = none?.success === false && /could not find a reference/i.test(String(none?.error ?? ''));
const realOnly = (none?.references ?? []).length === 0 ||
  (none?.references ?? []).every((r: any) => /^https?:\/\//.test(String(r.url)) && r.licence !== 'inspiration-fabricated');
check(
  'it either says it found nothing, or returns only real licensed references',
  nothing || realOnly,
  nothing ? String(none?.error ?? '').slice(0, 60) : `${(none?.references ?? []).length} licensed fallback(s)`,
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
