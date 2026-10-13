import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/*
 * When a page's sources last changed, from git, when the site builds. A clone without the history
 * (a shallow one, as CI and hosts make) can't always tell: a file not changed since the oldest
 * commit it has seems to date from that commit, which has no parents there. Such a date is left
 * out rather than made up.
 */

// `next build` runs in examples/playground.
const ROOT = join(process.cwd(), '../..');

function git(args: string[]) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

let shallow: boolean | undefined;

const cache = new Map<string, Date | undefined>();

/**
 * The date of the last commit that changed any of these paths (relative to the repository's root),
 * or undefined when git, or enough of the history, isn't there.
 */
export function lastModified(...paths: string[]): Date | undefined {
  const key = paths.join('\n');
  if (cache.has(key)) return cache.get(key);
  shallow ??= git(['rev-parse', '--is-shallow-repository']) !== 'false';
  // "<date>|<parents>": in a shallow clone, the commit it stops at shows none.
  const [date, parents] = (git(['log', '-1', '--format=%cI|%P', '--', ...paths]) ?? '').split('|');
  const result = date && (parents || !shallow) ? new Date(date) : undefined;
  cache.set(key, result);
  return result;
}
