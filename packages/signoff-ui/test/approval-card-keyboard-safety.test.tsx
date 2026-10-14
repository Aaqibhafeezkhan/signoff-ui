import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalCard,
  ToolApprovalBatch,
  type ApprovalChoice,
  type ApprovalDecision,
  type ToolApprovalResponse,
} from '../src/approval-card';
import { toolPart } from './utils';

/*
 * A decision needs the person's action (SECURITY.md): a held key, focus taken out of the field
 * they type in, or ⌘/Ctrl+Enter meant for that field must not send one (SU2-27).
 */

const ALL: ApprovalDecision[] = ['allow-once', 'allow-session', 'allow-always', 'deny-once', 'deny-always'];

function setup(props: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  const onDecide = vi.fn<(choice: ApprovalChoice) => void | PromiseLike<void>>();
  const user = userEvent.setup();
  const utils = render(
    <ApprovalCard
      toolName="run_command"
      input={{ command: 'git push --force' }}
      decisions={ALL}
      onDecide={onDecide}
      {...props}
    />,
  );
  return { ...utils, user, onDecide, card: screen.getByRole('group', { name: 'Run command' }) };
}

const decisions = (onDecide: { mock: { calls: [ApprovalChoice][] } }) =>
  onDecide.mock.calls.map(([choice]) => choice.decision);

/** A chat composer next to the card, which mounts later, with `card`'s props, as a tool call does. */
function Page({
  field = 'textarea',
  card,
}: {
  field?: 'textarea' | 'input';
  card?: Partial<Parameters<typeof ApprovalCard>[0]>;
}) {
  return (
    <>
      {field === 'textarea' ? <textarea aria-label="Message" /> : <input type="text" aria-label="Message" />}
      <button type="button">Send</button>
      {card && (
        <ApprovalCard toolName="run_command" input={{ command: 'git push --force' }} decisions={ALL} {...card} />
      )}
    </>
  );
}

describe('ApprovalCard: a held key decides once', () => {
  it.each([
    ['y', 'allow-once'],
    ['s', 'allow-session'],
    ['a', 'allow-always'],
  ] as const)('holding %s on a critical call arms the confirmation, and does not confirm it', async (key, decision) => {
    const { user, onDecide, card } = setup({ risk: 'critical' });
    card.focus();
    await user.keyboard(`{${key}>4}`);
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Confirm approval/ })).toHaveAttribute('data-decision', decision);
    // A second, deliberate press still confirms.
    await user.keyboard(key);
    expect(decisions(onDecide)).toEqual([decision]);
  });

  it('holding ⌘/Ctrl+Enter in a critical card does not confirm it', async () => {
    const { user, onDecide, card } = setup({ risk: 'critical' });
    card.focus();
    await user.keyboard('{Control>}{Enter>4}{/Control}');
    expect(onDecide).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(decisions(onDecide)).toEqual(['allow-once']);
  });

  it('holding Enter on a focused Approve button does not confirm a critical call', async () => {
    const { user, onDecide } = setup({ risk: 'critical' });
    screen.getByRole('button', { name: /^Approve/ }).focus();
    // Each repeated keydown of a held Enter clicks the focused button again in the browser.
    await user.keyboard('{Enter>4}');
    expect(onDecide).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(decisions(onDecide)).toEqual(['allow-once']);
  });

  it.each([
    ['Y', '{y>4}', 'allow-once'],
    ['N', '{n>4}', 'deny-once'],
    ['Shift+N', '{Shift>}{n>4}{/Shift}', 'deny-always'],
  ] as const)('holding %s sends one decision, not one per repeat', async (_, keys, decision) => {
    // The handler's promise settles while the card is still pending, which allows a retry: a
    // repeat of the same press is not one.
    const { user, onDecide, card } = setup();
    onDecide.mockImplementation(() => Promise.resolve());
    card.focus();
    await user.keyboard(keys);
    expect(decisions(onDecide)).toEqual([decision]);
  });

  it('holding Enter on "Deny with feedback" opens the field and sends nothing', async () => {
    const { user, onDecide } = setup();
    screen.getByRole('button', { name: 'Deny with feedback' }).focus();
    await user.keyboard('{Enter>4}');
    expect(onDecide).not.toHaveBeenCalled();
    const field = screen.getByRole('textbox', { name: /tell the agent why/i });
    expect(field).toHaveFocus();
    expect(field).toHaveValue('');
    await user.keyboard('Use a branch{Enter}');
    expect(onDecide).toHaveBeenCalledWith({ decision: 'deny-once', reason: 'Use a branch' });
  });

  it('with globalShortcut, holding ⌘/Ctrl+Enter outside a critical card does not confirm it', async () => {
    const { user, onDecide } = setup({ risk: 'critical', globalShortcut: true });
    document.body.focus();
    await user.keyboard('{Control>}{Enter>4}{/Control}');
    expect(onDecide).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(decisions(onDecide)).toEqual(['allow-once']);
  });
});

