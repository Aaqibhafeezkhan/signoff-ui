// Checks the shadcn registry items `pnpm registry:build` wrote into the site
// (examples/playground/public/r), the way someone outside this repository gets them. registry:check
// compares registry.json with src/, and lint:registry lints src/, but neither looks at a built item.
// This script has two parts, and each proves one thing:
//
// 1. Each item declares what its own files import, read from the item alone, with no install: every
//    relative import is one of its files, every npm package one of its dependencies (React, which
//    the app has, and the app's `@/` alias aside), or a file or dependency of an item in its
//    registryDependencies. A file several items carry has the same content in each. Each item names
//    the version of signoff-ui it was built at.
// 2. All the items compile together: `shadcn add` of every item into one new app, which copies their
//    files and installs their npm dependencies at their ranges, then tsc with a Next.js app's
//    settings. This catches an item that doesn't compile once copied, and a new release of a
//    dependency (within its range) or of a peer (`ai`, `@assistant-ui/react`, at their latest) that
//    breaks one. One install for all the items: by itself it would let one item's file or
//    dependency stand in for another's, which part 1 rules out, and since a shared file is the same
//    in each item, the copy tsc checks is every item's.
//
//   pnpm registry:build && pnpm registry:typecheck
//
// The app is a temporary directory, installed with npm and no lockfile. Install scripts are off
// (npm_config_ignore_scripts): the items' dependencies need none, and no package from the registry
// runs code as it installs. CI runs this on each pull request and daily.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const built = join(root, 'examples/playground/public/r');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const bin = (name) => join(root, 'node_modules/.bin', name);

/** The modules a source file imports: imports and re-exports, dynamic imports, workers started by URL. */
export function importsOf(code) {
  const patterns = [
    /^[ \t]*(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^[ \t]*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bnew URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];
  return [...new Set(patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1])))];
}

/** The npm package of a bare import (`@scope/name/sub` → `@scope/name`) or of a dependency spec (`diff@^9.0.0` → `diff`). */
const packageOf = (spec) => {
  const [first, second] = spec.replace(/(?<=.)@.*$/, '').split('/');
  return first.startsWith('@') ? `${first}/${second}` : first;
};

/** What the app has without an item: React, and its `@/` path alias. */
const ownedByApp = (spec) => /^(react|react-dom)(\/|$)/.test(spec) || spec.startsWith('@/');

/**
 * What adding one item on its own would miss, which adding every item to one app hides: a relative
 * import that is not one of its files, an npm package that is not one of its dependencies (in both
 * cases, nor of an item in its registryDependencies), and a file it carries with content other than
 * another item's copy, which `shadcn add --overwrite` would replace. Takes the items as `shadcn
 * build` writes them (files with their content); returns one line per problem, naming the item.
 */
export function itemProblems(items) {
  const byName = new Map(items.map((item) => [item.name, item]));
  /** The item and the items of this registry its registryDependencies bring, transitively. */
  const brought = (item, seen = new Map()) => {
    if (seen.has(item.name)) return seen;
    seen.set(item.name, item);
    for (const dependency of item.registryDependencies ?? []) {
      // `diff-review`, `@signoff-ui/diff-review` or `https://…/r/diff-review.json`.
      const other = byName.get(posix.basename(dependency, '.json'));
      if (other) brought(other, seen);
    }
    return seen;
  };

  const problems = [];
  const copies = new Map();
  for (const item of items) {
    const installed = [...brought(item).values()];
    const files = new Set(installed.flatMap((each) => each.files.map((file) => file.target)));
    const packages = new Set(installed.flatMap((each) => each.dependencies ?? []).map(packageOf));
    for (const { target, content } of item.files) {
      const first = copies.get(target);
      if (!first) copies.set(target, { name: item.name, content });
      else if (first.content !== content)
        problems.push(`${item.name}: its ${target} differs from the one in ${first.name}`);

      for (const spec of importsOf(content)) {
        if (spec.startsWith('.')) {
          const base = posix.join(posix.dirname(target), spec);
          if (!['', '.ts', '.tsx', '/index.ts', '/index.tsx'].some((extension) => files.has(base + extension)))
            problems.push(`${item.name}: ${target} imports ${spec}, which is not one of its files`);
        } else if (!ownedByApp(spec) && !packages.has(packageOf(spec))) {
          problems.push(`${item.name}: ${target} imports ${spec}, which is not one of its dependencies`);
        }
      }
    }
  }
  return problems;
}

