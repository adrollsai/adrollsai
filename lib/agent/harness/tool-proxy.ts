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
  /**
   * THE READ PRIMITIVE, INLINE.
   *
   * It is the answer to every "how many / which / how often" question, and it was behind
   * `find_tools` → `call_tool`. Measured on the owner's own account: asked "how many leads do I
   * have right now?", the agent's first step was `find_tools` — a whole extra model round trip
   * (~2s here, ~6s in the region we were running in) spent discovering a tool the system prompt
   * already named. One schema (~2k chars) in every request is a much better trade than a step.
   */
  'query_account_data',
];

/** How much of each description find_tools returns — enough to choose, not enough to bloat. */
const SUMMARY_CHARS = 180;

/**
 * After this many fruitless searches, stop searching and say so.
 *
 * A tool surface this large makes "look again" feel productive. In production an
 * owner asked for a call recording and the agent made ~100 lookups over seven and
 * a half minutes — twenty of them guesses at table names through the raw SQL
 * inspector, plus `env | grep` for credentials — before being cancelled without
 * ever answering. The capability genuinely did not exist. Saying so IS the answer;
 * hunting is a way of not saying it.
 */
const SEARCH_MISS_LIMIT = 3;

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

  // Counted across the life of this discovery surface, i.e. one turn/slice.
  let misses = 0;

  /** The answer when searching has stopped being research and become thrashing. */
  const giveUpNotice = (query: string, count: number) => ({
    found: 0,
    stop: true,
    note:
      `STOP SEARCHING. ${count} searches have found nothing for this. The capability you are looking for ` +
      `is not available in this account (last query: "${query}").`,
    next:
      'Do not search again and do not go looking for it in the database, the sandbox or environment ' +
      'variables. Answer the owner now: say what you CAN provide from the tools you already used, and ' +
      'name precisely what you cannot, so they can decide whether to have it built.',
    // A reminder of the families that do exist, so a real capability is not missed.
    available_families: names
      .filter((n) => !n.startsWith('sandbox_'))
      .slice(0, 24),
  });

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
        // A search that finds nothing is the moment the model starts guessing — at
        // table names, at env vars, at anything. Count them, and after a few, stop
        // being a search engine and say the capability is not there.
        misses += 1;
        if (misses >= SEARCH_MISS_LIMIT) return giveUpNotice(query, misses);
        return {
          found: 0,
          note: `nothing matched "${query}". Try a broader phrase like "video", "leads", "page" or "automation".`,
          available: names.slice(0, 40),
          ...(misses >= 2
            ? {
                warning:
                  `That is ${misses} searches with no match. If the next one also finds nothing, this ` +
                  'capability does not exist here — say so and answer with what you do have.',
              }
            : {}),
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
        // A guessed name is the same failure as a fruitless search: the model is
        // feeling around for a capability. Count it, and eventually refuse to keep
        // guessing.
        misses += 1;
        if (misses >= SEARCH_MISS_LIMIT) return { tool: name, ok: false, ...giveUpNotice(name, misses) };
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

      // VALIDATE AND APPLY DEFAULTS, like every inline tool gets for free.
      //
      // This called `target.execute(args)` directly, so the tool's own zod schema
      // never ran: declared defaults were lost and bad arguments were passed
      // through. The cost was real — `call_queue_status` without its `limit` fell
      // back to PostgREST's 1000-row ceiling and reported a truncated queue (848 of
      // 1532 leads) as if it were the whole book, and `onlyWithSummary` was skipped
      // entirely on `lead_conversations`.
      let parsedArgs: any = args;
      const schema: any = (target as any)?.inputSchema;
      if (schema && typeof schema.safeParse === 'function') {
        const parsed = schema.safeParse(args ?? {});
        if (!parsed.success) {
          const issues = (parsed.error?.issues ?? [])
            .slice(0, 6)
            .map((issue: any) => `${(issue.path ?? []).join('.') || '(root)'}: ${issue.message}`);
          return {
            tool: name,
            ok: false,
            error: `arguments did not match "${name}"'s schema`,
            problems: issues,
            parameters: schemaOf(target),
            hint: 'Send the arguments again matching the schema exactly.',
          };
        }
        parsedArgs = parsed.data;
      } else if (schema && typeof schema.parse === 'function') {
        try {
          parsedArgs = schema.parse(args ?? {});
        } catch (err: any) {
          return {
            tool: name,
            ok: false,
            error: `arguments did not match "${name}"'s schema`,
            problems: [String(err?.message ?? err).slice(0, 300)],
            parameters: schemaOf(target),
          };
        }
      }

      try {
        const result = await target.execute(parsedArgs, options);
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
