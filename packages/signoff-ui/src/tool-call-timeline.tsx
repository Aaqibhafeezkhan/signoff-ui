'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  getToolPartName,
  getToolPhase,
  isAutomaticApproval,
  isInterruptibleToolPart,
  isSettledPhase,
  isToolPart,
  type AnyUIPart,
  type ToolPart,
  type ToolPhase,
} from './lib/ai';
import { humanizeToolName, summarizeValue } from './lib/format';
import { toolCallTimelineLabels, formatLabels, type RiskLevel, type SignoffLabelsInput } from './lib/labels';
import { useLabels, WithLabels } from './labels';
import { useActivityWindow, useHydrated, useNow, useToolTimings, type ToolTiming, type ToolTimings } from './lib/hooks';
import { BanIcon, CheckIcon, ChevronIcon, SpinnerIcon, XIcon } from './lib/icons';
import { JsonView, LiveRegion } from './lib/primitives';
import { cn } from './lib/utils';

/** The labels' sections this module reads. */
const LABELS = { toolCallTimeline: toolCallTimelineLabels, format: formatLabels };

export type { RiskLevel };

/** Per-tool presentation. Every field is optional. */
export interface ToolMeta {
  /** Display label. Defaults to the humanized tool name. */
  label?: string;
  icon?: ReactNode;
  /**
   * One-line summary shown next to the label. Defaults to the most descriptive input field.
   * Not called before any input has arrived; while the input streams it can be partial.
   */
  summary?: (input: unknown, part: ToolPart) => ReactNode;
  /** Replace the default JSON output view. Your content, like `AgentMessage`'s `renderTool`. */
  renderOutput?: (output: unknown, part: ToolPart) => ReactNode;
  /** Risk shown on approval requests for this tool. */
  risk?: RiskLevel | ((input: unknown) => RiskLevel);
}

export interface ToolCallTimelineProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Tool parts, or every part of a message: non-tool parts are ignored. */
  parts: readonly AnyUIPart[];
  tools?: Record<string, ToolMeta> | undefined;
  /** Externally measured timings by `toolCallId`. Measured client-side when omitted. */
  timings?: ToolTimings | undefined;
  /** Controlled set of expanded `toolCallId`s. */
  expanded?: readonly string[] | undefined;
  defaultExpanded?: readonly string[] | undefined;
  onExpandedChange?: ((expanded: string[]) => void) | undefined;
  /**
   * Expand calls automatically when they fail. Default `false`: the error
   * message is always shown inline under a failed call, with details on demand.
   */
  expandErrors?: boolean;
  /** Show a per-call waterfall bar relative to the whole timeline. Default `true`. */
  waterfall?: boolean;
  /**
   * Announce completions and failures to screen readers. Default `true`. Calls that settle within
   * moments of each other, such as parallel calls, are announced together.
   */
  announce?: boolean;
  /** Extra content under a call, e.g. an approval card. Your content, like `renderOutput`'s. */
  renderExtra?: ((part: ToolPart) => ReactNode) | undefined;
  /** Accessible name for the list. Default "Tool calls" (`labels.toolCallTimeline.list`). */
  label?: string;
  /**
   * Whether the run can still make progress. Default `true`. Pass `false` once it has ended
   * (stopped, failed, or restored from history): calls still streaming their input or running
   * then read "Stopped" and their clocks stop, instead of counting up forever.
   */
  active?: boolean;
  /** Words to use instead of the English defaults: see `SignoffLabelsProvider`. */
  labels?: SignoffLabelsInput | undefined;
}

const PHASE_TEXT: Record<ToolPhase, string> = {
  streaming: 'text-signoff-fg-muted',
  running: 'text-signoff-accent-fg',
  'awaiting-approval': 'text-signoff-hot-fg',
  success: 'text-signoff-fg-subtle',
  error: 'text-signoff-hot-fg',
  denied: 'text-signoff-fg-subtle',
};

