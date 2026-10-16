// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The changelog entries `changeset version` writes, from the module .changeset/config.json names,
   loaded as changesets loads it. Each entry links its pull request and commit, and thanks whoever
   wrote the changeset, except the maintainer: every entry of 0.7.0 and 0.8.0 read "Thanks
   [@dgesteves](https://github.com/dgesteves)!", and so did the version pull requests and the GitHub
   releases. GitHub's GraphQL API is a stand-in here. */

interface Changeset {
  id: string;
  summary: string;
  releases: { name: string; type: string }[];
  commit?: string;
}
type Options = Record<string, unknown>;
interface Changelog {
  getReleaseLine: (changeset: Changeset, type: string, options: Options) => Promise<string>;
  getDependencyReleaseLine: (changesets: Changeset[], dependencies: unknown[], options: Options) => Promise<string>;
}

const root = join(import.meta.dirname, '../../..');
const config = JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8')) as {
  changelog: [string, Options];
};
const [specifier, options] = config.changelog;
// As @changesets/apply-release-plan resolves it: from the .changeset directory.
const path = createRequire(join(root, '.changeset', 'x.mjs')).resolve(specifier);
const changelog = ((await import(pathToFileURL(path).href)) as { default: Changelog }).default;

/** Who wrote each commit, and in which pull request, as GitHub's GraphQL API answers. */
const COMMITS: Record<string, { pull: number; author: string }> = {
  d1fa8ac574abbab486d367aaacce6229983492f2: { pull: 118, author: 'dgesteves' },
  '33589ee32d041d1df8abe63d27a57acdb3a273bf': { pull: 141, author: 'octocat' },
  '9ca8c9b0cb0d1552e74d3fe624436c8a924d9c3b': { pull: 115, author: 'DGEsteves' },
};

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', 'token');
  vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
  vi.stubEnv('GITHUB_GRAPHQL_URL', 'https://api.github.com/graphql');
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { query } = JSON.parse(init.body) as { query: string };
    const repo__0: Record<string, unknown> = {};
    for (const [, sha = ''] of query.matchAll(/commit__(\w+): object/g)) {
      const commit = COMMITS[sha];
      if (!commit) continue;
      const author = { login: commit.author, url: `https://github.com/${commit.author}` };
      repo__0[`commit__${sha}`] = {
        commitUrl: `https://github.com/dgesteves/signoff-ui/commit/${sha}`,
        associatedPullRequests: {
          nodes: [
            {
              number: commit.pull,
              url: `https://github.com/dgesteves/signoff-ui/pull/${commit.pull}`,
              mergedAt: '2026-10-15T00:00:00Z',
              author,
            },
          ],
        },
        author: { user: author },
      };
    }
    return new Response(JSON.stringify({ data: { repo__0 } }));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const line = (summary: string, commit?: string) =>
  changelog.getReleaseLine(
    { id: 'a-changeset', summary, releases: [{ name: 'signoff-ui', type: 'patch' }], ...(commit ? { commit } : {}) },
    'patch',
    options,
  );

describe('the changelog', () => {
  it('links the pull request and the commit, and doesn’t thank the maintainer', async () => {
    expect(
      await line(
        'A deny rule the server doesn’t get no longer lets it approve.',
        'd1fa8ac574abbab486d367aaacce6229983492f2',
      ),
    ).toBe(
      '\n\n- [#118](https://github.com/dgesteves/signoff-ui/pull/118) ' +
        '[`d1fa8ac`](https://github.com/dgesteves/signoff-ui/commit/d1fa8ac574abbab486d367aaacce6229983492f2) - ' +
        'A deny rule the server doesn’t get no longer lets it approve.\n',
    );
  });

  it('leaves out the maintainer however GitHub cases the login', async () => {
    expect(await line('A fix.', '9ca8c9b0cb0d1552e74d3fe624436c8a924d9c3b')).not.toContain('Thanks');
  });

  it('thanks anyone else who wrote a changeset', async () => {
    expect(await line('`engines` names the Node versions.', '33589ee32d041d1df8abe63d27a57acdb3a273bf')).toBe(
      '\n\n- [#141](https://github.com/dgesteves/signoff-ui/pull/141) ' +
        '[`33589ee`](https://github.com/dgesteves/signoff-ui/commit/33589ee32d041d1df8abe63d27a57acdb3a273bf) ' +
        'Thanks [@octocat](https://github.com/octocat)! - `engines` names the Node versions.\n',
    );
  });

  // A changeset can name its authors on `author:` lines.
  it('keeps the other authors a changeset names', async () => {
    expect(await line('author: @dgesteves\nauthor: @octocat\nA fix.', 'd1fa8ac574abbab486d367aaacce6229983492f2')).toBe(
      '\n\n- [#118](https://github.com/dgesteves/signoff-ui/pull/118) ' +
        '[`d1fa8ac`](https://github.com/dgesteves/signoff-ui/commit/d1fa8ac574abbab486d367aaacce6229983492f2) ' +
        'Thanks [@octocat](https://github.com/octocat)! - A fix.\n',
    );
  });

  it('keeps the lines after the first, and a "Thanks" in the text', async () => {
    expect(
      await line('author: @dgesteves\nThanks [@dgesteves](https://github.com/dgesteves)! - a quote.\n\nMore.'),
    ).toBe('\n\n- Thanks [@dgesteves](https://github.com/dgesteves)! - a quote.\n  \n  More.');
  });

  it('writes the dependency lines as @changesets/changelog-github does', async () => {
    expect(await changelog.getDependencyReleaseLine([], [], options)).toBe('');
  });
});
