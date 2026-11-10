import { tool } from 'ai';
import { z } from 'zod';
import {
  executeInE2BSandbox,
  writeSandboxFile,
  readSandboxFile,
  listSandboxDir,
  uploadSandboxArtifactToR2,
  getSandboxCapabilities,
  pauseSandbox,
} from '../sandbox';
import { SupabaseClient } from '@supabase/supabase-js';
import { buildHyperFramesRenderScript } from './hyperframes-render';

/**
 * Reject obvious placeholder writes.
 *
 * Models sometimes emit the literal token "PLACEHOLDER" (or TODO/...) instead of
 * a whole file — usually when the content is long and they "plan" to fill it in
 * later. Writing it creates a broken script that fails several steps later with
 * a baffling `NameError: name 'PLACEHOLDER' is not defined`, which is exactly
 * what happened to a render.py in production. Refusing the write turns a silent
 * landmine into an immediate, self-explanatory error.
 */
function placeholderRejection(path: string, content: string): string | null {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    return `Refused to write ${path}: the content was empty. Send the complete file content.`;
  }
  const isJustToken = /^(placeholder|todo|tbd|fixme|n\/a|\.{3}|…)$/i.test(trimmed);
  const isThinStub = trimmed.length < 40 && /placeholder|todo|tbd/i.test(trimmed);
  if (isJustToken || isThinStub) {
    return (
      `Refused to write ${path}: the content is the placeholder "${trimmed.slice(0, 40)}", not real file content. ` +
      `Write the actual file — do not stub it out and plan to fill it in later.`
    );
  }
  return null;
}

