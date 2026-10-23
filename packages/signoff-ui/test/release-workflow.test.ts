// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/* How .github/workflows/release.yml versions and publishes. The validate job checks the package with
   read permissions, and only then the release job, the only one that can write or publish, versions
   or publishes it, with the release GitHub App's token when its secrets are set. A dry run, started
   by hand, runs a read-only job in the release job's place. The `if` conditions are evaluated here
   as GitHub would, for each kind of run. */

interface Step {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string | boolean>;
  env?: Record<string, string>;
}

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
  'timeout-minutes'?: number;
}

const root = join(import.meta.dirname, '../../..');
const source = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const workflow = parse(source) as {
  on: Record<string, unknown>;
  concurrency?: unknown;
  permissions?: Record<string, string>;
  jobs: Record<string, Job | undefined>;
};
const jobs = workflow.jobs;
const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
  .scripts;
const steps = Object.values(jobs).flatMap((job) => job?.steps ?? []);
const validate = jobs.validate;
const release = jobs.release;
const dryRun = jobs['dry-run'];
const changesets = release?.steps.find((step) => step.uses?.startsWith('changesets/action@'));

/**
 * Whether GitHub runs a step or job with this `if`, given the values of the contexts it reads
 * (`github.event_name`, `steps.changesets.outputs.has-changesets`...) and whether a step before it
 * failed. A context with no value is ''. A condition with no status function runs only when
 * everything before it succeeded, as on GitHub (`success() && ...`); the run is never cancelled.
 */
function runs(condition: string | undefined, values: Record<string, string>, failed = false): boolean {
  if (condition === undefined) return !failed;
  const body = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const expression = body
    .replace(/\bcancelled\(\)/g, 'false')
    .replace(/\bfailure\(\)/g, String(failed))
    .replace(/\bsuccess\(\)/g, String(!failed))
    .replace(/\balways\(\)/g, 'true')
    .replace(/\b(?:github|steps|env|vars|needs|secrets)(?:\.[\w-]+)+/g, (path) => JSON.stringify(values[path] ?? ''))
    .replace(/==/g, '===');
  const result = Boolean(runInNewContext(expression));
  return /\b(?:success|failure|always|cancelled)\(\)/.test(body) ? result : !failed && result;
}

/** An env value such as `${{ secrets.A != '' }}`, as the string GitHub gives a step. */
function envValue(value: string, values: Record<string, string>): string {
  return /^\$\{\{.*\}\}$/.test(value) ? String(runs(value, values)) : value;
}

const label = (step: Step) => step.name ?? step.run ?? step.uses ?? '';

/**
 * The steps of `job` that run, in order: a step's outputs (from `outputs`, by step id) exist only
 * when it runs, as on GitHub. The steps named in `fails` fail when they run, and the steps after
 * them run only if their `if` says so.
 */
function simulate(
  job: Job | undefined,
  values: Record<string, string>,
  outputs: Record<string, Record<string, string>> = {},
  fails: string[] = [],
): Step[] {
  const context = { ...values };
  for (const [name, value] of Object.entries(job?.env ?? {})) context[`env.${name}`] = envValue(value, context);
  const ran: Step[] = [];
  let failed = false;
  for (const step of job?.steps ?? []) {
    if (!runs(step.if, context, failed)) continue;
    ran.push(step);
    for (const [name, value] of Object.entries((step.id && outputs[step.id]) || {})) {
      context[`steps.${step.id ?? ''}.outputs.${name}`] = value;
    }
    if (fails.includes(label(step))) failed = true;
  }
  return ran;
}

/** Whether a step can change something outside the runner: npm, the repository or its releases. */
function writes(step: Step): boolean {
  if (step.uses?.startsWith('changesets/action@')) return true;
  const run = step.run ?? '';
  if (
    /gh (pr merge|workflow run|release create)|git (push|commit|tag)|changeset publish|npm publish|pnpm release/.test(
      run,
    )
  ) {
    return true;
  }
  return /check-published\.mjs release(?! --dry-run)/.test(run);
}

const app = (job: Job | undefined) =>
  job?.steps.find((step) => step.uses?.startsWith('actions/create-github-app-token@'));
const secrets = (hasApp: boolean) => ({
  'secrets.RELEASE_APP_ID': hasApp ? 'id' : '',
  'secrets.RELEASE_APP_PRIVATE_KEY': hasApp ? 'key' : '',
});
const on = (event: string) => ({ 'github.repository': 'dgesteves/signoff-ui', 'github.event_name': event });

