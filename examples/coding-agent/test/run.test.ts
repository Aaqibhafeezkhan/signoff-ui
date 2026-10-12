import { Chat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModel,
} from 'ai';
import {
  computeReviewResult,
  getToolParts,
  parseFileChange,
  reviewToolOutput,
  type ApprovalRule,
  type DiffReviewComment,
  type DiffHunk,
  type HunkDecision,
} from 'signoff-ui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/agent/route';
import { INSTRUCTIONS } from '../lib/model';
import { DEFAULT_RULES } from '../lib/rules';
import type { CommandResult } from '../lib/shell';
import type { ProposedFiles } from '../lib/tools';
import type { Mode, RunMessage } from '../lib/types';
import { filesFromMessages } from '../lib/workspace';
import { TASK } from '../lib/project';

/*
 * The whole run, headless: AI SDK's own Chat (what useChat wraps) against the route, with the
 * page's sendAutomaticallyWhen. The tests play the person: approve, review, comment. No waiting
 * (lib/pace is stubbed), and no network: the live model is a stub.
 */

vi.mock('../lib/pace', () => ({ pause: () => Promise.resolve() }));
const openai = vi.hoisted(() => vi.fn());
vi.mock('@ai-sdk/openai', () => ({ openai }));

afterEach(() => {
  vi.unstubAllEnvs();
  openai.mockReset();
});

function startRun(rules: ApprovalRule[], mode: Mode = 'scripted') {
  return new Chat<RunMessage>({
    transport: new DefaultChatTransport<RunMessage>({
      api: 'http://localhost/api/agent',
      // Read at send time, as the page does: a rule added a moment ago goes with the next request.
      body: () => ({ mode, rules }),
      fetch: (input, init) => POST(new Request(input, init)),
    }),
    sendAutomaticallyWhen: (chat) =>
      lastAssistantMessageIsCompleteWithToolCalls(chat) || lastAssistantMessageIsCompleteWithApprovalResponses(chat),
  });
}

/** Until the chat is idle: no request in flight, and none about to start. */
async function settle(chat: Chat<RunMessage>) {
  let idle = 0;
  for (let i = 0; i < 2000 && idle < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    idle = chat.status === 'ready' || chat.status === 'error' ? idle + 1 : 0;
  }
  if (chat.error) throw chat.error;
  if (idle < 3) throw new Error('The run did not settle');
}

const parts = (chat: Chat<RunMessage>) => getToolParts(chat.messages.at(-1)?.parts ?? []);
const call = (chat: Chat<RunMessage>, id: string) => {
  const part = parts(chat).find((p) => p.toolCallId === id);
  if (!part) throw new Error(`No call ${id}: ${parts(chat).map((p) => p.toolCallId)}`);
  return part;
};
const lastText = (chat: Chat<RunMessage>) =>
  chat.messages
    .at(-1)
    ?.parts.filter((p) => p.type === 'text')
    .at(-1)?.text ?? '';

/** Review a proposal as DiffReview would send it: every hunk accepted unless `reject` says no. */
function review(
  chat: Chat<RunMessage>,
  toolCallId: string,
  {
    reject = () => false,
    comment,
  }: {
    reject?: (path: string, hunk: DiffHunk) => boolean;
    comment?: { path: string; line: number; text: string };
  } = {},
) {
  const before = filesFromMessages(chat.messages, toolCallId);
  const { files } = call(chat, toolCallId).input as ProposedFiles;
  const parsed = files.map((f) => parseFileChange({ path: f.path, oldContent: before[f.path], newContent: f.content }));
  const decisions: Record<string, HunkDecision> = {};
  for (const file of parsed)
    for (const hunk of file.hunks) decisions[hunk.id] = reject(file.path, hunk) ? 'rejected' : 'accepted';
  const comments: DiffReviewComment[] = [];
  if (comment) {
    const hunk = parsed
      .find((f) => f.path === comment.path)
      ?.hunks.find((h) => h.lines.some((l) => l.newNumber === comment.line));
    comments.push({
      id: 'c1',
      fileId: comment.path,
      path: comment.path,
      target: 'lines',
      hunkId: hunk?.id,
      side: 'new',
      startLine: comment.line,
      endLine: comment.line,
      text: comment.text,
    });
  }
  const output = reviewToolOutput(computeReviewResult(parsed, decisions, { comments }));
  return chat.addToolOutput({ tool: 'review_changes', toolCallId, output });
}

