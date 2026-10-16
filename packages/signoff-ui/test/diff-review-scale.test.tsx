import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { DiffReview, type DiffReviewResult } from '../src/diff-review';
import { resetDiffWorkers } from '../src/lib/diff-async';
import { answerDiffRequest, type DiffWorkerRequest } from '../src/lib/diff-worker';
import { gapLines } from '../src/lib/review';
import { axe } from './utils';

// Counts the unchanged lines the review makes to show: a render that skips a gap makes none.
vi.mock('../src/lib/review', async (importOriginal) => {
  const actual = await importOriginal<{ gapLines: typeof gapLines }>();
  return { ...actual, gapLines: vi.fn(actual.gapLines) };
});

const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, i) => `export const ${prefix}${i} = compute(${i});`);
const text = (rows: string[]) => rows.join('\n') + '\n';

/** 100 small hunks, 797 lines: diffed while rendering (few edits), virtualized (many rows). */
const localEdit = () => {
  const rows = lines(5_000, 'a');
  return {
    path: 'src/big.ts',
    oldContent: text(rows),
    newContent: text(rows.map((l, i) => (i % 50 === 0 ? l.replace('compute', 'measure') : l))),
  };
};
/** One line changed in the middle of `n`: two gaps of about `n / 2` unchanged lines. */
const oneChange = (n: number) => {
  const rows = lines(n, 'a');
  return {
    path: 'src/huge.ts',
    oldContent: text(rows),
    newContent: text(rows.map((l, i) => (i === n / 2 ? l.replace('compute', 'measure') : l))),
  };
};
/** Every tenth line of `n` changed: `n / 10` hunks. Up to 150 of them, the file is diffed while rendering. */
const dense = (n: number, path = 'src/dense.ts') => {
  const rows = lines(n, 'a');
  return {
    path,
    oldContent: text(rows),
    newContent: text(rows.map((l, i) => (i % 10 === 0 ? l.replace('compute', 'measure') : l))),
  };
};
/** A minified bundle's line, about `chars` long, changed at its end. */
const minified = (chars: number) => {
  let line = '';
  for (let i = 0; line.length < chars; i++) line += `var a${i}=f(${i},"s${i}");`;
  return { path: 'dist/bundle.min.js', oldContent: `${line}\n`, newContent: `${line}x\n` };
};
/** 800 lines changed: more than a render may diff, so it is diffed in the background. */
const rewrite = (n = 400) => ({
  path: 'src/rewrite.ts',
  oldContent: text(lines(n, 'a')),
  newContent: text(lines(n, 'b')),
});

const hunks = () => screen.getAllByRole('group', { name: /^Hunk/ });
const chunks = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('[data-slot="signoff-diff-chunk"]'),
];

/** An IntersectionObserver the test drives: `report` says which chunks are near the viewport. */
class FakeObserver {
  static current: FakeObserver[] = [];
  targets = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.current.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  static report(el: Element, near: boolean, height = 0) {
    for (const observer of FakeObserver.current) {
      if (!observer.targets.has(el)) continue;
      const entry = { target: el, isIntersecting: near, boundingClientRect: { height } } as IntersectionObserverEntry;
      act(() => observer.callback([entry], observer as unknown as IntersectionObserver));
    }
  }
}

