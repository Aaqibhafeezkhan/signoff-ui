import { EventType, type Event as AgUiCoreEvent, type Message } from '@ag-ui/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerAgUiInterrupt, createAgUiRun, fromAgUiMessages, reduceAgUiRun } from '../src/ag-ui';
import { getToolParts, type AnyUIPart, type ToolPart } from '../src/lib/ai';
import { ToolCallTimeline } from '../src/tool-call-timeline';
import { toolPart } from './utils';

// The duration a timeline measures for an approved call is its run, not the time a person spent
// on the approval card, also when the call was shown as running before the request came.
describe('ToolCallTimeline durations around an approval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves out the wait when the call renders input-available before the request (AI SDK 6)', () => {
    const call = (state: ToolPart['state']) => toolPart(state, { toolCallId: 'c1', toolName: 'run_command' });
    const { rerender } = render(<ToolCallTimeline parts={[call('input-available')]} />);
    act(() => vi.advanceTimersByTime(10));
    rerender(<ToolCallTimeline parts={[call('approval-requested')]} />);
    act(() => vi.advanceTimersByTime(4_000));
    rerender(<ToolCallTimeline parts={[call('approval-responded')]} />);
    act(() => vi.advanceTimersByTime(17));
    rerender(<ToolCallTimeline parts={[call('output-available')]} />);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toHaveTextContent(/^Run command finished in 17 milliseconds$/);
    expect(screen.getByRole('button', { name: /Run command/ })).toHaveTextContent('17ms');
  });

  it('leaves out the wait on an AG-UI interrupt', () => {
    const fold = (events: readonly AgUiCoreEvent[], run = createAgUiRun()) => events.reduce(reduceAgUiRun, run);
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'deploy', arguments: '{"env":"prod"}' } }],
      },
    ];
    let run = fold([
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r1' },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'deploy', parentMessageId: 'a1' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"env":"prod"}' },
      { type: EventType.TOOL_CALL_END, toolCallId: 'tc1' },
    ]);
    const parts = (): AnyUIPart[] => fromAgUiMessages(messages, run).find((m) => m.id === 'a1')!.parts;
    const state = () => getToolParts(parts())[0]!.state;

    expect(state()).toBe('input-available');
    const { rerender } = render(<ToolCallTimeline parts={parts()} />);
    act(() => vi.advanceTimersByTime(650));
    run = fold(
      [
        {
          type: EventType.RUN_FINISHED,
          threadId: 't',
          runId: 'r1',
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'int1', reason: 'tool_call', toolCallId: 'tc1', message: 'Deploy to prod?' }],
          },
        } as AgUiCoreEvent,
      ],
      run,
    );
    expect(state()).toBe('approval-requested');
    rerender(<ToolCallTimeline parts={parts()} />);
    act(() => vi.advanceTimersByTime(8_000));
    run = answerAgUiInterrupt(run, { id: 'int1', approved: true });
    expect(state()).toBe('approval-responded');
    rerender(<ToolCallTimeline parts={parts()} />);
    act(() => vi.advanceTimersByTime(200));
    run = fold([{ type: EventType.RUN_STARTED, threadId: 't', runId: 'r2' }], run);
    messages.push({ id: 't1', role: 'tool', toolCallId: 'tc1', content: 'deployed' });
    expect(state()).toBe('output-available');
    rerender(<ToolCallTimeline parts={parts()} />);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toHaveTextContent(/^Deploy finished in 200 milliseconds$/);
  });
});
