/**
 * The calling queue and the channels: is everyone who should be called in the queue, newest first, and does capacity
 * follow the lines we pay for?
 *
 * The owner's rules, tested literally:
 *   - a lead who has not given a definite yes or no, sitting in a fresh stage OR never contacted, is ALWAYS in the
 *     queue;
 *   - a lead that just arrived goes first;
 *   - every call goes out on one of the configured Vobiz channels, and buying another channel raises the number of
 *     simultaneous calls with NO code change.
 *
 * Pure apart from one read-only preview of the admin account's real queue at the end, so the numbers printed are the
 * state of calling right now rather than a fixture.
 *
 *   npx esbuild scripts/verify-call-queue.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-call-queue.mjs && node .tmp-call-queue.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  prioritiseCallQueue,
  summariseQueue,
  formatAge,
  toQueueRow,
} from '../lib/automation/call-queue';
import {
  channelCapacity,
  describeCapacity,
  loadVoiceChannels,
  parseChannels,
  pickChannel,
} from '../lib/automation/voice-channels';

dotenv.config({ path: '.env.local', quiet: true });

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

const now = new Date('2026-11-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const lead = (over: Partial<any> = {}) => ({
  id: over.id ?? 'l1',
  phone: '+919876543210',
  name: 'Test',
  created_at: hoursAgo(1),
  voice_call_retry_count: 0,
  voice_call_status: null,
  pipeline_stage: 'New Lead',
  last_call_at: null,
  custom_fields: {},
  booked_time: null,
  processing_lock_until: null,
  ...over,
});

// ── 1. Who is in the queue.
console.log('▸ who is always in the queue');
const rows = [
  lead({ id: 'fresh-new', created_at: hoursAgo(0.2) }),
  lead({ id: 'fresh-old-stage', created_at: hoursAgo(48), pipeline_stage: 'Follow Up' }),
  lead({ id: 'retry-due', created_at: hoursAgo(72), voice_call_retry_count: 1, last_call_at: hoursAgo(30), voice_call_status: 'completed' }),
  lead({ id: 'decided-yes', voice_call_status: 'interested' }),
  lead({ id: 'decided-no', pipeline_stage: 'Not Interested' }),
  lead({ id: 'no-phone', phone: null }),
  lead({ id: 'foreign', phone: '+14155550100' }),
  lead({ id: 'opted-out', custom_fields: { opt_out: true } }),
  lead({ id: 'opted-out-text', custom_fields: '{"opt_out":true}' }),
  lead({ id: 'unsub', custom_fields: { unsubscribed_at: '2026-11-01' } }),
  lead({ id: 'in-flight', voice_call_status: 'calling' }),
  lead({ id: 'booked', booked_time: hoursAgo(1) }),
  lead({ id: 'maxed', voice_call_retry_count: 3 }),
  lead({ id: 'locked', processing_lock_until: new Date(now.getTime() + 60_000).toISOString() }),
];

const decisions = prioritiseCallQueue(rows, { now, freshHours: 24, maxAttempts: 3 });
const byId = new Map(decisions.map((d) => [d.id, d]));
const inQueue = decisions.filter((d) => d.inQueue).map((d) => d.id);

check('a lead that just arrived is in the queue', byId.get('fresh-new')?.inQueue === true, byId.get('fresh-new')?.reason);
check(
  'a lead never contacted is in the queue even from a non-fresh stage',
  byId.get('fresh-old-stage')?.inQueue === true,
  byId.get('fresh-old-stage')?.reason,
);
check('a lead due a retry is in the queue', byId.get('retry-due')?.inQueue === true, byId.get('retry-due')?.reason);
for (const id of ['decided-yes', 'decided-no', 'no-phone', 'foreign', 'opted-out', 'opted-out-text', 'unsub', 'in-flight', 'booked', 'maxed', 'locked']) {
  check(`  ${id} is NOT in the queue`, byId.get(id)?.inQueue === false, byId.get(id)?.reason);
}
check(
  'an opt-out written as TEXT in the database still excludes the lead',
  byId.get('opted-out-text')?.inQueue === false,
  'custom_fields arrives as text from the candidates RPC — this is why toQueueRow exists',
);
check('exactly the three eligible leads are queued', inQueue.length === 3, inQueue.join(', '));

// ── 2. Priority.
console.log('\n▸ just-arrived goes first');
check('the queue is ordered newest-first for untouched leads', inQueue[0] === 'fresh-new', inQueue.join(' → '));
check(
  'retries come after untouched leads',
  inQueue.indexOf('retry-due') === inQueue.length - 1,
  'nobody left rotting at the back of the retry pile either',
);
const twoFresh = prioritiseCallQueue(
  [lead({ id: 'older', created_at: hoursAgo(10) }), lead({ id: 'newer', created_at: hoursAgo(0.5) })],
  { now },
);
check('of two untouched leads, the newer comes first', twoFresh[0].id === 'newer', twoFresh.map((d) => d.id).join(' → '));

const retryCompare = prioritiseCallQueue(
  [
    lead({ id: 'a-recent', voice_call_retry_count: 1, last_call_at: hoursAgo(2), voice_call_status: 'completed' }),
    lead({ id: 'b-stale', voice_call_retry_count: 1, last_call_at: hoursAgo(50), voice_call_status: 'completed' }),
  ],
  { now },
);
check(
  'retries are ordered longest-since-contact first',
  retryCompare[0].id === 'b-stale',
  retryCompare.map((d) => `${d.id} (${d.reason})`).join(' → '),
);

// ── 3. Capacity follows the channels.
console.log('\n▸ capacity follows the lines we pay for');
const three = parseChannels('MA_HOSGFZ86:+917965480905;MA_HOSGFZ86:+917965480539;MA_HOSGFZ86:+917965480907');
check('the compact channel list parses three channels', three.length === 3, three.map((c) => c.number).join(', '));
check('and their capacity is three simultaneous calls', channelCapacity(three) === 3, String(channelCapacity(three)));
const four = parseChannels('MA_HOSGFZ86:+917965480905;MA_HOSGFZ86:+917965480539;MA_HOSGFZ86:+917965480907;MA_HOSGFZ86:+917965481111');
check(
  'buying a fourth channel raises capacity to four with no code change',
  channelCapacity(four) === 4 && four.length === 4,
  `${four.length} channels → ${channelCapacity(four)} calls`,
);
const json = parseChannels('[{"id":"a","authId":"MA_1","number":"+919000000001","concurrent":2},{"id":"b","authId":"MA_2","number":"+919000000002","concurrent":2}]');
check('per-channel concurrency is honoured (2 channels × 2 legs)', channelCapacity(json) === 4, String(channelCapacity(json)));
check('a broken entry costs one channel, not the whole list', parseChannels('MA_1:+919000000001;;garbage;MA_2:+919000000002').length === 2, 'defensive parsing');
const fallback = loadVoiceChannels({ envChannels: '', businessInfo: {}, profileNumber: '+919876500000', concurrencyLimit: null });
check(
  'with nothing configured the fallback keeps today’s behaviour (one line, 3 legs)',
  channelCapacity(fallback.channels) === 3 && fallback.source === 'fallback',
  describeCapacity(fallback.channels, fallback.source),
);
const env = loadVoiceChannels({ envChannels: 'MA_X:+919111111111;MA_X:+919222222222;MA_X:+919333333333;MA_X:+919444444444' });
check('a configured deployment reports its real channels', env.source === 'env' && channelCapacity(env.channels) === 4, describeCapacity(env.channels, env.source));

console.log('\n▸ every lead dials out on a channel we pay for');
const seeds = Array.from({ length: 60 }, (_, i) => `lead-${i}`);
const picked = seeds.map((s) => pickChannel(three, s)?.number);
const distinct = new Set(picked);
check('calls spread across all channels rather than pinning one', distinct.size === 3, [...distinct].join(', '));
check('the same lead always goes out on the same line', pickChannel(three, 'lead-7')?.number === pickChannel(three, 'lead-7')?.number);
const spread = [...distinct].map((number) => picked.filter((p) => p === number).length);
check('the spread is even enough to use the capacity', Math.max(...spread) - Math.min(...spread) <= 6, spread.join(' / '));

// ── 4. The real queue, right now, for the admin account.
console.log('\n▸ the real queue today (read-only)');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);
const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const { data: liveLeads } = await sb
  .from('leads')
  .select('id, user_id, phone, name, created_at, voice_call_retry_count, voice_call_status, pipeline_stage, last_call_at, custom_fields, booked_time, processing_lock_until')
  .eq('user_id', ADMIN)
  .order('created_at', { ascending: false })
  .limit(400);
const live = prioritiseCallQueue((liveLeads ?? []).map(toQueueRow), { now: new Date(), freshHours: 24, maxAttempts: 3 });
const summary = summariseQueue(live);
console.log(`  leads: ${summary.total} · in queue: ${summary.inQueue} (just arrived ${summary.justArrived}, never contacted ${summary.neverContacted}, retry ${summary.retryDue})`);
console.log(`  skipped: ${Object.entries(summary.skipped).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
for (const decision of live.filter((d) => d.inQueue).slice(0, 5)) {
  console.log(`    → ${decision.name ?? '(no name)'} — ${decision.reason}`);
}
const { data: profile } = await sb
  .from('profiles')
  .select('business_info, voice_concurrency_limit, voice_vobiz_number')
  .eq('id', ADMIN)
  .maybeSingle();
const adminChannels = loadVoiceChannels({
  profileNumber: profile?.voice_vobiz_number,
  businessInfo: profile?.business_info,
  concurrencyLimit: profile?.voice_concurrency_limit,
});
console.log(`  capacity: ${describeCapacity(adminChannels.channels, adminChannels.source)}`);
check('the live queue is a real answer, not an empty list', summary.total > 0, `${summary.total} leads examined`);
check('and it states its capacity', /simultaneous call/.test(describeCapacity(adminChannels.channels, adminChannels.source)), describeCapacity(adminChannels.channels, adminChannels.source));
check('queue members all carry a readable reason', live.filter((d) => d.inQueue).every((d) => d.reason.length > 5));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
