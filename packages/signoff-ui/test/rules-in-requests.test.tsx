import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AbstractChat,
  convertToModelMessages,
  DefaultChatTransport,
  jsonSchema,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  stepCountIs,
  streamText,
  tool,
  type ChatInit,
  type ChatState,
  type ChatStatus,
  type UIMessage,
} from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { describe, expect, it } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { parseApprovalRules, toPlainRules, toToolApproval, type ApprovalRule } from '../src/lib/policy';
import { memoryRuleStorage, useApprovalPolicy } from '../src/use-approval-policy';
import { AI_SDK_MAJOR } from './utils';

const rule = (overrides: Partial<ApprovalRule>): ApprovalRule => ({
  id: 'r',
  tool: 'run_command',
  effect: 'allow',
  scope: 'always',
  ...overrides,
});

/** What a request body carries, after JSON. */
const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('toPlainRules', () => {
  it('copies each rule as JSON carries it', () => {
    const rules = [
      rule({ id: 'a', args: { command: 'npm test*' }, createdAt: 1, reason: 'Tests' }),
      rule({ id: 'b', tool: 'read_file', scope: 'session' }),
    ];
    const plain = toPlainRules(rules);
    expect(plain).toEqual(rules);
    expect(plain[0]).not.toBe(rules[0]);
    expect(plain[0]!.args).not.toBe(rules[0]!.args);
    expect(overTheWire(plain)).toEqual(plain);
  });

  it('leaves out a rule with a `when`, which would cover more calls without it', () => {
    const narrowed = rule({
      id: 'w',
      tool: 'write_file',
      when: (input) => (input as { path: string }).path === 'a.ts',
    });
    const plain = toPlainRules([narrowed, rule({ id: 'k' })]);
    expect(plain.map((r) => r.id)).toEqual(['k']);
    // Sent without its `when`, the rule would approve writes to any file on the server.
    const call = { toolCall: { toolName: 'write_file', input: { path: '.env' } } };
    expect(toToolApproval(plain)(call)).toBe('user-approval');
  });
});

describe('parseApprovalRules', () => {
  it('reads back what toPlainRules sends', () => {
    const rules = [
      rule({ id: 'a', args: { command: 'npm test*', 'options.cwd': 'src' }, createdAt: 1700000000000 }),
      rule({ id: 'b', tool: 'mcp_github_*', effect: 'deny', scope: 'session', reason: 'Not on GitHub' }),
    ];
    expect(parseApprovalRules(overTheWire(toPlainRules(rules)))).toEqual(rules);
  });

  it('takes nothing that is not a list of rules', () => {
    for (const value of [undefined, null, 'rules', 1, {}, { 0: rule({}) }])
      expect(parseApprovalRules(value)).toEqual([]);
  });

  it('leaves out a rule with a field of the wrong type, and drops fields it does not know', () => {
    const valid = { id: 'ok', tool: 'run_command', effect: 'allow', scope: 'always' };
    const parsed = parseApprovalRules([
      null,
      'rule',
      [valid],
      { ...valid, id: 1 },
      { ...valid, id: undefined },
      { ...valid, tool: ['run_command'] },
      { ...valid, effect: 'ask' },
      { ...valid, scope: 'forever' },
      { ...valid, args: 'npm test*' },
      { ...valid, args: ['npm test*'] },
      { ...valid, args: null },
      { ...valid, args: { command: 1 } },
      { ...valid, args: { command: { glob: '*' } } },
      { ...valid, reason: 42 },
      { ...valid, createdAt: '2026-10-12' },
      { ...valid, createdAt: null },
      { ...valid, id: 'last', when: 'input.path === "a.ts"', admin: true, args: { command: '' } },
    ]);
    expect(parsed).toEqual([
      { id: 'last', tool: 'run_command', args: { command: '' }, effect: 'allow', scope: 'always' },
    ]);
  });

  it('keeps to the limits, with defaults', () => {
    const many = Array.from({ length: 150 }, (_, i) => rule({ id: `r${i}` }));
    expect(parseApprovalRules(many)).toHaveLength(100);
    expect(parseApprovalRules(many, { maxRules: 3 }).map((r) => r.id)).toEqual(['r0', 'r1', 'r2']);
    // The first entries are read, valid or not.
    expect(parseApprovalRules([{}, ...many], { maxRules: 3 }).map((r) => r.id)).toEqual(['r0', 'r1']);

    const args = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, 'x']));
    expect(parseApprovalRules([rule({ args: args(20) })])).toHaveLength(1);
    expect(parseApprovalRules([rule({ args: args(21) })])).toEqual([]);
    expect(parseApprovalRules([rule({ args: args(3) })], { maxArgs: 2 })).toEqual([]);

    const long = 'x'.repeat(501);
    for (const overrides of [
      { id: long },
      { tool: long },
      { reason: long },
      { args: { [long]: 'x' } },
      { args: { a: long } },
    ])
      expect(parseApprovalRules([rule(overrides)])).toEqual([]);
    expect(parseApprovalRules([rule({ reason: 'x'.repeat(500) })])).toHaveLength(1);
    expect(parseApprovalRules([rule({ reason: 'four' })], { maxLength: 3 })).toEqual([]);
  });

  it('leaves out a pattern with more `*` wildcards than the limit: one, by default', () => {
    const kept = (glob: string, limits?: { maxWildcards: number }) =>
      parseApprovalRules([rule({ args: { command: glob } })], limits).length === 1;
    expect(kept('npm test*')).toBe(true);
    expect(kept('src/**')).toBe(true);
    expect(kept('git ?tatus')).toBe(true);
    expect(kept('echo \\*\\* *')).toBe(true);
    expect(kept('*a*b')).toBe(false);
    expect(kept('src/**/*.ts')).toBe(false);
    expect(kept('src/**/*.ts', { maxWildcards: 2 })).toBe(true);
    expect(kept('npm test', { maxWildcards: 0 })).toBe(true);
    expect(kept('npm test*', { maxWildcards: 0 })).toBe(false);
    expect(parseApprovalRules([rule({ tool: 'mcp_*_*' })])).toEqual([]);
    expect(parseApprovalRules([rule({ tool: 'mcp_github_*' })])).toHaveLength(1);
  });

  it('lets no rule a client sends approve a call the server’s rules deny', () => {
    const SERVER_RULES = [rule({ id: 'server:push', args: { command: 'git push*' }, effect: 'deny' })];
    // The widest rules a client can send: any tool, and any command under the server rule's own id.
    const sent = parseApprovalRules(
      overTheWire([rule({ id: 'mine', tool: '*' }), rule({ id: 'server:push', args: { command: '**' } })]),
    );
    const call = (command: string) => ({ toolCall: { toolName: 'run_command', input: { command } } });
    const yours = toToolApproval(sent);
    expect(sent).toHaveLength(2);
    expect(yours(call('git push origin main'))).toMatchObject({ type: 'approved' });

    // As the docs show it: the server's rules first, the person's for the calls they leave open.
    const server = toToolApproval(SERVER_RULES, { otherwise: 'not-applicable' });
    const both = (options: ReturnType<typeof call>) => {
      const decided = server(options);
      return decided === 'not-applicable' ? yours(options) : decided;
    };
    expect(both(call('git push origin main'))).toMatchObject({ type: 'denied' });
    expect(both(call('npm test'))).toMatchObject({ type: 'approved' });
    // In one list too, whatever the order: a deny rule wins over an allow rule.
    expect(toToolApproval([...sent, ...SERVER_RULES])(call('git push origin main'))).toMatchObject({
      type: 'denied',
    });
  });
});

