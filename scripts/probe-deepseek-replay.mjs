/**
 * What does DeepSeek's thinking mode actually require when a conversation is
 * replayed? Two minimal requests, differing only in `reasoning_content`.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const key = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();

async function attempt(label, body) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 16, ...body }),
  });
  const text = await res.text();
  const ok = res.status === 200;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} → ${res.status} ${ok ? '' : text.slice(0, 200)}`);
  return ok;
}

const tool = [
  {
    type: 'function',
    function: { name: 'noop', description: 'does nothing', parameters: { type: 'object', properties: {} } },
  },
];

(async () => {
  // 1. assistant tool-call WITHOUT reasoning_content, then the tool result.
  await attempt('tool-call history, no reasoning_content', {
    tools: tool,
    messages: [
      { role: 'user', content: 'call noop' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'noop', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      { role: 'user', content: 'now reply OK' },
    ],
  });

  // 2. Same, but the assistant turn carries reasoning_content.
  await attempt('tool-call history, WITH reasoning_content', {
    tools: tool,
    messages: [
      { role: 'user', content: 'call noop' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'I should call noop.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'noop', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      { role: 'user', content: 'now reply OK' },
    ],
  });

  // 3. Plain text history with a prior assistant message (no tools at all).
  await attempt('plain text history, no tools', {
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'reply OK' },
    ],
  });
})();