describe('the scripted run', () => {
  it('asks only where no rule decides, revises after a comment, and stops at the server rule', async () => {
    const rules: ApprovalRule[] = [...DEFAULT_RULES];
    const chat = startRun(rules);
    await chat.sendMessage({ text: TASK });
    await settle(chat);

    // Reads: allowed by the default rules on the server, nobody asked. The tests: a person decides.
    for (const id of ['r1-list', 'r1-read-src', 'r1-read-test']) {
      const part = call(chat, id);
      expect(part.state).toBe('output-available');
      expect(part.approval).toMatchObject({ approved: true, isAutomatic: true });
    }
    const test1 = call(chat, 'r1-test-1');
    expect(test1.state).toBe('approval-requested');
    expect(test1.input).toEqual({ command: 'npm test' });

    // "For this session", as the card records it: the rule goes with the next requests.
    rules.push({
      id: 'session',
      tool: 'run_command',
      args: { command: 'npm test*' },
      effect: 'allow',
      scope: 'session',
    });
    await chat.addToolApprovalResponse({ id: test1.approval!.id, approved: true });
    await settle(chat);
    expect((call(chat, 'r1-test-1').output as CommandResult).output).toContain('ℹ pass 4');

    const proposal = call(chat, 'r1-review-1');
    expect(proposal.state).toBe('input-available');
    expect((proposal.input as ProposedFiles).files.map((f) => f.path)).toEqual([
      'src/slugify.ts',
      'test/slugify.test.ts',
      'README.md',
    ]);

    await review(chat, 'r1-review-1', {
      reject: (path) => path === 'README.md',
      comment: { path: 'src/slugify.ts', line: 19, text: 'Spell out ß as ss too.' },
    });
    await settle(chat);
    expect(lastText(chat)).toContain('“Spell out ß as ss too.” on `src/slugify.ts`, line 19');
    expect(lastText(chat)).toContain('You left out the change to `README.md`');
    const revision = call(chat, 'r1-review-2');
    expect((revision.input as ProposedFiles).files.map((f) => f.path)).toEqual([
      'src/slugify.ts',
      'test/slugify.test.ts',
    ]);

    await review(chat, 'r1-review-2');
    await settle(chat);

    // The session rule runs the tests, the default rule commits, the server's rule blocks the push.
    const test2 = call(chat, 'r1-test-2');
    expect(test2.approval).toMatchObject({ approved: true, isAutomatic: true });
    expect((test2.output as CommandResult).output).toContain('ℹ pass 6');
    expect(call(chat, 'r1-commit').approval).toMatchObject({ approved: true, isAutomatic: true });
    const push = call(chat, 'r1-push');
    expect(push.state).toBe('output-denied');
    expect(push.approval).toMatchObject({ approved: false, isAutomatic: true });
    expect(push.approval?.reason).toContain('git push*');

    const answer = lastText(chat);
    expect(answer).toContain("`slugify('Crème brûlée')` now returns `creme-brulee`");
    expect(answer).toContain("`slugify('Straße')` returns `strasse`");
    expect(answer).toContain('A rule on the server blocks `git push`');
    expect(answer).not.toContain('README.md');

    const files = filesFromMessages(chat.messages);
    expect(files['src/slugify.ts']).toContain("ß: 'ss'");
    expect(files['README.md']).not.toContain('Crème');

    // One run across five requests: the usage adds up, it doesn't restart.
    const usage = chat.messages.at(-1)?.metadata?.usage;
    expect(usage?.inputTokens).toBeGreaterThan(5_000);
    expect(usage?.inputTokenDetails?.cacheReadTokens).toBeGreaterThan(0);
    expect(chat.messages.at(-1)?.metadata?.model).toBe('scripted-agent');
  });

  it('asks again without a rule, and stops at failing tests when the fix is left out', async () => {
    const chat = startRun([...DEFAULT_RULES]);
    await chat.sendMessage({ text: TASK });
    await settle(chat);
    await chat.addToolApprovalResponse({
      id: call(chat, 'r1-test-1').approval!.id,
      approved: false,
      reason: 'Not now',
    });
    await settle(chat);
    expect(call(chat, 'r1-test-1').state).toBe('output-denied');
    expect(lastText(chat)).toContain('Understood, no tests for now.');

    // Keep the new test, leave out the fix it tests.
    await review(chat, 'r1-review-1', { reject: (path) => path === 'src/slugify.ts' });
    await settle(chat);
    const test2 = call(chat, 'r1-test-2');
    expect(test2.state).toBe('approval-requested');
    await chat.addToolApprovalResponse({ id: test2.approval!.id, approved: true });
    await settle(chat);

    expect((call(chat, 'r1-test-2').output as CommandResult).exitCode).toBe(1);
    expect(lastText(chat)).toContain('1 of 5 tests fail');
    expect(lastText(chat)).toContain("I won't commit a failing build");
    expect(parts(chat).some((p) => p.toolCallId === 'r1-commit')).toBe(false);
  });

  it('stops when nothing is applied', async () => {
    const chat = startRun([...DEFAULT_RULES, { id: 't', tool: 'run_command', effect: 'allow', scope: 'session' }]);
    await chat.sendMessage({ text: TASK });
    await settle(chat);
    await review(chat, 'r1-review-1', { reject: () => true });
    await settle(chat);
    expect(lastText(chat)).toBe('Nothing was applied, so the files are as they were. Start a new run to try again.');
  });

  it('lets a person decide the reads once their rule is gone', async () => {
    const chat = startRun([]);
    await chat.sendMessage({ text: TASK });
    await settle(chat);
    const list = call(chat, 'r1-list');
    expect(list.state).toBe('approval-requested');
    expect(list.approval).not.toHaveProperty('isAutomatic', true);
  });

  it('leaves out a rule from the page with more wildcards than parseApprovalRules allows', async () => {
    // It would allow list_files if the route kept it; past the limit, matching can hold up the server.
    const chat = startRun([{ id: 'many', tool: '*l*i*s*', effect: 'allow', scope: 'session' }]);
    await chat.sendMessage({ text: TASK });
    await settle(chat);
    const list = call(chat, 'r1-list');
    expect(list.state).toBe('approval-requested');
    expect(list.approval).not.toHaveProperty('isAutomatic', true);
  });
});

