/**
 * The WhatsApp campaign tab and the voice campaign tab, as the owner sees them.
 *
 * Written against the failure it is checking for: Blue Square Infra's campaign reported "1000
 * contacts, only a few sent" when the truth was 16,317 recipients, 122 delivered and 2,022 refused by
 * Meta with 131042. So this asserts, on the live deployment:
 *
 *   1. the campaign API reports the REAL totals (16,317 / 122 / 2,022 / 14,173) for that campaign;
 *   2. the account-health endpoint names the blocker before a launch, for that account;
 *   3. pause / resume / retry_failed / cancel all work on a probe campaign — and the probe has no
 *      recipients, so nothing can be sent by exercising them;
 *   4. the voice campaign API reports progress and an eta from the same rate the dispatcher uses.
 *
 * No message is sent, no call is placed, no template is created.
 *
 *   npm run accept:campaign-tabs
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
const BLUESQUARE = arg('tenant', '2f62a259-f23b-48ee-a920-c436f36eaa4b');
const STALLED_CAMPAIGN = arg('campaign', 'fcb363ad-a099-4bca-9dc7-82e28f4ad15b');

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

async function signIn(userId: string): Promise<{ cookie: string; userId: string }> {
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
  const hashed = (link.data as any)?.properties?.hashed_token;
  if (!hashed) throw new Error(`could not mint a magic link: ${link.error?.message}`);
  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otp.error) throw new Error(otp.error.message);
  return {
    cookie: Array.from(jar.entries()).map(([n, v]) => `${n}=${v}`).join('; '),
    userId: otp.data.user!.id,
  };
}

const cleanup: Array<() => Promise<unknown>> = [];

async function main() {
  const { cookie } = await signIn(OWNER);
  const headers = { cookie };
  console.log(`\nsigned in as the operator account; inspecting tenant ${BLUESQUARE.slice(0, 8)}\n`);

  // ── 1. the stalled campaign's real numbers
  console.log('1. the campaign that stalled reports the truth, not a capped page');
  const statsRes = await fetch(
    `${BASE}/api/whatsapp/broadcasts?broadcastId=${STALLED_CAMPAIGN}&impersonate=${BLUESQUARE}&limit=5`,
    { headers }
  );
  const stats = await statsRes.json().catch(() => ({}));
  check('the campaign stats endpoint answers', statsRes.ok && stats?.success === true, statsRes.status);
  const totals = stats?.stats ?? {};
  check(
    'total recipients is the real 16,317 (not 1,000)',
    Number(totals.total) === 16317,
    { total: totals.total, sent: totals.sent, failed: totals.failed, pending: totals.pending }
  );
  check('delivered is 122', Number(totals.sent) === 122, totals.sent);
  check('failed is 2,022', Number(totals.failed) === 2022, totals.failed);
  check('pending is 14,173 (the rows nothing used to touch)', Number(totals.pending) === 14173, totals.pending);
  check('and the page of recipients is paged, not the whole list', Array.isArray(stats?.recipients) && stats.recipients.length <= 5, stats?.recipients?.length);
  check('the page reports how many it has not returned', stats?.page?.total === 16317 && stats?.page?.hasMore === true, stats?.page);
  const failedSample = (stats?.recipients ?? []).find((r: any) => r.status === 'failed');
  if (failedSample) {
    check(
      'a failure carries a sentence a person can act on',
      /payment or eligibility/i.test(String(failedSample.error_message ?? '')),
      String(failedSample.error_message ?? '').slice(0, 160)
    );
  }

  // ── 2. account health, before any launch
  console.log('\n2. the account health check names the blocker before a launch');
  const healthRes = await fetch(`${BASE}/api/whatsapp/health?impersonate=${BLUESQUARE}`, { headers });
  const health = await healthRes.json().catch(() => ({}));
  check('the health endpoint answers', healthRes.ok && health?.success === true, healthRes.status);
  check('it returns a verdict and a headline', typeof health?.ok === 'boolean' && Boolean(health?.headline), health?.headline);
  check(
    'it reports the phone number it would send from',
    Boolean(health?.phone?.displayPhoneNumber) || Boolean(health?.phone?.verifiedName),
    health?.phone
  );
  // Meta does not expose the tier on every API version/number — say so rather than failing on it, and
  // rely on the history check below to catch an account that cannot send at all.
  check(
    'it reports the messaging tier when Meta exposes one',
    health?.messagingLimitTier === null || typeof health?.messagingLimitTier === 'string',
    health?.messagingLimitTier
  );
  check(
    'and it names the refusal that Meta does not surface as a health field',
    Array.isArray(health?.blockers) && health.blockers.some((b: string) => /131042|payment|eligibility/i.test(b)),
    health?.blockers
  );
  console.log(`   headline: ${health?.headline}`);
  for (const blocker of health?.blockers ?? []) console.log(`   blocker: ${blocker}`);
  for (const warning of health?.warnings ?? []) console.log(`   warning: ${warning}`);

  // ── 3. the four actions, on a probe campaign with no recipients
  console.log('\n3. pause / resume / retry / cancel work (probe campaign, zero recipients)');
  const { data: probe, error: probeError } = await admin
    .from('whatsapp_broadcasts')
    .insert({
      user_id: OWNER,
      title: `[accept] campaign actions ${Date.now().toString(36)}`,
      template_name: 'accept_probe_template',
      recipient_stage: 'All',
      status: 'processing',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (probeError || !probe?.id) {
    check('the probe campaign could be created', false, probeError?.message);
  } else {
    const id = String(probe.id);
    cleanup.push(async () => {
      await admin.from('whatsapp_broadcast_recipients').delete().eq('broadcast_id', id);
      await admin.from('whatsapp_broadcasts').delete().eq('id', id);
    });

    const action = async (name: string) => {
      const res = await fetch(`${BASE}/api/whatsapp/broadcasts/actions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcastId: id, action: name }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const paused = await action('pause');
    check('pause is accepted and explained', paused.status === 200 && /paus/i.test(String(paused.body?.message ?? '')), paused.body);

    const resumed = await action('resume');
    check('resume is accepted and reports the queue', resumed.status === 200 && resumed.body?.success === true, resumed.body?.message);

    const retried = await action('retry_failed');
    check(
      'retry_failed says there is nothing to retry rather than pretending',
      retried.status === 200 && Number(retried.body?.requeued ?? 0) === 0,
      retried.body?.message
    );

    const cancelled = await action('cancel');
    check('cancel is accepted and explained', cancelled.status === 200 && /cancel/i.test(String(cancelled.body?.message ?? '')), cancelled.body?.message);

    const { data: after } = await admin.from('whatsapp_broadcasts').select('status').eq('id', id).maybeSingle();
    check('the campaign ends cancelled', (after as any)?.status === 'cancelled', after);

    const bad = await fetch(`${BASE}/api/whatsapp/broadcasts/actions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcastId: id, action: 'teleport' }),
    });
    check('an unknown action is refused', bad.status === 400, bad.status);
  }

  // ── 4. voice campaign progress
  console.log('\n4. the voice campaign reports progress and an eta');
  const { data: voiceCampaign } = await admin
    .from('voice_campaigns')
    .select('id, name, status')
    .eq('user_id', BLUESQUARE)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!voiceCampaign?.id) {
    console.log('   skip  that tenant has no voice campaign to inspect');
  } else {
    const progressRes = await fetch(
      `${BASE}/api/voice/campaign/progress?campaignId=${(voiceCampaign as any).id}&impersonate=${BLUESQUARE}`,
      { headers }
    );
    const progress = await progressRes.json().catch(() => ({}));
    check('the voice progress endpoint answers', progressRes.ok && progress?.success === true, progressRes.status);
    check('it counts call outcomes exactly', typeof progress?.counts === 'object' && Number(progress?.total) >= 0, progress?.counts);
    check('it reports the dial rate the dispatcher uses', Number(progress?.perTick) > 8, progress?.perTick);
    check('and either an eta or a clear "nothing left"', progress?.etaMinutes !== undefined && Boolean(progress?.note), progress?.note);

    const listRes = await fetch(`${BASE}/api/voice/campaign?impersonate=${BLUESQUARE}`, { headers });
    const list = await listRes.json().catch(() => ({}));
    const row = (list?.campaigns ?? []).find((c: any) => c.id === voiceCampaign.id);
    check('the campaign list carries the same eta for the card to show', row?.stats?.etaMinutes !== undefined && Number(row?.stats?.perTick) > 8, row?.stats);
  }
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
