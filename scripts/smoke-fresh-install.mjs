// Runs each example the way someone outside this repository does: its files copied out at this
// commit (what `create-next-app --example` or a copy gets), installed from the npm registry with
// the package manager its README uses, no lockfile and no workspace, then started with `dev` and
// driven in Chrome. The other smoke tests build the examples with this repository's lockfile and
// install, so they miss what changes on the registry (a new release of a dependency, a peer that
// resolves differently, npm against pnpm) and bugs only `dev` has.
//
//   pnpm smoke:fresh-install           # signoff-ui from npm, at the version each example asks for
//   pnpm build:lib && pnpm smoke:fresh-install --pack   # this checkout's package, as npm will ship it
//   pnpm smoke:fresh-install nextjs-minimal              # one example
//
// Install scripts are off (--ignore-scripts): the examples need none, and no package from the
// registry runs code as it installs. CI runs this daily, and on the version pull request with --pack.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';

const root = join(import.meta.dirname, '..');
const pack = process.argv.includes('--pack');
const only = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

/** Each example, the package manager its README installs it with, and what to check once it runs. */
const EXAMPLES = {
  'nextjs-minimal': { pm: 'npm', check: (base) => smoke('smoke-nextjs-minimal.mjs', base) },
  'coding-agent': { pm: 'npm', check: (base) => smoke('smoke-coding-agent.mjs', base) },
  'assistant-ui': { pm: 'pnpm', check: (base) => assistantUi(base) },
};
for (const name of only)
  if (!EXAMPLES[name]) throw new Error(`No example ${name}: ${Object.keys(EXAMPLES).join(', ')}`);

/** The repository's own smoke test for the example, against the dev server. */
function smoke(script, base) {
  execFileSync(process.execPath, [join(import.meta.dirname, script)], {
    stdio: 'inherit',
    env: { ...process.env, BASE_URL: base },
  });
}

/** examples/assistant-ui in dev: the review goes back to the model, then the approval card. */
async function assistantUi(base) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.goto(base);
    await page.getByRole('textbox', { name: 'Message the agent' }).fill('Add rate limiting to the chat route');
    await page.getByRole('button', { name: 'Send' }).click();
    const turn = page.locator('.message.assistant').first();
    const diff = turn.locator('[data-slot="signoff-diff-review"]');
    await diff.getByRole('button', { name: 'Accept all' }).click();
    await diff.locator('[data-slot="signoff-diff-submit"]').click();
    await turn.getByText(/Applied 2 of 2 changes in 2 files/).waitFor();
    const card = turn.locator('[data-slot="signoff-approval-card"]');
    await card.and(page.locator('[data-status="pending"]')).waitFor();
    await card.getByRole('button', { name: 'For this session' }).click();
    await turn.getByText('Installed @upstash/ratelimit').waitFor();
  } catch (error) {
    // A blank page in dev times out first: say why.
    throw new Error([error.message.split('\n')[0], ...errors].join('\n  '), { cause: error });
  } finally {
    await browser.close();
  }
  if (errors.length > 0) throw new Error(`Page errors:\n  ${errors.join('\n  ')}`);
  console.log('pass  review in DiffReview, result back to the model, approval card, resumed run');
}

const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const work = mkdtempSync(join(tmpdir(), 'signoff-fresh-install-'));
let tarball;
if (pack) {
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', work], {
      cwd: join(root, 'packages/signoff-ui'),
      encoding: 'utf8',
    }),
  );
  tarball = join(work, filename);
}

/** Copies the example, installs it, starts `dev`, runs its check and typechecks it. */
async function fresh(name, { pm, check }) {
  const started = Date.now();
  // The example's files at this commit, as git has them: no node_modules, build output or local .env.
  const app = join(work, name);
  const files = execFileSync('git', ['ls-files', '-z', `examples/${name}`], { cwd: root, encoding: 'utf8' });
  for (const file of files.split('\0').filter(Boolean)) {
    const to = join(app, file.slice(`examples/${name}/`.length));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(root, file), to);
  }
  // `dev` on a free port rather than the one in the README, and with --pack, the packed package.
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  const port = await freePort();
  manifest.scripts.dev = manifest.scripts.dev.replace(/--port \d+/, `--port ${port}`);
  if (tarball) manifest.dependencies['signoff-ui'] = `file:${tarball}`;
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  execFileSync(pm, ['install', '--ignore-scripts', ...(pm === 'npm' ? ['--no-audit', '--no-fund'] : [])], {
    cwd: app,
    stdio: 'inherit',
  });
  const version = (pkg) => JSON.parse(readFileSync(join(app, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  const installed = Object.keys(manifest.dependencies)
    .map((pkg) => `${pkg} ${version(pkg)}${pkg === 'signoff-ui' && tarball ? ' (packed from this checkout)' : ''}`)
    .join(', ');

  const dev = spawn(pm, ['run', 'dev'], { cwd: app, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  const exited = once(dev, 'exit');
  try {
    // The first request compiles the page, which can take a while in dev.
    const base = `http://localhost:${port}`;
    for (const deadline = Date.now() + 120_000; ; await new Promise((wait) => setTimeout(wait, 500))) {
      if ((await fetch(base).catch(() => null))?.ok) break;
      if (dev.exitCode !== null || dev.signalCode !== null)
        throw new Error(`${pm} run dev exited (${dev.exitCode ?? dev.signalCode})`);
      if (Date.now() > deadline) throw new Error(`${pm} run dev did not answer on ${base}`);
    }
    await check(base);
    // After the run, once `next dev` has written its route types.
    execFileSync(pm, ['run', 'typecheck'], { cwd: app, stdio: 'inherit' });
  } finally {
    if (dev.exitCode === null && dev.signalCode === null) {
      process.kill(-dev.pid);
      await exited;
    }
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `pass  ${name}: ${pm} install from the registry, ${pm} run dev, the run in Chrome, typecheck (${seconds}s)`,
  );
  console.log(`      ${installed}`);
}

const failed = [];
try {
  for (const [name, example] of Object.entries(EXAMPLES)) {
    if (only.length > 0 && !only.includes(name)) continue;
    try {
      await fresh(name, example);
    } catch (error) {
      failed.push(name);
      console.log(`FAIL  ${name}: ${error.message}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
if (failed.length > 0) process.exit(1);
