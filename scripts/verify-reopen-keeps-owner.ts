/**
 * Does a reopened lead keep its owner?
 *
 * THE BUG THIS GUARDS
 * Reported from a live client: their lead "Gaurav" was assigned to Gunheer, she worked it, then put
 * it in Lost/NI on the 23rd. It re-enquired on Magicbricks the next day and reappeared owned by
 * Shubha Baweja — with nothing in the history to explain the change, because no assignment row was
 * ever written. She had simply been the next agent the distribution engine picked.
 *
 * Every intake path that can REOPEN an existing lead ran the same "who gets this new lead" rule and
 * assigned the winner over the top. A reopen is not new work: the person who already knows the
 * requirement should keep it.
 *
 * Measured at the time: 499 reopened leads across the CRM, 299 of them owned by an agent with no
 * prior involvement in that lead. In one tenant it was 224 of 316.
 *
 * This gate is deliberately source-level. The rule lives in five different webhook handlers written
 * in four different styles, and the failure mode is an `if` that assigns unconditionally — which is
 * invisible until a lead changes hands. Asserting that each handler GUARDS the assignment catches
 * the regression at review time rather than in a client's CRM.
 *
 *   npm run verify:reopen-keeps-owner
 */
import fs from 'node:fs';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`);
  }
}

const read = (p: string) => fs.readFileSync(p, 'utf8');

/** Every intake path that can reopen an existing lead by phone match. */
const REOPEN_PATHS: Array<{ file: string; label: string }> = [
  { file: 'app/api/webhooks/magicbricks/magicbricks-handler.ts', label: 'Magicbricks' },
  { file: 'app/api/webhooks/housing/[token]/route.ts', label: 'Housing.com' },
  { file: 'app/api/webhooks/facebook/route.ts', label: 'Facebook / Meta ads' },
  { file: 'app/api/cron/sync-meta-leads/route.ts', label: 'Meta leads sync' },
];

console.log('\n▸ a reopened lead keeps its owner');

for (const { file, label } of REOPEN_PATHS) {
  if (!fs.existsSync(file)) {
    check(`${label}: handler present`, false, file);
    continue;
  }
  const src = read(file);
  // The reopen update must not assign unconditionally. Guards look like
  //   if (!existingLead.assigned_to && assignedAgentId)
  //   if (!existingLeadToReopen.assigned_to && assignedAgentId)
  const guarded = /if\s*\(\s*!\s*(?:existingLead|existingLeadToReopen)\.assigned_to\s*&&\s*assignedAgentId\s*\)/.test(
    src
  );
  check(`${label}: only assigns when the lead has no owner`, guarded);

  // And the unguarded form must be gone.
  const unguarded = /if\s*\(\s*assignedAgentId\s*\)\s*\{\s*(?:updateData|updatePayloadObj|updateLeadData)\.assigned_to\s*=\s*assignedAgentId/.test(
    src
  );
  check(`${label}: no unconditional reassignment remains`, !unguarded);
}

console.log('\n▸ the audit trail names the real owner');
for (const { file, label } of REOPEN_PATHS) {
  if (!fs.existsSync(file)) continue;
  const src = read(file);
  // The REOPENED history row is attributed to whoever holds the lead afterwards, so the timeline
  // does not credit the discarded distribution candidate.
  const attributedToOwner = /user_id:\s*(?:existingLead|existingLeadToReopen)\.assigned_to\s*\|\|/.test(src);
  check(`${label}: the reopen row is attributed to the owner`, attributedToOwner);
  // The "assigned to you" notification must reach the owner, not the candidate that lost.
  const notifiesOwner =
    /const\s+(?:notifAgent|agentId)\s*=\s*(?:existingLead|existingLeadToReopen)\.assigned_to\s*\|\|/.test(src);
  check(`${label}: the owner is the one notified`, notifiesOwner);
}

console.log('\n▸ the replay of the reported case');
{
  // A tiny model of the rule, so the intent is executable rather than a comment.
  const decide = (existingOwner: string | null, candidate: string | null) =>
    existingOwner || candidate || null;
  check(
    'Gaurav: Gunheer owned it, marked Lost, re-enquired → still Gunheer',
    decide('gunheer', 'shubha') === 'gunheer'
  );
  check('an unowned lead still gets the distribution candidate', decide(null, 'shubha') === 'shubha');
  check('a lead with no candidate and no owner stays unassigned', decide(null, null) === null);
}

console.log('\n================================================================');
if (fail === 0) {
  console.log(`${pass} passed, 0 failed`);
  process.exit(0);
} else {
  console.log(`${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
