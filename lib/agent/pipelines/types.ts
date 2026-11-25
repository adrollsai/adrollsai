/**
 * Pipelines: the app's own workflows, available to the agent as a headstart.
 *
 * THE PROBLEM
 * The app can do a lot — launch a campaign, submit a WhatsApp template, start a calling campaign, build
 * an audience, retarget it, add a product to the catalogue — and every one of those has a screen with
 * questions in an order that has been argued about. The agent could only reach the ACTIONS. In a fresh
 * session it therefore improvised each workflow from primitives: different questions from the screen,
 * no pickers, and a good chance of inventing a field. The owner's words: "the headstart should work for
 * every case so the agent doesn't have to figure things out each time in a new session".
 *
 * THE SHAPE
 * A pipeline is data, not a new tool: a list of questions (with tappable options where a picker beats
 * typing), a parser per question, and a mapping to the ONE composed tool that pipeline exists to call.
 * One generic tool drives all of them, so a new workflow is added by writing a spec — not by teaching
 * the model another dialect.
 *
 * THE BOUNDARY
 * A pipeline asks and maps. It never executes: it ends by naming the composed tool and the arguments,
 * and that tool runs the same plan/preflight/approval path the screen does. Anything the pipeline has
 * no field for, the owner can say in the free-text box, and the agent still has the primitives for
 * genuinely one-off work.
 */

/** What a pipeline needs to know about the account to offer sensible answers. */
export interface PipelineContext {
  currency: string;
  minDailyBudget: number;
  /** Recent creatives, for any question that asks "which pictures". */
  assets: Array<{ id: string; label: string; kind?: string; url?: string }>;
  /** Catalogue/inventory products. */
  products: Array<{ id: string; label: string }>;
  /** Saved CRM audience groups. */
  audienceGroups: Array<{ id: string; name: string }>;
  /** Voice-agent voices this account can use, when a pipeline needs to ask. */
  voices: string[];
}

export interface PipelineQuestion {
  /** Step id, echoed back by the caller so the answer can be parsed against the right question. */
  step: string;
  question: string;
  context?: string;
  /** Tappable answers. Empty means "type it". */
  options: string[];
  allowsFreeText: boolean;
}

export interface PipelineToolCall {
  /** A composed tool name — checked by the gate against the tools actually registered. */
  tool: string;
  args: Record<string, any>;
}

export type PipelineCompletion =
  | { ready: true; call: PipelineToolCall; notes?: string[] }
  | { ready: false; blockers: string[] };

export interface PipelineSpec {
  /** Stable id the agent passes back. */
  id: string;
  title: string;
  /** One line, used in the menu and in the tool description. */
  summary: string;
  /** The tool this pipeline ends in. Declared here so a gate can prove the mapping exists. */
  targetTool: string;
  /** Example things an owner says that should land here. */
  examples?: string[];
  /** The next question, or null when there is nothing left to ask. */
  nextQuestion(answers: Record<string, any>, ctx: PipelineContext): PipelineQuestion | null;
  /** Parse one answer. Null when it matched nothing (the caller then treats it as free text). */
  parse(step: string, answer: string, ctx: PipelineContext): Record<string, any> | null;
  /** Turn the answers into the tool call, or say what is missing. */
  complete(answers: Record<string, any>, ctx: PipelineContext): PipelineCompletion;
}

/** A single declarative step for the simple pipelines. */
export interface SimpleStep {
  id: string;
  question: string;
  context?: string | ((answers: Record<string, any>, ctx: PipelineContext) => string | undefined);
  options?: (answers: Record<string, any>, ctx: PipelineContext) => string[];
  allowsFreeText?: boolean;
  /** Skip this step entirely (for questions the account cannot answer). */
  when?: (answers: Record<string, any>, ctx: PipelineContext) => boolean;
  /** Read one answer into the answers object. Return null when nothing was understood. */
  parse: (answer: string, answers: Record<string, any>, ctx: PipelineContext) => Record<string, any> | null;
}

/** Rupee-style money, so options read the way the owner thinks. */
export function money(currency: string, amount: number): string {
  return currency === 'INR'
    ? `₹${amount.toLocaleString('en-IN')}`
    : `${currency} ${amount.toLocaleString('en-US')}`;
}

/** A number out of "₹500 per day", "500", "Rs 500". */
export function numberFrom(answer: string): number | null {
  const cleaned = String(answer || '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Was the word at this position ruled OUT rather than asked for?
 *
 * "not form fills" contains "form", and a naive match reads that as the owner wanting a form — the
 * exact opposite, on a question whose answer decides where money goes.
 */
export function isNegated(answer: string, index: number): boolean {
  const before = answer.slice(Math.max(0, index - 26), index).toLowerCase();
  return /\b(not|no|never|without|don'?t|do not|instead of|rather than|except)\b[\s\w]{0,14}$/.test(before);
}

/** First cue in the list that appears in the answer and is not being negated. */
export function firstUnnegated(answer: string, cues: Array<[RegExp, string]>): string | null {
  const lower = String(answer || '').toLowerCase();
  for (const [pattern, value] of cues) {
    const match = lower.match(pattern);
    if (!match || match.index === undefined) continue;
    if (isNegated(lower, match.index)) continue;
    return value;
  }
  return null;
}

/** Build a PipelineSpec out of declarative steps — the common case, so each pipeline stays readable. */
export function buildPipeline(input: {
  id: string;
  title: string;
  summary: string;
  targetTool: string;
  examples?: string[];
  steps: SimpleStep[];
  complete: (answers: Record<string, any>, ctx: PipelineContext) => PipelineCompletion;
}): PipelineSpec {
  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    targetTool: input.targetTool,
    examples: input.examples,
    nextQuestion(answers, ctx) {
      for (const step of input.steps) {
        if (step.when && !step.when(answers, ctx)) continue;
        // A step is answered when its own key is present — except the free-text ones, which store
        // their answer under a key the spec names in `parse`. `answered` is set by the engine.
        const answered = answers.__answered?.[step.id];
        if (answered) continue;
        return {
          step: step.id,
          question: step.question,
          context: typeof step.context === 'function' ? step.context(answers, ctx) : step.context,
          options: step.options?.(answers, ctx) ?? [],
          allowsFreeText: step.allowsFreeText !== false,
        };
      }
      return null;
    },
    parse(stepId, answer, ctx) {
      const step = input.steps.find((entry) => entry.id === stepId);
      if (!step) return null;
      return step.parse(answer, {}, ctx);
    },
    complete: input.complete,
  };
}
