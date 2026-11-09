/**
 * Reference recipes — tested pipelines the agent can pull in instead of
 * rediscovering from scratch.
 *
 * A live run of the "text behind the person's head" request produced a correct
 * result but took 38 steps and ~14 minutes, because the model had to invent the
 * matte pipeline and then solve type placement numerically. This recipe is that
 * same work distilled into one script with the placement solved properly, so the
 * agent's job becomes "adapt the parameters and check the output".
 *
 * Everything here has been executed end to end on a real clip. Keep it that way:
 * do not add a recipe that has not actually produced a verified artefact.
 */

export interface RecipeFile {
  path: string;
  content: string;
}

export interface Recipe {
  name: string;
  title: string;
  whenToUse: string;
  usage: string;
  notes: string[];
  files: RecipeFile[];
}

/** Parameterised matte + composite pipeline. Stdlib + mediapipe + opencv + PIL. */
const TEXT_BEHIND_SUBJECT_PY = String.raw`
#!/usr/bin/env python3
"""Composite text so a person in a video occludes part of it.

Blend: out = mix(frame_with_text, frame, person_alpha)
  - person alpha 1 -> original frame (no text)
  - person alpha 0 -> text over the video
That is what makes the text read as sitting BEHIND the subject, and it avoids
the halo that naive layer-stacking produces.

Placement is solved numerically against the measured silhouette, so the split
lands on clean letter boundaries instead of half-eaten glyphs.

Usage:
  python3 behind.py --src in.mp4 --out out.mp4 \
      --line1 "NOBOGENT" --line2 "BEHIND THE HEAD"

Everything else is optional and has sensible defaults.
"""
import argparse, glob, json, os, re, shutil, subprocess, sys

def run(cmd, check=True):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit("command failed: %s\n%s" % (cmd, (r.stderr or r.stdout)[-1500:]))
    return r.stdout

def probe(src):
    out = run('ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of json "%s"' % src)
    s = json.loads(out)["streams"][0]
    n, d = s["r_frame_rate"].split("/")
    return int(s["width"]), int(s["height"]), float(n) / float(d)

def has_audio(src):
    return bool(run('ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "%s"' % src, check=False).strip())

def pick_font(explicit):
    if explicit and os.path.exists(explicit):
        return explicit
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        if os.path.exists(p):
            return p
    hits = glob.glob("/usr/share/fonts/**/*Bold*.ttf", recursive=True)
    if hits:
        return hits[0]
    raise SystemExit("no bold TTF found; pass --font")

def extract(src, work, fps):
    frames = os.path.join(work, "frames")
    shutil.rmtree(frames, ignore_errors=True)
    os.makedirs(frames, exist_ok=True)
    run('ffmpeg -v error -y -i "%s" -vf fps=%s -q:v 2 "%s/%%05d.png"' % (src, fps, frames))
    files = sorted(glob.glob(os.path.join(frames, "*.png")))
    if not files:
        raise SystemExit("no frames extracted")
    return files

def segment(files, work, model):
    import cv2, numpy as np, mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    alpha_dir = os.path.join(work, "alpha")
    shutil.rmtree(alpha_dir, ignore_errors=True)
    os.makedirs(alpha_dir, exist_ok=True)

    opts = vision.ImageSegmenterOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model),
        output_category_mask=False,
        output_confidence_masks=True,
    )
    seg = vision.ImageSegmenter.create_from_options(opts)

    for i, f in enumerate(files):
        bgr = cv2.imread(f)
        h, w = bgr.shape[:2]
        rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        res = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        # confidence_masks[0] is the BACKGROUND category
        bg = np.squeeze(res.confidence_masks[0].numpy_view()).astype(np.float32)
        if bg.shape != (h, w):
            bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)
        np.save(os.path.join(alpha_dir, "%05d.npy" % i), (1.0 - bg).astype(np.float32))
        if i % 40 == 0:
            print("segmented %d/%d" % (i, len(files)), flush=True)
    return alpha_dir

def average_mask(alpha_dir, samples=20):
    import numpy as np
    files = sorted(glob.glob(os.path.join(alpha_dir, "*.npy")))
    step = max(1, len(files) // samples)
    sel = files[::step][:samples]
    return np.mean([np.load(f) for f in sel], axis=0)

def evaluate(person, font, text, tracking, top, xcenter):
    """How well does this layout read as 'text behind the subject'?"""
    import numpy as np
    H, W = person.shape
    adv = [font.getlength(c) for c in text]
    total = sum(adv) + tracking * max(0, len(text) - 1)
    capb = font.getbbox("H")
    caph = max(4, capb[3] - capb[1])
    band_top, band_bot = int(top), int(top + caph)
    if band_top < 0 or band_bot > H:
        return None
    x = xcenter - total / 2.0
    vis = []
    for c, a in zip(text, adv):
        sx, ex = x, x + a
        x += a + tracking
        if c == " ":
            continue
        x0i, x1i = max(0, int(sx)), min(W, int(ex))
        if x1i <= x0i:
            continue
        occ = float(person[band_top:band_bot, x0i:x1i].mean())
        vis.append(1.0 - occ)
    if len(vis) < 3:
        return None
    v = np.array(vis)
    # C = clearly visible, H = hidden, P = cut through the middle of a glyph
    pattern = "".join("C" if t >= 0.85 else ("H" if t <= 0.15 else "P") for t in v)
    if not re.search(r"^C{2,}H+C{2,}$", pattern) and not re.search(r"^C{2,}[CHP]*H[CHP]*C{2,}$", pattern):
        return None
    partial = pattern.count("P")
    lc = len(pattern) - len(pattern.lstrip("C"))
    rc = len(pattern) - len(pattern.rstrip("C"))
    hr = max((len(m) for m in re.findall(r"H+", pattern)), default=0)
    if hr < 1 or lc < 2 or rc < 2:
        return None
    # Readability first: the word must still be recognisable, so keep as many
    # letters legible as possible and only hide the minimum that reads as
    # occlusion. Hiding half the word ("NO...NT") looks broken; hiding the middle
    # third ("NOB...ENT") looks designed.
    score = 2.0 * (lc + rc) - 2.0 * max(0, hr - 1) - 5.0 * partial - abs(total - W * 0.94) / W
    return {
        "score": score,
        "pattern": pattern,
        "left_clear": lc,
        "right_clear": rc,
        "hidden_run": hr,
        "partials": partial,
        "xcenter": xcenter,
        "top": int(top),
        "size": int(font.size),
        "tracking": tracking,
        "width": float(total),
        "vis": [round(float(t), 2) for t in v],
    }

def solve(person, font_path, text, W):
    import cv2
    import numpy as np
    from PIL import ImageFont

    # Classify letter visibility at 2x. At native resolution (e.g. 416px wide) a
    # single glyph spans so few pixels that a letter sitting on the hairline is
    # misread as fully hidden, which pushes the split too far outward.
    UP = 2
    person = cv2.resize(
        person.astype(np.float32), None, fx=UP, fy=UP, interpolation=cv2.INTER_LINEAR
    ) > 0.5
    H, W = person.shape

    best = None
    for relax in (False, True):
        for size in range(max(20, int(H * 0.045)), int(H * 0.24), 2):
            font = ImageFont.truetype(font_path, size)
            for tracking in (0.0, size * 0.05, size * 0.10, size * 0.15):
                for top in range(0, int(H * 0.42), 2):
                    cand = evaluate(person, font, text, tracking, top, W / 2.0)
                    if not cand:
                        continue
                    ok = cand["left_clear"] >= 2 and cand["right_clear"] >= 2 and cand["hidden_run"] >= 1
                    if not relax:
                        # Prefer the designed look: ends readable, only the middle
                        # third hidden. Hiding most of the word reads as broken.
                        ok = ok and cand["partials"] == 0 and cand["hidden_run"] <= 3
                    else:
                        ok = ok and cand["partials"] <= 1 and cand["hidden_run"] <= 5
                    if ok and (best is None or cand["score"] > best["score"]):
                        best = cand
        if best:
            break

    if not best:
        return None
    for k in ("size", "top", "tracking", "xcenter", "width"):
        best[k] = round(best[k] / float(UP), 3) if k != "size" and k != "top" else best[k] // UP
    return best

def render(files, alpha_dir, work, out_dir, W, H, font_path, layout, line1, line2, ss, c1, c2, native_w):
    import cv2, numpy as np
    from PIL import Image, ImageDraw, ImageFont

    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)

    # layout values are in source-frame pixels; scale them to the output size.
    scale = W / float(native_w)
    nat_size = max(8, int(layout["size"] * scale))
    f1 = ImageFont.truetype(font_path, nat_size * ss)
    track1 = layout["tracking"] * scale * ss
    size2 = max(10, int(nat_size * 0.42))
    f2 = ImageFont.truetype(font_path, size2 * ss)
    track2 = size2 * 0.16 * ss
    y1 = layout["top"] * scale * ss
    y2 = y1 + int(nat_size * ss * 1.55)

    def draw_tracked(d, text, font, tracking, y, fill):
        adv = [font.getlength(c) for c in text]
        total = sum(adv) + tracking * max(0, len(text) - 1)
        x = (W * ss - total) / 2.0
        for c, a in zip(text, adv):
            d.text((x, y), c, font=font, fill=fill)
            x += a + tracking

    k = max(1, int(round(min(W, H) * 0.0018)))
    blur_sigma = max(0.8, min(W, H) * 0.0018)

    for i, f in enumerate(files):
        bgr = cv2.imread(f)
        alpha = np.load(os.path.join(alpha_dir, "%05d.npy" % i))

        big = cv2.resize(bgr, (W, H), interpolation=cv2.INTER_LANCZOS4)
        a = cv2.resize(alpha.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
        # Tuck the type slightly under the silhouette so there is no kiss-edge.
        a = np.clip((a - 0.15) / 0.70, 0.0, 1.0)
        a = cv2.erode(a, np.ones((k, k), np.uint8))
        a = cv2.GaussianBlur(a, (0, 0), blur_sigma)
        a3 = np.dstack([a, a, a]).astype(np.float32)

        layer = Image.new("RGBA", (W * ss, H * ss), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        draw_tracked(d, line1, f1, track1, y1, c1 + (255,))
        if line2:
            draw_tracked(d, line2, f2, track2, y2, c2 + (255,))
        layer = layer.resize((W, H), Image.LANCZOS)

        txt = np.asarray(layer).astype(np.float32)
        ta = (txt[:, :, 3:4] / 255.0)
        frame_rgb = cv2.cvtColor(big, cv2.COLOR_BGR2RGB).astype(np.float32)
        with_text = frame_rgb * (1.0 - ta) + txt[:, :, :3] * ta

        out = with_text * (1.0 - a3) + frame_rgb * a3
        cv2.imwrite(
            os.path.join(out_dir, "%05d.png" % (i + 1)),
            cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR),
        )
        if i % 40 == 0:
            print("rendered %d/%d" % (i, len(files)), flush=True)

def encode(src, out_dir, out, fps, audio, crf, preset):
    cmd = 'ffmpeg -v error -y -framerate %s -start_number 1 -i "%s/%%05d.png"' % (fps, out_dir)
    if audio:
        cmd += ' -i "%s" -map 0:v -map 1:a -c:a copy' % src
    cmd += ' -c:v libx264 -preset %s -crf %s -pix_fmt yuv420p' % (preset, crf)
    if audio:
        cmd += " -shortest"
    cmd += ' "%s"' % out
    run(cmd)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--line1", required=True)
    ap.add_argument("--line2", default="")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1920)
    ap.add_argument("--fps", type=float, default=0, help="0 = keep the source rate")
    ap.add_argument("--font", default="")
    ap.add_argument("--model", default="/home/user/model.tflite")
    ap.add_argument("--work", default="/home/user/behind_work")
    ap.add_argument("--crf", default="18")
    ap.add_argument("--preset", default="medium")
    ap.add_argument("--color1", default="17,24,39")
    ap.add_argument("--color2", default="17,24,39")
    args = ap.parse_args()

    if not os.path.exists(args.model):
        raise SystemExit("segmenter model missing at %s — download selfie_multiclass_256x256.tflite there" % args.model)

    os.makedirs(args.work, exist_ok=True)
    sw, sh, sfps = probe(args.src)
    fps = args.fps or round(sfps, 3)
    font = pick_font(args.font)
    audio = has_audio(args.src)
    print("source %dx%d @ %s fps, audio=%s, font=%s" % (sw, sh, sfps, audio, font), flush=True)

    files = extract(args.src, args.work, fps)
    print("frames: %d" % len(files), flush=True)
    alpha_dir = segment(files, args.work, args.model)

    person = average_mask(alpha_dir) > 0.5
    # Placement is solved in the SOURCE frame's coordinate space, because that is
    # where the measured silhouette lives; render() scales it to the output size.
    native_w = person.shape[1]
    layout = solve(person, font, args.line1, native_w)
    if not layout:
        raise SystemExit(
            "could not find a layout where the ends stay clear and the middle is hidden. "
            "The subject is probably too wide in frame for this line — shorten the text, "
            "raise --width, or pick a frame with more background around the head."
        )
    print("layout: %s" % json.dumps(layout), flush=True)

    c1 = tuple(int(x) for x in args.color1.split(","))
    c2 = tuple(int(x) for x in args.color2.split(","))
    out_dir = os.path.join(args.work, "out")
    render(files, alpha_dir, args.work, out_dir, args.width, args.height, font, layout,
           args.line1, args.line2, 3, c1, c2, native_w)
    encode(args.src, out_dir, args.out, fps, audio, args.crf, args.preset)

    size = os.path.getsize(args.out)
    print(json.dumps({
        "ok": True,
        "video": args.out,
        "bytes": size,
        "width": args.width,
        "height": args.height,
        "fps": fps,
        "frames": len(files),
        "audio_preserved": audio,
        "layout": layout,
    }, indent=2), flush=True)

if __name__ == "__main__":
    main()
`;

