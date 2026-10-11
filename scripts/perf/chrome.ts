// How scripts/perf.mjs starts Chrome: headless, with the GPU off. On CI's Linux runners, which have
// no GPU, Chrome otherwise composites through its GPU process and SwiftShader, and that path stalled
// now and then while a case scrolled: every renderer's main thread and the GPU process's main thread
// asleep on a lock, using no CPU, for good (#55). With the GPU off, Chrome rasterizes and composites
// in software, the way most pages are drawn on a machine without one.

/** Playwright's launch options for every case's browser. */
export const launchOptions = { channel: 'chrome', args: ['--disable-gpu'] };

/** Chrome's `SystemInfo.getInfo` feature status: `enabled`, `disabled_software`, `unavailable_off`... */
export type FeatureStatus = Record<string, string | undefined>;

/** The features that would draw the page on the GPU, and so must not be `enabled`. */
const DRAWING = ['gpu_compositing', 'rasterization'];

/**
 * Why the budgets would not hold for this browser: the features still on the GPU, or `undefined`
 * when Chrome draws in software.
 */
export function onTheGpu(status: FeatureStatus): string | undefined {
  const on = DRAWING.filter((feature) => !status[feature]?.startsWith('disabled'));
  if (!on.length) return undefined;
  return `Chrome still draws on the GPU (${on.map((feature) => `${feature}: ${status[feature] ?? 'unknown'}`).join(', ')})`;
}
