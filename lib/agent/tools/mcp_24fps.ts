import { tool } from 'ai';
import { z } from 'zod';

const MCP_24FPS_URL = 'https://24fps.dev/mcp';

async function call24fpsMcp(method: string, params: any) {
  const res = await fetch(MCP_24FPS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });

  const raw = await res.text();
  const match = raw.match(/data:\s*({[\s\S]+})/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      return parsed.result;
    } catch (e) {}
  }
  return { raw };
}

export function create24fpsMotionTools() {
  return {
    search_24fps_motion_graphics: tool({
      description: 'Searches 24fps.dev motion graphics library (7,000+ clips) for pre-built code animations in HyperFrames, Remotion, GSAP, Three.js, Canvas, and WebGL: kinetic typography, festive cards, logo reveals, product explainers, and 9:16 vertical clips. Call this BEFORE writing motion graphics from scratch.',
      inputSchema: z.object({
        query: z.string().describe('Search query, e.g. "gold luxury particles", "kinetic typography celebration", "logo reveal"'),
        framework: z.enum(['hyperframes', 'remotion', 'gsap', 'threejs', 'canvas', 'all']).default('all'),
        aspect: z.enum(['9:16', '16:9', '1:1', 'all']).default('all'),
      }),
      execute: async ({ query, framework, aspect }) => {
        try {
          const args: any = { query };
          if (framework !== 'all') args.framework = framework;
          if (aspect !== 'all') args.aspect = aspect;

          const res = await call24fpsMcp('tools/call', {
            name: 'search_clips',
            arguments: args,
          });

          const text = res?.content?.[0]?.text;
          const parsed = text ? JSON.parse(text) : res;
          return {
            success: true,
            total: parsed?.total || 0,
            clips: (parsed?.results || []).slice(0, 5),
            browseUrl: parsed?.browse,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    get_24fps_clip_source: tool({
      description: 'Fetches the full prompt or source code repository for a 24fps motion graphics clip to use as the blueprint for video generation.',
      inputSchema: z.object({
        slug: z.string().describe('The clip slug from search_24fps_motion_graphics (e.g. "glass-and-gold-leaf-mosaic-00526")'),
      }),
      execute: async ({ slug }) => {
        try {
          const [clipRes, sourceRes] = await Promise.all([
            call24fpsMcp('tools/call', { name: 'get_clip', arguments: { slug } }),
            call24fpsMcp('tools/call', { name: 'get_source', arguments: { slug } }),
          ]);

          const clipText = clipRes?.content?.[0]?.text;
          const sourceText = sourceRes?.content?.[0]?.text;

          return {
            success: true,
            clip: clipText ? JSON.parse(clipText) : clipRes,
            source: sourceText ? JSON.parse(sourceText) : sourceRes,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    search_24fps_editor_presets: tool({
      description: 'Searches 24fps video editor presets: kinetic text scenes, caption styles, hooks, transitions, layouts, and typography animations ready to mount into HyperFrames HTML.',
      inputSchema: z.object({
        query: z.string().describe('Search query, e.g. "kinetic text scene", "bold gold title", "countdown"'),
        kind: z.enum(['caption', 'text-scene', 'hook', 'transition', 'layout', 'all']).default('all'),
      }),
      execute: async ({ query, kind }) => {
        try {
          const args: any = { query };
          if (kind !== 'all') args.kind = kind;

          const res = await call24fpsMcp('tools/call', {
            name: 'search_editor_assets',
            arguments: args,
          });

          const text = res?.content?.[0]?.text;
          const parsed = text ? JSON.parse(text) : res;
          return {
            success: true,
            total: parsed?.total || 0,
            presets: (parsed?.results || []).slice(0, 6),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    get_24fps_editor_preset: tool({
      description: 'Gets the exact JSON and animation parameters of a 24fps video editor preset to inject into HyperFrames.',
      inputSchema: z.object({
        kind: z.string().describe('Asset kind (e.g. "text-scene", "caption", "layout")'),
        id: z.string().describe('Asset ID (e.g. "thirds-left-text-right")'),
      }),
      execute: async ({ kind, id }) => {
        try {
          const res = await call24fpsMcp('tools/call', {
            name: 'get_editor_asset',
            arguments: { kind, id },
          });

          const text = res?.content?.[0]?.text;
          return {
            success: true,
            preset: text ? JSON.parse(text) : res,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}

