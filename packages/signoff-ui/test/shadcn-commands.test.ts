// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REGISTRY_URL, shadcnAdd } from '../../../examples/playground/lib/site';

/*
 * Every shadcn command the README and the docs show must work as copied. `@signoff-ui/<item>`
 * fails with "Unknown registry" unless components.json has the namespace's `registries` entry, so
 * it only appears next to that entry; everywhere else the command names the item's URL, or the
 * repository. The migration guide renames an existing entry first, and is left out.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const items: string[] = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.map(
  (item: { name: string }) => item.name,
);
const docs = join(root, 'examples/playground/content/docs');
const pages = [
  'README.md',
  ...readdirSync(docs)
    .filter((file) => file.endsWith('.md') && file !== 'migrating-from-agent-ui-kit.md')
    .map((file) => `examples/playground/content/docs/${file}`),
];

const commands = (text: string) => [...text.matchAll(/shadcn@latest add ([^\s`'"]+)/g)].map(([, target]) => target!);

describe('the shadcn commands in the docs', () => {
  it.each(pages)('%s: each works as copied', (page) => {
    const text = readFileSync(join(root, page), 'utf8');
    const namespace = /"@signoff-ui": "https:\/\/signoff-ui\.vercel\.app\/r\/\{name\}\.json"/.test(text);
    for (const target of commands(text)) {
      const url = /^https:\/\/signoff-ui\.vercel\.app\/r\/([\w-]+)\.json$/.exec(target);
      const repository = /^dgesteves\/signoff-ui\/([\w-]+)$/.exec(target);
      const named = /^@signoff-ui\/([\w-]+)$/.exec(target);
      const item = (url ?? repository ?? (namespace ? named : null))?.[1];
      expect(items, `${page}: npx shadcn@latest add ${target}`).toContain(item);
    }
  });

  it('names every item, at its URL, in getting started', () => {
    const text = readFileSync(join(docs, 'getting-started.md'), 'utf8');
    const listed = /The items are (.+?), each at/.exec(text)?.[1];
    expect([...(listed ?? '').matchAll(/`([\w-]+)`/g)].map(([, name]) => name).sort()).toEqual([...items].sort());
  });
});

describe('the shadcn command on the site', () => {
  it('adds an item by its URL, from one constant', () => {
    expect(REGISTRY_URL).toBe('https://signoff-ui.vercel.app/r');
    expect(shadcnAdd('diff-review')).toBe('npx shadcn@latest add https://signoff-ui.vercel.app/r/diff-review.json');
  });

  it('is built from that constant everywhere', () => {
    const site = join(root, 'examples/playground');
    const files = ['components', 'lib', 'app'].flatMap((dir) =>
      readdirSync(join(site, dir), { recursive: true, encoding: 'utf8' })
        .filter((file) => /\.tsx?$/.test(file))
        .map((file) => join(site, dir, file)),
    );
    const literal = files.filter((file) => /shadcn@latest add [@\w]/.test(readFileSync(file, 'utf8')));
    expect(literal.map((file) => file.slice(root.length))).toEqual([]);
  });
});
