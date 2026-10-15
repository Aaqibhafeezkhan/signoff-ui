// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ai from 'ai';
import { convertToModelMessages, jsonSchema, readUIMessageStream, streamText, tool, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as core from '../src/core';
import { toToolApproval, type ApprovalRule } from '../src/lib/policy';
import { AI_SDK_MAJOR } from './utils';

/*
 * A tool with no `execute`, such as Getting started's review_changes, is answered on the page: the
 * DiffReview's result is its output. An approval for it leaves the call with no result, and recent
 * AI SDK 7 releases fail the next request with AI_MissingToolResultsError. So the docs' route
 * snippets keep approval rules off it. Each check runs a snippet as the page shows it, with Getting started's three tools
 * and a scripted model, and follows the run to its end.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, 'examples/playground/content', path), 'utf8');
const policyPage = read('components/use-approval-policy.md');
const guide = read('docs/getting-started.md');

/** A `###` section of a page, from its heading to the next heading. */
function section(markdown: string, heading: string) {
  const start = markdown.indexOf(`\n### ${heading}\n`);
  expect(start, `a "### ${heading}" section`).toBeGreaterThan(-1);
  const end = markdown.slice(start + 1).search(/\n#{2,3} /);
  return markdown.slice(start, end === -1 ? undefined : start + 1 + end);
}

/** The first ```ts block in a section. */
function snippet(markdown: string) {
  const code = /```ts\n([\s\S]*?)```/.exec(markdown)?.[1];
  expect(code, 'a ```ts block').toBeDefined();
  return code!;
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const FILES = [{ path: 'app/page.tsx', oldContent: 'a\n', newContent: 'b\n' }];

/** A model that reads a file, proposes an edit and runs a command in one step, then answers. */
function model() {
  let calls = 0;
  const call = (toolCallId: string, toolName: string, input: unknown) =>
    ({ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) }) as const;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] });
          if (calls++ === 0) {
            c.enqueue(call('read', 'read_file', { path: 'app/page.tsx' }));
            c.enqueue(call('review', 'review_changes', { files: FILES }));
            c.enqueue(call('run', 'run_command', { command: 'npm test' }));
          } else {
            c.enqueue({ type: 'text-start', id: 't' });
            c.enqueue({ type: 'text-delta', id: 't', delta: 'Done.' });
            c.enqueue({ type: 'text-end', id: 't' });
          }
          c.enqueue({
            type: 'finish',
            finishReason: { unified: calls === 1 ? 'tool-calls' : 'stop', raw: undefined },
            usage,
          });
          c.close();
        },
      }),
    }),
  });
}

const object = <T>(validate: (value: unknown) => boolean) =>
  jsonSchema<T>(
    { type: 'object' },
    {
      validate: (value) =>
        validate(value) ? { success: true, value: value as T } : { success: false, error: new Error('bad input') },
    },
  );

/** Getting started's tools: review_changes has no execute, so the page answers it. */
const tools = {
  read_file: tool({
    inputSchema: object<{ path: string }>((v) => typeof (v as { path?: unknown }).path === 'string'),
    execute: async ({ path }) => ({ path, content: 'a\n' }),
  }),
  review_changes: tool({
    inputSchema: object<{ files: typeof FILES }>((v) => Array.isArray((v as { files?: unknown }).files)),
  }),
  run_command: tool({
    inputSchema: object<{ command: string }>((v) => typeof (v as { command?: unknown }).command === 'string'),
    execute: async ({ command }) => ({ exitCode: 0, stdout: command }),
  }),
};

type ToolApproval = NonNullable<Parameters<typeof streamText<typeof tools>>[0]['toolApproval']>;

const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Fix the page' }] };

/**
 * Runs a snippet as the page shows it, TypeScript stripped, and returns the `toolApproval` it gives
 * `streamText`. A route snippet's `POST` is called with the person's `rules` in the body. What a
 * snippet leaves to the reader (`model`, `tools`, `rules`, `SERVER_RULES`) is supplied here.
 */
