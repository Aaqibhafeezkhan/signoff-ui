// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

/* GitHub's dependency graph reads only the first YAML document in pnpm-lock.yaml, and pnpm 12 keeps
   the pnpm it pins there, so the graph and Dependabot alerts missed every locked package.
   .github/workflows/dependency-graph.yml submits them instead: these tests run its steps on the
   real lockfile and check the snapshot it would send. Nothing here calls the GitHub API. */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Package {
  package_url: string;
  relationship: 'direct' | 'indirect';
  scope: 'runtime' | 'development';
  dependencies: string[];
}

interface Snapshot {
  version: number;
  sha: string;
  ref: string;
  job: { correlator: string; id: string; html_url: string };
  detector: { name: string; version: string; url: string };
  scanned: string;
  manifests: Record<string, { name: string; file: { source_location: string }; resolved: Record<string, Package> }>;
}

/** The part of pnpm sbom's CycloneDX output that the tests change. */
interface Sbom {
  metadata: { component: { 'bom-ref': string } };
  components: { 'bom-ref': string; name: string; group?: string }[];
  dependencies: { ref: string; dependsOn?: string[] }[];
}

type Dependencies = Record<string, { version: string }>;

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const workflow = parse(read('.github/workflows/dependency-graph.yml')) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps: Step[] } | undefined>;
};
const job = workflow.jobs.submit;
const steps = job?.steps ?? [];
const sbomStep = steps.find((step) => step.run?.startsWith('pnpm sbom'));
const snapshotStep = steps.find((step) => step.env?.SBOM && step.run?.includes('node'));

const documents = parseAllDocuments(read('pnpm-lock.yaml')).map(
  (document) =>
    document.toJS() as {
      importers?: Record<
        string,
        { dependencies?: Dependencies; devDependencies?: Dependencies; optionalDependencies?: Dependencies }
      >;
      packages: Record<string, unknown>;
    },
);
/** The lockfile itself: its last YAML document, the one pnpm installs from. */
const lockfile = documents.at(-1);
/** Every package the lockfile locks, as `name@version`. */
const locked = Object.keys(lockfile?.packages ?? {});

/** A package URL, as pnpm sbom writes it: `pkg:npm/%40scope/name@1.0.0`. */
const purl = (id: string) => `pkg:npm/${id.replace(/^@/, '%40')}`;

/** package.json's packageManager, `pnpm@<version>`, without the hash corepack can add. */
const packageManager = (JSON.parse(read('package.json')) as { packageManager: string }).packageManager.replace(
  /\+.*/,
  '',
);

/**
 * What each workspace package.json names, by the package's name, as the package URLs pnpm-lock.yaml
 * locks: a version with peers reads `1.0.0(react@19.0.0)`, an alias names its package
 * (`tailwindcss@3.4.19`), and a link to a workspace package is none.
 */