export const RECIPES: Record<string, Recipe> = {
  'text-behind-subject': {
    name: 'text-behind-subject',
    title: 'Text that passes behind a person in a video',
    whenToUse:
      'Any request where typography must be occluded by a person already in the footage: "text behind his head", titles passing behind someone, lower thirds that disappear behind the subject.',
    usage:
      'python3 behind.py --src in.mp4 --out out.mp4 --line1 "NOBOGENT" --line2 "BEHIND THE HEAD" [--width 1080 --height 1920] [--fps 24] [--color1 "17,24,39"]',
    notes: [
      'Prerequisite: mediapipe, opencv-python-headless, pillow, numpy, plus the model at /home/user/model.tflite (selfie_multiclass_256x256.tflite from Google storage). ffmpeg is already installed.',
      'The script solves type placement itself: it measures the average silhouette and only accepts a layout where at least two letters stay clear on each end, at least one letter is fully hidden in the middle, and the split falls on a letter boundary. You do not need to sweep fonts or positions by hand.',
      'It prints a JSON summary at the end — read the layout block (left_clear / right_clear / hidden_run / partials) and quote those numbers back to the user.',
      'It keeps the source audio untouched (-c:a copy) and upscales the frame with Lanczos, so a low-res source stays soft; say so rather than claiming sharpness.',
      'Verify the finished file with analyze_video_with_gemini before delivering — the whole point of the blend is subtle, and only a look at the actual output proves it landed.',
      'Do NOT try to do this with an HTML/CSS layer. A web page cannot be occluded by video pixels.',
    ],
    files: [{ path: 'behind.py', content: TEXT_BEHIND_SUBJECT_PY.trim() }],
  },
};

export function getRecipeByName(name: string): Recipe | undefined {
  return RECIPES[name];
}

export function recipeNames(): string[] {
  return Object.keys(RECIPES);
}
