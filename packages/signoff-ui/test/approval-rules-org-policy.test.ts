// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ai from 'ai';
import { jsonSchema, readUIMessageStream, streamText, tool, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as core from '../src/core';
import type { ApprovalRule } from '../src/lib/policy';
import { AI_SDK_MAJOR } from './utils';

/*
 * The useApprovalPolicy page's recipe for an organization's policy with a person's rules on top:
 * `@ai-sdk/policy-opa`'s `opaPolicy` first, and the person's rules for the calls it has no rule
 * for. `opaPolicy` answers in the object form, `{ type: 'not-applicable' }`, which the SDK reads as
 * "run it": compared as a string, as the page's server rules are, it would let every call the
 * policy doesn't cover run with no one asked. The snippet runs here as the page shows it, against
 * a stand-in for `opaPolicy` that answers as its source does (normalizeOpaDecision, and a denial
 * when the policy can't be evaluated), on a scripted model.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const page = readFileSync(join(root, 'examples/playground/content/components/use-approval-policy.md'), 'utf8');

/** A `###` section of the page, from its heading to the next heading. */
function section(heading: string) {
  const start = page.indexOf(`\n### ${heading}\n`);
  expect(start, `a "### ${heading}" section`).toBeGreaterThan(-1);
  const end = page.indexOf('\n### ', start + 1);
  return page.slice(start, end === -1 ? undefined : end);
}

const recipe = () => section("Your organization's policy first");

/** The first ```ts block of a stretch of text. */
function snippet(text: string) {
  const code = /```ts\n([\s\S]*?)```/.exec(text)?.[1];
  expect(code, 'a ```ts block').toBeDefined();
  return code!;
}

type Decision = { decision: string; reason?: string } | null | undefined;
/** What a compiled policy gives for an input, standing in for the WASM module. */
type Policy = (input: { tool: { name: string }; args: unknown }) => Decision;

/** `normalizeOpaDecision` from @ai-sdk/policy-opa: the object form of the SDK's approval status. */
function normalize(result: Decision) {
  if (result == null) return { type: 'not-applicable' as const };
  const reason = typeof result.reason === 'string' ? result.reason : undefined;
  const type = { allow: 'approved', deny: 'denied', 'requires-approval': 'user-approval' }[result.decision];
  if (result.decision === 'not-applicable') return { type: 'not-applicable' as const };
  if (!type) return { type: 'denied' as const, reason: 'unrecognized OPA policy decision' };
  return reason ? { type, reason } : { type };
}

/** @ai-sdk/policy-opa's `wasmPolicyClient` and `opaPolicy`, as they answer, with `wasm` a Policy. */
const policyOpa = {
  wasmPolicyClient: async ({ wasm }: { wasm: Policy }) => ({
    evaluate: async (_path: string, input: Parameters<Policy>[0]) => wasm(input),
  }),
  opaPolicy:
    ({ client }: { client: { evaluate: (path: string, input: Parameters<Policy>[0]) => Promise<Decision> } }) =>
    async ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
      let result: Decision;
      try {
        result = await client.evaluate('agent/call/decision', {
          tool: { name: toolCall.toolName },
          args: toolCall.input,
        });
      } catch (error) {
        // Fail closed: a backend error is a denial, not "no opinion".
        return { type: 'denied', reason: `policy evaluation failed: ${(error as Error).message}` };
      }
      return normalize(result);
    },
};

/** The organization's policy, as the policy-opa README writes it in Rego. */
const ORG: Policy = ({ tool, args }) => {
  const command = (args as { command?: string }).command ?? '';
  if (tool.name === 'run_command' && command.startsWith('git push'))
    return { decision: 'deny', reason: 'pushes require human review' };
  if (tool.name === 'run_command' && command.startsWith('kubectl'))
    return { decision: 'requires-approval', reason: 'kubectl by oncall' };
  if (tool.name === 'read_file') return { decision: 'allow' };
  return { decision: 'not-applicable' };
};

const object = <T>() => jsonSchema<T>({ type: 'object' });
const tools = {
  read_file: tool({ inputSchema: object<{ path: string }>(), execute: async ({ path }) => ({ path, content: 'a\n' }) }),
  // No execute: the page answers it with a DiffReview.
  review_changes: tool({ inputSchema: object<{ files: unknown[] }>() }),
  run_command: tool({
    inputSchema: object<{ command: string }>(),
    execute: async ({ command }) => ({ exitCode: 0, stdout: command }),
  }),
};

type ToolApproval = NonNullable<Parameters<typeof streamText<typeof tools>>[0]['toolApproval']>;

/**
 * Runs the snippet as the page shows it, TypeScript stripped, and returns the `toolApproval` it
 * gives `streamText`. What it leaves to the reader (`wasm`, `rules`) is supplied here.
 */
async function toolApprovalOf(code: string, rules: ApprovalRule[], wasm: Policy = ORG) {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let given: { toolApproval?: ToolApproval } | undefined;
  const capture = (options: { toolApproval?: ToolApproval }) => {
    given = options;
  };
  const modules: Record<string, unknown> = { ai: { ...ai, streamText: capture }, '@ai-sdk/policy-opa': policyOpa };
  const scope: Record<string, unknown> = {
    require: (name: string) => modules[name],
    exports: {},
    streamText: capture,
    toToolApproval: core.toToolApproval,
    parseApprovalRules: core.parseApprovalRules,
    rules,
    wasm,
  };
  // The snippet awaits the policy client at the top, as a module can.
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  await new AsyncFunction(...Object.keys(scope), js)(...Object.values(scope));
  expect(given?.toolApproval, 'the snippet passes streamText a toolApproval').toBeTypeOf('function');
  return given!.toolApproval!;
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that makes these calls in one step. */
function model(calls: Array<[id: string, tool: keyof typeof tools, input: unknown]>) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] });
          for (const [toolCallId, toolName, input] of calls)
            c.enqueue({ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) });
          c.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage });
          c.close();
        },
      }),
    }),
  });
}