function StatusNode({ phase, interrupted }: { phase: ToolPhase; interrupted: boolean }) {
  const base = 'relative z-10 flex size-6 items-center justify-center rounded-full border';
  if (interrupted) {
    return (
      <span className={cn(base, 'border-signoff-border-strong bg-signoff-surface-2')}>
        <span className="bg-signoff-fg-subtle size-2 rounded-[2px]" />
      </span>
    );
  }
  switch (phase) {
    case 'streaming':
      return (
        <span className={cn(base, 'border-signoff-accent/60 bg-signoff-bg border-dashed')}>
          <span className="bg-signoff-accent size-1.5 rounded-full motion-safe:animate-pulse" />
        </span>
      );
    case 'running':
      return (
        <span className={cn(base, 'border-signoff-accent/40 bg-signoff-bg text-signoff-accent')}>
          <SpinnerIcon size={14} className="motion-safe:animate-signoff-spin" />
        </span>
      );
    case 'awaiting-approval':
      return (
        <span className={cn(base, 'border-signoff-hot/60 bg-signoff-bg')}>
          <span className="border-signoff-hot motion-safe:animate-signoff-ping absolute inset-0 rounded-full border" />
          <span className="font-signoff-mono text-signoff-hot-fg text-[11px] leading-none font-bold">!</span>
        </span>
      );
    case 'success':
      return (
        <span className={cn(base, 'border-signoff-accent/35 bg-signoff-accent/15 text-signoff-accent-fg')}>
          <CheckIcon size={13} strokeWidth={2.5} />
        </span>
      );
    case 'error':
      return (
        <span className={cn(base, 'border-signoff-hot/45 bg-signoff-hot/15 text-signoff-hot-fg')}>
          <XIcon size={12} strokeWidth={2.5} />
        </span>
      );
    case 'denied':
      return (
        <span className={cn(base, 'border-signoff-border-strong bg-signoff-surface-2 text-signoff-fg-subtle')}>
          <BanIcon size={12} />
        </span>
      );
  }
}

