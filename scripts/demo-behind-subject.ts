/**
 * Demo: "text behind the subject" — pure 2D matting + compositing.
 *
 * Runs the exact recipe now in the agent's system prompt:
 *   frames -> per-frame person alpha matte -> blend -> mp4
 *
 * Uses MediaPipe's TASKS API with the selfie_multiclass model. The legacy
 * `mp.solutions.selfie_segmentation` API no longer exists in MediaPipe 1.x
 * (the sandbox resolves 1.2.2 on Python 3.13), and multiclass is better here
 * anyway: it separates hair from background, which is exactly the edge that
 * matters when text passes behind a head.
 *
 *   npm run demo:behind
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import {
  getOrCreateSandbox,
  touchSandbox,
  uploadSandboxArtifactToR2,
  pauseSandbox,
} from '../lib/agent/sandbox';

const SOURCE =
  process.env.DEMO_SOURCE_VIDEO ||
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/426490e7-c7ec-43b7-979f-a891f947ab3c/1794247281040_grok_text_to_video_1794247280049.mp4';
const USER = 'demo-behind';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

const PY = String.raw`
import cv2, glob, os, numpy as np
from PIL import Image, ImageDraw, ImageFont
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

SRC = 'frames'
OUT = 'out'
os.makedirs(OUT, exist_ok=True)

files = sorted(glob.glob(SRC + '/*.png'))
print('frames:', len(files), flush=True)
if not files:
    raise SystemExit('no frames')

base = mp_python.BaseOptions(model_asset_path='selfie_multiclass_256x256.tflite')
opts = vision.ImageSegmenterOptions(
    base_options=base,
    output_category_mask=True,
    output_confidence_masks=True,
)
seg = vision.ImageSegmenter.create_from_options(opts)
print('segmenter ready', flush=True)

FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
if not os.path.exists(FONT):
    cands = glob.glob('/usr/share/fonts/**/*Bold*.ttf', recursive=True)
    FONT = cands[0] if cands else ''
print('font:', FONT, flush=True)

LINE1 = 'NOBOGENT'
LINE2 = 'BEHIND THE HEAD'

for i, path in enumerate(files):
    bgr = cv2.imread(path)
    h, w = bgr.shape[:2]
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    res = seg.segment(mp_img)

    # Confidence mask 0 is the background category -> person alpha = 1 - bg.
    if getattr(res, 'confidence_masks', None):
        bg = np.squeeze(res.confidence_masks[0].numpy_view())
        bg = cv2.resize(bg.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
        alpha = 1.0 - bg
    else:
        cat = np.squeeze(res.category_mask.numpy_view()).astype(np.float32)
        cat = cv2.resize(cat, (w, h), interpolation=cv2.INTER_NEAREST)
        alpha = (cat > 0).astype(np.float32)

    # Sharpen the mid-tones a little: kills faint halo, keeps a feathered edge.
    alpha = np.clip((alpha - 0.20) / 0.60, 0.0, 1.0)
    a3 = np.dstack([alpha, alpha, alpha]).astype(np.float32)

    pil = Image.fromarray(rgb)
    d = ImageDraw.Draw(pil)
    f1 = ImageFont.truetype(FONT, int(h * 0.125))
    f2 = ImageFont.truetype(FONT, int(h * 0.042))
    stroke = max(2, int(h * 0.005))

    def center(txt, font, y, fill):
        bb = d.textbbox((0, 0), txt, font=font)
        d.text(((w - (bb[2] - bb[0])) / 2.0, y), txt, font=font, fill=fill,
               stroke_width=stroke, stroke_fill=(0, 0, 0))

    y1 = h * 0.28
    center(LINE1, f1, y1, (255, 255, 255))
    center(LINE2, f2, y1 + h * 0.135, (255, 210, 60))

    text_rgb = np.asarray(pil).astype(np.float32)
    frame_f = rgb.astype(np.float32)

    # Inside the person -> clean frame. Outside -> text over the video.
    out = text_rgb * (1.0 - a3) + frame_f * a3
    cv2.imwrite(os.path.join(OUT, os.path.basename(path)),
                cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))

    if i % 40 == 0:
        print('composited', i, '/', len(files), flush=True)

print('composited all', flush=True)
`;

(async () => {
  const t0 = Date.now();
  const sandbox = await getOrCreateSandbox(USER);
  touchSandbox(USER, 20 * 60 * 1000);
  console.log(`sandbox ready in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  await sandbox.files.write('/home/user/behind.py', PY);

  const script = `
export PATH=/usr/local/bin:$PATH
set -e
cd /home/user
rm -rf src.mp4 frames out final.mp4 && mkdir -p frames out

echo "== deps"
pip install --quiet --disable-pip-version-check mediapipe opencv-python-headless pillow numpy 2>&1 | tail -2

echo "== model"
if [ ! -f selfie_multiclass_256x256.tflite ]; then
  curl -fsSL "${MODEL_URL}" -o selfie_multiclass_256x256.tflite
fi
ls -l selfie_multiclass_256x256.tflite

echo "== source"
curl -fsSL -A "Mozilla/5.0" "${SOURCE}" -o src.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of default=nw=1 src.mp4

echo "== extract"
ffmpeg -v error -i src.mp4 -vf fps=30 -q:v 2 frames/%05d.png
echo "extracted: $(ls frames | wc -l)"

echo "== composite"
time python3 behind.py

echo "== encode"
ffmpeg -v error -y -framerate 30 -i out/%05d.png -i src.mp4 -map 0:v -map 1:a? \
  -c:v libx264 -crf 20 -preset veryfast -pix_fmt yuv420p -shortest final.mp4
ls -l final.mp4
ffprobe -v error -show_entries format=duration,size -of default=nw=1 final.mp4
`;

  const run = await sandbox.commands.run(script, {
    timeoutMs: 1_200_000,
    onStdout: (d: string) => process.stdout.write(d),
  });

  if (run.exitCode !== 0) {
    console.error('\nPIPELINE FAILED');
    console.error((run.stderr || '').slice(-2500));
    await pauseSandbox(USER);
    process.exit(1);
  }

  const finalUrl = await uploadSandboxArtifactToR2('final.mp4', USER);
  const sourceUrl = await uploadSandboxArtifactToR2('src.mp4', USER);

  // Pull one composited frame back so the result can be eyeballed.
  const mid = await sandbox.commands.run('ls /home/user/out | sort | sed -n "90p;1p"', { timeoutMs: 20_000 });
  const names = (mid.stdout || '').trim().split('\n');
  const pick = names[0] || '00090.png';
  const bytes = await sandbox.files.read(`out/${pick}`, { format: 'bytes' } as any);
  fs.mkdirSync('.demo', { recursive: true });
  fs.writeFileSync('.demo/behind_frame.png', Buffer.from(bytes as any));

  await pauseSandbox(USER);

  console.log('\n=== DEMO OUTPUT');
  console.log('source :', sourceUrl);
  console.log('result :', finalUrl);
  console.log('frame  : .demo/behind_frame.png (' + pick + ')');
})().catch(async (e) => {
  console.error('failed:', e?.message || e);
  try {
    await pauseSandbox(USER);
  } catch {}
  process.exit(1);
});
