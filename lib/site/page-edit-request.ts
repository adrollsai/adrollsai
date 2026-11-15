/**
 * What an edit request is asking for, decided before anything is touched.
 *
 * `POST /api/landing-page/edit` has two shapes and no third:
 *
 *   { "section": "hero", "html": "<section>…</section>" }   replace one section
 *   { "find": "+91 98200 12345", "replace": "+91 98200 99999" }   replace one string
 *
 * Splitting the decision into a pure function is not ceremony: a request that names
 * BOTH a section and a search string is a caller that has not decided what it wants,
 * and guessing would apply half of one instruction and half of another. So the
 * ambiguity is refused here, where it can be tested, rather than 40 lines into a
 * handler where it cannot.
 *
 * PURE: no I/O, no clock, no network.
 */

export type EditPlan =
  | { kind: 'section'; section: string; html: string }
  | { kind: 'text'; find: string; replace: string; section?: string };

export interface EditRejection {
  /** HTTP status the route should answer with. */
  status: number;
  /** Stable machine reason. */
  reason: 'not_an_object' | 'nothing_to_do' | 'both_shapes' | 'missing_html' | 'missing_find' | 'missing_replace' | 'missing_section';
  /** What to tell the caller, in a sentence they can act on. */
  error: string;
}

export type EditRequestResult =
  | { ok: true; plan: EditPlan; detail: string }
  | { ok: false; rejection: EditRejection };

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function present(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Decide whether a request is a section replacement, a text replacement, or neither.
 *
 * A text replacement must say what to do with the text it finds — `replace: ""` is a
 * deliberate deletion and is allowed, but `replace` must be PRESENT, so a caller
 * cannot delete a phrase by forgetting an argument.
 */
export function parseEditRequest(body: unknown): EditRequestResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      rejection: {
        status: 400,
        reason: 'not_an_object',
        error: 'the request body must be a JSON object',
      },
    };
  }

  const record = body as Record<string, unknown>;
  const hasSectionHtml = present(record.html);
  const hasFind = present(record.find);
  const hasSectionOnly = present(record.section);

  if (hasSectionHtml && hasFind) {
    return {
      ok: false,
      rejection: {
        status: 400,
        reason: 'both_shapes',
        error:
          'say which kind of edit this is: { section, html } replaces a whole section, ' +
          '{ find, replace } replaces one exact piece of text. Not both.',
      },
    };
  }

  if (hasSectionHtml) {
    if (!hasSectionOnly) {
      return {
        ok: false,
        rejection: {
          status: 400,
          reason: 'missing_section',
          error: 'replacing a section needs `section` to say which one. GET this route for the list.',
        },
      };
    }
    const section = text(record.section).trim();
    return {
      ok: true,
      plan: { kind: 'section', section, html: text(record.html) },
      detail: `replace section "${section}" (${text(record.html).length} bytes)`,
    };
  }

  if (hasFind) {
    if (record.replace === undefined || record.replace === null) {
      return {
        ok: false,
        rejection: {
          status: 400,
          reason: 'missing_replace',
          error:
            'say what the text should become: `replace` must be present. Pass "" to delete the phrase ' +
            'deliberately, rather than leaving it out by accident.',
        },
      };
    }
    const section = present(record.section) ? text(record.section).trim() : undefined;
    const find = text(record.find);
    const replace = text(record.replace);
    return {
      ok: true,
      plan: { kind: 'text', find, replace, ...(section ? { section } : {}) },
      detail:
        `replace "${find.slice(0, 40)}" with "${replace.slice(0, 40)}"` +
        (section ? ` inside section "${section}"` : ''),
    };
  }

  return {
    ok: false,
    rejection: {
      status: 400,
      reason: 'nothing_to_do',
      error:
        'name the change: { section, html } replaces a whole section; { find, replace } replaces one ' +
        'exact piece of text. Neither was given.',
    },
  };
}

/** One line for the log, before the edit is applied. */
export function describeEditPlan(plan: EditPlan): string {
  return plan.kind === 'section'
    ? `section edit: ${plan.section} -> ${plan.html.length} bytes`
    : `text edit: ${JSON.stringify(plan.find.slice(0, 60))} -> ${JSON.stringify(plan.replace.slice(0, 60))}` +
        (plan.section ? ` in ${plan.section}` : '');
}