function getDuration(t: ToolTiming | undefined, now: number): number | undefined {
  if (!t?.startedAt) return undefined;
  const from = t.runningAt ?? t.startedAt;
  return Math.max(0, (t.endedAt ?? now) - from);
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/*
 * A long run renders only the calls near the screen. Its calls are cut into chunks; a chunk away
 * from the viewport is one empty item, hidden from assistive tech, with the height it had (or an
 * estimate until it has rendered). The calls that render give their place in the whole list
 * (aria-posinset, aria-setsize); the arrow keys, Home and End move by index and bring a call that
 * is not rendered into view; announcements come from the calls' data, not from what is rendered.
 * A chunk holding an open call, a call still going, or focus stays rendered.
 */
/** Timelines with more calls than this render only the chunks near the screen. */
const VIRTUALIZE_CALLS = 150;
const CHUNK_CALLS = 25;
/** How far beyond the viewport chunks render, so scrolling rarely meets an empty one. */
const NEAR_MARGIN = '800px 0px';
/** A collapsed call's height, until one is measured. */
const CALL_HEIGHT = 40;

/** Which chunks of a long timeline are near the viewport: one observer for all their elements. */
interface CallObserver {
  /** Calls `listener` when the chunk comes near the viewport or leaves it; returns an unsubscribe. */
  listen(chunk: number, listener: (near: boolean) => void): () => void;
  /** Watches one of the chunk's elements (its calls, or its placeholder); returns an unwatch. */
  observe(el: Element, chunk: number): () => void;
  /** From the top of the chunk's first element to the bottom of its last, or 0. */
  measure(chunk: number): number;
}

function createCallObserver(): CallObserver {
  let observer: IntersectionObserver | undefined;
  const chunkOf = new Map<Element, number>();
  const nearOnes = new Map<number, Set<Element>>();
  const listeners = new Map<number, (near: boolean) => void>();
  return {
    listen(chunk, listener) {
      listeners.set(chunk, listener);
      return () => {
        if (listeners.get(chunk) === listener) listeners.delete(chunk);
      };
    },
    observe(el, chunk) {
      // Without IntersectionObserver (old browsers, jsdom), every chunk renders: see CallChunk.
      if (typeof IntersectionObserver === 'undefined') return () => {};
      observer ??= new IntersectionObserver(
        (entries) => {
          const changed = new Set<number>();
          for (const entry of entries) {
            const at = chunkOf.get(entry.target);
            if (at === undefined) continue;
            const near = nearOnes.get(at) ?? new Set();
            nearOnes.set(at, near);
            if (entry.isIntersecting) near.add(entry.target);
            else near.delete(entry.target);
            changed.add(at);
          }
          for (const at of changed) listeners.get(at)?.((nearOnes.get(at)?.size ?? 0) > 0);
        },
        // `scrollMargin` extends the margin into scrolling containers, such as a chat panel, where supported.
        { rootMargin: NEAR_MARGIN, scrollMargin: NEAR_MARGIN } as IntersectionObserverInit,
      );
      chunkOf.set(el, chunk);
      observer.observe(el);
      return () => {
        chunkOf.delete(el);
        nearOnes.get(chunk)?.delete(el);
        observer?.unobserve(el);
      };
    },
    measure(chunk) {
      let top = Infinity;
      let bottom = -Infinity;
      for (const [el, at] of chunkOf) {
        if (at !== chunk) continue;
        const rect = el.getBoundingClientRect();
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
      return bottom > top ? bottom - top : 0;
    },
  };
}

/** Calls that settle within this window are announced together, once it has passed. */
const ANNOUNCE_DELAY_MS = 300;

/** When the last of these calls settled, or -Infinity. */
function lastEnd(parts: readonly ToolPart[], timings: ToolTimings): number {
  let last = -Infinity;
  for (const part of parts) last = Math.max(last, timings[part.toolCallId]?.endedAt ?? -Infinity);
  return last;
}

/**
 * A vertical timeline of tool calls with live states, durations, a waterfall,
 * and expandable input/output. Follows the WAI-ARIA disclosure pattern; Arrow
 * Up/Down, Home and End move between calls.
 */
export function ToolCallTimeline({
  parts,
  tools,
  timings: timingsProp,
  expanded: expandedProp,
  defaultExpanded,
  onExpandedChange,
  expandErrors = false,
  waterfall = true,
  announce = true,
  renderExtra,
  label,
  active = true,
  labels,
  className,
  ...props
}: ToolCallTimelineProps) {
  const L = useLabels(LABELS, labels);
  const T = L.toolCallTimeline;
  const toolParts = useMemo(() => parts.filter(isToolPart), [parts]);
  const measured = useToolTimings(toolParts);
  const timings = timingsProp ?? measured;
  const anyActive =
    active && toolParts.some((p) => !isSettledPhase(getToolPhase(p)) && getToolPhase(p) !== 'awaiting-approval');
  const now = useNow(anyActive, 100);
  const hydrated = useHydrated();
  // Unsettled calls freeze when the run stops; restored history (never active here) has no end time.
  const stoppedAt = useActivityWindow(active).endedAt;
  const clock = active ? now : stoppedAt;

  const [uncontrolled, setUncontrolled] = useState<readonly string[]>(defaultExpanded ?? []);
  const userExpanded = expandedProp ?? uncontrolled;
  // Failed calls open automatically unless the user explicitly collapsed them.
  const [collapsedErrors, setCollapsedErrors] = useState<ReadonlySet<string>>(() => new Set());
  const isOpen = useCallback(
    (part: ToolPart) =>
      userExpanded.includes(part.toolCallId) ||
      (expandErrors && part.state === 'output-error' && !collapsedErrors.has(part.toolCallId)),
    [userExpanded, expandErrors, collapsedErrors],
  );
  const setOpen = (part: ToolPart, open: boolean) => {
    const id = part.toolCallId;
    if (!open && part.state === 'output-error') setCollapsedErrors((s) => new Set(s).add(id));
    const next = open ? [...userExpanded.filter((x) => x !== id), id] : userExpanded.filter((x) => x !== id);
    if (expandedProp === undefined) setUncontrolled(next);
    onExpandedChange?.(next);
  };
  // One function for every call, reaching the latest render: calls are memoized, and in a long run
  // only those that change render again.
  const latestSetOpen = useRef(setOpen);
  useIsoLayoutEffect(() => {
    latestSetOpen.current = setOpen;
  });
  const [onOpenChange] = useState(() => (part: ToolPart, open: boolean) => latestSetOpen.current(part, open));

  // Waterfall bounds span every call that has timing information. Each call places its bar from its
  // own times and the span set on the list, so while a call runs and the span grows, the others do
  // not render again.
  const bounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const part of toolParts) {
      const t = timings[part.toolCallId];
      const end = t?.endedAt ?? clock;
      if (!t?.startedAt || end === undefined) continue;
      min = Math.min(min, t.startedAt);
      max = Math.max(max, end);
    }
    return Number.isFinite(min) && max > min ? { min, span: max - min } : undefined;
  }, [toolParts, timings, clock]);

  // Calls that settled since the last announcement, in the order they settled. Calls settled before
  // the timeline mounted (restored history) are never announced.
  const [announced, setAnnounced] = useState(() => ({ text: '', through: lastEnd(toolParts, timings) }));
  const announcedThrough = announced.through;
  const pending = useMemo(() => {
    const settled: Array<{ part: ToolPart; at: number }> = [];
    for (const part of toolParts) {
      const at = timings[part.toolCallId]?.endedAt;
      if (at !== undefined && at > announcedThrough) settled.push({ part, at });
    }
    settled.sort((a, b) => a.at - b.at);
    const sentences = settled.map(({ part, at }) => {
      const name = tools?.[getToolPartName(part)]?.label ?? humanizeToolName(getToolPartName(part));
      const phase = getToolPhase(part);
      if (phase === 'error') return T.failed(name, part.errorText);
      if (phase === 'denied') return isAutomaticApproval(part.approval) ? T.blockedByPolicy(name) : T.denied(name);
      return T.finished(name, L.format.durationLong(getDuration(timings[part.toolCallId], at)));
    });
    const text =
      sentences.length > 1 ? sentences.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ') : (sentences[0] ?? '');
    return { text, through: settled.at(-1)?.at ?? announcedThrough };
  }, [toolParts, timings, tools, announcedThrough, T, L.format]);
  // Wait a moment, so that calls finishing together (parallel calls) are read out as one.
  const { text: pendingText, through: pendingThrough } = pending;
  useEffect(() => {
    if (!pendingText) return;
    const id = setTimeout(() => setAnnounced({ text: pendingText, through: pendingThrough }), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [pendingText, pendingThrough]);

  const listRef = useRef<HTMLOListElement>(null);
  const count = toolParts.length;
  const virtualized = count > VIRTUALIZE_CALLS;
  const [observer] = useState(createCallObserver);
  // Of the chunks there at the first render, the first and the last render and the rest wait for the
  // viewport; all render where the timeline starts short. A chunk added later renders, then sees
  // where it is.
  const [initial] = useState(() => ({ virtualized, chunks: Math.ceil(count / CHUNK_CALLS) }));
  const [callHeight, setCallHeight] = useState(CALL_HEIGHT);
  // A call slides in when it is new: at the first render, or arriving after it. Not when a chunk that
  // has scrolled back near the screen renders its calls again.
  const [entering] = useState(() => createEntering(toolParts.map((part) => part.toolCallId)));
  useEffect(() => entering.mounted(), [entering]);
  // The chunk holding focus stays rendered; a call the keyboard moves to renders, then takes focus.
  const [focusChunk, setFocusChunk] = useState<number>();
  const [focusTarget, setFocusTarget] = useState<number>();
  const triggerAt = (index: number) =>
    listRef.current?.querySelector<HTMLButtonElement>(
      `[data-slot="signoff-tool-call"][aria-posinset="${index + 1}"] [data-slot="signoff-tool-call-trigger"]`,
    );
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const triggers = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[data-slot="signoff-tool-call-trigger"]') ?? [],
    );
    const index = triggers.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    // In a long timeline, by index over every call; otherwise between the triggers, all rendered.
    const total = virtualized ? count : triggers.length;
    const from = virtualized
      ? Number(triggers[index]!.closest('[data-slot="signoff-tool-call"]')?.getAttribute('aria-posinset')) - 1
      : index;
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? total - 1
          : (from + (event.key === 'ArrowDown' ? 1 : -1) + total) % total;
    if (!virtualized) {
      triggers[nextIndex]?.focus();
      return;
    }
    // A call that is not rendered renders first, then takes focus (the effect below).
    const target = triggerAt(nextIndex);
    if (target) reveal(target);
    else {
      setFocusChunk(Math.floor(nextIndex / CHUNK_CALLS));
      setFocusTarget(nextIndex);
    }
  };
  const reveal = (trigger: HTMLElement) => {
    trigger.scrollIntoView?.({ block: 'nearest' });
    trigger.focus({ preventScroll: true });
  };
  useIsoLayoutEffect(() => {
    if (focusTarget === undefined) return;
    const target = triggerAt(focusTarget);
    if (target) reveal(target);
    setFocusTarget(undefined);
  }, [focusTarget]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !virtualized) return;
    const onFocusIn = (event: FocusEvent) => {
      const at = (event.target as Element).closest('[data-slot="signoff-tool-call"]')?.getAttribute('aria-posinset');
      if (at) setFocusChunk(Math.floor((Number(at) - 1) / CHUNK_CALLS));
    };
    // Only once focus has gone elsewhere on the page, not while the window is in the background.
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !list.contains(event.relatedTarget)) setFocusChunk(undefined);
    };
    list.addEventListener('focusin', onFocusIn);
    list.addEventListener('focusout', onFocusOut);
    return () => {
      list.removeEventListener('focusin', onFocusIn);
      list.removeEventListener('focusout', onFocusOut);
    };
  }, [virtualized]);
  // Until a call has rendered, a chunk that has not is as tall as this estimate allows.
  useIsoLayoutEffect(() => {
    if (!virtualized) return;
    const height = observer.measure(0) / Math.min(CHUNK_CALLS, count);
    if (height > 0 && Math.abs(height - callHeight) > 0.5) setCallHeight(height);
    // Once, when a timeline becomes long: its first chunk's calls are rendered then.
  }, [virtualized]);

  const bars = waterfall && hydrated ? bounds : undefined;
  // The waterfall's span reaches each rendered bar here rather than through the calls' props, or as a
  // variable inherited from the list: either way, every time it grows (each tick of a running call)
  // every call would render or restyle again. A long timeline's size reaches its rendered calls the
  // same way, as it grows with each call. Written on every commit, so a call that just rendered has both.
  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const span = bars ? String(bars.span) : '';
    for (const track of list.querySelectorAll<HTMLElement>(`[data-slot="${WATERFALL}"]`))
      if (track.style.getPropertyValue(SPAN) !== span) track.style.setProperty(SPAN, span);
    const size = String(count);
    for (const call of list.querySelectorAll('[data-slot="signoff-tool-call"]')) {
      if (!virtualized) call.removeAttribute('aria-setsize');
      else if (call.getAttribute('aria-setsize') !== size) call.setAttribute('aria-setsize', size);
    }
  });

  if (count === 0) return null;
  const chunks: Array<[number, number]> = [];
  for (let start = 0; start < count; start += CHUNK_CALLS) chunks.push([start, Math.min(count, start + CHUNK_CALLS)]);
  const keepRendered = (part: ToolPart) => isOpen(part) || !isSettledPhase(getToolPhase(part));

  return (
    <WithLabels labels={labels}>
      <div
        data-signoff
        data-slot="signoff-tool-call-timeline"
        className={cn('font-signoff-sans text-signoff-fg @container', className)}
        {...props}
      >
        {/* Arrow-key navigation between the disclosure buttons, as in the WAI-ARIA accordion pattern. */}
        <ol ref={listRef} aria-label={label ?? T.list} onKeyDown={onKeyDown} className="relative flex flex-col">
          {chunks.map(([start, end], chunk) => (
            <CallChunk
              key={chunk}
              chunk={chunk}
              calls={end - start}
              observer={virtualized ? observer : undefined}
              initiallyNear={!initial.virtualized || chunk === 0 || chunk >= initial.chunks - 1}
              pinned={chunk === focusChunk || toolParts.slice(start, end).some(keepRendered)}
              callHeight={callHeight}
            >
              {() =>
                toolParts.slice(start, end).map((part, i) => {
                  const index = start + i;
                  const timing = timings[part.toolCallId];
                  return (
                    <TimelineItem
                      key={part.toolCallId}
                      part={part}
                      meta={tools?.[getToolPartName(part)]}
                      timing={timing}
                      // Only a call still going reads the clock: the others keep their props, and their render.
                      clock={timing?.startedAt !== undefined && timing.endedAt === undefined ? clock : undefined}
                      interrupted={!active && isInterruptibleToolPart(part)}
                      barsFrom={bars?.min}
                      hydrated={hydrated}
                      isLast={index === count - 1}
                      open={isOpen(part)}
                      onOpenChange={onOpenChange}
                      extra={renderExtra?.(part)}
                      posInSet={virtualized ? index + 1 : undefined}
                      chunk={chunk}
                      observer={virtualized ? observer : undefined}
                      entering={entering}
                    />
                  );
                })
              }
            </CallChunk>
          ))}
        </ol>
        {announce && <LiveRegion>{announced.text}</LiveRegion>}
      </div>
    </WithLabels>
  );
}

