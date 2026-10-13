import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Ask and the MCP server, both on ondocs (https://ondocs.vercel.app), over one index of the docs
 * built before `next build` by scripts/ask-index.ts.
 */

/** Where agents connect, as the docs and llms.txt give it. */
export const MCP_PATH = '/api/mcp';

/**
 * Whether this deployment answers questions: only with OPENAI_API_KEY on the server. Without it the
 * site shows no Ask button and /api/ask answers 404; the MCP server needs no key and always runs.
 */
export function askEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** ask-index.json, read once per server instance, on the first question or search. */
export function loadAskIndex() {
  return readFile(join(process.cwd(), 'ask-index.json'), 'utf8');
}