/** A new Next.js app's React, types and TypeScript settings, with shadcn set up for Tailwind v4. */
const APP = {
  'package.json': {
    name: 'registry-app',
    private: true,
    type: 'module',
    dependencies: { react: '^19', 'react-dom': '^19' },
    devDependencies: { '@types/node': '^24', '@types/react': '^19', '@types/react-dom': '^19' },
  },
  'components.json': {
    $schema: 'https://ui.shadcn.com/schema.json',
    style: 'new-york',
    rsc: true,
    tsx: true,
    tailwind: { config: '', css: 'app/globals.css', baseColor: 'neutral', cssVariables: true },
    aliases: {
      components: '@/components',
      utils: '@/lib/utils',
      ui: '@/components/ui',
      lib: '@/lib',
      hooks: '@/hooks',
    },
  },
  'tsconfig.json': {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'react-jsx',
      types: ['node'],
      paths: { '@/*': ['./*'] },
    },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules'],
  },
};

function main() {
  const library = readJson(join(root, 'packages/signoff-ui/package.json'));
  const names = readJson(join(root, 'registry.json')).items.map((item) => item.name);
  const items = names.map((name) => {
    const file = join(built, `${name}.json`);
    if (!existsSync(file)) throw new Error(`${file} is missing: run \`pnpm registry:build\` first`);
    return { file, item: readJson(file) };
  });

  const problems = [
    ...items
      .filter(({ item }) => item.meta?.version !== library.version || typeof item.meta?.unreleasedChanges !== 'boolean')
      .map(
        ({ item }) =>
          `${item.name}.json does not name signoff-ui ${library.version} in its meta: ${JSON.stringify(item.meta)}. Run \`pnpm registry:build\`.`,
      ),
    ...itemProblems(items.map(({ item }) => item)),
  ];
  if (problems.length > 0) {
    for (const problem of problems) console.log(`FAIL  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `pass  ${items.length} items each declare the files and npm packages their files import, and name signoff-ui ${library.version}`,
  );

  const app = mkdtempSync(join(tmpdir(), 'signoff-registry-'));
  try {
    for (const [file, content] of Object.entries(APP))
      writeFileSync(join(app, file), `${JSON.stringify(content, null, 2)}\n`);
    mkdirSync(join(app, 'app'));
    writeFileSync(join(app, 'app/globals.css'), '@import "tailwindcss";\n');

    const npm = ['--no-audit', '--no-fund'];
    const env = { ...process.env, npm_config_ignore_scripts: 'true' };
    execFileSync('npm', ['install', ...npm], { cwd: app, stdio: 'inherit', env });
    // The lockfile npm just wrote makes shadcn install the items' dependencies with npm too.
    execFileSync(bin('shadcn'), ['add', '--yes', '--overwrite', '--silent', ...items.map(({ file }) => file)], {
      cwd: app,
      stdio: 'inherit',
      env,
    });

    const missing = items
      .flatMap(({ item }) => item.files.map((file) => file.target))
      .filter((target) => !existsSync(join(app, target)));
    if (missing.length > 0) throw new Error(`shadcn add did not write: ${[...new Set(missing)].join(', ')}`);

    // In the app, so tsc names each file as the app has it (components/signoff-ui/...).
    execFileSync(bin('tsc'), ['-p', 'tsconfig.json'], { cwd: app, stdio: 'inherit' });

    const installed = [...new Set(items.flatMap(({ item }) => item.dependencies ?? []))]
      .map(packageOf)
      .sort()
      .map((name) => `${name} ${readJson(join(app, 'node_modules', name, 'package.json')).version}`);
    console.log(
      `pass  ${items.length} items (signoff-ui ${library.version}) added with shadcn to a new app, typechecked`,
    );
    console.log(`      ${installed.join(', ')}`);
  } finally {
    rmSync(app, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    // npm, shadcn and tsc have printed why above.
    console.log(`FAIL  ${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}
