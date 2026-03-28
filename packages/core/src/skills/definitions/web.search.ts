/**
 * WRAP NEBULA Core - Web Search Skill (Real DuckDuckGo Scraping)
 * No API key needed — scrapes DDG HTML directly
 */

import { SkillDefinition, SkillContext, SkillResult } from '../index.js';
import * as http from 'http';
import * as https from 'https';

const USER_AGENT = 'Mozilla/5.0 (compatible; WrapNebula/8.0; +https://github.com/Vitalcheffe/Wrap)';
const TIMEOUT = 10000;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function fetchURL(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: TIMEOUT,
    }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchURL(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function parseDDGResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML results format:
  // <a class="result__a" href="URL">TITLE</a>
  // <a class="result__snippet">SNIPPET</a>

  // Parse result links
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null && links.length < maxResults) {
    let url = match[1];
    const title = match[2].replace(/<[^>]*>/g, '').trim();

    // Decode DDG redirect URLs
    if (url.includes('uddg=')) {
      const uddgMatch = url.match(/uddg=([^&]*)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }
    }

    if (title && url && !url.includes('duckduckgo.com')) {
      links.push({ url, title });
    }
  }

  // Parse snippets
  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
    const snippet = match[1].replace(/<[^>]*>/g, '').trim();
    if (snippet) snippets.push(snippet);
  }

  // Combine
  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results.map((r, i) => {
    const lines = [`${i + 1}. ${r.title}`];
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push(`   ${r.url}`);
    return lines.join('\n');
  }).join('\n\n');
}

export const webSearchSkill: SkillDefinition = {
  name: 'web.search',
  description: 'Search the web using DuckDuckGo. No API key needed. Returns top results with titles, snippets, and URLs.',
  category: 'web',
  permissions: ['network:https'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      num: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 10)',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
  },
  required: ['query'],
  examples: [
    {
      description: 'Search for latest AI news',
      params: { query: 'latest AI news', num: 5 },
      result: 'List of search results with titles, snippets, and URLs',
    },
  ],
  handler: async (params: Record<string, unknown>): Promise<SkillResult> => {
    const query = params.query as string;
    const num = Math.min((params.num as number) || 5, 10);

    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const html = await fetchURL(url);
      const results = parseDDGResults(html, num);

      if (results.length === 0) {
        // Try alternative parsing
        const altResults: SearchResult[] = [];
        const titleRegex = /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/gi;
        let m;
        while ((m = titleRegex.exec(html)) !== null && altResults.length < num) {
          const title = m[1].replace(/<[^>]*>/g, '').trim();
          if (title) altResults.push({ title, url: '', snippet: '' });
        }

        if (altResults.length > 0) {
          return {
            success: true,
            output: formatResults(altResults),
            metadata: { query, results: altResults, source: 'duckduckgo' },
          };
        }

        return {
          success: true,
          output: `No results found for "${query}". Try a different search term.`,
          metadata: { query, results: [], source: 'duckduckgo' },
        };
      }

      return {
        success: true,
        output: formatResults(results),
        metadata: { query, results, source: 'duckduckgo' },
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        success: false,
        output: null,
        error: `Search failed: ${err.message}. DuckDuckGo might be temporarily unavailable.`,
      };
    }
  },
};
