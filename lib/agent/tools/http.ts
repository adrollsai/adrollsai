/* eslint-disable @typescript-eslint/no-explicit-any -- arbitrary JSON payloads. */
/**
 * The HTTP primitive: talk to any API the business uses.
 *
 * WHY
 * `deepseek_web_fetch` reads a page (GET, text). That covers research and nothing else. A business
 * that runs on Razorpay, a CRM webhook, a Google Sheet, a courier API or its own backend has no way
 * to have the agent *call* it — so the answer to "send this to our internal system" was "I cannot".
 * Flexibility means the agent can make the request, not that we pre-wrap every vendor.
 *
 * WHAT KEEPS IT FROM BEING A LOADED GUN
 *  - https only (no plaintext, no file:, no gopher:);
 *  - the hostname AND the resolved address must be public: localhost, private ranges, link-local and
 *    cloud metadata endpoints are refused, which is what stops an SSRF pivot into our own network;
 *  - a 20-second timeout and a 1 MB response cap, so it cannot be used to hold a turn open or to
 *    pull a database dump into the context;
 *  - READ is free; every state-changing method (POST / PUT / PATCH / DELETE) is REVIEW GATED, because
 *    a POST to somebody's API can move money, send a message or delete a record.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Anything with a scheme that is not https is refused outright. */
export const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
/** Methods that change state, and therefore need the owner's approval. */
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const MAX_RESPONSE_BYTES = 1_000_000;
export const REQUEST_TIMEOUT_MS = 20_000;

/** Hosts that must never be reachable from a tool, whatever they resolve to. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\./i,
  /^169\.254\./,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
];

export interface UrlCheck {
  ok: boolean;
  error?: string;
  url?: URL;
}

/**
 * Validate a URL before any request is made. Pure, so every refusal is testable.
 *
 * The host name check runs first (cheap, no DNS); the resolved-address check runs at call time, because
 * a name can point anywhere and a name check alone is theatre.
 */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return { ok: false, error: 'that is not a URL. Include the scheme, e.g. https://api.example.com/v1/items' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: `only https is allowed (got "${url.protocol}"). Plain http, file: and data: URLs are refused.` };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'credentials in the URL are refused — pass them in the headers instead' };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    return {
      ok: false,
      error: `"${host}" is a private, loopback or metadata address. This tool only reaches public hosts.`,
    };
  }
  if (!host.includes('.')) {
    return { ok: false, error: `"${host}" is not a public hostname` };
  }
  return { ok: true, url };
}

/** Is this resolved address public? Used at call time, after DNS. */
export function isPublicAddress(address: string): boolean {
  const value = String(address ?? '').trim();
  if (!value) return false;
  return !BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(value));
}

export function isMutatingMethod(method: string): boolean {
  return (MUTATING_METHODS as readonly string[]).includes(String(method ?? '').toUpperCase());
}

export function createHttpTools(_supabase: SupabaseClient, _userId: string) {
  return {
    http_request: tool({
      description:
        'Call ANY https API directly: GET/HEAD to read, POST/PUT/PATCH/DELETE to write. Use it for a vendor or internal system this product has no tool for (Razorpay, a webhook, a Google Sheet, the business\'s own backend). ' +
        'Send JSON or form bodies, read the status, the headers and the body (truncated at 1 MB). Only public https hosts are reachable — localhost, private ranges and cloud metadata are refused. ' +
        'A state-changing method (POST/PUT/PATCH/DELETE) requires the owner\'s approval first; GET and HEAD are free. ' +
        'Never put a secret in the URL: pass it in headers, and never echo a credential back into the conversation.',
      inputSchema: z.object({
        url: z.string().describe('Absolute https URL'),
        method: z.enum(ALLOWED_METHODS).default('GET'),
        headers: z.record(z.string(), z.string()).optional().describe('Request headers, e.g. { "Authorization": "Bearer ..." }'),
        body: z.string().optional().describe('Request body (string). JSON-encode it yourself when the API expects JSON.'),
        bodyType: z.enum(['json', 'form', 'text']).default('json').describe('How to declare the body in Content-Type'),
        timeoutMs: z.number().optional().describe(`Milliseconds, capped at ${REQUEST_TIMEOUT_MS}`),
      }),
      execute: async (input: any) => {
        const checked = checkUrl(input.url);
        if (!checked.ok || !checked.url) return { ok: false, error: checked.error };
        const method = String(input.method || 'GET').toUpperCase();

        // DNS guard: a public name can still resolve to a private address.
        try {
          const { lookup } = await import('node:dns/promises');
          const resolved = await lookup(checked.url.hostname, { all: true });
          const publicOnly = resolved.filter((entry: any) => isPublicAddress(entry.address));
          if (!publicOnly.length) {
            return {
              ok: false,
              error: `"${checked.url.hostname}" resolves only to private addresses (${resolved.map((r: any) => r.address).join(', ')}), so the request was refused.`,
            };
          }
        } catch (dnsError: any) {
          return { ok: false, error: `could not resolve "${checked.url.hostname}": ${dnsError?.message || 'unknown error'}` };
        }

        const timeout = Math.max(1_000, Math.min(Number(input.timeoutMs ?? REQUEST_TIMEOUT_MS), REQUEST_TIMEOUT_MS));
        const headers: Record<string, string> = { ...(input.headers || {}) };
        if (input.body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
          headers['Content-Type'] =
            input.bodyType === 'form' ? 'application/x-www-form-urlencoded' : input.bodyType === 'text' ? 'text/plain' : 'application/json';
        }

        try {
          const response = await fetch(checked.url.toString(), {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : input.body,
            signal: AbortSignal.timeout(timeout),
            redirect: 'follow',
          });

          const buffer = await response.arrayBuffer();
          const truncated = buffer.byteLength > MAX_RESPONSE_BYTES;
          const text = Buffer.from(buffer.slice(0, MAX_RESPONSE_BYTES)).toString('utf8');

          let parsed: any = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* not JSON; the text is the answer */
          }

          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            method,
            url: checked.url.toString(),
            contentType: response.headers.get('content-type'),
            truncated,
            body: parsed ?? text.slice(0, 20_000),
            bodyIsJson: parsed !== null,
            note: truncated
              ? `The response was larger than ${MAX_RESPONSE_BYTES} bytes, so only the first ${MAX_RESPONSE_BYTES} were read.`
              : undefined,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the request failed', method, url: checked.url.toString() };
        }
      },
    }),
  };
}

/** Names this module registers, so a gate can assert they are wired. */
export const HTTP_TOOLS = ['http_request'] as const;