/** A call's waterfall bar; the list sets the waterfall's span in ms on each. */
const WATERFALL = 'signoff-tool-call-waterfall';
const SPAN = '--signoff-waterfall-span';
const START = '--signoff-call-start';
const END = '--signoff-call-end';
/** Where a bar starts, as a percentage of the span; it is at least 2% wide, and stops at the end. */
const BAR_LEFT = `calc(var(${START}) / var(${SPAN}) * 100%)`;
const BAR_STYLE = {
  left: BAR_LEFT,
  width: `min(max(2%, calc((var(${END}) - var(${START})) / var(${SPAN}) * 100%)), calc(100% - ${BAR_LEFT}))`,
};

/**
 * A chunk of a timeline's calls: rendered near the viewport, pinned, or in a short timeline;
 * otherwise one empty item as tall as the calls were (or are estimated to be).
 */
function CallChunk({
  chunk,
  calls,
  observer,
  initiallyNear,
  pinned,
  callHeight,
  children,
}: {
  chunk: number;
  calls: number;
  /** Set when the timeline is long enough to render only what is near the screen. */
  observer: CallObserver | undefined;
  initiallyNear: boolean;
  pinned: boolean;
  callHeight: number;
  children: () => ReactNode;
}) {
  const [nearState, setNear] = useState(initiallyNear);
  const [height, setHeight] = useState<number>();
  useIsoLayoutEffect(() => {
    if (!observer) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    return observer.listen(chunk, (near) => {
      // Leaving: keep the height the calls had, for the empty item that stands in for them.
      if (!near) {
        const measured = observer.measure(chunk);
        if (measured > 0) setHeight(measured);
      }
      setNear(near);
    });
  }, [observer, chunk]);
  if (!observer || nearState || pinned) return children();
  return <ChunkPlaceholder chunk={chunk} observer={observer} height={height ?? calls * callHeight} />;
}

