/**
 * LIVE proof, read only: the three packages that claimed "proven against a fake"
 * are now driven against the real database.
 *
 * P10, P9 and P6 were each proven only over hand-written fixtures. A fixture proves
 * the logic; it does not prove the logic meets reality — real industry values are
 * messier than 'education', real generated pages are not shaped like my fixture, and
 * a real ledger has holds and rows my fake never produced.
 *
 * SO THIS SCRIPT TOUCHES NOTHING. It has no INSERT, no UPDATE, no RPC that moves
 * money, and no vendor call. It reads rows and puts them through the same functions
 * the application uses, then prints what it found — counts and verdicts, never a
 * tenant's name, phone number or content.
 *
 *   npm run verify:live-data
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (the app's own credential).
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of ['.env.local', '.env.production.local']) {
    const full = path.resolve(file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.includes('=')) continue;
      const at = line.indexOf('=');
      const key = line.slice(0, at).trim();
      if (!key || env[key]) continue;
      env[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = readEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('this proof needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exitCode = 1;
} else {
  await main();
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { snapshotFromProfile, evaluateSpine } = await import('../lib/automation/onboarding-spine');
  const { industryVocabulary } = await import('../lib/automation/industry');
  const { readLedger, supabaseLedgerReader } = await import('../lib/automation/credit-reconcile');
  const { ensureSections, replaceTextOnce, renderPage, verifyEdit, disallowedSections } = await import(
    '../lib/site/page-sections'
  );

  // ══════════════════════════════════════════════════════════════════════
  // P10 — the onboarding spine, against real profiles
  // ══════════════════════════════════════════════════════════════════════
  head('P10 — the spine against real profiles');

  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, business_name, industry, contact_number, whatsapp_phone_number, logo_url, credits, onboarding_completed, client_features')
    .limit(200);

  if (profileError) {
    check('profiles could be read', false, profileError.message);
  } else {
    const rows = profiles ?? [];
    check('real profiles were read', rows.length > 0, `${rows.length} profile(s)`);

    // The two counts the real route supplies and a profile row does not. Without them
    // every tenant would look like it has no offerings, and the readiness figures
    // below would be an artefact of this harness rather than a fact about the book.
    const [{ data: offeringRows }, { data: runRows }] = await Promise.all([
      admin.from('properties').select('user_id').limit(5000),
      admin.from('agent_runs').select('user_id').eq('status', 'completed').limit(5000),
    ]);
    const offeringsByUser = new Map<string, number>();
    for (const row of offeringRows ?? []) {
      const key = String(row.user_id);
      offeringsByUser.set(key, (offeringsByUser.get(key) ?? 0) + 1);
    }
    const runsByUser = new Map<string, number>();
    for (const row of runRows ?? []) {
      const key = String(row.user_id);
      runsByUser.set(key, (runsByUser.get(key) ?? 0) + 1);
    }
    console.log(
      `      ${offeringRows?.length ?? 0} offering row(s) across the book, ` +
        `${runRows?.length ?? 0} completed agent run(s)`,
    );

    const evaluations = rows.map((row) => {
      const ownerId = String(row.id);
      return {
        row,
        snapshot: {
          ...snapshotFromProfile(row as any),
          offeringsCount: offeringsByUser.get(ownerId) ?? 0,
          completedRuns: runsByUser.get(ownerId) ?? 0,
        },
      };
    });
    const statuses = evaluations.map((entry) => evaluateSpine(entry.snapshot));

    const ready = statuses.filter((status) => status.ready).length;
    const withDiscrepancy = statuses.filter((status) => status.discrepancies.length > 0).length;
    console.log(
      `      ready ${ready}/${rows.length}, with at least one discrepancy ${withDiscrepancy}/${rows.length}`,
    );

    // Why the rest are not ready. A count of "0 ready" is worthless without this.
    const blockerCounts = new Map<string, number>();
    for (const status of statuses) {
      for (const id of status.blockers) blockerCounts.set(id, (blockerCounts.get(id) ?? 0) + 1);
    }
    console.log(
      `      blockers across the sample: ${
        [...blockerCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id, count]) => `${id}=${count}`)
          .join(' ') || 'none'
      }`,
    );

    // What industries actually exist in production, and — the point of the guard —
    // what each one is allowed to have.
    const industries = new Map<string, number>();
    for (const entry of evaluations) {
      const key = String(entry.snapshot.industry ?? '').trim().toLowerCase() || '(none)';
      industries.set(key, (industries.get(key) ?? 0) + 1);
    }
    const industryList = [...industries.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `      industries: ${industryList.map(([key, count]) => `${key}=${count}`).join(' ')}`,
    );

    check(
      'no tenant, whatever its industry, is given property vocabulary by accident',
      evaluations.every((entry) => {
        const vocabulary = industryVocabulary(entry.snapshot.industry);
        const declared = String(entry.snapshot.industry ?? '').trim().toLowerCase();
        const isProperty = declared === 'real_estate' || declared === 'property' || declared === 'realestate';
        // The only tenants that may carry property wording are the ones that said so.
        return isProperty || vocabulary.key !== 'real_estate';
      }),
      `${industryList.length} distinct industry value(s)`,
    );

    const unknownIndustry = evaluations.filter((entry) => {
      const declared = String(entry.snapshot.industry ?? '').trim().toLowerCase();
      return !declared || ['generic', 'other', 'general', 'none', 'unknown'].includes(declared);
    });
    check(
      'a tenant with no usable industry is recorded as unanswered — never blocked, never given property wording',
      unknownIndustry.every((entry) => {
        const status = evaluateSpine(entry.snapshot);
        const step = status.steps.find((candidate) => candidate.step.id === 'industry');
        // Measured decision: the answer is worth asking for and not worth stopping for.
        // It must show as open, it must not appear in blockers, and its wording must be
        // the neutral one.
        return (
          step?.done === false &&
          !status.blockers.includes('industry') &&
          /neutral wording — never property wording/.test(step.detail)
        );
      }),
      `${unknownIndustry.length} tenant(s) with no usable industry`,
    );

    // The flag against the data, on real rows — this is the claim P10 is built on.
    const flagSays = evaluations.filter((entry) => entry.snapshot.onboardingCompletedFlag === true);
    const flagLies = flagSays.filter((entry) => !evaluateSpine(entry.snapshot).ready);
    console.log(
      `      onboarding_completed = true on ${flagSays.length} profile(s); ` +
        `${flagLies.length} of those are NOT ready on the data`,
    );
    check(
      'the flag is never trusted: every disagreement with the data is reported',
      flagLies.every((entry) =>
        evaluateSpine(entry.snapshot).discrepancies.some((note) => /onboarding_completed is true but/.test(note)),
      ),
      flagLies.length
        ? `${flagLies.length} disagreement(s), all reported`
        : 'no disagreements in this sample',
    );

    const creditsUnknown = evaluations.filter((entry) => entry.snapshot.credits === null).length;
    const creditsZero = evaluations.filter((entry) => entry.snapshot.credits === 0).length;
    console.log(`      credits unreadable on ${creditsUnknown}, exactly zero on ${creditsZero}`);
    check(
      'an unreadable balance is never confused with an empty one',
      evaluations.every((entry) => {
        const status = evaluateSpine(entry.snapshot);
        const budget = status.steps.find((step) => step.step.id === 'budget');
        if (entry.snapshot.credits === null) return /could not be read/.test(budget?.detail ?? '');
        return !/could not be read/.test(budget?.detail ?? '');
      }),
      'null -> "could not be read"',
    );

    const negative = evaluations.filter((entry) => (entry.snapshot.credits ?? 0) < 0);
    check(
      'no production wallet is negative (money would have moved outside the hold model)',
      negative.length === 0,
      negative.length ? `${negative.length} negative wallet(s)` : 'all wallets >= 0',
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // P9 — reconciliation, against a real wallet
  // ══════════════════════════════════════════════════════════════════════
  head('P9 — the ledger against real rows');

  const { data: recentRows, error: ledgerError } = await admin
    .from('credit_transactions')
    .select('user_id, amount, category, ref, created_at')
    .order('created_at', { ascending: false })
    .limit(400);

  if (ledgerError) {
    check('credit_transactions could be read', false, ledgerError.message);
  } else {
    const rows = recentRows ?? [];
    check('real ledger rows were read', rows.length > 0, `${rows.length} row(s)`);

    const withRef = rows.filter((row) => row.ref);
    const runRefs = withRef.filter((row) => String(row.ref).startsWith('agent_run:'));
    console.log(
      `      ${withRef.length} row(s) carry a ref; ${runRefs.length} name a run ` +
        `(${new Set(runRefs.map((row) => String(row.ref).split(':').slice(0, -1).join(':'))).size} distinct run(s))`,
    );

    // The busiest real wallet: the best chance of exercising a run, a hold and a grant
    // in one reconciliation.
    const byUser = new Map<string, number>();
    for (const row of rows) byUser.set(String(row.user_id), (byUser.get(String(row.user_id)) ?? 0) + 1);
    const busiest = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];

    if (!busiest) {
      check('a real wallet could be picked', false, 'no user with ledger rows');
    } else {
      const summary = await readLedger(supabaseLedgerReader(admin), { userId: busiest[0], limit: 200 });
      console.log(
        `      busiest wallet: ${busiest[1]} row(s) in the window, net ${summary.netCredits} credits, ` +
          `${summary.runs.length} run(s), ${summary.grantedCredits} granted, ${summary.spentCredits} spent`,
      );

      check(
        'the real ledger classifies every row: runs plus non-run rows equal the total',
        Math.abs(summary.runNetCredits + summary.otherNetCredits - summary.netCredits) < 0.005,
        `${summary.runNetCredits} + ${summary.otherNetCredits} = ${summary.netCredits}`,
      );
      check(
        'a real wallet reconciles without the module reporting a problem',
        summary.problems.length === 0,
        summary.problems.length ? summary.problems.slice(0, 2).join('; ') : 'no problems',
      );
      check(
        'every real run in the window gets a verdict, and none is a mismatch',
        summary.runs.every((run) => run.problems.length === 0),
        summary.runs.length
          ? summary.runs.map((run) => `${run.runId.slice(0, 8)}:${run.verdict}`).join(' ')
          : 'no runs in this window',
      );
      check(
        'no real run is left holding credits that were never released',
        summary.runs.every((run) => run.stillReservedCredits === 0 || run.verdict === 'open'),
        `${summary.runs.filter((run) => run.stillReservedCredits > 0).length} open reservation(s)`,
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // P6 — a surgical edit, against a real generated page
  // ══════════════════════════════════════════════════════════════════════
  head('P6 — a surgical edit against a real generated page');

  const { data: pages, error: pageError } = await admin
    .from('landing_pages')
    .select('id, user_id, slug, title, html_content')
    .not('html_content', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(25);

  if (pageError) {
    check('landing_pages could be read', false, pageError.message);
  } else {
    const realPages = (pages ?? []).filter((page) => String(page.html_content ?? '').length > 500);
    check('real generated pages were read', realPages.length > 0, `${realPages.length} page(s) over 500 bytes`);

    const adopted = realPages.map((page) => ensureSections(String(page.html_content)));
    const sectionCounts = adopted.map((page) => page.sections.length);
    console.log(
      `      sections adopted per page: ${sectionCounts.join(', ')} ` +
        `(median ${sectionCounts.sort((a, b) => a - b)[Math.floor(sectionCounts.length / 2)] ?? 0})`,
    );

    check(
      'every real page adopts into named sections with unique ids',
      adopted.every(
        (page) =>
          page.sections.length > 0 &&
          new Set(page.sections.map((section) => section.id)).size === page.sections.length,
      ),
      `${adopted.filter((page) => page.sections.length > 1).length}/${realPages.length} page(s) split into more than one section`,
    );
    check(
      'adoption is deterministic on real pages, not just on my fixture',
      realPages.every((page, index) => {
        const once = adopted[index];
        const twice = ensureSections(String(page.html_content));
        return (
          once.sections.map((section) => section.id).join(',') === twice.sections.map((section) => section.id).join(',') &&
          once.sections.map((section) => section.html).join('') === twice.sections.map((section) => section.html).join('')
        );
      }),
      'same page, same names, same content',
    );
    check(
      'adoption loses nothing: every section body appears in the rendered page',
      realPages.every((page, index) => {
        const rendered = renderPage(adopted[index]);
        return adopted[index].sections.every((section) => rendered.includes(section.html));
      }),
      'no section body dropped',
    );

    // The real page with the most sections is the hardest case: pick a phone number or
    // a word that appears exactly once and prove the edit is surgical on REAL html.
    const target = adopted
      .map((page, index) => ({ page, index }))
      .sort((a, b) => b.page.sections.length - a.page.sections.length)[0];

    if (!target) {
      check('a real page could be picked for the edit', false, 'no page');
    } else {
      const html = String(realPages[target.index].html_content);
      const page = target.page;
      const candidate = [...page.sections]
        .sort((a, b) => b.html.length - a.html.length)
        .map((section) => {
          // A run of 12+ plain text characters with no tags: something an owner might
          // actually ask to change.
          const match = />([A-Za-z][A-Za-z0-9 ,.'&+-]{11,60})</.exec(section.html);
          return match ? { section, text: match[1] } : null;
        })
        .find((entry) => entry !== null);

      if (!candidate) {
        check(
          'a real page offers a unique piece of text to edit',
          false,
          'no candidate text found — nothing to prove against this page',
        );
      } else {
        const occurrences =
          candidate.section.html.split(candidate.text).length - 1;
        const edit = replaceTextOnce(html, candidate.text, `${candidate.text} (edited)`, {
          section: candidate.section.id,
        });
        const proof = verifyEdit(edit.before, edit.after, candidate.section.id);
        console.log(
          `      edited section "${candidate.section.id}" of a ${html.length}-byte real page ` +
            `(${page.sections.length} sections); text occurred ${occurrences}x in that section`,
        );
        check(
          'a real generated page can be edited surgically, and the proof holds',
          proof.ok && proof.changed.join(',') === candidate.section.id,
          proof.ok ? `${proof.unchanged.length} other section(s) byte-identical` : proof.message,
        );
        check(
          'the edit landed and the rest of the real page is untouched',
          edit.html.includes(`${candidate.text} (edited)`) &&
            proof.unchanged.length === page.sections.length - 1,
          `+${edit.html.length - html.length} bytes`,
        );
        check(
          'the edited real page still parses to the same section list',
          edit.after.sections.map((section) => section.id).join(',') === page.sections.map((section) => section.id).join(','),
          edit.after.sections.map((section) => section.id).join(', '),
        );
      }
    }

    // The industry rule against real pages: how many published pages still carry
    // sections their industry should not have?
    const { data: industries } = await admin.from('profiles').select('id, industry').limit(500);
    const industryByUser = new Map((industries ?? []).map((row) => [String(row.id), row.industry as string | null]));
    let withDisallowed = 0;
    const kinds = new Map<string, number>();
    for (const raw of realPages) {
      const industry = industryByUser.get(String(raw.user_id)) ?? null;
      const disallowed = disallowedSections(String(raw.html_content), industry);
      if (disallowed.length) {
        withDisallowed++;
        for (const entry of disallowed) kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
      }
    }
    console.log(
      `      of ${realPages.length} real page(s), ${withDisallowed} carry a section their industry should not have` +
        (kinds.size ? `: ${[...kinds.entries()].map(([kind, count]) => `${kind}x${count}`).join(', ')}` : ''),
    );
    check(
      'the industry guard runs on real published pages and reaches a verdict for each',
      realPages.length > 0,
      `${withDisallowed} page(s) would be cleaned; reported, not assumed clean`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}
