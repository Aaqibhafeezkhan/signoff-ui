import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { deriveAgentState, type AnyUIPart, type SubagentData, type SubagentPart } from '../src/lib/ai';
import { ToolCallTimeline } from '../src/tool-call-timeline';
import { axe, toolPart } from './utils';

/*
 * A sub-agent's work arrives as a `data-signoff-subagent` part (the AG-UI adapter makes them). The
 * timeline nests its calls under the call that started it, collapsed, and its calls work like any.
 */

const subagent = (id: string, data: Partial<SubagentData> = {}): SubagentPart => ({
  type: 'data-signoff-subagent',
  id,
  data: { subagentRunId: id, status: 'running', parts: [], ...data },
});

/** A call that started a researcher, which searched and is reading a page, and a call after it. */
const run = (data: Partial<SubagentData> = {}): AnyUIPart[] => [
  toolPart('input-available', { toolCallId: 'delegate', toolName: 'delegate' }),
  subagent('sa1', {
    parentToolCallId: 'delegate',
    name: 'Researcher',
    parts: [
      { type: 'text', text: 'Searching first.' },
      toolPart('output-available', { toolCallId: 'search', toolName: 'web_search' }),
      toolPart('input-available', { toolCallId: 'read', toolName: 'read_page' }),
    ],
    ...data,
  }),
  toolPart('output-available', { toolCallId: 'write', toolName: 'write_file' }),
];

const group = () => screen.getByRole('button', { name: /^Researcher/ });

