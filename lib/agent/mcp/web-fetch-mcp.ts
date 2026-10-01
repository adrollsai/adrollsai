import { tool } from 'ai';
import { z } from 'zod';

export function createWebFetchMcpTools() {
  return {
    mcp_fetch_web_content: tool({
      description: 'Fetch and extract clean readable text from any public web page, blog, property portal listing, or RERA regulatory document.',
      inputSchema: z.object({
        url: z.string().url().describe('The full URL to fetch'),
      }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          if (!res.ok) {
            return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
          }

          const html = await res.text();

          // Strip HTML tags and script/style tags for clean readable content
          const cleanText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          return {
            success: true,
            url,
            length: cleanText.length,
            content: cleanText.slice(0, 10000), // Max 10,000 characters for token efficiency
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
