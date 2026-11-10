import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { streamText, convertToModelMessages } from 'ai';
import { getAgentModel } from '@/lib/agent/deepseek';
import { createAgentContext } from '@/lib/agent/orchestrator';
import { google } from '@ai-sdk/google';
import { isAvailable, setSessionStatus, appendEvents } from '@/lib/agent/harness/store';
import { createEvent } from '@/lib/agent/harness/events';
import { enqueueRun, runsAvailableCheck, listRunsForSession } from '@/lib/agent/harness/runs';
import { persistStep, persistTurnError, maybeAutoTitle } from '@/lib/agent/harness/persist';
import { extractImageAttachments, loadImageParts } from '@/lib/agent/harness/attachments';
import {
  turnStopConditions,
  createTurnStopTracker,
  MAX_CONTINUATIONS_PER_SESSION,
  setTurnDeadline,
  clearTurnDeadline,
  shouldContinueAfterTurn,
} from '@/lib/agent/turn-limits';

// Must stay a literal: Next reads route segment config by static analysis, so
// importing a constant here would be silently ignored. Keep in sync with
// CHAT_MAX_DURATION in lib/agent/turn-limits.ts.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, email, agency_id')
      .eq('id', user.id)
      .single();

    const isSuperAdmin =
      profile?.role === 'super_admin' ||
      profile?.email === 'rchopra489@gmail.com' ||
      user.email === 'rchopra489@gmail.com';

    const canImpersonate =
      isSuperAdmin || ['agency', 'admin', 'agent'].includes(profile?.role || '');

    // Every authenticated user gets their own harness + E2B workspace.
    // Super admins and agency roles may additionally operate on a sub-account,
    // which is authorised below.

    const url = new URL(req.url);
    const body = await req.json();
    const { messages, impersonateId: bodyImpersonateId } = body;
    const requestedImpersonateId = url.searchParams.get('impersonate') || bodyImpersonateId;

    let targetUserId = user.id;

    if (requestedImpersonateId && requestedImpersonateId !== user.id) {
      if (!canImpersonate) {
        return NextResponse.json({ error: 'Unauthorized client impersonation' }, { status: 403 });
      }
      if (isSuperAdmin) {
        targetUserId = requestedImpersonateId;
      } else {
        const { data: subAccount } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', requestedImpersonateId)
          .eq('agency_id', profile?.agency_id || user.id)
          .single();

        if (subAccount) {
          targetUserId = requestedImpersonateId;
        } else {
          return NextResponse.json({ error: 'Unauthorized client impersonation' }, { status: 403 });
        }
      }
    }

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    // â”€â”€ durable session log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // When the client supplies a sessionId, this turn is written to the event
    // log so the conversation survives a refresh, a deploy, or another device.
    // Without one the route still works (log disabled) â€” that keeps the
    // harness usable before the migration is applied.
    const wantsLog = typeof body.sessionId === 'string' && body.sessionId.length > 0;
    const logReady = wantsLog ? await isAvailable(supabase) : false;
    const sessionId: string | null = wantsLog && logReady ? body.sessionId : null;

    const lastUser = [...messages].reverse().find((m: any) => m?.role === 'user');
    const lastUserText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : Array.isArray(lastUser?.parts)
        ? lastUser.parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
        : '';

    if (sessionId) {
      // The CLIENT writes `user.message` (it owns the displayed message id, so
      // the optimistic row and the persisted row are the same row). This route
      // owns everything the model produces. Exactly one writer per event type.
      await setSessionStatus(supabase, sessionId, 'running');
      if (lastUserText.trim()) {
        void maybeAutoTitle(supabase, user.id, sessionId, lastUserText);
      }
    }

    const { systemPrompt, tools, targetProfile } = await createAgentContext(supabase, targetUserId, user.id);
    // The agent always runs on the multimodal flash model.
    const model = await getAgentModel();

    const rawModelMessages = await (async () => {
      if (messages.length > 0 && !messages[0].parts) {
        return messages;
      }
      return convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      });
    })();

    // Ensure no empty assistant messages (without content and without tool calls) reach any provider
    const modelMessages = rawModelMessages.filter((m: any) => {
      if (!m) return false;
      if (m.role === 'assistant') {
        const hasContent = typeof m.content === 'string'
          ? m.content.trim().length > 0
          : Array.isArray(m.content)
          ? m.content.length > 0
          : Boolean(m.content);
        const hasToolCalls = Array.isArray(m.toolCalls) ? m.toolCalls.length > 0 : Array.isArray(m.tool_calls) ? m.tool_calls.length > 0 : false;
        return hasContent || hasToolCalls;
      }
      return true;
    });

    // â”€â”€ attach images to the model input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Attachments arrive as URLs inside the message text. Without this step the
    // model never receives the pixels, so image turns were answered blind.
    const imageAttachments = extractImageAttachments(lastUserText);
    if (imageAttachments.length) {
      const imageParts = await loadImageParts(imageAttachments);
      const lastIdx = modelMessages.length - 1;
      const target = modelMessages[lastIdx];
      if (imageParts.length && target && target.role === 'user') {
        const textParts =
          typeof target.content === 'string'
            ? [{ type: 'text' as const, text: target.content }]
            : Array.isArray(target.content)
            ? target.content
            : [];
        modelMessages[lastIdx] = {
          ...target,
          content: [...textParts, ...imageParts] as any,
        };
        console.log(
          `[Nobo Agent] attached ${imageParts.length} image(s) to the vision model: ` +
            imageAttachments.map((a) => a.name).join(', ')
        );
      }
    }

    // Turn-stop bookkeeping, declared before the callbacks that read it.
    const stopTracker = createTurnStopTracker();
    // Tell tool runners how long this turn has left so a long command cannot
    // outlive the request (see clampToTurnBudget).
    setTurnDeadline(Date.now());

    // Step callbacks shared by the primary model and the Gemini fallback, so a
    // fallback turn is logged exactly like a normal one.
    const onStepFinish = async (step: any) => {
      if (step?.toolCalls?.length) {
        console.log('[Nobo Agent Step Tools]:', step.toolCalls.map((t: any) => t.toolName).join(', '));
      }
      if (step?.text) {
        console.log('[Nobo Agent Step Text]:', step.text.slice(0, 100));
      }
      if (sessionId) await persistStep(supabase, sessionId, step);
    };

    const onFinish = async (event: any) => {
      if (!sessionId) return;
      await setSessionStatus(supabase, sessionId, 'idle');
      clearTurnDeadline();

      // Did we cut this turn off with work left, or did the model finish?
      // `finishReason` describes only the last step, so the explicit tracker is
      // the reliable signal for "we stopped it".
      const unfinished = shouldContinueAfterTurn({
        stopReason: stopTracker.reason,
        finishReason: event?.finishReason,
        steps: Array.isArray(event?.steps) ? event.steps : [],
        finalText: event?.text,
      });

      if (!unfinished) return;

      if (!(await runsAvailableCheck(supabase))) {
        console.warn('[Nobo Agent] unfinished turn but the durable queue is unavailable.');
        return;
      }

      // Runaway guard: a task that keeps hitting the budget must not re-queue
      // forever and quietly burn credits.
      try {
        const recent = await listRunsForSession(supabase, sessionId, MAX_CONTINUATIONS_PER_SESSION + 2);
        const chained = (recent || []).length;
        if (chained >= MAX_CONTINUATIONS_PER_SESSION) {
          await appendEvents(supabase, sessionId, [
            createEvent('run.status', {
              status: 'failed',
              detail: `Stopped after ${chained} continuations without finishing. This task needs a narrower scope or more time — tell me which part to focus on.`,
            }),
          ]);
          console.warn(`[Nobo Agent] continuation cap reached for session ${sessionId.slice(0, 8)}`);
          return;
        }
      } catch (err: any) {
        console.warn('[Nobo Agent] continuation guard check failed, proceeding:', err?.message);
      }

      try {
        const run = await enqueueRun(supabase, {
          sessionId,
          userId: targetUserId,
          goal: lastUserText || 'Continue the task that was in progress.',
          // Keyed per turn so a retry of the same turn cannot double-enqueue.
          idempotencyKey: `cont_${sessionId}_${turnStartedAt}`,
        });
        if (run) {
          const why =
            stopTracker.reason === 'steps'
              ? `step cap (${stopTracker.steps} steps)`
              : `time budget (${Math.round(stopTracker.elapsedMs / 1000)}s)`;
          await appendEvents(supabase, sessionId, [
            createEvent('run.status', {
              status: 'queued',
              detail: `Hit the ${why} with work remaining — picking it back up automatically in the background.`,
            }),
          ]);
          console.log(`[Nobo Agent] queued continuation run ${run.id.slice(0, 8)} for session ${sessionId.slice(0, 8)}`);
        }
      } catch (err: any) {
        console.warn('[Nobo Agent] could not queue a continuation run:', err?.message);
      }
    };

    // The browser went away mid-turn (tab refreshed/closed). Completed steps are
    // already in the log, but the turn itself is dead — so hand the remaining
    // work to the durable queue rather than silently losing the task.
    const onAbort = async (event: any) => {
      clearTurnDeadline();
      const completedSteps = Array.isArray(event?.steps) ? event.steps.length : 0;
      console.log(`[Nobo Agent] turn aborted by the client after ${completedSteps} step(s).`);
      if (!sessionId) return;

      await setSessionStatus(supabase, sessionId, 'idle');

      // Nothing meaningful had happened yet — treat it as a plain cancel.
      if (completedSteps === 0) return;

      if (!(await runsAvailableCheck(supabase))) return;

      try {
        const run = await enqueueRun(supabase, {
          sessionId,
          userId: targetUserId,
          goal: lastUserText || 'Continue the task that was interrupted.',
          // Keyed on the message so a refresh loop cannot spawn run after run.
          idempotencyKey: `abort_${sessionId}_${Math.floor(Date.now() / 60_000)}`,
        });
        if (run) {
          await appendEvents(supabase, sessionId, [
            createEvent('run.status', {
              status: 'queued',
              detail:
                'The tab closed mid-task. Completed steps were saved and the rest is continuing in the background — press Stop to cancel.',
            }),
          ]);
          console.log(`[Nobo Agent] aborted turn handed to background run ${run.id.slice(0, 8)}`);
        }
      } catch (err: any) {
        console.warn('[Nobo Agent] could not queue a continuation after abort:', err?.message);
      }
    };

    let result;
    const turnStartedAt = Date.now();
    try {
      result = streamText({
        model,
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: turnStopConditions(turnStartedAt, 'Nobo Agent', stopTracker),
        tools,
        onStepFinish,
        onFinish,
        onAbort,
      });
    } catch (modelErr: any) {
      console.warn('[Nobo Agent] Primary model failed, falling back to Gemini Flash:', modelErr?.message);
      result = streamText({
        model: google('gemini-2.5-flash'),
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: turnStopConditions(turnStartedAt, 'Nobo Agent', stopTracker),
        tools,
        onStepFinish,
        onFinish,
        onAbort,
      });
    }

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      onError: (err) => {
        console.error('[Nobo Agent Stream Error]:', err);
        const message = err instanceof Error ? err.message : String(err || 'An error occurred during generation.');
        if (sessionId) {
          void persistTurnError(supabase, sessionId, message);
          void setSessionStatus(supabase, sessionId, 'error');
        }
        return message;
      },
    });
  } catch (err: any) {
    console.error('[Agent API] Fatal Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
