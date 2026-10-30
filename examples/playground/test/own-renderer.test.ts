/*
 * /docs/own-renderer, the recipe in which useDiffReview holds the review and @pierre/diffs draws it
 * (components/demos/pierre-review.tsx, live on that page). What it rests on: @pierre/diffs, given
 * the patch of the review's own hunks with both contents, draws those hunks and no others, with the
 * same lines at the same numbers, so a decision or a comment keyed to hunk `i` lands on the change
 * drawn as hunk `i`. The page's code is the demo's, and @pierre/diffs stays out of the published
 * package. Needs the library built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { processFile, type FileDiffMetadata } from '@pierre/diffs';
import { parseFileChange, toPatch, type FileChange, type ParsedFileDiff } from 'signoff-ui/core';
import { getGuide, NAV, readGuide } from '../lib/docs';
import { RATELIMIT_UPSTASH, ROUTE_NEW, ROUTE_OLD } from '../lib/scenario';

const SITE = join(import.meta.dirname, '..');
const ROOT = join(SITE, '../..');
const DEMO = 'components/demos/pierre-review.tsx';

/** As the demo does it: the patch of every hunk accepted, read with both contents. */
function toPierre(file: ParsedFileDiff): FileDiffMetadata {
  const all = Object.fromEntries(file.hunks.map((hunk) => [hunk.id, 'accepted' as const]));
  return processFile(toPatch([file], all), {
    oldFile: { name: file.oldPath ?? file.path, contents: file.oldContent ?? '' },
    newFile: { name: file.path, contents: file.newContent ?? '' },
    throwOnError: true,
  })!;
}

type Line = { type: 'context' | 'add' | 'del'; content: string; oldNumber?: number; newNumber?: number };

/** Each hunk's lines as @pierre/diffs draws them: kind, text, and number on each side. */
function pierreLines(diff: FileDiffMetadata): Line[][] {
  const text = (lines: string[], i: number) => lines[i]!.replace(/\r?\n$/, '');
  return diff.hunks.map((hunk) =>
    hunk.hunkContent.flatMap((part): Line[] => {
      if (part.type === 'context') {
        return Array.from({ length: part.lines }, (_, k) => ({
          type: 'context',
          content: text(diff.additionLines, part.additionLineIndex + k),
          oldNumber: part.deletionLineIndex + k + 1,
          newNumber: part.additionLineIndex + k + 1,
        }));
      }
      return [
        ...Array.from({ length: part.deletions }, (_, k): Line => ({
          type: 'del',
          content: text(diff.deletionLines, part.deletionLineIndex + k),
          oldNumber: part.deletionLineIndex + k + 1,
        })),
        ...Array.from({ length: part.additions }, (_, k): Line => ({
          type: 'add',
          content: text(diff.additionLines, part.additionLineIndex + k),
          newNumber: part.additionLineIndex + k + 1,
        })),
      ];
    }),
  );
}

/** The review's hunks, the same way. */
const reviewLines = (file: ParsedFileDiff): Line[][] =>
  file.hunks.map((hunk) =>
    hunk.lines.map(({ type, content, oldNumber, newNumber }) => ({
      type,
      content,
      ...(oldNumber !== undefined ? { oldNumber } : {}),
      ...(newNumber !== undefined ? { newNumber } : {}),
    })),
  );

const lines = (count: number, line: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => line(i)).join('\n') + '\n';
const LONG = lines(60, (i) => `export const value${i} = ${i};`);

const CASES: Array<[string, FileChange]> = [
  ['a new file (the demo’s first)', { path: 'lib/ratelimit.ts', oldContent: '', newContent: RATELIMIT_UPSTASH }],
  [
    'a route with three hunks (the demo’s second)',
    { path: 'app/api/chat/route.ts', oldContent: ROUTE_OLD, newContent: ROUTE_NEW },
  ],
  ['a deleted file', { path: 'lib/old.ts', oldContent: RATELIMIT_UPSTASH, newContent: '' }],
  [
    'edits far apart and close together',
    {
      path: 'src/values.ts',
      oldContent: LONG,
      newContent: LONG.replace('value3 = 3', 'value3 = 30')
        .replace('value8 = 8', 'value8 = 80')
        .replace('export const value40 = 40;\n', '')
        .replace('value59 = 59;', 'value59 = 59;\nexport const value60 = 60;'),
    },
  ],
  ['no newline at the end of either version', { path: 'a.txt', oldContent: 'a\nb\nc', newContent: 'a\nB\nc' }],
  ['a newline added at the end', { path: 'b.txt', oldContent: 'a\nb', newContent: 'a\nb\n' }],
  [
    'a rename with an edit',
    {
      path: 'src/next.ts',
      oldPath: 'src/prev.ts',
      oldContent: LONG,
      newContent: LONG.replace('value30 = 30', 'value30 = 3'),
    },
  ],
];

