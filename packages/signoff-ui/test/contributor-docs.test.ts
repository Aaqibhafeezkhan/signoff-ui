// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { section } from './utils';

/*
 * What CONTRIBUTING.md, ARCHITECTURE.md, RELEASING.md and ROADMAP.md say about the repository,
 * against the repository: the checks CI runs, the paths they name, what the version step moves,
 * and which roadmap items have shipped.
 */

interface Step {
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  jobs: Record<string, { if?: string; steps: Step[] }>;
}

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const readIfThere = (path: string) => (existsSync(join(root, path)) ? read(path) : '');
const contributing = read('CONTRIBUTING.md');
const architecture = readIfThere('ARCHITECTURE.md');
const releasing = read('RELEASING.md');
const roadmap = read('ROADMAP.md');
const changelog = read('packages/signoff-ui/CHANGELOG.md');
const ci = parse(read('.github/workflows/ci.yml')) as Workflow;
const checks = section(contributing, 'Checks');

/** The steps of the CI jobs that run on every pull request: their own `if` skips only the daily run. */
const pullRequestSteps = Object.values(ci.jobs)
  .filter((job) => job.if === "github.event_name != 'schedule'")
  .flatMap((job) => job.steps);

/** Commands that set CI up rather than check anything, which the Setup section and the prose cover. */
const SETUP = [
  /^pnpm install --frozen-lockfile$/,
  // The job summary's coverage table.
  /^node scripts\/coverage-summary\.mjs /,
  // The browsers `BROWSER` picks, installed as the Checks prose says.
  /^pnpm exec playwright-core install /,
];

/** Each one-line `run` of those steps, split at `&&`, with the browser it runs in. */
const commands = pullRequestSteps
  .filter((step) => step.run && !step.run.trim().includes('\n'))
  .flatMap((step) => step.run!.split('&&').map((command) => ({ command: command.trim(), browser: step.env?.BROWSER })))
  .filter(({ command }) => !SETUP.some((setup) => setup.test(command)));

/**
 * The paths a document names in inline code, outside code blocks: `src/…` and `test/…` are the
 * library's, as CONTRIBUTING's "Adding a component" and ARCHITECTURE's package section use them,
 * the rest the repository's. The package's entry points (`signoff-ui/core`), placeholders
 * (`<slug>.md`), globs and what the build writes (`dist/`) are left out.
 */
function namedPaths(markdown: string) {
  const prose = markdown.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, '');
  return [...prose.matchAll(/`([^`\s]+)`/g)]
    .map((match) => match[1]!)
    .filter((token) => /^\.?[\w-][\w.-]*(\/[\w.-]+)*\/?$/.test(token) && !/^(signoff-ui|dist)\//.test(token))
    .filter((token) => token.includes('/') || /[\w-]\.(?:mjs|ts|tsx|json|yaml|yml|md)$/.test(token))
    .map((token) => (/^(src|test)\//.test(token) ? `packages/signoff-ui/${token}` : token));
}

describe('CONTRIBUTING: checks', () => {
  it('names every command the pull request CI jobs run', () => {
    expect(commands.map(({ command }) => command)).toContain('pnpm perf');
    expect(commands.map(({ command }) => command)).toContain('pnpm smoke:assistant-ui');
    for (const { command } of commands) expect(checks, command).toContain(command);
  });

  it('says how to run the browser checks in WebKit and Firefox, as CI does', () => {
    const browsers = [...new Set(commands.flatMap(({ browser }) => (browser ? [browser] : [])))].sort();
    expect(browsers).toEqual(['firefox', 'webkit']);
    for (const browser of browsers) expect(checks, browser).toContain(`BROWSER=${browser}`);
    expect(checks).toContain('pnpm exec playwright-core install webkit firefox');
  });
});

describe('Contributor docs: paths', () => {
  it.each([
    ['CONTRIBUTING.md', contributing],
    ['ARCHITECTURE.md', architecture],
  ])('every path %s names exists', (_, markdown) => {
    const paths = namedPaths(markdown);
    expect(paths.length).toBeGreaterThan(5);
    for (const path of paths) expect(existsSync(join(root, path)), path).toBe(true);
  });

  it('CONTRIBUTING points to the good first issues, Discussions and ARCHITECTURE.md', () => {
    const start = section(contributing, 'Where to start');
    expect(start).toContain('(https://github.com/dgesteves/signoff-ui/labels/good%20first%20issue)');
    expect(start).toContain('(./ROADMAP.md#good-first-issues)');
    expect(roadmap).toMatch(/^### Good first issues$/m);
    expect(start).toContain('(https://github.com/dgesteves/signoff-ui/discussions)');
    expect(start).toContain('(./ARCHITECTURE.md)');
  });

  it('ARCHITECTURE names every entry point the package exports', () => {
    const { exports } = JSON.parse(read('packages/signoff-ui/package.json')) as { exports: Record<string, unknown> };
    const entries = Object.keys(exports)
      .filter((path) => !/\.(css|json)$/.test(path))
      .map((path) => (path === '.' ? 'signoff-ui' : `signoff-ui/${path.slice(2)}`));
    expect(entries.length).toBeGreaterThan(5);
    for (const entry of entries) expect(architecture, entry).toContain(`\`${entry}\``);
  });
});

describe('The version step', () => {
  /** The examples by how they ask for signoff-ui: a range `pnpm version-packages` moves, or a workspace link. */
  const examples = readdirSync(join(root, 'examples')).flatMap((name) => {
    const file = join(root, 'examples', name, 'package.json');
    if (!existsSync(file)) return [];
    const asked = (JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: Record<string, string> }).dependencies?.[
      'signoff-ui'
    ];
    return asked ? [{ name, linked: asked.startsWith('workspace:') }] : [];
  });

  it('moves every example but the playground, as RELEASING and CONTRIBUTING say', () => {
    expect(examples.filter((example) => example.linked).map((example) => example.name)).toEqual(['playground']);
    expect(examples.filter((example) => !example.linked).length).toBeGreaterThan(1);
    const step = /^1\. .*$/m.exec(section(releasing, 'How a release happens'))?.[0] ?? '';
    const changesets = section(contributing, 'Changesets');
    for (const text of [step, changesets]) {
      expect(text).toContain('every example but the playground');
      expect(text).not.toContain('`examples/coding-agent`');
    }
  });
});

describe('ROADMAP: what has shipped', () => {
  /** The pull requests a section links. */
  const pulls = (markdown: string) =>
    [...markdown.matchAll(/\(https:\/\/github\.com\/dgesteves\/signoff-ui\/pull\/(\d+)\)/g)].map((match) => match[1]!);
  /** The pull requests a version's changelog entry links. */
  const inVersion = (version: string) => pulls(section(changelog, version));
  const released = new Set(pulls(changelog));

  it('lists nothing as merged or in review that a release has shipped', () => {
    for (const heading of ['Merged, in the next release', 'In review']) {
      for (const pull of pulls(section(roadmap, heading))) expect(released.has(pull), `#${pull}`).toBe(false);
    }
  });

  it('lists each released item under the version whose changelog has it', () => {
    const items = section(roadmap, 'Released')
      .split('\n')
      .filter((line) => line.startsWith('- **'));
    expect(items.length).toBeGreaterThan(0);
    for (const line of items) {
      const version = /^- \*\*(\d+\.\d+\.\d+)\*\*/.exec(line)?.[1];
      expect(version, line).toBeDefined();
      for (const pull of pulls(line)) expect(inVersion(version!), `#${pull} in ${version}`).toContain(pull);
    }
  });
});
