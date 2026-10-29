import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  convertToModelMessages,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type LanguageModelUsage,
  type UIMessage,
} from 'ai';
import type * as Ai from 'ai';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockModel } from '../../../examples/nextjs-minimal/lib/mock-model';
import { addUsage } from '../src/lib/usage';
import { AI_SDK_MAJOR } from './utils';

/*
 * The walkthrough in Getting started, run in the page: examples/nextjs-minimal's client (readme.test.ts
 * checks it is the walkthrough's), its scripted model, and a route with its tools. A person reviews the
 * proposed edit, approves the command, then sends a second message. What the status pill, the timeline
 * and the meter say along the way is what a person reads.
 */

// The scripted model's text arrives word by word, 40 ms apart: a few ms keeps the run short.
vi.mock('ai', async (importOriginal) => {
  const ai = await importOriginal<typeof Ai>();
  const simulateReadableStream: typeof ai.simulateReadableStream = (options) =>
    ai.simulateReadableStream({ ...options, chunkDelayInMs: 2 });
  return { ...ai, simulateReadableStream };
});

// The example's `signoff-ui` is the built package, and its React and AI SDK 7 must be the suite's.
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const built = existsSync(join(root, 'packages/signoff-ui/dist/index.d.ts'));
const sameStack = built && AI_SDK_MAJOR >= 7 && Number(version.split('.')[0]) >= 19;

type Message = UIMessage<{ usage?: LanguageModelUsage }>;

// The walkthrough's tools, with the example's pretend repository.
const tools = {
  read_file: tool({
    inputSchema: jsonSchema<{ path: string }>({ type: 'object', properties: { path: { type: 'string' } } }),
    execute: async ({ path }) => {
      if (path !== 'app/api/chat/route.ts') throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return { path, content: 'export async function POST(req: Request) {}\n' };
    },
  }),
  review_changes: tool({ inputSchema: jsonSchema<{ files: unknown[] }>({ type: 'object' }) }),
  run_command: tool({
    inputSchema: jsonSchema<{ command: string }>({ type: 'object', properties: { command: { type: 'string' } } }),
    execute: async ({ command }) => ({ exitCode: 0, stdout: `(simulated) ${command}` }),
  }),
};

/** The walkthrough's route, with the example's scripted model. */
async function POST(request: Request) {
  const { messages }: { messages: Message[] } = await request.json();
  const result = streamText({
    model: createMockModel(),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    toolApproval: { run_command: { type: 'user-approval', reason: 'Runs a shell command in the repository.' } },
    stopWhen: stepCountIs(10),
  });
  const last = messages.at(-1);
  const previous = last?.role === 'assistant' ? last.metadata?.usage : undefined;
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    messageMetadata: ({ part }) =>
      part.type === 'finish' ? { usage: addUsage(previous, part.totalUsage) } : undefined,
  });
}

const pill = () => document.querySelector('[data-slot="signoff-agent-status"]')!;
const meter = () => document.querySelector('[data-slot="signoff-run-meter"] .sr-only')?.textContent ?? '';
/** "442ms" or "1.20s" (formatDuration) in ms. */
const ms = (text: string) => (text.endsWith('ms') ? Number(text.slice(0, -2)) : Number(text.slice(0, -1)) * 1000);

describe('the walkthrough, run in the page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.skipIf(!sameStack)(
    'reports the run, not the person: no review time as a call’s, each turn’s own usage',
    { timeout: 30_000 },
    async () => {
      vi.stubGlobal('fetch', (_url: string, init: RequestInit) => POST(new Request('http://localhost/api/chat', init)));
      const { AgentRun } = await import('../../../examples/nextjs-minimal/app/agent-run');
      const user = userEvent.setup();
      render(<AgentRun />);

      // Every meter reading.
      const readings: string[] = [];
      const observer = new MutationObserver(() => {
        if (readings.at(-1) !== meter()) readings.push(meter());
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });

      try {
        await user.type(screen.getByRole('textbox', { name: 'Message the agent' }), 'Add rate limiting');
        await user.click(screen.getByRole('button', { name: 'Send' }));
        const apply = await screen.findByRole('button', { name: /^Apply/ }, { timeout: 10_000 });
        // The pill names the tool as the timeline does.
        expect(pill()).toHaveTextContent('Waiting for approvalReview changes');
        await user.click(screen.getByRole('button', { name: /Accept all/ }));
        // The person takes a moment over the review.
        await new Promise((resolve) => setTimeout(resolve, 400));
        await user.click(apply);
        const approve = await screen.findByRole('button', { name: /^Approve/ }, { timeout: 10_000 });
        // Applying the review hands the run back to the model, which asks to run a command next.
        expect(pill()).toHaveAttribute('data-state', 'awaiting-approval');

        await user.click(approve);
        await waitFor(() => expect(pill()).toHaveAttribute('data-state', 'done'), { timeout: 10_000 });
        // The review's row: the time was the person's, so no duration. The other calls keep theirs.
        expect(screen.getByRole('button', { name: /^Review changes/ })).not.toHaveTextContent(/\d+ms|\d\.\d+s/);
        expect(screen.getByRole('button', { name: /^Run command/ })).toHaveTextContent(/\d+ms|\d\.\d+s/);
        expect(meter()).toMatch(/^21\.6k input tokens/);

        // A second message: until its reply starts, the meter shows no usage, not the first run's.
        await user.type(screen.getByRole('textbox', { name: 'Message the agent' }), 'Try it again');
        await user.click(screen.getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(pill()).toHaveAttribute('data-state', 'thinking'));
        expect(meter()).toMatch(/^– input tokens, – output tokens(,|$)/);
        await screen.findByRole('button', { name: /^Apply/ }, { timeout: 10_000 });
      } finally {
        observer.disconnect();
      }

      // The total includes the first token, so it never reads less.
      const late = readings.flatMap((text) => {
        const [, ttft, total] = /time to first token ([^,]+), total (.+)$/.exec(text) ?? [];
        return ttft && total && ms(total) < ms(ttft) ? [text] : [];
      });
      expect(late).toEqual([]);
      expect(readings.some((text) => text.includes('time to first token'))).toBe(true);
    },
  );
});
