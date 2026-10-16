import { EventType, type Event as AgUiCoreEvent, type Message } from '@ag-ui/core';
import { render, screen } from '@testing-library/react';
import type { ChatStatus, UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { createAgUiRun, fromAgUiMessages, reduceAgUiRun } from '../src/ag-ui';
import { AgentMessage } from '../src/agent-message';
import { deriveAgentState, type SubagentData, type SubagentPart, type SubagentStatus } from '../src/lib/ai';
import { ToolCallTimeline } from '../src/tool-call-timeline';
import { assistant, toolPart } from './utils';

const RUN = { toolName: 'run_command', toolCallId: 'call_run' };

describe('the status pill once a call has settled', () => {
  const streaming = (parts: UIMessage['parts']) => deriveAgentState({ status: 'streaming', message: assistant(parts) });

  it('reads Thinking while the model answers a denial, not Working on the denied call', () => {
    // A denial's continuation streams the denied output first, then waits for the model's first token.
    expect(streaming([toolPart('output-denied', RUN)])).toEqual({ state: 'thinking' });
    const denied = toolPart('approval-responded', { ...RUN, approval: { id: 'approval_run', approved: false } });
    expect(streaming([denied])).toEqual({ state: 'thinking' });
  });

  it('reads Thinking after a call finished or failed', () => {
    expect(streaming([toolPart('output-available', RUN)])).toEqual({ state: 'thinking' });
    expect(streaming([toolPart('output-error', RUN)])).toEqual({ state: 'thinking' });
    expect(streaming([{ type: 'step-start' }, toolPart('output-available', RUN)])).toEqual({ state: 'thinking' });
  });

  it('still reads Working while a call runs', () => {
    // An approved call the server is running, and partial output.
    expect(streaming([toolPart('approval-responded', RUN)])).toEqual({ state: 'working', detail: 'run_command' });
    expect(streaming([toolPart('output-available', { ...RUN, preliminary: true })])).toEqual({
      state: 'working',
      detail: 'run_command',
    });
    // Parallel calls settle in any order: one still running behind one that finished is the work.
    const parallel = [
      toolPart('input-available', { toolName: 'read_file', toolCallId: 'call_read' }),
      toolPart('output-available', { toolName: 'web_search', toolCallId: 'call_search' }),
    ];
    expect(streaming(parallel)).toEqual({ state: 'working', detail: 'read_file' });
    // Approved and denied together: the approved one runs while the denial is already in.
    expect(streaming([toolPart('approval-responded', RUN), toolPart('output-denied')])).toEqual({
      state: 'working',
      detail: 'run_command',
    });
  });

  it('only looks for a call still going in the step the model is on', () => {
    // The next step starts once every call of the one before has settled.
    const earlier = toolPart('input-available', { toolName: 'old_tool', toolCallId: 'call_old' });
    const parts = [{ type: 'step-start' }, earlier, { type: 'step-start' }, toolPart('output-available', RUN)];
    expect(streaming(parts as UIMessage['parts'])).toEqual({ state: 'thinking' });
  });
});

describe('the status pill once a sub-agent has finished', () => {
  const streaming = (parts: unknown[]) =>
    deriveAgentState({ status: 'streaming', message: assistant(parts as UIMessage['parts']) });
  const delegate = toolPart('output-available', { toolName: 'delegate', toolCallId: 'call_delegate' });
  const researcher = (status: SubagentStatus, parts: unknown[] = []): SubagentPart => ({
    type: 'data-signoff-subagent',
    id: 'sa1',
    data: {
      subagentRunId: 'sa1',
      parentToolCallId: 'call_delegate',
      name: 'researcher',
      status,
      parts: parts as SubagentData['parts'],
    },
  });
  const search = toolPart('output-available', { toolName: 'web_search', toolCallId: 'call_search' });

  it('reads Thinking when a finished sub-agent is the last part, after its call', () => {
    for (const status of ['done', 'error', 'suspended'] as const)
      expect(streaming([delegate, researcher(status, [search])])).toEqual({ state: 'thinking' });
    // And with a settled call after it.
    expect(streaming([delegate, researcher('done', [search]), toolPart('output-available', RUN)])).toEqual({
      state: 'thinking',
    });
  });

  it('reads Thinking through the AG-UI adapter while the parent model answers the sub-agent', () => {
    const fold = (events: readonly AgUiCoreEvent[]) => events.reduce(reduceAgUiRun, createAgUiRun());
    const run = fold([
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r1' },
      { type: EventType.SUBAGENT_STARTED, subagentRunId: 'sa1', name: 'researcher', parentToolCallId: 'tc1' },
      { type: EventType.TOOL_CALL_START, toolCallId: 'stc1', toolCallName: 'web_search', subagentRunId: 'sa1' },
      { type: EventType.TOOL_CALL_END, toolCallId: 'stc1', subagentRunId: 'sa1' },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'str1', toolCallId: 'stc1', content: '[]', subagentRunId: 'sa1' },
      { type: EventType.SUBAGENT_FINISHED, subagentRunId: 'sa1' },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'tr1', toolCallId: 'tc1', content: 'found 0' },
    ] as AgUiCoreEvent[]);
    const fn = (id: string, name: string) => ({ id, type: 'function' as const, function: { name, arguments: '{}' } });
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Research rate limits' },
      { id: 'm1', role: 'assistant', toolCalls: [fn('tc1', 'research')] },
      { id: 's1', role: 'assistant', subagentRunId: 'sa1', toolCalls: [fn('stc1', 'web_search')] },
      { id: 'str1', role: 'tool', toolCallId: 'stc1', content: '[]', subagentRunId: 'sa1' },
      { id: 'tr1', role: 'tool', toolCallId: 'tc1', content: 'found 0' },
    ] as Message[];
    const reply = fromAgUiMessages(messages, run).at(-1)!;
    expect(reply.parts.map((p) => [p.type, 'state' in p ? p.state : (p as SubagentPart).data.status])).toEqual([
      ['dynamic-tool', 'output-available'],
      ['data-signoff-subagent', 'done'],
    ]);
    expect(deriveAgentState({ status: 'streaming', message: reply })).toEqual({ state: 'thinking' });
  });

  it('names the call a running sub-agent is still on, not one it finished', () => {
    const read = toolPart('input-available', { toolName: 'read_page', toolCallId: 'call_read' });
    expect(streaming([delegate, researcher('running', [read, search])])).toEqual({
      state: 'working',
      detail: 'read_page',
    });
    // Behind a settled call of the parent's, too.
    expect(streaming([delegate, researcher('running', [read, search]), toolPart('output-available', RUN)])).toEqual({
      state: 'working',
      detail: 'read_page',
    });
    // Between its calls, the sub-agent itself is the work.
    expect(streaming([delegate, researcher('running', [search])])).toEqual({ state: 'working', detail: 'researcher' });
  });
});