async function toolApprovalOf(code: string, rules: ApprovalRule[], serverRules: ApprovalRule[] = []) {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let given: { toolApproval?: ToolApproval } | undefined;
  const capture = (options: { toolApproval?: ToolApproval }) => {
    given = options;
    return { toUIMessageStreamResponse: () => new Response('') };
  };
  const modules: Record<string, unknown> = { ai: { ...ai, streamText: capture }, 'signoff-ui/core': core };
  const exports: { POST?: (req: Request) => Promise<unknown> } = {};
  const scope: Record<string, unknown> = {
    require: (name: string) => modules[name],
    exports,
    streamText: capture,
    toToolApproval: core.toToolApproval,
    describeRule: core.describeRule,
    parseApprovalRules: core.parseApprovalRules,
    SERVER_RULES: serverRules,
    rules,
    model: undefined,
    tools,
  };
  // The docs' own code, run as written, with the names it leaves to the reader in scope.
  new Function(...Object.keys(scope), js)(...Object.values(scope));
  if (exports.POST)
    await exports.POST(
      new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [user], rules }) }),
    );
  expect(given?.toolApproval, 'the snippet passes streamText a toolApproval').toBeTypeOf('function');
  return given!.toolApproval!;
}

/** One request of the run, as the route makes it, read as useChat reads the stream. */
async function request(toolApproval: ToolApproval, llm: MockLanguageModelV4, messages: UIMessage[]) {
  const stream = streamText({
    model: llm,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    toolApproval,
  }).toUIMessageStream({ originalMessages: messages, onError: (error) => String(error) });
  const asked = messages.at(-1)?.role === 'assistant' ? messages.at(-1) : undefined;
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ message: asked, stream, terminateOnError: true })) last = message;
  return last!;
}

type Part = { type: string; state?: string; approval?: { approved?: boolean }; output?: unknown };
const part = (message: UIMessage, name: string) => message.parts.find((p) => p.type === `tool-${name}`) as Part;

/**
 * What the page does next: the review's result as review_changes' output (`addToolOutput`), and
 * Approve on each card (`addToolApprovalResponse`).
 */
function answer(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((p) => {
      const tool = p as Part;
      if (tool.type === 'tool-review_changes' && tool.state === 'input-available')
        return { ...p, state: 'output-available', output: { summary: 'Applied every change.' } } as typeof p;
      if (tool.state === 'approval-requested')
        return { ...p, state: 'approval-responded', approval: { ...tool.approval, approved: true } } as typeof p;
      return p;
    }),
  };
}

/** The run: the first request, then the one the page sends once the review and every card are answered. */
async function run(toolApproval: ToolApproval) {
  const llm = model();
  const first = await request(toolApproval, llm, [user]);
  const end = await request(toolApproval, llm, [user, answer(first)]);
  return { first, end };
}

const allowAll: ApprovalRule = { id: 'all', tool: '*', effect: 'allow', scope: 'session' };
const denyAll: ApprovalRule = { id: 'none', tool: '*', effect: 'deny', scope: 'always' };
const RULE_SETS: Array<[string, ApprovalRule[]]> = [
  ['no rules', []],
  ['a rule that allows every tool', [allowAll]],
  ['a rule that denies every tool', [denyAll]],
];

/** The run finished: the review's output went to the model, and the model answered. */
function expectFinished(end: UIMessage) {
  expect(part(end, 'review_changes')).toMatchObject({ state: 'output-available' });
  expect(end.parts.findLast((p) => p.type === 'text')).toMatchObject({ text: 'Done.' });
}

