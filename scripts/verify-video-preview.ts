/**
 * Can the owner see the edit BEFORE anything is rendered?
 *
 * This is the flow the owner asked for: build the composition, show real stills of it in chat, get
 * approval, and only then spend the delivery render. It only works if `hyperframes snapshot` genuinely
 * produces frames of the composition WITH its graphics applied — so this builds a real animated
 * composition in the sandbox, snapshots it, and then fetches every returned URL independently.
 *
 * It also proves the gating that makes the flow possible: a DRAFT render runs freely (the agent must be
 * able to check its own work), while the DELIVERY render needs an approval.
 *
 *   npx esbuild scripts/verify-video-preview.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-video-preview.mjs && node .tmp-video-preview.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { writeSandboxFile } from '../lib/agent/sandbox';
import { applyReviewGate, type ApprovalStore } from '../lib/agent/review-gate';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const PROJECT = 'gate_preview_demo';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

// ── 1. The gating that makes the flow possible, without spending a render.
console.log('▸ the draft/delivery split');
let executed = 0;
const fakeStore: ApprovalStore = { async approved() { return []; } };
const gated = applyReviewGate(
  {
    sandbox_render_hyperframes: {
      inputSchema: undefined,
      execute: async () => {
        executed++;
        return { success: true, rendered: true };
      },
    },
  },
  fakeStore,
);

const draft = await gated.sandbox_render_hyperframes.execute({ projectName: 'x', quality: 'draft' });
check('a DRAFT render runs without approval', draft?.success === true && draft?.needs_review !== true, 'the agent must be able to check its own work');
check('and it actually executed', executed === 1);

const delivery = await gated.sandbox_render_hyperframes.execute({ projectName: 'x', quality: 'delivery' });
check(
  'a DELIVERY render is refused without approval',
  delivery?.needs_review === true,
  String(delivery?.actionType ?? ''),
);
check('and it did not execute', executed === 1, 'the refusal is real, not cosmetic');
check(
  'the refusal explains why in the owner\'s terms',
  /publish/i.test(String(delivery?.why ?? '')),
  String(delivery?.why ?? ''),
);

// ── 2. A real composition, snapshotted for real.
console.log('\n▸ a real composition, snapshotted');
const ctx = await createAgentContext(sb as any, ORG, { intentText: 'make a 6 second promo reel' });
const previewTool = (ctx.tools as any).sandbox_preview_hyperframes;
check('the preview tool is in the agent toolset', Boolean(previewTool?.execute), ctx.toolGroups.join(','));
check('the prompt tells it to preview before rendering', /BEFORE any delivery render/.test(String(ctx.systemPrompt)));

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0B1220;font-family:Arial,Helvetica,sans-serif;overflow:hidden}
  #root{position:relative;width:540px;height:960px;overflow:hidden}
  .bg{position:absolute;inset:0;background:linear-gradient(160deg,#0B1220 0%,#1E3A5F 100%)}
  .eyebrow{position:absolute;top:90px;left:48px;color:#D0E8FF;font-size:20px;letter-spacing:6px;opacity:0}
  .head{position:absolute;top:400px;left:48px;right:48px;color:#fff;font-size:64px;font-weight:800;line-height:1.02;opacity:0}
  .offer{position:absolute;top:640px;left:48px;color:#7DD3FC;font-size:34px;font-weight:800;opacity:0}
  .cta{position:absolute;top:760px;left:48px;padding:16px 28px;background:#D0E8FF;color:#0B1220;font-size:24px;font-weight:900;border-radius:999px;opacity:0}
</style></head><body>
<div id="root" data-composition-id="gate_preview_demo" data-duration="6">
  <div class="bg"></div>
  <div class="eyebrow" id="e">PROCOLOR FILM ACADEMY</div>
  <div class="head" id="h">DIPLOMA IN<br/>CINEMATOGRAPHY</div>
  <div class="offer" id="o">₹15,000 OFF THE NOVEMBER BATCH</div>
  <div class="cta" id="c">CALL 9569919985</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });        // MUST be paused and registered
  tl.to('#e', { opacity: 1, duration: 0.5 }, 0.2)
    .to('#h', { opacity: 1, duration: 0.7 }, 0.7)
    .to('#o', { opacity: 1, duration: 0.6 }, 2.2)
    .to('#c', { opacity: 1, duration: 0.5 }, 3.4)
    .to({}, { duration: 6 });
  window.__timelines = window.__timelines || {};
  window.__timelines['main'] = tl;
</script>
</body></html>`;

await writeSandboxFile(`${PROJECT}/index.html`, HTML, ORG);
console.log(`  wrote ${PROJECT}/index.html`);

const started = Date.now();
const result = await previewTool.execute(
  { projectName: PROJECT, timestamps: [1.5, 3.0, 5.0], width: 540, title: 'Preview gate' },
  {} as any,
);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`  snapshot in ${seconds}s -> ${JSON.stringify(result).slice(0, 300)}`);

check('the snapshot succeeds', result?.success === true, String(result?.error ?? '').slice(0, 160));
check('it returns one still per requested timestamp', (result?.count ?? 0) === 3, `${result?.count ?? 0} stills`);

const shots: any[] = result?.previews ?? [];
for (const shot of shots) {
  const res = await fetch(shot.url, { method: 'HEAD' }).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  check(
    `  still ${shot.index + 1} resolves as an image`,
    Boolean(res?.ok) && /^image\//i.test(type),
    `HTTP ${res?.status} ${type}`,
  );
}
check('every still has a public URL the chat can load', shots.every((s) => /^https:\/\/\S+\.png$/i.test(String(s.url))));
check(
  'the note tells the agent to get approval before the delivery render',
  /DELIVERY render needs the owner/i.test(String(result?.note ?? '')),
);

// ── 3. A composition that renders nothing must say so, not return empty stills.
console.log('\n▸ a broken composition is reported honestly');
const broken = await previewTool.execute({ projectName: 'gate_preview_missing', frames: 2 }, {} as any);
check(
  'a missing composition is a clear failure, not silence',
  broken?.success === false && /sandbox_write_file|composition/i.test(String(broken?.error ?? '')),
  String(broken?.error ?? '').slice(0, 90),
);

console.log(`\nsnapshot wall clock: ${seconds}s for 3 stills`);
console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
