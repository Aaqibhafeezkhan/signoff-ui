import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from '../src/approval-card';
import { DiffReview, type DiffReviewResult } from '../src/diff-review';
import { useDiffReview, type UseDiffReviewOptions } from '../src/use-diff-review';
import { ROUTE_NEW, ROUTE_OLD } from './fixtures';

const files = [
  { path: 'app/api/chat/route.ts', oldContent: ROUTE_OLD, newContent: ROUTE_NEW },
  { path: 'lib/ratelimit.ts', oldContent: '', newContent: "export const ratelimit = createLimiter('10 s');\n" },
];
const hunks = () => screen.getAllByRole('group', { name: /^Hunk /, hidden: true });
const fileOf = (path: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="signoff-diff-file"]')].find((el) =>
    el.textContent?.includes(path),
  )!;

/**
 * A click as WebKit (Safari, and every browser on iOS) makes one: a button or a checkbox takes no
 * focus, so focus goes to the closest focusable element around it, or to the page when there is none.
 */
function clickAsWebKit(control: HTMLElement) {
  const around = control.parentElement?.closest<HTMLElement>('[tabindex]');
  if (around) around.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.click(control);
}

/** A page with a review and a pending card that approves on ⌘/Ctrl+Enter from anywhere. */
function setup() {
  const user = userEvent.setup();
  const onSubmit = vi.fn<(result: DiffReviewResult) => void>();
  const onApprove = vi.fn();
  render(
    <>
      <ApprovalCard toolName="run_command" input={{ command: 'pnpm test' }} globalShortcut onApprove={onApprove} />
      <DiffReview files={files} onSubmit={onSubmit} />
    </>,
  );
  const review = screen.getByRole('region', { name: 'Review changes' });
  return { user, onSubmit, onApprove, review };
}

describe('DiffReview keeps focus when a click lands on a control that takes none', () => {
  it('can be focused, outside the tab order', () => {
    render(<DiffReview files={files} />);
    expect(screen.getByRole('region', { name: 'Review changes' })).toHaveAttribute('tabindex', '-1');
  });

  it.each([
    ['Accept all', () => screen.getByRole('button', { name: 'Accept all' })],
    ['Reject all', () => screen.getByRole('button', { name: 'Reject all' })],
    ['Accept file', () => within(fileOf('route.ts')).getByRole('button', { name: /^Accept file/ })],
    ['Reject file', () => within(fileOf('route.ts')).getByRole('button', { name: /^Reject file/ })],
    ['Viewed', () => within(fileOf('route.ts')).getByRole('checkbox', { name: /^Viewed/ })],
    ['Apply', () => screen.getByRole('button', { name: /^Apply/ })],
  ])('after a WebKit click on %s, ⌘ Enter applies the review, not the card, and J moves', async (_, control) => {
    const { user, onSubmit, onApprove, review } = setup();
    clickAsWebKit(control());
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onApprove).not.toHaveBeenCalled();
    // Once: Apply's own click has sent it already.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(review).toHaveFocus();
    await user.keyboard('j');
    expect(hunks()).toContain(document.activeElement);
  });

  it('goes back to the hunk last focused with J, as from a focused button in Chromium and Firefox', async () => {
    const { user, review } = setup();
    hunks()[0]!.focus();
    await user.keyboard('j');
    expect(hunks()[1]).toHaveFocus();
    clickAsWebKit(screen.getByRole('button', { name: 'Accept all' }));
    expect(review).toHaveFocus();
    await user.keyboard('j');
    expect(hunks()[1]).toHaveFocus();
  });

  it("after a click on a file header's text, in any browser, ⌘ Enter applies the review, not the card", async () => {
    const { user, onSubmit, onApprove, review } = setup();
    await user.click(within(fileOf('ratelimit.ts')).getByText('ratelimit.ts'));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onApprove).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(review).toHaveFocus();
    await user.keyboard('j');
    expect(hunks()[0]).toHaveFocus();
  });

  it("a review's own tabIndex wins", () => {
    render(<DiffReview files={files} tabIndex={0} />);
    expect(screen.getByRole('region', { name: 'Review changes' })).toHaveAttribute('tabindex', '0');
  });
});

describe('useDiffReview keeps focus in the element its root props are on', () => {
  function MyReview(props: UseDiffReviewOptions) {
    const review = useDiffReview(props);
    return (
      <section aria-label="My review" {...review.getRootProps()}>
        <h2>My review</h2>
        {review.items.map((item, index) => (
          <div key={item.id} {...review.getItemProps(index)}>
            <button {...review.getDecisionProps(index, 'accepted')}>Keep</button>
          </div>
        ))}
        <button {...review.getSubmitProps()}>Send</button>
      </section>
    );
  }

  it('gives the root tabIndex -1, so a click on it keeps the keys', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MyReview files={files} onSubmit={onSubmit} />);
    const root = screen.getByRole('region', { name: 'My review' });
    expect(root).toHaveAttribute('tabindex', '-1');
    await user.click(screen.getByRole('heading', { name: 'My review' }));
    expect(root).toHaveFocus();
    await user.keyboard('j');
    expect(hunks()[0]).toHaveFocus();
    await user.click(screen.getByRole('heading', { name: 'My review' }));
    const enter = fireEvent.keyDown(document.activeElement!, { key: 'Enter', metaKey: true });
    // Default prevented, so a card listening on the window does not take the same key.
    expect(enter).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
