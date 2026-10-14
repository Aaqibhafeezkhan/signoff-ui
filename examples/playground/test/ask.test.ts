/*
 * Ask (/api/ask) and the docs MCP server (/api/mcp), through the site's own routes, over an index
 * of the docs built here as scripts/ask-index.ts builds it before `next build`: what Ask answers
 * without a model call, its daily budget, and the counter lines both endpoints log. No question
 * reaches a model: `fetch` fails for the whole file. Needs the library built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildIndex, fromMarkdown, loadIndex, retrieve, type SourceDocument } from 'ondocs';
import { writeIndexFile } from 'ondocs/node';
import { ASK_BUDGET } from '../app/api/ask/budget';
import { askCount, MCP_TOOLS } from '../app/api/counters';
import { MCP_PATH } from '../lib/ask';
import { componentMarkdown } from '../lib/component-markdown';
import { componentHref, COMPONENTS } from '../lib/components';
import { GUIDES, readGuide, toMarkdown } from '../lib/docs';
import { SITE_URL } from '../lib/site';

const SITE = join(import.meta.dirname, '..');

// The routes import from `@/` (tsconfig.json's paths), which Node resolves here as Next.js does.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
    return nextResolve(pathToFileURL(join(SITE, `${specifier.slice(2)}.ts`)).href, context);
  },
});

// The index, as scripts/ask-index.ts writes it: every docs page as the Markdown it is served as.
const documents = [
  ...GUIDES.map((doc) => ({ id: `${doc.slug}.md`, url: doc.href, markdown: toMarkdown(doc, readGuide(doc)) })),
  ...COMPONENTS.map((c) => ({
    id: `components/${c.slug}.md`,
    url: componentHref(c.slug),
    markdown: componentMarkdown(c),
  })),
]
  .map((page) => fromMarkdown(page.markdown, { id: page.id, url: page.url }))
  .filter((doc): doc is SourceDocument => doc !== null);
const { index } = await buildIndex({ documents });

// The routes read ask-index.json from the working directory, as `next start` does; only the build
// writes the site's own, so these run in a directory of their own with this one.
const workdir = mkdtempSync(join(tmpdir(), 'signoff-ui-ask-'));
await writeIndexFile(join(workdir, 'ask-index.json'), index);
process.chdir(workdir);
after(() => rmSync(workdir, { recursive: true, force: true }));

// Ask is on with a key; this one is never sent, as nothing here may call a model.
process.env.OPENAI_API_KEY = 'sk-placeholder-for-tests';
const model = mock.method(globalThis, 'fetch', () => Promise.reject(new Error('No model calls in tests.')));
const { POST: askRoute } = await import('../app/api/ask/route');
const { POST: mcpRoute } = await import('../app/api/mcp/route');

// The counter lines (app/api/counters.ts), kept out of the test output.
const info = mock.method(console, 'info', () => {});
const log = mock.method(console, 'log', () => {});
beforeEach(() => {
  info.mock.resetCalls();
});

/** The counter lines logged so far, parsed. */
const counted = () => info.mock.calls.map((call) => JSON.parse(String(call.arguments[0])) as Record<string, unknown>);
/** Everything logged so far, as one string. */
const logged = () => JSON.stringify([...info.mock.calls, ...log.mock.calls].map((call) => call.arguments));

// ─── What Ask answers ───────────────────────────────────────────────────────

