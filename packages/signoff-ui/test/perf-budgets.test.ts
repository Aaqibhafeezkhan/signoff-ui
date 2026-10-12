// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CASES, LIMITS } from '../../../scripts/perf/cases';
import { median } from '../../../scripts/perf/passes';

/*
 * The budgets in scripts/perf/cases.ts, against the slowest CI runner seen: one of eight runners that
 * each ran `pnpm perf` five times (#55, run 38084121803). It took 2.1 to 2.8 times as long as the
 * other seven for the same work. CI holds the median of three passes to each budget, so the runner
 * has to pass with the median of any three of its five, with room to spare, and a regression that
 * doubles its time has to fail.
 */
const SLOWEST: Record<string, Record<string, number[]>> = {
  'local edit, 1,000 lines': {
    readyMs: [355, 457, 328, 430, 328],
    longestTaskMs: [427, 560, 413, 505, 395],
    keyMs: [15.3, 19.7, 14.6, 17.5, 15.4],
    scrollFrameP95Ms: [25, 34, 27, 35, 24],
  },
  'local edit, 5,000 lines': {
    readyMs: [505, 477, 459, 487, 459],
    longestTaskMs: [596, 606, 578, 569, 547],
    keyMs: [38.6, 33.7, 44.9, 32.5, 34.1],
    scrollFrameP95Ms: [88, 60, 65, 71, 63],
  },
  'full rewrite, 2,000 lines': {
    readyMs: [793, 792, 750, 734, 694],
    longestTaskMs: [195, 259, 274, 227, 245],
    keyMs: [4.5, 4.8, 2.4, 5.4, 5],
    scrollFrameP95Ms: [82, 80, 77, 72, 69],
  },
  'full rewrite, 5,000 lines': {
    readyMs: [950, 813, 762, 647, 731],
    longestTaskMs: [354, 282, 264, 207, 245],
    keyMs: [5, 4.4, 6, 4.2, 6.6],
    scrollFrameP95Ms: [75, 73, 80, 85, 73],
  },
  'full rewrite, 5,000 lines, split': {
    readyMs: [796, 743, 876, 831, 736],
    longestTaskMs: [273, 251, 284, 349, 203],
    keyMs: [4.2, 5.7, 6.8, 8.6, 5.4],
    scrollFrameP95Ms: [129, 143, 119, 143, 129],
  },
};

/** The highest median of three passes among `values`: the second highest value. */
function worstMedianOfThree(values: number[]) {
  let worst = -Infinity;
  for (let i = 0; i < values.length; i++)
    for (let j = i + 1; j < values.length; j++)
      for (let k = j + 1; k < values.length; k++) worst = Math.max(worst, median([values[i]!, values[j]!, values[k]!]));
  return worst;
}

const budgetOf = (label: string, metric: string) => CASES.find((c) => c.label === label)?.budgets[metric];
const isLimit = (metric: string, budget: number) => LIMITS[metric as keyof typeof LIMITS] === budget;

const measured = Object.entries(SLOWEST).flatMap(([label, metrics]) =>
  Object.entries(metrics).map(([metric, values]) => ({ label, metric, values, budget: budgetOf(label, metric)! })),
);
const fromTheRunner = measured.filter(({ metric, budget }) => !isLimit(metric, budget));
const limits = measured.filter(({ metric, budget }) => isLimit(metric, budget));

describe('perf budgets, against the slowest CI runner seen', () => {
  it('cover every case it measured', () => {
    expect(Object.keys(SLOWEST)).toEqual(CASES.map((c) => c.label));
    for (const { budget } of measured) expect(budget).toBeGreaterThan(0);
    expect(fromTheRunner.length).toBeGreaterThan(limits.length);
  });

  it.each(fromTheRunner)('$label, $metric: passes with 20% to spare', ({ values, budget }) => {
    expect(worstMedianOfThree(values) * 1.2).toBeLessThanOrEqual(budget);
  });

  it.each(fromTheRunner)('$label, $metric: fails at twice its time', ({ values, budget }) => {
    expect(median(values) * 2).toBeGreaterThan(budget);
  });

  it.each(limits)('$label, $metric: stays 1.5 times under the fixed limit', ({ values, budget }) => {
    expect(worstMedianOfThree(values) * 1.5).toBeLessThanOrEqual(budget);
  });
});