describe('policy.getRules', () => {
  it('is the same function on every render, and returns the rules as they are now', async () => {
    const storage = memoryRuleStorage([rule({ id: 'saved', tool: 'read_file' })]);
    const { result, rerender } = renderHook(() =>
      useApprovalPolicy({
        storage,
        defaultRules: [rule({ id: 'code', tool: 'write_file', when: () => true })],
      }),
    );
    const getRules = result.current.getRules;
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(getRules()).toEqual([rule({ id: 'saved', tool: 'read_file' })]);

    act(() => result.current.addRule(rule({ id: 'added', tool: 'list_files' })));
    rerender();
    expect(result.current.getRules).toBe(getRules);
    expect(getRules().map((r) => r.id)).toEqual(['saved', 'added']);
  });

  it('has a session rule as soon as a decision makes it, before the page re-renders', () => {
    const { result } = renderHook(() => useApprovalPolicy());
    const request = { id: 'a1', toolName: 'run_command', input: { command: 'npm test' } };
    let sent: ApprovalRule[] = [];
    act(() => {
      const policy = result.current;
      policy.decide(request, 'allow-session', { args: { command: 'npm test*' } });
      // What a request made in the same handler, such as the one carrying this approval, sends.
      sent = policy.getRules();
      expect(policy.rules).toEqual([]);
    });
    expect(sent).toEqual([
      expect.objectContaining({
        tool: 'run_command',
        args: { command: 'npm test*' },
        effect: 'allow',
        scope: 'session',
      }),
    ]);
  });

  it('returns controlled rules', () => {
    const rules = [rule({ id: 'mine' })];
    const { result } = renderHook(() => useApprovalPolicy({ rules }));
    expect(result.current.getRules()).toEqual(rules);
  });
});

/*
 * The documented pattern, end to end: the page sends `policy.getRules()` with each request through a
 * transport made once, and the route decides with `toToolApproval(parseApprovalRules(body.rules))`.
 */

