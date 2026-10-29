// Adds every shadcn registry item to a new app, the way someone outside this repository does, and
// typechecks the app: `shadcn add` of each item `pnpm registry:build` wrote into the site
// (examples/playground/public/r), which copies its files and installs its npm dependencies at their
// ranges, then tsc with a Next.js app's settings. registry:check compares registry.json with src/,
// and lint:registry lints src/, but neither installs an item. This catches an item that doesn't
// compile once copied, and a new release of a dependency (within its range) or of a peer (`ai`,
// `@assistant-ui/react`, at their latest) that breaks one. It also checks that each item names the
// version of signoff-ui it was built at.
//
//   pnpm registry:build && pnpm registry:typecheck
//
// The app is a temporary directory, installed with npm and no lockfile. Install scripts are off
// (npm_config_ignore_scripts): the items' dependencies need none, and no package from the registry
// runs code as it installs. CI runs this on each pull request and daily.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const built = join(root, 'examples/playground/public/r');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const bin = (name) => join(root, 'node_modules/.bin', name);
const library = readJson(join(root, 'packages/signoff-ui/package.json'));
const names = readJson(join(root, 'registry.json')).items.map((item) => item.name);

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

const items = names.map((name) => {
  const file = join(built, `${name}.json`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run \`pnpm registry:build\` first`);
  const item = readJson(file);
  if (item.meta?.version !== library.version || typeof item.meta?.unreleasedChanges !== 'boolean')
    throw new Error(
      `${name}.json does not name signoff-ui ${library.version} in its meta: ${JSON.stringify(item.meta)}`,
    );
  return { name, file, item };
});

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
    .map((spec) => spec.replace(/(?<=.)@.*$/, ''))
    .sort()
    .map((name) => `${name} ${readJson(join(app, 'node_modules', name, 'package.json')).version}`);
  console.log(
    `pass  ${items.length} items (signoff-ui ${library.version}) added with shadcn to a new app, typechecked`,
  );
  console.log(`      ${installed.join(', ')}`);
} catch (error) {
  // npm, shadcn and tsc have printed why above.
  console.log(`FAIL  ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  rmSync(app, { recursive: true, force: true, maxRetries: 5 });
}