function ChunkPlaceholder({ chunk, observer, height }: { chunk: number; observer: CallObserver; height: number }) {
  const ref = useRef<HTMLLIElement>(null);
  useIsoLayoutEffect(() => observer.observe(ref.current!, chunk), [observer, chunk]);
  return <li ref={ref} aria-hidden="true" data-slot="signoff-tool-call-chunk" style={{ height }} />;
}

/** Which calls have rendered, for whether a call slides in when it renders. */
type Entering = ReturnType<typeof createEntering>;

function createEntering(first: readonly string[]) {
  let mounted = false;
  const initial = new Set(first);
  const seen = new Set<string>();
  return {
    /** The timeline's first render is done. */
    mounted() {
      mounted = true;
    },
    /** A call rendering now is new: at the first render or arriving after it, and not rendered before. */
    isNew: (id: string) => !seen.has(id) && (!mounted || !initial.has(id)),
    rendered(id: string) {
      seen.add(id);
    },
  };
}

interface TimelineItemProps {
  part: ToolPart;
  meta: ToolMeta | undefined;
  timing: ToolTiming | undefined;
  /**
   * Current time while the run is active, when it stopped once inactive (undefined if unknown).
   * Only for a call that has started and not ended: no other call reads it.
   */
  clock: number | undefined;
  /** The run ended while this call was still preparing or running. */
  interrupted: boolean;
  /** The waterfall's start, when it shows: bars are placed from it. */
  barsFrom: number | undefined;
  isLast: boolean;
  hydrated: boolean;
  open: boolean;
  onOpenChange: (part: ToolPart, open: boolean) => void;
  extra: ReactNode;
  /** In a long timeline: the call's place in the whole list (the list sets `aria-setsize`). */
  posInSet: number | undefined;
  chunk: number;
  /** In a long timeline: what tells its chunk whether it is near the viewport. */
  observer: CallObserver | undefined;
  entering: Entering;
}

