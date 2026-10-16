/*
 * Fetches the rest of the git history before `next build` on Vercel, which builds from a shallow
 * clone: lib/git.ts dates a page from the commit that last changed it, and leaves out any date that
 * the history it has can't tell, so without this most of the sitemap goes without a <lastmod>.
 *
 * Runs only when VERCEL is set and the clone is shallow, so CI and local builds fetch nothing. It
 * never fails the build: a page it can't date goes without one, as before. When the clone is still
 * shallow afterwards (a fetch error, which git prints, or a clone with no remote, which fetches
 * nothing and says nothing), it prints one line saying so.
 *
 *   node scripts/unshallow.mjs
 */
import { spawnSync } from 'node:child_process';

const git = (...args) =>
  spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 120_000 });
const shallow = () => git('rev-parse', '--is-shallow-repository').stdout?.trim() === 'true';

if (process.env.VERCEL && shallow()) {
  git('fetch', '--unshallow', '--quiet');
  if (shallow()) {
    console.warn(
      'sitemap dates: the clone is still shallow, so pages changed before its oldest commit get no lastmod; set VERCEL_DEEP_CLONE=true on the project',
    );
  }
}