describe('live mode', () => {
  /** A model that answers in one line and records what it was called with. */
  function stubModel() {
    const calls: unknown[] = [];
    const model: Extract<LanguageModel, { specificationVersion: 'v4' }> = {
      specificationVersion: 'v4',
      provider: 'stub',
      modelId: 'stub',
      supportedUrls: {},
      doGenerate: () => Promise.reject(new Error('not used')),
      doStream: async (options) => {
        calls.push(options);
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'text-start', id: 't' });
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'Looking.' });
              controller.enqueue({ type: 'text-end', id: 't' });
              controller.enqueue({
                type: 'finish',
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: undefined },
                  outputTokens: { total: 2, text: 2, reasoning: undefined },
                },
                finishReason: { unified: 'stop', raw: undefined },
              });
              controller.close();
            },
          }),
        };
      },
    };
    return { model, calls };
  }

  const userMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: TASK }] };
  const post = (mode: Mode | undefined) =>
    POST(
      new Request('http://localhost/api/agent', {
        method: 'POST',
        body: JSON.stringify({ mode, rules: DEFAULT_RULES, messages: [userMessage] }),
      }),
    );

  it('plays the scripted agent unless the request asks for live, even with a key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    for (const mode of [undefined, 'scripted'] as const) {
      const response = await post(mode);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"model":"scripted-agent"');
    }
    expect(openai).not.toHaveBeenCalled();
  });

  it('runs the model OPENAI_MODEL names, with the instructions and the same tools', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_MODEL', 'gpt-test');
    const { model, calls } = stubModel();
    openai.mockReturnValue(model);

    const response = await post('live');
    const body = await response.text();

    expect(openai).toHaveBeenCalledWith('gpt-test');
    expect(body).toContain('Looking.');
    expect(body).toContain('"model":"gpt-test"');
    const options = calls[0] as { prompt: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string }> };
    expect(options.prompt[0]).toEqual({ role: 'system', content: INSTRUCTIONS });
    expect(options.tools?.map((t) => t.name).sort()).toEqual([
      'list_files',
      'read_file',
      'review_changes',
      'run_command',
    ]);
  });

  it('refuses live mode without a key, and never builds the model', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await post('live');
    expect(response.status).toBe(501);
    expect(openai).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a run', async () => {
    const response = await POST(new Request('http://localhost/api/agent', { method: 'POST', body: '{"rules":7}' }));
    expect(response.status).toBe(400);
  });
});
