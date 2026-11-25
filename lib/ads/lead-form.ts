/**
 * Building the `questions` array for a Meta instant form.
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION
 * A live client's launch was approved, ran, and died with:
 *
 *     label must be specified for custom questions
 *
 * The cause was three lines inside a 1,500-line job processor: a question arriving
 * without a `label` became `{ type: 'CUSTOM', label: '' }` and was posted anyway, so Meta
 * rejected the WHOLE form. The campaign shell then existed with no form behind it — the
 * client saw "campaign bhi ni bana paaya" and no campaign ever appeared.
 *
 * A bug that is a mapping decision belongs in a mapping function with tests, not buried
 * where the only way to find it is to read a failed Graph response. Everything here is
 * pure: the caller posts the result, this decides it.
 */

export interface RawCustomQuestion {
  label?: string;
  question?: string;
  text?: string;
  title?: string;
  type?: string;
  options?: unknown[];
}

export interface MetaFormQuestion {
  type: string;
  key?: string;
  label?: string;
  options?: Array<{ value: string; key: string }>;
}

export interface CustomQuestionsResult {
  questions: MetaFormQuestion[];
  /** Questions that could not be expressed to Meta, with the reason. */
  dropped: Array<{ question: unknown; why: string }>;
}

/** Standard fields Meta provides, so a custom question never repeats one. */
const STANDARD_BY_WORDING: Array<{ match: RegExp; type: string; key: string }> = [
  { match: /company|business name/, type: 'COMPANY_NAME', key: 'company_name' },
  { match: /job title|designation/, type: 'JOB_TITLE', key: 'job_title' },
  { match: /\bcity\b/, type: 'CITY', key: 'city' },
  { match: /\bstate\b/, type: 'STATE', key: 'state' },
];

/** Meta's cap; a longer label is rejected. */
const MAX_LABEL = 200;

/**
 * Turn the app's own question shape into what Graph accepts.
 *
 * Rules, each of which maps to a real Meta refusal:
 *   - a question with no wording at all is DROPPED, never posted with an empty label;
 *   - wording is read from `label`, then `question`, `text`, `title`, because callers
 *     legitimately use any of those;
 *   - a choice question needs at least two distinct, non-empty options, otherwise it is
 *     asked as free text rather than sent malformed;
 *   - a question that duplicates a standard field already on the form is dropped: Meta
 *     rejects the same question twice.
 */
export function buildMetaCustomQuestions(
  rawQuestions: unknown,
  standardTypes: Iterable<string> = []
): CustomQuestionsResult {
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  const seen = new Set<string>(standardTypes);
  const questions: MetaFormQuestion[] = [];
  const dropped: Array<{ question: unknown; why: string }> = [];

  for (const entry of list as RawCustomQuestion[]) {
    if (!entry || typeof entry !== 'object') {
      dropped.push({ question: entry, why: 'not an object' });
      continue;
    }

    const label = String(entry.label ?? entry.question ?? entry.text ?? entry.title ?? '').trim();
    if (!label) {
      dropped.push({ question: entry, why: 'no label, question, text or title to ask' });
      continue;
    }

    // A question that is really one of Meta's standard fields is sent as that field.
    if (entry.type !== 'MULTIPLE_CHOICE') {
      const lower = label.toLowerCase();
      const standard = STANDARD_BY_WORDING.find((s) => s.match.test(lower));
      if (standard) {
        // Already on the form: skip instead of sending it twice.
        if (seen.has(standard.type)) continue;
        seen.add(standard.type);
        questions.push({ type: standard.type, key: standard.key });
        continue;
      }
    }

    const question: MetaFormQuestion = { type: 'CUSTOM', label: label.slice(0, MAX_LABEL) };

    if (entry.type === 'MULTIPLE_CHOICE' && Array.isArray(entry.options)) {
      const options = entry.options
        .map((option) => String(option ?? '').trim())
        .filter((option) => option.length > 0)
        .map((option) => ({
          value: option,
          key: option.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 50),
        }))
        .filter((option) => option.key.length > 0)
        .filter((option, index, all) => all.findIndex((other) => other.key === option.key) === index);

      // One option is not a choice question; Meta rejects it, so ask it as free text.
      if (options.length >= 2) question.options = options;
    }

    questions.push(question);
  }

  return { questions, dropped };
}
