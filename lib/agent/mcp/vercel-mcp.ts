import { tool } from 'ai';
import { z } from 'zod';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || '';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

/**
 * Official Vercel MCP Suite for Nobogent Super Admin.
 * Gives Nobo DevOps and platform management capabilities.
 */
export function createVercelMcpTools(isSuperAdmin: boolean) {
  if (!isSuperAdmin) return {};

  return {
    vercel_mcp_get_deployments: tool({
      description: 'Vercel MCP (Super Admin): Fetches recent production & preview deployments with status (READY, ERROR, BUILDING), URL, branch, and commit message.',
      inputSchema: z.object({
        limit: z.number().default(5).describe('Number of deployments to retrieve (1-10)'),
      }),
      execute: async ({ limit }) => {
        try {
          const url = `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=${limit}`;
          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${VERCEL_TOKEN}`,
            },
          });

          if (!res.ok) {
            return { success: false, error: `Vercel API error: ${res.status} ${res.statusText}` };
          }

          const data = await res.json();
          const deployments = (data.deployments || []).map((d: any) => ({
            id: d.uid,
            name: d.name,
            url: `https://${d.url}`,
            state: d.state, // READY, ERROR, BUILDING, CANCELED
            target: d.target || 'preview',
            branch: d.meta?.githubCommitRef || 'main',
            commitMessage: d.meta?.githubCommitMessage || 'No commit message',
            createdAt: new Date(d.createdAt).toLocaleString(),
          }));

          return {
            success: true,
            total: deployments.length,
            deployments,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    vercel_mcp_list_env_vars: tool({
      description: 'Vercel MCP (Super Admin): Lists configured environment variable keys for the Nobogent Vercel deployment (values masked for security).',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const url = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`;
          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${VERCEL_TOKEN}`,
            },
          });

          if (!res.ok) {
            return { success: false, error: `Vercel API error: ${res.status} ${res.statusText}` };
          }

          const data = await res.json();
          const envs = (data.envs || []).map((e: any) => ({
            key: e.key,
            type: e.type,
            target: e.target,
            updatedAt: new Date(e.updatedAt).toLocaleDateString(),
          }));

          return {
            success: true,
            totalKeys: envs.length,
            configuredVariables: envs,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
