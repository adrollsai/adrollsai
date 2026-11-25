/**
 * THE LATENCY GATE.
 *
 * The complaint was "43.5 seconds to answer a one-line question". The causes were not one bug:
 *
 *   1. the read primitive the answer needed was behind `find_tools`, so the first step was spent
 *      discovering a tool the prompt already named;
 *   2. a count question was answered by exploring - the leads tool reported a PAGE of 50 as if it
 *      were the total, and a wrong column name produced an error that named no alternatives, so the
 *      model listed rows to work out the schema;
 *   3. the model was never told the date, so "how many today" fetched rows to infer it;
 *   4. the agent's functions ran in Vercel's default region (Washington DC) against a Supabase
 *      project in Singapore, so every event write, checkpoint and cancel check crossed the Pacific.
 *
 * Each of those regresses SILENTLY: the agent still answers, just slowly, and no correctness test
 * notices. So each one is pinned here. This gate is pure - it calls no model and writes nothing.
 *
 *   npm run verify:agent-latency
 */
import fs from 'node:fs';
import path from 'node:path';

import { HOT_TOOLS } from '../lib/agent/harness/tool-proxy';
import { validateQuery } from '../lib/agent/tools/data-query';
import { renderNowBlock } from '../lib/agent/orchestrator';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n== ${title} ${'='.repeat(Math.max(0, 60 - title.length))}`);

function source(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf8');
}

// ── 1. the read primitive travels inline ────────────────────────────────────
head('the one-call read primitive is on the surface');
check(
  'query_account_data is offered inline, not only behind find_tools',
  HOT_TOOLS.includes('query_account_data'),
  `inline set: ${HOT_TOOLS.length} tools`
);
check(
  'the discovery tools are still there for everything else',
  HOT_TOOLS.length > 0 && !HOT_TOOLS.includes('find_tools'),
  'find_tools/call_tool are added by the proxy, never by this list'
);

// ── 2. the prompt answers the small question small ──────────────────────────
head('the prompt steers short questions to one call');
const orchestrator = source('lib/agent/orchestrator.ts');
check(
  'the prompt states the date and the business timezone',
  /RIGHT NOW:/.test(orchestrator) && /renderNowBlock\(/.test(orchestrator),
  'a date filter needs both facts and the model cannot know either'
);
check(
  'the prompt tells the model not to go hunting for the read primitive',
  /do not go looking for a\s+different tool|do not go looking for a different tool/i.test(orchestrator),
  'the first step used to be a find_tools call'
);
/** verify:toolset enforces that the prompt never names a tool this turn was not given, so this
 *  guidance has to stay tool-agnostic: it may name the read primitive, which is always available. */
check(
  'the fast-path guidance names no tool the group selection may not have',
  !/ANSWER THE SMALL QUESTION SMALL[\s\S]{0,1600}?(find_tools|call_tool|org_lead_report)/.test(orchestrator),
  'naming an unregistered tool in the prompt breaks verify:toolset'
);
check(
  'the prompt says a lead page is not a lead count',
  /returns a PAGE of leads/i.test(orchestrator),
  'the page size was being quoted as a total'
);

const now = renderNowBlock('Asia/Kolkata');
check('renderNowBlock names the timezone', /Asia\/Kolkata/.test(now), now.split('\n')[0].slice(0, 90));
check('renderNowBlock carries a real date', /\d{4}/.test(now) && /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(now));
check(
  'renderNowBlock defines "today" rather than leaving it to guesswork',
  /"Today" means since 00:00/.test(now)
);
const noZone = renderNowBlock(null);
check(
  'a missing timezone falls back to UTC and SAYS so',
  /UTC/.test(noZone) && /no timezone set|no valid timezone/.test(noZone),
  noZone.split('\n')[0].slice(0, 90)
);

// ── 3. a wrong column name is fixable in one retry ──────────────────────────
head('column errors teach the retry');
const badGroup = validateQuery({ table: 'leads', groupBy: ['stage'] });
check('grouping on a non-column is refused', badGroup.ok === false, badGroup.error || '');
check(
  'the refusal names the real columns',
  Boolean(badGroup.error && /pipeline_stage/.test(badGroup.error)),
  'without the list the model reads rows to discover the schema'
);
const badFilter = validateQuery({ table: 'leads', filters: [{ column: 'nope', op: 'eq', value: 1 }] });
check('an unknown filter column is refused', badFilter.ok === false);
check(
  'the filter refusal names the real columns too',
  Boolean(badFilter.error && /pipeline_stage/.test(badFilter.error))
);

// ── 4. a page is never reported as a total ──────────────────────────────────
head('the leads tool reports a total, not a page size');
const mcpAll = source('lib/agent/mcp/nobogent_app_mcp.ts');
// Scoped to the leads tool: other tools in this file have their own answers to give.
const mcp = mcpAll.slice(
  mcpAll.indexOf('nobogent_crm_query_leads: tool({'),
  mcpAll.indexOf('nobogent_crm_create_lead: tool({')
);
check('the leads tool was found in the MCP registry', mcp.length > 500, `${mcp.length} chars`);
check('it returns totalMatching (exact head count)', /totalMatching/.test(mcp));
check('it returns the page size separately', /\breturned\b/.test(mcp));
check(
  'it no longer reports the page length as `count`',
  !/count:\s*data\?\.length/.test(mcp),
  'that line told a 1,584-lead account it had 50'
);
check('it counts with head:true, so the total is not capped', /head:\s*true/.test(mcp));

// ── 5. the agent runs next to the data ──────────────────────────────────────
head('the agent functions run in the database\'s region');
for (const route of [
  'app/api/agent/v2/runs/stream/route.ts',
  'app/api/agent/v2/chat/route.ts',
  'app/api/agent/v2/runs/route.ts',
  'app/api/agent/v2/runs/[id]/route.ts',
  'app/api/cron/harness-runner/route.ts',
]) {
  const text = source(route);
  check(
    `${route} pins preferredRegion = 'sin1'`,
    /export const preferredRegion = 'sin1'/.test(text),
    'default region is iad1; production Supabase is ap-southeast-1'
  );
}

// ── 6. the measurement itself cannot disappear ──────────────────────────────
head('per-step timing stays instrumented');
const runner = source('lib/agent/harness/runner.ts');
for (const field of ['model=', 'persist=', 'boundary=', 'cancel=', 'region=']) {
  check(`runner logs ${field}`, runner.includes(field));
}
check(
  'the step line prints the region it ran in',
  /runtimeRegion\(\)/.test(runner),
  'a cross-region round trip must be visible, not inferred'
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