describe('Ask', () => {
  const loaded = loadIndex(index);
  // As the Ask handler retrieves: keyword-only, with its default relevance gate. A question no
  // section clears is answered "I don't know" without a model call.
  const ask = (question: string) => retrieve(loaded, { text: question });

  it('answers how signoff-ui differs from assistant-ui, from the comparison page', () => {
    for (const question of [
      'How is signoff-ui different from assistant-ui, and can I use both?',
      'signoff-ui vs assistant-ui',
      'How is signoff-ui different from AI Elements?',
    ]) {
      const { answerable, best, hits } = ask(question);
      assert.ok(answerable, `refused "${question}" (keyword coverage ${best.keywordCoverage.toFixed(2)})`);
      assert.match(hits[0]!.chunk.url, /\/docs\/comparison(#|$)/, question);
    }
  });

  it('still says it does not know what the docs do not cover', () => {
    for (const question of ['Does it work with Vue?', 'What is the weather in Lisbon today?']) {
      assert.equal(ask(question).answerable, false, question);
    }
  });
});

// ─── Ask's budget and counters ──────────────────────────────────────────────

/** Questions that counted against the day's budget: every one the cache didn't answer. */
let budgeted = 0;
let visitor = 0;
/** One question posted to /api/ask, from an address of its own unless `headers` give one. */
async function question(text: string, headers: Record<string, string> = {}) {
  visitor++;
  const start = info.mock.callCount();
  const response = await askRoute(
    new Request(`${SITE_URL}/api/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `10.${(visitor >> 16) & 255}.${(visitor >> 8) & 255}.${visitor & 255}`,
        ...headers,
      },
      body: JSON.stringify({ question: text }),
    }),
  );
  const body = await response.text();
  const lines = counted().slice(start);
  budgeted += lines.filter((line) => line.counter === 'ask' && !line.cached).length;
  // The answer's line and the question's, in that order or the other.
  return {
    status: response.status,
    body,
    lines: lines.sort((a, b) => String(a.counter).localeCompare(String(b.counter))),
  };
}

describe('/api/ask', () => {
  it('allows 1,500 questions and 5M tokens a day', () => {
    assert.equal(ASK_BUDGET.requestsPerDay, 1_500);
    assert.equal(ASK_BUDGET.tokensPerDay, 5_000_000);
    // An answer is about 3k tokens, sources included: the token cap must leave more than that
    // for each question, or it runs out before the question cap.
    assert.ok(ASK_BUDGET.tokensPerDay / ASK_BUDGET.requestsPerDay > 3_000);
  });

  it('logs a line for each question and each answer, and never the question', async () => {
    const unanswerable = 'Does plugh frobnicate the xyzzy?';
    const first = await question(unanswerable);
    assert.equal(first.status, 200);
    assert.deepEqual(first.lines, [
      { counter: 'ask', cached: false, refused: true, lowConfidence: false, tokens: 0 },
      { counter: 'ask-request', from: null, status: 200, code: null },
    ]);
    // Asked again, from the site: answered from memory.
    assert.deepEqual((await question(unanswerable, { origin: SITE_URL })).lines, [
      { counter: 'ask', cached: true, refused: true, lowConfidence: false, tokens: 0 },
      { counter: 'ask-request', from: SITE_URL, status: 200, code: null },
    ]);
    // Another site's origin is not logged.
    assert.deepEqual((await question(unanswerable, { origin: 'https://example.com' })).lines[1], {
      counter: 'ask-request',
      from: 'other',
      status: 200,
      code: null,
    });
    assert.doesNotMatch(logged(), /xyzzy|example\.com/);
  });

  it('says which limit turned a question away', async () => {
    const headers = { 'x-forwarded-for': '192.0.2.40' };
    const statuses: number[] = [];
    for (let n = 0; n < 6; n++) statuses.push((await question(`Is quux ${n} a plugh?`, headers)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    // Turned away before an answer: the question's line only.
    assert.deepEqual(counted().at(-1), { counter: 'ask-request', from: null, status: 429, code: 'rate_limited' });
  });

  it('answers 1,500 questions a day, then points to the docs and their MCP server', async () => {
    // Every question the cache can't answer counts, answered or not, the earlier tests' included.
    let status = 200;
    let asked = 0;
    while (status === 200 && budgeted < 1_500 && asked < 1_600) {
      ({ status } = await question(`Does plugh frobnicate xyzzy number ${++asked}?`));
    }
    assert.equal(status, 200, `question ${asked} of this test turned away`);
    assert.equal(budgeted, 1_500);
    const over = await question('Does plugh frobnicate one more xyzzy?');
    assert.equal(over.status, 429);
    assert.deepEqual(JSON.parse(over.body), {
      error: { code: 'budget_exceeded', message: ASK_BUDGET.message },
    });
    assert.ok(ASK_BUDGET.message.includes(`${SITE_URL}/docs`));
    assert.ok(ASK_BUDGET.message.includes(`${SITE_URL}${MCP_PATH}`));
    assert.deepEqual(counted().at(-1), { counter: 'ask-request', from: null, status: 429, code: 'budget_exceeded' });
    assert.equal(model.mock.callCount(), 0);
  });

  it('counts the tokens an answer and its follow-up spent, and leaves out the question', () => {
    const answer = {
      question: 'How do I install it?',
      cached: false,
      refused: false,
      lowConfidence: false,
      usage: { totalTokens: 2_700 },
      followUp: { question: 'and with shadcn?', usage: { totalTokens: 150 } },
    };
    assert.deepEqual(askCount(answer), {
      counter: 'ask',
      cached: false,
      refused: false,
      lowConfidence: false,
      tokens: 2_850,
    });
    assert.equal(askCount({ ...answer, cached: true, usage: undefined, followUp: undefined }).tokens, 0);
    assert.doesNotMatch(JSON.stringify(askCount(answer)), /install|shadcn/);
  });
});

// ─── MCP counters ───────────────────────────────────────────────────────────

let id = 0;
/** One JSON-RPC request to /api/mcp, as MCP 2025-06-18 sends it. */
async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const response = await mcpRoute(
    new Request(`${SITE_URL}${MCP_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'x-forwarded-for': '203.0.113.7',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }),
  );
  const body = (await response.json()) as {
    result?: { serverInfo?: { name: string }; tools?: { name: string }[]; isError?: boolean };
    error?: { message: string };
  };
  return { status: response.status, body };
}

/** A 2026-07-28 request: no initialize, and the version and the client in every `_meta`. */
function modern(method: string, params: Record<string, unknown>, client: unknown = 'claude-code') {
  return rpc(
    method,
    {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: client, version: '2.0.0' },
      },
    },
    {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
    },
  );
}

