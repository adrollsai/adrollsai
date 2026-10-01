import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { getAgentModel } from '@/lib/agent/deepseek';
import { createAgentContext } from '@/lib/agent/orchestrator';
import { google } from '@ai-sdk/google';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, email')
      .eq('id', user.id)
      .single();

    const isSuperAdmin =
      profile?.role === 'super_admin' ||
      profile?.email === 'rchopra489@gmail.com' ||
      user.email === 'rchopra489@gmail.com';

    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden: Nobo is restricted to Super Admin only' }, { status: 403 });
    }

    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const hasVision = messages.some((m: any) =>
      (typeof m.content === 'string' && m.content.includes('[Attached File') && m.content.includes('(image)')) ||
      (Array.isArray(m.parts) && m.parts.some((p: any) => p.type === 'image' || p.image))
    );

    const { systemPrompt, tools } = await createAgentContext(supabase, user.id);
    const model = getAgentModel({ hasVision });

    const modelMessages = await (async () => {
      if (messages.length > 0 && !messages[0].parts) {
        return messages;
      }
      return convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      });
    })();

    let result;
    try {
      result = streamText({
        model,
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(10),
        tools,
        onStepFinish: ({ text, toolCalls, toolResults }) => {
          if (toolCalls?.length) {
            console.log('[Nobo Agent Step Tools]:', toolCalls.map(t => t.toolName).join(', '));
          }
          if (text) {
            console.log('[Nobo Agent Step Text]:', text.slice(0, 100));
          }
        },
      });
    } catch (modelErr: any) {
      console.warn('[Nobo Agent] Primary model failed, falling back to Gemini 2.5 Flash:', modelErr?.message);
      result = streamText({
        model: google('gemini-2.5-flash'),
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(10),
        tools,
      });
    }

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      onError: (err) => {
        console.error('[Nobo Agent Stream Error]:', err);
      },
    });
  } catch (err: any) {
    console.error('[Agent API] Fatal Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
