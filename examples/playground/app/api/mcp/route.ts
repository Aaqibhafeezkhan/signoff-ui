import { createMcpHandler, memoryRateLimit } from 'ondocs/server';
import { loadAskIndex } from '@/lib/ask';
import { SITE_URL } from '@/lib/site';
import { withMcpCounter } from '../counters';

/*
 * The docs as an MCP server for coding agents: `search`, `fetch` and `list_pages` over the same
 * index as Ask, through MCP's Streamable HTTP transport, statelessly. Search is keyword-only, so
 * nothing here calls a model or needs a key: the agent brings its own.
 *
 * The limits are ondocs.vercel.app's own: 30 tool calls a minute per client address (the last
 * X-Forwarded-For entry, which Vercel sets), and 20,000 a day for the whole site, per instance.
 * Each connection and tool call logs a counter line with the client's name (../counters.ts).
 */
const docs = createMcpHandler({
  index: loadAskIndex,
  name: 'signoff-ui',
  siteName: 'the signoff-ui docs',
  siteUrl: SITE_URL,
  rateLimit: memoryRateLimit({ limit: 30, windowMs: 60_000 }),
  budget: { requestsPerDay: 20_000 },
  onToolCall: ({ tool, isError, durationMs, retrieval }) => {
    console.log(`[mcp] ${tool}${retrieval ? ` (${retrieval})` : ''}${isError ? ' error' : ''} ${durationMs}ms`);
  },
});
const handler = withMcpCounter(docs);

// POST carries the JSON-RPC; GET and DELETE get the 405 a stateless server sends, OPTIONS its CORS answer.
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
