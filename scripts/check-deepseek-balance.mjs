// Is the DeepSeek account actually out of credit? One minimal call.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const key = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();

(async () => {
  const models = await fetch('https://api.deepseek.com/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  console.log('GET /models →', models.status);

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: 'say ok' }],
      max_tokens: 5,
    }),
  });
  console.log('POST /chat/completions →', res.status);
  console.log((await res.text()).slice(0, 400));
})();
