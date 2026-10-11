// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { MORE_BY_AUTHOR, TAGLINE } from '../../../examples/playground/lib/site';

/*
 * One line says what signoff-ui is, wherever it appears: the site (its title, hero and footer, from
 * TAGLINE), the README, npm. The footer's lines for the sibling projects are theirs, word for word.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const said = TAGLINE.slice(0, -1);

it('is the same line in the README, on npm and on the site', () => {
  expect(TAGLINE).toBe('Review what your agent changed and approve what it may do.');
  expect(read('README.md').split('\n')[2]).toMatch(new RegExp(`^${said}: `));
  expect(JSON.parse(read('packages/signoff-ui/package.json')).description).toMatch(new RegExp(`^${said}: `));
  expect(read('examples/playground/components/hero.tsx')).toContain(
    'Review what your agent changed. Approve what it may do.',
  );
  expect(read('examples/playground/components/footer.tsx')).toContain('{TAGLINE}');
});

it('gives the sibling projects their own taglines', () => {
  expect(Object.fromEntries(MORE_BY_AUTHOR.map((project) => [project.name, project.description]))).toEqual({
    ondocs: 'Makes your docs answerable by people and agents, from one static index.',
    onsystem: 'Keeps coding agents on your design system.',
  });
});
