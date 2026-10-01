import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase MCP Diagnostic Suite for Nobogent Super Admin.
 * Strictly restricted to Super Admin role.
 */
export function createSupabaseMcpTools(supabase: SupabaseClient, isSuperAdmin: boolean) {
  if (!isSuperAdmin) return {};

  return {
    supabase_mcp_database_health: tool({
      description: 'Supabase MCP (Super Admin): Checks database health, table row counts, and system status across core database entities.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const tables = ['leads', 'profiles', 'properties', 'assets', 'call_logs', 'whatsapp_chats', 'notifications'];
          const counts: Record<string, number | null> = {};

          await Promise.all(
            tables.map(async (tbl) => {
              const { count, error } = await supabase.from(tbl).select('*', { count: 'exact', head: true });
              counts[tbl] = error ? null : count;
            })
          );

          return {
            success: true,
            status: 'operational',
            url: process.env.NEXT_PUBLIC_SUPABASE_URL,
            tableCounts: counts,
            timestamp: new Date().toISOString(),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    supabase_mcp_inspect_table: tool({
      description: 'Supabase MCP (Super Admin): Inspects sample rows and column structure for any table in the database.',
      inputSchema: z.object({
        tableName: z.string().describe('The name of the table to inspect (e.g. leads, call_logs, profiles, assets)'),
        limit: z.number().default(5).describe('Number of sample rows to retrieve (1-10)'),
      }),
      execute: async ({ tableName, limit }) => {
        try {
          const { data, error, count } = await supabase
            .from(tableName)
            .select('*', { count: 'exact' })
            .limit(limit);

          if (error) throw error;

          const columns = data && data.length > 0 ? Object.keys(data[0]) : [];

          return {
            success: true,
            tableName,
            totalRows: count,
            columns,
            sampleRows: data,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