type Part = {
  type: string;
  toolCallId: string;
  state?: string;
  approval?: { approved?: boolean; reason?: string; requestReason?: string; isAutomatic?: boolean };
};

/** The first request of a run, read as useChat reads the stream: its tool parts by call id. */
async function first(toolApproval: ToolApproval, calls: Parameters<typeof model>[0]) {
  const stream = streamText({ model: model(calls), prompt: 'Ship it', tools, toolApproval }).toUIMessageStream({
    onError: (error) => String(error),
  });
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) last = message;
  return Object.fromEntries(
    (last?.parts ?? []).filter((p) => p.type.startsWith('tool-')).map((p) => [(p as Part).toolCallId, p as Part]),
  );
}

const allowAll: ApprovalRule = { id: 'all', tool: '*', effect: 'allow', scope: 'always' };
const denyAll: ApprovalRule = { id: 'none', tool: '*', effect: 'deny', scope: 'always' };
const npmTest: Parameters<typeof model>[0][number] = ['test', 'run_command', { command: 'npm test' }];

// toolApproval and the V4 mock models are AI SDK 7.
describe.skipIf(AI_SDK_MAJOR < 7)("useApprovalPolicy, the organization's policy, then the person's rules", () => {
  it("leaves a call the policy has no rule for to the person's rules", async () => {
    const asked = await first(await toolApprovalOf(snippet(recipe()), []), [npmTest]);
    expect(asked.test).toMatchObject({ state: 'approval-requested' });
    const allowed = await first(await toolApprovalOf(snippet(recipe()), [allowAll]), [npmTest]);
    expect(allowed.test).toMatchObject({ state: 'output-available', approval: { approved: true, isAutomatic: true } });
    expect(allowed.test!.approval!.reason).toMatch(/^Allowed by a rule: /);
    const denied = await first(await toolApprovalOf(snippet(recipe()), [denyAll]), [npmTest]);
    expect(denied.test).toMatchObject({ state: 'output-denied', approval: { approved: false, isAutomatic: true } });
  });

  it("keeps the policy's denials and approvals, whatever the person's rules say", async () => {
    const calls: Parameters<typeof model>[0] = [
      ['push', 'run_command', { command: 'git push origin main' }],
      ['read', 'read_file', { path: 'app/page.tsx' }],
    ];
    const allowed = await first(await toolApprovalOf(snippet(recipe()), [allowAll]), calls);
    expect(allowed.push).toMatchObject({
      state: 'output-denied',
      approval: { approved: false, isAutomatic: true, reason: 'pushes require human review' },
    });
    const denied = await first(await toolApprovalOf(snippet(recipe()), [denyAll]), calls);
    expect(denied.read).toMatchObject({ state: 'output-available', approval: { approved: true, isAutomatic: true } });
  });

  it('sends a call the policy requires a person for to a card, with its reason, whatever the rules say', async () => {
    const parts = await first(await toolApprovalOf(snippet(recipe()), [allowAll]), [
      ['kube', 'run_command', { command: 'kubectl rollout restart deploy/web' }],
    ]);
    expect(parts.kube).toMatchObject({ state: 'approval-requested', approval: { requestReason: 'kubectl by oncall' } });
  });

  it("denies when the policy can't be evaluated, so the person's rules don't stand in for it", async () => {
    const down: Policy = () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8181');
    };
    const parts = await first(await toolApprovalOf(snippet(recipe()), [allowAll], down), [npmTest]);
    expect(parts.test).toMatchObject({ state: 'output-denied', approval: { approved: false } });
    expect(parts.test!.approval!.reason).toMatch(/^policy evaluation failed: /);
  });

  it('never gates review_changes, which the page answers', async () => {
    for (const rules of [[], [allowAll], [denyAll]]) {
      const parts = await first(await toolApprovalOf(snippet(recipe()), rules), [
        ['review', 'review_changes', { files: [] }],
      ]);
      expect(parts.review).toMatchObject({ state: 'input-available' });
      expect(parts.review!.approval).toBeUndefined();
    }
  });

  it("would run uncovered calls with no one asked if it compared the status as the server rules' snippet does", async () => {
    const text = recipe();
    expect(text).toContain("Compare the `type`, not the status: `decided === 'not-applicable'`");
    // The same snippet, comparing the status itself.
    const naive = snippet(text).replace(
      /const type = [^\n]*\n\s*return type === undefined \|\| type === 'not-applicable' \? yours\(options\) : decided;/,
      "return decided === 'not-applicable' ? yours(options) : decided;",
    );
    expect(naive).not.toBe(snippet(text));
    const parts = await first(await toolApprovalOf(naive, []), [npmTest]);
    // No card, no rule: it ran.
    expect(parts.test).toMatchObject({ state: 'output-available' });
    expect(parts.test!.approval).toBeUndefined();
  });
});
