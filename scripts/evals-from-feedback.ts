/* eslint-disable @typescript-eslint/no-explicit-any --
 * CLI script reading untyped feedback rows, whose payload column is free-form JSON by design.
 */
/**
 * Turn real customer corrections into DRAFT eval cases.
 *
 *   npm run eval:drafts
 *   npm run eval:drafts -- --since=30 --limit=50
 *
 * THE POINT
 * `lib/agent/feedback-engine.ts` already records every discrepancy an owner
 * reports (`agent_feedback_issues`, falling back to `agent_events` with
 * event_type AGENT_FEEDBACK_ISSUE). Today those rows become a ticket and then
 * nothing. This script turns them into the raw material of the eval corpus, which
 * is the one asset a competitor cannot copy: a growing, graded record of exactly
 * where this agent fails for Indian real-estate and SMB owners.
 *
 * DRAFTS ARE NOT SCORED. They land in `evals/cases/drafts/`, which the suite
 * loader never reads. A proposed case has not been reviewed, has no verified
 * correct answer, and often no known tool expectation — letting one into the
 * scored suite would manufacture failures and teach everyone to ignore the
 * numbers. Promote a draft by moving it into `evals/cases/` and filling in the
 * assertions.
 *
 * Every draft is emitted with an `_reviewRequired` note explaining what a human
 * still has to decide.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { findRepoRoot } from '../lib/evals/cases';
import type { EvalSeries, EvalSeverity } from '../lib/evals/types';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit === `--${name}` ? 'true' : hit.slice(name.length + 3);
}
const num = (name: string, fallback: number) => {
  const v = Number(arg(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Feedback category -> eval series. Anything unmapped is a reliability issue. */
const SERIES_BY_CATEGORY: Record<string, EvalSeries> = {
  CAMPAIGN_CREATION: 'ads',
  VOICE_CALLING: 'automation',
  WHATSAPP_MESSAGING: 'publishing',
  UNDERSTANDING_ERROR: 'reliability',
  TOOL_FAILURE: 'reliability',
  GENERAL: 'reliability',
};

/**
 * Reported severity -> eval severity.
 *
 * Deliberately conservative: a single user correction is not automatically
 * "critical". Critical is reserved for money, customers and data loss, and it
 * makes the whole run fail — so inflating it would make the suite un-passable.
 */
const SEVERITY_MAP: Record<string, EvalSeverity> = {
  LOW: 'normal',
  MEDIUM: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
};

function kebab(input: string, max = 48): string {
  const slug = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'case';
}

interface FeedbackRow {
  ticket_number?: string;
  source?: string;
  category?: string;
  severity?: string;
  user_prompt?: string;
  agent_action?: string;
  discrepancy?: string;
  user_correction?: string;
  suggested_fix?: string;
  created_at?: string;
}

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('No Supabase credentials in .env.local');
    process.exit(3);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const days = num('since', 90);
  const limit = num('limit', 100);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Preferred source: the dedicated table. Fall back to the event log, which is
  // where feedback-engine.ts writes when the table is absent.
  let rows: FeedbackRow[] = [];
  const primary = await sb
    .from('agent_feedback_issues')
    .select('ticket_number, source, category, severity, user_prompt, agent_action, discrepancy, user_correction, suggested_fix, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!primary.error && Array.isArray(primary.data)) {
    rows = primary.data as FeedbackRow[];
  } else {
    console.log(`agent_feedback_issues unavailable (${primary.error?.message ?? 'no rows'}) — reading agent_events instead`);
    const fallback = await sb
      .from('agent_events')
      .select('payload, created_at')
      .eq('event_type', 'AGENT_FEEDBACK_ISSUE')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fallback.error) {
      console.error(`Could not read feedback: ${fallback.error.message}`);
      process.exit(3);
    }
    rows = (fallback.data ?? []).map((e: any) => ({ ...(e.payload ?? {}), created_at: e.created_at }));
  }

  // Only rows with a real prompt can become a case: without the words the owner
  // actually typed, there is nothing to replay.
  const usable = rows.filter((r) => (r.user_prompt ?? '').trim().length >= 4);

  if (!usable.length) {
    console.log(`No usable feedback in the last ${days} days (${rows.length} row(s), none with a user prompt).`);
    console.log('Cases are promoted from real corrections — nothing to do until one arrives.');
    return;
  }

  const root = findRepoRoot();
  const outDir = path.join(root, 'evals', 'cases', 'drafts');
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  const skipped: string[] = [];

  for (const row of usable) {
    const prompt = (row.user_prompt ?? '').trim();
    // A 4000-character prompt is a pasted document, not a request a case can replay.
    if (prompt.length > 2000) {
      skipped.push(`${row.ticket_number ?? '(no ticket)'}: prompt too long (${prompt.length} chars)`);
      continue;
    }

    const series = SERIES_BY_CATEGORY[row.category ?? 'GENERAL'] ?? 'reliability';
    const severity = SEVERITY_MAP[row.severity ?? 'MEDIUM'] ?? 'normal';

    // Stable id so re-running does not create duplicates for the same ticket.
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${row.ticket_number ?? ''}|${prompt}`)
      .digest('hex')
      .slice(0, 6);
    const id = `draft-${series}-${kebab(row.discrepancy ?? prompt, 40)}-${fingerprint}`;

    const draft = {
      id,
      title: (row.discrepancy ?? prompt).slice(0, 120),
      series,
      severity,
      tier: 'behaviour',
      prompt,
      judge: true,
      notes: [
        'DRAFT — promoted from real customer feedback, not yet reviewed. Not run by the suite.',
        '',
        `_reviewRequired: fill in expectAnyTool / forbidTools / replyMust / replyMustNot, then move this`,
        '_file into evals/cases/ and run `npm run eval:context -- --list` to confirm it validates.',
        '',
        `ticket:        ${row.ticket_number ?? '(none)'}`,
        `source:        ${row.source ?? '(unknown)'}`,
        `category:      ${row.category ?? '(unknown)'}  -> series ${series}`,
        `reported:      ${row.created_at ?? '(unknown)'}`,
        `owner prompt:  ${prompt}`,
        `agent action:  ${row.agent_action ?? '(not recorded)'}`,
        `discrepancy:   ${row.discrepancy ?? '(not recorded)'}`,
        `owner's fix:   ${row.user_correction ?? '(not recorded)'}`,
        `suggested fix: ${row.suggested_fix ?? '(not recorded)'}`,
        '',
        '_severity was mapped from the reported severity and MUST be reviewed:',
        '_critical fails the whole suite, so reserve it for money, customer contact and data loss.',
      ].join('\n'),
    };

    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(draft, null, 2), 'utf8');
    written++;
  }

  console.log(`\nWrote ${written} draft case(s) to evals/cases/drafts/`);
  for (const s of skipped) console.log(`  skipped — ${s}`);
  console.log('\nDrafts are NOT scored by the suite. To promote one:');
  console.log('  1. add its assertions (expectAnyTool / forbidTools / replyMust / replyMustNot)');
  console.log('  2. move the file into evals/cases/');
  console.log('  3. npm run eval:context -- --list      (validates it)');
  console.log('');
})().catch((err) => {
  console.error('failed:', err?.message || err);
  process.exit(3);
});
