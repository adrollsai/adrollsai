/**
 * Extend the max-rows gate to police the WHOLE tree, not three files.
 *
 * The 1000-row cap bit in five places the owner noticed and several they had not:
 *   org_lead_report        "1,000 leads all-time" for an org with tens of thousands   -> fixed
 *   the action report      attempt counts from a 1000-row slice of lead_history        -> fixed
 *   the talk-time sum      seconds added up from a 1000-row slice of call_logs         -> fixed
 *   CEO metrics            every CEO figure computed from a truncated slice            -> fixed
 *   the business plan      the month's leads counted from its first thousand           -> fixed
 *   harness event replay   a long session lost its later events on resume              -> fixed
 *
 * The exceptions below are DELIBERATE and each says why. Anything else that asks for more than one
 * page in a single request fails this gate.
 *
 *   npm run verify:max-rows
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['app', 'lib', 'utils', 'components'];
const EXT = new Set(['.ts', '.tsx']);

/**
 * Files/limits that are allowed to ask for more than 1000 rows in one request.
 *
 * Every entry is a decision, not an oversight:
 */
const ALLOWED = [
  {
    file: 'lib/supabase/paged.ts',
    why: 'the helper itself; PAGE_SIZE is the cap it enforces',
  },
  {
    file: 'lib/agent/approval-whatsapp.ts',
    why: 'a scan of profiles for an approval number; the platform has ~100 accounts, so 2000 is a ceiling that will never truncate',
  },
  {
    file: 'lib/agent/owner-orchestrator.ts',
    why: 'bounded CONTEXT for an inbound WhatsApp reply (recent messages/leads), not a figure quoted as a total — and paging here would add seconds to every inbound message',
  },
  {
    file: 'lib/agent/harness/runs.ts',
    why: 'idempotency probe over one session\u2019s tool.call events; a session with >1000 tool calls in one run is already beyond the turn budget',
  },
  {
    file: 'app/api/agent/ceo/findings/route.ts',
    why: 'reads a bounded day window of findings',
  },
  {
    file: 'app/dashboard/ads/page.tsx',
    why: 'the ads screen attribution map, which only needs recent leads per campaign',
  },
];

const findings = [];
const allowedHits = [];

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\s\/\/.*$/gm, ' ');

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', '.work', '.git'].includes(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!EXT.has(path.extname(entry.name))) continue;
    const rel = full.split(path.sep).join('/');
    const source = stripComments(fs.readFileSync(full, 'utf8'));
    for (const match of source.matchAll(/\.limit\(\s*(\d{4,})\s*\)/g)) {
      const limit = Number(match[1]);
      if (limit <= 1000) continue;
      const entry = { file: rel, limit };
      const allowed = ALLOWED.find((a) => rel.endsWith(a.file));
      if (allowed) allowedHits.push({ ...entry, why: allowed.why });
      else findings.push(entry);
    }
  }
};

ROOTS.forEach(walk);

console.log(`\n▸ no single request asks for more than one page (${findings.length} violation(s))`);
for (const f of findings) console.log(`  FAIL ${f.file} asks for ${f.limit} rows in one request`);
if (!findings.length) {
  console.log(`  ok   clean across ${ROOTS.join(', ')}`);
}
console.log(`\n▸ documented exceptions (${allowedHits.length})`);
for (const a of allowedHits) console.log(`  · ${a.file} (${a.limit}) — ${a.why}`);
for (const a of ALLOWED) {
  const used = allowedHits.some((h) => h.file.endsWith(a.file));
  if (!used) console.log(`  note: exception for ${a.file} is no longer needed (no wide limit found)`);
}

console.log(`\n${'='.repeat(64)}\n${findings.length ? 'FAILED' : `PASS — ${allowedHits.length} documented exception(s), 0 violations`}`);
if (findings.length) process.exitCode = 1;
