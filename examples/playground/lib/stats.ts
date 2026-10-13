import { PACKAGE } from './site';

/*
 * Numbers about the project, with no token. A request that fails or is slow gives `undefined`, and
 * the page leaves the number out rather than guess it. Each is fetched again once a day, and the
 * pages that show them are regenerated as often (`revalidate` in app/layout.tsx).
 */

/** Under this many stars, the header shows the GitHub icon alone. */
export const MIN_STARS = 10;

/** How long a number is kept, in seconds. */
export const REVALIDATE = 86_400;

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': `${PACKAGE}-site` },
      next: { revalidate: REVALIDATE },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One request a day per server process, shared by every page it renders: a build renders many at once,
 * and GitHub answers 60 requests an hour without a token.
 */
function daily<T>(load: () => Promise<T>) {
  let value: Promise<T> | undefined;
  let loadedAt = 0;
  return () => {
    if (!value || Date.now() - loadedAt >= REVALIDATE * 1000) {
      loadedAt = Date.now();
      value = load();
    }
    return value;
  };
}

/** The repository's stars, or undefined when GitHub can't be reached or the count is under MIN_STARS. */
export const getStars = daily(() =>
  fetchJson<{ stargazers_count?: number }>(`https://api.github.com/repos/dgesteves/${PACKAGE}`).then((repo) => {
    const count = repo?.stargazers_count;
    return typeof count === 'number' && count >= MIN_STARS ? count : undefined;
  }),
);

/** npm downloads over the last week, or undefined when the registry's API can't be reached. */
export const getWeeklyDownloads = daily(() =>
  fetchJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${PACKAGE}`).then((week) =>
    typeof week?.downloads === 'number' ? week.downloads : undefined,
  ),
);

/** 1234 → "1.2k", 980 → "980". */
export function compactNumber(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value).toLowerCase();
}
