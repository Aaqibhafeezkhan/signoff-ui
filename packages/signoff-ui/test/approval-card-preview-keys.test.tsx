import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UIMessage } from 'ai';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { ApprovalCard, ToolApprovalCard, type ApprovalDecision } from '../src/approval-card';
import { toolPart } from './utils';

/*
 * A custom `preview` is the app's content, in a `data-signoff-slot` element: keys pressed on its
 * controls, or on a menu it opens in a portal (as a DropdownMenu does), are the control's, not the
 * card's shortcuts (#87). The portal's keys reach the card through React from outside its element.
 */

const EVERY_DECISION: ApprovalDecision[] = ['allow-once', 'allow-session', 'allow-always', 'deny-once', 'deny-always'];

// Every shortcut the card offers: Y, S, A, N, Shift+N, and Ctrl or ⌘ + Enter.
const SHORTCUTS: Array<[name: string, keys: string, key: string]> = [
  ['Y', 'y', 'y'],
  ['S', 's', 's'],
  ['A', 'a', 'a'],
  ['N', 'n', 'n'],
  ['Shift+N', '{Shift>}n{/Shift}', 'n'],
  ['Ctrl+Enter', '{Control>}{Enter}{/Control}', 'Enter'],
  ['⌘+Enter', '{Meta>}{Enter}{/Meta}', 'Enter'],
];

/** A preview with controls of its own: a button, and a menu that it opens in a portal. */
function Preview({ onKey }: { onKey: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <code>pnpm test</code>
      <button type="button" aria-haspopup="menu" onClick={() => setOpen(true)} onKeyDown={(e) => onKey(e.key)}>
        Options
      </button>
      {open &&
        createPortal(
          <div role="menu">
            <button type="button" role="menuitem" onKeyDown={(e) => onKey(e.key)}>
              Copy the command
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function setup({ globalShortcut = false } = {}) {
  const onDecide = vi.fn();
  const onKey = vi.fn();
  const user = userEvent.setup();
  render(
    <ApprovalCard
      toolName="run_command"
      input={{ command: 'pnpm test' }}
      decisions={EVERY_DECISION}
      onDecide={onDecide}
      globalShortcut={globalShortcut}
      preview={<Preview onKey={onKey} />}
    />,
  );
  const card = screen.getByRole('group', { name: 'Run command' });
  return { user, onDecide, onKey, card };
}

describe('ApprovalCard: keys pressed in a custom preview', () => {
  it.each(SHORTCUTS)('%s on a button in the preview leaves the card pending', async (_, keys, key) => {
    const { user, onDecide, onKey, card } = setup();
    screen.getByRole('button', { name: 'Options' }).focus();
    await user.keyboard(keys);
    expect(onDecide).not.toHaveBeenCalled();
    expect(card).toHaveAttribute('data-status', 'pending');
    // The control still gets the key.
    expect(onKey).toHaveBeenCalledWith(key);
  });

  it.each(SHORTCUTS)(
    '%s on a menu item the preview opened in a portal leaves the card pending',
    async (_, keys, key) => {
      const { user, onDecide, onKey, card } = setup();
      await user.click(screen.getByRole('button', { name: 'Options' }));
      const item = screen.getByRole('menuitem', { name: 'Copy the command' });
      expect(card).not.toContainElement(item);
      item.focus();
      onKey.mockClear();
      await user.keyboard(keys);
      expect(onDecide).not.toHaveBeenCalled();
      expect(card).toHaveAttribute('data-status', 'pending');
      expect(onKey).toHaveBeenCalledWith(key);
    },
  );

  it('still takes the shortcuts with focus on the card itself', async () => {
    const { user, onDecide, card } = setup();
    card.focus();
    await user.keyboard('y');
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'allow-once' }));
  });

  it('still takes them when the card itself is in another component’s slot', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(
      <div data-signoff-slot>
        <ApprovalCard toolName="run_command" input={{ command: 'pnpm test' }} onDecide={onDecide} />
      </div>,
    );
    screen.getByRole('button', { name: /^Approve/ }).focus();
    await user.keyboard('n');
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny-once' }));
  });

  it('with globalShortcut, ⌘ or Ctrl + Enter still approves from anywhere, the preview included, once', async () => {
    const { user, onDecide } = setup({ globalShortcut: true });
    screen.getByRole('button', { name: 'Options' }).focus();
    await user.keyboard('y{Control>}{Enter}{/Control}');
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'allow-once' }));
  });
});

describe('ToolApprovalCard and AgentMessage: the same for their preview', () => {
  it('leaves the call unanswered when a key is pressed in the preview', async () => {
    const onRespond = vi.fn();
    const onKey = vi.fn();
    const user = userEvent.setup();
    render(
      <ToolApprovalCard
        part={toolPart('approval-requested', { toolName: 'run_command' })}
        onRespond={onRespond}
        preview={<Preview onKey={onKey} />}
      />,
    );
    screen.getByRole('button', { name: 'Options' }).focus();
    await user.keyboard('yn{Control>}{Enter}{/Control}');
    expect(onRespond).not.toHaveBeenCalled();
    expect(onKey.mock.calls.map(([key]) => key)).toEqual(['y', 'n', 'Control', 'Enter']);
  });

  it('through approvalProps', async () => {
    const onToolApproval = vi.fn();
    const onKey = vi.fn();
    const user = userEvent.setup();
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [toolPart('approval-requested', { toolName: 'run_command' })],
    } as UIMessage;
    render(
      <AgentMessage
        message={message}
        onToolApproval={onToolApproval}
        approvalProps={{ preview: <Preview onKey={onKey} /> }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Options' }));
    screen.getByRole('menuitem', { name: 'Copy the command' }).focus();
    await user.keyboard('yn');
    expect(onToolApproval).not.toHaveBeenCalled();
    expect(onKey.mock.calls.map(([key]) => key)).toEqual(['y', 'n']);
  });
});
