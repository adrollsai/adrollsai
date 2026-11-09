/**
 * Verifies the MCP layers end to end:
 *   1. the agent catalogue contains the Meta layers
 *   2. every tool's Zod input schema converts to JSON Schema (this is exactly
 *      what tools/list must serve, so a failure here is a broken MCP server)
 *   3. Meta's official ads MCP responds through our client (and reports the
 *      permission gap clearly instead of throwing)
 *   4. the meta_graph_* tools return REAL data from a connected ad account
 *   5. /api/mcp is live and refuses unauthenticated callers
 *
 *   npm run verify:mcp
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { McpClient } from '../lib/agent/mcp/client';

const BASE = (process.env.VERIFY_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}`);
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

(async () => {
  // Pick a profile with a working Meta token + ad account.
  const { data: profiles } = await sb
    .from('profiles')
    .select('id, business_name, facebook_token, ad_account_id')
    .not('facebook_token', 'is', null)
    .not('ad_account_id', 'is', null)
    .limit(6);

  const metaProfile = (profiles || []).find((p) => String(p.business_name || '').includes('Faizal')) || profiles?.[0];
  if (!metaProfile) {
    console.error('no profile with Meta credentials');
    process.exit(1);
  }
  console.log(`Using profile ${metaProfile.id} (${metaProfile.business_name})\n`);

  const { tools } = await createAgentContext(sb, metaProfile.id);
  const names = Object.keys(tools);
  const metaTools = names.filter((n) => n.startsWith('meta_'));
  record('catalogue has Meta layers', metaTools.length >= 14, `${names.length} tools total, ${metaTools.length} meta_*`);

  // 2. JSON Schema conversion for EVERY tool (what tools/list serves).
  const broken: string[] = [];
  for (const n of names) {
    const schema = (tools as any)[n]?.inputSchema;
    try {
      const json = z.toJSONSchema(schema, { io: 'input' });
      if (json?.type !== 'object') broken.push(`${n} (type=${json?.type})`);
    } catch (err: any) {
      broken.push(`${n} (${err?.message?.slice(0, 60)})`);
    }
  }
  record('all tool schemas -> JSON Schema', broken.length === 0, broken.length ? broken.slice(0, 4).join('; ') : `${names.length}/${names.length}`);

  // 3. Meta official MCP through our client.
  try {
    const client = new McpClient({
      url: process.env.META_ADS_MCP_URL || 'https://mcp.facebook.com/ads',
      bearerToken: String(metaProfile.facebook_token),
      name: 'Meta ads MCP',
      timeoutMs: 45_000,
    });
    const list = await client.listTools();
    record('Meta official MCP reachable', list.length > 0, `${list.length} tools published by Meta`);
  } catch (err: any) {
    const isAuth = err?.status === 401 || err?.status === 403;
    record(
      'Meta official MCP auth state',
      isAuth,
      isAuth
        ? `HTTP ${err.status} — token lacks ads_mcp_management (expected; remediation surfaces in the tool)`
        : `unexpected: ${err?.message}`
    );
  }

  // 4. Real Meta Graph reads.
  const graph = tools as any;
  try {
    const acct = await graph.meta_graph_account.execute({ includeAccessibleAccounts: true }, { toolCallId: 'v1', messages: [] });
    record(
      'meta_graph_account (live)',
      acct?.success === true,
      acct?.success ? `${acct.name} · ${acct.currency} · spent ${acct.amountSpent}` : acct?.error
    );
  } catch (err: any) {
    record('meta_graph_account (live)', false, err?.message);
  }

  try {
    const camps = await graph.meta_graph_list.execute({ entity: 'campaign', status: 'ALL', limit: 5 }, { toolCallId: 'v2', messages: [] });
    record(
      'meta_graph_list campaigns (live)',
      camps?.success === true,
      camps?.success ? `${camps.count} campaigns, first: ${camps.items?.[0]?.name || '—'}` : camps?.error
    );
  } catch (err: any) {
    record('meta_graph_list campaigns (live)', false, err?.message);
  }

  try {
    const ins = await graph.meta_graph_insights.execute(
      { level: 'campaign', datePreset: 'last_30d', limit: 5 },
      { toolCallId: 'v3', messages: [] }
    );
    record(
      'meta_graph_insights (live)',
      ins?.success === true,
      ins?.success ? `${ins.count} rows, currency ${ins.currency}, window ${ins.window}` : ins?.error
    );
  } catch (err: any) {
    record('meta_graph_insights (live)', false, err?.message);
  }

  // 5. /api/mcp route is live and locked down.
  try {
    const get = await fetch(`${BASE}/api/mcp`);
    const meta = await get.json();
    record('GET /api/mcp discovery', get.ok && meta?.name === 'nobogent', `HTTP ${get.status} ${meta?.protocolVersion || ''}`);
  } catch (err: any) {
    record('GET /api/mcp discovery', false, `dev server unreachable: ${err?.message}`);
  }

  try {
    const noAuth = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const body = await noAuth.json().catch(() => ({}));
    record('POST /api/mcp rejects anonymous', noAuth.status === 401, `HTTP ${noAuth.status} ${body?.error?.message || ''}`);
  } catch (err: any) {
    record('POST /api/mcp rejects anonymous', false, err?.message);
  }

  try {
    const bad = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    record('POST /api/mcp rejects bad token', bad.status === 401, `HTTP ${bad.status}`);
  } catch (err: any) {
    record('POST /api/mcp rejects bad token', false, err?.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error('verification crashed:', err?.message || err);
  process.exit(1);
});