export function createSandboxTools(supabase?: SupabaseClient, userId?: string) {
  return {
    sandbox_bash_run: tool({
      description: 'Executes terminal bash commands in a secure E2B cloud Linux MicroVM. Has full root access to install npm packages, pip packages, run yt-dlp to clip YouTube videos, run FFmpeg for audio/video edits, and execute Node/Python scripts. If your command generates output media (e.g. "output.mp4" or "banner.png"), pass them in readFiles to automatically upload to cloud storage and render in chat.',
      inputSchema: z.object({
        command: z.string().describe('The bash command to run in the sandbox (e.g. "ffmpeg -i ...", "python3 script.py", "npm install ...")'),
        readFiles: z.array(z.string()).optional().describe('Optional list of sandbox output file paths to extract and upload to cloud storage (e.g. ["output.mp4", "banner.png"])'),
        timeoutSeconds: z.number().default(120).describe('Max execution time in seconds (up to 300s)'),
      }),
      execute: async ({ command, readFiles, timeoutSeconds }) => {
        try {
          const safeTimeoutMs = Math.min(Math.max(timeoutSeconds || 120, 10), 300) * 1000;
          const res = await executeInE2BSandbox({
            command,
            readFiles: readFiles || [],
            userId,
            timeoutMs: safeTimeoutMs,
          });

          // Check if any video or image was extracted and generate artifact
          let artifact: any = undefined;
          if (res.uploadedFiles) {
            for (const [filePath, url] of Object.entries(res.uploadedFiles)) {
              if (filePath.endsWith('.mp4')) {
                artifact = {
                  type: 'video_player',
                  title: filePath,
                  videoUrl: url,
                  duration: '15s',
                };
                break;
              } else if (filePath.match(/\.(png|jpg|jpeg|webp)$/i)) {
                artifact = {
                  type: 'image_preview',
                  title: filePath,
                  imageUrl: url,
                };
                break;
              }
            }
          }

          return {
            success: res.success,
            exitCode: res.exitCode,
            stdout: res.stdout?.slice(-4000) || '',
            stderr: res.stderr?.slice(-2000) || '',
            uploadedFiles: res.uploadedFiles,
            artifact,
            error: res.error,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message || 'Failed to execute command in E2B sandbox',
          };
        }
      },
    }),

    sandbox_render_video: tool({
      description: 'Renders high-quality motion-graphics videos (festive greetings, announcements, client promos, social reels) in 1080x1920 (9:16 vertical) or 1920x1080 in the E2B cloud sandbox. Uses FFmpeg and Python to produce real MP4 video, uploads to Cloudflare R2, and returns a playable video player in chat.',
      inputSchema: z.object({
        title: z.string().describe('Title of the video project (e.g. "Nobogent Happy Diwali Greeting")'),
        greeting: z.string().default('Happy Diwali').describe('Main headline greeting text (e.g. "Happy Diwali", "Special Announcement")'),
        message: z.string().default('Wishing you and your team boundless joy, prosperity, and monumental growth.').describe('Heartfelt message body'),
        brandName: z.string().default('Nobogent').describe('Company or sender brand name'),
        brandColor: z.string().default('#0F172A').describe('Primary brand hex color'),
        durationSeconds: z.number().default(15).describe('Target duration in seconds (5-30s)'),
        resolution: z.enum(['1080x1920_vertical', '1920x1080_landscape']).default('1080x1920_vertical'),
        code: z.string().optional().describe('Optional custom Python or Bash code to execute before final encode'),
      }),
      execute: async ({ title, greeting, message, brandName, brandColor, durationSeconds, resolution, code }) => {
        try {
          const isVertical = resolution === '1080x1920_vertical';
          const W = isVertical ? 1080 : 1920;
          const H = isVertical ? 1920 : 1080;
          const dur = Math.min(Math.max(durationSeconds || 15, 5), 30);

          // High-grade procedural motion graphics generator (450 frames @ 30 FPS, particle systems, animated diya, kinetic typography & audio)
          const renderScriptContent = `
import os, sys, math, random, wave, struct, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = ${W}, ${H}
FPS = 30
DUR = ${dur}
TOTAL_FRAMES = FPS * DUR

os.makedirs('output', exist_ok=True)

# 1. Synthesize Melodic Celebratory Festive Chimes & Ambient Harmonics
sample_rate = 44100
total_samples = sample_rate * DUR
audio_bytes = bytearray()
frequencies = [293.66, 329.63, 349.23, 440.0, 493.88, 587.33, 659.25, 880.0]

for s in range(total_samples):
    t = s / sample_rate
    val = 0.22 * math.sin(2 * math.pi * 146.83 * t) + 0.12 * math.sin(2 * math.pi * 220.0 * t)
    beat_t = t % 1.5
    note_idx = int(t / 1.5) % len(frequencies)
    freq = frequencies[note_idx]
    env = math.exp(-beat_t * 3.5)
    val += 0.35 * env * (math.sin(2 * math.pi * freq * t) + 0.5 * math.sin(2 * math.pi * freq * 2 * t))
    if t > 2.0:
        val += 0.08 * math.sin(2 * math.pi * 1760.0 * t) * (0.5 + 0.5 * math.sin(t * 8))
    val = max(-1.0, min(1.0, val))
    audio_bytes.extend(struct.pack('<h', int(val * 32767)))

with open('audio.wav', 'wb') as wav_file:
    with wave.open(wav_file, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_bytes)

# 2. Pre-generate 100 Floating Gold Dust Particles
random.seed(42)
particles = []
for i in range(100):
    particles.append({
        'x': random.uniform(80, W - 80),
        'y': random.uniform(H * 0.15, H * 0.95),
        'speed_y': random.uniform(1.2, 3.5),
        'radius': random.uniform(2, 6),
        'alpha': random.uniform(140, 240),
        'phase': random.uniform(0, math.pi * 2)
    })

# Fireworks Bursts
fireworks = [
    {'center': (260, int(H * 0.22)), 'start_frame': 70, 'color': (251, 191, 36)},
    {'center': (820, int(H * 0.24)), 'start_frame': 160, 'color': (245, 158, 11)},
    {'center': (300, int(H * 0.35)), 'start_frame': 250, 'color': (252, 211, 77)},
    {'center': (780, int(H * 0.20)), 'start_frame': 340, 'color': (245, 158, 11)},
]

# 3. Direct FFmpeg Pipe (Zero Disk Clutter for 450 frames)
ffmpeg_cmd = [
    'ffmpeg', '-y',
    '-f', 'rawvideo', '-vcodec', 'rawvideo',
    '-s', f'{W}x{H}', '-pix_fmt', 'rgba', '-r', str(FPS),
    '-i', '-',
    '-i', 'audio.wav',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    'output/video.mp4'
]
proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

# Fonts
font_huge = None
font_large = None
font_med = None
font_small = None
for fp in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
    if os.path.exists(fp):
        try:
            font_huge = ImageFont.truetype(fp, 68 if W > 1000 else 44)
            font_large = ImageFont.truetype(fp, 48 if W > 1000 else 32)
            font_med = ImageFont.truetype(fp, 32 if W > 1000 else 22)
            font_small = ImageFont.truetype(fp, 24 if W > 1000 else 18)
            break
        except Exception:
            pass

def draw_text_centered(draw, text, y, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=fill)

cx, cy = W // 2, int(H * 0.42)

for f in range(TOTAL_FRAMES):
    t = f / FPS
    im = Image.new('RGBA', (W, H), (11, 15, 25, 255))
    draw = ImageDraw.Draw(im)

    # Ambient radial breathing glow
    pulse = 1.0 + 0.12 * math.sin(t * 3.5)
    for r in range(450, 40, -25):
        alpha = int((18 * (1 - r / 450)) * pulse)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(217, 119, 6, alpha))

    # Glowing Borders
    border_alpha = int(140 + 40 * math.sin(t * 2))
    draw.rounded_rectangle([60, 80, W - 60, H - 80], radius=36, outline=(245, 158, 11, border_alpha), width=3)
    draw.rounded_rectangle([76, 96, W - 76, H - 96], radius=28, outline=(217, 119, 6, 80), width=1)

    # Floating Gold Dust
    for p in particles:
        py = p['y'] - (f * p['speed_y']) % (H * 0.8)
        px = p['x'] + 25 * math.sin(f * 0.05 + p['phase'])
        p_alpha = int(p['alpha'] * (0.6 + 0.4 * math.sin(f * 0.1 + p['phase'])))
        rad = p['radius']
        draw.ellipse([px - rad, py - rad, px + rad, py + rad], fill=(251, 191, 36, p_alpha))

    # Fireworks Bursts
    for fw in fireworks:
        age = f - fw['start_frame']
        if 0 <= age <= 45:
            progress = age / 45.0
            radius = progress * 150
            fw_alpha = int(255 * (1 - progress))
            col = (*fw['color'], fw_alpha)
            fx, fy = fw['center']
            for spark_i in range(16):
                ang = spark_i * (math.pi * 2 / 16)
                sx = fx + radius * math.cos(ang)
                sy = fy + radius * math.sin(ang) + 0.5 * 9.8 * (age * 0.08)**2
                draw.ellipse([sx - 3, sy - 3, sx + 3, sy + 3], fill=col)

    # Animated Vector Diya Lamp
    diya_y = int(H * 0.28)
    flame_flicker = math.sin(f * 0.8) * 8 + math.cos(f * 1.5) * 4
    flame_h = 75 + math.sin(f * 0.6) * 10
    
    draw.ellipse([cx - 90, diya_y - 80, cx + 90, diya_y + 60], fill=(245, 158, 11, int(45 + 15 * math.sin(f * 0.5))))
    draw.chord([cx - 100, diya_y, cx + 100, diya_y + 80], 0, 180, fill=(180, 83, 9, 255), outline=(245, 158, 11, 255), width=3)
    draw.line([cx - 90, diya_y, cx + 90, diya_y], fill=(251, 191, 36, 255), width=3)
    
    flame_top = diya_y - flame_h
    flame_pts = [(cx + flame_flicker * 0.5, flame_top), (cx + 28, diya_y - 20), (cx, diya_y + 5), (cx - 28, diya_y - 20)]
    draw.polygon(flame_pts, fill=(251, 191, 36, 255))
    core_pts = [(cx + flame_flicker * 0.3, flame_top + 20), (cx + 12, diya_y - 15), (cx, diya_y), (cx - 12, diya_y - 15)]
    draw.polygon(core_pts, fill=(255, 255, 255, 240))

    # Kinetic Typography Scenes
    # Scene 1 (0s - 3.2s)
    if t < 3.2:
        alpha1 = int(255 * min(1.0, t * 1.5) * (1.0 if t < 2.5 else max(0.0, (3.2 - t) / 0.7)))
        draw_text_centered(draw, "${brandName.replace(/"/g, '').toUpperCase()} CLIENTS", int(H * 0.48), font_small, (148, 163, 184, alpha1))
        draw_text_centered(draw, "CELEBRATION OF GROWTH", int(H * 0.52), font_large, (245, 158, 11, alpha1))

    # Scene 2 (2.8s - 9.2s)
    if 2.8 <= t < 9.2:
        alpha2 = int(255 * min(1.0, (t - 2.8) * 2.0) * (1.0 if t < 8.3 else max(0.0, (9.2 - t) / 0.9)))
        draw_text_centered(draw, "${greeting.replace(/"/g, '').toUpperCase()}", int(H * 0.46), font_huge, (254, 240, 138, alpha2))
        draw_text_centered(draw, "FESTIVAL OF LIGHTS & PROSPERITY", int(H * 0.52), font_med, (245, 158, 11, alpha2))
        draw_text_centered(draw, "Wishing you and your team boundless joy,", int(H * 0.58), font_small, (241, 245, 249, alpha2))
        draw_text_centered(draw, "radiant health, and monumental milestones.", int(H * 0.61), font_small, (241, 245, 249, alpha2))

    # Scene 3 (8.8s - 15.0s)
    if t >= 8.8:
        alpha3 = int(255 * min(1.0, (t - 8.8) * 2.0))
        draw_text_centered(draw, "WARM WISHES FROM", int(H * 0.47), font_small, (148, 163, 184, alpha3))
        draw_text_centered(draw, "${brandName.replace(/"/g, '').toUpperCase()}", int(H * 0.51), font_huge, (56, 189, 248, alpha3))
        draw_text_centered(draw, "AI Autonomous Business Operator", int(H * 0.58), font_med, (251, 191, 36, alpha3))
        draw_text_centered(draw, "Growing Together into 2026", int(H * 0.63), font_small, (203, 213, 225, alpha3))

    proc.stdin.write(im.tobytes())

proc.stdin.close()
proc.wait()
print("High-definition MP4 render complete: output/video.mp4")
`.trim();

          const buildScript = `
which ffmpeg >/dev/null 2>&1 || (sudo apt-get update -y >/dev/null 2>&1 && sudo apt-get install -y ffmpeg >/dev/null 2>&1)
pip install -q pillow numpy >/dev/null 2>&1 || true
python3 render_card.py
          `.trim();

          const files = [
            { path: 'render_card.py', content: renderScriptContent },
          ];

          if (code) {
            files.push({ path: 'custom_render.py', content: code });
          }

          const res = await executeInE2BSandbox({
            command: buildScript,
            files,
            readFiles: ['output/video.mp4'],
            userId,
            timeoutMs: 120_000,
          });

          let videoUrl = res.uploadedFiles?.['output/video.mp4'] || '';
          if (!videoUrl) {
            throw new Error(`Video rendering pipeline did not produce output: ${res.stderr || res.stdout || 'Unknown error'}`);
          }

          // Same reason as the HyperFrames path: the MP4 is in R2, so stop
          // paying for sandbox compute while the user watches it.
          try {
            await pauseSandbox(userId);
          } catch (e) {}

          if (supabase && userId) {
            const { data: asset } = await supabase
              .from('assets')
              .insert({
                user_id: userId,
                title,
                type: 'video',
                url: videoUrl,
                status: 'ready',
                metadata: {
                  duration: dur,
                  resolution,
                  engine: 'nobogent_motion_renderer',
                  greeting,
                  brandName,
                },
              })
              .select('id, url')
              .maybeSingle();

            if (asset?.url) {
              videoUrl = asset.url;
            }
          }

          return {
            success: true,
            title,
            durationSeconds: dur,
            resolution,
            videoUrl,
            message: `Successfully rendered on-brand ${dur}s ${resolution} video for ${brandName}.`,
            artifact: {
              type: 'video_player',
              title,
              videoUrl,
              duration: `${dur}s`,
              resolution,
            },
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message || 'Failed to render video in sandbox',
          };
        }
      },
    }),

    sandbox_render_hyperframes: tool({
      description: 'Renders a broadcast-quality HyperFrames HTML/CSS/GSAP composition to MP4. Accepts custom HTML, modern CSS (Tailwind, Google Fonts, gradients, glassmorphism), and paused GSAP timelines (window.__timelines["main"] = tl). Frame-by-frame rendered with Headless Chrome into true studio-grade MP4 video.',
      inputSchema: z.object({
        projectName: z.string().default('hyperframes_comp').describe('Project folder name (alphanumeric, e.g. "diwali_reel")'),
        title: z.string().default('HyperFrames Video').describe('Title of the video for the player artifact'),
        htmlContent: z
          .string()
          .optional()
          .describe(
            'Full HTML markup for the composition. OMIT THIS if you already wrote index.html into the sandbox with sandbox_write_file — the renderer will use the file on disk. Never pass a placeholder like "PLACEHOLDER": it overwrites your real file.'
          ),
        durationSeconds: z.number().default(15).describe('Composition duration in seconds (must match root data-duration)'),
        resolution: z.enum(['1080x1920_vertical', '1920x1080_landscape']).default('1080x1920_vertical'),
        quality: z.enum(['draft', 'looks', 'delivery']).default('looks').describe('Encode quality. "draft" is far cheaper and faster and is the right choice while iterating; "looks" is the default CRF 16; "delivery" is the highest quality and slowest.'),        fps: z.number().optional().describe('Frame rate. Omit to keep the composition\'s own data-fps (usually 30). Render time scales linearly with frames = duration x fps, so 24 is ~20% cheaper than 30 and plenty for most motion graphics.'),
        startSeconds: z.number().optional().describe('Render only the span starting at this second — the cheap way to re-check one section while iterating.'),
        endSeconds: z.number().optional().describe('Render only up to this second. Use with startSeconds to re-render just one span.'),
        audioUrl: z.string().optional().describe('Optional URL to real celebratory audio or background music track to mix into the MP4'),
      }),
      execute: async ({ projectName, title, htmlContent, durationSeconds, resolution, quality, fps, startSeconds, endSeconds, audioUrl }) => {
        try {
          const isVertical = resolution === '1080x1920_vertical';
          const dur = Math.min(Math.max(durationSeconds || 15, 5), 60);
          const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'comp';

          // Only write index.html when htmlContent is genuinely a document.
          //
          // This used to be written unconditionally, so an agent that had already
          // built the composition with sandbox_write_file and then passed a
          // placeholder string DESTROYED its own file — the render then failed and
          // the agent spent several steps trying to work out what happened.
          const rawHtml = (htmlContent || '').trim();
          const looksLikeHtml =
            rawHtml.length > 200 &&
            /<!doctype|<html|<head|<body|<div|<style|<script/i.test(rawHtml) &&
            !/^placeholder$/i.test(rawHtml) &&
            !/^(todo|tbd|n\/a|\.\.\.)$/i.test(rawHtml);

          const files = looksLikeHtml ? [{ path: `${safeName}/index.html`, content: rawHtml }] : [];

          const runScript = buildHyperFramesRenderScript({
            projectDir: safeName,
            durationSeconds: dur,
            fps,
            quality,
            startSeconds,
            endSeconds,
            audioUrl,
          });

          const res = await executeInE2BSandbox({
            command: runScript,
            files,
            readFiles: [`${safeName}/out.mp4`],
            userId,
            timeoutMs: 300_000,
          });

          let videoUrl = res.uploadedFiles?.[`${safeName}/out.mp4`] || '';
          if (!videoUrl) {
            const caps = getSandboxCapabilities(userId);
            const missing = caps
              ? [
                  !caps.ffmpeg && 'ffmpeg',
                  !caps.node && 'node>=20',
                  !caps.browsers && 'hyperframes-browser',
                ].filter(Boolean) as string[]
              : [];
            const cause = missing.length
              ? `sandbox is missing ${missing.join(', ')} — the stock E2B image does not ship them; set E2B_TEMPLATE to a pre-built image`
              : (res.error || res.stderr || res.stdout || 'no output produced').slice(0, 600);
            throw new Error(`HyperFrames render did not produce ${safeName}/out.mp4: ${cause}`);
          }

          // The MP4 is safely in R2, so from here the sandbox is only holding
          // project files. Pause it instead of letting it bill compute while the
          // user watches the result; the filesystem survives, so a follow-up
          // render in this session resumes in about a second.
          const renderSeconds = Number((/(?:render-seconds:\s*)(\d+)/.exec(res.stdout || '') || [])[1] || 0) || undefined;
          try {
            await pauseSandbox(userId);
          } catch (e) {}

          if (supabase && userId) {
            const { data: asset } = await supabase
              .from('assets')
              .insert({
                user_id: userId,
                title,
                type: 'video',
                url: videoUrl,
                status: 'ready',
                metadata: {
                  duration: dur,
                  resolution,
                  engine: 'hyperframes',
                },
              })
              .select('id, url')
              .maybeSingle();

            if (asset?.url) {
              videoUrl = asset.url;
            }
          }

          return {
            success: true,
            title,
            durationSeconds: dur,
            resolution,
            videoUrl,
            ...(renderSeconds ? { renderSeconds } : {}),
            message: `Successfully rendered HyperFrames composition (${dur}s, ${resolution}${renderSeconds ? `, ${renderSeconds}s render` : ''}).`,
            artifact: {
              type: 'video_player',
              title,
              videoUrl,
              duration: `${dur}s`,
              resolution,
            },
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message || 'Failed to render HyperFrames composition',
          };
        }
      },
    }),

    sandbox_write_and_run: tool({
      description: 'Writes one or more code files or scripts (Python, Node, Bash, Remotion) directly to the filesystem and executes them inside the E2B Linux MicroVM sandbox. ALWAYS prefer this tool over echo/cat in sandbox_bash_run when creating multi-line scripts to avoid shell quote-escaping issues. Pass output file paths in readFiles to automatically extract and upload to Cloudflare R2.',
      inputSchema: z.object({
        files: z.array(z.object({
          path: z.string().describe('File path in sandbox (e.g. "script.py", "render.js")'),
          content: z.string().describe('File content'),
        })),
        runCommand: z.string().describe('The command to run after writing the files (e.g. "python3 script.py")'),
        readFiles: z.array(z.string()).optional().describe('List of output files to extract and upload to cloud storage (e.g. ["video.mp4"])'),
        timeoutSeconds: z.number().default(120),
      }),
      execute: async ({ files, runCommand, readFiles, timeoutSeconds }) => {
        // Refuse placeholder stubs before they reach the filesystem.
        for (const f of files || []) {
          const bad = placeholderRejection(f.path, f.content);
          if (bad) return { success: false, error: bad };
        }
        try {
          const safeTimeoutMs = Math.min(Math.max(timeoutSeconds || 120, 10), 300) * 1000;
          const res = await executeInE2BSandbox({
            files,
            command: runCommand,
            readFiles: readFiles || [],
            userId,
            timeoutMs: safeTimeoutMs,
          });

          let artifact: any = undefined;
          if (res.uploadedFiles) {
            for (const [filePath, url] of Object.entries(res.uploadedFiles)) {
              if (filePath.endsWith('.mp4')) {
                artifact = {
                  type: 'video_player',
                  title: filePath,
                  videoUrl: url,
                  duration: '15s',
                };
                break;
              } else if (filePath.match(/\.(png|jpg|jpeg|webp)$/i)) {
                artifact = {
                  type: 'image_preview',
                  title: filePath,
                  imageUrl: url,
                };
                break;
              }
            }
          }

          return {
            success: res.success,
            exitCode: res.exitCode,
            stdout: res.stdout?.slice(-4000) || '',
            stderr: res.stderr?.slice(-2000) || '',
            uploadedFiles: res.uploadedFiles,
            artifact,
            error: res.error,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message,
          };
        }
      },
    }),

    sandbox_write_file: tool({
      description: 'Writes a file directly to the sandbox filesystem. Use this for Python scripts, HTML/CSS compositions, configs, or data files without shell quote-escaping issues or heredoc limits.',
      inputSchema: z.object({
        path: z.string().describe('File path in sandbox (e.g. "render.py", "scene/index.html")'),
        content: z.string().describe('The complete file content to write'),
      }),
      execute: async ({ path, content }) => {
        const badWrite = placeholderRejection(path, content);
        if (badWrite) return { success: false, error: badWrite };
        try {
          const res = await writeSandboxFile(path, content, userId);
          return { success: true, path: res.path, message: `Successfully wrote ${content.length} bytes to ${res.path}` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    sandbox_read_file: tool({
      description: 'Reads the text content of a file from the sandbox filesystem.',
      inputSchema: z.object({
        path: z.string().describe('File path to read in the sandbox'),
        maxLines: z.number().default(300).describe('Maximum lines of content to return'),
      }),
      execute: async ({ path, maxLines }) => {
        try {
          const res = await readSandboxFile(path, userId, maxLines);
          return res;
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    sandbox_list_files: tool({
      description: 'Lists files and folders in a sandbox directory.',
      inputSchema: z.object({
        path: z.string().default('.').describe('Directory path in sandbox (defaults to current directory)'),
      }),
      execute: async ({ path }) => {
        try {
          const res = await listSandboxDir(path, userId);
          return res;
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    sandbox_publish_artifact: tool({
      description: 'Uploads any media file (MP4 video, PNG, JPG, WebP image) from the sandbox to Cloudflare R2 and renders a playable video player or image preview card in chat.',
      inputSchema: z.object({
        filePath: z.string().describe('Sandbox file path to publish (e.g. "output/video.mp4", "banner.png")'),
        title: z.string().default('Output Artifact').describe('Title of the media artifact'),
      }),
      execute: async ({ filePath, title }) => {
        try {
          const url = await uploadSandboxArtifactToR2(filePath, userId);
          const isVideo = filePath.endsWith('.mp4') || filePath.endsWith('.webm');
          const isImage = Boolean(filePath.match(/\.(png|jpg|jpeg|webp|svg)$/i));

          const artifact = isVideo
            ? {
                type: 'video_player',
                title,
                videoUrl: url,
                duration: 'Rendered Output',
              }
            : isImage
            ? {
                type: 'image_preview',
                title,
                imageUrl: url,
              }
            : null;

          return {
            success: true,
            filePath,
            url,
            artifact,
            message: `Successfully uploaded ${filePath} to Cloudflare R2 and rendered in chat.`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}

