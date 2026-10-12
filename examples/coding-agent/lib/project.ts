/*
 * The repository the agent works in: a tiny package, kept in memory. The agent's tools read it and
 * the reviews you apply change it (lib/workspace.ts); nothing touches your disk.
 */

/** Files by path. */
export type Files = Readonly<Record<string, string>>;

export const REPO = 'acme/slugify';
export const BRANCH = 'fix/slug-accents';

/** What the agent is asked to do. */
export const TASK =
  "Slugs drop accented letters: slugify('Crème brûlée') returns 'cr-me-br-l-e'. Make it return 'creme-brulee', and add a test.";

export const PROJECT: Files = {
  'package.json': `{
  "name": "@acme/slugify",
  "version": "1.2.0",
  "description": "Turns a title into a URL slug.",
  "type": "module",
  "exports": "./src/slugify.ts",
  "scripts": {
    "test": "node --test"
  }
}
`,
  'README.md': `# @acme/slugify

Turns a title into a URL slug.

\`\`\`ts
import { slugify } from '@acme/slugify';

slugify('Hello World'); // 'hello-world'
slugify('Hello World', '_'); // 'hello_world'
\`\`\`
`,
  'src/slugify.ts': `/**
 * Turns a title into a URL slug: lowercase words of letters and digits, joined by \`separator\`.
 *
 *   slugify('Hello World') // 'hello-world'
 */
export function slugify(text: string, separator = '-'): string {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.join(separator);
}

/** Whether \`text\` is a slug already, as \`slugify\` makes them. */
export function isSlug(text: string, separator = '-'): boolean {
  return text.length > 0 && slugify(text, separator) === text;
}
`,
  'test/slugify.test.ts': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSlug, slugify } from '../src/slugify.ts';

test('lowercases words and joins them with dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('drops punctuation', () => {
  assert.equal(slugify('Rock & Roll!'), 'rock-roll');
});

test('takes another separator', () => {
  assert.equal(slugify('Hello World', '_'), 'hello_world');
});

test('tells slugs apart', () => {
  assert.ok(isSlug('hello-world'));
  assert.ok(!isSlug('Hello World'));
});
`,
};

/** The project's paths, in the order a listing shows them. */
export function listPaths(files: Files): string[] {
  return Object.keys(files).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

const depth = (path: string) => path.split('/').length;
