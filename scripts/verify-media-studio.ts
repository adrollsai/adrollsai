/**
 * Live verification of the Media Studio tools.
 *
 * Calls the real providers through the exact tool `execute` functions the agent
 * uses, so a pass means the agent can genuinely produce this media:
 *   1. generate_voiceover   -> Gemini TTS (Kie) -> MP3 in R2
 *   2. generate_ai_image    -> image model -> PNG in R2 (also the i2v source)
 *   3. generate_grok_video  -> text-to-video
 *   4. generate_grok_video  -> image-to-video (the path the app never used)
 *
 *   npm run verify:media
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createMediaStudioTools } from '../lib/agent/tools/media_studio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}`);
};

/** Confirm a URL is really served, with the content type we expect. */
async function checkServed(url: string, expectPrefix: string) {
  const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
  const type = res.headers.get('content-type') || '';
  const ok = (res.ok || res.status === 206) && type.startsWith(expectPrefix);
  return { ok, detail: `HTTP ${res.status} ${type}` };
}

async function call(tools: Record<string, any>, name: string, args: any) {
  const t = tools[name];
  if (!t?.execute) throw new Error(`tool ${name} has no execute`);
  return t.execute(args, { toolCallId: `verify_${name}`, messages: [] });
}

(async () => {
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('id, business_name')
    .limit(1)
    .maybeSingle();

  if (pErr || !profile?.id) {
    console.error('No profile available to test against:', pErr?.message || 'empty profiles table');
    process.exit(1);
  }
  console.log(`Testing against profile ${profile.id} (${profile.business_name || 'unnamed'})\n`);

  const tools = createMediaStudioTools(supabase, profile.id) as Record<string, any>;

  // 1. Voiceover -------------------------------------------------------------
  const vo = await call(tools, 'generate_voiceover', {
    script:
      'Ready to move into a home that matches your ambition? Book a private tour this weekend and see it for yourself.',
    voiceName: 'Aoede',
    language: 'english',
    title: 'Verify: voiceover',
  });
  if (vo?.success && vo.audioUrl) {
    const served = await checkServed(vo.audioUrl, 'audio/');
    record('generate_voiceover', served.ok, `${served.detail} ${vo.audioUrl.slice(0, 90)}`);
  } else {
    record('generate_voiceover', false, JSON.stringify(vo).slice(0, 300));
  }

  // 2. Image (also the image-to-video source) --------------------------------
  const img = await call(tools, 'generate_ai_image', {
    prompt:
      'Photorealistic ultra-luxury modern white villa exterior at golden hour, infinity pool reflections, palm trees, warm cinematic light, 9:16 vertical, no text',
    aspectRatio: '9:16',
    title: 'Verify: image',
  });
  let sourceImage: string | null = null;
  if (img?.success && img.imageUrl) {
    sourceImage = img.imageUrl;
    const served = await checkServed(img.imageUrl, 'image/');
    record('generate_ai_image', served.ok, `${served.detail} ${img.imageUrl.slice(0, 90)}`);
  } else {
    record('generate_ai_image', false, JSON.stringify(img).slice(0, 300));
  }

  // 3. Grok text-to-video ----------------------------------------------------
  const t2v = await call(tools, 'generate_grok_video', {
    prompt:
      'Slow cinematic 35mm push-in on a modern white villa at golden hour, infinity pool reflecting warm light, palm trees swaying gently, photorealistic, smooth camera motion',
    aspectRatio: '9:16',
    resolution: '480p',
    durationSeconds: 5,
    title: 'Verify: grok t2v',
  });
  if (t2v?.success && (t2v.videoUrl || t2v.taskId)) {
    if (t2v.videoUrl) {
      const served = await checkServed(t2v.videoUrl, 'video/');
      record('grok text-to-video', served.ok, `${served.detail} ${t2v.videoUrl.slice(0, 90)}`);
    } else {
      record('grok text-to-video', true, `accepted, still rendering (task ${t2v.taskId})`);
    }
  } else {
    record('grok text-to-video', false, JSON.stringify(t2v).slice(0, 300));
  }

  // 4. Grok image-to-video ---------------------------------------------------
  if (!sourceImage) {
    record('grok image-to-video', false, 'skipped — no source image');
  } else {
    const i2v = await call(tools, 'generate_grok_video', {
      prompt:
        'Animate this villa with a slow parallax push-in, water rippling in the infinity pool, palm fronds moving in a light breeze, warm golden hour light',
      imageUrls: [sourceImage],
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
      title: 'Verify: grok i2v',
    });
    if (i2v?.success && (i2v.videoUrl || i2v.taskId)) {
      if (i2v.videoUrl) {
        const served = await checkServed(i2v.videoUrl, 'video/');
        record('grok image-to-video', served.ok, `${served.detail} mode=${i2v.mode} ${i2v.videoUrl.slice(0, 90)}`);
      } else {
        record('grok image-to-video', true, `accepted, still rendering (task ${i2v.taskId}) mode=${i2v.mode}`);
      }
    } else {
      record('grok image-to-video', false, JSON.stringify(i2v).slice(0, 300));
    }
  }

  // 5. Assets actually landed in the user's library --------------------------
  // The live table has no `title` column, so the label lives in metadata.
  const { data: saved } = await supabase
    .from('assets')
    .select('id, type, status, url, kie_task_id, metadata')
    .eq('user_id', profile.id)
    .not('kie_task_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  const verified = (saved || []).filter((a: any) =>
    String(a.metadata?.title || '').startsWith('Verify:')
  );
  record(
    'assets saved to library',
    verified.length >= 4,
    `${verified.length} verified rows: ${verified.map((a: any) => `${a.type}/${a.status}`).join(', ')}`
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) console.log(`  - ${f.step}: ${f.detail}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('verification crashed:', err?.message || err);
  process.exit(1);
});