describe('/api/mcp', () => {
  before(() => info.mock.resetCalls());

  it('logs a line for each connection and tool call, with the client’s name', async () => {
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'cursor-vscode', version: '1.0.0' },
    });
    // The name `claude mcp add` gives it in the docs.
    assert.equal(init.body.result?.serverInfo?.name, 'signoff-ui');
    await rpc('tools/list');
    const search = await rpc('tools/call', { name: 'search', arguments: { query: 'toToolApproval rules' } });
    assert.ok(search.body.result && !search.body.result.isError);
    await modern('tools/call', { name: 'fetch', arguments: { id: '/docs/comparison' } });
    assert.deepEqual(counted(), [
      { counter: 'mcp', method: 'initialize', tool: null, client: 'cursor-vscode', status: 200 },
      // A 2025 tool call does not say which client sent it; its initialize did.
      { counter: 'mcp', method: 'tools/call', tool: 'search', client: null, status: 200 },
      { counter: 'mcp', method: 'tools/call', tool: 'fetch', client: 'claude-code', status: 200 },
    ]);
    // What the agent searched for and read stays out of the counter lines.
    assert.doesNotMatch(JSON.stringify(info.mock.calls.map((call) => call.arguments)), /toToolApproval|comparison/);
  });

  it('counts the tool calls it turns away, with their 429', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    const statuses: number[] = [];
    for (let n = 0; n < 31; n++) {
      statuses.push((await rpc('tools/call', { name: 'list_pages', arguments: {} }, headers)).status);
    }
    assert.equal(statuses.filter((status) => status === 200).length, 30);
    assert.equal(statuses.at(-1), 429);
    assert.deepEqual(counted().at(-1), {
      counter: 'mcp',
      method: 'tools/call',
      tool: 'list_pages',
      client: null,
      status: 429,
    });
  });

  it('keeps a client’s name to 100 printable characters', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.10' };
    const names = ['x'.repeat(20_000), 'cursor‮', 'line\nbreak', 42, ''];
    for (const name of names) {
      await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name } }, headers);
    }
    assert.deepEqual(
      counted().map((line) => line.client),
      ['x'.repeat(100), null, null, null, null],
    );
    assert.doesNotMatch(logged(), /x{101}|‮|line\\nbreak/);
  });

  it('counts no call to a tool it does not have, and logs none of the name', async () => {
    const personal = 'how do I reset my password for jane@example.com';
    for (const call of [
      rpc('tools/call', { name: 'x'.repeat(20_000), arguments: {} }),
      rpc('tools/call', { name: personal, arguments: {} }),
      modern('tools/call', { name: personal, arguments: {} }),
      rpc('tools/call', { name: 42, arguments: {} }),
    ]) {
      const { status, body } = await call;
      assert.equal(status, 200);
      assert.match(body.error?.message ?? '', /^Unknown tool/);
    }
    assert.deepEqual(counted(), []);
    assert.doesNotMatch(logged(), /x{100}|jane@example\.com/);
  });

  it('counts no tool call whose arguments are not an object, which runs nothing', async () => {
    const { body } = await rpc('tools/call', { name: 'search', arguments: 'baseline' });
    assert.equal(body.result?.isError, true);
    assert.deepEqual(counted(), []);
    // ondocs reads a null `arguments` as {}, and runs the tool.
    await rpc('tools/call', { name: 'list_pages', arguments: null });
    assert.deepEqual(counted(), [
      { counter: 'mcp', method: 'tools/call', tool: 'list_pages', client: null, status: 200 },
    ]);
  });

  it('counts no connection it answers with an error', async () => {
    // server/discover without MCP 2026-07-28's _meta is a method ondocs does not have.
    const { body } = await rpc('server/discover', { clientInfo: { name: 'test', version: '1.0.0' } });
    assert.match(body.error?.message ?? '', /^Method not found/);
    assert.deepEqual(counted(), []);
  });

  it('counts by the names of the tools it lists', async () => {
    const { body } = await rpc('tools/list');
    assert.deepEqual(new Set(body.result?.tools?.map((tool) => tool.name)), MCP_TOOLS);
  });
});
