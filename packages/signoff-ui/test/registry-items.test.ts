// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/*
 * The shadcn registry (scripts/registry.mjs): each item asks for its npm dependencies at the range
 * the package is published with, so `shadcn add` installs the major the code is tested against
 * rather than whatever is latest; the items the site serves name the version of signoff-ui they
 * were built at; each item declares what its own files import (scripts/registry-check.mjs); and CI
 * adds every built item to a new app and typechecks it.
 */

interface Manifest {
  version: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}
interface Item {
  name: string;
  dependencies?: string[];
  meta?: Record<string, unknown>;
}
/** An item as `shadcn build` writes it: each file with its content. */
interface BuiltItem extends Item {
  registryDependencies?: string[];
  files: { target: string; content: string }[];
}
interface RegistryScript {
  dependencySpec: (name: string, manifest?: Partial<Manifest>) => string;
  hasPendingChangeset: (dir?: string) => boolean;
  stamp: (dir: string, options?: { version?: string; unreleasedChanges?: boolean }) => number;
}
interface CheckScript {
  importsOf: (code: string) => string[];
  itemProblems: (items: BuiltItem[]) => string[];
}
interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, { if?: string; steps: { run?: string }[] }>;
}

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const library = JSON.parse(read('packages/signoff-ui/package.json')) as Manifest;
const registry = JSON.parse(read('registry.json')) as {
  items: (Item & { files: { path: string; target: string }[] })[];
};
const { dependencySpec, hasPendingChangeset, stamp } = (await import(
  pathToFileURL(join(root, 'scripts/registry.mjs')).href
)) as RegistryScript;
const { importsOf, itemProblems } = (await import(
  pathToFileURL(join(root, 'scripts/registry-check.mjs')).href
)) as CheckScript;

/** A dependency as an item gives it, `name@range` or a bare `name`, split. */
const split = (spec: string) => {
  const at = spec.indexOf('@', 1);
  return at === -1 ? { name: spec, range: undefined } : { name: spec.slice(0, at), range: spec.slice(at + 1) };
};

/** What a failure below means when packages/signoff-ui/package.json changed and registry.json did not. */
const OUT_OF_DATE = 'registry.json is out of date with packages/signoff-ui/package.json: run `pnpm registry:generate`';

describe("the registry items' npm dependencies", () => {
  const specs = [...new Set(registry.items.flatMap((item) => item.dependencies ?? []))];

  it("ask for each of the package's dependencies at the range packages/signoff-ui/package.json gives it", () => {
    const diffReview = registry.items.find((item) => item.name === 'diff-review')?.dependencies ?? [];
    expect(diffReview, OUT_OF_DATE).toContain(`diff@${library.dependencies.diff}`);
    expect(diffReview, OUT_OF_DATE).toContain(`tailwind-merge@${library.dependencies['tailwind-merge']}`);
    const ranged = specs.filter((spec) => split(spec).name in library.dependencies);
    expect(ranged.length).toBeGreaterThan(5);
    for (const spec of ranged)
      expect(split(spec).range, `${spec}: ${OUT_OF_DATE}`).toBe(library.dependencies[split(spec).name]);
  });

  // shadcn skips a bare name the app already has; with a range it installs it again, and npm moves it
  // to the newest version in range: `ai@^6.0.0 || ^7.0.102` would take an app on AI SDK 6 to 7.
  it('leave a peer dependency bare, so shadcn keeps the version the app has', () => {
    const peers = specs.filter((spec) => split(spec).name in library.peerDependencies);
    expect(peers.sort()).toEqual(['@assistant-ui/react', 'ai']);
  });

  it('ask for nothing the package does not depend on', () => {
    for (const spec of specs) {
      const { name } = split(spec);
      expect(name in library.dependencies || name in library.peerDependencies, `${spec}: ${OUT_OF_DATE}`).toBe(true);
    }
  });

  it('come from the manifest, and a package it does not declare fails the generator', () => {
    expect(dependencySpec('diff', { dependencies: { diff: '^9.0.0' } })).toBe('diff@^9.0.0');
    expect(dependencySpec('ai', { peerDependencies: { ai: '^6.0.0 || ^7.0.102' } })).toBe('ai');
    expect(() => dependencySpec('left-pad', { dependencies: {}, peerDependencies: {} })).toThrow(
      'left-pad is imported by a registry file, but is not a dependency or peer dependency of packages/signoff-ui',
    );
  });
});

