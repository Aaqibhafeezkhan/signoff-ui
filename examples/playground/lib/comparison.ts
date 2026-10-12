import { getGuide, readGuide } from './docs';

/*
 * The "Where signoff-ui differs" table of content/docs/comparison.md, which the home page shows
 * too, so the two can't drift apart. Read when the site builds; a missing table fails the build.
 */

const SECTION = '## Where signoff-ui differs';

export interface Comparison {
  /** The kit's column and the other library's, as the table's header names them. */
  columns: { kit: string; other: string };
  /** One row per topic; the cells are inline Markdown. */
  rows: Array<{ topic: string; kit: string; other: string }>;
}

const cells = (line: string) =>
  line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

export function getComparison(): Comparison {
  const markdown = readGuide(getGuide('comparison')!);
  const start = markdown.indexOf(`${SECTION}\n`);
  const end = markdown.indexOf('\n## ', start + SECTION.length);
  const lines =
    start === -1
      ? []
      : markdown
          .slice(start, end === -1 ? undefined : end)
          .split('\n')
          .filter((line) => line.startsWith('|'));
  if (lines.length < 3) throw new Error(`content/docs/comparison.md: no table under "${SECTION}"`);
  const [, kit = '', other = ''] = cells(lines[0]!);
  // Skip the header and the delimiter row.
  const rows = lines.slice(2).map((line) => {
    const [topic = '', kitCell = '', otherCell = ''] = cells(line);
    return { topic, kit: kitCell, other: otherCell };
  });
  return { columns: { kit, other }, rows };
}
