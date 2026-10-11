// How scripts/perf.mjs turns several passes over its cases into one result a case. A single pass is
// at the mercy of the runner: the first case to run on a fresh CI runner meets a cold disk cache, and
// its longest task came out at 456 and 468 ms there, where the same runners measured 190 to 260 ms
// for the next, larger case. The median of three passes leaves one slow pass out.

/** Metrics by name: times in ms, sizes in elements. */
export type Metrics = Record<string, number>;

/** One pass over one case: the case, which pass it is, and the label its logs carry. */
export interface Pass<C> {
  item: C;
  pass: number;
  label: string;
}

/**
 * Every case once, then every case again, `passes` times over: a runner that is slow for a while
 * slows one pass of several cases, rather than every pass of one.
 */
export function interleave<C extends { label: string }>(cases: readonly C[], passes: number): Pass<C>[] {
  return Array.from({ length: passes }, (_, i) =>
    cases.map((item) => ({
      item,
      pass: i + 1,
      label: passes > 1 ? `${item.label}, pass ${i + 1} of ${passes}` : item.label,
    })),
  ).flat();
}

/** The middle value, or the mean of the two in the middle. */
export function median(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** One case's passes as one result: each metric is its median over the passes that measured it. */
export function medianOfPasses(passes: readonly Metrics[]): Metrics {
  const names = [...new Set(passes.flatMap((pass) => Object.keys(pass)))];
  return Object.fromEntries(
    names.map((name) => [name, median(passes.map((pass) => pass[name]).filter((value) => value !== undefined))]),
  );
}

/** A line for each metric over its budget. */
export function overBudget(label: string, result: Metrics, budgets: Metrics): string[] {
  return Object.entries(budgets)
    .filter(([metric, limit]) => result[metric]! > limit)
    .map(([metric, limit]) => `${label}: ${metric} ${Math.round(result[metric]!)}, budget ${limit}`);
}
