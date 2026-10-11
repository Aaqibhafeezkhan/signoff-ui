// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The quickstart is examples/nextjs-minimal, which CI builds and runs in Chrome. The README shows
 * excerpts of it: each block that starts with `// app/... (excerpt)` is that file of the example,
 * in pieces separated by `// …` lines, each piece taken whole and in order, whatever its indent;
 * an import may name fewer of the module's exports than the file's. A block that starts with
 * `// app/...` alone is the whole file. Getting started on the docs site shows the files in full.
 * Both may use a real model where the example uses the scripted one.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const example = join(root, 'examples/nextjs-minimal');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const quickstart = readme.slice(
  readme.indexOf('## Quickstart'),
  readme.indexOf('\n## ', readme.indexOf('## Quickstart') + 1),
);
const guide = readFileSync(join(root, 'examples/playground/content/docs/getting-started.md'), 'utf8');
const walkthrough = guide.slice(
  guide.indexOf('## Render a run'),
  guide.indexOf('\n## ', guide.indexOf('## Render a run') + 1),
);

const blocks = [...quickstart.matchAll(/```tsx?\n\/\/ (app\/\S+)( \(excerpt\))?\n([\s\S]*?)```/g)].map(
  ([, path, excerpt, code]) => ({ path: path!, excerpt: !!excerpt, code: code! }),
);
const excerpts = blocks.filter((block) => block.excerpt);
const wholeFiles = blocks.filter((block) => !block.excerpt);
const files = [...walkthrough.matchAll(/```tsx? title="(app\/\S+)"\n([\s\S]*?)```/g)].map(([, path, code]) => ({
  path: path!,
  code: code!,
}));

/** The model is the one line that differs: `openai(...)` in the docs, the scripted model in the example. */
const withoutModel = (code: string) =>
  code
    .split('\n')
    .filter((line) => !/from '(@ai-sdk\/openai|@\/lib\/mock-model)'/.test(line))
    .map((line) => line.replace(/^(\s*)model: .*$/, '$1model,'))
    .join('\n');

const lines = (code: string) =>
  withoutModel(code)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const read = (path: string) => readFileSync(join(example, path), 'utf8');

/** Whether an excerpt's line is the file's: the same, or an import of some of the same names. */
const sameLine = (excerpt: string, file: string) => {
  if (excerpt === file) return true;
  const named = (line: string) => /^import \{ (.+) \} from ('[^']+');$/.exec(line);
  const [a, b] = [named(excerpt), named(file)];
  if (!a || !b || a[2] !== b[2]) return false;
  const names = new Set(b[1]!.split(', '));
  return a[1]!.split(', ').every((name) => names.has(name));
};

const imports = (blocks: Array<{ code: string }>) => {
  const names = new Set(
    blocks.flatMap(({ code }) => [...code.matchAll(/from '((?:@[^/']+\/)?[^/'.@][^/']*)/g)].map(([, name]) => name!)),
  );
  names.delete('react');
  return [...names];
};

describe('README quickstart', () => {
  it('shows the route, then the client component and the page that renders it, of the runnable example', () => {
    expect(blocks.map((block) => block.path)).toEqual(['app/api/chat/route.ts', 'app/agent-run.tsx', 'app/page.tsx']);
  });

  it.each(wholeFiles)('$path is the example file', ({ path, code }) => {
    expect(code).toBe(read(path));
  });

  it('keeps a client file’s directive in its excerpt, so it builds as copied', () => {
    for (const { path, code } of excerpts)
      if (read(path).startsWith("'use client';")) expect(code, path).toMatch(/^'use client';\n/);
  });

  it.each(excerpts)('$path is an excerpt of the example', ({ path, code }) => {
    expect(existsSync(join(example, path))).toBe(true);
    const file = lines(read(path));
    let from = 0;
    for (const piece of code
      .split(/^\s*\/\/ …$/m)
      .map(lines)
      .filter((piece) => piece.length > 0)) {
      const at = file.findIndex((_, i) => i >= from && piece.every((line, j) => sameLine(line, file[i + j] ?? '')));
      expect(at, `not in ${path}, in this order:\n${piece.join('\n')}`).toBeGreaterThanOrEqual(0);
      from = at + piece.length;
    }
  });

  it('installs every package the excerpts import', () => {
    const install = /```bash\nnpm i (signoff-ui [^\n]+)\n```/.exec(quickstart)?.[1]?.split(' ') ?? [];
    expect(imports(blocks).filter((name) => !install.includes(name))).toEqual([]);
  });
});

describe('Getting started', () => {
  it('shows the client, the page and the route of the runnable example', () => {
    expect(files.map((block) => block.path)).toEqual(['app/agent-run.tsx', 'app/page.tsx', 'app/api/chat/route.ts']);
  });

  it.each(files)('$path is the example file', ({ path, code }) => {
    expect(withoutModel(code)).toBe(withoutModel(read(path)));
  });

  it('installs every package the walkthrough imports', () => {
    const install = /```package-install\nnpm i (signoff-ui [^\n]+)\n```/.exec(walkthrough)?.[1]?.split(' ') ?? [];
    expect(imports(files).filter((name) => !install.includes(name))).toEqual([]);
  });
});
