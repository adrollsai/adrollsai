/**
 * Minimal Model Context Protocol client over HTTP.
 *
 * Meta's official ads server (`https://mcp.facebook.com/ads`) is a remote MCP
 * endpoint authenticated with `Authorization: Bearer <token>`, and Nobogent's
 * own `/api/mcp` speaks the same protocol — so one client serves both.
 *
 * The transport is JSON-RPC 2.0 POST. Servers may answer either as plain JSON or
 * as a `text/event-stream`, so both are parsed here; the SSE case is not
 * optional decoration, it is the default for several MCP servers.
 */

export interface McpServerConfig {
  url: string;
  /** Static headers (auth, content negotiation). */
  headers?: Record<string, string>;
  /** Sent as `Authorization: Bearer <token>` when set. */
  bearerToken?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Label used in error messages. */
  name?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/** Pull the JSON-RPC payload out of either a JSON body or an SSE stream. */
function parseBody(contentType: string, raw: string, id: number): any {
  if (contentType.includes('text/event-stream')) {
    const messages: any[] = [];
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        /* ignore keep-alive fragments */
      }
    }
    const match = messages.find((m) => m && m.id === id);
    return match ?? messages[messages.length - 1] ?? null;
  }
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.find((m) => m?.id === id) ?? parsed[0] ?? null;
    return parsed;
  } catch {
    return null;
  }
}

export class McpClient {
  private nextId = 1;
  private sessionId?: string;
  private initialized = false;
  private protocolVersion = '2025-06-18';

  constructor(private readonly cfg: McpServerConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.cfg.headers || {}),
    };
    if (this.cfg.bearerToken) h.Authorization = `Bearer ${this.cfg.bearerToken}`;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.initialized) h['MCP-Protocol-Version'] = this.protocolVersion;
    return h;
  }

  private async rpc(method: string, params?: Record<string, any>): Promise<any> {
    const id = this.nextId++;
    const timeoutMs = this.cfg.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.cfg.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
        signal: controller.signal,
      });

      const sessionHeader = res.headers.get('mcp-session-id');
      if (sessionHeader) this.sessionId = sessionHeader;

      const raw = await res.text();

      if (!res.ok) {
        throw new McpError(
          `${this.cfg.name || 'MCP server'} rejected ${method}: HTTP ${res.status}`,
          res.status,
          raw.slice(0, 800)
        );
      }

      const payload = parseBody(res.headers.get('content-type') || '', raw, id);
      if (!payload) {
        throw new McpError(`${this.cfg.name || 'MCP server'} returned an empty response for ${method}`, res.status, raw.slice(0, 400));
      }
      if (payload.error) {
        throw new McpError(
          `${method} failed: ${payload.error.message || JSON.stringify(payload.error)}`,
          res.status,
          JSON.stringify(payload.error).slice(0, 600)
        );
      }
      return payload.result;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new McpError(`${this.cfg.name || 'MCP server'} timed out after ${timeoutMs}ms on ${method}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Handshake. Never sends `notifications/initialized` on top of a failure. */
  async initialize(): Promise<{ serverInfo?: any; protocolVersion?: string }> {
    if (this.initialized) return { serverInfo: undefined };
    const result = await this.rpc('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: {} },
      clientInfo: { name: 'nobogent-agent', version: '1.0.0' },
    });
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion;
    this.initialized = true;

    // Best-effort notification; some servers do not require it.
    try {
      await fetch(this.cfg.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
    } catch {
      /* non-fatal */
    }
    return { serverInfo: result?.serverInfo, protocolVersion: this.protocolVersion };
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialize();
    const result = await this.rpc('tools/list', {});
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.map((t: any) => ({
      name: String(t.name),
      description: t.description ? String(t.description) : undefined,
      inputSchema: t.inputSchema || t.parameters,
    }));
  }

  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    await this.initialize();
    const result = await this.rpc('tools/call', { name, arguments: args });
    // MCP returns content blocks; flatten text for the model while keeping raw.
    const text = Array.isArray(result?.content)
      ? result.content
          .map((c: any) => (c?.type === 'text' ? c.text : c?.type ? `[${c.type}]` : ''))
          .filter(Boolean)
          .join('\n')
      : undefined;
    return { ...result, text };
  }
}

/** True when an error is Meta's "this token lacks ads_mcp_management" 401. */
export function isMetaMcpAuthError(err: any): boolean {
  return err instanceof McpError && (err.status === 401 || err.status === 403);
}