const named = new Map(
  Object.entries(lockfile?.importers ?? {}).map(([importer, entry]) => [
    (JSON.parse(read(join(importer, 'package.json'))) as { name: string }).name,
    Object.entries({ ...entry.dependencies, ...entry.devDependencies, ...entry.optionalDependencies })
      .filter(([, { version }]) => !version.startsWith('link:'))
      .map(([name, { version }]) => purl((/^\d/.test(version) ? `${name}@${version}` : version).replace(/\(.*$/, ''))),
  ]),
);

/** The package URL of the version pnpm-lock.yaml locks for a workspace package's dependency. */
function locks(name: string, importer: string): string {
  const entry = lockfile?.importers?.[importer];
  const version = (entry?.dependencies?.[name] ?? entry?.devDependencies?.[name])?.version;
  expect(version, `${importer} depends on ${name}`).toBeDefined();
  return purl(`${name}@${version!.replace(/\(.*$/, '')}`);
}

describe('the dependency graph workflow', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let resolved: Record<string, Package>;
  let snapshot: Snapshot;
  let log: string;

  /** Runs a step as the job would: in GitHub's bash, with the job's environment, from the repository root. */
  function run(step: Step | undefined, extra: NodeJS.ProcessEnv = {}): string {
    const script = join(dir, 'step.sh');
    writeFileSync(script, step!.run!);
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: root,
      env: { ...env, ...extra },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dependency-graph-'));
    env = {
      ...process.env,
      RUNNER_TEMP: dir,
      SBOM: join(dir, 'sbom.json'),
      WORKSPACE: join(dir, 'workspace.json'),
      SNAPSHOT: join(dir, 'snapshot.json'),
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ID: '123',
      GITHUB_JOB: 'submit',
      GITHUB_WORKFLOW: 'Dependency graph',
      GITHUB_REPOSITORY: 'dgesteves/signoff-ui',
      GITHUB_SERVER_URL: 'https://github.com',
    };
    run(sbomStep);
    log = run(snapshotStep);
    snapshot = JSON.parse(readFileSync(env.SNAPSHOT!, 'utf8')) as Snapshot;
    resolved = snapshot.manifests['pnpm-lock.yaml']?.resolved ?? {};
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('submits on each push to main, with the only write permission it needs', () => {
    expect(workflow.on).toEqual({ push: { branches: ['main'] }, workflow_dispatch: null });
    expect(workflow.permissions).toEqual({});
    expect(job?.if).toBe("github.repository == 'dgesteves/signoff-ui'");
    expect(job?.permissions).toEqual({ contents: 'write' });
    // No install: nothing from the dependencies runs next to the token.
    expect(steps.some((step) => step.run?.includes('install'))).toBe(false);
    const submit = steps.at(-1);
    expect(submit?.run).toContain(
      'gh api --method POST "repos/$GITHUB_REPOSITORY/dependency-graph/snapshots" --input "$SNAPSHOT"',
    );
    expect(submit?.env?.SNAPSHOT).toBe(snapshotStep?.env?.SNAPSHOT);
    // The files the first step writes are the ones the second reads.
    expect(sbomStep?.run).toContain('> "$RUNNER_TEMP/sbom.json"');
    expect(sbomStep?.run).toContain('> "$RUNNER_TEMP/workspace.json"');
    expect(snapshotStep?.env).toMatchObject({
      SBOM: '${{ runner.temp }}/sbom.json',
      WORKSPACE: '${{ runner.temp }}/workspace.json',
    });
  });

  it('uses the actions release.yml uses, pinned to the same commits, with the version in a comment', () => {
    const uses = [...read('.github/workflows/dependency-graph.yml').matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(uses.map((line) => line.replace(/@.*/, ''))).toEqual([
      'actions/checkout',
      'pnpm/action-setup',
      'actions/setup-node',
    ]);
    const release = read('.github/workflows/release.yml');
    for (const line of uses) {
      expect(line).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      expect(release).toContain(`uses: ${line}\n`);
    }
  });

  it('writes a snapshot with the fields the dependency submission API requires', () => {
    expect(snapshot).toMatchObject({
      version: 0,
      sha: 'a'.repeat(40),
      ref: 'refs/heads/main',
      job: {
        correlator: 'Dependency graph submit',
        id: '123',
        html_url: 'https://github.com/dgesteves/signoff-ui/actions/runs/123',
      },
      detector: { name: 'pnpm sbom', url: 'https://pnpm.io/cli/sbom' },
    });
    expect(snapshot.detector.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isNaN(Date.parse(snapshot.scanned))).toBe(false);
    expect(Object.keys(snapshot.manifests)).toEqual(['pnpm-lock.yaml']);
    expect(snapshot.manifests['pnpm-lock.yaml']).toMatchObject({
      name: 'pnpm-lock.yaml',
      file: { source_location: 'pnpm-lock.yaml' },
    });
  });

  // Why the workflow is there. Should pnpm write the lockfile as one document again, GitHub reads
  // all of it, and the workflow can go.
  it('is needed: the first YAML document, which GitHub reads, locks pnpm and nothing else', () => {
    expect(documents.length).toBeGreaterThan(1);
    const pinned = Object.keys(documents[0]?.packages ?? {});
    expect(pinned).toContain(packageManager);
    expect(pinned.filter((id) => !/^(pnpm|@pnpm\/exe(\.[\w-]+)?)@/.test(id))).toEqual([]);
  });

  it('lists every package the lockfile locks, each once, and pnpm', () => {
    expect(locked.length).toBeGreaterThan(1000);
    expect(Object.keys(resolved).sort()).toEqual([...locked.map(purl), `pkg:npm/${packageManager}`].sort());
    expect(Object.keys(resolved).filter((url) => url.startsWith('pkg:npm/%40radix-ui/')).length).toBeGreaterThan(10);
    // The step's own count, which the job's log shows.
    const [, total = NaN, direct = NaN, runtime = NaN, development = NaN] = (
      /^(\d+) packages: (\d+) direct, (\d+) runtime, (\d+) development\n$/.exec(log) ?? []
    ).map(Number);
    expect(total).toBe(locked.length + 1);
    expect(direct).toBe(Object.values(resolved).filter((p) => p.relationship === 'direct').length);
    expect(runtime + development).toBe(total);
  });

  it("leaves out this repository's own packages: the workspace root, signoff-ui and the examples", () => {
    const own = [...named.keys()];
    expect(own).toEqual(expect.arrayContaining(['signoff-ui-monorepo', 'signoff-ui', 'playground']));
    expect(Object.keys(resolved).filter((url) => own.some((name) => url.startsWith(purl(`${name}@`))))).toEqual([]);
  });

  it('marks as direct what a workspace package.json names, and pnpm', () => {
    const direct = Object.keys(resolved).filter((url) => resolved[url]?.relationship === 'direct');
    expect(direct.sort()).toEqual([...new Set([...named.values()].flat()), `pkg:npm/${packageManager}`].sort());
  });

  // pnpm sbom lists what signoff-ui's package.json names either under the workspace root, with the
  // others', or under signoff-ui, which the examples depend on: which of the two changes from run
  // to run. The snapshot step gets both here, whichever this run's pnpm sbom wrote.
  it('writes the same snapshot whichever way pnpm sbom lists the workspace packages', () => {
    const sbom = JSON.parse(readFileSync(env.SBOM!, 'utf8')) as Sbom;
    const top = sbom.metadata.component['bom-ref'];
    const library = sbom.components.find((c) => !c.group && c.name === 'signoff-ui')?.['bom-ref'];
    expect(library).toBeDefined();
    const others = [...named].filter(([name]) => name !== 'signoff-ui').flatMap(([, urls]) => urls);
    const forms = {
      'under the root': { [top]: [...new Set([...named.values()].flat()), library!], [library!]: [] },
      'under signoff-ui': { [top]: [...new Set(others), library!], [library!]: named.get('signoff-ui')! },
    };
    for (const [form, lists] of Object.entries(forms)) {
      const path = join(dir, 'sbom-variant.json');
      const dependencies = sbom.dependencies.filter((d) => !(d.ref in lists));
      for (const [ref, dependsOn] of Object.entries(lists)) dependencies.push({ ref, dependsOn });
      writeFileSync(path, JSON.stringify({ ...sbom, dependencies }));
      const out = join(dir, 'snapshot-variant.json');
      run(snapshotStep, { SBOM: path, SNAPSHOT: out });
      const variant = JSON.parse(readFileSync(out, 'utf8')) as Snapshot;
      expect(variant.manifests['pnpm-lock.yaml']?.resolved, form).toEqual(resolved);
    }
  });

  it('marks dev-only packages as development, and what the library or the site runs as runtime', () => {
    // Dependencies of the published package.
    for (const name of ['@radix-ui/react-collapsible', 'react-markdown']) {
      expect(resolved[locks(name, 'packages/signoff-ui')], name).toMatchObject({
        relationship: 'direct',
        scope: 'runtime',
      });
    }
    // The site's: it is deployed from this lockfile.
    for (const name of ['react', 'next']) {
      expect(resolved[locks(name, 'examples/playground')], name).toMatchObject({
        relationship: 'direct',
        scope: 'runtime',
      });
    }
    // The library's test runner, and the root's linter.
    expect(resolved[locks('vitest', 'packages/signoff-ui')]).toMatchObject({
      relationship: 'direct',
      scope: 'development',
    });
    expect(resolved[locks('eslint', '.')]).toMatchObject({ relationship: 'direct', scope: 'development' });
    // The finding's examples: micromark reaches the published package through react-markdown;
    // braces (GHSA-vfj7-8cjw-p6xm) only the dev tools.
    const found = (name: string) => Object.values(resolved).filter((p) => p.package_url.startsWith(purl(`${name}@`)));
    expect(found('micromark').length).toBeGreaterThan(0);
    for (const p of found('micromark')) expect(p).toMatchObject({ relationship: 'indirect', scope: 'runtime' });
    expect(found('braces').length).toBeGreaterThan(0);
    for (const p of found('braces')) expect(p).toMatchObject({ relationship: 'indirect', scope: 'development' });
    // pnpm, which the first document pins and GitHub listed, stays in the graph.
    expect(resolved[`pkg:npm/${packageManager}`]).toMatchObject({ relationship: 'direct', scope: 'development' });
  });

  it('gives each package the packages it depends on, each of them in the snapshot', () => {
    const markdown = resolved[locks('react-markdown', 'packages/signoff-ui')];
    expect(markdown?.dependencies).toContain(locks('react', 'examples/playground'));
    expect(markdown?.dependencies.some((url) => url.startsWith('pkg:npm/unified@'))).toBe(true);
    const packages = Object.entries(resolved);
    expect(packages.filter(([url, pkg]) => pkg.package_url !== url)).toEqual([]);
    const dependencies = packages.flatMap(([, pkg]) => pkg.dependencies);
    expect(dependencies.length).toBeGreaterThan(packages.length);
    expect(dependencies.filter((url) => !resolved[url])).toEqual([]);
  });
});