describe('release workflow', () => {
  // changesets/action splits these on spaces and runs them without a shell, so `&&` or a pipe
  // reaches the command as an argument.
  it.each(['version-script', 'publish-script'])('runs %s as one package.json script', (input) => {
    const command = changesets?.with?.[input];
    expect(command).toMatch(/^pnpm [\w:-]+$/);
    expect(scripts[String(command).slice('pnpm '.length)]).toBeDefined();
  });

  it('publishes as before: the build, then changeset publish, with the same pull request title', () => {
    expect(scripts.release).toBe('pnpm build:lib && changeset publish');
    expect(scripts['version-packages']).toBe('changeset version && node scripts/example-versions.mjs');
    expect(changesets?.with).toMatchObject({
      'commit-message': 'chore: version packages',
      'pr-title': 'chore: version packages',
    });
  });

  it.each(Object.keys(jobs))('gives the %s job a timeout', (id) => {
    const minutes = jobs[id]?.['timeout-minutes'];
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  // A queued run is replaced by a newer one, but a running publish is never cancelled midway.
  it('runs one release at a time and never cancels one in progress', () => {
    expect(workflow.concurrency).toBe('${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}');
  });

  // A dry run only reads. In the pushes' group, one started on main could replace the waiting run
  // of the version pull request's merge, which would then publish nothing, or hold up a release.
  it('keeps a dry run out of the group the pushes to main share', () => {
    const group = (values: Record<string, string>) =>
      String(workflow.concurrency).replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => values[path] ?? '');
    const main = { 'github.workflow': 'Release', 'github.ref': 'refs/heads/main' };
    const push = group({ ...main, 'github.event_name': 'push' });
    expect(push).toBe('Release-push-refs/heads/main');
    expect(group({ ...main, 'github.event_name': 'workflow_dispatch' })).not.toBe(push);
  });
});

describe('the gate before a publish', () => {
  // The release job used to run only `pnpm test` before publishing: no build checks, no types, no
  // size budgets and no package exports checks on the commit it published.
  it('validates the package in a job that can only read, before the release job', () => {
    expect(validate?.permissions).toEqual({ contents: 'read' });
    expect([release?.needs].flat()).toEqual(['validate']);
    expect([dryRun?.needs].flat()).toEqual(['validate']);
    expect(validate?.steps.map((step) => step.run).filter(Boolean)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm build:lib',
      'pnpm size',
      'pnpm --filter signoff-ui typecheck',
      'pnpm test',
      'pnpm --filter signoff-ui lint:package',
    ]);
  });

  it('runs validate on a push and on a dry run, in this repository only', () => {
    expect(runs(validate?.if, on('push'))).toBe(true);
    expect(runs(validate?.if, on('workflow_dispatch'))).toBe(true);
    expect(runs(validate?.if, { ...on('push'), 'github.repository': 'someone/signoff-ui' })).toBe(false);
  });
});

