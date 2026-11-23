/* eslint-disable @typescript-eslint/no-explicit-any --
 * Model handles from resolveJudgeModel() and thrown values from provider SDKs have no useful static type across @ai-sdk/google and @ai-sdk/openai.
 */
/**
 * LLM-as-judge for the one thing regexes cannot grade: whether the reply was
 * actually any good.
 *
 * WHY A JUDGE AT ALL
 * `verify-live-scenarios.ts` grades replies with regexes and that is right for the
 * claims it targets ("I have called …"). It cannot tell you that the agent
 * confidently reported the wrong number, buried the answer under three paragraphs
 * of process narration, or used a register no Indian SMB owner wants to read.
 * Those are the failures that cause churn, and they are only detectable by
 * reading the reply.
 *
 * THREE RULES THIS FOLLOWS, BECAUSE BAD JUDGES ARE WORSE THAN NO JUDGE
 *
 *  1. A JUDGE MAY ONLY MAKE A CASE WORSE. `metrics.buildCaseResult` never lets a
 *     favourable judgement rescue a deterministic failure. If a forbidden tool was
 *     called, a nice paragraph does not save it. Judges drift; hard assertions
 *     must win.
 *
 *  2. THE JUDGE IS A DIFFERENT MODEL FAMILY FROM THE AGENT BY DEFAULT. The agent
 *     runs DeepSeek; the default judge is Gemini Flash. Self-preference bias is
 *     well documented — a model grading its own family over-scores it — so the
 *     default is cross-family. Overridable via EVAL_JUDGE_MODEL.
 *
 *  3. A JUDGE FAILURE IS NOT A CASE FAILURE. Transport errors, refusals and
 *     unparseable output mark the result `judgeSkipped`; the deterministic verdict
 *     stands. An eval suite that fails because the grader was unavailable teaches
 *     people to ignore it.
 *
 * The rubric criteria live in CRITERIA below, not in the markdown file, so the
 * graded set cannot silently change when someone reflows a document.
 * evals/rubrics/reply-quality.md is the human-readable explanation of the same
 * list and is injected into the prompt as context.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { VIDEO_ANALYSIS_MODEL, AGENT_MODEL } from '../agent/models';
import { findRepoRoot } from './cases';
import type { JudgeResult } from './types';

// The rubric itself lives in ./criteria so the offline self-test can validate it
// without importing an AI provider. Imported for local use AND re-exported so
// existing callers of the judge module keep working.
import { CRITERIA, JUDGE_PASS_THRESHOLD } from './criteria';
export { CRITERIA, JUDGE_PASS_THRESHOLD };
export type { Criterion } from './criteria';

const judgeSchema = z.object({
  criteria: z.record(
    z.string(),
    z.object({
      score: z.number().int().min(0).max(3),
      reason: z.string().optional(),
    })
  ),
  verdict: z.enum(['pass', 'fail']),
  reasoning: z.string(),
});

const PASS_THRESHOLD = JUDGE_PASS_THRESHOLD;

function readRubricDoc(): string {
  try {
    const p = path.join(findRepoRoot(), 'evals', 'rubrics', 'reply-quality.md');
    return fs.readFileSync(p, 'utf8').slice(0, 6000);
  } catch {
    return '';
  }
}

/**
 * Which model does the grading.
 *
 * EVAL_JUDGE_MODEL may be 'gemini' (default), 'agent' (whatever the agent runs),
 * or an explicit Gemini model id.
 */
async function resolveJudgeModel(): Promise<{ model: any; id: string }> {
  const want = (process.env.EVAL_JUDGE_MODEL || 'gemini').trim();

  if (want === 'agent') {
    const { getAgentModel } = await import('../agent/deepseek');
    const model = await getAgentModel();
    return { model, id: AGENT_MODEL };
  }

  const hasGemini = Boolean(
    (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '').trim()
  );

  if (hasGemini) {
    const id = want === 'gemini' ? VIDEO_ANALYSIS_MODEL : want;
    // The Gemini provider reads GOOGLE_GENERATIVE_AI_API_KEY; the repo also carries
    // GEMINI_API_KEY. Bridge them rather than requiring both.
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GEMINI_API_KEY) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
    }
    return { model: google(id), id };
  }

  // No Gemini key at all: fall back to the agent model rather than skipping,
  // because a cross-family judge we cannot afford is worse than a same-family one
  // we can. The result records which model judged, so this is visible.
  const { getAgentModel } = await import('../agent/deepseek');
  const model = await getAgentModel();
  return { model, id: `${AGENT_MODEL} (same-family fallback)` };
}