describe("the version in the built items' meta", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'signoff-registry-'));
    dirs.push(dir);
    return dir;
  };

  /** What `shadcn build` writes: the index, registry.json, and each item with its files' content. */
  const built = () => {
    const dir = temp();
    const items = ['diff-review', 'markdown'].map((name) => ({ name, type: 'registry:component' }));
    writeFileSync(join(dir, 'registry.json'), JSON.stringify({ name: 'signoff-ui', items }));
    for (const item of items)
      writeFileSync(join(dir, `${item.name}.json`), JSON.stringify({ ...item, files: [{ content: 'x' }] }));
    return dir;
  };
  const json = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Item;

  it("names signoff-ui's version in each item and in the index, keeping the rest", () => {
    const dir = built();
    expect(stamp(dir, { unreleasedChanges: false })).toBe(2);
    const meta = { version: library.version, unreleasedChanges: false };
    for (const name of ['diff-review', 'markdown']) {
      expect(json(dir, `${name}.json`)).toMatchObject({ name, files: [{ content: 'x' }], meta });
    }
    const index = json(dir, 'registry.json') as unknown as { items: Item[] };
    expect(index.items.map((item) => item.meta)).toEqual([meta, meta]);
  });

  it('says when main has changes that npm does not have yet', () => {
    const dir = built();
    stamp(dir, { version: '0.12.0', unreleasedChanges: true });
    expect(json(dir, 'markdown.json').meta).toEqual({ version: '0.12.0', unreleasedChanges: true });
  });

  it('counts a pending changeset only when it changes signoff-ui', () => {
    const changesets = temp();
    writeFileSync(join(changesets, 'README.md'), '# Changesets\n\nsignoff-ui: patch\n');
    writeFileSync(join(changesets, 'config.json'), '{}');
    expect(hasPendingChangeset(changesets)).toBe(false);
    writeFileSync(join(changesets, 'empty-cats-run.md'), '---\n---\n\nNothing to release.\n');
    expect(hasPendingChangeset(changesets)).toBe(false);
    // The body is the changelog entry: a line of it that starts with the package's name bumps nothing.
    writeFileSync(join(changesets, 'loud-owls-fly.md'), "---\n'playground': patch\n---\n\nsignoff-ui: no change.\n");
    expect(hasPendingChangeset(changesets)).toBe(false);
    writeFileSync(join(changesets, 'quiet-dogs-sing.md'), "---\n'signoff-ui': patch\n---\n\nFix a thing.\n");
    expect(hasPendingChangeset(changesets)).toBe(true);
  });

  it('is what `pnpm registry:build` ends with, on the items shadcn build wrote', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const build =
      /^pnpm registry:check && shadcn build registry\.json --output (\S+) && node scripts\/registry\.mjs --stamp (\S+)$/.exec(
        scripts['registry:build'] ?? '',
      );
    expect(build?.[1]).toBe('examples/playground/public/r');
    expect(build?.[2]).toBe(build?.[1]);
  });
});

