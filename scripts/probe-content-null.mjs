/**
 * Is `content: null` (as the AI SDK sends) the trigger, versus `content: ''`?
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const key = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const tool = [
  {
    type: 'function',
    function: { name: 'noop', description: 'does nothing', parameters: { type: 'object', properties: {} } },
  },
];

async function attempt(label, contentValue) {
  const assistant = {
    role: 'assistant',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'noop', arguments: '{}' } }],
  };
  if (contentValue !== 'ABSENT') assistant.content = contentValue;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-flash',
      max_tokens: 16,
      tools: tool,
      messages: [
        { role: 'user', content: 'call noop' },
        assistant,
        { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
        { role: 'user', content: 'reply OK' },
      ],
    }),
  });
  console.log(`${res.status === 200 ? 'OK  ' : 'FAIL'} content=${JSON.stringify(contentValue)} → ${res.status} ${res.status === 200 ? '' : (await res.text()).slice(0, 140)}`);
}

(async () => {
  await attempt('null', null);
  await attempt('empty string', '');
  await attempt('absent', 'ABSENT');
})();
