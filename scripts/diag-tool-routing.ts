import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

for (const intent of ['make a cinematic ad video', 'make a video ad with voiceover', 'generate a video']) {
  const ctx = await createAgentContext(admin, '9c0748de-e3da-4ea1-b323-4ce736b5ca7c', { intentText: intent });
  const tools = Object.keys(ctx.tools as any);
  const media = tools.filter((t) => /video|voice|image|media/i.test(t));
  console.log(`\nintent: "${intent}"`);
  console.log(`  tools: ${tools.length}`);
  console.log(`  media-ish: ${media.join(', ') || 'NONE'}`);
  console.log(`  has generate_grok_video: ${tools.includes('generate_grok_video')}`);
  console.log(`  has sandbox_render_hyperframes: ${tools.includes('sandbox_render_hyperframes')}`);
}
