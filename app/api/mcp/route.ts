import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js';
import { createAgentContext } from '@/lib/agent/orchestrator';
import { ALL_GROUPS } from '@/lib/agent/tool-groups';
import { createClient as createServerClient } from '@/utils/supabase/server';

/**
 * Nobogent MCP server — Model Context Protocol over streamable HTTP.
 *
 * This exposes the ENTIRE agent tool registry (sandbox, CRM, inventory, WhatsApp,
 * voice, media studio, Meta ads, research, scheduler, approvals) as MCP tools.
 * So "a full MCP of Nobogent" is not a second implementation that can drift: it
 * is the same registry the in-app agent uses, published over the wire.
 *
 * Auth: `Authorization: Bearer <supabase access token>` (server-to-server, other
 * AI clients) or the browser session cookie. Every tool call is scoped to the
 * authenticated user. Impersonation is available only to super admins.
 *
 * This endpoint is powerful by design — it can spend ad budget and message real
 * customers — so it always requires authentication and never falls back to an
 * anonymous identity.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'nobogent', version: '1.0.0' };

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type JsonRpcId = string | number | null;

const rpcOk = (id: JsonRpcId, result: any) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id: JsonRpcId, code: number, message: string, data?: any) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data ? { data } : {}) },
});

/** Resolve the acting user from a Bearer token or the session cookie. */
async function resolveIdentity(
  request: Request
): Promise<{ userId: string; operatorUserId?: string } | { error: string; status: number }> {
  const authHeader = request.headers.get('authorization') || '';
  let callerId: string | null = null;

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) return { error: 'Empty bearer token', status: 401 };
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return { error: 'Invalid or expired access token', status: 401 };
    callerId = data.user.id;
  } else {
    const supabase = await createServerClient();
    const { data } = await supabase.auth.getUser();
    callerId = data?.user?.id || null;
  }

  if (!callerId) return { error: 'Authentication required', status: 401 };

  // The whole agent tool catalogue is reachable over HTTP here, including spend,
  // publish and Meta mutations. Any authenticated user of any tenant could therefore
  // drive another business's account by impersonating, or run its own tools through
  // this surface. Secure by default: super admins only, unless an operator explicitly
  // opens it with MCP_ALLOW_NON_ADMIN=1.
  if ((process.env.MCP_ALLOW_NON_ADMIN || '').trim() !== '1') {
    const { data: gateProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, email')
      .eq('id', callerId)
      .maybeSingle();
    const allowed =
      gateProfile?.role === 'super_admin' || gateProfile?.email === 'rchopra489@gmail.com';
    if (!allowed) {
      return {
        error:
          'The MCP endpoint exposes the full agent tool catalogue and is restricted to super admins. ' +
          'Set MCP_ALLOW_NON_ADMIN=1 to open it deliberately.',
        status: 403,
      };
    }
  }

  // Optional impersonation, super-admin only (mirrors the in-app agent).
  const target = (request.headers.get('x-nobogent-impersonate') || '').trim();
  if (!target || target === callerId) return { userId: callerId, operatorUserId: callerId };

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('role, email')
    .eq('id', callerId)
    .maybeSingle();

  const isSuperAdmin =
    callerProfile?.role === 'super_admin' || callerProfile?.email === 'rchopra489@gmail.com';

  if (!isSuperAdmin) {
    return { error: 'Impersonation requires super admin', status: 403 };
  }
  return { userId: target, operatorUserId: callerId };
}

/** MCP expects JSON Schema; Zod 4 can emit it directly. */
function toJsonSchema(schema: any): Record<string, any> {
  if (!schema) return { type: 'object', properties: {} };
  try {
    const json = z.toJSONSchema(schema, { io: 'input' }) as any;
    delete json.$schema;
    return json;
  } catch {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
}

/** Tool results can contain non-JSON values (dates, bigints, streams). */
function safeText(value: any): string {
  try {
    return JSON.stringify(value ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) ?? 'null';
  } catch {
    return String(value);
  }
}

async function buildTools(userId: string, operatorUserId?: string) {
  // This endpoint is a catalogue for external MCP clients, not a conversation:
  // it always exposes every group in full.
  const { tools } = await createAgentContext(supabaseAdmin as SupabaseClient, userId, {
    operatorUserId,
    forceGroups: ALL_GROUPS,
  });
  return tools as Record<string, any>;
}

export async function POST(request: Request) {
  const identity = await resolveIdentity(request);
  if ('error' in identity) {
    return NextResponse.json(rpcErr(null, -32001, identity.error), { status: identity.status });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcErr(null, -32700, 'Parse error: body must be JSON'), { status: 400 });
  }

  // Batches are optional in MCP; support them as an array of requests.
  if (Array.isArray(body)) {
    const responses = [];
    for (const single of body) {
      const res = await handleRpc(single, identity);
      if (res) responses.push(res);
    }
    return NextResponse.json(responses);
  }

  const res = await handleRpc(body, identity);
  if (!res) return new NextResponse(null, { status: 202 });
  return NextResponse.json(res);
}

async function handleRpc(message: any, identity: { userId: string; operatorUserId?: string }) {
  const id: JsonRpcId = message?.id ?? null;
  const method: string = message?.method || '';
  const params = message?.params || {};

  // Notifications carry no id and expect no body.
  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize':
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Nobogent: an AI business operator for real-estate and SMB marketing. These tools manage CRM, inventory, WhatsApp, AI calling, media generation, Meta ads and a Linux sandbox for the authenticated account.',
      });

    case 'ping':
      return rpcOk(id, {});

    case 'tools/list': {
      const tools = await buildTools(identity.userId, identity.operatorUserId);
      return rpcOk(id, {
        tools: Object.entries(tools).map(([name, t]: [string, any]) => ({
          name,
          description: t?.description || name,
          inputSchema: toJsonSchema(t?.inputSchema ?? t?.parameters),
        })),
      });
    }

    case 'tools/call': {
      const name: string = params?.name || '';
      const args = params?.arguments || {};
      const tools = await buildTools(identity.userId, identity.operatorUserId);
      const target = tools[name];

      if (!target) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      if (typeof target.execute !== 'function') {
        return rpcErr(id, -32603, `Tool ${name} is not executable`);
      }

      try {
        const result = await target.execute(args, {
          toolCallId: `mcp_${Date.now()}`,
          messages: [],
        });
        return rpcOk(id, {
          content: [{ type: 'text', text: safeText(result) }],
          structuredContent: typeof result === 'object' && result !== null ? result : undefined,
          isError: (result as any)?.success === false,
        });
      } catch (err: any) {
        return rpcOk(id, {
          content: [{ type: 'text', text: `Tool ${name} failed: ${err?.message || err}` }],
          isError: true,
        });
      }
    }

    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

/** Lightweight discovery for humans and MCP clients that probe with GET. */
export async function GET() {
  return NextResponse.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocolVersion: PROTOCOL_VERSION,
    transport: 'streamable-http',
    description:
      'Nobogent MCP server. POST JSON-RPC 2.0 (initialize, tools/list, tools/call) with Authorization: Bearer <supabase access token>.',
  });
}
