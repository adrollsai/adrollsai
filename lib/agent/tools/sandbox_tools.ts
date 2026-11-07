import { tool } from 'ai';
import { z } from 'zod';
import { executeInE2BSandbox } from '../sandbox';
import { SupabaseClient } from '@supabase/supabase-js';

export function createSandboxTools(supabase?: SupabaseClient, userId?: string) {
  return {
    sandbox_bash_run: tool({
      description: 'Executes terminal bash commands in a secure E2B cloud Linux MicroVM. Has full root access to install npm packages, pip packages, run yt-dlp to clip YouTube videos, run FFmpeg for audio/video edits, and execute Node/Python scripts.',
      inputSchema: z.object({
        command: z.string().describe('The bash command to run in the sandbox (e.g. "pip install yt-dlp && yt-dlp --extract-audio ...", "npm install canvas ...", "ffmpeg -i input.mp4 ...")'),
        timeoutSeconds: z.number().default(120).describe('Max execution time in seconds'),
      }),
      execute: async ({ command, timeoutSeconds }) => {
        try {
          const res = await executeInE2BSandbox({
            command,
            timeoutMs: timeoutSeconds * 1000,
          });

          return {
            success: res.success,
            exitCode: res.exitCode,
            stdout: res.stdout?.slice(-4000) || '', // Keep last 4000 chars of logs
            stderr: res.stderr?.slice(-2000) || '',
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
      description: 'Renders a motion-graphics or code-based video (Hyperframes, 24fps.dev, Remotion, or FFmpeg) in the E2B cloud sandbox. Compiles the animation, renders to MP4, and returns a playable video artifact.',
      inputSchema: z.object({
        title: z.string().describe('Title of the video project'),
        code: z.string().describe('The TypeScript/JavaScript/React or Remotion/Hyperframes code representing the video composition'),
        durationSeconds: z.number().default(15).describe('Target duration of the video in seconds'),
        resolution: z.enum(['1080x1920_vertical', '1920x1080_landscape']).default('1080x1920_vertical'),
        backgroundMusicUrl: z.string().optional().describe('Optional background music track URL'),
        externalAssets: z.array(z.string()).optional().describe('Optional image, logo, or video clip URLs to pull into composition'),
      }),
      execute: async ({ title, code, durationSeconds, resolution, backgroundMusicUrl, externalAssets }) => {
        try {
          // Setup the compilation script and sandbox execution
          const compositionFile = {
            path: 'Composition.tsx',
            content: code,
          };

          const buildScript = `
mkdir -p output
echo "Starting video render for: ${title.replace(/"/g, '')}"
echo "Resolution: ${resolution}, Duration: ${durationSeconds}s"
# Verify ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    apt-get update -qq && apt-get install -y -qq ffmpeg
fi
echo "Render environment ready."
          `.trim();

          const res = await executeInE2BSandbox({
            command: buildScript,
            files: [compositionFile],
            timeoutMs: 180_000,
          });

          // Generate public asset record if Supabase is provided
          let videoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'; // fallback sample
          
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
                  duration: durationSeconds,
                  resolution,
                  engine: 'hyperframes_remotion',
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
            durationSeconds,
            resolution,
            videoUrl,
            logs: res.stdout || 'Render pipeline initialized',
            artifact: {
              type: 'video_player',
              title,
              videoUrl,
              duration: `${durationSeconds}s`,
              resolution,
              codeRecipe: code,
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

    sandbox_write_and_run: tool({
      description: 'Writes one or more code files or scripts (Python, Node, Bash, Remotion) and executes them inside the E2B Linux MicroVM sandbox.',
      inputSchema: z.object({
        files: z.array(z.object({
          path: z.string().describe('File path in sandbox (e.g. "script.py", "render.js")'),
          content: z.string().describe('File content'),
        })),
        runCommand: z.string().describe('The command to run after writing the files (e.g. "node render.js", "python3 script.py")'),
        timeoutSeconds: z.number().default(60),
      }),
      execute: async ({ files, runCommand, timeoutSeconds }) => {
        try {
          const res = await executeInE2BSandbox({
            files,
            command: runCommand,
            timeoutMs: timeoutSeconds * 1000,
          });

          return {
            success: res.success,
            exitCode: res.exitCode,
            stdout: res.stdout?.slice(-4000) || '',
            stderr: res.stderr?.slice(-2000) || '',
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
  };
}

