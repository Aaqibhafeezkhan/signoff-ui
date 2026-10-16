import { getGuide, readGuide } from './docs';

/*
 * The home page's proof row, from what the repository measures: the sizes come from the Bundle size
 * table of content/docs/limits.md, which `pnpm size` checks against the build in CI, and the large
 * diff from its Large diffs table (`pnpm perf`). Read when the site builds, so the row can't drift
 * from the page that shows the measurements; a missing row fails the build.
 */

/** The table rows under a heading, each as its cells. */
function table(markdown: string, heading: string) {
  const start = markdown.indexOf(`${heading}\n`);
  if (start === -1) throw new Error(`content/docs/limits.md: no "${heading}"`);
  const end = markdown.indexOf('\n## ', start + heading.length);
  return markdown
    .slice(start, end === -1 ? undefined : end)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
}

export interface ProofFigures {
  /** The smallest and largest import, gzipped: "0.4 kB" and "86.7 kB". */
  sizes: { min: string; max: string };
  /** A 5,000-line rewrite, from the request to every file compared and on screen: "265 ms". */
  rewriteReady: string;
}

export function getProofFigures(markdown = readGuide(getGuide('limits')!)): ProofFigures {
  // Each import's own row; the whole main entry at once is not an import an app makes.
  const sizes = table(markdown, '## Bundle size')
    .filter(([name]) => name && !name.startsWith('Everything'))
    .map(([, size = '']) => size);
  const kb = sizes.map((size) => Number(/^([\d.]+) kB$/.exec(size)?.[1]));
  if (kb.length < 2 || kb.some((value) => Number.isNaN(value))) {
    throw new Error(`content/docs/limits.md: the Bundle size table has no sizes in kB (${sizes.join(', ')})`);
  }
  const rewrite = table(markdown, '## Large diffs').find(([name]) => name === 'Full rewrite, 5,000 lines');
  const ready = rewrite?.[2];
  if (!ready || !/^\d+ ms$/.test(ready)) {
    throw new Error('content/docs/limits.md: no "Full rewrite, 5,000 lines" row with a Ready time in ms');
  }
  return {
    sizes: { min: `${Math.min(...kb)} kB`, max: `${Math.max(...kb)} kB` },
    rewriteReady: ready,
  };
}
