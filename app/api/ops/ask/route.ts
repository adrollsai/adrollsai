import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAgentModel } from '@/lib/agent/deepseek';
import { listIncidents, sortIncidents } from '@/lib/ops/incidents';
import { relatedFiles, renderContextForPrompt, repoSnapshotMeta, searchRepo } from '@/lib/ops/repo';

/**
 * POST /api/ops/ask — "how does X work?" and "what is broken right now?", answered from the
 * real code and the real board.
 *
 * THE PROBLEM THIS SOLVES
 * The person who has to answer "why did my video not render?" at 11pm is not the person who
 * wrote the render path, and the answer is spread across a runner, a watchdog, a sync helper
 * and a queue table. Every one of those exists in this repo with a header comment explaining
 * it. This endpoint finds the relevant files from the question, shows their own explanations to
 * the model, and asks for an answer that cites them.
 *
 * WHY IT IS GROUNDED RATHER THAN CHATTY
 * A model answering "how does your billing work?" from general knowledge would invent something
 * plausible and wrong, and the owner would make a decision on it. So the system prompt forbids
 * answering outside the supplied material, requires a file path as evidence for any claim about
 * behaviour, and says explicitly that "I could not find that" is the correct answer when
 * retrieval came up empty. The response carries the citations and the snapshot commit, so a
 * reader can check both.
 *
 * WHY IT IS OWNER-ONLY
 * The snapshot contains internal prompts, pricing logic, reviewed policies and the shape of
 * every table. That is the owner's own code; it is not a tenant-facing feature, and there is no
 * version of this that a tenant should be able to query. `super_admin` only, same as the board.
 *
 * GET works too (`?q=`), because the first thing anyone does with a new console is paste a URL
 * into a browser.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Retrieval breadth. Eight files is roughly 2,000 tokens of header prose. */
const RETRIEVAL_LIMIT = 8;
/** A question is a question, not a document. */
const MAX_QUESTION_CHARS = 2_000;

const supabaseAdmin =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

export async function GET(request: Request) {
  const question = new URL(request.url).searchParams.get('q') || '';
  return answer(request, question);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: string; q?: string };
  return answer(request, String(body.question || body.q || ''));
}

async function answer(request: Request, rawQuestion: string) {
  try {
    // ── who is asking
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const question = rawQuestion.trim().slice(0, MAX_QUESTION_CHARS);
    if (!question) {
      return NextResponse.json({ error: 'Ask a question, e.g. {"question":"how does the review gate work?"}' }, { status: 400 });
    }

    // ── what is relevant
    const hits = searchRepo(question, { limit: RETRIEVAL_LIMIT });
    const context = renderContextForPrompt(hits);
    const meta = repoSnapshotMeta();

    // ── what is currently wrong, so "why is X failing?" needs no second call
    let board = '';
    if (supabaseAdmin) {
      try {
        const incidents = sortIncidents(
          await listIncidents(supabaseAdmin, { status: 'all', limit: 60 }),
        ).filter((incident) => incident.status === 'open' || incident.status === 'needs_approval' || incident.status === 'repaired');
        board = incidents.length
          ? incidents
              .slice(0, 20)
              .map(
                (incident) =>
                  `- [${incident.severity.toUpperCase()} / ${incident.status}] ${incident.title}\n` +
                  `  evidence: ${incident.evidence}` +
                  (incident.suggested_fix ? `\n  suggested: ${incident.suggested_fix}` : ''),
              )
              .join('\n')
          : '(the watchdog has no open incidents right now)';
      } catch {
        board = '(the incident board could not be read for this answer)';
      }
    }

    // ── the answer
    const system = [
      'You are the operations engineer for the Nobogent app, answering the owner.',
      '',
      'RULES, in order of importance:',
      '1. Answer ONLY from the material below: the code excerpts and the incident board. They are the truth.',
      '2. Any claim about how the app behaves must cite a file path from the material, like (lib/ops/healer.ts).',
      '3. If the material does not cover the question, say so plainly and name the closest files. Never guess at',
      '   behaviour, prices, table names, endpoints or configuration. "I could not find that in the snapshot" is a',
      '   correct and useful answer; a confident invention is the one thing that makes you useless.',
      '4. If the question is about something currently broken, use the incident board, quote its evidence, and say',
      '   whether the watchdog repaired it or whether it is waiting for a human.',
      '5. Plain English, short paragraphs. The reader is technical but busy, and is often reading this on a phone.',
      '6. Never claim an action was taken. You can read and explain; you cannot deploy, refund, message a customer,',
      '   or change production. If something needs doing, say exactly what and where.',
      '7. Answer in under about 200 words unless the question genuinely needs more. A truncated answer is worse than',
      '   a short one: say what matters, name the files, and stop.',
    ].join('\n');

    const prompt = [
      `QUESTION: ${question}`,
      '',
      `CODE SNAPSHOT (commit ${meta.commit}, branch ${meta.branch}, ${meta.fileCount} files indexed, built ${meta.generatedAt}):`,
      context,
      '',
      'INCIDENT BOARD (what the watchdog sees right now):',
      board || '(unavailable)',
    ].join('\n');

    const model = await getAgentModel();
    const { text, usage, finishReason } = await generateText({
      model,
      system,
      prompt,
      // 1400 was not enough: a grounded answer that names several files and quotes evidence
      // was measured hitting the cap mid-sentence. The brevity rule in the system prompt is
      // what keeps answers short; this is only the ceiling that stops a truncation.
      maxOutputTokens: 2000,
    });

    return NextResponse.json({
      question,
      answer: (text || '').trim(),
      // Everything a reader needs to check the answer rather than trust it.
      citations: hits.map((hit) => ({
        path: hit.path,
        lines: hit.lines,
        score: hit.score,
        matched: hit.matched,
        exports: hit.exports,
        tables: hit.tables,
        routes: hit.routes,
      })),
      alsoInThatArea: hits.length ? relatedFiles(hits[0].path, 5) : [],
      snapshot: meta,
      grounded: hits.length > 0,
      usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null,
      finishReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ops-ask] failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
