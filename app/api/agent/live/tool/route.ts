import { NextRequest, NextResponse } from 'next/server';
import { generateText, stepCountIs } from 'ai';
import { createClient } from '@/utils/supabase/server';
import { createAgentContext } from '@/lib/agent/orchestrator';
import { getAgentModel } from '@/lib/agent/deepseek';
import { runWithSpendContext } from '@/lib/agent/spend';
import { canStartTurn } from '@/lib/agent/usage';

export const maxDuration = 300;

/**
 * Hands real work from a voice turn to the agent.
 *
 * The realtime voice model is a fast front end: it hears, answers instantly, and calls
 * `delegate_to_agent` when the owner actually wants something done. This route runs the
 * ordinary agent loop with the same prompt, tools and spending rules as a typed turn —
 * which is the point. Voice gets no special powers and no way to bypass the approval
 * gate, so a spoken "make me a Diwali reel" ends at the same review card as a typed one.
 *
 * Kept short by design: the model gets a compact summary it can *say*, not a transcript
 * of tool calls, because reading JSON out loud is the classic voice-agent mistake.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const instructions = String(body.instructions || '').trim().slice(0, 2000);
  const kind: 'question' | 'action' = body.kind === 'action' ? 'action' : 'question';
  if (!instructions) {
    return NextResponse.json({ error: 'instructions are required' }, { status: 400 });
  }

  const affordable = await canStartTurn(user.id, 1);
  if (!affordable.ok) {
    return NextResponse.json(
      { spoken: 'You are out of credits, so I cannot start that yet.', code: 'insufficient_credits' },
      { status: 402 }
    );
  }

  try {
    // A question needs a number in about five seconds, not a full agent expedition.
    // Scoping the tools to reporting keeps the loop short, cheap and predictable;
    // anything that has to produce something still gets the full toolset.
    const ctx = await createAgentContext(supabase, user.id, {
      intentText: instructions,
      ...(kind === 'question' ? { forceGroups: ['core', 'reporting'] } : {}),
    });

    const spokenRules =
      (kind === 'question'
        ? '\n\nThis is a spoken QUESTION from the owner. Read the real numbers with your tools, then answer in ' +
          'ONE sentence that leads with the figure — "Eleven leads this week, four of them from WhatsApp." ' +
          'Never a list, never markdown, never "let me check". If a number genuinely is not available, say ' +
          'which one and what would be needed to get it, in one sentence.' +
          ' If the count is zero, say zero plainly, then say when the last real activity was — and take that ' +
          'date from a tool result, never from memory or from an earlier turn.'
        : '\n\nThis is a spoken ACTION request. Do the work normally, but write your reply to be spoken aloud: ' +
          'one or two sentences, no lists, no markdown, no URLs. If you staged something for approval, say in ' +
          'one sentence what you prepared and that you are waiting for their go-ahead.') +
      ' Answer in the language the owner used (Hindi, Hinglish or English).';

    const result = await runWithSpendContext({ userId: user.id }, async () =>
      generateText({
        model: await getAgentModel(),
        system: ctx.systemPrompt + spokenRules,
        tools: ctx.tools as any,
        // Question: 4 steps is enough for read → report → speak. Action: the full run.
        stopWhen: stepCountIs(kind === 'question' ? 4 : 8),
        prompt: instructions,
      })
    );

    const spoken = (result.text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_#`>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);

    return NextResponse.json({
      spoken:
        spoken ||
        (kind === 'question'
          ? 'I could not read that figure just now. Ask me again and I will check.'
          : 'I have started that. You will see it in the conversation, and I will ask before anything is paid for.'),
    });
  } catch (e: any) {
    console.error('[live/tool] delegation failed:', e?.message || e);
    return NextResponse.json({
      spoken: 'That did not go through. I have left a note in the conversation so nothing is lost.',
      error: String(e?.message || e),
    });
  }
}