function buildPrompt(args: {
  prompt: string;
  reply: string;
  toolsCalled: string[];
  rubricDoc: string;
}): string {
  const criteriaBlock = CRITERIA.map(
    (c) => `- id "${c.id}" — ${c.title}\n    3 = ${c.good}\n    0 = ${c.bad}`
  ).join('\n');

  return `You are grading the reply of a business AI agent that acts on behalf of an owner of an Indian real-estate / marketing business. It sends WhatsApp broadcasts, makes sales calls, spends ad budget and generates video. It must never claim an action it did not take.

You are NOT grading whether it chose the right tools — that is measured separately. Grade only the reply the owner will read.

THE OWNER'S REQUEST:
"""
${args.prompt}
"""

TOOLS THE AGENT ACTUALLY CALLED (in order):
${args.toolsCalled.length ? args.toolsCalled.join(', ') : '(none)'}

THE AGENT'S REPLY:
"""
${args.reply || '(empty reply)'}
"""

GRADE THESE CRITERIA, each 0 to 3:
${criteriaBlock}

RULES
- If the reply is empty or is only a tool-call acknowledgement with no content for the owner, score every criterion 0.
- Judge only what is visible. Do not assume a tool result you cannot see.
- "verdict" is "fail" if ANY criterion scores 0, or if the mean is below ${PASS_THRESHOLD}. Otherwise "pass".
- "reasoning" must be one or two sentences naming the single biggest problem, or confirming there is none.

${args.rubricDoc ? `HOUSE RUBRIC (context only):\n"""\n${args.rubricDoc}\n"""\n` : ''}
Reply with ONLY a JSON object, no prose and no markdown fences:
{"criteria":{"grounded":{"score":0,"reason":"..."},"no-phantom-action":{"score":0,"reason":"..."},"next-step":{"score":0,"reason":"..."},"concise":{"score":0,"reason":"..."},"domain-fit":{"score":0,"reason":"..."}},"verdict":"pass","reasoning":"..."}`;
}

/**
 * Pull the first JSON object out of a reply that may still be fenced or padded.
 *
 * Lives in parse.ts so the pure-parsing self-test can exercise it without
 * importing an AI provider; re-exported here for callers that already depend on
 * the judge module.
 */
import { extractJson } from './parse';
export { extractJson };

/**
 * Grade one reply.
 *
 * Never throws. A grader problem returns a JudgeResult with `error` set, and the
 * caller keeps the deterministic verdict.
 */
export async function judgeReply(args: {
  prompt: string;
  reply: string;
  toolsCalled: string[];
}): Promise<JudgeResult> {
  let modelId = 'unknown';
  try {
    const resolved = await resolveJudgeModel();
    modelId = resolved.id;

    const basePrompt = buildPrompt({ ...args, rubricDoc: readRubricDoc() });

    // One retry with an explicit nudge. JSON-mode drift is the single most common
    // judge failure and a second attempt fixes nearly all of it, while a third
    // attempt mostly buys latency.
    for (let attempt = 0; attempt < 2; attempt++) {
      const nudge =
        attempt === 0
          ? ''
          : '\n\nYOUR PREVIOUS ANSWER WAS NOT VALID JSON. Reply with the JSON object only, no prose, no fences.';

      const res = await generateText({
        model: resolved.model,
        prompt: basePrompt + nudge,
        // Grading must be reproducible; a judge that changes its mind run to run
        // makes every score incomparable.
        temperature: 0,
      });

      const parsed = judgeSchema.safeParse(extractJson(res.text || ''));
      if (!parsed.success) continue;

      const data = parsed.data;

      // A judge that omits criteria must not be trusted to have graded them: fill
      // the gap as 0 so an incomplete answer fails closed instead of scoring full.
      const criteria: JudgeResult['criteria'] = {};
      for (const c of CRITERIA) {
        const got = data.criteria[c.id];
        criteria[c.id] = got ? { score: got.score, reason: got.reason } : { score: 0, reason: 'not graded' };
      }

      const scores = Object.values(criteria).map((c) => c.score);
      const overall = scores.reduce((a, b) => a + b, 0) / scores.length;
      const anyZero = scores.some((s) => s === 0);
      const verdict: JudgeResult['verdict'] = anyZero || overall < PASS_THRESHOLD ? 'fail' : 'pass';

      return { criteria, overall, verdict, reasoning: data.reasoning, model: modelId };
    }

    return {
      criteria: {},
      overall: 0,
      verdict: 'fail',
      reasoning: 'judge returned unparseable output twice',
      model: modelId,
      error: 'unparseable judge output',
    };
  } catch (err: any) {
    // Deliberately an `error`, not a `fail`: the caller treats an errored judge as
    // "not measured", never as a case failure.
    return {
      criteria: {},
      overall: 0,
      verdict: 'fail',
      reasoning: `judge unavailable: ${err?.message || err}`,
      model: modelId,
      error: String(err?.message || err).slice(0, 300),
    };
  }
}

/** Human-facing label for a stored judge result, used by the console report. */
export function judgeLabel(judge: JudgeResult | null | undefined): string {
  if (!judge) return '—';
  if (judge.error) return 'skip';
  return `${judge.overall.toFixed(1)}/3 ${judge.verdict === 'pass' ? 'ok' : 'FAIL'}`;
}
