// @vitest-environment node
import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/* scripts/check-published.mjs, which the release workflow runs after changesets/action: with pending
   changesets, that npm has the version on main; with none, the tag and the GitHub release npm's
   version is missing, the tag at the commit it was published from. npm and the GitHub API are
   stand-ins here. */

interface Options {
  env?: Record<string, string | undefined>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  root?: string;
  log?: (line: string) => void;
}
interface CheckPublished {
  run: (argv: string[], options?: Options) => Promise<number>;
  changelogEntry: (changelog: string, version: string) => string | undefined;
  provenanceCommit: (attestations: unknown, repo: string) => string | undefined;
}

const repoRoot = join(import.meta.dirname, '../../..');
const { run, changelogEntry, provenanceCommit } = (await import(
  pathToFileURL(join(repoRoot, 'scripts/check-published.mjs')).href
)) as CheckPublished;

/** The commit a version was published from, and a later push's (GITHUB_SHA in `check`). */
const MERGE = '18df716064d271d54fb732c468669a788f7f2517';
const LATER = 'abc123';

const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

/**
 * npm's attestations for a version published by the release workflow from `commit`, in the shape
 * of signoff-ui@0.8.0's (`/-/npm/v1/attestations/signoff-ui@0.8.0`): npm's publish attestation,
 * then the SLSA provenance, each a DSSE envelope around a base64 in-toto statement. The sigstore
 * certificates and signatures are left out.
 */
function attestations(commit: string, repo = 'dgesteves/signoff-ui', version = '0.9.0') {
  const subject = [{ name: `pkg:npm/signoff-ui@${version}`, digest: { sha512: 'e135' } }];
  return {
    attestations: [
      {
        predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
        bundle: {
          dsseEnvelope: {
            payload: base64({
              predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
              subject,
              predicate: { name: 'signoff-ui', version, registry: 'https://registry.npmjs.org' },
            }),
          },
        },
      },
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: {
          dsseEnvelope: {
            payload: base64({
              predicateType: 'https://slsa.dev/provenance/v1',
              subject,
              predicate: {
                buildDefinition: {
                  externalParameters: {
                    workflow: {
                      ref: 'refs/heads/main',
                      repository: `https://github.com/${repo}`,
                      path: '.github/workflows/release.yml',
                    },
                  },
                  resolvedDependencies: [
                    { uri: `git+https://github.com/${repo}@refs/heads/main`, digest: { gitCommit: commit } },
                  ],
                },
              },
            }),
          },
        },
      },
    ],
  };
}

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

/** npm and the GitHub API, holding these versions, tags and releases, and npm's attestations by version. */
function services({
  npm = [] as string[],
  tags = [] as string[],
  releases = [] as string[],
  provenance = {} as Record<string, unknown>,
  attestationsStatus = 200,
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
    const attested = /^https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/attestations\/signoff-ui@(.+)$/.exec(url)?.[1];
    if (attested !== undefined) {
      if (attestationsStatus !== 200) return new Response('Bad Gateway', { status: attestationsStatus });
      const found = provenance[attested];
      return found ? new Response(JSON.stringify(found), { status: 200 }) : new Response('Not Found', { status: 404 });
    }
    const there =
      found(npm, 'https://registry.npmjs.org/signoff-ui/') ||
      found(tags, 'https://api.github.com/repos/dgesteves/signoff-ui/git/ref/tags/') ||
      found(releases, 'https://api.github.com/repos/dgesteves/signoff-ui/releases/tags/');
    return new Response(there ? '{}' : 'Not Found', { status: there ? 200 : 404 });
  };
  return {
    fetch,
    calls,
    posts: () => calls.filter((call) => call.method === 'POST'),
    attestationCalls: () => calls.filter((call) => call.url.includes('/-/npm/v1/attestations/')),
  };
}

