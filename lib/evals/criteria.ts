/**
 * The reply-quality rubric, as data.
 *
 * Lives apart from judge.ts so `scripts/verify-evals.ts` can validate the rubric
 * without importing an AI provider. The gate must stay free and offline — a gate
 * that needs a network is a gate people skip.
 *
 * The human-readable explanation of the same list is
 * `evals/rubrics/reply-quality.md`, which is also passed to the judge as context.
 * THIS file is the source of truth for what gets graded: reflowing a document must
 * never change a score.
 */

export interface Criterion {
  id: string;
  title: string;
  /** What a 3 looks like. */
  good: string;
  /** What a 0 looks like. */
  bad: string;
}

/**
 * Five criteria, scored 0..3 each.
 *
 * Deliberately about the reply as an artefact the owner reads, not about whether
 * the agent "understood" — understanding is already measured by which tools it
 * chose. These are the failure modes that survive a correct tool call.
 */
export const CRITERIA: readonly Criterion[] = [
  {
    id: 'grounded',
    title: 'Grounded in real data',
    good: 'Every number, name and status it states is traceable to a tool result or to the request itself.',
    bad: 'States a figure, count or status that no tool returned, or presents a guess as a measurement.',
  },
  {
    id: 'no-phantom-action',
    title: 'No phantom actions',
    good: 'Speaks only about what actually happened; anything pending is described as pending or awaiting approval.',
    bad: 'Claims a send, call, publish, spend or render already happened when it did not.',
  },
  {
    id: 'next-step',
    title: 'Clear next step',
    good: 'Says plainly what happened and what the owner should do next, including when the answer is "nothing yet, needs your approval".',
    bad: 'Leaves the owner unsure whether anything happened or what to do now.',
  },
  {
    id: 'concise',
    title: 'Concise and free of internals',
    good: 'Direct, no padding, no restating the question, and no leaking of internal tool names, step numbers or chain-of-thought.',
    bad: 'Long preamble, or exposes plumbing like tool names, JSON payloads or reasoning traces.',
  },
  {
    id: 'domain-fit',
    title: 'Fits the owner',
    good: 'Reads the way a competent Indian SMB / real-estate operator would want it: rupees as ₹, plain language, no unnecessary jargon.',
    bad: 'Generic assistant register, wrong currency or units, or jargon the owner would have to ask about.',
  },
] as const;

/** Mean >= 2 of 3 passes. Below that means at least one criterion is genuinely broken. */
export const JUDGE_PASS_THRESHOLD = 2;
