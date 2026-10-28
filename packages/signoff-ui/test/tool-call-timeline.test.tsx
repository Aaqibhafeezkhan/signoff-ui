import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_STATES, type ToolPart } from '../src/lib/ai';
import { ToolCallTimeline } from '../src/tool-call-timeline';
import { axe, dynamicToolPart, toolPart } from './utils';

const EXPECTED: Record<(typeof TOOL_STATES)[number], { phase: string; text: string }> = {
  'input-streaming': { phase: 'streaming', text: 'Preparing' },
  'input-available': { phase: 'running', text: 'Running' },
  'approval-requested': { phase: 'awaiting-approval', text: 'Needs approval' },
  'approval-responded': { phase: 'running', text: 'Running' },
  'output-available': { phase: 'success', text: 'Done' },
  'output-error': { phase: 'error', text: 'Failed' },
  'output-denied': { phase: 'denied', text: 'Denied' },
};

describe('ToolCallTimeline', () => {
  it.each(TOOL_STATES)('renders the %s state', (state) => {
    render(<ToolCallTimeline parts={[toolPart(state)]} />);
    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute('data-state', state);
    expect(item).toHaveAttribute('data-phase', EXPECTED[state].phase);
    expect(within(item).getByText(EXPECTED[state].text)).toBeInTheDocument();
    expect(within(item).getByText('Search docs')).toBeInTheDocument();
  });

  it('treats a denied approval response and preliminary output correctly', () => {
    render(
      <ToolCallTimeline
        parts={[
          toolPart('approval-responded', { toolCallId: 'a', approval: { id: 'x', approved: false } }),
          toolPart('output-available', { toolCallId: 'b', preliminary: true }),
        ]}
      />,
    );
    const [denied, partial] = screen.getAllByRole('listitem');
    expect(denied).toHaveAttribute('data-phase', 'denied');
    expect(partial).toHaveAttribute('data-phase', 'running');
  });

  it('supports dynamic tools', () => {
    render(<ToolCallTimeline parts={[dynamicToolPart()]} />);
    expect(screen.getByText('Mcp fetch')).toBeInTheDocument();
  });

  it('ignores non-tool parts and renders nothing without tools', () => {
    const { container } = render(<ToolCallTimeline parts={[{ type: 'text', text: 'hi' }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('expands to show input and output, by mouse and keyboard', async () => {
    const user = userEvent.setup();
    render(<ToolCallTimeline parts={[toolPart('output-available')]} />);
    const trigger = screen.getByRole('button', { name: /search docs/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Input' })).toHaveTextContent('"query": "streaming ui"');
    expect(screen.getByRole('group', { name: 'Output' })).toHaveTextContent('"score": 0.92');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the error inline under a failed call, and can auto-expand it', () => {
    const { unmount } = render(<ToolCallTimeline parts={[toolPart('output-error')]} />);
    expect(screen.getByRole('button', { name: /search docs/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('ENOENT: no such file or directory')).toBeInTheDocument();
    unmount();
    render(<ToolCallTimeline parts={[toolPart('output-error')]} expandErrors />);
    expect(screen.getByRole('button', { name: /search docs/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Input' })).toBeInTheDocument();
    expect(screen.getByText('ENOENT: no such file or directory')).toBeInTheDocument();
  });

  it('shows the denial reason', async () => {
    const user = userEvent.setup();
    render(<ToolCallTimeline parts={[toolPart('output-denied')]} />);
    await user.click(screen.getByRole('button', { name: /search docs/i }));
    expect(screen.getByText('Not on main')).toBeInTheDocument();
  });

  it("does not blame the person for a denial the server's check made after they approved", async () => {
    // AI SDK 7 checks edited arguments against toolApproval again: `ls` edited to `git push origin main`,
    // approved, then denied by an always-deny `git push*` rule. The denial carries no reason, and the
    // part keeps the person's approval.
    const user = userEvent.setup();
    const rechecked = toolPart('output-denied', {
      toolName: 'run_command',
      input: { command: 'git push origin main' },
      approval: { id: 'approval_push', approved: true },
    });
    render(<ToolCallTimeline parts={[rechecked]} />);
    await user.click(screen.getByRole('button', { name: /Run command/ }));
    expect(screen.getByText('Blocked by policy.')).toBeInTheDocument();
    expect(screen.queryByText(/Denied by user/)).not.toBeInTheDocument();
  });

  describe('a call a person answers (pendingClientTools)', () => {
    const REVIEW = { toolCallId: 'call_review', toolName: 'review_changes' };
    // Reviewed in 3.2s: the person's time, from input-available to the output the page sent.
    const timings = { call_review: { startedAt: 1_000, runningAt: 1_100, endedAt: 4_300 } };

    it('shows no duration once answered: the time was the person’s', () => {
      const { rerender } = render(
        <ToolCallTimeline parts={[toolPart('output-available', REVIEW)]} timings={timings} />,
      );
      // Without it, the row reports the review as the tool's run time.
      expect(screen.getByRole('button', { name: /Review changes/ })).toHaveTextContent('3.20s');
      rerender(
        <ToolCallTimeline
          parts={[toolPart('output-available', REVIEW)]}
          timings={timings}
          pendingClientTools={['review_changes']}
        />,
      );
      const row = screen.getByRole('button', { name: /Review changes/ });
      expect(row).toHaveTextContent('Done');
      expect(row).not.toHaveTextContent(/\d+ms|\d\.\d+s/);
    });

    it('reads as waiting on the person while it waits, with no clock', () => {
      render(
        <ToolCallTimeline
          parts={[toolPart('input-available', REVIEW), toolPart('output-available', { toolCallId: 'r' })]}
          timings={{
            call_review: { startedAt: 1_000, runningAt: 1_100 },
            r: { startedAt: 1, runningAt: 1, endedAt: 251 },
          }}
          pendingClientTools={['review_changes']}
        />,
      );
      const [review, other] = screen.getAllByRole('listitem');
      expect(review).toHaveAttribute('data-phase', 'awaiting-approval');
      expect(within(review!).getByRole('button')).toHaveTextContent('Needs approval');
      expect(within(review!).getByRole('button')).not.toHaveTextContent(/\d+ms|\d\.\d+s/);
      // Other calls keep theirs.
      expect(within(other!).getByRole('button')).toHaveTextContent('250ms');
    });

    it('still reads "Stopped" when the run ended while it waited', () => {
      render(
        <ToolCallTimeline
          parts={[toolPart('input-available', REVIEW)]}
          pendingClientTools={['review_changes']}
          active={false}
        />,
      );
      expect(screen.getByRole('button', { name: /Review changes/ })).toHaveTextContent('Stopped');
    });
  });

  it('moves between calls with arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(
      <ToolCallTimeline
        parts={[
          toolPart('output-available', { toolCallId: '1', toolName: 'search_docs' }),
          toolPart('output-available', { toolCallId: '2', toolName: 'read_file' }),
          toolPart('input-available', { toolCallId: '3', toolName: 'run_tests' }),
        ]}
      />,
    );
    const [first, second, third] = screen.getAllByRole('button');
    first!.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(third).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
  });

  it('formats durations from provided timings, excluding approval wait', () => {
    render(
      <ToolCallTimeline
        parts={[toolPart('output-available')]}
        timings={{ 'call_output-available': { startedAt: 1_000, runningAt: 6_000, endedAt: 7_200 } }}
      />,
    );
    expect(screen.getByText('1.20s')).toBeInTheDocument();
  });

  it('uses tool metadata for labels, summaries and custom output', async () => {
    const user = userEvent.setup();
    render(
      <ToolCallTimeline
        parts={[toolPart('output-available')]}
        tools={{
          search_docs: {
            label: 'Search',
            summary: (input) => `“${(input as { query: string }).query}”`,
            renderOutput: () => <p>1 result</p>,
          },
        }}
      />,
    );
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('“streaming ui”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  it('calls summary only once input exists, so it never sees the empty first streamed part', () => {
    // The README's example: it reads input.path without guarding against undefined.
    const tools = { read_file: { label: 'Read file', summary: (input: unknown) => (input as { path: string }).path } };
    const streamed = (input: unknown) =>
      toolPart('input-streaming', { toolCallId: 'r1', toolName: 'read_file', input });
    const { rerender } = render(<ToolCallTimeline parts={[streamed(undefined)]} tools={tools} />);
    expect(screen.getByRole('button', { name: /Read file/ })).toHaveTextContent('Preparing');
    rerender(<ToolCallTimeline parts={[streamed({ path: 'lib/re' })]} tools={tools} />);
    expect(screen.getByRole('button', { name: /Read file/ })).toHaveTextContent('lib/re');
  });

  describe('announcements', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const call = (state: ToolPart['state'], toolCallId: string, toolName = 'search_docs') =>
      toolPart(state, { toolCallId, toolName });

    it('announces completions and failures politely, each once', () => {
      const { rerender } = render(<ToolCallTimeline parts={[call('input-available', 'c1')]} />);
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('');
      act(() => vi.advanceTimersByTime(120));
      rerender(<ToolCallTimeline parts={[call('output-available', 'c1')]} />);
      act(() => vi.advanceTimersByTime(300));
      expect(status).toHaveTextContent(/^Search docs finished in 120 milliseconds$/);

      rerender(
        <ToolCallTimeline parts={[call('output-available', 'c1'), call('input-available', 'c2', 'read_file')]} />,
      );
      act(() => vi.advanceTimersByTime(2_000));
      rerender(<ToolCallTimeline parts={[call('output-available', 'c1'), call('output-error', 'c2', 'read_file')]} />);
      act(() => vi.advanceTimersByTime(300));
      expect(status).toHaveTextContent(/^Read file failed: ENOENT: no such file or directory$/);
    });

    it('announces parallel calls that settle together, not only the last one', () => {
      const running = [call('input-available', 'a', 'read_file'), call('input-available', 'b', 'web_search')];
      const { rerender } = render(<ToolCallTimeline parts={running} />);
      act(() => vi.advanceTimersByTime(90));
      // Both results arrive in one update.
      rerender(
        <ToolCallTimeline
          parts={[call('output-available', 'a', 'read_file'), call('output-error', 'b', 'web_search')]}
        />,
      );
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole('status')).toHaveTextContent(
        'Read file finished in 90 milliseconds. Web search failed: ENOENT: no such file or directory',
      );
    });

    it('announces calls that settle moments apart together', () => {
      const three = (states: Array<ToolPart['state']>) =>
        states.map((state, i) => call(state, `p${i}`, ['read_file', 'web_search', 'run_command'][i]));
      const { rerender } = render(
        <ToolCallTimeline parts={three(['input-available', 'input-available', 'input-available'])} />,
      );
      act(() => vi.advanceTimersByTime(500));
      rerender(<ToolCallTimeline parts={three(['output-available', 'input-available', 'input-available'])} />);
      act(() => vi.advanceTimersByTime(100));
      rerender(<ToolCallTimeline parts={three(['output-available', 'output-available', 'input-available'])} />);
      act(() => vi.advanceTimersByTime(300));
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent(
        'Read file finished in 500 milliseconds. Web search finished in 600 milliseconds.',
      );
      // A call that settles later is announced on its own.
      act(() => vi.advanceTimersByTime(1_000));
      rerender(<ToolCallTimeline parts={three(['output-available', 'output-available', 'output-denied'])} />);
      act(() => vi.advanceTimersByTime(300));
      expect(status).toHaveTextContent(/^Run command was denied$/);
    });

    it('announces a denial the server made after approval as the policy’s', () => {
      const RUN = { toolCallId: 'push', toolName: 'run_command' };
      const { rerender } = render(
        <ToolCallTimeline
          parts={[toolPart('approval-responded', { ...RUN, approval: { id: 'a', approved: true } })]}
        />,
      );
      act(() => vi.advanceTimersByTime(50));
      rerender(
        <ToolCallTimeline parts={[toolPart('output-denied', { ...RUN, approval: { id: 'a', approved: true } })]} />,
      );
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole('status')).toHaveTextContent(/^Run command was blocked by policy$/);
    });

    it('does not announce a person’s answer as a run time, and still announces the others', () => {
      const parts = (review: ToolPart['state'], read: ToolPart['state']) => [
        call(review, 'rv', 'review_changes'),
        call(read, 'rd', 'read_file'),
      ];
      const { rerender } = render(
        <ToolCallTimeline
          parts={parts('input-available', 'input-available')}
          pendingClientTools={['review_changes']}
        />,
      );
      act(() => vi.advanceTimersByTime(3_000));
      rerender(
        <ToolCallTimeline
          parts={parts('output-available', 'output-available')}
          pendingClientTools={['review_changes']}
        />,
      );
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole('status')).toHaveTextContent(/^Read file finished in 3.0 seconds$/);
    });

    it('does not announce calls that had settled before it mounted', () => {
      const timings = { r: { startedAt: 1, runningAt: 1, endedAt: 900 } };
      render(<ToolCallTimeline parts={[call('output-available', 'r')]} timings={timings} />);
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByRole('status')).toHaveTextContent('');
    });
  });

  it('does not invent durations for calls restored already settled', () => {
    render(<ToolCallTimeline parts={[toolPart('output-available')]} />);
    expect(screen.queryByText(/\d+ms|\d\.\d+s/)).not.toBeInTheDocument();
  });

  it('keeps the awaiting-approval mark out of the accessibility tree; the button says it', () => {
    render(<ToolCallTimeline parts={[toolPart('approval-requested')]} />);
    expect(screen.getByText('!').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Needs approval/ })).toBeInTheDocument();
  });

  it('renders extra content under a call', () => {
    render(<ToolCallTimeline parts={[toolPart('approval-requested')]} renderExtra={() => <p>approve me</p>} />);
    expect(screen.getByText('approve me')).toBeInTheDocument();
  });

  it('has no axe violations, collapsed and expanded', async () => {
    const { container } = render(
      <ToolCallTimeline
        defaultExpanded={['call_output-available']}
        parts={TOOL_STATES.map((state) => toolPart(state, { toolCallId: `call_${state}` }))}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