/** Memoized: in a long run, a new call or a running call's clock renders only the calls they change. */
const TimelineItem = memo(function TimelineItem({
  part,
  meta,
  timing,
  clock,
  interrupted,
  barsFrom,
  isLast,
  hydrated,
  open,
  onOpenChange,
  extra,
  posInSet,
  chunk,
  observer,
  entering,
}: TimelineItemProps) {
  const L = useLabels(LABELS);
  const ref = useRef<HTMLLIElement>(null);
  useIsoLayoutEffect(() => observer?.observe(ref.current!, chunk), [observer, chunk]);
  const id = part.toolCallId;
  const [enter] = useState(() => entering.isNew(id));
  useEffect(() => entering.rendered(id), [entering, id]);
  const name = getToolPartName(part);
  const phase = getToolPhase(part);
  const label = meta?.label ?? part.title ?? humanizeToolName(name);
  // The SDK sets `input: undefined` until the first input delta arrives.
  const summary =
    part.input === undefined ? undefined : meta?.summary ? meta.summary(part.input, part) : summarizeValue(part.input);
  const settled = isSettledPhase(phase) || interrupted;
  // Live durations depend on the clock: render them only after hydration.
  const end = timing?.endedAt ?? clock;
  const duration = (settled || hydrated) && end !== undefined ? getDuration(timing, end) : undefined;

  // Times from the waterfall's start, to keep the numbers small: some browsers compute CSS in floats.
  const bar =
    barsFrom !== undefined && timing?.startedAt && end !== undefined
      ? ({ [START]: timing.startedAt - barsFrom, [END]: end - barsFrom } as CSSProperties)
      : undefined;

  return (
    <li
      ref={ref}
      data-slot="signoff-tool-call"
      aria-posinset={posInSet}
      data-phase={phase}
      data-state={part.state}
      data-interrupted={interrupted || undefined}
      className={cn(
        'group/item relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3',
        enter && 'motion-safe:animate-signoff-enter',
      )}
    >
      {!isLast && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-7 bottom-0 left-[11.5px] w-px',
            settled ? 'bg-signoff-border-strong' : 'from-signoff-accent/50 to-signoff-border bg-gradient-to-b',
          )}
        />
      )}
      {/* Decorative: the trigger spells out the state ("Needs approval"), so the node's "!" is not read. */}
      <div aria-hidden="true" className="pt-1.5">
        <StatusNode phase={phase} interrupted={interrupted} />
      </div>
      <Collapsible.Root
        open={open}
        onOpenChange={(next) => onOpenChange(part, next)}
        className={cn('min-w-0', isLast ? 'pb-0' : 'pb-2')}
      >
        <Collapsible.Trigger
          data-slot="signoff-tool-call-trigger"
          className="group/trigger hover:bg-signoff-surface-2/70 focus-visible:outline-signoff-ring flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-0"
        >
          {meta?.icon && (
            <span aria-hidden="true" className="text-signoff-fg-subtle flex shrink-0 [&_svg]:size-3.5">
              {meta.icon}
            </span>
          )}
          {/* Truncates rather than pushing the row past a narrow container; the full name stays in the button's. */}
          <span className="text-signoff-fg min-w-0 truncate text-[13px] font-medium">{label}</span>
          {summary !== undefined && summary !== null && summary !== '' && (
            // In narrow containers the summary is visually hidden but stays in the button's accessible name.
            <span className="font-signoff-mono text-signoff-fg-muted sr-only min-w-0 text-xs @md:not-sr-only @md:truncate">
              {summary}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2.5 pl-2">
            <span
              className={cn(
                'text-xs font-medium',
                interrupted ? 'text-signoff-fg-subtle' : PHASE_TEXT[phase],
                phase === 'success' && 'sr-only',
              )}
            >
              {interrupted ? L.toolCallTimeline.stopped : L.toolCallTimeline.phases[phase]}
            </span>
            {bar && (
              <span
                aria-hidden="true"
                data-slot={WATERFALL}
                className="bg-signoff-surface-2 relative hidden h-1 w-16 overflow-hidden rounded-full @sm:block"
                style={bar}
              >
                <span
                  className={cn(
                    'absolute inset-y-0 rounded-full',
                    phase === 'error' || phase === 'awaiting-approval'
                      ? 'bg-signoff-hot'
                      : settled
                        ? 'bg-signoff-fg-subtle/70'
                        : 'bg-signoff-accent',
                  )}
                  style={BAR_STYLE}
                />
              </span>
            )}
            <span className="font-signoff-mono text-signoff-fg-subtle w-12 text-right text-[11px] tabular-nums">
              {duration !== undefined && phase !== 'awaiting-approval' ? L.format.duration(duration) : ''}
            </span>
            <ChevronIcon
              size={14}
              className="text-signoff-fg-subtle transition-transform duration-200 group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none"
            />
          </span>
        </Collapsible.Trigger>
        {part.state === 'output-error' && !open && (
          <p className="font-signoff-mono text-signoff-hot-fg mt-0.5 mb-1 line-clamp-2 px-2 text-xs leading-5 break-words">
            {part.errorText}
          </p>
        )}
        <Collapsible.Content className="data-[state=closed]:motion-safe:animate-signoff-collapse data-[state=open]:motion-safe:animate-signoff-expand overflow-hidden">
          <ToolCallDetails part={part} meta={meta} />
        </Collapsible.Content>
        {extra && (
          <div className="mt-2 mb-1 pl-2" data-signoff-slot>
            {extra}
          </div>
        )}
      </Collapsible.Root>
    </li>
  );
});