describe('DiffReview at scale', () => {
  describe('with IntersectionObserver', () => {
    beforeEach(() => {
      FakeObserver.current = [];
      vi.stubGlobal('IntersectionObserver', FakeObserver);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('renders the rows near the screen and keeps the rest as text with their height', () => {
      const { container } = render(<DiffReview files={[localEdit()]} />);
      expect(hunks()).toHaveLength(100);
      const all = chunks(container);
      const rendered = all.filter((c) => c.hasAttribute('data-rendered'));
      // The first 100 rows render before anything is measured; the rest wait for the viewport.
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(all.length / 4);
      const far = all.at(-1)!;
      expect(far.querySelector('[data-line]')).toBeNull();
      // Eight lines of 20px: a change with three lines of context on each side.
      expect(far.style.height).toBe(`${8 * 20}px`);
      // A screen reader still reads every line, with what happened to it.
      expect(far.textContent).toBe(
        [
          'export const a4947 = compute(4947);',
          'export const a4948 = compute(4948);',
          'export const a4949 = compute(4949);',
          'Removed: export const a4950 = compute(4950);',
          'Added: export const a4950 = measure(4950);',
          'export const a4951 = compute(4951);',
          'export const a4952 = compute(4952);',
          'export const a4953 = compute(4953);',
        ].join('\n'),
      );
    });

    it('renders a chunk as it comes near, and keeps its measured height once it leaves', () => {
      const { container } = render(<DiffReview files={[localEdit()]} />);
      const far = chunks(container).at(-1)!;
      FakeObserver.report(far, true);
      expect(far.querySelectorAll('[data-line]')).toHaveLength(8);
      FakeObserver.report(far, false, 333);
      expect(far.querySelector('[data-line]')).toBeNull();
      expect(far.style.height).toBe('333px');
    });

    it('keeps a chunk that holds focus rendered', () => {
      const { container } = render(<DiffReview files={[localEdit()]} />);
      const first = chunks(container)[0]!;
      const row = first.querySelector<HTMLElement>('[data-line]')!;
      row.tabIndex = -1;
      row.focus();
      FakeObserver.report(first, false, 200);
      expect(first.querySelector('[data-line]')).not.toBeNull();
    });

    // A hundred hunks in jsdom: slow on shared CI runners, so these two get time.
    it('moves through every hunk from the keyboard, rendered or not', { timeout: 30_000 }, async () => {
      const user = userEvent.setup();
      render(<DiffReview files={[localEdit()]} autoAdvance={false} />);
      const all = hunks();
      all[0]!.focus();
      for (let i = 0; i < 98; i++) fireEvent.keyDown(document.activeElement!, { key: 'j' });
      await user.keyboard('j');
      expect(all[99]).toHaveFocus();
      await user.keyboard('a');
      expect(all[99]).toHaveAttribute('data-decision', 'accepted');
      expect(all[99]).toHaveAccessibleName('Hunk 100 of 100, src/big.ts, lines 4948 to 4954, accepted');
    });

    it('virtualizes split view too, reading each line once', () => {
      const { container } = render(<DiffReview files={[localEdit()]} view="split" />);
      const far = chunks(container).at(-1)!;
      expect(far.querySelector('[data-line]')).toBeNull();
      // The removed and added line share a row: 7 rows, 8 lines read.
      expect(far.style.height).toBe(`${7 * 20}px`);
      expect(far.textContent!.split('\n')).toHaveLength(8);
      FakeObserver.report(far, true);
      expect(far.querySelectorAll('[data-line]')).toHaveLength(14);
    });

    it('has no axe violations with chunks off screen', { timeout: 30_000 }, async () => {
      const { container } = render(<DiffReview files={[localEdit()]} onSubmit={() => {}} />);
      expect(await axe(container)).toHaveNoViolations();
    });

    // 'Show all' on a 20,000-line file with one change rendered all 20,000 lines: 80,000 elements.
    it(
      "renders the lines 'Show all' shows near the screen, and keeps the rest as text",
      { timeout: 30_000 },
      async () => {
        const user = userEvent.setup();
        const { container } = render(<DiffReview files={[oneChange(20_000)]} />);
        for (const button of screen.getAllByRole('button', { name: /^Show all/ })) await user.click(button);
        const gaps = [...container.querySelectorAll<HTMLElement>('[data-slot="signoff-diff-gap"]')];
        const rows = () => container.querySelectorAll('[data-slot="signoff-diff-gap"] [data-line]').length;
        // The first hundred of each gap render; the others are chunks of text with their height.
        expect(rows()).toBe(200);
        const far = chunks(gaps[1]!).at(-1)!;
        expect(far.querySelector('[data-line]')).toBeNull();
        expect(far.style.height).toBe(`${far.textContent!.split('\n').length * 20}px`);
        // A screen reader and find-in-page still have every line.
        expect(gaps[0]!.textContent).toContain('export const a0 = compute(0);');
        expect(far.textContent).toContain('export const a19999 = compute(19999);');
        FakeObserver.report(far, true);
        expect(far.querySelectorAll('[data-line]').length).toBeGreaterThan(0);
        expect(rows()).toBeLessThan(300);
        expect(await axe(gaps[0]!)).toHaveNoViolations();
      },
    );

    it('shows split view’s unchanged lines in chunks too, reading each line once', async () => {
      const user = userEvent.setup();
      const { container } = render(<DiffReview files={[oneChange(2_000)]} view="split" />);
      await user.click(screen.getAllByRole('button', { name: /^Show all/ })[0]!);
      const gap = container.querySelector<HTMLElement>('[data-slot="signoff-diff-gap"]')!;
      const far = chunks(gap).at(-1)!;
      expect(far.querySelector('[data-line]')).toBeNull();
      // A row a line, read once.
      const read = far.textContent!.split('\n');
      expect(far.style.height).toBe(`${read.length * 20}px`);
      FakeObserver.report(far, true);
      // Each line on both sides, the right one hidden from a screen reader.
      expect(far.querySelectorAll('[data-line]')).toHaveLength(read.length * 2);
      expect(far.querySelectorAll('[data-line][aria-hidden="true"]')).toHaveLength(read.length);
    });
  });

  it("renders every line 'Show all' shows once mounted where there is no IntersectionObserver", async () => {
    const user = userEvent.setup();
    const { container } = render(<DiffReview files={[oneChange(1_000)]} />);
    await user.click(screen.getAllByRole('button', { name: /^Show all/ })[0]!);
    const gap = container.querySelector('[data-slot="signoff-diff-gap"]')!;
    await waitFor(() => expect(chunks(gap as HTMLElement).every((c) => c.hasAttribute('data-rendered'))).toBe(true));
    // Lines 1 to 497: the gap up to the hunk's three lines of context.
    expect(gap.querySelectorAll('[data-line]')).toHaveLength(497);
  });

  // A 1.3 MB minified line rendered 750,000 spans, one per token, and froze the page for seconds.
  it('shows a very long line as plain text, not an element per token', () => {
    const { container } = render(<DiffReview files={[minified(100_000)]} />);
    const removed = container.querySelector('[data-line="del"]')!;
    // What a screen reader hears first, and the line.
    expect(removed.querySelectorAll('span span')).toHaveLength(2);
    expect(removed.textContent).toContain('var a0=f(0,"s0");');
  });

  it('keeps word highlights on a long line, without syntax colors', () => {
    const line = 'x'.repeat(3_000);
    const { container } = render(
      <DiffReview
        files={[{ path: 'a.js', oldContent: `const a = "${line}";\n`, newContent: `const b = "${line}";\n` }]}
      />,
    );
    const added = container.querySelector('[data-line="add"]')!;
    expect(added.querySelector('.bg-signoff-add-strong')).toHaveTextContent('b');
    expect(added.querySelector('[class*="text-signoff-code-"]')).toBeNull();
  });

  // A thousand hunks rendered in one task, which blocked the page for a quarter of a second.
  it('renders a hundred hunks, then the rest in the tasks after', async () => {
    const { container } = render(<DiffReview files={[dense(1_400)]} />);
    expect(hunks()).toHaveLength(100);
    // Named and counted as the whole review meanwhile.
    expect(hunks()[0]).toHaveAccessibleName(/^Hunk 1 of 140,/);
    expect(container).toHaveTextContent('1 file · 140 hunks');
    await waitFor(() => expect(hunks()).toHaveLength(140));
  });

  it('renders the hunk J moves to before its batch, and focus follows', () => {
    render(<DiffReview files={[dense(1_400), dense(100, 'src/next.ts')]} autoAdvance={false} />);
    const all = hunks();
    expect(all).toHaveLength(100);
    all[99]!.focus();
    fireEvent.keyDown(all[99]!, { key: 'j' });
    expect(document.activeElement).toHaveAccessibleName(/^Hunk 101 of 150,/);
    // Shift+J, to the next file's first hunk, further on.
    fireEvent.keyDown(document.activeElement!, { key: 'J', shiftKey: true });
    expect(document.activeElement).toHaveAccessibleName(/^Hunk 141 of 150, src\/next\.ts,/);
  });

  // 380 hunks in jsdom: slow on shared CI runners, so these get time.
  const threeFiles = () => [dense(1_400, 'src/a.ts'), dense(1_400, 'src/b.ts'), dense(1_000, 'src/c.ts')];
  const allHunks = (container: HTMLElement) => container.querySelectorAll('[data-slot="signoff-diff-hunk"]');

  // The active item starts past folded files, ahead of the batches: they stopped there, at its hunk.
  it('renders every hunk after files that start folded', { timeout: 30_000 }, async () => {
    const { container } = render(
      <DiffReview files={threeFiles()} defaultViewed={{ 'src/a.ts': true, 'src/b.ts': true }} />,
    );
    await waitFor(() => expect(allHunks(container)).toHaveLength(380), { timeout: 20_000 });
    // The folded files' hunks are there, hidden; the third file shows all of its own.
    expect(hunks()).toHaveLength(100);
    expect(hunks()[0]).toHaveAccessibleName(/^Hunk 281 of 380, src\/c\.ts,/);
  });

  it('hydrates folded files and the batch the active item is in, then the rest', { timeout: 30_000 }, async () => {
    const files = threeFiles();
    const viewed = { 'src/a.ts': true, 'src/b.ts': true };
    const container = document.createElement('div');
    container.innerHTML = renderToString(<DiffReview files={files} defaultViewed={viewed} />);
    document.body.append(container);
    onTestFinished(() => container.remove());
    expect(allHunks(container)).toHaveLength(300);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => errors.mockRestore());
    const root = await act(async () => hydrateRoot(container, <DiffReview files={files} defaultViewed={viewed} />));
    onTestFinished(() => act(() => root.unmount()));
    await waitFor(() => expect(allHunks(container)).toHaveLength(380), { timeout: 20_000 });
    expect(errors).not.toHaveBeenCalled();
  });

  // Shift+J twice ahead of the batches stopped them, and K unmounted the hunk it left.
  it('renders every hunk after J jumps far ahead, and keeps the one it left', { timeout: 30_000 }, async () => {
    const { container } = render(<DiffReview files={threeFiles()} autoAdvance={false} />);
    expect(allHunks(container)).toHaveLength(100);
    hunks()[0]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'J', shiftKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'J', shiftKey: true });
    expect(document.activeElement).toHaveAccessibleName(/^Hunk 281 of 380, src\/c\.ts,/);
    fireEvent.keyDown(document.activeElement!, { key: 'k' });
    expect(document.activeElement).toHaveAccessibleName(/^Hunk 280 of 380, src\/b\.ts,/);
    expect(screen.getByRole('group', { name: /^Hunk 281 of 380,/ })).toBeInTheDocument();
    await waitFor(() => expect(allHunks(container)).toHaveLength(380), { timeout: 20_000 });
  });

  it('renders on the server what the client hydrates, then the rest of the hunks', async () => {
    const files = [dense(1_400)];
    const container = document.createElement('div');
    container.innerHTML = renderToString(<DiffReview files={files} />);
    document.body.append(container);
    onTestFinished(() => container.remove());
    expect(container.querySelectorAll('[data-slot="signoff-diff-hunk"]')).toHaveLength(100);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => errors.mockRestore());
    const root = await act(async () => hydrateRoot(container, <DiffReview files={files} />));
    onTestFinished(() => act(() => root.unmount()));
    await waitFor(() => expect(container.querySelectorAll('[data-slot="signoff-diff-hunk"]')).toHaveLength(140));
    expect(errors).not.toHaveBeenCalled();
  });

  // Every render of the review, a decision or a streamed message around it, made each gap's lines again.
  it('does not render its gaps again when the review renders for something else', async () => {
    const user = userEvent.setup();
    const file = oneChange(200);
    // A new array and change on every render, as a tool's renderer passes them.
    const ui = (title: string) => <DiffReview files={[{ ...file }]} title={title} />;
    const { container, rerender } = render(ui('Review'));
    await user.click(screen.getAllByRole('button', { name: /^Show all/ })[0]!);
    expect(container.querySelector('[data-slot="signoff-diff-gap"]')).toHaveTextContent(
      'export const a10 = compute(10);',
    );
    const made = vi.mocked(gapLines).mock.calls.length;
    rerender(ui('Review the change'));
    await user.click(screen.getByRole('button', { name: 'Accept hunk 1' }));
    expect(vi.mocked(gapLines).mock.calls.length).toBe(made);
  });

  it('renders every row once mounted where there is no IntersectionObserver', async () => {
    const { container } = render(<DiffReview files={[localEdit()]} />);
    await waitFor(() => expect(chunks(container).every((c) => c.hasAttribute('data-rendered'))).toBe(true));
    expect(container.querySelectorAll('[data-line]')).toHaveLength(797);
  });

  it('does not virtualize a small review', () => {
    const { container } = render(<DiffReview files={[{ path: 'a.ts', oldContent: 'a\nb\n', newContent: 'a\nB\n' }]} />);
    expect(chunks(container)).toEqual([]);
  });

  it('shows a large file as being compared, then its hunks, with Apply waiting for it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(result: DiffReviewResult) => void>();
    // A worker that answers when the test says so.
    const held: Array<() => void> = [];
    class HeldWorker extends EventTarget {
      postMessage(request: DiffWorkerRequest) {
        held.push(() => this.dispatchEvent(new MessageEvent('message', { data: answerDiffRequest(request) })));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', HeldWorker);
    const small = { path: 'a.ts', oldContent: 'a\n', newContent: 'A\n' };
    render(<DiffReview files={[small, rewrite()]} onSubmit={onSubmit} diffWorker={() => new Worker('held')} />);
    const busy = () => document.querySelector('[aria-busy="true"]');
    expect(screen.getByText('Comparing changes…').closest('[data-slot="signoff-diff-file"]')).toBe(busy());
    expect(screen.getByText(/2 files · 1 hunk so far/)).toBeInTheDocument();
    // The file already compared can be reviewed; applying waits for the rest.
    expect(hunks()).toHaveLength(1);
    const apply = screen.getByRole('button', { name: /^Apply/ });
    expect(apply).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Accept all' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(apply);
    await user.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Accept hunk 1' }));
    // Decisions are announced meanwhile: nothing busy holds the live region back.
    expect(screen.getByRole('status')).toHaveTextContent('Hunk 1 of 1 accepted. All hunks reviewed.');
    expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => held[0]!());
    await waitFor(() => expect(busy()).toBeNull());
    expect(screen.queryByText('Comparing changes…')).not.toBeInTheDocument();
    expect(hunks()).toHaveLength(2);
    expect(apply).not.toHaveAttribute('aria-disabled');
    await user.click(apply);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ accepted: 1, pending: 1 });
    vi.unstubAllGlobals();
    resetDiffWorkers();
  });

  it('says so when a file falls back to one replacing hunk', async () => {
    render(<DiffReview files={[rewrite()]} maxEditLength={500} diffWorker={false} />);
    await screen.findByText(/Too many changes to compare line by line/);
    expect(hunks()).toHaveLength(1);
    expect(screen.getByText(/1 file · 1 hunk/)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="signoff-diff-file"]')).toHaveAttribute('data-fallback', 'replace');
  });

  it('drops a background result for a file that changed meanwhile', async () => {
    const { rerender } = render(<DiffReview files={[rewrite(400)]} diffWorker={false} />);
    rerender(<DiffReview files={[rewrite(401)]} diffWorker={false} />);
    await waitFor(() => expect(hunks()).toHaveLength(1));
    expect(hunks()[0]).toHaveAccessibleName(/lines 1 to 401/);
  });

  it('renders the same on the server and the client, so hydration keeps the page', async () => {
    const files = [localEdit(), rewrite()];
    const html = renderToString(<DiffReview files={files} />);
    expect(html).toContain('Comparing changes…');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await act(async () => hydrateRoot(container, <DiffReview files={files} diffWorker={false} />));
    await waitFor(() => expect(container.textContent).not.toContain('Comparing changes…'));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    act(() => root.unmount());
    container.remove();
  });
});
