import { EventType, type Event as AgUiCoreEvent, type Message } from '@ag-ui/core';
import { render, screen } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { createAgUiRun, fromAgUiMessages, reduceAgUiRun } from '../src/ag-ui';
import { AgentMessage } from '../src/agent-message';
import { deriveAgentState, type SubagentPart } from '../src/lib/ai';
import { RunMeter } from '../src/run-meter';
import { assistant, toolPart } from './utils';

/*
 * What a run reads as once a person has answered it, or when it ended with a sub-agent still
 * working, and the meter's total beside its time to first token. test/walkthrough-run.test.tsx
 * drives the same through the walkthrough's app.
 */

const REVIEW = { toolName: 'review_changes', toolCallId: 'call_review' };
const ready = (parts: unknown[], options: { pendingClientTools?: string[]; clientTools?: string[] } = {}) =>
  deriveAgentState({ status: 'ready', message: assistant(parts as UIMessage['parts']), ...options });

describe('deriveAgentState, when a client-side tool has its output', () => {
  // `ready` with every call answered reads done: whether a next request follows is the app's to know.
  // Read as thinking until then, it would stay thinking when none comes: without sendAutomaticallyWhen,
  // after stop() or a failed request, in restored history, after a continuation with no step-start.
  it('reads done, not thinking, once the output is in', () => {
    const proposed = [{ type: 'step-start' }, { type: 'text', text: 'Here is the change.', state: 'done' }];
    const reviewed = [...proposed, toolPart('output-available', REVIEW)];
    expect(ready(reviewed, { pendingClientTools: ['review_changes'] })).toEqual({ state: 'done' });
    const failed = [...proposed, toolPart('output-error', REVIEW)];
    expect(ready(failed, { pendingClientTools: ['review_changes'] })).toEqual({ state: 'done' });
    const located = [{ type: 'step-start' }, toolPart('output-available', { toolName: 'get_location' })];
    expect(ready(located, { clientTools: ['get_location'] })).toEqual({ state: 'done' });
    // A continuation streamed without a start-step chunk, finished.
    const answered = [...reviewed, { type: 'text', text: 'Applied. Anything else?', state: 'done' }];
    expect(ready(answered, { pendingClientTools: ['review_changes'] })).toEqual({ state: 'done' });
  });
});

describe('deriveAgentState, when the run ended with a sub-agent still running', () => {
  const researcher = (status: SubagentPart['data']['status']): SubagentPart => ({
    type: 'data-signoff-subagent',
    id: 'sa1',
    data: {
      subagentRunId: 'sa1',
      name: 'researcher',
      status,
      parts: [{ type: 'text', text: 'Found two sources.', state: 'done' }],
    },
  });

  it('reads stopped, as the timeline shows the sub-agent, not done', () => {
    // Between its steps: every part of it settled, its status still running.
    expect(ready([researcher('running')])).toEqual({ state: 'stopped' });
    expect(ready([{ type: 'text', text: 'Delegating.', state: 'done' }, researcher('running')])).toEqual({
      state: 'stopped',
    });
    for (const status of ['done', 'error', 'suspended'] as const)
      expect(ready([researcher(status)])).toEqual({ state: 'done' });
  });

  it('reads stopped through the AG-UI adapter, for a run cancelled while a sub-agent with no parent call worked', () => {
    const run = [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r1' },
      { type: EventType.SUBAGENT_STARTED, subagentRunId: 'sa1', name: 'researcher' },
      { type: EventType.TOOL_CALL_START, toolCallId: 'stc1', toolCallName: 'web_search', subagentRunId: 'sa1' },
      { type: EventType.TOOL_CALL_END, toolCallId: 'stc1', subagentRunId: 'sa1' },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'str1', toolCallId: 'stc1', content: '[]', subagentRunId: 'sa1' },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'r1', outcome: { type: 'cancelled' } },
    ] as AgUiCoreEvent[];
    const state = run.reduce(reduceAgUiRun, createAgUiRun());
    const fn = { id: 'stc1', type: 'function' as const, function: { name: 'web_search', arguments: '{}' } };
    const messages = [
      { id: 'u1', role: 'user', content: 'Research rate limits' },
      { id: 'm1', role: 'assistant', content: 'Asking the researcher.' },
      { id: 's1', role: 'assistant', subagentRunId: 'sa1', toolCalls: [fn] },
      { id: 'str1', role: 'tool', toolCallId: 'stc1', content: '[]', subagentRunId: 'sa1' },
    ] as Message[];
    const reply = fromAgUiMessages(messages, state).at(-1)!;
    expect(reply.parts.at(-1)).toMatchObject({ type: 'data-signoff-subagent', data: { status: 'running' } });
    expect(deriveAgentState({ status: state.status, message: reply })).toEqual({ state: 'stopped' });
  });
});

describe('RunMeter', () => {
  it('never reads a total under the time to first token', () => {
    // useRunTiming's total ticks every 100 ms; the first token is timed exactly.
    const { container, rerender } = render(<RunMeter ttftMs={442} durationMs={405} live />);
    expect(container.querySelector('.sr-only')).toHaveTextContent('time to first token 442ms, total 442ms');
    expect(screen.getByTitle('Total time')).toHaveTextContent('442ms');
    rerender(<RunMeter variant="expanded" ttftMs={442} durationMs={405} live />);
    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent('442ms');
    // Past it, the total is the total.
    rerender(<RunMeter ttftMs={442} durationMs={2_150} />);
    expect(container.querySelector('.sr-only')).toHaveTextContent('time to first token 442ms, total 2.15s');
  });
});

describe('AgentMessage', () => {
  it('passes pendingClientTools to its timeline: a review the person took 3.2s over shows no duration', () => {
    const message = assistant([toolPart('output-available', REVIEW)]);
    const timings = { call_review: { startedAt: 1_000, runningAt: 1_100, endedAt: 4_300 } };
    const { rerender } = render(<AgentMessage message={message} timings={timings} />);
    expect(screen.getByRole('button', { name: /Review changes/ })).toHaveTextContent('3.20s');
    rerender(<AgentMessage message={message} timings={timings} pendingClientTools={['review_changes']} />);
    expect(screen.getByRole('button', { name: /Review changes/ })).not.toHaveTextContent(/\d+ms|\d\.\d+s/);
  });
});
