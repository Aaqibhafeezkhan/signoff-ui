// What scripts/perf.mjs measures, and the budget each metric is held to: times in ms, DOM in
// elements. Each value is the median of three passes (scripts/perf/passes.ts).
//
// DiffReview's time budgets are set from the slowest CI runner seen (#55): that runner passes each
// with 20% to spare, and twice its time goes over. It took 2.1 to 2.8 times as long as a typical
// runner for the same work, so on a typical runner these budgets go over at 2.7 to 4 times its time.
// The exceptions are the fixed limits below, which the slowest runner stays at least 1.5 times under,
// and the DOM sizes. packages/signoff-ui/test/perf-budgets.test.ts holds that runner's numbers and
// checks all this.

export interface PerfCase {
  label: string;
  /** The page's query string: scripts/perf/harness.mjs, or scripts/perf/timeline.mjs for a timeline. */
  query: string;
  budgets: Record<string, number>;
  timeline?: boolean;
}

// A keypress within 40 ms, and paging through the review a frame within 120 ms, without a task over
// 250 ms. Scrolling, a frame's work is mostly rendering the rows coming into view (p95: 17 ms on a
// laptop, about 30 ms on a typical runner and up to 80 ms on the slowest).
export const LIMITS = { keyMs: 40, scrollFrameP95Ms: 120, scrollLongestTaskMs: 250 };

// A local edit renders its hunks in its first task (20 and 100 of them, each with decision and comment
// buttons and the bar of unchanged lines around it): about 60 and 85 ms on a laptop, 187 and 245 ms on
// a typical runner, up to 505 and 596 ms on the slowest. Ready, for a local edit, is that first render.
// A rewrite's longest task is the diff's answer arriving: 100 to 130 ms on a typical runner, up to
// 284 ms on the slowest. The split view renders two lines a row, so its frames take about twice as
// long: 56 ms on a typical runner, up to 143 ms on the slowest.
export const CASES: PerfCase[] = [
  {
    label: 'local edit, 1,000 lines',
    query: 's=local&n=1000',
    budgets: { ...LIMITS, readyMs: 550, longestTaskMs: 650, domNodes: 15_000 },
  },
  {
    label: 'local edit, 5,000 lines',
    query: 's=local&n=5000',
    budgets: { ...LIMITS, readyMs: 800, longestTaskMs: 750, domNodes: 20_000, keyMs: 50 },
  },
  {
    label: 'full rewrite, 2,000 lines',
    query: 's=rewrite&n=2000',
    budgets: { ...LIMITS, readyMs: 1000, longestTaskMs: 350, domNodes: 15_000 },
  },
  {
    label: 'full rewrite, 5,000 lines',
    query: 's=rewrite&n=5000',
    budgets: { ...LIMITS, readyMs: 1500, longestTaskMs: 350, domNodes: 15_000 },
  },
  {
    label: 'full rewrite, 5,000 lines, split',
    query: 's=rewrite&n=5000&view=split',
    budgets: { ...LIMITS, readyMs: 1500, longestTaskMs: 350, domNodes: 15_000, scrollFrameP95Ms: 200 },
  },
];

// ToolCallTimeline (scripts/perf/timeline.mjs). Before the timeline rendered only the calls near the
// screen, appending a call took about 105 ms and a running call's frames 45 to 52 ms on a laptop; now
// about 2.5 ms and 17 ms, and 12 ms and 18 ms with the CPU six times slower. The append budget is the
// one the timeline is held to: under a frame.
export const TIMELINE_CASES: PerfCase[] = [
  {
    label: 'tool call timeline, 2,000 calls',
    query: 'n=2000',
    budgets: { mountMs: 400, appendMs: 16, runningFrameP95Ms: 40, domNodes: 5_000, renderedCalls: 200 },
    timeline: true,
  },
];