describe('an approved call once the run has failed', () => {
  const call = () => screen.getByRole('button', { name: /Run command/ });

  it('reads "Stopped" when the request that would have run it failed', () => {
    // A 5xx or a network drop on the continuation: useChat's status is `error`, and the call never
    // gets its result.
    render(<AgentMessage message={assistant([toolPart('approval-responded', RUN)])} active={false} failed />);
    expect(call()).toHaveTextContent('Stopped');
    expect(call()).not.toHaveTextContent('Running');
    expect(document.querySelector('[data-slot="signoff-tool-call"]')).toHaveAttribute('data-interrupted', 'true');
  });

  it('leaves a denied call denied, and settled calls as they are', () => {
    render(
      <ToolCallTimeline
        parts={[
          toolPart('approval-responded', { toolCallId: 'denied', approval: { id: 'a', approved: false } }),
          toolPart('output-available', { toolCallId: 'done' }),
          toolPart('output-error', { toolCallId: 'failed' }),
        ]}
        active={false}
        failed
        announce={false}
      />,
    );
    expect(screen.getByText('Denied')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).toBeNull();
  });

  it('follows the walkthrough: Running until the continuation fails, then Stopped', () => {
    // Getting started's props: `active` from deriveAgentState's state, `failed` from useChat's status.
    const view = (status: ChatStatus, parts: UIMessage['parts']) => {
      const message = assistant(parts);
      const { state } = deriveAgentState({ status, message });
      return (
        <AgentMessage
          message={message}
          streaming={status === 'streaming'}
          active={state !== 'done' && state !== 'stopped' && state !== 'error'}
          failed={status === 'error'}
        />
      );
    };
    const { rerender } = render(view('ready', [toolPart('approval-requested', RUN)]));
    expect(call()).toHaveTextContent('Needs approval');
    // Approved: useChat renders `ready` once before sendAutomaticallyWhen submits the continuation.
    rerender(view('ready', [toolPart('approval-responded', RUN)]));
    expect(call()).toHaveTextContent('Running');
    rerender(view('submitted', [toolPart('approval-responded', RUN)]));
    expect(call()).toHaveTextContent('Running');
    rerender(view('error', [toolPart('approval-responded', RUN)]));
    expect(call()).toHaveTextContent('Stopped');
  });
});