/** `useChat` without @ai-sdk/react: AI SDK's AbstractChat over a store the page subscribes to. */
function useTestChat(init: Omit<ChatInit<UIMessage>, 'messages'>) {
  const [store] = useState(() => {
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    let messages: UIMessage[] = [];
    let status: ChatStatus = 'ready';
    let error: Error | undefined;
    const state: ChatState<UIMessage> = {
      get status() {
        return status;
      },
      set status(next) {
        status = next;
        notify();
      },
      get error() {
        return error;
      },
      set error(next) {
        error = next;
        notify();
      },
      get messages() {
        return messages;
      },
      set messages(next) {
        messages = [...next];
        notify();
      },
      pushMessage(message) {
        messages = [...messages, structuredClone(message)];
        notify();
      },
      popMessage() {
        messages = messages.slice(0, -1);
        notify();
      },
      replaceMessage(index, message) {
        messages = messages.map((m, i) => (i === index ? structuredClone(message) : m));
        notify();
      },
      snapshot: (thing) => structuredClone(thing),
    };
    class Chat extends AbstractChat<UIMessage> {}
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    return { chat: new Chat({ ...init, state }), subscribe, messages: () => messages, status: () => status };
  });
  const messages = useSyncExternalStore(store.subscribe, store.messages);
  const status = useSyncExternalStore(store.subscribe, store.status);
  return {
    messages,
    status,
    sendMessage: store.chat.sendMessage,
    addToolApprovalResponse: store.chat.addToolApprovalResponse,
  };
}

/** The page, as the docs show it. */
function Page({ fetch }: { fetch: typeof globalThis.fetch }) {
  const policy = useApprovalPolicy();
  const { getRules } = policy;
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', fetch, body: () => ({ rules: getRules() }) }),
    [getRules, fetch],
  );
  const { messages, status, sendMessage, addToolApprovalResponse } = useTestChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  return (
    <>
      <button type="button" onClick={() => void sendMessage({ text: 'Run the tests' })}>
        Send
      </button>
      <p>{status}</p>
      {messages
        .filter((m) => m.role === 'assistant')
        .map((m) => (
          <AgentMessage key={m.id} message={m} approvalPolicy={policy} onToolApproval={addToolApprovalResponse} />
        ))}
    </>
  );
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that runs `npm test`, then `npm test -- --watch`, then says it is done. */
function model() {
  const commands = ['npm test', 'npm test -- --watch'];
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const command = commands[calls++];
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            if (command)
              c.enqueue({
                type: 'tool-call',
                toolCallId: `c${calls}`,
                toolName: 'run_command',
                input: JSON.stringify({ command }),
              });
            else {
              c.enqueue({ type: 'text-start', id: 't' });
              c.enqueue({ type: 'text-delta', id: 't', delta: 'Done.' });
              c.enqueue({ type: 'text-end', id: 't' });
            }
            c.enqueue({
              type: 'finish',
              finishReason: { unified: command ? 'tool-calls' : 'stop', raw: undefined },
              usage,
            });
            c.close();
          },
        }),
      };
    },
  });
}

/** The route, as the docs show it, behind a `fetch` that also keeps each request's body. */
function server() {
  const llm = model();
  const ran: string[] = [];
  const bodies: Array<{ messages: UIMessage[]; rules: unknown }> = [];
  const tools = {
    run_command: tool({
      inputSchema: jsonSchema<{ command: string }>({
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      }),
      execute: async ({ command }) => {
        ran.push(command);
        return { exitCode: 0 };
      },
    }),
  };
  async function POST(req: Request) {
    const body = (await req.json()) as { messages: UIMessage[]; rules?: unknown };
    bodies.push({ messages: body.messages, rules: body.rules });
    const result = streamText({
      model: llm,
      messages: await convertToModelMessages(body.messages, { tools }),
      tools,
      toolApproval: toToolApproval(parseApprovalRules(body.rules)),
      stopWhen: stepCountIs(5),
    });
    return result.toUIMessageStreamResponse({ originalMessages: body.messages });
  }
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    POST(new Request(new URL(String(input), 'http://localhost'), init))) as typeof globalThis.fetch;
  return { fetch, ran, bodies };
}

// toolApproval and the V4 mock models are AI SDK 7.
describe.skipIf(AI_SDK_MAJOR < 7)('a person’s rules with each request', () => {
  it('sends a session rule with the request that carries its approval, and the route decides with it', async () => {
    const user = userEvent.setup();
    const { fetch, ran, bodies } = server();
    render(<Page fetch={fetch} />);

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const forSession = await screen.findByRole('button', { name: /^For this session/ });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.rules).toEqual([]);
    expect(ran).toEqual([]);

    await user.click(forSession);
    await screen.findByText('Done.');
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());

    // One request after the click: it carries the approval, and the rule the same click made.
    expect(bodies).toHaveLength(2);
    const [carried] = bodies[1]!.messages.at(-1)!.parts.filter((p) => 'approval' in p);
    expect(carried).toMatchObject({ toolCallId: 'c1', state: 'approval-responded', approval: { approved: true } });
    expect(bodies[1]!.rules).toEqual([
      {
        id: expect.any(String),
        tool: 'run_command',
        args: { command: 'npm test*' },
        effect: 'allow',
        scope: 'session',
        createdAt: expect.any(Number),
      },
    ]);

    // The route approved the next call with that rule, without asking anyone.
    expect(ran).toEqual(['npm test', 'npm test -- --watch']);
    expect(screen.queryByRole('button', { name: /^For this session/ })).toBeNull();
  });
});