describe('ToolCallTimeline with sub-agents', () => {
  it('nests a sub-agent under the call that started it, collapsed', () => {
    const { container } = render(<ToolCallTimeline parts={run()} />);
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(1);
    const calls = within(lists[0]!).getAllByRole('listitem');
    expect(calls).toHaveLength(2);
    // Under the delegating call: its name, its calls and where it is, as a disclosure button.
    expect(within(calls[0]!).getByRole('button', { name: /^Researcher/ })).toBe(group());
    expect(group()).toHaveAttribute('aria-expanded', 'false');
    expect(group()).toHaveTextContent('Researcher2 callsRunning');
    expect(container.querySelector('[data-slot="signoff-subagent"]')).toHaveAttribute('data-status', 'running');
    // Its calls are not on the page until it opens; its text is not the timeline's.
    expect(screen.queryByRole('button', { name: /Web search/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Searching first.')).not.toBeInTheDocument();
  });

  it('opens to its calls, a list of their own that works like the timeline’s', async () => {
    const user = userEvent.setup();
    render(<ToolCallTimeline parts={run()} />);
    await user.click(group());
    expect(group()).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Researcher’s tool calls' });
    const [search, read] = within(list).getAllByRole('listitem');
    expect(search).toHaveAttribute('data-phase', 'success');
    expect(read).toHaveAttribute('data-phase', 'running');
    // A nested call has no place in the long-timeline count.
    expect(search).not.toHaveAttribute('aria-posinset');
    const trigger = within(search!).getByRole('button', { name: /Web search/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(search!).getByRole('group', { name: 'Output' })).toHaveTextContent('"score": 0.92');
    group().focus();
    await user.keyboard('{Enter}');
    expect(group()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Researcher’s tool calls' })).not.toBeInTheDocument();
  });

  it('says where the sub-agent is: running, done, failed, paused, or stopped with the run', () => {
    const { rerender, container } = render(<ToolCallTimeline parts={run({ status: 'done' })} />);
    const node = () => container.querySelector('[data-slot="signoff-subagent"]')!;
    expect(group()).toHaveTextContent('Done');
    expect(node()).toHaveAttribute('data-status', 'done');

    rerender(<ToolCallTimeline parts={run({ status: 'error', errorText: 'Rate limited' })} />);
    expect(group()).toHaveTextContent('Failed');
    expect(within(node() as HTMLElement).getByText('Rate limited')).toBeInTheDocument();

    rerender(<ToolCallTimeline parts={run({ status: 'suspended' })} />);
    expect(group()).toHaveTextContent('Paused');

    rerender(<ToolCallTimeline parts={run()} active={false} />);
    expect(group()).toHaveTextContent('Stopped');
    expect(node()).toHaveAttribute('data-interrupted', 'true');
  });

  it('names a sub-agent the agent did not name, and shows one without calls as a row', () => {
    render(
      <ToolCallTimeline
        parts={[
          toolPart('input-available', { toolCallId: 'delegate', toolName: 'delegate' }),
          subagent('sa1', { parentToolCallId: 'delegate' }),
        ]}
      />,
    );
    expect(screen.getByText('Sub-agent')).toBeInTheDocument();
    expect(screen.getByText('0 calls')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sub-agent/ })).not.toBeInTheDocument();
  });

  it('opens a sub-agent with a call waiting on approval, and leaves it closed once closed', async () => {
    const user = userEvent.setup();
    const parts = run({
      parts: [toolPart('approval-requested', { toolCallId: 'install', toolName: 'run_command' })],
    });
    render(
      <ToolCallTimeline parts={parts} renderExtra={(part) => part.approval && <p>card for {part.toolCallId}</p>} />,
    );
    expect(group()).toHaveAttribute('aria-expanded', 'true');
    expect(group()).toHaveTextContent('Needs approval');
    expect(screen.getByText('card for install')).toBeInTheDocument();
    await user.click(group());
    expect(group()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('card for install')).not.toBeInTheDocument();
  });

  it('nests a sub-agent’s own sub-agents, and shows in place the calls of one with no call to nest under', async () => {
    const user = userEvent.setup();
    render(
      <ToolCallTimeline
        parts={[
          toolPart('output-available', { toolCallId: 'delegate', toolName: 'delegate' }),
          subagent('sa1', {
            parentToolCallId: 'delegate',
            name: 'Planner',
            status: 'done',
            parts: [
              toolPart('output-available', { toolCallId: 'ask', toolName: 'ask_coder' }),
              subagent('sa2', {
                parentToolCallId: 'ask',
                name: 'Coder',
                status: 'done',
                parts: [toolPart('output-available', { toolCallId: 'edit', toolName: 'edit_file' })],
              }),
            ],
          }),
          // Started by no call this timeline has: its calls show where it is.
          subagent('sa3', {
            parentToolCallId: 'elsewhere',
            name: 'Reviewer',
            parts: [toolPart('output-available', { toolCallId: 'lint', toolName: 'run_lint' })],
          }),
        ]}
      />,
    );
    const top = screen.getByRole('list', { name: 'Tool calls' });
    expect(
      within(top)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Delegatestreaming uiDone', 'Planner1 callDone', 'Run lintstreaming uiDone']);
    await user.click(screen.getByRole('button', { name: /^Planner/ }));
    await user.click(screen.getByRole('button', { name: /^Coder/ }));
    const coder = screen.getByRole('list', { name: 'Coder’s tool calls' });
    expect(within(coder).getByRole('button', { name: /Edit file/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Planner’s tool calls' })).toContainElement(coder);
  });

  it('moves through what is on screen with the arrow keys, sub-agents and their open calls included', async () => {
    const user = userEvent.setup();
    render(<ToolCallTimeline parts={run()} />);
    const button = (name: RegExp) => screen.getByRole('button', { name });
    button(/^Delegate/).focus();
    await user.keyboard('{ArrowDown}');
    expect(group()).toHaveFocus();
    // Collapsed, its calls are skipped.
    await user.keyboard('{ArrowDown}');
    expect(button(/^Write file/)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(group()).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}');
    expect(button(/^Web search/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(button(/^Read page/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(button(/^Write file/)).toHaveFocus();
    // Up from the next call lands on the last thing above it: the sub-agent's last call.
    await user.keyboard('{ArrowUp}');
    expect(button(/^Read page/)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(button(/^Delegate/)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(button(/^Write file/)).toHaveFocus();
    await user.keyboard('{End}');
    expect(button(/^Write file/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(button(/^Delegate/)).toHaveFocus();
  });

  it('leaves keys alone inside a call’s extra content', async () => {
    const user = userEvent.setup();
    const parts = run({ parts: [toolPart('approval-requested', { toolCallId: 'install', toolName: 'run_command' })] });
    render(
      <ToolCallTimeline parts={parts} renderExtra={(part) => part.approval && <button type="button">ok</button>} />,
    );
    screen.getByRole('button', { name: 'ok' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'ok' })).toHaveFocus();
  });

  it('has no axe violations, collapsed and open', async () => {
    const { container } = render(<ToolCallTimeline parts={run({ status: 'error', errorText: 'Rate limited' })} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().click(group());
    expect(await axe(container)).toHaveNoViolations();
  });

  describe('timings and announcements', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('times a sub-agent’s calls and announces them like the others, open or not', () => {
      const reading = (state: 'input-available' | 'output-available') =>
        run({ parts: [toolPart(state, { toolCallId: 'read', toolName: 'read_page' })] });
      const { rerender } = render(<ToolCallTimeline parts={reading('input-available')} />);
      act(() => vi.advanceTimersByTime(250));
      rerender(<ToolCallTimeline parts={reading('output-available')} />);
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole('status')).toHaveTextContent(/^Read page finished in 250 milliseconds$/);
      act(() => group().click());
      expect(screen.getByRole('button', { name: /Read page/ })).toHaveTextContent('250ms');
    });
  });
});

describe('AgentMessage with sub-agents', () => {
  const message = (parts: AnyUIPart[]) => ({ id: 'm1', role: 'assistant' as const, parts });

  it('hands a sub-agent to the timeline of the call that started it, not to renderData', () => {
    const renderData = vi.fn(() => <p>data</p>);
    render(
      <AgentMessage
        message={message([{ type: 'text', text: 'Delegating.' }, ...run(), { type: 'text', text: 'Done.' }])}
        renderData={renderData}
      />,
    );
    const timeline = screen.getByRole('list', { name: 'Tool calls' });
    expect(within(timeline).getByRole('button', { name: /^Researcher/ })).toBeInTheDocument();
    expect(renderData).not.toHaveBeenCalled();
  });

  it('asks for approval of a sub-agent’s call, alone or with others', async () => {
    const onToolApproval = vi.fn();
    const nested = run({
      parts: [
        toolPart('approval-requested', { toolCallId: 'install', toolName: 'run_command' }),
        toolPart('approval-requested', { toolCallId: 'publish', toolName: 'npm_publish' }),
      ],
    });
    render(<AgentMessage message={message(nested)} onToolApproval={onToolApproval} />);
    // Both cards, under the open sub-agent, and the batch for the two.
    expect(screen.getAllByRole('button', { name: /^Approve$/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Approve all/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole('button', { name: /^Approve$/ })[0]!);
    expect(onToolApproval).toHaveBeenCalledWith(expect.objectContaining({ id: 'approval_install', approved: true }));
  });
});

describe('deriveAgentState with sub-agents', () => {
  const message = (parts: AnyUIPart[]) => ({ role: 'assistant' as const, parts });

  it('waits on a sub-agent’s approval', () => {
    const parts = run({ parts: [toolPart('approval-requested', { toolCallId: 'install', toolName: 'run_command' })] });
    expect(deriveAgentState({ status: 'ready', message: message(parts) })).toEqual({
      state: 'awaiting-approval',
      detail: 'run_command',
    });
  });

  it('reads a run that ended while a sub-agent worked as stopped', () => {
    const parts = [
      toolPart('output-available', { toolCallId: 'delegate', toolName: 'delegate' }),
      subagent('sa1', { parentToolCallId: 'delegate', parts: [toolPart('input-available', { toolCallId: 'read' })] }),
    ];
    expect(deriveAgentState({ status: 'ready', message: message(parts) })).toEqual({ state: 'stopped' });
  });

  it('names the sub-agent’s last call while it streams, or the sub-agent before it has one', () => {
    expect(deriveAgentState({ status: 'streaming', message: message(run()) })).toEqual({
      state: 'working',
      detail: 'write_file',
    });
    expect(deriveAgentState({ status: 'streaming', message: message(run().slice(0, 2)) })).toEqual({
      state: 'working',
      detail: 'read_page',
    });
    expect(
      deriveAgentState({ status: 'streaming', message: message([subagent('sa1', { name: 'Researcher' })]) }),
    ).toEqual({ state: 'working', detail: 'Researcher' });
  });
});
