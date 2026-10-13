import { PACKAGE } from './site';

/*
 * Numbers about the project, fetched once when the site builds, with no token. A request that
 * fails or is slow gives `undefined`, and the page leaves the number out rather than guess it.
 */

/** Under this many stars, the header shows the GitHub icon alone. */
export const MIN_STARS = 10;

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': `${PACKAGE}-site` },
      cache: 'force-cache',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

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