async function check(argv: string[], version: string, world: ReturnType<typeof services>, env: Options['env'] = {}) {
  const lines: string[] = [];
  const code = await run(argv, {
    root: checkout(version),
    fetch: world.fetch,
    env: { GH_TOKEN: 'token', GITHUB_REPOSITORY: 'dgesteves/signoff-ui', GITHUB_SHA: LATER, ...env },
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

describe('provenanceCommit', () => {
  it('reads the commit the SLSA provenance names, for this repository', () => {
    expect(provenanceCommit(attestations(MERGE), 'dgesteves/signoff-ui')).toBe(MERGE);
  });

  it('names no commit for another repository, a publish attestation alone, or a payload it can’t read', () => {
    expect(provenanceCommit(attestations(MERGE, 'someone/signoff-ui'), 'dgesteves/signoff-ui')).toBeUndefined();
    // A repository whose name starts with this one's.
    expect(provenanceCommit(attestations(MERGE, 'dgesteves/signoff-ui-fork'), 'dgesteves/signoff-ui')).toBeUndefined();
    const [publish, slsa] = attestations(MERGE).attestations;
    expect(provenanceCommit({ attestations: [publish] }, 'dgesteves/signoff-ui')).toBeUndefined();
    const unreadable = { ...slsa, bundle: { dsseEnvelope: { payload: 'not base64 json' } } };
    expect(provenanceCommit({ attestations: [unreadable] }, 'dgesteves/signoff-ui')).toBeUndefined();
    expect(provenanceCommit(attestations('main'), 'dgesteves/signoff-ui')).toBeUndefined();
    expect(provenanceCommit({}, 'dgesteves/signoff-ui')).toBeUndefined();
    expect(provenanceCommit(null, 'dgesteves/signoff-ui')).toBeUndefined();
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

  // changesets/action has versioned the package on changeset-release/main by the time this runs, so
  // package.json holds the next version: the workflow passes main's as VERSION.
  it('checks the version on main that VERSION names, not the next one in package.json', async () => {
    const world = services({ npm: ['0.8.0'], tags: ['signoff-ui@0.8.0'] });
    expect(await check(['npm'], '0.9.0', world, { VERSION: '0.8.0' })).toEqual({
      code: 0,
      log: 'npm has signoff-ui@0.8.0, or it has its tag: the version on main was released.',
    });
  });

  // The version pull request's merge run was replaced: main's 0.9.0 was never published, and the
  // error names it, not the next version package.json holds on the release branch.
  it('fails, naming the version on main that VERSION names, when npm never got it', async () => {
    const world = services({ npm: ['0.8.0'], tags: ['signoff-ui@0.8.0'] });
    const { code, log } = await check(['npm'], '0.9.1', world, { VERSION: '0.9.0' });
    expect(code).toBe(1);
    expect(log).toMatch(/^::error::signoff-ui@0\.9\.0 is the version on main, but npm doesn't have it/);
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
  // changesets/action creates neither. A re-run checks out the commit it published, but the next
  // push's run checks out a later one, which npm never got: the tag goes where npm's provenance says.
  it('creates the release and its tag, at the commit npm’s provenance names, for a version npm has', async () => {
    const world = services({ npm: ['0.9.0'], provenance: { '0.9.0': attestations(MERGE) } });
    const { code, log } = await check(['release'], '0.9.0', world);
    expect(code).toBe(0);
    expect(log).toBe(
      `Created the GitHub release signoff-ui@0.9.0, and its tag at ${MERGE}, the commit npm's provenance says it ` +
        'was published from: https://github.com/dgesteves/signoff-ui/releases/tag/x',
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
          target_commitish: MERGE,
        },
      },
    ]);
    // npm gets no GitHub token.
    expect(world.attestationCalls()).toEqual([
      expect.objectContaining({
        url: 'https://registry.npmjs.org/-/npm/v1/attestations/signoff-ui@0.9.0',
        headers: { accept: 'application/json' },
      }),
    ]);
  });

  it('warns, and creates neither, when no provenance names the commit npm’s version came from', async () => {
    for (const provenance of [{}, { '0.9.0': attestations(MERGE, 'someone/signoff-ui') }]) {
      const world = services({ npm: ['0.9.0'], provenance });
      const { code, log } = await check(['release'], '0.9.0', world);
      expect(code).toBe(0);
      expect(log).toMatch(
        /^::warning::npm has signoff-ui@0\.9\.0, and it has no tag or GitHub release, but no provenance names the commit/,
      );
      expect(log).toContain('this run creates neither');
      expect(world.posts()).toEqual([]);
    }
  });

  // A re-run tries again.
  it('throws when npm’s attestations can’t be read, so the step fails', async () => {
    const world = services({ npm: ['0.9.0'], attestationsStatus: 502 });
    await expect(check(['release'], '0.9.0', world)).rejects.toThrow(
      /^https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/attestations\/signoff-ui@0\.9\.0 answered 502/,
    );
    expect(world.posts()).toEqual([]);
  });

  it('keeps a tag that exists, and creates only the release', async () => {
    const world = services({ npm: ['0.9.0'], tags: ['signoff-ui@0.9.0'] });
    const { log } = await check(['release'], '0.9.0', world);
    expect(log).toBe(
      'Created the GitHub release signoff-ui@0.9.0: https://github.com/dgesteves/signoff-ui/releases/tag/x',
    );
    expect(world.posts()[0]?.body).not.toHaveProperty('target_commitish');
    expect(world.attestationCalls()).toEqual([]);
  });

  // changesets/action lists what it published; npm can take minutes to serve it, and its
  // provenance too. This run checked out the commit it published.
  it('creates the release for a version this run published, with the tag at the run’s commit', async () => {
    const world = services({});
    const published = JSON.stringify([{ name: 'signoff-ui', version: '0.9.0' }]);
    const { code, log } = await check(['release'], '0.9.0', world, { PUBLISHED_PACKAGES: published });
    expect(code).toBe(0);
    expect(log).toBe(
      `Created the GitHub release signoff-ui@0.9.0, and its tag at ${LATER}: https://github.com/dgesteves/signoff-ui/releases/tag/x`,
    );
    expect(world.posts()).toHaveLength(1);
    expect(world.posts()[0]?.body).toMatchObject({ target_commitish: LATER });
    expect(world.attestationCalls()).toEqual([]);
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
    const world = services({
      npm: ['1.0.0-next.0'],
      provenance: { '1.0.0-next.0': attestations(MERGE, 'dgesteves/signoff-ui', '1.0.0-next.0') },
    });
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
    const published = JSON.stringify([{ name: 'signoff-ui', version: '0.9.0' }]);
    const noSha = await check(['release'], '0.9.0', services({}), {
      GITHUB_SHA: undefined,
      PUBLISHED_PACKAGES: published,
    });
    expect(noSha.code).toBe(1);
    expect(noSha.log).toMatch(/^::error::signoff-ui@0\.9\.0 has no tag, and GITHUB_SHA/);
  });

  it('throws when GitHub refuses the release, so the step fails', async () => {
    const world = services({ npm: ['0.9.0'], provenance: { '0.9.0': attestations(MERGE) }, post: 403 });
    await expect(check(['release'], '0.9.0', world)).rejects.toThrow(
      new RegExp(`^Creating the GitHub release signoff-ui@0\\.9\\.0, and its tag at ${MERGE}, .* failed: 403`),
    );
  });
});

describe('check-published release --dry-run', () => {
  it('says what it would create, and creates nothing', async () => {
    const world = services({ npm: ['0.9.0'], provenance: { '0.9.0': attestations(MERGE) } });
    const { code, log } = await check(['release', '--dry-run'], '0.9.0', world);
    expect(code).toBe(0);
    expect(log).toBe(
      'npm has signoff-ui@0.9.0, and it has no GitHub release. Would create the GitHub release signoff-ui@0.9.0, ' +
        `and its tag at ${MERGE}, the commit npm's provenance says it was published from, with these notes:\n\n` +
        '### Minor Changes\n\n- [#160](https://github.com/dgesteves/signoff-ui/pull/160) A new prop.',
    );
    expect(world.posts()).toEqual([]);
  });

  it('says it would create neither without provenance', async () => {
    const world = services({ npm: ['0.9.0'] });
    const { code, log } = await check(['release', '--dry-run'], '0.9.0', world);
    expect(code).toBe(0);
    expect(log).toMatch(/^::warning::npm has signoff-ui@0\.9\.0, .* so a run would create neither\./);
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
    const world = services({ npm: ['0.9.0'], provenance: { '0.9.0': attestations(MERGE) } });
    await check(['release', '--dry-run'], '0.9.0', world, { GH_TOKEN: undefined });
    expect(world.calls.map((call) => call.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
    for (const call of world.calls) expect(call.headers).not.toHaveProperty('authorization');
  });
});

it('prints its usage for anything else', async () => {
  expect((await check([], '0.9.0', services({}))).code).toBe(2);
});
