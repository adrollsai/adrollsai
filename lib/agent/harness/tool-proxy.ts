/**
 * Discovery-based tool exposure.
 *
 * The problem this solves: every tool schema in the registry was sent with every model request.
 * Measured, that was 67,000 characters across 58 tools — roughly 17,000 tokens of preamble before
 * the person's first word, on a request as small as "hi". It cost money on every turn, added latency
 * to every reply, and pushed long conversations over the model window so they were rejected outright.
 *
 * Converting tools to MCP does not help: an MCP tool's schema is still sent with each request. What
 * helps is not sending schemas at all until they are needed.
 *
 * So the model is offered a small set of hot tools inline, plus two:
 *   find_tools(query)  -> names, one-line descriptions and full parameter schemas for matching tools
 *   call_tool(name, args) -> run any tool in the registry by name
 *
 * The full registry stays loaded server-side, so nothing is lost: every capability is reachable, and
 * the model finds it by asking rather than by carrying it.
 */

import { jsonSchema } from 'ai';

export interface ToolDef {
  description?: string;
  inputSchema?: unknown;
  parameters?: unknown;
  execute?: (input: any, options?: any) => any;
  [key: string]: any;
}

/** Tools worth shipping inline: the ones nearly every task touches. */
export const HOT_TOOLS: readonly string[] = [
  'sandbox_bash_run',
  'sandbox_read_file',
  'sandbox_write_file',
  'sandbox_write_and_run',
  'get_skill',
  'pick_skill',
  'list_reference_bank',
  'use_reference',
  'generate_ai_image',
  'request_user_input',
  'request_human_approval',
  'deliverArtefact',
];

/** How much of each description find_tools returns — enough to choose, not enough to bloat. */
const SUMMARY_CHARS = 180;

function schemaOf(tool: ToolDef): unknown {
  return (tool as any)?.inputSchema ?? (tool as any)?.parameters ?? null;
}

export interface DiscoveryOptions {
  /** Override the inline set. Names not present in the registry are ignored. */
  hot?: readonly string[];
}

export interface DiscoveryResult {
  tools: Record<string, any>;
  /** What the model was actually offered, for the gate and for logs. */
  exposed: string[];
  /** How many tools it can still reach through discovery. */
  discoverable: number;
  inlineSchemaChars: number;
  fullSchemaChars: number;
}

/**
 * Build the model-facing tool set: hot tools inline, everything else behind find/call.
 * Schemas are counted before and after so the saving is measurable rather than asserted.
 */
export function buildDiscoverableTools(
  registry: Record<string, ToolDef>,
  opts: DiscoveryOptions = {}
): DiscoveryResult {
  const hotNames = (opts.hot ?? HOT_TOOLS).filter((n) => !!registry[n]);
  const fullSchemaChars = Object.keys(registry).reduce((n, k) => n + JSON.stringify(registry[k]).length, 0);

  const inline: Record<string, any> = {};
  for (const name of hotNames) inline[name] = registry[name];

  const names = Object.keys(registry);

  inline.find_tools = {
    description:
      'Find tools by describing what you want to do, e.g. "create an automation", "render a video", ' +
      '"query leads", "publish a page". Returns each match with the exact parameter schema. Call this ' +
      'before call_tool whenever you need a capability that is not already available.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to do, in plain words' },
        limit: { type: 'number', description: 'How many matches to return (default 6)' },
      },
      required: ['query'],
    }),
    execute: async (input: any) => {
      const query = String(input?.query ?? '').toLowerCase().trim();
      const limit = Math.min(12, Math.max(1, Number(input?.limit) || 6));
      const words = query.split(/[^a-z0-9_]+/).filter((w) => w.length > 2);

      const scored = names
        .map((name) => {
          const def = registry[name];
          const haystack = `${name} ${String(def?.description ?? '')}`.toLowerCase();
          let score = 0;
          if (query && name.toLowerCase().includes(query)) score += 10;
          for (const w of words) if (haystack.includes(w)) score += 2;
          return { name, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (!scored.length) {
        return {
          found: 0,
          note: `nothing matched "${query}". Try a broader phrase like "video", "leads", "page" or "automation".`,
          available: names.slice(0, 40),
        };
      }

      return {
        found: scored.length,
        tools: scored.map((s) => {
          const def = registry[s.name];
          return {
            name: s.name,
            description: String(def?.description ?? '').slice(0, SUMMARY_CHARS),
            parameters: schemaOf(def),
          };
        }),
        next: 'call_tool with one of these names and arguments matching its parameters.',
      };
    },
  };

  inline.call_tool = {
    description:
      'Run any tool by name, using the parameters returned by find_tools. Arguments must match the ' +
      'schema exactly. Use this for everything not already offered directly.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact tool name from find_tools' },
        arguments: { type: 'object', description: 'Arguments matching that tool\'s parameter schema' },
      },
      required: ['name'],
    }),
    execute: async (input: any, options?: any) => {
      const name = String(input?.name ?? '').trim();
      const args = (input?.arguments ?? {}) as Record<string, unknown>;
      const target = registry[name];
      if (!target) {
        return {
          error: `no tool named "${name}"`,
          hint: 'call find_tools first to get an exact name',
          sample: names.slice(0, 25),
        };
      }
      if (typeof target.execute !== 'function') {
        if (name === 'find_tools' || name === 'call_tool') {
          return { error: 'cannot call the discovery tools through call_tool' };
        }
        return { error: `"${name}" is not executable in this context` };
      }
      try {
        const result = await target.execute(args, options);
        return { tool: name, ok: true, result };
      } catch (err: any) {
        return { tool: name, ok: false, error: String(err?.message ?? err) };
      }
    },
  };

  const inlineSchemaChars = Object.keys(inline).reduce((n, k) => n + JSON.stringify(inline[k]).length, 0);

  return {
    tools: inline,
    exposed: Object.keys(inline),
    discoverable: names.length - hotNames.length,
    inlineSchemaChars,
    fullSchemaChars,
  };
}

/** The paragraph that tells the model how the surface works. */
export function discoveryPromptSection(): string {
  return [
    'HOW YOUR TOOLS WORK',
    'You are given a few tools directly. The rest are reachable through two:',
    '- find_tools: describe what you want to do ("create an automation", "render a video", "publish a page")',
    '  and it returns the exact names and parameter schemas.',
    '- call_tool: run one of those names with matching arguments.',
    'Prefer the tools you already have. When a task needs something else, call find_tools first rather',
    'than saying you cannot do it — the capability almost certainly exists.',
  ].join('\n');
}
