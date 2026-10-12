// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { launchOptions, onTheGpu } from '../../../scripts/perf/chrome';
import { interleave, median, medianOfPasses, overBudget } from '../../../scripts/perf/passes';

/*
 * scripts/perf.mjs starts Chrome with the GPU off (scripts/perf/chrome.ts), runs every case three
 * times and holds the median of each metric to its budget (scripts/perf/passes.ts).
 */

describe('Chrome for the perf check', () => {
  it('starts with the GPU off', () => {
    expect(launchOptions).toEqual({ channel: 'chrome', args: ['--disable-gpu'] });
  });

  // `SystemInfo.getInfo`'s gpu.featureStatus, from Chrome 154 on a laptop with and without the flag.
  const withGpu = { gpu_compositing: 'enabled', rasterization: 'enabled', webgl: 'enabled' };
  const withoutGpu = {
    gpu_compositing: 'disabled_software',
    rasterization: 'disabled_software',
    webgl: 'unavailable_software',
  };

  it('accepts a browser that rasterizes and composites in software', () => {
    expect(onTheGpu(withoutGpu)).toBeUndefined();
    expect(onTheGpu({ gpu_compositing: 'disabled_software', rasterization: 'disabled_off' })).toBeUndefined();
  });

  it('names what a browser still draws on the GPU', () => {
    expect(onTheGpu(withGpu)).toBe('Chrome still draws on the GPU (gpu_compositing: enabled, rasterization: enabled)');
    expect(onTheGpu({ ...withoutGpu, rasterization: 'enabled_force' })).toBe(
      'Chrome still draws on the GPU (rasterization: enabled_force)',
    );
    expect(onTheGpu({})).toBe('Chrome still draws on the GPU (gpu_compositing: unknown, rasterization: unknown)');
  });
});

describe('interleave', () => {
  const cases = [{ label: 'local edit' }, { label: 'rewrite' }];

  it('runs every case once, then every case again', () => {
    expect(interleave(cases, 3).map(({ item, pass, label }) => [item, pass, label])).toEqual([
      [cases[0], 1, 'local edit, pass 1 of 3'],
      [cases[1], 1, 'rewrite, pass 1 of 3'],
      [cases[0], 2, 'local edit, pass 2 of 3'],
      [cases[1], 2, 'rewrite, pass 2 of 3'],
      [cases[0], 3, 'local edit, pass 3 of 3'],
      [cases[1], 3, 'rewrite, pass 3 of 3'],
    ]);
  });

  it('keeps the labels as they are for a single pass', () => {
    expect(interleave(cases, 1).map(({ label }) => label)).toEqual(['local edit', 'rewrite']);
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([456, 262, 249])).toBe(262);
    expect(median([3, 1, 4, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNaN();
  });
});

describe('medianOfPasses', () => {
  it('takes each metric’s median on its own', () => {
    const passes = [
      { longestTaskMs: 456, keyMs: 3.5, domNodes: 4442 },
      { longestTaskMs: 262, keyMs: 5.8, domNodes: 4442 },
      { longestTaskMs: 249, keyMs: 4.1, domNodes: 4442 },
    ];
    expect(medianOfPasses(passes)).toEqual({ longestTaskMs: 262, keyMs: 4.1, domNodes: 4442 });
  });

  it('takes a metric from the passes that measured it', () => {
    expect(medianOfPasses([{ a: 1, b: 10 }, { a: 3 }])).toEqual({ a: 2, b: 10 });
  });
});

describe('overBudget', () => {
  const budgets = { longestTaskMs: 400, keyMs: 40 };

  it('names each metric over its budget, rounded', () => {
    expect(overBudget('local edit', { longestTaskMs: 455.6, keyMs: 40 }, budgets)).toEqual([
      'local edit: longestTaskMs 456, budget 400',
    ]);
  });

  // A fresh CI runner's first case, on main (run 38127258137): its longest task was 456 ms against a
  // budget of 400, where its next and larger case measured 190 ms. The other two passes leave it out.
  it('passes a case whose one slow pass is over, and fails one that is over in two of three', () => {
    const pass = (longestTaskMs: number) => ({ longestTaskMs, keyMs: 4 });
    expect(overBudget('local edit', medianOfPasses([pass(456), pass(262), pass(249)]), budgets)).toEqual([]);
    expect(overBudget('local edit', medianOfPasses([pass(456), pass(410), pass(249)]), budgets)).toEqual([
      'local edit: longestTaskMs 410, budget 400',
    ]);
  });
});
