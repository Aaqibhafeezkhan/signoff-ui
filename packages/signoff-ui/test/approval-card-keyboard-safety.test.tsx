import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import {
  ApprovalCard,
  ToolApprovalBatch,
  type ApprovalChoice,
  type ApprovalDecision,
  type ToolApprovalResponse,
} from '../src/approval-card';
import { assistant, toolPart } from './utils';

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

describe('ApprovalCard: a text field in a shadow root is a text field too', () => {
  // A web component's chat box: focus and the key events' target outside it are its host element.
  // At depth 2 the field's component sits in another one's shadow root, as in a component library.
  function shadowComposer(control: 'textarea' | 'button' = 'textarea', depth = 1) {
    const host = document.createElement('div');
    document.body.append(host);
    onTestFinished(() => host.remove());
    let root = host.attachShadow({ mode: 'open' });
    for (let level = 1; level < depth; level++) {
      const inner = document.createElement('div');
      root.append(inner);
      root = inner.attachShadow({ mode: 'open' });
    }
    const field = document.createElement(control);
    root.append(field);
    return { root, field };
  }

  it.each([
    ['one shadow root', 1],
    ['two nested shadow roots', 2],
  ] as const)('autoFocus leaves focus in a field %s deep, and typing there decides nothing', async (_, depth) => {
    const { root, field } = shadowComposer('textarea', depth);
    const onDecide = vi.fn();
    const user = userEvent.setup();
    field.focus();
    await user.keyboard('plea');
    render(<Page card={{ autoFocus: true, onDecide }} />);
    expect(root.activeElement).toBe(field);
    await user.keyboard('se stop');
    expect(onDecide).not.toHaveBeenCalled();
    expect(field).toHaveValue('please stop');
  });

  it.each([
    ['Control', 'one shadow root', 1],
    ['Meta', 'one shadow root', 1],
    ['Control', 'two nested shadow roots', 2],
  ] as const)('with globalShortcut, %s+Enter in a field %s deep does not approve', async (mod, _, depth) => {
    const { field } = shadowComposer('textarea', depth);
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<Page card={{ globalShortcut: true, onDecide }} />);
    field.focus();
    await user.keyboard(`ship it{${mod}>}{Enter}{/${mod}}`);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('a button in a shadow root is not a text field: autoFocus takes focus from it', () => {
    const { field } = shadowComposer('button');
    field.focus();
    render(<Page card={{ autoFocus: true, onDecide: vi.fn() }} />);
    expect(screen.getByRole('group', { name: 'Run command' })).toHaveFocus();
  });

  it('with globalShortcut, Control+Enter on a button in a shadow root approves once', async () => {
    const { field } = shadowComposer('button');
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<Page card={{ globalShortcut: true, onDecide }} />);
    field.focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(decisions(onDecide)).toEqual(['allow-once']);
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

/*
 * A critical action's first press arms it, and the confirmation waits for the person: no timer to
 * beat while a screen reader reads "Press approve again" (WCAG 2.2.1), until the second press,
 * Escape, or focus leaving the card. The second click of a double click is not a second press.
 */
describe('ApprovalCard: a critical confirmation waits for a second, separate press', () => {
  const armed = () => screen.queryByRole('button', { name: /^Confirm approval/ });

  it('stays armed with no time limit: a press a minute later confirms', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { onDecide, card } = setup({ risk: 'critical' });
    card.focus();
    fireEvent.keyDown(card, { key: 'y' });
    act(() => vi.advanceTimersByTime(60_000));
    expect(armed()).toHaveAttribute('data-decision', 'allow-once');
    fireEvent.keyDown(card, { key: 'y' });
    expect(decisions(onDecide)).toEqual(['allow-once']);
  });

  it.each([
    ['Approve', 'allow-once'],
    ['For this session', 'allow-session'],
    ['Always', 'allow-always'],
  ] as const)('a double click on %s arms it and does not confirm it', async (name, decision) => {
    const { user, onDecide } = setup({ risk: 'critical' });
    await user.dblClick(screen.getByRole('button', { name }));
    expect(onDecide).not.toHaveBeenCalled();
    expect(armed()).toHaveAttribute('data-decision', decision);
    // A later click is the second press.
    await user.click(armed()!);
    expect(decisions(onDecide)).toEqual([decision]);
  });

  it('Escape in the card disarms it: the next press arms it again', async () => {
    const { user, onDecide, card } = setup({ risk: 'critical' });
    card.focus();
    await user.keyboard('y');
    await user.keyboard('{Escape}');
    expect(armed()).not.toBeInTheDocument();
    await user.keyboard('y');
    expect(onDecide).not.toHaveBeenCalled();
    expect(armed()).toBeInTheDocument();
  });

  it('with globalShortcut, Escape outside the card disarms what ⌘/Ctrl+Enter armed there', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<Page card={{ risk: 'critical', globalShortcut: true, onDecide }} />);
    screen.getByRole('button', { name: 'Send' }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(armed()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(armed()).not.toBeInTheDocument();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('focus leaving the card disarms it; focus moving inside it does not', async () => {
    const onDecide = vi.fn<(choice: ApprovalChoice) => void>();
    const user = userEvent.setup();
    render(<Page card={{ risk: 'critical', onDecide }} />);
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    expect(armed()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).not.toHaveBeenCalled();
    await user.tab({ shift: true });
    expect(armed()).toBeInTheDocument();
    await user.click(armed()!);
    expect(decisions(onDecide)).toEqual(['allow-once']);
  });

  it('a card that asks again starts disarmed', async () => {
    const user = userEvent.setup();
    const card = (status: 'pending' | 'approved') => (
      <ApprovalCard toolName="run_command" input={{ command: 'rm -rf ~' }} risk="critical" status={status} />
    );
    const { rerender } = render(card('pending'));
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    rerender(card('approved'));
    rerender(card('pending'));
    expect(armed()).not.toBeInTheDocument();
  });

  it('new arguments start disarmed: the press was for the old ones', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    const card = (command: string) => (
      <ApprovalCard toolName="run_command" input={{ command }} risk="critical" onApprove={onApprove} />
    );
    const { rerender } = render(card('rm -rf build'));
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    // The same arguments, as a new object: still the same call.
    rerender(card('rm -rf build'));
    expect(armed()).toBeInTheDocument();
    rerender(card('rm -rf ~'));
    expect(armed()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('an edit made after the first press starts disarmed: the press was for the arguments before it', async () => {
    const { user, onDecide } = setup({ risk: 'critical', editable: true, input: { command: 'rm -rf build' } });
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(armed()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit arguments' }));
    // Opening the editor changes nothing yet: the press still stands for `rm -rf build`.
    expect(armed()).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'command' }));
    await user.type(screen.getByRole('textbox', { name: 'command' }), 'rm -rf ~');
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(armed()).not.toBeInTheDocument();
    // One press arms it for `rm -rf ~`; the next confirms it.
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).not.toHaveBeenCalled();
    await user.click(armed()!);
    expect(onDecide.mock.calls.map(([choice]) => choice)).toEqual([
      { decision: 'allow-once', input: { command: 'rm -rf ~' } },
    ]);
  });

  it('where a click does not focus the button (Safari), focus leaving the card still disarms it', () => {
    const { onDecide, card } = setup({ risk: 'critical' });
    // Safari focuses the nearest focusable element a click lands in, the card; fireEvent moves no focus.
    act(() => card.focus());
    fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(armed()).toBeInTheDocument();
    act(() => (document.activeElement as HTMLElement).blur());
    expect(armed()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onDecide).not.toHaveBeenCalled();
  });
});

describe('ToolApprovalBatch: Approve all over a critical call waits for a second, separate press', () => {
  const command = (cmd: string, id: string) =>
    toolPart('approval-requested', { toolName: 'run_command', toolCallId: id, input: { command: cmd } });
  const parts = [command('rm -rf ~', 'a'), command('npm test', 'b')];
  const armed = () => screen.queryByRole('button', { name: 'Confirm approve all' });

  function setupBatch() {
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Send</button>
        <ToolApprovalBatch
          parts={parts}
          onRespond={onRespond}
          tools={{
            run_command: {
              risk: (input) => ((input as { command: string }).command === 'rm -rf ~' ? 'critical' : 'low'),
            },
          }}
        />
      </>,
    );
    return { onRespond, user };
  }

  it('a double click on Approve all arms it and approves nothing', async () => {
    const { onRespond, user } = setupBatch();
    await user.dblClick(screen.getByRole('button', { name: 'Approve all' }));
    expect(onRespond).not.toHaveBeenCalled();
    expect(armed()).toBeInTheDocument();
    await user.click(armed()!);
    expect(onRespond).toHaveBeenCalledTimes(2);
  });

  it('stays armed with no time limit', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { onRespond } = setupBatch();
    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    act(() => vi.advanceTimersByTime(60_000));
    fireEvent.click(armed()!);
    expect(onRespond.mock.calls.map(([r]) => r)).toEqual([
      { id: 'approval_a', approved: true },
      { id: 'approval_b', approved: true },
    ]);
  });

  it('a call that arrives while it is armed needs a new first press', async () => {
    const onRespond = vi.fn<(r: ToolApprovalResponse) => void>();
    const user = userEvent.setup();
    const tools = { run_command: { risk: 'critical' as const } };
    const { rerender } = render(<ToolApprovalBatch parts={parts} onRespond={onRespond} tools={tools} />);
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(armed()).toBeInTheDocument();
    rerender(
      <ToolApprovalBatch parts={[...parts, command('git push --force', 'c')]} onRespond={onRespond} tools={tools} />,
    );
    expect(armed()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onRespond).not.toHaveBeenCalled();
  });

  it.each([
    ['Escape', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    [
      'focus leaving it',
      (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Send' })),
    ],
  ])('%s disarms it', async (_, leave) => {
    const { onRespond, user } = setupBatch();
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    await leave(user);
    expect(armed()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('where a click does not focus the button (Safari), focus leaving it still disarms it', () => {
    const { onRespond } = setupBatch();
    // Safari focuses the nearest focusable element a click lands in, so the group must be one for
    // focus to be in it at all; fireEvent, like Safari, leaves the button unfocused.
    act(() => screen.getByRole('group', { name: 'Approvals waiting' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(armed()).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Send' }).focus());
    expect(armed()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('the group is not in the tab order: its buttons are', () => {
    setupBatch();
    expect(screen.getByRole('group', { name: 'Approvals waiting' })).toHaveAttribute('tabindex', '-1');
  });
});

/*
 * With several pending cards, as parallel calls give, one ⌘/Ctrl+Enter answers one card: the one
 * the keys are pressed in, or else the latest to ask. It used to be the first that mounted,
 * wherever the person was looking.
 */
describe('ApprovalCard: with several pending cards, globalShortcut answers one', () => {
  function Cards({ count, approved, preview = false }: { count: number; approved: string[]; preview?: boolean }) {
    const [done, setDone] = useState<string[]>([]);
    return (
      <>
        <button type="button">Send</button>
        {Array.from({ length: count }, (_, i) => {
          const title = `Card ${i + 1}`;
          return (
            <ApprovalCard
              key={title}
              toolName="run_command"
              title={title}
              input={{ command: `pnpm step-${i + 1}` }}
              preview={preview ? <button type="button">Details {i + 1}</button> : undefined}
              globalShortcut
              status={done.includes(title) ? 'approved' : 'pending'}
              onApprove={() => {
                approved.push(title);
                setDone((d) => [...d, title]);
              }}
            />
          );
        })}
      </>
    );
  }

  it('outside the cards, it approves the latest to ask, then the one before it', async () => {
    const approved: string[] = [];
    const user = userEvent.setup();
    render(<Cards count={3} approved={approved} />);
    for (let press = 0; press < 2; press++) {
      screen.getByRole('button', { name: 'Send' }).focus();
      await user.keyboard('{Control>}{Enter}{/Control}');
    }
    expect(approved).toEqual(['Card 3', 'Card 2']);
  });

  it('a card that arrives later takes it over', async () => {
    const approved: string[] = [];
    const user = userEvent.setup();
    const { rerender } = render(<Cards count={1} approved={approved} />);
    rerender(<Cards count={2} approved={approved} />);
    screen.getByRole('button', { name: 'Send' }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(approved).toEqual(['Card 2']);
  });

  /** A critical `rm -rf ~` card, and with `second`, a card that arrives after it; both answer once. */
  function Arrival({ second, approved }: { second: boolean; approved: string[] }) {
    const [done, setDone] = useState<string[]>([]);
    const card = (title: string, command: string, risk?: 'critical') => (
      <ApprovalCard
        toolName="run_command"
        title={title}
        input={{ command }}
        risk={risk}
        globalShortcut
        status={done.includes(title) ? 'approved' : 'pending'}
        onApprove={() => {
          approved.push(title);
          setDone((d) => [...d, title]);
        }}
      />
    );
    return (
      <>
        <button type="button">Send</button>
        {card('Card A', 'rm -rf ~', 'critical')}
        {second && card('Card B', 'pnpm lint')}
      </>
    );
  }
  const armedA = () =>
    within(screen.getByRole('group', { name: 'Card A' })).queryByRole('button', { name: /^Confirm approval/ });

  it('a press armed from outside a critical card is dropped when a newer card takes the keys over', async () => {
    const approved: string[] = [];
    const user = userEvent.setup();
    const { rerender } = render(<Arrival second={false} approved={approved} />);
    screen.getByRole('button', { name: 'Send' }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(armedA()).toBeInTheDocument();
    rerender(<Arrival second approved={approved} />);
    expect(armedA()).not.toBeInTheDocument();
    // Card B's press, then Card A's first again: A's `rm -rf ~` takes two more, not one.
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(approved).toEqual(['Card B']);
    expect(armedA()).toBeInTheDocument();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(approved).toEqual(['Card B', 'Card A']);
  });

  it('a press armed with focus in the card stays when a newer card arrives', async () => {
    const approved: string[] = [];
    const user = userEvent.setup();
    const { rerender } = render(<Arrival second={false} approved={approved} />);
    await user.click(screen.getByRole('button', { name: /^Approve/ }));
    rerender(<Arrival second approved={approved} />);
    expect(armedA()).toBeInTheDocument();
    await user.click(armedA()!);
    expect(approved).toEqual(['Card A']);
  });

  it('pressed in a card’s custom preview, it approves that card, not the latest', async () => {
    const approved: string[] = [];
    const user = userEvent.setup();
    render(<Cards count={3} approved={approved} preview />);
    screen.getByRole('button', { name: 'Details 2' }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(approved).toEqual(['Card 2']);
  });

  it('AgentMessage with approvalProps: one press answers the last of two parallel calls', async () => {
    const onToolApproval = vi.fn<(r: ToolApprovalResponse) => void>();
    const user = userEvent.setup();
    const call = (id: string, cmd: string) =>
      toolPart('approval-requested', { toolName: 'run_command', toolCallId: id, input: { command: cmd } });
    render(
      <AgentMessage
        message={assistant([call('p1', 'pnpm test'), call('p2', 'pnpm lint')])}
        onToolApproval={onToolApproval}
        approvalProps={{ globalShortcut: true }}
      />,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onToolApproval.mock.calls.map(([r]) => r)).toEqual([{ id: 'approval_p2', approved: true }]);
  });
});
