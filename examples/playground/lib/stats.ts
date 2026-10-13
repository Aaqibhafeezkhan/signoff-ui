import { PACKAGE } from './site';

/*
 * Numbers about the project, fetched when the site builds, with no token. A request that fails or
 * is slow gives `undefined`, and the page leaves the number out rather than guess it. `no-store`:
 * each build reads them fresh, rather than from a data cache that outlives the deployment, and the
 * pages stay static all the same (`dynamic = 'force-static'` in app/layout.tsx).
 */

/** Under this many stars, the header shows the GitHub icon alone. */
export const MIN_STARS = 10;

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': `${PACKAGE}-site` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

// One request per build process, shared by the many pages it renders: GitHub answers 60 requests an
// hour without a token.
let stars: Promise<number | undefined> | undefined;

/** The repository's stars, or undefined when GitHub can't be reached or the count is under MIN_STARS. */
export function getStars() {
  stars ??= fetchJson<{ stargazers_count?: number }>(`https://api.github.com/repos/dgesteves/${PACKAGE}`).then(
    (repo) => {
      const count = repo?.stargazers_count;
      return typeof count === 'number' && count >= MIN_STARS ? count : undefined;
    },
  );
  return stars;
}

let downloads: Promise<number | undefined> | undefined;

/** npm downloads over the last week, or undefined when the registry's API can't be reached. */
export function getWeeklyDownloads() {
  downloads ??= fetchJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${PACKAGE}`).then(
    (week) => (typeof week?.downloads === 'number' ? week.downloads : undefined),
  );
  return downloads;
}

/** 1234 → "1.2k", 980 → "980". */
export function compactNumber(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value).toLowerCase();
}
