/**
 * Have the AGENT build a high-converting landing page for this business.
 *
 * This is deliberately a real conversation turn rather than a direct tool call: the point is to see
 * what the agent produces from the business's own profile and inventory, and whether it reaches for
 * the vendored design skills (scroll-craft, ui-ux-pro-max) before it starts designing.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { generateText, stepCountIs } from 'ai';
import { createAgentContext } from '../lib/agent/orchestrator';
import { getAgentModel } from '../lib/agent/deepseek';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

const PROMPT =
  'Create a high-converting landing page for Nobogent, based on my brand profile and what is in ' +
  'my catalogue. It should be genuinely good at converting a visitor: a clear promise, proof, ' +
  'the offer, and one obvious action. Build it now.';

const before = new Date().toISOString();
const ctx = await createAgentContext(admin, OWNER, { intentText: PROMPT });
const called: string[] = [];
let reply = '';

const res = await generateText({
  model: await getAgentModel(),
  system: ctx.systemPrompt,
  prompt: PROMPT,
  tools: ctx.tools as any,
  stopWhen: stepCountIs(24),
  onStepFinish: (step: any) => {
    for (const tc of step.toolCalls || []) if (tc?.toolName) called.push(tc.toolName);
    if (step.text) reply += `\n${step.text}`;
  },
});

console.log('tools used:', [...new Set(called)].join(', '));
console.log('\n--- what the agent says ---');
console.log((res.text || reply).trim().slice(0, 1500));

const { data: pages } = await admin
  .from('landing_pages')
  .select('id, slug, title, updated_at')
  .eq('user_id', OWNER)
  .order('updated_at', { ascending: false })
  .limit(3);
console.log('\n--- landing pages now ---');
console.log(JSON.stringify(pages, null, 2));

const newest = (pages ?? []).find((p: any) => new Date(p.updated_at).getTime() > new Date(before).getTime() - 60_000);
if (newest) {
  fs.writeFileSync('.tmp-new-page.txt', `${newest.slug}`);
  const { data: full } = await admin.from('landing_pages').select('html_content').eq('id', newest.id).maybeSingle();
  if (full?.html_content) {
    fs.writeFileSync('C:\\Users\\Adrolls\\Desktop\\nobo-e2e\\agent-page.html', full.html_content);
    console.log(`\nsaved the page HTML (${full.html_content.length} chars) → nobo-e2e/agent-page.html`);
  }
}
