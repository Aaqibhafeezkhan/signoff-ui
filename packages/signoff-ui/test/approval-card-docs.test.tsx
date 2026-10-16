import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalCard,
  ToolApprovalBatch,
  ToolApprovalCard,
  type ApprovalChoice,
  type ApprovalDecision,
  type ToolApprovalResponse,
} from '../src/approval-card';
import { defaultLabels } from '../src/lib/labels';
import { toolPart } from './utils';

/*
 * The ApprovalCard page on the docs site says which pattern a lasting decision suggests for a
 * command, what "Done editing" does with an edit, and which keys can decide. Each check finds the
 * page's words and runs what they say, so the page and the card change together.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const page = readFileSync(join(root, 'examples/playground/content/components/approval-card.md'), 'utf8');
const [intro = '', ...sections] = page.split(/^### /m);

/** The page's text under a `###` heading. */
function section(heading: string) {
  const text = sections.find((part) => part.startsWith(`${heading}\n`));
  expect(text, `a "### ${heading}" section on the page`).toBeDefined();
  return text!;
}

const L = defaultLabels.approvalCard;
const ALL: ApprovalDecision[] = ['allow-once', 'allow-session', 'allow-always', 'deny-once', 'deny-always'];

describe('the ApprovalCard page: the pattern a lasting decision suggests', () => {
  // The page's examples, in its order, with a command each comes from.
  const SUGGESTED = [
    ['npm test -- --watch', 'npm test*'], // a program and its subcommand
    ['rm -rf build', 'rm -rf build'], // no subcommand: the whole command, not `rm*`
    ['node -e "…"', 'node -e "…"'], // runs what its arguments say: not `node*`
  ] as const;

  it('names the patterns the card suggests', () => {
    const forACommand = /For a command, [^;]*/.exec(section('Once, for the session or always'))?.[0] ?? '';
    const named = [...forACommand.matchAll(/`([^`]+)`/g)].map(([, code]) => code);
    expect(named).toEqual(SUGGESTED.map(([, pattern]) => pattern));
  });

  it.each(SUGGESTED)('for `%s`, A saves `%s`', async (command, pattern) => {
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<ApprovalCard toolName="run_command" input={{ command }} decisions={ALL} onDecide={onDecide} />);
    expect(screen.getByRole('textbox', { name: 'command matches' })).toHaveValue(pattern);
    screen.getByRole('group', { name: 'Run command' }).focus();
    await user.keyboard('a');
    expect(onDecide).toHaveBeenCalledWith({ decision: 'allow-always', args: { command: pattern } });
  });
});

describe('the ApprovalCard page: "Done editing" keeps the edit', () => {
  /** Edit the command to `npm test`, then close the editor. */
  async function editThenDone(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: L.editArguments }));
    await user.clear(screen.getByRole('textbox', { name: 'command' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), 'npm test');
    await user.click(screen.getByRole('button', { name: L.doneEditing }));
  }

  function setup() {
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(
      <ApprovalCard
        toolName="run_command"
        input={{ command: 'rm -rf build && npm test' }}
        editable
        onDecide={onDecide}
      />,
    );
    return { user, onDecide, card: screen.getByRole('group', { name: 'Run command' }) };
  }

  it('says so, and that "Undo edits" drops it', () => {
    const text = section('Edit the arguments, then approve');
    expect(text).toContain(`"${L.doneEditing}" closes the editor and keeps the edit`);
    expect(text).toContain(`with the note "${L.edited}"`);
    expect(text).toContain(`"${L.undoEdits}" drops the edit`);
  });

  it('closes the editor, shows the edit and approves it', async () => {
    const { user, onDecide, card } = setup();
    await editThenDone(user);
    expect(screen.queryByRole('textbox', { name: 'command' })).toBeNull();
    expect(card).toHaveTextContent('$npm test');
    expect(screen.getByText(L.edited)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenCalledWith({ decision: 'allow-once', input: { command: 'npm test' } });
  });

  it('drops the edit on "Undo edits"', async () => {
    const { user, onDecide, card } = setup();
    await editThenDone(user);
    await user.click(screen.getByRole('button', { name: L.undoEdits }));
    expect(card).toHaveTextContent('$rm -rf build && npm test');
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).toHaveBeenCalledWith({ decision: 'allow-once' });
  });

  it('says an edit approved on its card reaches the agent, and it does', async () => {
    // Approve all answers without a card's edit (below), so the page can't promise an edit is never dropped.
    expect(page).not.toContain('never dropped');
    expect(section('Edit the arguments, then approve')).toContain(
      '`ToolApprovalCard` offers editing only with `onEditInput`, the function that applies the edit, so an edit approved on its card reaches the agent.',
    );
    const part = toolPart('approval-requested', {
      toolName: 'run_command',
      toolCallId: 'c0',
      input: { command: 'rm -rf build && npm test' },
    });
    const onRespond = vi.fn<(response: ToolApprovalResponse) => void>();
    const onEditInput = vi.fn();
    const user = userEvent.setup();
    render(<ToolApprovalCard part={part} onRespond={onRespond} onEditInput={onEditInput} />);
    await editThenDone(user);
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onEditInput).toHaveBeenCalledWith('c0', { command: 'npm test' });
    expect(onRespond).toHaveBeenCalledWith({ id: 'approval_c0', approved: true });
  });

  it('says Approve all answers with the agent’s arguments, and it does', async () => {
    expect(section('Approve all')).toContain(
      "It answers with the agent's arguments and doesn't see an edit made on a card, so approve an edited call on its own card.",
    );
    const parts = ['rm -rf build && npm test', 'npm ci'].map((command, i) =>
      toolPart('approval-requested', { toolName: 'run_command', toolCallId: `c${i}`, input: { command } }),
    );
    const onRespond = vi.fn<(response: ToolApprovalResponse) => void>();
    const onEditInput = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <ToolApprovalBatch parts={parts} onRespond={onRespond} />
        <ToolApprovalCard part={parts[0]!} onRespond={onRespond} onEditInput={onEditInput} />
      </>,
    );
    await editThenDone(user);
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onEditInput).not.toHaveBeenCalled();
    expect(onRespond.mock.calls.map(([response]) => response)).toEqual([
      { id: 'approval_c0', approved: true },
      { id: 'approval_c1', approved: true },
    ]);
  });
});

describe('the ApprovalCard page: held keys, focus and the page-wide shortcut', () => {
  const text = () => section('Held keys, focus and the page-wide shortcut');

  /** A chat composer, with cards that mount after it, as tool calls do. */
  function Page({ cards = [] }: { cards?: Array<Partial<Parameters<typeof ApprovalCard>[0]>> }) {
    return (
      <>
        <textarea aria-label="Message" />
        <button type="button">Send</button>
        {cards.map((card, i) => (
          <ApprovalCard
            key={i}
            toolName="run_command"
            title={`Card ${i + 1}`}
            input={{ command: 'git push --force' }}
            decisions={ALL}
            {...card}
          />
        ))}
      </>
    );
  }

  it.each([
    ['Y in the card', () => screen.getByRole('group', { name: 'Card 1' }), '{y>4}'],
    ['Enter on Approve', () => screen.getByRole('button', { name: /^Approve/ }), '{Enter>4}'],
  ])('a held key decides once: holding %s does not confirm a critical action', async (_, target, keys) => {
    expect(text()).toContain(
      "A held key decides once: its repeats don't answer again or confirm a `critical` action, and neither does Enter held on a focused button",
    );
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<Page cards={[{ risk: 'critical', onDecide }]} />);
    target().focus();
    await user.keyboard(keys);
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Confirm approval/ })).toBeInTheDocument();
  });

  it('autoFocus leaves focus in a text field', async () => {
    expect(text()).toContain(
      "`autoFocus` moves focus to a card that arrives pending, but not out of a text field, so the letters someone is typing in a chat composer don't land on the card as shortcuts.",
    );
    const onDecide = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Page />);
    const composer = screen.getByRole('textbox', { name: 'Message' });
    await user.click(composer);
    await user.keyboard('plea');
    rerender(<Page cards={[{ autoFocus: true, onDecide }]} />);
    await user.keyboard('se stop');
    expect(composer).toHaveFocus();
    expect(composer).toHaveValue('please stop');
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('globalShortcut approves from anywhere on the page except a text field', async () => {
    expect(text()).toContain(
      '`globalShortcut` approves with ⌘ or Ctrl + Enter from anywhere on the page except a text field',
    );
    expect(intro).toContain(
      'With `globalShortcut`, ⌘ or Ctrl + Enter still approves from it, as from anywhere on the page but a text field.',
    );
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<Page cards={[{ globalShortcut: true, onDecide }]} />);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.keyboard('ship it{Control>}{Enter}{/Control}');
    expect(onDecide).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Send' }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onDecide).toHaveBeenCalledWith({ decision: 'allow-once' });
  });

  it('globalShortcut leaves ⌘/Ctrl+Enter to a text field of the card’s own editor', async () => {
    expect(text()).toContain("the text fields of the card's own argument editor count too.");
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<Page cards={[{ globalShortcut: true, editable: true, onDecide }]} />);
    await user.click(screen.getByRole('button', { name: L.editArguments }));
    await user.click(screen.getByRole('textbox', { name: 'command' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('a critical press stays armed until the second press, Escape, or focus leaving the card', async () => {
    expect(text()).toContain(
      'The first press on a `critical` action stays armed, with no time limit, until the second press, Escape, or focus leaving the card (or Approve all).',
    );
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<Page cards={[{ risk: 'critical', onDecide }]} />);
    const armed = () => screen.queryByRole('button', { name: /^Confirm approval/ });
    await user.dblClick(screen.getByRole('button', { name: /^Approve/ }));
    expect(armed()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(armed()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    expect(armed()).not.toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('with several pending cards, globalShortcut approves the latest to ask', async () => {
    expect(text()).toContain(
      "With several pending, as when `AgentMessage`'s `approvalProps` turns it on for parallel calls, the keys answer one card: the one they're pressed in, or else the latest to ask.",
    );
    const first = vi.fn();
    const second = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Page cards={[{ globalShortcut: true, onDecide: first }]} />);
    rerender(
      <Page
        cards={[
          { globalShortcut: true, onDecide: first },
          { globalShortcut: true, onDecide: second },
        ]}
      />,
    );
    // Focus is in neither card, as when the person has scrolled to the second one.
    screen.getByRole('button', { name: 'Send' }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
