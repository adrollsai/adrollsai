/**
 * Does merely PRESENTING reasoning_content on the replayed assistant messages
 * satisfy DeepSeek's thinking mode?
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';

const key = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const base = JSON.parse(fs.readFileSync('.tmp-deepseek-request.json', 'utf8'));

async function send(label, body) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let msg = '';
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message ?? (j?.choices?.[0]?.message?.content ?? '').slice(0, 60);
  } catch {
    msg = text.slice(0, 80);
  }
  console.log(`${res.status === 200 ? 'OK  ' : 'FAIL'} ${label} → ${res.status} ${msg.slice(0, 110)}`);
  return res.status === 200;
}

function withReasoning(value) {
  const copy = JSON.parse(JSON.stringify(base));
  for (const m of copy.messages) {
    if (m.role === 'assistant') m.reasoning_content = value;
  }
  return copy;
}

(async () => {
  await send('baseline (no reasoning_content)', base);
  await send('reasoning_content on every assistant', withReasoning('Continuing the task.'));
  await send('reasoning_content = empty string', withReasoning(''));

  // Only on assistant messages that carry tool_calls.
  const onlyToolCalls = JSON.parse(JSON.stringify(base));
  for (const m of onlyToolCalls.messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) m.reasoning_content = 'Continuing the task.';
  }
  await send('reasoning_content only on tool-call assistants', onlyToolCalls);

  // Append a user turn after the final tool result.
  const plusUser = JSON.parse(JSON.stringify(base));
  plusUser.messages.push({ role: 'user', content: 'Continue the task.' });
  await send('baseline + trailing user turn', plusUser);
})();