// toolApproval and the V4 mock models are AI SDK 7.
describe.skipIf(AI_SDK_MAJOR < 7)('approval rules leave a tool with no execute to the page', () => {
  it('without that, the review gets a card, and once approved it never gets a result', async () => {
    const llm = model();
    const everyTool = toToolApproval([]);
    const first = await request(everyTool, llm, [user]);
    expect(part(first, 'review_changes')).toMatchObject({ state: 'approval-requested' });
    // Approved, the call has no execute to run, and the page renders its DiffReview only while the
    // call is `input-available`, so no output comes. AI SDK 7.0.141 then ends the run with
    // AI_MissingToolResultsError; 7.0.137 sends the model the call without a result.
    const end = await request(everyTool, llm, [user, answer(first)]).catch((error: unknown) => error);
    if (end instanceof Error) {
      expect(end.message).toMatch(/AI_MissingToolResultsError/);
      return;
    }
    expect(part(end as UIMessage, 'review_changes')).toMatchObject({ state: 'approval-responded', output: undefined });
    const results = llm.doStreamCalls
      .at(-1)!
      .prompt.flatMap((message) => (message.role === 'tool' ? message.content : []))
      .flatMap((content) => (content.type === 'tool-result' ? [content.toolCallId] : []));
    expect(results).toEqual(['read', 'run']);
  });

  describe('useApprovalPolicy, "On the server": the server\'s rules, then the person\'s', () => {
    const code = () => snippet(section(policyPage, 'On the server'));
    const noPush: ApprovalRule = {
      id: 'server:no-push',
      tool: 'run_command',
      args: { command: 'git push*' },
      effect: 'deny',
      scope: 'always',
    };

    it.each(RULE_SETS)('never gates review_changes, with %s', async (_name, rules) => {
      const { first, end } = await run(await toolApprovalOf(code(), rules, [noPush]));
      expect(part(first, 'review_changes')).toMatchObject({ state: 'input-available' });
      expect(part(first, 'review_changes').approval).toBeUndefined();
      expectFinished(end);
    });
  });

  describe("useApprovalPolicy, the route that gets a person's rules with each request", () => {
    const code = () => snippet(section(policyPage, "Sending a person's rules with each request"));

    it.each(RULE_SETS)('never gates review_changes, with %s', async (_name, rules) => {
      const { first, end } = await run(await toolApprovalOf(code(), rules));
      expect(part(first, 'review_changes')).toMatchObject({ state: 'input-available' });
      expect(part(first, 'review_changes').approval).toBeUndefined();
      expectFinished(end);
    });

    it("still decides the other tools with the person's rules", async () => {
      const { first } = await run(await toolApprovalOf(code(), [allowAll]));
      expect(part(first, 'run_command')).toMatchObject({ state: 'output-available', approval: { approved: true } });
      const asked = await run(await toolApprovalOf(code(), []));
      expect(part(asked.first, 'run_command')).toMatchObject({ state: 'approval-requested' });
    });
  });

  describe('Getting started, "Approval rules in the route": the walkthrough\'s route with rules', () => {
    const code = () => snippet(section(guide, 'Approval rules in the route'));

    it.each(RULE_SETS)('never gates review_changes, and read_file runs as before, with %s', async (_name, rules) => {
      const { first, end } = await run(await toolApprovalOf(code(), rules));
      expect(part(first, 'review_changes')).toMatchObject({ state: 'input-available' });
      expect(part(first, 'review_changes').approval).toBeUndefined();
      expect(part(first, 'read_file')).toMatchObject({ state: 'output-available' });
      expect(part(first, 'read_file').approval).toBeUndefined();
      expectFinished(end);
    });

    it("decides run_command with the person's rules, and asks with the walkthrough's reason otherwise", async () => {
      const allowed = await run(await toolApprovalOf(code(), [allowAll]));
      expect(part(allowed.first, 'run_command')).toMatchObject({
        state: 'output-available',
        approval: { approved: true },
      });
      const denied = await run(await toolApprovalOf(code(), [denyAll]));
      expect(part(denied.first, 'run_command')).toMatchObject({ state: 'output-denied' });
      const asked = await run(await toolApprovalOf(code(), []));
      expect(part(asked.first, 'run_command')).toMatchObject({
        state: 'approval-requested',
        approval: { requestReason: 'Runs a shell command in the repository.' },
      });
    });
  });
});
