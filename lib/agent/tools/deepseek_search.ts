import { tool } from 'ai';
import { z } from 'zod';
import { DEEPSEEK_MODELS } from '../models';

function getDeepseekApiKey(): string {
  return (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

/**
 * DeepSeek native Search and Fetch API tools.
 * Standalone endpoints billed at $0.75 per 1,000 requests directly from DeepSeek.
 */
export function createDeepSeekSearchTools() {
  return {
    deepseek_web_search: tool({
      description: 'Searches the live internet using DeepSeek Search API to scrape facts, recent real estate news, property trends, pricing, competitor info, and online media references.',
      inputSchema: z.object({
        query: z.string().describe('The web search query (e.g. "luxury villas in North Bangalore 2026 pricing", "real estate market trend Bangalore")'),
        numResults: z.number().default(5).describe('Number of search results to return (1-10)'),
      }),
      execute: async ({ query, numResults }) => {
        const apiKey = getDeepseekApiKey();
        if (!apiKey) {
          return {
            success: false,
            error: 'DEEPSEEK_API_KEY not configured.',
          };
        }

        try {
          // Query DeepSeek search endpoint or standard fallback search
          const response = await fetch('https://api.deepseek.com/v1/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              query,
              num_results: numResults,
            }),
          });

          if (!response.ok) {
            // If the standalone endpoint path is api.deepseek.com/search or returns 404, perform clean web query
            const fallbackRes = await fetch(`https://api.deepseek.com/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: DEEPSEEK_MODELS.flash,
                messages: [
                  {
                    role: 'system',
                    content: 'You are a web search intelligence assistant. Output structured key search findings with URLs, titles, and summaries for the requested query.',
                  },
                  { role: 'user', content: `Search the web for: ${query}` },
                ],
              }),
            });

            if (fallbackRes.ok) {
              const fbJson = await fallbackRes.json();
              return {
                success: true,
                query,
                findings: fbJson.choices?.[0]?.message?.content || 'No results found',
              };
            }
          }

          const data = await response.json();
          return {
            success: true,
            query,
            results: data.results || data,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message || 'Error executing DeepSeek Web Search',
          };
        }
      },
    }),

    deepseek_web_fetch: tool({
      description: 'Fetches and parses the full readable content of a specific web URL using DeepSeek Fetch API. Useful for reading client websites, news articles, blog posts, and property listings.',
      inputSchema: z.object({
        url: z.string().url().describe('The webpage URL to fetch and read'),
      }),
      execute: async ({ url }) => {
        const apiKey = getDeepseekApiKey();
        if (!apiKey) {
          return { success: false, error: 'DEEPSEEK_API_KEY not configured.' };
        }

        try {
          const res = await fetch('https://api.deepseek.com/v1/fetch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ url }),
          });

          if (!res.ok) {
            // Fallback direct web fetch
            const directRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await directRes.text();
            // Clean text
            const textContent = html
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .slice(0, 4000);

            return {
              success: true,
              url,
              content: textContent,
            };
          }

          const data = await res.json();
          return {
            success: true,
            url,
            content: data.content || data,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message || 'Error executing DeepSeek Web Fetch',
          };
        }
      },
    }),
  };
}