describe('ApprovalCard: autoFocus does not take focus from a text field', () => {
  it.each(['textarea', 'input'] as const)(
    'typing "please stop" in a %s as the card mounts stays in the field, and decides nothing',
    async (field) => {
      const onDecide = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(<Page field={field} />);
      const composer = screen.getByRole('textbox', { name: 'Message' });
      await user.click(composer);
      await user.keyboard('plea');
      rerender(<Page field={field} card={{ autoFocus: true, onDecide }} />);
      await user.keyboard('se stop');
      expect(onDecide).not.toHaveBeenCalled();
      expect(composer).toHaveValue('please stop');
      expect(composer).toHaveFocus();
    },
  );

  it('still takes focus when the person is not typing', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    rerender(<Page card={{ autoFocus: true, onDecide: vi.fn() }} />);
    expect(screen.getByRole('group', { name: 'Run command' })).toHaveFocus();
  });
});

describe('ApprovalCard: globalShortcut leaves text fields alone', () => {
  it.each(['Control', 'Meta'])('%s+Enter in a composer is the composer’s; outside a field it approves', async (mod) => {
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<Page card={{ globalShortcut: true, onDecide }} />);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.keyboard(`ship it{${mod}>}{Enter}{/${mod}}`);
    expect(onDecide).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Send' }).focus();
    await user.keyboard(`{${mod}>}{Enter}{/${mod}}`);
    expect(decisions(onDecide)).toEqual(['allow-once']);
  });

  it('⌘/Ctrl+Enter in the card’s own argument editor does not approve either', async () => {
    const { user, onDecide } = setup({ globalShortcut: true, editable: true });
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    await user.click(screen.getByRole('textbox', { name: 'command' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onDecide).not.toHaveBeenCalled();
  });
});

describe('ToolApprovalBatch: a held Enter answers once', () => {
  const command = (cmd: string, id: string) =>
    toolPart('approval-requested', { toolName: 'run_command', toolCallId: id, input: { command: cmd } });
  const parts = [command('rm -rf ~', 'a'), command('npm test', 'b')];

  it('holding Enter on Approve all does not confirm it over a critical call', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    render(
      <ToolApprovalBatch
        parts={parts}
        onRespond={onRespond}
        tools={{
          run_command: {
            risk: (input) => ((input as { command: string }).command === 'rm -rf ~' ? 'critical' : 'low'),
          },
        }}
      />,
    );
    screen.getByRole('button', { name: 'Approve all' }).focus();
    await user.keyboard('{Enter>4}');
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm approve all' })).toHaveFocus();
  });

  it('holding Enter on Deny all answers each call once', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    render(<ToolApprovalBatch parts={parts} onRespond={onRespond} />);
    screen.getByRole('button', { name: 'Deny all' }).focus();
    await user.keyboard('{Enter>4}');
    expect(onRespond.mock.calls.map(([r]) => r)).toEqual([
      { id: 'approval_a', approved: false },
      { id: 'approval_b', approved: false },
    ]);
  });
});
