// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispose, runCases, Timeout, within } from '../../../scripts/perf/deadline';

/*
 * scripts/perf.mjs runs its cases through scripts/perf/deadline.ts, so a browser that stops
 * answering fails `pnpm perf` in minutes, naming the case, rather than hanging until CI's guard.
 */

const never = () => new Promise<never>(() => {});

function fakeBrowser({ closeHangs = false } = {}) {
  return {
    close: vi.fn(() => (closeHangs ? never() : Promise.resolve())),
    kill: vi.fn(),
  };
}
type FakeBrowser = ReturnType<typeof fakeBrowser>;

function launcher(...browsers: FakeBrowser[]) {
  const launched: FakeBrowser[] = [];
  const launch = vi.fn(async () => {
    const browser = browsers[launched.length] ?? fakeBrowser();
    launched.push(browser);
    return browser;
  });
  return { launch, launched };
}

/** Settles `promise` into a value or an error, so a rejection while timers run is not unhandled. */
function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error: error as Error }),
  );
}

const cases = [{ label: 'local edit' }, { label: 'full rewrite' }, { label: 'split' }];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('within', () => {
  it('times out a promise that never settles, and ignores what it does afterwards', async () => {
    let fail!: (error: Error) => void;
    const late = new Promise<never>((_, reject) => (fail = reject));
    const outcome = settle(within(late, 1000, 'no result after 1 s'));
    await vi.advanceTimersByTimeAsync(1000);
    const { error } = (await outcome) as { error: Error };
    expect(error).toBeInstanceOf(Timeout);
    expect(error.message).toBe('no result after 1 s');
    // A rejection after the deadline (the killed browser's page closing) is not left unhandled.
    fail(new Error('Target page, context or browser has been closed'));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('passes a result through and clears its timer', async () => {
    await expect(within(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('dispose', () => {
  it('kills a browser whose close hangs, after the close deadline', async () => {
    const browser = fakeBrowser({ closeHangs: true });
    const done = dispose(browser, 10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(browser.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(browser.kill).toHaveBeenCalledOnce();
  });

  it('kills a browser whose close fails', async () => {
    const browser = { close: vi.fn(() => Promise.reject(new Error('gone'))), kill: vi.fn() };
    await dispose(browser, 10_000);
    expect(browser.kill).toHaveBeenCalledOnce();
  });

  it('leaves a browser that closes alone', async () => {
    const browser = fakeBrowser();
    await dispose(browser, 10_000);
    expect(browser.kill).not.toHaveBeenCalled();
  });
});

describe('runCases', () => {
  it('runs each case in a browser of its own, and closes each', async () => {
    const { launch, launched } = launcher();
    const run = vi.fn(async (_: FakeBrowser, item: { label: string }) => item.label);
    const results = await runCases(cases, { launch, run });
    expect(results).toEqual(['local edit', 'full rewrite', 'split']);
    expect(launch).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.map(([browser]) => launched.indexOf(browser))).toEqual([0, 1, 2]);
    for (const browser of launched) {
      expect(browser.close).toHaveBeenCalledOnce();
      expect(browser.kill).not.toHaveBeenCalled();
    }
  });

  it('fails a case that never finishes within three deadlines, naming it, with what its page logged', async () => {
    // local edit, then full rewrite's three tries; the last browser's close hangs.
    const { launch, launched } = launcher(
      fakeBrowser(),
      fakeBrowser(),
      fakeBrowser(),
      fakeBrowser({ closeHangs: true }),
    );
    const warn = vi.fn();
    const run = vi.fn((_: FakeBrowser, item: { label: string }, log: string[]) => {
      if (item.label !== 'full rewrite') return Promise.resolve(item.label);
      log.push('console: perf: diff worker starting', `worker: attempt ${run.mock.calls.length - 1}`);
      return never();
    });
    const outcome = settle(runCases(cases, { launch, run, warn, deadlineMs: 120_000, closeMs: 10_000 }));

    // The first timeout: the browser is killed and the case runs again in a new one.
    await vi.advanceTimersByTimeAsync(119_999);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain(
      'full rewrite: no result after 120 s; trying it again in a new browser (try 2 of 3)',
    );
    expect(warn.mock.calls[0]![0]).toContain('worker: attempt 1');
    expect(launched[1]!.kill).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenLastCalledWith(launched[2], cases[1], expect.any(Array));

    // The second: once more, in a third browser.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0]).toContain('(try 3 of 3)');
    expect(launched[2]!.kill).toHaveBeenCalledOnce();
    expect(run).toHaveBeenLastCalledWith(launched[3], cases[1], expect.any(Array));

    // The third: it fails, and closing the last browser (which hangs) is bounded too.
    await vi.advanceTimersByTimeAsync(120_000 + 10_000);
    const { error } = (await outcome) as { error: Error };
    expect(error.message).toBe(
      'perf: full rewrite: no result after 120 s, on each of 3 tries in a new browser. The page logged:\n' +
        '  console: perf: diff worker starting\n' +
        '  worker: attempt 3',
    );
    expect(run).toHaveBeenCalledTimes(4);
    expect(launched[3]!.close).toHaveBeenCalledOnce();
    expect(launched[3]!.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a case that stalls twice when the third try finishes', async () => {
    const { launch, launched } = launcher();
    let attempts = 0;
    const run = (browser: FakeBrowser, item: { label: string }) => {
      if (item.label === 'local edit' && attempts++ < 2) return never();
      return Promise.resolve(`${item.label} in browser ${launched.indexOf(browser)}`);
    };
    const warn = vi.fn();
    const outcome = runCases(cases, { launch, run, warn, deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(outcome).resolves.toEqual([
      'local edit in browser 2',
      'full rewrite in browser 3',
      'split in browser 4',
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(launched[0]!.kill).toHaveBeenCalledOnce();
    expect(launched[1]!.kill).toHaveBeenCalledOnce();
    for (const browser of launched.slice(2)) expect(browser.close).toHaveBeenCalledOnce();
  });

  it('takes `retries` tries more, and no more', async () => {
    const { launch } = launcher();
    const run = vi.fn(() => never());
    const outcome = settle(runCases(cases, { launch, run, warn: () => {}, deadlineMs: 1000, retries: 0 }));
    await vi.advanceTimersByTimeAsync(1000 + 10_000);
    expect(((await outcome) as { error: Error }).error.message).toBe(
      'perf: local edit: no result after 1 s. The page logged nothing.',
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it('asks a stuck browser what it is doing before killing it, and prints the answer', async () => {
    const { launch, launched } = launcher();
    const diagnose = vi.fn(async (browser: FakeBrowser) => {
      expect(browser.kill).not.toHaveBeenCalled();
      return ['the main thread does not answer', 'not paused in JavaScript'];
    });
    const run = vi.fn((_: FakeBrowser, item: { label: string }) =>
      item.label === 'split' && run.mock.calls.length === 3 ? never() : Promise.resolve(item.label),
    );
    const warn = vi.fn();
    const outcome = runCases(cases, { launch, run, warn, diagnose, deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(outcome).resolves.toEqual(['local edit', 'full rewrite', 'split']);
    expect(diagnose).toHaveBeenCalledOnce();
    expect(diagnose).toHaveBeenCalledWith(launched[2], cases[2]);
    expect(launched[2]!.kill).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toBe(
      'perf: split: no result after 1 s; trying it again in a new browser (try 2 of 3). The page logged nothing.\n' +
        'What the browser was doing:\n' +
        '  the main thread does not answer\n' +
        '  not paused in JavaScript',
    );
  });

  it('bounds a diagnosis that hangs, and does not diagnose an ordinary error', async () => {
    const { launch } = launcher();
    const diagnose = vi.fn(() => never());
    let calls = 0;
    const run = async (_: FakeBrowser, item: { label: string }) => {
      calls++;
      if (item.label === 'local edit' && calls === 1) return never();
      if (item.label === 'split') throw new Error('the review was not ready after 60 s');
      return item.label;
    };
    const warn = vi.fn();
    const outcome = settle(runCases(cases, { launch, run, warn, diagnose, deadlineMs: 1000, diagnoseMs: 5000 }));
    await vi.advanceTimersByTimeAsync(1000 + 5000);
    expect(warn.mock.calls[0]![0]).toContain('What the browser was doing:\n  could not tell: no answer in 5 s');
    const { error } = (await outcome) as { error: Error };
    expect(error.message).toBe('perf: split: the review was not ready after 60 s. The page logged nothing.');
    expect(diagnose).toHaveBeenCalledOnce();
  });

  it('also tries a case again after an error the caller counts as a stall', async () => {
    const { launch, launched } = launcher();
    const timeoutError = Object.assign(new Error('page.waitForFunction: Timeout 90000ms exceeded.'), {
      name: 'TimeoutError',
    });
    const run = vi.fn(async (_: FakeBrowser, item: { label: string }) => {
      if (item.label === 'split' && run.mock.calls.length === 3) throw timeoutError;
      return item.label;
    });
    const warn = vi.fn();
    const stalled = (error: unknown) => error instanceof Error && error.name === 'TimeoutError';
    await expect(runCases(cases, { launch, run, warn, stalled })).resolves.toEqual([
      'local edit',
      'full rewrite',
      'split',
    ]);
    expect(warn.mock.calls[0]![0]).toContain(
      'split: page.waitForFunction: Timeout 90000ms exceeded.; trying it again in a new browser',
    );
    expect(launched[2]!.kill).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledTimes(4);
  });

  it('fails at once on an error, with the case and its page log, and still closes the browser', async () => {
    const { launch, launched } = launcher(fakeBrowser(), fakeBrowser(), fakeBrowser({ closeHangs: true }));
    const run = async (_: FakeBrowser, item: { label: string }, log: string[]) => {
      if (item.label !== 'split') return item.label;
      log.push('pageerror: boom');
      throw new Error('the review was not ready after 60 s');
    };
    const outcome = settle(runCases(cases, { launch, run, closeMs: 5000 }));
    await vi.advanceTimersByTimeAsync(5000);
    const { error } = (await outcome) as { error: Error };
    expect(error.message).toBe('perf: split: the review was not ready after 60 s. The page logged:\n  pageerror: boom');
    expect(launch).toHaveBeenCalledTimes(3);
    expect(launched[2]!.kill).toHaveBeenCalledOnce();
  });

  it('gives up when a browser does not start', async () => {
    const outcome = settle(runCases(cases, { launch: never, run: async () => 0, deadlineMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(((await outcome) as { error: Error }).error.message).toBe('the browser did not start in 1 s');
  });

  it('gives up when the browser for the next case does not start, having closed the last one', async () => {
    const first = fakeBrowser();
    const launch = vi.fn(() => (launch.mock.calls.length === 1 ? Promise.resolve(first) : never()));
    const outcome = settle(runCases(cases, { launch, run: async () => 0, deadlineMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(((await outcome) as { error: Error }).error.message).toBe('the browser did not start in 1 s');
    expect(first.close).toHaveBeenCalledOnce();
    expect(first.kill).not.toHaveBeenCalled();
  });
});
