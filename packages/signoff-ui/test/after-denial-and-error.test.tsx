import { render, screen } from '@testing-library/react';
import type { ChatStatus, UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { deriveAgentState } from '../src/lib/ai';
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
    // A sub-agent that has finished is not work either.
    const researcher = {
      type: 'data-signoff-subagent' as const,
      id: 'sa1',
      data: { subagentRunId: 'sa1', parentToolCallId: 'call_delegate', status: 'done' as const, parts: [] },
    };
    const delegated = [toolPart('output-available', { toolCallId: 'call_delegate' }), researcher];
    expect(streaming([...delegated, toolPart('output-available', RUN)] as UIMessage['parts'])).toEqual({
      state: 'thinking',
    });
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
