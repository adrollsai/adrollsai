/**
 * Gate for recording recovery.
 *
 * The rules here are the ones that protect a customer's call audio: a lead is matched at most once, a
 * recording is used at most once, the phone must agree on its last ten digits, and a duplicate phone
 * resolves to the lead whose last call is closest to the recording's timestamp. Pure — no carrier, no
 * database, no clock.
 */
import {
  listRecentRecordings,
  matchRecordingsToLeads,
  parseCarrierRecording,
  parseCarrierRecordingList,
  phoneKey,
  type CarrierRecording,
} from '../lib/automation/vobiz-recordings';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

// ── phone normalisation ────────────────────────────────────────────────────
console.log('\n=== phone keys: the last ten digits, whatever the format ===');
check('a +91 spaced number', phoneKey('+91 95359 13058') === '9535913058', phoneKey('+91 95359 13058'));
check('a bare country code', phoneKey('919535913058') === '9535913058', phoneKey('919535913058'));
check('dashes and brackets', phoneKey('(+91) 95359-13058') === '9535913058', phoneKey('(+91) 95359-13058'));
check('a short number is kept as-is', phoneKey('12345') === '12345');
check('empty is empty', phoneKey('') === '' && phoneKey(null) === '');

// ── parsing the carrier item ───────────────────────────────────────────────
console.log('\n=== parsing a carrier item ===');
const sample = {
  add_time: '2026-11-25 17:33:44.667486+05:30',
  call_uuid: 'e6ee4622-fdc8-4ecf-bef2-1b4ace02601a',
  recording_url: 'https://media.vobiz.ai/v1/Account/X/Recording/abc/',
  recording_duration_ms: '21600.00000',
  recording_type: 'call',
  to_number: '919535913058',
};
const parsed = parseCarrierRecording(sample);
check('a real item parses', parsed !== null);
check('the uuid survives', parsed?.callUuid === sample.call_uuid);
check('the dialled number survives', parsed?.toNumber === '919535913058');
check('the duration is a number of ms', parsed?.durationMs === 21600);

check('an item with no recording url is dropped', parseCarrierRecording({ ...sample, recording_url: '' }) === null);
check('an item with no uuid is dropped', parseCarrierRecording({ ...sample, call_uuid: '' }) === null);
check('a non-call recording type is dropped', parseCarrierRecording({ ...sample, recording_type: 'conference' }) === null);
check('garbage is dropped', parseCarrierRecording('nope') === null && parseCarrierRecording(null) === null);

const list = parseCarrierRecordingList({
  objects: [sample, sample, { ...sample, call_uuid: 'second', to_number: '919000000001' }, { junk: true }],
});
check('the list dedupes by call uuid', list.length === 2, String(list.length));
check('the list survives an empty body', parseCarrierRecordingList({}).length === 0);
check('the list survives a null body', parseCarrierRecordingList(null).length === 0);

// ── matching ───────────────────────────────────────────────────────────────
console.log('\n=== matching: one lead, one recording, phone must agree ===');
const rec = (uuid: string, to: string, addTime = '2026-11-25 10:00:00+05:30'): CarrierRecording => ({
  callUuid: uuid,
  toNumber: to,
  recordingUrl: `https://media.vobiz.ai/${uuid}`,
  durationMs: 5000,
  addTime,
});

const one = matchRecordingsToLeads([rec('a', '919535913058')], [{ id: 'lead-1', phone: '+91 95359 13058' }]);
check('a phone match is made', one.length === 1 && one[0].leadId === 'lead-1');
check('the reason names the phone agreement', /ends 9535913058/.test(one[0].because), one[0].because);

check(
  'a different phone does not match',
  matchRecordingsToLeads([rec('a', '919000000000')], [{ id: 'lead-1', phone: '+919535913058' }]).length === 0,
);
check(
  'a lead with no phone is never matched',
  matchRecordingsToLeads([rec('a', '919535913058')], [{ id: 'lead-1', phone: null }]).length === 0,
);

const twoRecOneLead = matchRecordingsToLeads(
  [rec('a', '919535913058'), rec('b', '919535913058')],
  [{ id: 'lead-1', phone: '9535913058' }],
);
check('a lead is matched at most once', twoRecOneLead.length === 1);

const oneRecTwoLeads = matchRecordingsToLeads(
  [rec('a', '919535913058')],
  [
    { id: 'lead-1', phone: '9535913058' },
    { id: 'lead-2', phone: '9535913058' },
  ],
);
check('a recording is used at most once', oneRecTwoLeads.length === 1);

// duplicate phone: the lead whose last call is closest to the recording wins
const dup = matchRecordingsToLeads(
  [rec('a', '919535913058', '2026-11-25 10:00:00+05:30')],
  [
    { id: 'far', phone: '9535913058', lastCallAt: '2026-11-01T00:00:00+05:30' },
    { id: 'near', phone: '9535913058', lastCallAt: '2026-11-25T09:50:00+05:30' },
  ],
);
check('a duplicate phone resolves to the nearest call', dup.length === 1 && dup[0].leadId === 'near', dup[0]?.leadId);

check('nothing to match returns nothing', matchRecordingsToLeads([], [{ id: 'x', phone: '9535913058' }]).length === 0);
check('no leads returns nothing', matchRecordingsToLeads([rec('a', '919535913058')], []).length === 0);

// ── listing ────────────────────────────────────────────────────────────────
console.log('\n=== listing: pages, and stops when a page repeats ===');
const pageOne = { objects: [sample, { ...sample, call_uuid: 'u2', to_number: '919000000002' }] };
const pageTwo = { objects: [{ ...sample, call_uuid: 'u3', to_number: '919000000003' }] };
const repeatPage = { objects: pageOne.objects }; // a carrier that ignores offset

let calls = 0;
const fakeFetch = (pages: unknown[]) => async () => {
  const body = pages[Math.min(calls, pages.length - 1)];
  calls += 1;
  return { ok: true, json: async () => body } as any;
};

calls = 0;
const two = await listRecentRecordings({ authId: 'A', authToken: 'T', fetchImpl: fakeFetch([pageOne, pageTwo]) });
check('two pages are collected', two.length === 3, String(two.length));

calls = 0;
const stopped = await listRecentRecordings({
  authId: 'A',
  authToken: 'T',
  maxPages: 5,
  fetchImpl: fakeFetch([pageOne, repeatPage, repeatPage]),
});
check('a repeating page stops the paging', calls <= 2, `fetch calls: ${calls}`);

calls = 0;
const none = await listRecentRecordings({ authId: '', authToken: '', fetchImpl: fakeFetch([pageOne]) });
check('no credentials means no request', none.length === 0 && calls === 0);

const failing = async () => ({ ok: false, json: async () => ({}) }) as any;
check('a failing carrier returns nothing', (await listRecentRecordings({ authId: 'A', authToken: 'T', fetchImpl: failing })).length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
