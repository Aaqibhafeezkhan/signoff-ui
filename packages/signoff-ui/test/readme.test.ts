// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { AI_SDK_MAJOR } from './utils';

/*
 * The README's quickstart is three whole files, each starting with a `// app/...` line: a shorter
 * examples/nextjs-minimal, without its cost meter, its run timing and its failing tool. People copy
 * them as they are into a new app, so they're typechecked here, together, with a new Next.js app's
 * compiler options. The example, which CI builds and runs in Chrome, is the full version, and
 * Getting started on the docs site shows its files in full, with a real model where the example
 * uses the scripted one.
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

const blocks = [...quickstart.matchAll(/```tsx?\n(\/\/ (app\/\S+)[^\n]*\n[\s\S]*?)```/g)].map(([, code, path]) => ({
  path: path!,
  code: code!,
}));
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

const read = (path: string) => readFileSync(join(example, path), 'utf8');

const imports = (blocks: Array<{ code: string }>) => {
  const names = new Set(
    blocks.flatMap(({ code }) => [...code.matchAll(/from '((?:@[^/']+\/)?[^/'.@][^/']*)/g)].map(([, name]) => name!)),
  );
  names.delete('react');
  return [...names];
};

/*
 * The quickstart's files, in memory, in a folder of the playground, which installs every package
 * they import. `signoff-ui` resolves to the built package (`pnpm build:lib`), as it does from npm.
 */
const app = join(root, 'examples/playground/.readme-quickstart');
const built = existsSync(join(root, 'packages/signoff-ui/dist/index.d.ts'));

/** TypeScript errors in the quickstart's files, with create-next-app's compiler options. */
function typeErrors() {
  const files = new Map(blocks.map(({ path, code }) => [join(app, path), code]));
  // TypeScript looks for a file only in a folder that exists: the in-memory files' folders do.
  const folders = new Set<string>();
  for (let folder of [...files.keys()].map(dirname))
    for (; folder.startsWith(app); folder = dirname(folder)) folders.add(folder);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2017,
    lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.d.ts'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: ts.JsxEmit.ReactJSX,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, directoryExists, getSourceFile } = host;
  host.fileExists = (file) => files.has(file) || fileExists(file);
  host.readFile = (file) => files.get(file) ?? readFile(file);
  host.directoryExists = (dir) => folders.has(dir) || (directoryExists?.(dir) ?? true);
  host.getSourceFile = (file, language, ...rest) => {
    const code = files.get(file);
    return code === undefined ? getSourceFile(file, language, ...rest) : ts.createSourceFile(file, code, language);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where = diagnostic.file
      ? `${diagnostic.file.fileName.slice(app.length + 1)}(${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}): `
      : '';
    return where + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  });
}

describe('README quickstart', () => {
  it('shows the route, then the client component and the page that renders it, as whole files', () => {
    expect(blocks.map((block) => block.path)).toEqual(['app/api/chat/route.ts', 'app/agent-run.tsx', 'app/page.tsx']);
    for (const { path, code } of blocks) expect(code, path).not.toMatch(/\(excerpt\)|^\s*\/\/ …$/m);
  });

  it('keeps the client directive, so the client file builds as copied', () => {
    for (const { path, code } of blocks)
      if (read(path).startsWith("'use client';")) expect(code, path).toMatch(/^\/\/ app\/\S+\n'use client';\n/);
  });

  it('installs every package the files import', () => {
    const install = /```bash\nnpm i (signoff-ui [^\n]+)\n```/.exec(quickstart)?.[1]?.split(' ') ?? [];
    expect(imports(blocks).filter((name) => !install.includes(name))).toEqual([]);
  });

  // Needs the built package, and AI SDK 7 for `toolApproval`: CI's main job builds it before the tests.
  it.skipIf(!built || AI_SDK_MAJOR < 7)('typechecks as copied, the three files together', { timeout: 60_000 }, () => {
    expect(typeErrors()).toEqual([]);
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

describe('README top', () => {
  it('links the website before the video, as the sibling projects do', () => {
    const top = readme.slice(0, readme.indexOf('<!-- npm-readme:video -->'));
    expect(top).toMatch(/^\*\*Website and docs:\*\* \[signoff-ui\.vercel\.app\]\(https:\/\/signoff-ui\.vercel\.app\)/m);
  });

  it("gives the smallest and largest import from the docs' size table in its size badge", () => {
    const top = readme.slice(0, readme.indexOf('<!-- npm-readme:video -->'));
    const table = readFileSync(join(root, 'examples/playground/content/docs/limits.md'), 'utf8');
    const sizes = table
      .split('\n')
      .filter((line) => /^\| `/.test(line))
      .map((line) => Number(/([\d.]+) kB \|$/.exec(line)?.[1]));
    expect(sizes.length).toBeGreaterThan(5);
    const range = `${String(Math.min(...sizes))}–${String(Math.max(...sizes))} kB`;
    expect(top).toContain(`[![gzip per import: ${range}]`);
    expect(top).toContain(`gzip_per_import-${encodeURIComponent(range.replace(' ', '_'))}-`);
  });

  it('links each badge to a docs page and heading that exist', () => {
    const top = readme.slice(0, readme.indexOf('<!-- npm-readme:video -->'));
    const links = [...top.matchAll(/\]\(https:\/\/signoff-ui\.vercel\.app\/docs\/([\w-]+)(?:#([\w-]+))?\)/g)];
    expect(links.length).toBeGreaterThan(5);
    for (const [, page, anchor] of links) {
      const file = join(root, 'examples/playground/content/docs', `${page ?? ''}.md`);
      expect(existsSync(file), page).toBe(true);
      if (!anchor) continue;
      const slugs = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^#{2,3} /.test(line))
        .map((line) =>
          line
            .replace(/^#+ /, '')
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, '')
            .replace(/ /g, '-'),
        );
      expect(slugs, `${page ?? ''}#${anchor}`).toContain(anchor);
    }
  });
});