// One `shadcn add` of every item lets one item's file or dependency stand in for another's, and the
// last copy of a shared file overwrite the others: this reads each item on its own.
describe('each item, read on its own, declares what its files import', () => {
  /** The items registry.json lists, with each file's content, as `shadcn build` writes them. */
  const items = (): BuiltItem[] =>
    registry.items.map((item) => ({
      ...item,
      files: item.files.map((file) => ({ target: file.target, content: read(file.path) })),
    }));
  const find = (all: BuiltItem[], name: string) => all.find((item) => item.name === name)!;

  it('passes on every item in registry.json', () => {
    expect(registry.items.length).toBeGreaterThan(10);
    expect(itemProblems(items())).toEqual([]);
  });

  it('names an item whose dependencies leave out a package its files import', () => {
    const all = items();
    find(all, 'agent-status').dependencies = [];
    expect(itemProblems(all)).toContain(
      'agent-status: components/signoff-ui/lib/utils.ts imports clsx, which is not one of its dependencies',
    );
  });

  it('names an item that leaves out a file its files import', () => {
    const all = items();
    const item = find(all, 'agent-status');
    item.files = item.files.filter((file) => file.target !== 'components/signoff-ui/lib/utils.ts');
    expect(itemProblems(all)).toContain(
      'agent-status: components/signoff-ui/agent-status.tsx imports ./lib/utils, which is not one of its files',
    );
  });

  it("names an item whose copy of a shared file is not the others'", () => {
    const all = items();
    const markdown = find(all, 'markdown').files.find((file) => file.target === 'components/signoff-ui/markdown.tsx')!;
    markdown.content += '\nconst broken: number = "1";\n';
    expect(itemProblems(all)).toEqual([
      'markdown: its components/signoff-ui/markdown.tsx differs from the one in agent-message',
    ]);
  });

  it("counts what its registryDependencies bring, and React and the `@/` alias as the app's", () => {
    const utils = {
      name: 'utils',
      dependencies: ['clsx@^2.1.1'],
      files: [{ target: 'components/kit/lib/utils.ts', content: "import { clsx } from 'clsx';\n" }],
    };
    const card = {
      name: 'card',
      files: [
        {
          target: 'components/kit/card.tsx',
          content: [
            "import { useState } from 'react';",
            "import { Button } from '@/components/ui/button';",
            "import { cn } from './lib/utils';",
            "import type { ClassValue } from 'clsx';",
          ].join('\n'),
        },
      ],
    };
    expect(itemProblems([utils, card])).toEqual([
      'card: components/kit/card.tsx imports ./lib/utils, which is not one of its files',
      'card: components/kit/card.tsx imports clsx, which is not one of its dependencies',
    ]);
    for (const dependency of ['utils', '@signoff-ui/utils', 'https://signoff-ui.vercel.app/r/utils.json'])
      expect(itemProblems([utils, { ...card, registryDependencies: [dependency] }]), dependency).toEqual([]);
  });

  it('reads imports, type imports, re-exports, side effects, dynamic imports and workers, not comments', () => {
    const code = [
      "import type { UIMessage } from 'ai';",
      'import {',
      '  Root,',
      '  Trigger,',
      "} from '@radix-ui/react-collapsible';",
      "export { cn } from './lib/utils';",
      "import './styles.css';",
      "const lazy = () => import('react-markdown');",
      "new Worker(new URL('./lib/diff-worker.ts', import.meta.url), { type: 'module' });",
      "// import { left } from 'left-pad';",
      " * import { right } from 'right-pad';",
      "const text = 'export from';",
    ].join('\n');
    expect(importsOf(code).sort()).toEqual([
      './lib/diff-worker.ts',
      './lib/utils',
      './styles.css',
      '@radix-ui/react-collapsible',
      'ai',
      'react-markdown',
    ]);
  });
});

describe('CI adds every built item to a new app and typechecks it', () => {
  const ci = parse(read('.github/workflows/ci.yml')) as Workflow;
  const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('in a job of its own, after building the registry', () => {
    expect(scripts['registry:typecheck']).toBe('node scripts/registry-check.mjs');
    const job = Object.values(ci.jobs).find((candidate) =>
      candidate.steps.some((step) => step.run === 'pnpm registry:typecheck'),
    );
    const runs = job?.steps.flatMap((step) => (step.run ? [step.run] : [])) ?? [];
    expect(runs.indexOf('pnpm registry:build')).toBeGreaterThan(-1);
    expect(runs.indexOf('pnpm registry:build')).toBeLessThan(runs.indexOf('pnpm registry:typecheck'));
  });

  // A dependency's new release within its range reaches the next `shadcn add` with no pull request.
  it('on each pull request, and daily', () => {
    const job = Object.values(ci.jobs).find((candidate) =>
      candidate.steps.some((step) => step.run === 'pnpm registry:typecheck'),
    );
    expect(ci.on).toHaveProperty('pull_request');
    expect(ci.on).toHaveProperty('schedule');
    expect(job).toBeDefined();
    expect(job).not.toHaveProperty('if');
  });
});
