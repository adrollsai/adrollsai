import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertCircle,
  BarChart2,
  BrainCircuit,
  CalendarClock,
  Code2,
  Database,
  FileEdit,
  FileSpreadsheet,
  Film,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquare,
  PhoneCall,
  Rocket,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';

/**
 * Keyed per-tool presentation.
 *
 * Mirrors the DeepSeek Harness model (`@deepseek-ai/dsh-client-ui-tool` exposes
 * a "keyed per-tool presentation slot"): a tool's identity is data — label,
 * icon and an argument summary — not a chain of `if (name.includes(...))`
 * branches inside the renderer.
 *
 * Adding a tool means adding one row here. The renderer never changes.
 */

export type ToolKind =
  | 'shell'
  | 'read'
  | 'edit'
  | 'search'
  | 'render'
  | 'image'
  | 'crm'
  | 'whatsapp'
  | 'voice'
  | 'ads'
  | 'web'
  | 'delegate'
  | 'approval'
  | 'schedule'
  | 'file'
  | 'data'
  | 'infra'
  | 'generic';

export interface ToolPresentation {
  /** Imperative verb shown in the feed row, e.g. "Shell", "Render video". */
  label: string;
  kind: ToolKind;
  icon: LucideIcon;
  /** One-line summary of the arguments. Must never throw. */
  summarize: (input: unknown) => string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const firstOf = (input: unknown, keys: string[]): string => {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
};

const clip = (s: string, n = 90): string => {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
};

const pathSummary = (input: unknown) => clip(firstOf(input, ['path', 'filePath', 'file', 'dir', 'target']));
const titleSummary = (input: unknown) => clip(firstOf(input, ['title', 'prompt', 'query', 'name', 'task']));
const commandSummary = (input: unknown) => clip(firstOf(input, ['command', 'runCommand', 'cmd']), 110);

/** Argument summary keyed by kind — the fallback when a tool has no bespoke one. */
const byKind: Record<ToolKind, (input: unknown) => string> = {
  shell: commandSummary,
  read: pathSummary,
  edit: pathSummary,
  file: pathSummary,
  search: titleSummary,
  render: titleSummary,
  image: titleSummary,
  crm: (i) => clip(firstOf(i, ['name', 'phone', 'query', 'stage', 'leadId'])),
  whatsapp: (i) => clip(firstOf(i, ['templateName', 'name', 'to', 'phone'])),
  voice: (i) => clip(firstOf(i, ['phone', 'campaignName', 'name'])),
  ads: (i) => clip(firstOf(i, ['campaignName', 'name', 'campaignId'])),
  web: titleSummary,
  delegate: titleSummary,
  approval: titleSummary,
  schedule: (i) => clip(firstOf(i, ['taskTitle', 'title', 'cron', 'schedule'])),
  data: titleSummary,
  infra: titleSummary,
  generic: (i) => clip(firstOf(i, ['title', 'name', 'prompt', 'query', 'path'])),
};

/** `row()` always resolves `summarize`, so a Row is a complete presentation. */
type Row = ToolPresentation;

const row = (label: string, kind: ToolKind, icon: LucideIcon, summarize?: (input: unknown) => string): Row => ({
  label,
  kind,
  icon,
  summarize: summarize || byKind[kind],
});

/** Exact tool-name → presentation. Every tool the agent can call belongs here. */
export const TOOL_PRESENTATION: Record<string, Row> = {
  // ── E2B sandbox ──────────────────────────────────────────────────────
  sandbox_bash_run: row('Shell', 'shell', Terminal),
  sandbox_write_file: row('Write file', 'edit', FileEdit),
  sandbox_read_file: row('Read file', 'read', FileEdit),
  sandbox_list_files: row('List files', 'file', FolderOpen),
  sandbox_write_and_run: row('Run script', 'shell', Terminal),
  sandbox_publish_artifact: row('Publish artifact', 'file', Layers),
  sandbox_render_video: row('Render video', 'render', Film),
  sandbox_render_hyperframes: row('Render HyperFrames', 'render', Film),

  // ── files & data ─────────────────────────────────────────────────────
  list_user_files: row('List files', 'file', FolderOpen),
  delete_user_file: row('Delete file', 'file', Trash2),
  organize_or_move_file: row('Move file', 'file', FolderOpen),
  parse_csv_or_excel: row('Parse spreadsheet', 'data', FileSpreadsheet),
  execute_data_code: row('Run data code', 'data', Code2),
  get_user_media_assets: row('List media', 'file', ImageIcon),

  // ── web & research ───────────────────────────────────────────────────
  deepseek_web_search: row('Web search', 'web', Search),
  deepseek_web_fetch: row('Fetch page', 'web', Globe),
  mcp_fetch_web_content: row('Fetch page', 'web', Globe),

  // ── creatives ────────────────────────────────────────────────────────
  generate_ai_image: row('Generate image', 'image', ImageIcon),
  generate_ai_video_clip: row('Generate video clip', 'render', Film),
  generate_video_script_and_angle: row('Write video script', 'render', FileEdit),
  search_24fps_motion_graphics: row('Search motion library', 'search', Film),
  search_24fps_editor_presets: row('Search presets', 'search', Film),
  get_24fps_clip_source: row('Get clip source', 'render', Film),
  get_24fps_editor_preset: row('Get preset', 'render', Film),

  // ── Nobogent app MCP ─────────────────────────────────────────────────
  nobogent_brand_get_profile: row('Read brand profile', 'crm', BrainCircuit),
  nobogent_crm_query_leads: row('Query leads', 'crm', Users),
  nobogent_crm_create_lead: row('Create lead', 'crm', Users),
  nobogent_inventory_search: row('Search inventory', 'search', Search),
  nobogent_assets_list: row('List assets', 'file', FolderOpen),
  nobogent_whatsapp_list_templates: row('List WA templates', 'whatsapp', MessageSquare),
  nobogent_whatsapp_send_template: row('Send WA template', 'whatsapp', MessageSquare),
  nobogent_voice_dispatch_call: row('Dispatch AI call', 'voice', PhoneCall),

  // ── CRM (local tools) ────────────────────────────────────────────────
  query_leads: row('Query leads', 'crm', Users),
  create_lead: row('Create lead', 'crm', Users),
  update_lead_details: row('Update lead', 'crm', Users),
  update_lead_stage: row('Move lead stage', 'crm', Users),
  delete_or_archive_lead: row('Archive lead', 'crm', Trash2),
  get_crm_metrics: row('CRM metrics', 'crm', BarChart2),

  // ── WhatsApp ─────────────────────────────────────────────────────────
  create_whatsapp_template: row('Create WA template', 'whatsapp', MessageSquare),
  send_single_whatsapp_message: row('Send WhatsApp', 'whatsapp', MessageSquare),
  preview_whatsapp_message: row('Preview WhatsApp', 'whatsapp', MessageSquare),
  prepare_whatsapp_broadcast: row('Prepare broadcast', 'whatsapp', Megaphone),

  // ── Voice ────────────────────────────────────────────────────────────
  launch_bulk_calling_campaign: row('Launch call campaign', 'voice', Rocket),
  get_call_history: row('Call history', 'voice', PhoneCall),
  update_default_voice_settings: row('Voice settings', 'voice', PhoneCall),

  // ── Meta ads ─────────────────────────────────────────────────────────
  meta_mcp_list_campaigns: row('List campaigns', 'ads', Megaphone),
  meta_mcp_get_insights: row('Campaign insights', 'ads', BarChart2),
  meta_mcp_create_campaign: row('Create campaign', 'ads', Megaphone),
  meta_mcp_launch_leadgen_campaign: row('Launch lead-gen campaign', 'ads', Rocket),

  // ── scheduling ───────────────────────────────────────────────────────
  schedule_agent_task: row('Schedule task', 'schedule', CalendarClock),
  list_scheduled_tasks: row('List schedules', 'schedule', CalendarClock),
  cancel_or_delete_scheduled_task: row('Cancel schedule', 'schedule', Trash2),

  // ── delegation & human loop ──────────────────────────────────────────
  spawn_dynamic_subagent: row('Spawn sub-agent', 'delegate', Users),
  request_human_approval: row('Needs approval', 'approval', ShieldAlert),
  request_user_input: row('Needs your input', 'approval', AlertCircle),

  // ── infrastructure ───────────────────────────────────────────────────
  vercel_mcp_get_deployments: row('Vercel deployments', 'infra', Activity),
  vercel_mcp_list_env_vars: row('Vercel env vars', 'infra', Activity),
  supabase_mcp_database_health: row('Database health', 'infra', Database),
  supabase_mcp_inspect_table: row('Inspect table', 'infra', Database),
};

/** Prefix → presentation, for tools added later without a registry row. */
const PREFIXES: Array<[string, Row]> = [
  ['sandbox_', row('Sandbox', 'shell', Terminal)],
  ['meta_mcp_', row('Meta Ads', 'ads', Megaphone)],
  ['nobogent_whatsapp', row('WhatsApp', 'whatsapp', MessageSquare)],
  ['nobogent_voice', row('AI calling', 'voice', PhoneCall)],
  ['nobogent_crm', row('CRM', 'crm', Users)],
  ['nobogent_', row('Nobogent', 'crm', BrainCircuit)],
  ['supabase_mcp_', row('Database', 'infra', Database)],
  ['vercel_mcp_', row('Vercel', 'infra', Activity)],
  ['deepseek_web', row('Web', 'web', Globe)],
];

const FALLBACK: Row = row('Tool', 'generic', Wrench, (input) => {
  if (typeof input === 'string') return clip(input);
  return '';
});

/**
 * Resolve the presentation for a tool call. Never throws, never returns
 * undefined — an unknown tool degrades to a generic row instead of blanking
 * the message, which is what the previous `if/else` chain did.
 */
export function resolveToolPresentation(toolName: string): { presentation: ToolPresentation; known: boolean } {
  const name = str(toolName) || 'tool';

  const exact = TOOL_PRESENTATION[name];
  if (exact) return { presentation: exact, known: true };

  for (const [prefix, preset] of PREFIXES) {
    if (name.startsWith(prefix)) return { presentation: preset, known: true };
  }

  // Suffix heuristics cover names that appear only in older transcripts.
  if (name.includes('bash') || name.includes('terminal') || name.includes('pwsh')) {
    return { presentation: row('Shell', 'shell', Terminal), known: true };
  }
  if (name.includes('render') || name.includes('video')) {
    return { presentation: row('Render', 'render', Film), known: true };
  }
  if (name.includes('image')) return { presentation: row('Image', 'image', ImageIcon), known: true };
  if (name.includes('search')) return { presentation: row('Search', 'search', Search), known: true };
  if (name.includes('approval') || name.includes('user_input')) {
    return { presentation: row('Needs input', 'approval', ShieldAlert), known: true };
  }

  // Final fallback keeps the real tool name visible rather than hiding it.
  return { presentation: { ...FALLBACK, label: name.replace(/[_-]+/g, ' ') }, known: false };
}

/** Safe one-line argument summary. */
export function summarizeToolInput(presentation: ToolPresentation, input: unknown): string {
  try {
    return presentation.summarize(input) || '';
  } catch {
    return '';
  }
}
