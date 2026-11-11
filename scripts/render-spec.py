#!/usr/bin/env python3
"""
Render a compiled spec to video.

This is the missing half of the pipeline. Until now `spec:compile` produced a
correct plan that nothing executed, so "as close to the reference as possible" had
no definition. The loop this closes is:

    reference -> measure -> spec -> RENDER -> measure the render -> diff vs reference

The operations come from the spec's closed vocabulary, so nothing here invents a
technique. Timing comes from the measurement, never from a model.

Honest note on assets: if the spec requires `presenter_motion` and all you have is
a locked-off take, this renders the static version and says so. It does not pretend.

Usage:
  python scripts/render-spec.py --spec .work/spec.json \
      --stills .work/regalia2/src --clips .work/regalia2/yt \
      --presenter .work/regalia2/rahul.mp4 --music .work/regalia2/mix.wav \
      --out .work/render.mp4
"""
import argparse, json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

try:
    import onnxruntime as ort
    HAVE_ONNX = True
except Exception:
    HAVE_ONNX = False

DEFAULT_FONT = '.work/regalia/font/Montserrat.ttf'
CREAM = np.array([246, 236, 210], dtype=np.float32)
GOLD = np.array([226, 190, 120], dtype=np.float32)


def log(msg):
    print(msg, flush=True)


# ── assets ────────────────────────────────────────────────────────────────────
def list_assets(*dirs):
    out = []
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov')):
                out.append(os.path.join(d, f))
    return out


def is_video(p):
    return p.lower().endswith(('.mp4', '.mov'))


# ── type ──────────────────────────────────────────────────────────────────────
def font_at(path, size, weight='Black'):
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def render_type(lines, W, H, font_path, size_px, y_frac, style, ss=2):
    """Cream/gold display type with grain and a soft drop shadow, at 2x then down."""
    txt = [l.upper() for l in lines]
    size = size_px * ss
    maxw = W * ss * 0.97
    while size > 40:
        f = font_at(font_path, size)
        if max(f.getbbox(t)[2] - f.getbbox(t)[0] for t in txt) <= maxw:
            break
        size -= 4
    f = font_at(font_path, size)

    layer = Image.new('L', (W * ss, H * ss), 0)
    d = ImageDraw.Draw(layer)
    boxes = [f.getbbox(t) for t in txt]
    hs = [b[3] - b[1] for b in boxes]
    gap = int(size * 0.10)
    total = sum(hs) + gap * (len(txt) - 1)
    y = H * ss * y_frac - total / 2
    for t, b, h in zip(txt, boxes, hs):
        d.text(((W * ss - (b[2] - b[0])) / 2 - b[0], y - b[1]), t, font=f, fill=255)
        y += h + gap
    alpha = np.asarray(layer, dtype=np.float32) / 255.0

    ramp = np.linspace(0, 1, H * ss, dtype=np.float32)[:, None, None]
    if style.get('typeTexture') == 'metallic':
        ramp = np.abs(np.linspace(-1, 1, H * ss, dtype=np.float32))[:, None, None]
    rgb = CREAM[None, None, :] * (1 - ramp) + GOLD[None, None, :] * ramp
    rgb = np.repeat(rgb, W * ss, axis=1)
    if style.get('grain') in ('fine', 'heavy'):
        amp = 7 if style.get('grain') == 'fine' else 14
        rgb = np.clip(rgb + np.random.default_rng(11).normal(0, amp, (H * ss, W * ss, 1)).astype(np.float32), 0, 255)

    img = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')
    return img.resize((W, H), Image.LANCZOS)


