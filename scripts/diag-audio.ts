// What exactly did the agent pass to sandbox_render_hyperframes, and did the
// video it rendered actually contain an audio stream?
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

(async () => {
  const { data: events } = await admin
    .from('harness_events')
    .select('seq, type, data')
    .eq('session_id', '5746440c-2c7e-4a22-be3b-bc72bf4694ba')
    .order('seq', { ascending: true });

  for (const e of events || []) {
    const d = e.data || {};
    if (e.type === 'tool.call' && d.name === 'sandbox_render_hyperframes') {
      const input = d.input || {};
      console.log(`#${e.seq} sandbox_render_hyperframes input keys:`, Object.keys(input).join(', '));
      console.log('  audioUrl:', input.audioUrl ?? '(ABSENT)');
      console.log('  resolution:', input.resolution);
      console.log('  durationSeconds:', input.durationSeconds);
      console.log('  html length:', typeof input.htmlContent === 'string' ? input.htmlContent.length : 'n/a');
      const html = typeof input.htmlContent === 'string' ? input.htmlContent : '';
      console.log('  html mentions <audio>:', /<audio/i.test(html));
      console.log('  html mentions .wav/.mp3:', /\.(wav|mp3)/i.test(html));
    }
    // Did it produce audio assets at all?
    if (e.type === 'tool.result' && typeof d.output?.stdout === 'string' && /wav|mp3|audio/i.test(d.output.stdout)) {
      console.log(`#${e.seq} AUDIO-RELATED tool output:`, d.output.stdout.slice(0, 240).replace(/\n/g, ' | '));
    }
  }
})();
