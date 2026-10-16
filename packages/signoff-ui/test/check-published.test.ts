// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/* scripts/check-published.mjs, which the release workflow runs after changesets/action: with pending
   changesets, that npm has the version on main; with none, the tag and the GitHub release npm's
   version is missing. npm and the GitHub API are stand-ins here. */

interface Options {
  env?: Record<string, string | undefined>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  root?: string;
  log?: (line: string) => void;
}
interface CheckPublished {
  run: (argv: string[], options?: Options) => Promise<number>;
  changelogEntry: (changelog: string, version: string) => string | undefined;
}

const repoRoot = join(import.meta.dirname, '../../..');
const { run, changelogEntry } = (await import(
  pathToFileURL(join(repoRoot, 'scripts/check-published.mjs')).href
)) as CheckPublished;

const CHANGELOG = `# signoff-ui

## 0.9.0

### Minor Changes

- [#160](https://github.com/dgesteves/signoff-ui/pull/160) A new prop.

## 0.8.0

### Patch Changes

- A fix.
`;

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A checkout with signoff-ui at `version`, and CHANGELOG.md. */
function checkout(version: string, changelog = CHANGELOG): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-published-'));
  roots.push(dir);
  mkdirSync(join(dir, 'packages/signoff-ui'), { recursive: true });
  writeFileSync(join(dir, 'packages/signoff-ui/package.json'), JSON.stringify({ name: 'signoff-ui', version }));
  writeFileSync(join(dir, 'packages/signoff-ui/CHANGELOG.md'), changelog);
  return dir;
}

/** npm and the GitHub API, holding these versions, tags and releases. */
function services({
  npm = [] as string[],
  tags = [] as string[],
  releases = [] as string[],
  post = 201,
  down = false,
}) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const headers = init.headers as Record<string, string>;
    calls.push({ method, url, headers, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (down) throw new TypeError('fetch failed');
    const found = (list: string[], prefix: string) =>
      list.some((item) => url === `${prefix}${item}` || url === `${prefix}${encodeURIComponent(item)}`);
    if (method === 'POST' && url === 'https://api.github.com/repos/dgesteves/signoff-ui/releases') {
      return new Response(JSON.stringify({ html_url: 'https://github.com/dgesteves/signoff-ui/releases/tag/x' }), {
        status: post,
      });
    }
    const there =
      found(npm, 'https://registry.npmjs.org/signoff-ui/') ||
      found(tags, 'https://api.github.com/repos/dgesteves/signoff-ui/git/ref/tags/') ||
      found(releases, 'https://api.github.com/repos/dgesteves/signoff-ui/releases/tags/');
    return new Response(there ? '{}' : 'Not Found', { status: there ? 200 : 404 });
  };
  return { fetch, calls, posts: () => calls.filter((call) => call.method === 'POST') };
}

async function check(argv: string[], version: string, world: ReturnType<typeof services>, env: Options['env'] = {}) {
  const lines: string[] = [];
  const code = await run(argv, {
    root: checkout(version),
    fetch: world.fetch,
    env: { GH_TOKEN: 'token', GITHUB_REPOSITORY: 'dgesteves/signoff-ui', GITHUB_SHA: 'abc123', ...env },
    log: (line) => lines.push(line),
  });
  return { code, log: lines.join('\n') };
}

