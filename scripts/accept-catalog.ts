/**
 * The catalogue: adding a product with many photographs, and the emoji the card renders.
 *
 * Two reports from the same screen. "Fetch error adding property" while adding a product — the
 * client fired every upload at once and refused the 21st photograph outright, and when a request did
 * fail it reported a JSON parsing complaint instead of the HTTP problem. And the card rendered
 * "ðŸ  Mexmon Dreams, Jalandhar": a label emoji saved in the source as CP1252 mojibake.
 *
 * So this asserts, against the live app:
 *   1. a product with 40 images can be SAVED through /api/inventory — no image cap server-side;
 *   2. all 40 come back in order, and the product is readable;
 *   3. a bad request says what is wrong (a missing title is rejected with a message, not a 500);
 *   4. the catalogue page renders no mojibake in its visible text.
 *
 * The probe product is deleted at the end. Nothing is messaged, nothing is spent.
 *
 *   npm run accept:catalog
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}
function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = arg('base', 'https://app.pipixel.io');
const OWNER = arg('owner', 'bc63c065-9bcc-4793-bedc-f0960406425b');
const IMAGE_COUNT = Number(arg('images', '40'));

const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300)}`}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300)}`}`);
  }
};

async function signIn(userId: string): Promise<string> {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = users.users.find((u) => u.id === userId) || users.users.find((u) => u.email);
  if (!user?.email) throw new Error(`no email for ${userId}`);
  const jar = new Map();
  const supa = createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const hashed = link.data?.properties?.hashed_token;
  if (!hashed) throw new Error('could not mint a magic link');
  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otp.error) throw new Error(otp.error.message);
  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

const cleanup: Array<() => Promise<unknown>> = [];

async function main() {
  const cookie = await signIn(OWNER);
  const headers = { cookie, 'Content-Type': 'application/json' };
  const runId = Date.now().toString(36);
  const title = `[accept ${runId}] catalogue images`;

  // ── 1. a product with many photographs
  console.log(`\n1. a product with ${IMAGE_COUNT} photographs saves through the API`);
  const images = Array.from({ length: IMAGE_COUNT }, (_, i) => `https://example.invalid/accept/${runId}/${i + 1}.jpg`);
  const insertRes = await fetch(`${BASE}/api/inventory`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'insert',
      targetUserId: OWNER,
      propertyData: {
        title,
        description: 'acceptance probe — safe to delete',
        property_type: 'Generic',
        status: 'Active',
        image_url: images[0],
        images,
        show_on_landing_page: false,
        configurations: JSON.stringify({ tags: ['acceptance', 'probe'] }),
      },
    }),
  });
  const insertBody = await insertRes.json().catch(() => ({}));
  check('the save is accepted', insertRes.ok, { status: insertRes.status, body: insertBody });

  const { data: saved } = await admin
    .from('properties')
    .select('id, title, images, image_url')
    .eq('user_id', OWNER)
    .eq('title', title)
    .maybeSingle();

  if (saved?.id) {
    cleanup.push(async () => {
      await admin.from('properties').delete().eq('id', saved.id);
    });
    const stored = Array.isArray(saved.images) ? saved.images : [];
    check(`all ${IMAGE_COUNT} images are stored`, stored.length === IMAGE_COUNT, stored.length);
    check('they keep their order', stored[0] === images[0] && stored[IMAGE_COUNT - 1] === images[IMAGE_COUNT - 1], {
      first: stored[0],
      last: stored[stored.length - 1],
    });
    check('the first image is the main image', saved.image_url === images[0], saved.image_url);
  } else {
    check('the product is readable afterwards', false, insertBody);
  }

  // ── 2. a bad request says what is wrong
  console.log('\n2. a bad save explains itself instead of failing silently');
  const noTitle = await fetch(`${BASE}/api/inventory`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'insert', targetUserId: OWNER, propertyData: { description: 'no title' } }),
  });
  const noTitleBody = await noTitle.json().catch(() => ({}));
  check(
    'inserting without data is refused with a readable error',
    noTitle.status >= 400 && noTitle.status < 500 && Boolean(noTitleBody?.error),
    { status: noTitle.status, error: noTitleBody?.error }
  );

  const badAction = await fetch(`${BASE}/api/inventory`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'teleport' }),
  });
  const badActionBody = await badAction.json().catch(() => ({}));
  check(
    'an unknown action says so',
    badAction.status === 400 && /invalid action/i.test(String(badActionBody?.error ?? '')),
    { status: badAction.status, error: badActionBody?.error }
  );

  // ── 3. no mojibake anywhere in the visible catalogue text
  console.log('\n3. the catalogue renders no mojibake');
  const pageRes = await fetch(`${BASE}/dashboard`, { headers: { cookie } });
  const html = await pageRes.text();
  check('the dashboard renders', pageRes.ok, pageRes.status);
  const mojibake = html.match(/ðŸ|â€|âœ|Ã¢/g);
  check('no CP1252 mojibake in the served HTML', !mojibake, mojibake?.slice(0, 5));

  // The client bundle is where the card's emoji actually lives.
  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]);
  let badChunk = null;
  for (const chunk of chunks.slice(0, 40)) {
    const res = await fetch(`${BASE}${chunk}`).catch(() => null);
    if (!res?.ok) continue;
    const text = await res.text();
    const hit = text.match(/ðŸ[\u0080-\u00ff]/);
    if (hit) {
      badChunk = { chunk, hit: hit[0] };
      break;
    }
  }
  check('and the shipped JavaScript contains no mojibake emoji', badChunk === null, badChunk);
}

async function run() {
  try {
    await main();
  } catch (error: any) {
    fail++;
    console.log(`  FAIL acceptance crashed: ${String(error?.message || error)}`);
  } finally {
    for (const undo of cleanup.reverse()) {
      try {
        await undo();
      } catch {}
    }
    console.log(`\n${'='.repeat(64)}`);
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

void run();