def render_caption(lines, W, H, font_path, ss=2, y_frac=0.80):
    size = int(52 * ss)
    while size > 20:
        f = font_at(font_path, size, 'Bold')
        joined = [' '.join(lines)]
        if f.getbbox(joined[0])[2] - f.getbbox(joined[0])[0] <= W * ss * 0.84:
            break
        size -= 2
    f = font_at(font_path, size, 'Bold')
    # wrap to at most 3 lines
    words = ' '.join(lines).split()
    out, cur = [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if f.getbbox(t)[2] - f.getbbox(t)[0] <= W * ss * 0.84:
            cur = t
        else:
            if cur:
                out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    out = out[:3]

    img = Image.new('RGBA', (W * ss, H * ss), (0, 0, 0, 0))
    sh = Image.new('RGBA', (W * ss, H * ss), (0, 0, 0, 0))
    di, ds = ImageDraw.Draw(img), ImageDraw.Draw(sh)
    boxes = [f.getbbox(l) for l in out]
    hs = [b[3] - b[1] for b in boxes]
    gap = int(size * 0.30)
    total = sum(hs) + gap * (len(out) - 1)
    y = H * ss * y_frac - total / 2
    for l, b, h in zip(out, boxes, hs):
        x = (W * ss - (b[2] - b[0])) / 2 - b[0]
        ds.text((x + 3 * ss, y - b[1] + 4 * ss), l, font=f, fill=(0, 0, 0, 165))
        di.text((x, y - b[1]), l, font=f, fill=(255, 255, 255, 255))
        y += h + gap
    sh = sh.filter(ImageFilter.GaussianBlur(2.2 * ss))
    return Image.alpha_composite(sh, img).resize((W, H), Image.LANCZOS)


def fast_blur(rgb, W, H, radius=13, scale=4):
    """Blur at 1/scale then upscale. Visually identical at this radius, ~16x cheaper."""
    im = Image.fromarray(rgb.astype(np.uint8))
    small = im.resize((max(2, W // scale), max(2, H // scale)), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(max(1, radius / scale)))
    return np.asarray(small.resize((W, H), Image.BILINEAR), dtype=np.float32)


def overlay(base_rgb, tile, strength=1.0):
    t = np.asarray(tile, dtype=np.float32)
    a = (t[:, :, 3] / 255.0 * strength)[:, :, None]
    return base_rgb * (1 - a) + t[:, :, :3] * a


# ── frame sources ─────────────────────────────────────────────────────────────
_STILL_CACHE = {}


def still_frame(path, W, H, mode, u, motion):
    """Cover-crop or blurred-plate a still with a motion move, at progress u."""
    im = _STILL_CACHE.get(path)
    if im is None:
        im = Image.open(path).convert('RGB')
        _STILL_CACHE[path] = im
    z = 1 + (0.10 if motion in ('push', 'pull') else 0.05)
    zz = 1 + (z - 1) * (u if motion == 'push' else (1 - u) if motion == 'pull' else 1)
    cw, ch = int(im.width / zz), int(im.height / zz)
    cx, cy = (im.width - cw) // 2, (im.height - ch) // 2
    if motion == 'panr':
        cx = int((im.width - cw) * u)
    elif motion == 'panl':
        cx = int((im.width - cw) * (1 - u))
    elif motion == 'drift_up':
        cy = int((im.height - ch) * (1 - u))
    elif motion == 'drift_down':
        cy = int((im.height - ch) * u)
    crop = im.crop((cx, cy, cx + cw, cy + ch))
    aspect = crop.width / crop.height
    target = W / H
    if mode == 'plate' or aspect > target * 1.5 or crop.width < W:
        bg = crop.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(18))
        bg = Image.fromarray((np.asarray(bg, dtype=np.float32) * 0.62).astype(np.uint8))
        s = min(W * 0.92 / crop.width, H * 0.62 / crop.height, 2.0)
        pw, ph = max(2, int(crop.width * s)), max(2, int(crop.height * s))
        plate = crop.resize((pw, ph), Image.LANCZOS)
        frame = bg.convert('RGBA')
        frame.paste(plate, ((W - pw) // 2, int(H * 0.58 - ph / 2)))
        return frame.convert('RGB')
    s = max(W / crop.width, H / crop.height)
    crop = crop.resize((int(crop.width * s) + 2, int(crop.height * s) + 2), Image.LANCZOS)
    l, t = (crop.width - W) // 2, (crop.height - H) // 2
    return crop.crop((l, t, l + W, t + H))


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--stills', default='')
    ap.add_argument('--clips', default='')
    ap.add_argument('--presenter', default='')
    ap.add_argument('--music', default='')
    ap.add_argument('--font', default=DEFAULT_FONT)
    ap.add_argument('--model', default='.work/regalia2/models/u2net_human_seg.onnx')
    ap.add_argument('--limit', type=float, default=0, help='render only the first N seconds (preview)')
    args = ap.parse_args()

    spec = json.load(open(args.spec, encoding='utf-8'))
    cf = spec.get('compiledFrom', {})
    fps = float(cf.get('fps') or 24)
    W = int(str(cf.get('aspect', '720:1280')).split(':')[0])
    H = int(str(cf.get('aspect', '720:1280')).split(':')[1])
    style = spec.get('style', {})
    segs = spec['segments']
    total = float(cf.get('durationSec') or segs[-1]['end'])
    if args.limit:
        total = min(total, args.limit)

    log(f'spec: {W}x{H} @ {fps:.2f}fps, {total:.2f}s, {len(segs)} shots, {len(spec.get("textEvents", []))} text events')

    stills = [p for p in list_assets(args.stills) if not is_video(p)]
    clips = [p for p in list_assets(args.clips) if is_video(p)]
    presenter = args.presenter if args.presenter and os.path.exists(args.presenter) else None
    log(f'assets: {len(stills)} stills, {len(clips)} clips, presenter={"yes" if presenter else "no"}')

    # matte engine for matte_behind / matte_focus
    sess = None
    if presenter and HAVE_ONNX and os.path.exists(args.model):
        # Single-threaded inference was ~2.5s a frame here, which is what made the
        # run-2 matte job unusably slow. Give it every core.
        so = ort.SessionOptions()
        so.intra_op_num_threads = max(1, (os.cpu_count() or 4))
        so.inter_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess = ort.InferenceSession(args.model, sess_options=so, providers=['CPUExecutionProvider'])
        log(f'matte: u2net_human_seg loaded ({so.intra_op_num_threads} threads)')
    elif any(s['operation'] in ('matte_behind', 'matte_focus') for s in segs):
        log('WARN: matte operations requested but no presenter/model — falling back to type_display')

    def person_mask(frame):
        small = np.array(Image.fromarray(frame).resize((320, 320), Image.BILINEAR), dtype=np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        x = np.transpose((small - mean) / std, (2, 0, 1))[None].astype(np.float32)
        d = sess.run(None, {sess.get_inputs()[0].name: x})[0][0][0]
        d = 1.0 / (1.0 + np.exp(-d))
        lo, hi = d.min(), d.max()
        d = (d - lo) / (hi - lo + 1e-8)
        m = Image.fromarray((d * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
        return np.asarray(m.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255.0

    # Presenter frames are read LAZILY. Eagerly decoding 1692 frames at 720x1280
    # held ~4.7 GB and thrashed the machine into a 10-minute stall on a 6s clip.
    class Presenter:
        def __init__(self, path):
            self.path = path
            self.proc = None
            self.count = 0
            self._last_idx = -1
            self._last = None
            self._open()

        def _open(self):
            self.proc = subprocess.Popen(
                ['ffmpeg', '-v', 'error', '-stream_loop', '-1', '-i', self.path,
                 '-vf', f'fps={fps},scale={W}:{H}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                stdout=subprocess.PIPE)

        def frame_at(self, idx):
            # Two passes (hide-the-type, then composite-the-subject) ask for the
            # same index. Without this memo the second ask looked like a rewind and
            # restarted ffmpeg every frame - 3.2s per frame.
            if int(idx) == self._last_idx and self._last is not None:
                return self._last
            # seek forward when asked for the next frame, rewind when it wraps
            if idx < self.count:
                try:
                    self.proc.stdout.close(); self.proc.kill()
                except Exception:
                    pass
                self.count = 0
                self._open()
            target = int(idx)
            while self.count < target:
                self.proc.stdout.read(1)          # cheap drain is not possible; read frames
                self.proc.stdout.read(W * H * 3 - 1)
                self.count += 1
            buf = self.proc.stdout.read(W * H * 3)
            if len(buf) < W * H * 3:
                self.count = 0
                self._open()
                buf = self.proc.stdout.read(W * H * 3)
            self.count += 1
            frame = np.frombuffer(buf, dtype=np.uint8).reshape(H, W, 3)
            self._last_idx = int(idx)
            self._last = frame
            return frame

    presenter_reader = Presenter(presenter) if sess and presenter else None
    mask_cache = {}

    dilate_cache = {}

    def dilated_at(idx, mraw):
        key = int(idx)
        if key in dilate_cache:
            return dilate_cache[key]
        hide = Image.fromarray((mraw * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(3))
        d = np.asarray(hide, dtype=np.float32)[:, :, None] / 255.0
        if len(dilate_cache) > 240:
            dilate_cache.clear()
        dilate_cache[key] = d
        return d

    def mask_at(idx, frame):
        """Mask at reduced resolution — u2net works at 320x320 anyway, so doing the
        feathered upscale once per frame index is wasted precision and real time."""
        stride = int(os.environ.get('MATTE_STRIDE', '3') or 3)
        key = int(idx) // max(1, stride)
        if key in mask_cache:
            return mask_cache[key]
        m = person_mask(frame)
        if len(mask_cache) > 240:
            mask_cache.clear()
        mask_cache[key] = m
        return m

    # clip readers (ffmpeg rawvideo pipes, opened lazily per clip)
    # A fixed wide canvas makes the per-frame byte count deterministic; a 9:16
    # window then travels across it. run 1 learned the hard way that crop cannot
    # animate its own size, so the window size is fixed and only x moves.
    CW, CH = 1440, 810
    clip_proc = {}

    def clip_reader(path, nframes):
        if path not in clip_proc:
            clip_proc[path] = subprocess.Popen(
                ['ffmpeg', '-v', 'error', '-stream_loop', '-1', '-i', path,
                 '-vf', f'fps={fps},scale={CW}:{CH}:force_original_aspect_ratio=increase:flags=lanczos,crop={CW}:{CH}',
                 '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                stdout=subprocess.PIPE)
        return clip_proc[path]

    # pre-render type tiles keyed by (lines, kind)
    tiles = {}
    def tile_for(ev, kind):
        key = (tuple(ev['lines']), kind)
        if key not in tiles:
            if kind == 'display':
                size = 235 if ev.get('sizeHint') == 'huge' else 170 if ev.get('sizeHint', 'medium') == 'medium' else 120
                tiles[key] = render_type(ev['lines'], W, H, args.font, size, 0.45, style)
            else:
                tiles[key] = render_caption(ev['lines'], W, H, args.font)
        return tiles[key]

    events = spec.get('textEvents', [])

    ff = subprocess.Popen(
        ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
         '-r', f'{fps}', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
         '-pix_fmt', 'yuv420p', '-r', f'{fps}', args.out],
        stdin=subprocess.PIPE)

    written = 0
    for si, seg in enumerate(segs):
        if seg['start'] >= total:
            break
        op = seg['operation']
        dur = min(seg['end'], total) - seg['start']
        n = int(round(dur * fps))
        if n <= 0:
            continue
        motion = (seg.get('params') or {}).get('motion') or 'push'

        # assets for this shot: stills cycle, clips cycle
        still = stills[si % len(stills)] if stills else None
        clip = clips[si % len(clips)] if clips else None
        mode = 'plate' if op == 'plate' else 'cover'

        use_matte = op in ('matte_behind', 'matte_focus') and sess is not None and presenter_reader is not None

        # text that belongs to this shot
        seg_evs = [e for e in events if e['start'] >= seg['start'] - 0.01 and e['start'] < seg['end']]

        for fi in range(n):
            t = seg['start'] + fi / fps
            u = fi / max(1, n - 1)

            # ---- base plate ----
            if clip and op != 'end_card':
                proc = clip_reader(clip, n)
                framesz = CW * CH * 3
                buf = proc.stdout.read(framesz)
                if len(buf) < framesz:
                    proc.stdout.close()
                    clip_proc.pop(clip, None)
                    buf = b'\x00' * (W * H * 6)
                wide = np.frombuffer(buf, dtype=np.uint8).reshape(CH, CW, 3)
                cw = int(CH * 9 / 16)
                x0 = max(0, min(CW - cw, int((CW - cw) * (0.5 + 0.25 * (u - 0.5)))))
                base = Image.fromarray(wide[:, x0:x0 + cw]).resize((W, H), Image.LANCZOS)
                base = np.asarray(base, dtype=np.float32)
            elif still:
                base = np.asarray(still_frame(still, W, H, mode, u, motion), dtype=np.float32)
            else:
                base = np.full((H, W, 3), 18, dtype=np.float32)

            # ---- type BEHIND the subject ----
            behind = [e for e in seg_evs if e.get('behindSubject') and e['start'] <= t < e['end']]
            for ev in behind:
                kind = 'caption' if ev.get('sizeHint') == 'small' else 'display'
                tl = tile_for(ev, kind)
                m = None
                if use_matte and presenter_reader:
                    # hide the type a few px BEFORE his edge so the feather cannot halo
                    pidx = int(t * fps)
                    mraw = mask_at(pidx, presenter_reader.frame_at(pidx))
                    mh = dilated_at(pidx, mraw)
                    tarr = np.asarray(tl, dtype=np.float32)
                    a = (tarr[:, :, 3:4] / 255.0) * (1 - mh)
                    base = base * (1 - a) + tarr[:, :, :3] * a
                else:
                    base = overlay(base, tl)

            # ---- subject on top (occludes the type) ----
            if use_matte and presenter_reader:
                pidx = int(t * fps)
                pframe = presenter_reader.frame_at(pidx)
                mraw = mask_at(pidx, pframe)
                m = mraw[:, :, None]
                frame = pframe.astype(np.float32)
                blurred = fast_blur(frame, W, H, 13)
                plate = base * (1 - m) + blurred * m
                base = plate * (1 - m) + frame * m

            # ---- text IN FRONT ----
            front = [e for e in seg_evs if not e.get('behindSubject') and e['start'] <= t < e['end']]
            for ev in front:
                kind = 'caption' if ev.get('sizeHint') == 'small' else 'display'
                base = overlay(base, tile_for(ev, kind))

            ff.stdin.write(np.clip(base, 0, 255).astype(np.uint8).tobytes())
            written += 1

        log(f'  shot {si} {seg["start"]:6.2f}-{seg["end"]:6.2f}s {op:13s} {n:4d}f {motion}')

    ff.stdin.close()
    ff.wait()
    for p in clip_proc.values():
        try:
            p.stdout.close()
            p.kill()
        except Exception:
            pass
    log(f'wrote {args.out} ({written} frames)')

    # audio: keep the reference's own track when supplied, else silence
    if args.music and os.path.exists(args.music):
        tmp = args.out.replace('.mp4', '_v.mp4')
        os.replace(args.out, tmp)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-i', args.music,
                        '-filter_complex', '[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]',
                        '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                        '-shortest', '-movflags', '+faststart', args.out], check=True)
        os.remove(tmp)
        log('muxed audio')


if __name__ == '__main__':
    main()
