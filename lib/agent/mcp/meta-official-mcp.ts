import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { McpClient, isMetaMcpAuthError } from './client';

/**
 * Meta's OFFICIAL ads MCP server (https://mcp.facebook.com/ads).
 *
 * It is Meta-hosted and remote, so nothing here reimplements ads logic: we list
 * the tools Meta publishes and dispatch calls to them with the user's own token.
 * That keeps the agent aligned with Meta's own capabilities instead of a
 * hand-rolled subset that drifts.
 *
 * Auth: `Authorization: Bearer <user access token>`, and the token must carry
 * the `ads_mcp_management` permission. Existing app tokens (granted for
 * `ads_management`) are rejected with HTTP 401 "restricted to certain users",
 * which is why the error path below returns the exact remediation instead of a
 * bare failure — otherwise this looks like a bug in our code.
 */
const META_MCP_URL = (process.env.META_ADS_MCP_URL || 'https://mcp.facebook.com/ads').trim();

const REMEDIATION = [
  'Meta rejected the connection because the access token lacks the `ads_mcp_management` permission.',
  'To enable the official Meta ads MCP server:',
  '1. In developers.facebook.com/apps, add the use case "Create & manage ads with ads MCP server" to the Meta app.',
  '2. Re-authorise the user requesting `ads_mcp_management` plus `ads_management` (and `pages_show_list`, `business_management`, `catalog_management`, `instagram_basic` for the wider tool set).',
  '3. Reconnect Meta in Nobogent settings so the new token is stored.',
  'For server-to-server use, an Employee-role system user access token also works.',
  'Until then, use the meta_* Graph tools, which work with the existing `ads_management` grant.',
].join('\n');

export function createMetaOfficialMcpTools(supabase: SupabaseClient, userId: string) {
  async function getToken(): Promise<string> {
    const { data, error } = await supabase
      .from('profiles')
      .select('facebook_token')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.facebook_token) {
      throw new Error(
        'Meta account is not connected. Connect Facebook/Meta in Nobogent settings first.'
      );
    }
    return String(data.facebook_token).replace(/^["']|["']$/g, '').trim();
  }

  const client = async () => new McpClient({ url: META_MCP_URL, bearerToken: await getToken(), name: 'Meta ads MCP', timeoutMs: 90_000 });

  return {
    meta_official_list_tools: tool({
      description:
        'Lists the tools published by Meta\'s OFFICIAL remote ads MCP server (mcp.facebook.com/ads), with their input schemas. Call this before meta_official_call_tool so you know exactly what Meta supports — reporting, ad creation and management, catalog, signals, A/B tests, activity logs and troubleshooting.',
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe('Optional case-insensitive filter over tool names and descriptions, e.g. "insight", "campaign", "catalog"'),
      }),
      execute: async ({ search }) => {
        try {
          const tools = await (await client()).listTools();
          const needle = (search || '').toLowerCase();
          const filtered = needle
            ? tools.filter(
                (t) =>
                  t.name.toLowerCase().includes(needle) ||
                  (t.description || '').toLowerCase().includes(needle)
              )
            : tools;
          return {
            success: true,
            server: META_MCP_URL,
            total: tools.length,
            showing: filtered.length,
            tools: filtered.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          };
        } catch (err: any) {
          if (isMetaMcpAuthError(err)) {
            return {
              success: false,
              error: err.message,
              httpStatus: err.status,
              serverResponded: err.body,
              requires: 'ads_mcp_management permission',
              remediation: REMEDIATION,
              fallback: 'Use meta_graph_* / meta_* tools, which work with the current token.',
            };
          }
          return { success: false, error: err?.message || 'Could not list Meta MCP tools' };
        }
      },
    }),

    meta_official_call_tool: tool({
      description:
        'Calls a tool on Meta\'s OFFICIAL remote ads MCP server. Pass the exact tool name from meta_official_list_tools and its arguments matching that tool\'s input schema. This is the preferred way to manage ads, reporting, catalogs, A/B tests and signal diagnostics because it runs against Meta\'s own implementation.',
      inputSchema: z.object({
        toolName: z.string().describe('Exact Meta MCP tool name from meta_official_list_tools'),
        arguments: z
          .record(z.string(), z.any())
          .default({})
          .describe('Arguments object matching that tool\'s input schema'),
      }),
      execute: async ({ toolName, arguments: args }) => {
        try {
          const result = await (await client()).callTool(toolName, args || {});
          return {
            success: !result?.isError,
            toolName,
            server: META_MCP_URL,
            data: result?.structuredContent ?? undefined,
            text: result?.text,
            raw: result?.isError ? result : undefined,
          };
        } catch (err: any) {
          if (isMetaMcpAuthError(err)) {
            return {
              success: false,
              error: err.message,
              httpStatus: err.status,
              serverResponded: err.body,
              requires: 'ads_mcp_management permission',
              remediation: REMEDIATION,
              fallback: 'Use meta_graph_* / meta_* tools, which work with the current token.',
            };
          }
          return { success: false, toolName, error: err?.message || 'Meta MCP call failed' };
        }
      },
    }),
  };
}
