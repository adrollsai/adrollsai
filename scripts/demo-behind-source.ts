/**
 * Produces the source clip for the "text behind subject" demo.
 * Generates a short talking-head with Grok Imagine, then prints its R2 URL.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createMediaStudioTools } from '../lib/agent/tools/media_studio';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

(async () => {
  const { data: profile } = await sb.from('profiles').select('id, business_name').limit(1).maybeSingle();
  if (!profile?.id) throw new Error('no profile');

  const tools = createMediaStudioTools(sb, profile.id) as Record<string, any>;
  const res = await tools.generate_grok_video.execute(
    {
      prompt:
        'Photorealistic medium close-up of a young woman speaking directly to camera, head and shoulders centred, static locked-off camera, plain soft grey studio background, natural daylight, calm neutral expression, subtle head movement, 9:16 vertical, smooth cinematic look',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
      title: 'Demo source: presenter',
    },
    { toolCallId: 'demo_source', messages: [] }
  );

  console.log(JSON.stringify(res, null, 2));
  if (!res?.videoUrl) {
    console.error('no video produced');
    process.exit(1);
  }
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
