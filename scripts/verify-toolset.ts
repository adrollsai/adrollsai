/**
 * Confirms the media tools are in the catalogue the model actually receives,
 * and reports roughly what that catalogue costs per step.
 *
 *   npm run verify:toolset
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

const MEDIA_TOOLS = ['generate_voiceover', 'generate_grok_video', 'generate_ai_image', 'check_media_task'];

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profile } = await sb.from('profiles').select('id, business_name').limit(1).maybeSingle();
  if (!profile?.id) {
    console.error('no profile to test against');
    process.exit(1);
  }

  const { tools, systemPrompt } = await createAgentContext(sb, profile.id);
  const names = Object.keys(tools).sort();

  console.log(`Tools in agent catalogue: ${names.length}\n`);
  for (const m of MEDIA_TOOLS) {
    const present = names.includes(m);
    const desc = present ? String((tools as any)[m]?.description || '').slice(0, 58) : '—';
    console.log(`${present ? 'PASS' : 'FAIL'}  ${m.padEnd(22)} ${desc}…`);
  }

  console.log(`\nPrompt mentions generate_voiceover:  ${/generate_voiceover/.test(systemPrompt)}`);
  console.log(`Prompt mentions generate_grok_video: ${/generate_grok_video/.test(systemPrompt)}`);

  const schemaChars = names.reduce(
    (sum, n) => sum + JSON.stringify((tools as any)[n]?.inputSchema ?? (tools as any)[n]?.parameters ?? '').length,
    0
  );
  console.log(`\nCatalogue: ${names.length} tools, prompt ~${Math.round(systemPrompt.length / 4)} tokens, ` +
    `schemas ~${Math.round(schemaChars / 4)} tokens`);

  const missing = MEDIA_TOOLS.filter((m) => !names.includes(m));
  if (missing.length) {
    console.error(`\nMissing from catalogue: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll media tools registered.');
})().catch((err) => {
  console.error('failed:', err?.message || err);
  process.exit(1);
});