/** The expanded body of a tool call: input, output or error, and approval outcome. */
export function ToolCallDetails({
  part,
  meta,
  labels,
}: {
  part: ToolPart;
  meta?: ToolMeta | undefined;
  /** Words to use instead of the English defaults: see `SignoffLabelsProvider`. */
  labels?: SignoffLabelsInput | undefined;
}) {
  const T = useLabels(LABELS, labels).toolCallTimeline;
  const hasInput = part.input !== undefined;
  const sectionLabel =
    'mb-1.5 font-signoff-mono text-[10.5px] font-medium tracking-[0.08em] text-signoff-fg-subtle uppercase';
  return (
    <div data-signoff data-slot="signoff-tool-call-details" className="flex flex-col gap-3 px-2 pt-1.5 pb-3">
      {hasInput && (
        <div>
          <div className={sectionLabel}>{part.state === 'input-streaming' ? T.inputStreaming : T.input}</div>
          <JsonView value={part.input} label={T.input} />
        </div>
      )}
      {part.state === 'output-available' && (
        <div>
          <div className={sectionLabel}>{part.preliminary ? T.outputPartial : T.output}</div>
          {meta?.renderOutput ? (
            <div data-signoff-slot>{meta.renderOutput(part.output, part)}</div>
          ) : (
            <JsonView value={part.output} label={T.output} />
          )}
        </div>
      )}
      {part.state === 'output-error' && (
        <div>
          <div className={sectionLabel}>{T.error}</div>
          <p className="border-signoff-hot/35 bg-signoff-hot/[0.07] font-signoff-mono text-signoff-fg rounded-lg border px-3 py-2 text-xs leading-5 break-words whitespace-pre-wrap">
            {part.errorText}
          </p>
        </div>
      )}
      {(part.state === 'output-denied' || (part.state === 'approval-responded' && !part.approval.approved)) && (
        <p className="text-signoff-fg-muted text-xs">
          {T.deniedBy(isAutomaticApproval(part.approval))}
          {part.approval.reason ? (
            <>
              : <span className="text-signoff-fg">{part.approval.reason}</span>
            </>
          ) : (
            '.'
          )}
        </p>
      )}
      {!hasInput && part.state === 'input-streaming' && (
        <p className="text-signoff-fg-subtle text-xs">{T.waitingForInput}</p>
      )}
    </div>
  );
}