describe('who holds which token', () => {
  // Every step of a job with id-token: write can mint the OIDC token npm trusted publishing accepts,
  // so a dependency's build or test code that ran there could publish with provenance.
  it('grants nothing at the workflow level, so each job asks for its own permissions', () => {
    expect(workflow.permissions).toEqual({});
    for (const [id, job] of Object.entries(jobs)) expect(job?.permissions, id).toBeDefined();
  });

  it('lets only the release job publish, and it runs no tests', () => {
    const publishers = Object.entries(jobs).filter(([, job]) => job?.permissions?.['id-token']);
    expect(publishers.map(([id]) => id)).toEqual(['release']);
    expect(release?.permissions?.['id-token']).toBe('write');
    for (const step of release?.steps ?? []) expect(step.run ?? '').not.toMatch(/pnpm (test|size|lint)|vitest/);
  });

  // CI and the validate job run the dependencies' test and build code, and setup-node saves the pnpm
  // store after them: a package that ran there could leave files for the release job to install.
  it('restores no cache in the release job', () => {
    const cached = release?.steps.filter(
      (step) => step.uses?.startsWith('actions/cache') === true || step.with?.cache !== undefined,
    );
    expect(cached?.map(label)).toEqual([]);
  });

  // actions/checkout otherwise leaves the job's token in .git/config, for every later step.
  it('keeps no credentials in any checkout', () => {
    const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkouts).toHaveLength(Object.keys(jobs).length);
    for (const step of checkouts) expect(step.with?.['persist-credentials']).toBe(false);
  });

  // A tag can be moved to other code; a commit can't. Dependabot's github-actions updates move the
  // SHA and the comment together.
  it('pins every action to a full commit SHA, with its version in a comment', () => {
    const uses = [...source.matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map((match) => match[1] ?? '');
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});

describe('the release GitHub App', () => {
  // A push made with the workflow's own token starts no workflows: the version pull request's CI
  // waited for approval, and #36, #58, #70, #103 and #109 each merged only after an empty
  // "chore: run CI" commit by hand.
  it('mints a token from the App when both its secrets are set', () => {
    expect(release?.env?.HAS_APP).toBe("${{ secrets.RELEASE_APP_ID != '' && secrets.RELEASE_APP_PRIVATE_KEY != '' }}");
    expect(app(release)?.if).toBe("env.HAS_APP == 'true'");
    expect(app(release)?.with).toEqual({
      'client-id': '${{ secrets.RELEASE_APP_ID }}',
      'private-key': '${{ secrets.RELEASE_APP_PRIVATE_KEY }}',
      'permission-contents': 'write',
      'permission-pull-requests': 'write',
    });
  });

  it('gives changesets/action the App’s token, or the workflow’s own without the App', () => {
    expect(app(release)?.id).toBe('app-token');
    expect(changesets?.with?.['github-token']).toBe('${{ steps.app-token.outputs.token || github.token }}');
    // The token comes before the checkout, so nothing the checkout or the install runs precedes it,
    // and changesets/action pushes through the API with it.
    const order = release?.steps.map(label) ?? [];
    expect(order.indexOf('Get a token from the release GitHub App')).toBe(0);
  });

  const versionRun = (hasApp: boolean, autoMerge = false) =>
    simulate(
      release,
      { ...on('push'), ...secrets(hasApp), 'vars.RELEASE_AUTO_MERGE': autoMerge ? 'true' : '' },
      {
        'app-token': { token: 'app token' },
        changesets: { 'has-changesets': 'true', 'pr-number': '160', published: 'false' },
      },
    ).map(label);

  it('starts CI on the version pull request itself only without the App', () => {
    expect(versionRun(false)).toContain('Run CI on the version pull request');
    expect(versionRun(false)).not.toContain('Get a token from the release GitHub App');
    expect(versionRun(true)).toContain('Get a token from the release GitHub App');
    expect(versionRun(true)).not.toContain('Run CI on the version pull request');
  });

  it('merges the version pull request by itself only when RELEASE_AUTO_MERGE says so', () => {
    const merge = 'Merge the version pull request once its CI passes';
    expect(versionRun(true)).not.toContain(merge);
    expect(versionRun(false, true)).not.toContain(merge);
    expect(versionRun(true, true)).toContain(merge);
  });
});

describe('a version run', () => {
  // A queued Release run is replaced by a newer push's run. Had the version pull request's merge
  // been queued, its version would never reach npm, and the next run would only update the version
  // pull request, silently.
  it('checks that npm has the version on main', () => {
    const ran = simulate(release, on('push'), { changesets: { 'has-changesets': 'true', 'pr-number': '160' } });
    expect(ran.map((step) => step.run)).toContain('node scripts/check-published.mjs npm');
    expect(ran.map((step) => step.run)).not.toContain('node scripts/check-published.mjs release');
  });

  // changesets/action versions the package on changeset-release/main and leaves the checkout there,
  // so package.json holds the next version after it: every push with pending changesets failed the
  // check, naming a version that was never meant to be on npm yet.
  it('reads the version on main before changesets/action versions the package, for both checks', () => {
    const order = release?.steps.map(label) ?? [];
    const read = release?.steps.find((step) => step.id === 'main');
    expect(read?.if).toBeUndefined();
    expect(read?.run).toContain("require('./packages/signoff-ui/package.json').version");
    expect(order.indexOf(label(read!))).toBeLessThan(order.indexOf(label(changesets!)));
    const checks = release?.steps.filter((step) => /check-published\.mjs (npm|release)$/.test(step.run ?? '')) ?? [];
    expect(checks).toHaveLength(2);
    for (const step of checks) expect(step.env?.VERSION).toBe('${{ steps.main.outputs.version }}');
  });

  const check = 'The version on main is on npm';
  const merge = 'Merge the version pull request once its CI passes';
  const autoMergeRun = (fails: string[] = []) =>
    simulate(
      release,
      { ...on('push'), ...secrets(true), 'vars.RELEASE_AUTO_MERGE': 'true' },
      {
        'app-token': { token: 'app token' },
        changesets: { 'has-changesets': 'true', 'pr-number': '160', published: 'false' },
      },
      fails,
    ).map(label);

  // Had the merge step run first, the next version pull request would merge by itself once its CI
  // passed, and the version npm never got would be skipped for good.
  it('turns on no auto-merge when npm doesn’t have the version on main', () => {
    expect(autoMergeRun()).toEqual(expect.arrayContaining([check, merge]));
    const ran = autoMergeRun([check]);
    expect(ran).toContain(check);
    expect(ran).not.toContain(merge);
    // Right after changesets/action, so no step between them can fail and skip it.
    const order = release?.steps.map(label) ?? [];
    expect(order.indexOf(check)).toBe(order.indexOf(label(changesets!)) + 1);
    expect(order.indexOf(check)).toBeLessThan(order.indexOf(merge));
  });

  // With RELEASE_AUTO_MERGE set and auto-merge not allowed in Settings, the merge step fails on
  // every version run.
  it('checks npm even when the merge step, or starting CI without the App, would fail', () => {
    expect(autoMergeRun([merge])).toContain(check);
    const withoutApp = simulate(release, on('push'), { changesets: { 'has-changesets': 'true', 'pr-number': '160' } }, [
      'Run CI on the version pull request',
    ]).map(label);
    expect(withoutApp).toEqual(expect.arrayContaining(['Run CI on the version pull request', check]));
  });
});

describe('a publish', () => {
  const publishRun = (results: Record<string, string>, values: Record<string, string> = {}) =>
    simulate(release, { ...on('push'), ...values }, { changesets: { 'has-changesets': 'false', ...results } }).map(
      (step) => step.run,
    );
  const repair = 'node scripts/check-published.mjs release';

  it('creates a missing tag or GitHub release after the publish, with the token changesets/action had', () => {
    expect(publishRun({ published: 'true' })).toContain(repair);
    const step = release?.steps.find((s) => s.run === repair);
    expect(step?.env).toEqual({
      GH_TOKEN: '${{ steps.app-token.outputs.token || github.token }}',
      VERSION: '${{ steps.main.outputs.version }}',
      PUBLISHED_PACKAGES: '${{ steps.changesets.outputs.published-packages }}',
    });
    expect(step?.if).toBe("${{ !cancelled() && steps.changesets.outputs.has-changesets == 'false' }}");
  });

  // @changesets/cli publishes only versions npm doesn't have, so a re-run after a failed tag or
  // release publishes nothing (published is false), and changesets/action then creates neither.
  it('creates them on a re-run that publishes nothing new', () => {
    expect(publishRun({ published: 'false' })).toContain(repair);
    expect(publishRun({ published: 'false' })).not.toContain('node scripts/check-published.mjs npm');
  });

  // changesets/action fails when creating the release fails, after npm has the version. The step's
  // `!cancelled()` lets it run then; `runs` reads `cancelled()` as false.
  it('runs after a failed changesets/action step too', () => {
    const step = release?.steps.find((s) => s.run === repair);
    expect(step?.if).toMatch(/^\$\{\{ !cancelled\(\) && /);
    expect(runs(step?.if, { 'steps.changesets.outputs.has-changesets': 'false' }, true)).toBe(true);
    const ran = simulate(release, on('push'), { changesets: { 'has-changesets': 'false', published: 'true' } }, [
      label(changesets!),
    ]);
    expect(ran.map((s) => s.run)).toContain(repair);
    // changesets/action never ran (the install failed): no outputs, nothing to repair.
    expect(runs(step?.if, {}, true)).toBe(false);
  });

  it('starts no CI and merges nothing after a publish', () => {
    for (const hasApp of [false, true]) {
      const ran = publishRun({ published: 'true' }, { ...secrets(hasApp), 'vars.RELEASE_AUTO_MERGE': 'true' });
      expect(ran.filter((run) => /gh (workflow run|pr merge)/.test(run ?? ''))).toEqual([]);
    }
  });
});

describe('a dry run', () => {
  const dispatch = (hasApp: boolean) => ({
    ...on('workflow_dispatch'),
    ...secrets(hasApp),
    'vars.RELEASE_AUTO_MERGE': 'true',
  });

  it('starts by hand, on any branch', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(workflow.on.workflow_dispatch).toBeNull();
    expect(workflow.on.push).toEqual({ branches: ['main'] });
  });

  it('runs no step that publishes, pushes or creates anything, with or without the App', () => {
    for (const hasApp of [false, true]) {
      const values = dispatch(hasApp);
      expect(runs(release?.if, values)).toBe(false);
      expect(runs(dryRun?.if, values)).toBe(true);
      const ran = simulate(dryRun, values, { 'app-token': { token: 'app token' } });
      expect(ran.filter(writes).map(label)).toEqual([]);
      expect(ran.map(label)).toEqual(
        expect.arrayContaining([
          'Dry run: npm, the tag and the GitHub release',
          'Dry run: version the package as the version pull request would, without pushing',
          'Dry run: pack the package as changeset publish would, without publishing',
        ]),
      );
      expect(ran.map(label).includes('Get a read-only token from the release GitHub App')).toBe(hasApp);
    }
  });

  it('gives the dry-run job read permissions, and the App a read-only token there', () => {
    expect(dryRun?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(dryRun?.env?.HAS_APP).toBe(release?.env?.HAS_APP);
    expect(app(dryRun)?.with).toMatchObject({ 'permission-contents': 'read', 'permission-pull-requests': 'read' });
    expect(Object.values(app(dryRun)?.with ?? {})).not.toContain('write');
  });

  it('runs the release job only on a push, and the dry run only in its place', () => {
    expect(runs(release?.if, on('push'))).toBe(true);
    expect(runs(release?.if, on('workflow_dispatch'))).toBe(false);
    expect(runs(dryRun?.if, on('push'))).toBe(false);
    expect(runs(dryRun?.if, on('workflow_dispatch'))).toBe(true);
  });

  it('checks npm and the release read-only, and keeps the version commit and the tarball in the runner', () => {
    const check = dryRun?.steps.find((s) => s.name === 'Dry run: npm, the tag and the GitHub release');
    expect(check?.run).toContain('node scripts/check-published.mjs npm');
    expect(check?.run).toContain('node scripts/check-published.mjs release --dry-run');
    const version = dryRun?.steps.find((s) => s.name?.startsWith('Dry run: version'));
    expect(version?.run).toContain('pnpm version-packages');
    const pack = dryRun?.steps.find((s) => s.name?.startsWith('Dry run: pack'));
    expect(pack?.run).toContain('pnpm --filter signoff-ui pack --pack-destination "$RUNNER_TEMP/pack"');
  });

  /**
   * What a dry-run step's script runs, in bash as GitHub runs it, in a checkout whose .changeset
   * holds these files, with stand-ins for node, pnpm and git that print their arguments.
   */
  function script(name: string, changesets: string[]): { status: number | null; stdout: string } {
    const step = dryRun?.steps.find((s) => s.name === name);
    const dir = mkdtempSync(join(tmpdir(), 'release-step-'));
    try {
      mkdirSync(join(dir, 'bin'));
      for (const command of ['node', 'pnpm', 'git']) {
        writeFileSync(join(dir, 'bin', command), `#!/bin/sh\necho "${command} $*"\n`);
        chmodSync(join(dir, 'bin', command), 0o755);
      }
      mkdirSync(join(dir, '.changeset'));
      for (const file of ['README.md', 'config.json', ...changesets]) writeFileSync(join(dir, '.changeset', file), '');
      writeFileSync(join(dir, 'step.sh'), step!.run!);
      const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', join(dir, 'step.sh')], {
        cwd: dir,
        env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin` },
        encoding: 'utf8',
      });
      return { status: result.status, stdout: result.stdout.trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    [['brave-dogs-sing.md'], 'node scripts/check-published.mjs npm'],
    [[], 'node scripts/check-published.mjs release --dry-run'],
  ])('with the changesets %j, checks as the release job would: %s', (changesets, command) => {
    const { status, stdout } = script('Dry run: npm, the tag and the GitHub release', changesets);
    expect(status).toBe(0);
    expect(stdout.split('\n').at(-1)).toBe(command);
  });

  // `changeset version` exits with 1 when there is nothing to version, which failed the dry run of a
  // branch with no pending changesets.
  it('versions only with pending changesets', () => {
    const name = 'Dry run: version the package as the version pull request would, without pushing';
    expect(script(name, ['brave-dogs-sing.md'])).toEqual({
      status: 0,
      stdout: 'pnpm version-packages\ngit status --short\ngit diff',
    });
    expect(script(name, [])).toEqual({ status: 0, stdout: 'No pending changesets: nothing to version.' });
  });
});
