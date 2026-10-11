import { act, fireEvent, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPart, ToolTimings } from '../src/lib/ai';
import { ToolCallTimeline, type ToolMeta } from '../src/tool-call-timeline';
import { axe, toolPart } from './utils';

/*
 * A run of thousands of tool calls: the timeline renders only the calls near the screen, moves by
 * index from the keyboard, and renders again only the calls that change.
 */

const calls = (count: number, state: Parameters<typeof toolPart>[0] = 'output-available') =>
  Array.from({ length: count }, (_, i) => toolPart(state, { toolName: 'read_file', toolCallId: `call-${i}` }));

const rendered = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('[data-slot="signoff-tool-call"]'),
];
const placeholders = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('[data-slot="signoff-tool-call-chunk"]'),
];
const triggerOf = (container: HTMLElement, position: number) =>
  container.querySelector<HTMLButtonElement>(
    `[data-slot="signoff-tool-call"][aria-posinset="${position}"] [data-slot="signoff-tool-call-trigger"]`,
  );

/** An IntersectionObserver the test drives: `report` says whether an element is near the viewport. */
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
  static report(elements: Element[], near: boolean) {
    for (const observer of FakeObserver.current) {
      const entries = elements
        .filter((el) => observer.targets.has(el))
        .map((target) => ({ target, isIntersecting: near }) as IntersectionObserverEntry);
      if (entries.length) act(() => observer.callback(entries, observer as unknown as IntersectionObserver));
    }
  }
}

