/**
 * Replay the captured request verbatim, then bisect what triggers the error.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';

const key = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const base = JSON.parse(fs.readFileSync('.tmp-deepseek-request.json', 'utf8'));

const sizeOf = (o) => JSON.stringify(o).length;

async function send(label, body) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let snippet = '';
  try {
    snippet = JSON.parse(text)?.error?.message ?? '';
  } catch {
    snippet = text.slice(0, 80);
  }
  console.log(
    `${res.status === 200 ? 'OK  ' : 'FAIL'} ${label} (body ${sizeOf(body)} bytes, ${body.messages?.length ?? 0} msgs, ${body.tools?.length ?? 0} tools) ${snippet.slice(0, 90)}`
  );
  return res.status === 200;
}

(async () => {
  console.log('base body:', sizeOf(base), 'bytes\n');
  await send('verbatim replay', base);

  // 1. without the tool catalogue
  const noTools = { ...base, messages: base.messages };
  delete noTools.tools;
  await send('no tools', noTools);

  // 2. biggest tool-call arguments truncated
  const truncated = JSON.parse(JSON.stringify(base));
  for (const m of truncated.messages) {
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 400) {
          tc.function.arguments = tc.function.arguments.slice(0, 400) + '..."}';
        }
      }
    }
  }
  await send('big tool-call args truncated', truncated);

  // 3. tool results truncated
  const shortResults = JSON.parse(JSON.stringify(base));
  for (const m of shortResults.messages) {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 300) {
      m.content = m.content.slice(0, 300) + '…';
    }
  }
  await send('tool results truncated', shortResults);

  // 4. only the first half of the messages
  const half = JSON.parse(JSON.stringify(base));
  half.messages = half.messages.slice(0, Math.ceil(half.messages.length / 2));
  await send('first half of messages', half);
})();