describe('changelogEntry', () => {
  it('takes a version’s entry, as changesets/action does for the releases it creates', () => {
    expect(changelogEntry(CHANGELOG, '0.9.0')).toBe(
      '### Minor Changes\n\n- [#160](https://github.com/dgesteves/signoff-ui/pull/160) A new prop.',
    );
    expect(changelogEntry(CHANGELOG, '0.8.0')).toBe('### Patch Changes\n\n- A fix.');
    expect(changelogEntry(CHANGELOG, '0.7.0')).toBeUndefined();
  });

  it('reads past a heading inside fenced code', () => {
    const changelog = '## 1.0.0\n\n- Run:\n\n```md\n## not a version\n```\n\n- More.\n\n## 0.9.0\n\n- Old.\n';
    expect(changelogEntry(changelog, '1.0.0')).toBe('- Run:\n\n```md\n## not a version\n```\n\n- More.');
  });

  it('finds the entry of the version this repository publishes now in its CHANGELOG.md', () => {
    const { version } = JSON.parse(readFileSync(join(repoRoot, 'packages/signoff-ui/package.json'), 'utf8')) as {
      version: string;
    };
    const entry = changelogEntry(readFileSync(join(repoRoot, 'packages/signoff-ui/CHANGELOG.md'), 'utf8'), version);
    expect(entry).toMatch(/^### (Major|Minor|Patch) Changes\n/);
    expect(entry).not.toMatch(/^## /m);
  });
});

describe('check-published npm, with pending changesets', () => {
  it('passes when npm has the version on main', async () => {
    const world = services({ npm: ['0.8.0'] });
    expect(await check(['npm'], '0.8.0', world)).toEqual({
      code: 0,
      log: 'npm has signoff-ui@0.8.0, or it has its tag: the version on main was released.',
    });
  });

  // npm can take minutes to serve a version: changesets/action tags it right after the publish.
  it('passes when the version has its tag, while npm doesn’t serve it yet', async () => {
    const world = services({ tags: ['signoff-ui@0.8.0'] });
    expect((await check(['npm'], '0.8.0', world)).code).toBe(0);
  });

  // The Release run for the version pull request's merge waited behind another, a newer push
  // replaced it, and that push's run found pending changesets: 0.9.0 was never published.
  it('fails, saying to re-run the replaced run, when the version on main was never published', async () => {
    const world = services({ npm: ['0.8.0'], tags: ['signoff-ui@0.8.0'] });
    const { code, log } = await check(['npm'], '0.9.0', world);
    expect(code).toBe(1);
    expect(log).toMatch(/^::error::signoff-ui@0\.9\.0 is the version on main, but npm doesn't have it/);
    expect(log).toContain('re-run that run');
    expect(world.posts()).toEqual([]);
  });

  it('only warns when npm or GitHub can’t be reached', async () => {
    const { code, log } = await check(['npm'], '0.9.0', services({ down: true }));
    expect(code).toBe(0);
    expect(log).toMatch(/^::warning::Could not check whether npm has signoff-ui@0\.9\.0: fetch failed/);
  });
});

describe('check-published release, with no pending changesets', () => {
  it('creates nothing when the version has its release', async () => {
    const world = services({ npm: ['0.9.0'], tags: ['signoff-ui@0.9.0'], releases: ['signoff-ui@0.9.0'] });
    expect(await check(['release'], '0.9.0', world)).toEqual({
      code: 0,
      log: 'signoff-ui@0.9.0 has its GitHub release: nothing to create.',
    });
    expect(world.posts()).toEqual([]);
  });

  // The publish worked and the tag and release failed: a re-run publishes nothing, and so
  // changesets/action creates neither.
  it('creates the release and its tag, at the run’s commit, for a version npm has', async () => {
    const world = services({ npm: ['0.9.0'] });
    const { code, log } = await check(['release'], '0.9.0', world);
    expect(code).toBe(0);
    expect(log).toBe(
      'Created the GitHub release signoff-ui@0.9.0, and its tag at abc123: https://github.com/dgesteves/signoff-ui/releases/tag/x',
    );
    expect(world.posts()).toEqual([
      {
        method: 'POST',
        url: 'https://api.github.com/repos/dgesteves/signoff-ui/releases',
        headers: expect.objectContaining({ authorization: 'Bearer token' }),
        body: {
          tag_name: 'signoff-ui@0.9.0',
          name: 'signoff-ui@0.9.0',
          body: '### Minor Changes\n\n- [#160](https://github.com/dgesteves/signoff-ui/pull/160) A new prop.',
          prerelease: false,
          make_latest: 'true',
          target_commitish: 'abc123',
        },
      },
    ]);
  });

  it('keeps a tag that exists, and creates only the release', async () => {
    const world = services({ npm: ['0.9.0'], tags: ['signoff-ui@0.9.0'] });
    const { log } = await check(['release'], '0.9.0', world);
    expect(log).toBe(
      'Created the GitHub release signoff-ui@0.9.0: https://github.com/dgesteves/signoff-ui/releases/tag/x',
    );
    expect(world.posts()[0]?.body).not.toHaveProperty('target_commitish');
  });

  // changesets/action lists what it published; npm can take minutes to serve it.
  it('creates the release for a version this run published, before npm serves it', async () => {
    const world = services({});
    const published = JSON.stringify([{ name: 'signoff-ui', version: '0.9.0' }]);
    const { code } = await check(['release'], '0.9.0', world, { PUBLISHED_PACKAGES: published });
    expect(code).toBe(0);
    expect(world.posts()).toHaveLength(1);
  });

  it('creates nothing for a version npm doesn’t have', async () => {
    const world = services({ npm: ['0.8.0'] });
    for (const published of ['[]', '', 'not json', '{}']) {
      const { code, log } = await check(['release'], '0.9.0', world, { PUBLISHED_PACKAGES: published });
      expect(code).toBe(0);
      expect(log).toBe("::notice::npm doesn't have signoff-ui@0.9.0, so it gets no tag or GitHub release yet.");
    }
    expect(world.posts()).toEqual([]);
  });

  it('marks a prerelease as one, and not as the latest', async () => {
    const world = services({ npm: ['1.0.0-next.0'] });
    const changelog = '## 1.0.0-next.0\n\n- Early.\n';
    const lines: string[] = [];
    await run(['release'], {
      root: checkout('1.0.0-next.0', changelog),
      fetch: world.fetch,
      env: { GH_TOKEN: 'token', GITHUB_SHA: 'abc123' },
      log: (line) => lines.push(line),
    });
    expect(world.posts()[0]?.body).toMatchObject({ prerelease: true, make_latest: 'false', body: '- Early.' });
  });

  it('fails without a CHANGELOG.md entry for the version, or a commit to tag', async () => {
    const noEntry = await check(['release'], '0.9.1', services({ npm: ['0.9.1'] }));
    expect(noEntry.code).toBe(1);
    expect(noEntry.log).toMatch(/^::error::packages\/signoff-ui\/CHANGELOG\.md has no entry for 0\.9\.1/);
    const noSha = await check(['release'], '0.9.0', services({ npm: ['0.9.0'] }), { GITHUB_SHA: undefined });
    expect(noSha.code).toBe(1);
    expect(noSha.log).toMatch(/^::error::signoff-ui@0\.9\.0 has no tag, and GITHUB_SHA/);
  });

  it('throws when GitHub refuses the release, so the step fails', async () => {
    await expect(check(['release'], '0.9.0', services({ npm: ['0.9.0'], post: 403 }))).rejects.toThrow(
      /^Creating the GitHub release signoff-ui@0\.9\.0, and its tag at abc123 failed: 403/,
    );
  });
});

describe('check-published release --dry-run', () => {
  it('says what it would create, and creates nothing', async () => {
    const world = services({ npm: ['0.9.0'] });
    const { code, log } = await check(['release', '--dry-run'], '0.9.0', world);
    expect(code).toBe(0);
    expect(log).toBe(
      'npm has signoff-ui@0.9.0, and it has no GitHub release. Would create the GitHub release signoff-ui@0.9.0, ' +
        'and its tag at abc123, with these notes:\n\n' +
        '### Minor Changes\n\n- [#160](https://github.com/dgesteves/signoff-ui/pull/160) A new prop.',
    );
    expect(world.posts()).toEqual([]);
  });

  it('says a publish would publish a version npm doesn’t have', async () => {
    const world = services({});
    const { log } = await check(['release', '--dry-run'], '0.9.0', world);
    expect(log).toBe(
      "npm doesn't have signoff-ui@0.9.0: a publish would publish it, and changesets/action would create its tag and GitHub release.",
    );
    expect(world.posts()).toEqual([]);
  });

  it('says which run published a version npm doesn’t serve yet', async () => {
    const world = services({ tags: ['signoff-ui@0.9.0'] });
    const published = JSON.stringify([{ name: 'signoff-ui', version: '0.9.0' }]);
    const { log } = await check(['release', '--dry-run'], '0.9.0', world, { PUBLISHED_PACKAGES: published });
    expect(log).toMatch(
      /^This run published signoff-ui@0\.9\.0, and it has no GitHub release\. Would create the GitHub release signoff-ui@0\.9\.0, with these notes:/,
    );
    expect(world.posts()).toEqual([]);
  });

  it('only reads, with or without a token', async () => {
    const world = services({ npm: ['0.9.0'] });
    await check(['release', '--dry-run'], '0.9.0', world, { GH_TOKEN: undefined });
    expect(world.calls.map((call) => call.method)).toEqual(['GET', 'GET', 'GET']);
    for (const call of world.calls) expect(call.headers).not.toHaveProperty('authorization');
  });
});

it('prints its usage for anything else', async () => {
  expect((await check([], '0.9.0', services({}))).code).toBe(2);
});
