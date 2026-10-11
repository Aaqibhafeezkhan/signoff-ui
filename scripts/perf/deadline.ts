// How scripts/perf.mjs runs its cases so that a stuck browser fails the check in minutes, naming the
// case, instead of hanging until the CI job's clock runs out. Playwright bounds `waitForFunction`
// and navigation, but not `page.evaluate`, `page.close`, `browser.newPage` or `browser.close`: a
// renderer that stops answering stalls any of them for good. Here every case races its own
// deadline, and closing the browser races one too.

/** A browser the runner can throw away: `kill` must end it at once, without waiting on it. */
export interface Disposable {
  close(): Promise<unknown>;
  kill(): void;
}

export interface Case {
  label: string;
}

/** Thrown when something did not finish in time. */
export class Timeout extends Error {
  override name = 'Timeout';
}

/** `promise`, or a `Timeout` with `message` after `ms`. A rejection after the deadline is ignored. */
export function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Closes the browser, and kills it when that takes longer than `ms` (or fails). */
export async function dispose(browser: Disposable, ms: number): Promise<void> {
  try {
    await within(browser.close(), ms, `the browser did not close in ${ms / 1000} s`);
  } catch {
    browser.kill();
  }
}

export interface RunCasesOptions<B extends Disposable, C extends Case, R> {
  /** Starts a browser: for every case, and again after a case stalls. */
  launch(): Promise<B>;
  /** Runs one case. Whatever its page logs goes into `log`, to be printed if it fails. */
  run(browser: B, item: C, log: string[]): Promise<R>;
  /** How long one try at a case may take. */
  deadlineMs?: number;
  /** How long closing the browser may take before it is killed. */
  closeMs?: number;
  /** How many more tries a case that stalls gets, each in a new browser. */
  retries?: number;
  /** Whether an error means the browser is stuck, so the case is worth a try in a new one. */
  stalled?(error: unknown): boolean;
  /**
   * What the stuck browser is doing, a line each (whether the page answers, a stack): asked after a
   * stall, before the browser is killed, and printed with the page's log.
   */
  diagnose?(browser: B, item: C): Promise<string[]>;
  /** How long `diagnose` may take. */
  diagnoseMs?: number;
  /** Where a retry is announced. */
  warn?(message: string): void;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const lines = (title: string, list: string[]) =>
  list.length ? `${title}${list.map((line) => `\n  ${line}`).join('')}` : '';

/**
 * Runs `cases` in order, each in a browser of its own and against `deadlineMs`. A case that stalls
 * (runs out of time, or fails in a way `stalled` accepts) is tried again in a new browser, up to
 * `retries` more times, the old one killed after `diagnose` has looked at it; one more stall, or any
 * other error, throws with the case's label, what its page logged and what the browser was doing.
 * Every browser is closed, and killed if closing it hangs.
 */
export async function runCases<B extends Disposable, C extends Case, R>(
  cases: readonly C[],
  {
    launch,
    run,
    deadlineMs = 120_000,
    closeMs = 10_000,
    retries = 2,
    stalled = (error) => error instanceof Timeout,
    diagnose,
    diagnoseMs = 30_000,
    warn = console.error,
  }: RunCasesOptions<B, C, R>,
): Promise<R[]> {
  const start = () => within(launch(), deadlineMs, `the browser did not start in ${deadlineMs / 1000} s`);
  const inspect = async (browser: B, item: C) => {
    if (!diagnose) return [];
    try {
      return await within(diagnose(browser, item), diagnoseMs, `no answer in ${diagnoseMs / 1000} s`);
    } catch (error) {
      return [`could not tell: ${reason(error)}`];
    }
  };
  const results: R[] = [];
  let browser: B | undefined;
  try {
    for (const item of cases) {
      // A browser per case: whatever one case leaves behind (a stuck GPU process, a busy renderer)
      // does not reach the next.
      if (browser) await dispose(browser, closeMs);
      browser = undefined;
      browser = await start();
      for (let attempt = 1; ; attempt++) {
        const log: string[] = [];
        try {
          results.push(await within(run(browser, item, log), deadlineMs, `no result after ${deadlineMs / 1000} s`));
          break;
        } catch (error) {
          const stuck = error instanceof Timeout || stalled(error);
          const doing = stuck ? await inspect(browser, item) : [];
          const detail =
            (lines(' The page logged:', log) || ' The page logged nothing.') +
            (doing.length ? `\n${lines('What the browser was doing:', doing)}` : '');
          if (stuck && attempt <= retries) {
            warn(
              `perf: ${item.label}: ${reason(error)}; trying it again in a new browser (try ${attempt + 1} of ${retries + 1}).${detail}`,
            );
            browser.kill();
            browser = undefined;
            browser = await start();
            continue;
          }
          const again = stuck && attempt > 1 ? `, on each of ${attempt} tries in a new browser` : '';
          throw new Error(`perf: ${item.label}: ${reason(error)}${again}.${detail}`, { cause: error });
        }
      }
    }
  } finally {
    if (browser) await dispose(browser, closeMs);
  }
  return results;
}
