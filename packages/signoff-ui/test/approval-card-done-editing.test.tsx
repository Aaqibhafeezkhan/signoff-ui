import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard, ToolApprovalCard, type ApprovalChoice } from '../src/approval-card';
import { axe, toolPart } from './utils';

/*
 * "Done editing" closes the editor and keeps the edit: approving then runs the edited arguments,
 * the card shows them, and "Undo edits" goes back to the agent's. Before, the edit counted only
 * while the editor was open, so edit, Done editing, Approve ran the original call (SU2-05).
 */

const EDITED_NOTE = 'Edited: approving runs the new arguments.';

function setup(props: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
  const user = userEvent.setup();
  const utils = render(
    <ApprovalCard
      toolName="run_command"
      input={{ command: 'rm -rf build && npm test' }}
      editable
      onDecide={onDecide}
      {...props}
    />,
  );
  return { ...utils, user, onDecide, card: screen.getByRole('group', { name: 'Run command' }) };
}

describe('ApprovalCard: Done editing keeps the edit', () => {
  it('approves the edited command after Done editing, and shows it', async () => {
    const { user, onDecide, card } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const field = screen.getByRole('textbox', { name: 'command' });
    await user.clear(field);
    await user.type(field, 'npm test');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));

    expect(screen.queryByRole('textbox', { name: 'command' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit arguments' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(EDITED_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo edits' })).toBeInTheDocument();
    expect(card).toHaveTextContent('$npm test');
    expect(card).not.toHaveTextContent('rm -rf build');

    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-once', input: { command: 'npm test' } });
  });

  it('keeps an edit made as JSON, and shows the edited arguments', async () => {
    const { user, onDecide, card } = setup({ input: { files: ['a.ts', 'b.ts'], force: { deep: true } } });
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const json = screen.getByRole('textbox', { name: 'Arguments, as JSON' });
    await user.clear(json);
    await user.type(json, '{{"files": [["a.ts"]}');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));

    expect(screen.queryByRole('textbox', { name: 'Arguments, as JSON' })).toBeNull();
    expect(screen.getByText(EDITED_NOTE)).toBeInTheDocument();
    expect(card).not.toHaveTextContent('b.ts');
    expect(card).not.toHaveTextContent('deep');

    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-once', input: { files: ['a.ts'] } });
  });

  it('keeps the edit for a session or always decision, and suggests the rule from it', async () => {
    const { user, onDecide } = setup({ decisions: ['allow-once', 'allow-session', 'deny-once'] });
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const field = screen.getByRole('textbox', { name: 'command' });
    await user.clear(field);
    await user.type(field, 'npm test');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(screen.getByRole('textbox', { name: 'command matches' })).toHaveValue('npm test*');
    await user.click(screen.getByRole('button', { name: /^For this session/ }));
    expect(onDecide).toHaveBeenLastCalledWith({
      decision: 'allow-session',
      input: { command: 'npm test' },
      args: { command: 'npm test*' },
    });
  });

  it('shows the edit again when the editor reopens', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    await user.clear(screen.getByRole('textbox', { name: 'command' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), 'npm test');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    expect(screen.getByRole('textbox', { name: 'command' })).toHaveValue('npm test');
  });

  it('undoes the edit with the editor closed', async () => {
    const { user, onDecide, card } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    await user.clear(screen.getByRole('textbox', { name: 'command' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), 'npm test');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    await user.click(screen.getByRole('button', { name: 'Undo edits' }));

    expect(screen.queryByText(EDITED_NOTE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo edits' })).toBeNull();
    // Focus stays in the card, so its shortcuts still work.
    expect(screen.getByRole('button', { name: 'Edit arguments' })).toHaveFocus();
    expect(card).toHaveTextContent('$rm -rf build && npm test');
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-once' });
  });

  it('stays open on Done editing while the JSON does not parse, so the error stays in view', async () => {
    const { user, onDecide } = setup({ input: { files: ['a.ts'], options: { force: true } } });
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const json = screen.getByRole('textbox', { name: 'Arguments, as JSON' });
    await user.clear(json);
    await user.type(json, '{{"files": [[');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));

    expect(json).toBeInTheDocument();
    expect(json).toHaveAccessibleDescription(/^Not valid JSON/);
    expect(screen.getByRole('button', { name: 'Done editing' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('The arguments are not valid JSON.');
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).not.toHaveBeenCalled();

    // Undo edits is a way out of JSON that does not parse.
    await user.click(screen.getByRole('button', { name: 'Undo edits' }));
    expect(json).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(screen.queryByRole('textbox', { name: 'Arguments, as JSON' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-once' });
  });

  it('shows the edited arguments instead of a custom preview, which shows the original call', async () => {
    const { user, card } = setup({ preview: <code>custom: rm -rf build && npm test</code> });
    expect(card).toHaveTextContent('custom: rm -rf build && npm test');
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    await user.clear(screen.getByRole('textbox', { name: 'command' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), 'npm test');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(card).not.toHaveTextContent('custom:');
    expect(card).toHaveTextContent('$npm test');
    await user.click(screen.getByRole('button', { name: 'Undo edits' }));
    expect(card).toHaveTextContent('custom: rm -rf build && npm test');
  });

  it('sends no edit when the input changes and nobody edited it', async () => {
    const { user, onDecide, rerender } = setup();
    rerender(<ApprovalCard toolName="run_command" input={{ command: 'npm ci' }} editable onDecide={onDecide} />);
    expect(screen.queryByText(EDITED_NOTE)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    expect(screen.getByRole('textbox', { name: 'command' })).toHaveValue('npm ci');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: 'allow-once' });
  });

  it('has no axe violations with an edit kept and the editor closed', async () => {
    const { user, container } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), ' -- --bail');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ToolApprovalCard: Done editing keeps the edit', () => {
  it('applies the edit with onEditInput before it approves', async () => {
    const user = userEvent.setup();
    const onEditInput = vi.fn<(toolCallId: string, input: unknown) => void>();
    const onRespond = vi.fn();
    const part = toolPart('approval-requested', {
      toolName: 'run_command',
      toolCallId: 'c1',
      input: { command: 'rm -rf build && npm test' },
    });
    render(<ToolApprovalCard part={part} onRespond={onRespond} onEditInput={onEditInput} />);
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    await user.clear(screen.getByRole('textbox', { name: 'command' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), 'npm test');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onEditInput).toHaveBeenCalledWith('c1', { command: 'npm test' });
    expect(onEditInput.mock.invocationCallOrder[0]).toBeLessThan(onRespond.mock.invocationCallOrder[0]!);
    expect(onRespond).toHaveBeenCalledWith({ id: 'approval_c1', approved: true });
  });
});
