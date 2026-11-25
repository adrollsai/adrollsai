/**
 * What happens to a lead's owner when it re-enquires — and what the new owner may see.
 *
 * THE CASE
 * Blue Square's lead "Gaurav" was Gunheer's. She called him, found he runs a YouTube channel rather
 * than buying, and put him in Lost/NI. The next day he re-enquired through Magicbricks for a DIFFERENT
 * project (Vintage Greens, not The Medallion Aurum) and came back owned by Shubha Baweja.
 *
 * Two things were wrong, and they are separable:
 *
 *   1. The reassignment itself is right — a different project is new work — but nothing in the
 *      history said the lead had re-enquired, and the reopen count that the CRM badge reads was never
 *      written by the Magicbricks or Housing handlers at all. So the lead appeared to change hands
 *      for no reason.
 *   2. The new agent inherited the previous agent's whole working history on that person: her call
 *      notes, her stage changes, her read of a different requirement.
 *
 * The rule now: same project keeps its owner; a different project may move, and when it does the
 * previous history is hidden behind the existing transfer cutoff (`history_visible_from`), which hides
 * it from non-admin viewers and always keeps the lead's SOURCE and the reopen itself.
 *
 *   npm run verify:reopen-keeps-owner
 */
import {
  decideReopenOwner,
  isDifferentProject,
  reopenCustomFields,
} from '../lib/crm/reopen-owner';
import { filterHistoryForViewer, isAlwaysVisibleHistoryItem } from '../utils/lead-visibility';
import fs from 'node:fs';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  const shown = typeof detail === 'string' ? detail : JSON.stringify(detail);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${shown ? `\n         ${shown}` : ''}`);
  }
}

const GUNHEER = 'gunheer';
const SHUBHA = 'shubha';

console.log('\n▸ is this the same project?');
check('identical labels are the same project', !isDifferentProject('Vintage Greens', 'Vintage Greens'));
check('the portal prefix does not make it different', !isDifferentProject('Magicbricks - Vintage Greens', 'Vintage Greens'));
check('case and punctuation do not make it different', !isDifferentProject('VINTAGE  greens.', 'vintage greens'));
check('a different project IS different', isDifferentProject('The Medallion Aurum', 'Vintage Greens'));
check('an unknown previous source is treated as the same project', !isDifferentProject(null, 'Vintage Greens'));

console.log('\n▸ the reported case: a different project moves the lead, and closes the old book');
{
  const decision = decideReopenOwner({
    previousOwner: GUNHEER,
    candidate: SHUBHA,
    previousSource: 'The Medallion Aurum',
    nextSource: 'Vintage Greens',
  });
  check('it goes to the new agent', decision.owner === SHUBHA, decision);
  check('it is recorded as a reassignment', decision.reassigned === true);
  check('the previous history is hidden from the new agent', decision.hidePreviousHistory === true);
}

console.log('\n▸ the same project keeps its owner, and keeps its history');
{
  const decision = decideReopenOwner({
    previousOwner: GUNHEER,
    candidate: SHUBHA,
    previousSource: 'Magicbricks - Vintage Greens',
    nextSource: 'Vintage Greens',
  });
  check('the owner does not change', decision.owner === GUNHEER, decision);
  check('nothing is hidden from them', decision.hidePreviousHistory === false);
}

console.log('\n▸ an unowned lead still gets assigned');
{
  const decision = decideReopenOwner({ previousOwner: null, candidate: SHUBHA, previousSource: null, nextSource: 'Vintage Greens' });
  check('the candidate takes it', decision.owner === SHUBHA);
  check('and nothing is hidden (there is no previous owner)', decision.hidePreviousHistory === false);
}

console.log('\n▸ the reopen is counted, so the CRM badge can show it');
{
  const first = reopenCustomFields({ existing: {}, nextSource: 'The Medallion Aurum', previousSource: null });
  check('the first reopen counts as 1', first.reopened_count === 1, first.reopened_count);
  check('it records the source it came back for', first.last_reopened_source === 'The Medallion Aurum');
  check('it is flagged as reopened', first.is_reopened === true);

  const second = reopenCustomFields({ existing: first, nextSource: 'Vintage Greens', previousSource: 'The Medallion Aurum' });
  check('the second reopen counts as 2', second.reopened_count === 2, second.reopened_count);
  check('both projects are on record', Array.isArray(second.reopened_sources) && second.reopened_sources.length === 2, second.reopened_sources);
  check('the previous keys survive', second.last_reopened_at !== undefined);
}

console.log('\n▸ what the new agent actually sees');
{
  const cutoff = '2026-11-24T09:54:00.000Z';
  const lead = { custom_fields: { history_visible_from: cutoff } };
  const history = [
    { action_type: 'REMARK', description: '📞 Outbound call initiated by Gunheer', created_at: '2026-11-22T12:48:00.000Z' },
    { action_type: 'STATUS_CHANGE', description: 'Stage: Lost/NI', created_at: '2026-11-23T09:17:00.000Z' },
    { action_type: 'REOPENED', description: 'Lead re-enquired via Magicbricks. Source Details: Vintage Greens.', created_at: '2026-11-24T09:54:23.000Z' },
  ];

  const agentSees = filterHistoryForViewer(history, lead, 'agent');
  check('the previous call note is hidden from the new agent', !agentSees.some((h) => h.action_type === 'REMARK'), agentSees.map((h) => h.action_type));
  check('the previous stage change is hidden', !agentSees.some((h) => h.action_type === 'STATUS_CHANGE'));
  check('the reopen itself stays visible', agentSees.some((h) => h.action_type === 'REOPENED'), agentSees.map((h) => h.action_type));

  const adminSees = filterHistoryForViewer(history, lead, 'admin');
  check('an admin still sees everything', adminSees.length === 3, adminSees.length);

  // The lead's SOURCE is always readable, whatever the cutoff says.
  const sourceRow = { action_type: 'CREATED', description: 'Lead Source : Magicbricks - Vintage Greens', created_at: '2026-11-22T12:42:00.000Z' };
  check('the lead source is always visible', isAlwaysVisibleHistoryItem(sourceRow));
}

console.log('\n▸ every reopen handler uses the shared decision');
for (const file of [
  'app/api/webhooks/magicbricks/magicbricks-handler.ts',
  'app/api/webhooks/housing/[token]/route.ts',
  'app/api/webhooks/facebook/route.ts',
  'app/api/cron/sync-meta-leads/route.ts',
]) {
  const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  check(`${file.split('/').slice(-2).join('/')} decides through lib/crm/reopen-owner`, /decideReopenOwner\(/.test(src));
}

console.log('\n▸ the portal handlers record the reopen count');
for (const file of [
  'app/api/webhooks/magicbricks/magicbricks-handler.ts',
  'app/api/webhooks/housing/[token]/route.ts',
]) {
  const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  check(`${file.split('/').slice(-2).join('/')} writes reopen bookkeeping`, /reopenCustomFields\(/.test(src));
}

console.log('\n================================================================');
if (fail === 0) {
  console.log(`${pass} passed, 0 failed`);
  process.exit(0);
} else {
  console.log(`${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