describe('ToolCallTimeline in a long run', () => {
  beforeEach(() => {
    FakeObserver.current = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the calls near the screen, and says where each is in the whole list', () => {
    const { container } = render(<ToolCallTimeline parts={calls(2000)} />);
    // The first and the last chunk render before anything is measured; the rest wait for the viewport.
    const items = rendered(container);
    expect(items).toHaveLength(50);
    expect(items[0]).toHaveAttribute('aria-posinset', '1');
    expect(items.at(-1)).toHaveAttribute('aria-posinset', '2000');
    for (const item of items) expect(item).toHaveAttribute('aria-setsize', '2000');
    // The rest: one empty item a chunk, as tall as its calls are estimated to be, and hidden.
    const gaps = placeholders(container);
    expect(gaps).toHaveLength(78);
    expect(gaps[0]).toHaveAttribute('aria-hidden', 'true');
    expect(gaps[0]!.style.height).toBe(`${25 * 40}px`);
    expect(screen.getByRole('list', { name: 'Tool calls' })).toBeInTheDocument();
  });

  it('renders a chunk when it comes near the screen, and keeps its height when it leaves', () => {
    const { container } = render(<ToolCallTimeline parts={calls(2000)} />);
    const gap = placeholders(container)[0]!;
    FakeObserver.report([gap], true);
    expect(triggerOf(container, 26)).toBeInTheDocument();
    expect(rendered(container)).toHaveLength(75);
    // Leaving, it keeps the height its calls had: from the top of the first to the bottom of the last.
    const chunk = rendered(container).filter((item) => {
      const at = Number(item.getAttribute('aria-posinset'));
      return at >= 26 && at <= 50;
    });
    chunk.forEach((item, i) =>
      vi
        .spyOn(item, 'getBoundingClientRect')
        .mockReturnValue({ top: 1000 + 40 * i, bottom: i === 24 ? 2012 : 1040 + 40 * i } as DOMRect),
    );
    FakeObserver.report(chunk, false);
    expect(triggerOf(container, 26)).toBeNull();
    expect(placeholders(container)[0]!.style.height).toBe('1012px');
  });

  it('keeps a chunk rendered while it holds focus, an open call or a call still going', async () => {
    const user = userEvent.setup();
    const parts = calls(2000);
    parts[30] = toolPart('input-available', { toolName: 'read_file', toolCallId: 'call-30' });
    const { container } = render(<ToolCallTimeline parts={parts} defaultExpanded={['call-1000']} />);
    // The running call's chunk and the open call's chunk render with the first and the last.
    expect(triggerOf(container, 31)).toBeInTheDocument();
    expect(triggerOf(container, 1001)).toHaveAttribute('aria-expanded', 'true');
    // Focus keeps the first chunk rendered after it leaves the screen.
    await user.click(triggerOf(container, 2)!);
    await user.click(triggerOf(container, 2)!);
    FakeObserver.report(rendered(container).slice(0, 25), false);
    expect(triggerOf(container, 2)).toHaveFocus();
  });

  it('moves between calls by index from the keyboard, rendering a call that was not, in view', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = render(<ToolCallTimeline parts={calls(2000)} />);
    // Call 26 begins the second chunk, which is not rendered.
    expect(triggerOf(container, 26)).toBeNull();
    triggerOf(container, 25)!.focus();
    await user.keyboard('{ArrowDown}');
    expect(triggerOf(container, 26)).toHaveFocus();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    await user.keyboard('{End}');
    expect(triggerOf(container, 2000)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(triggerOf(container, 1)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(triggerOf(container, 2000)).toHaveFocus();
    // Home, from the end, once the first chunk has left the screen.
    FakeObserver.report(rendered(container).slice(0, 25), false);
    expect(triggerOf(container, 1)).toBeNull();
    await user.keyboard('{Home}');
    expect(triggerOf(container, 1)).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(5);
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('slides in the calls it renders first and those that arrive, not a chunk rendered again', () => {
    const slides = (item: Element | null) => item?.classList.contains('motion-safe:animate-signoff-enter');
    const parts = calls(400);
    const { container, rerender } = render(<ToolCallTimeline parts={parts} />);
    expect(slides(triggerOf(container, 1)!.closest('li'))).toBe(true);
    // A chunk the reader scrolls to: its calls were there from the start, so they just appear.
    FakeObserver.report([placeholders(container)[0]!], true);
    expect(slides(triggerOf(container, 26)!.closest('li'))).toBe(false);
    // A call that arrives slides in, like any new call.
    rerender(<ToolCallTimeline parts={[...parts, ...calls(401).slice(400)]} />);
    expect(slides(triggerOf(container, 401)!.closest('li'))).toBe(true);
    // The first chunk, leaving the screen and coming back.
    FakeObserver.report(rendered(container).slice(0, 25), false);
    FakeObserver.report([placeholders(container)[0]!], true);
    expect(slides(triggerOf(container, 1)!.closest('li'))).toBe(false);
  });

  it('has no axe violations with chunks not rendered', async () => {
    const { container } = render(<ToolCallTimeline parts={calls(400)} />);
    expect(placeholders(container).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders the same on the server and the client, so hydration keeps the page', async () => {
    const parts = calls(400);
    const html = renderToString(<ToolCallTimeline parts={parts} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    expect(rendered(container)).toHaveLength(50);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await act(async () => hydrateRoot(container, <ToolCallTimeline parts={parts} />));
    expect(errors).not.toHaveBeenCalled();
    expect(rendered(container)).toHaveLength(50);
    expect(rendered(container)[0]).toHaveAttribute('aria-setsize', '400');
    errors.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  it('renders every call where there is no IntersectionObserver', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<ToolCallTimeline parts={calls(400)} />);
    expect(rendered(container)).toHaveLength(400);
    expect(placeholders(container)).toEqual([]);
  });

  it('leaves a short timeline as it was: every call, no positions', () => {
    const { container } = render(<ToolCallTimeline parts={calls(150)} />);
    expect(rendered(container)).toHaveLength(150);
    expect(placeholders(container)).toEqual([]);
    expect(rendered(container)[0]).not.toHaveAttribute('aria-posinset');
    expect(rendered(container)[0]).not.toHaveAttribute('aria-setsize');
  });
});

describe('ToolCallTimeline renders again only the calls that change', () => {
  /** Counts the calls' renders: the summary is read once each time a call renders. */
  const counting = () => {
    const summary = vi.fn((input: unknown, _part: ToolPart) => (input as { query: string }).query);
    const tools: Record<string, ToolMeta> = { read_file: { summary } };
    return { summary, tools };
  };

  it('when a call is appended', () => {
    const { summary, tools } = counting();
    const parts = calls(30);
    const { rerender } = render(<ToolCallTimeline parts={parts} tools={tools} />);
    summary.mockClear();
    rerender(<ToolCallTimeline parts={[...parts, ...calls(31).slice(30)]} tools={tools} />);
    // The new call (again once its timing is measured), and the one before it, no longer last: its
    // connector line shows.
    expect(new Set(summary.mock.calls.map(([, part]) => part.toolCallId))).toEqual(new Set(['call-29', 'call-30']));
  });

  it('when a running call’s clock ticks', () => {
    vi.useFakeTimers();
    const { summary, tools } = counting();
    const parts = [...calls(30), toolPart('input-available', { toolName: 'read_file', toolCallId: 'running' })];
    render(<ToolCallTimeline parts={parts} tools={tools} />);
    act(() => vi.advanceTimersByTime(100));
    summary.mockClear();
    act(() => vi.advanceTimersByTime(300));
    expect(new Set(summary.mock.calls.map(([, part]) => part.toolCallId))).toEqual(new Set(['running']));
    vi.useRealTimers();
  });
});

describe('ToolCallTimeline’s waterfall', () => {
  it('places each bar from its call’s times and the span the list gives it', () => {
    const now = Date.now();
    const parts = calls(3);
    const timings: ToolTimings = {
      'call-0': { startedAt: now - 4000, endedAt: now - 3000 },
      'call-1': { startedAt: now - 3000, endedAt: now - 2000 },
      'call-2': { startedAt: now - 1000, endedAt: now },
    };
    render(<ToolCallTimeline parts={parts} timings={timings} />);
    const bars = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector<HTMLElement>('[data-slot="signoff-tool-call-waterfall"]')!);
    const read = (bar: HTMLElement, name: string) => Number(bar.style.getPropertyValue(name));
    // From the waterfall's start, over its span of 4 s: 0 to 25%, 25 to 50%, 75 to 100%.
    expect(bars.map((bar) => read(bar, '--signoff-waterfall-span'))).toEqual([4000, 4000, 4000]);
    expect(bars.map((bar) => [read(bar, '--signoff-call-start'), read(bar, '--signoff-call-end')])).toEqual([
      [0, 1000],
      [1000, 2000],
      [3000, 4000],
    ]);
    expect(bars[0]!.querySelector('span')!.style.left).toContain('--signoff-call-start');
  });
});

it('renders a long run’s new calls as they arrive, at the end', () => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  const parts = calls(400);
  const { container, rerender } = render(<ToolCallTimeline parts={parts} />);
  rerender(<ToolCallTimeline parts={[...parts, ...calls(401).slice(400)]} />);
  expect(triggerOf(container, 401)).toBeInTheDocument();
  expect(rendered(container).at(-1)).toHaveAttribute('aria-setsize', '401');
  triggerOf(container, 401)!.focus();
  fireEvent.keyDown(triggerOf(container, 401)!, { key: 'Home' });
  expect(triggerOf(container, 1)).toHaveFocus();
  vi.unstubAllGlobals();
});
