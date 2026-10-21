// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatStatus, LanguageModelUsage, UIMessage } from 'ai';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AcpTurn, toAcpMessage } from '../src/acp';
import type { AgUiRunState, fromAgUiMessages, UseAgUiAgentResult } from '../src/ag-ui';
import type { addUsage, RunUsage } from '../src/core';

/*
 * npm enforces an optional peer's range whenever the app has that package, whether or not it imports
 * the entry that needs it, and stops the install with ERESOLVE when the version is out of range. On 0.x
 * a caret takes one minor (`^0.15.0` is 0.15.x only), so every app on another assistant-ui minor, the
 * next one included, couldn't `npm i signoff-ui`. `signoff-ui/assistant-ui` imports only assistant-ui's
 * types, and they compile from 0.15 on (0.14's approval has no `display` or `prompt`).
 *
 * npm 7+ and pnpm install a required peer on their own, so while `ai` was one, an app on AG-UI or ACP
 * got the AI SDK, its provider packages and zod (11 packages, 25 MB with 0.10.0) for types it never
 * needed. The two entries now declare the AI SDK types they return (lib/ai-types.ts).
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const pkg = JSON.parse(read('../package.json')) as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
  devDependencies: Record<string, string>;
};
const range = pkg.peerDependencies['@assistant-ui/react']!;

type Version = [number, number, number];

const parse = (version: string): Version => {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(version);
  if (!match) throw new Error(`Not a version: ${version}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
};

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** npm's reading of the range forms used here: `||`, `>=`, `<` and `^`, which takes one minor on 0.x. */
function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split('||').some((set) =>
    set
      .trim()
      .split(/\s+/)
      .every((comparator) => {
        const [, op, bound] = /^(\^|>=|<)(.+)$/.exec(comparator) ?? [];
        const b = parse(bound ?? comparator);
        if (op === '>=') return compare(v, b) >= 0;
        if (op === '<') return compare(v, b) < 0;
        if (op === '^') {
          const below: Version = b[0] > 0 ? [b[0] + 1, 0, 0] : b[1] > 0 ? [0, b[1] + 1, 0] : [0, 0, b[2] + 1];
          return compare(v, b) >= 0 && compare(v, below) < 0;
        }
        throw new Error(`Unsupported comparator: ${comparator}`);
      }),
  );
}

describe('the optional @assistant-ui/react peer', () => {
  it('reads ranges as npm does', () => {
    expect(satisfies('0.15.28', '^0.15.0')).toBe(true);
    expect(satisfies('0.16.0', '^0.15.0')).toBe(false);
    expect(satisfies('19.2.0', '^18.2.0 || ^19.0.0')).toBe(true);
    expect(satisfies('20.0.0', '^18.2.0 || ^19.0.0')).toBe(false);
  });

  it('takes every assistant-ui 0.x minor from 0.15 on, so npm installs signoff-ui next to it', () => {
    const tested = pkg.devDependencies['@assistant-ui/react']!.replace(/^\^/, '');
    for (const version of ['0.15.0', tested, '0.15.28', '0.16.0', '0.17.2', '0.99.0'])
      expect(satisfies(version, range), version).toBe(true);
  });

  it('leaves out 0.14, whose types the binding does not compile against, and 1.0', () => {
    for (const version of ['0.14.0', '0.14.9', '1.0.0']) expect(satisfies(version, range), version).toBe(false);
  });

  it('is in the README, with what to do on an older assistant-ui', () => {
    const readme = read('../../../README.md');
    const floor = /^>=(\d+\.\d+)\.0 /.exec(range)?.[1];
    expect(floor).toBeDefined();
    expect(readme).toContain(`needs \`@assistant-ui/react\` ${floor} or later`);
    expect(readme).toContain('--legacy-peer-deps');
  });
});

const src = fileURLToPath(new URL('../src/', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

/**
 * The packages each module imports, for every module `entry` reaches through its imports and
 * re-exports, type-only ones included, as an app's TypeScript follows them.
 */
function reach(dir: string, entry: string, extensions: readonly string[]): Map<string, string[]> {
  const packages = new Map<string, string[]>();
  const visit = (file: string) => {
    if (packages.has(file)) return;
    const code = readFileSync(join(dir, file), 'utf8');
    const specifiers = [
      ...code.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm),
      ...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]!);
    packages.set(
      file,
      specifiers.filter((s) => !s.startsWith('.')),
    );
    for (const specifier of specifiers.filter((s) => s.startsWith('.'))) {
      const base = posix.join(posix.dirname(file), specifier).replace(/\.js$/, '');
      const found = extensions.map((ext) => base + ext).find((f) => existsSync(join(dir, f)));
      if (found) visit(found);
    }
  };
  visit(entry);
  return packages;
}

const importing = (graph: Map<string, string[]>, name: string) =>
  [...graph].filter(([, packages]) => packages.includes(name)).map(([file]) => file);

describe('the optional ai peer', () => {
  it('is optional, so npm and pnpm leave the AI SDK out unless the app installs it', () => {
    expect(pkg.peerDependencies.ai).toBeDefined();
    expect(pkg.peerDependenciesMeta.ai).toEqual({ optional: true });
  });

  it('is imported for its types only, so nothing fails at run time without it', () => {
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    const imports = files.flatMap((file) => [
      ...readFileSync(join(src, file), 'utf8').matchAll(/^(?:import|export)\b([^;]*?)\bfrom\s+'ai'/gm),
    ]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.map((m) => m[0]).filter((statement) => !/^(?:import|export) type\b/.test(statement))).toEqual([]);
  });

  it('is not needed by the AG-UI and ACP entries, types included', () => {
    for (const entry of ['ag-ui.ts', 'acp.ts'])
      expect(importing(reach(src, entry, ['.ts', '.tsx']), 'ai'), entry).toEqual([]);
  });

  it.skipIf(!existsSync(join(dist, 'index.d.ts')))('is not in the declarations the two entries ship', () => {
    for (const entry of ['ag-ui.d.ts', 'acp.d.ts']) {
      const graph = reach(dist, entry, ['.d.ts']);
      expect(graph.size, entry).toBeGreaterThan(2);
      expect(importing(graph, 'ai'), entry).toEqual([]);
    }
  });

  it("returns what the AI SDK's types take, so the messages go to AgentMessage or useChat as they are", () => {
    // Checked by `tsc` (pnpm typecheck), against the AI SDK the repository installs.
    expectTypeOf<ReturnType<typeof toAcpMessage>>().toExtend<UIMessage>();
    expectTypeOf<ReturnType<typeof fromAgUiMessages>>().toExtend<UIMessage[]>();
    expectTypeOf<UseAgUiAgentResult['messages']>().toExtend<UIMessage[]>();
    expectTypeOf<AcpTurn['status']>().toEqualTypeOf<ChatStatus>();
    expectTypeOf<AgUiRunState['status']>().toEqualTypeOf<ChatStatus>();
    expectTypeOf<UseAgUiAgentResult['usage']>().toEqualTypeOf<RunUsage | undefined>();
    expectTypeOf<ReturnType<typeof addUsage>>().toExtend<LanguageModelUsage>();
    expectTypeOf<LanguageModelUsage>().toExtend<RunUsage>();
  });

  it('is in Getting started, with what an AG-UI or ACP app can leave out', () => {
    const guide = read('../../../examples/playground/content/docs/getting-started.md');
    expect(guide).toContain('`ai` is an optional peer dependency');
    expect(guide).toContain('`signoff-ui/ag-ui` and `signoff-ui/acp` declare their own types');
  });
});