describe('the review’s hunks, as @pierre/diffs reads them', () => {
  for (const [name, change] of CASES) {
    it(`draws the review's own hunks, line for line: ${name}`, () => {
      const file = parseFileChange(change);
      assert.ok(file.hunks.length > 0, 'nothing to review');
      const diff = toPierre(file);
      assert.equal(diff.isPartial, false, 'both contents, so unchanged lines expand');
      assert.equal(diff.name, file.path);
      assert.deepEqual(pierreLines(diff), reviewLines(file));
    });
  }

  it('names a new file new, and a deleted one deleted', () => {
    assert.equal(toPierre(parseFileChange(CASES[0]![1])).type, 'new');
    assert.equal(toPierre(parseFileChange(CASES[2]![1])).type, 'deleted');
  });
});

/** The code blocks with a file name for a title: ```tsx title="pierre-review.tsx". */
function codeBlocks(markdown: string) {
  return [...markdown.matchAll(/^```\w+ title="([^"]+)"[^\n]*\n([\s\S]*?)^```$/gm)].map(([, title, code]) => ({
    title: title!,
    code: code!,
  }));
}

/** Lines without their indentation, so an excerpt can come from inside a function. */
const trimmed = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => line.trim());

describe('/docs/own-renderer', () => {
  const doc = getGuide('own-renderer');
  const markdown = doc ? readGuide(doc) : '';

  it('is a guide, in the sidebar with the others', () => {
    assert.ok(doc, 'lib/docs.ts has no own-renderer guide');
    const guides = NAV.find((group) => group.title === 'Guides')?.items.map((item) => item.href) ?? [];
    assert.ok(guides.includes('/docs/own-renderer'), `the Guides group lists ${guides.join(', ')}`);
  });

  it('shows the demo’s own code, as runs of its lines', () => {
    const shown = codeBlocks(markdown);
    assert.ok(shown.length >= 4, `the page shows ${shown.length} excerpts`);
    const source = trimmed(readFileSync(join(SITE, DEMO), 'utf8'));
    for (const { title, code } of shown) {
      assert.equal(title, 'pierre-review.tsx');
      const excerpt = trimmed(code);
      const at = source.findIndex((_, start) => excerpt.every((line, i) => source[start + i] === line));
      assert.ok(at !== -1, `this excerpt is not in ${DEMO}:\n${code}`);
    }
    assert.ok(markdown.includes(`(https://github.com/dgesteves/signoff-ui/blob/main/examples/playground/${DEMO})`));
  });

  it('names the @pierre/diffs version the site runs', () => {
    const installed = JSON.parse(readFileSync(join(SITE, 'node_modules/@pierre/diffs/package.json'), 'utf8')) as {
      version: string;
    };
    const tested = /Tested with `@pierre\/diffs` (\d+\.\d+\.\d+)/.exec(markdown)?.[1];
    assert.equal(tested, installed.version);
  });

  it('links to the diff viewers on the comparison page, which link back', () => {
    assert.ok(markdown.includes('](/docs/comparison#diff-viewers)'));
    const comparison = readGuide(getGuide('comparison')!);
    assert.match(comparison, /^## Diff viewers$/m);
    assert.ok(comparison.includes('](/docs/own-renderer)'));
  });
});

describe('@pierre/diffs is the site’s, not the package’s', () => {
  it('is a dependency of the site only', () => {
    const site = JSON.parse(readFileSync(join(SITE, 'package.json'), 'utf8')) as { dependencies: object };
    assert.ok('@pierre/diffs' in site.dependencies);
    const pkg = readFileSync(join(ROOT, 'packages/signoff-ui/package.json'), 'utf8');
    assert.ok(!pkg.includes('@pierre/diffs'), 'packages/signoff-ui/package.json names @pierre/diffs');
    assert.ok(!readFileSync(join(ROOT, 'registry.json'), 'utf8').includes('@pierre/diffs'));
  });

  it('is imported by no file of the library', () => {
    const src = join(ROOT, 'packages/signoff-ui/src');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    assert.ok(files.length > 10);
    for (const file of files) {
      assert.ok(!readFileSync(join(src, file), 'utf8').includes('@pierre/diffs'), `src/${file} imports @pierre/diffs`);
    }
  });

  it('loads on its own page only: imported by a client component, when it renders', () => {
    // The docs pages share a route, and a demo imported from a server component there is in the
    // scripts of every one of them: 72.9 kB gzipped of @pierre/diffs on each docs page.
    const guideDemo = readFileSync(join(SITE, 'components/docs/guide-demo.tsx'), 'utf8');
    assert.match(guideDemo, /^'use client';$/m);
    assert.match(guideDemo, /dynamic\(\(\) => import\('\.\.\/demos\/pierre-review'\)/);
    const site = ['app', 'components', 'lib'].flatMap((dir) =>
      readdirSync(join(SITE, dir), { recursive: true, encoding: 'utf8' })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => `${dir}/${f}`),
    );
    const importers = site.filter((file) =>
      /from '[^']*demos\/pierre-review'/.test(readFileSync(join(SITE, file), 'utf8')),
    );
    assert.deepEqual(importers, []);
  });
});
