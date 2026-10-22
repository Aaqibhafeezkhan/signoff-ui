// What the release workflow (.github/workflows/release.yml) checks, and repairs, on npm and GitHub
// for the version of signoff-ui in packages/signoff-ui/package.json. RELEASING.md says when each
// runs, and what to do when one fails.
//
//   node scripts/check-published.mjs npm
//     With pending changesets, the version in package.json is the last release: npm has it, or it
//     has its tag (npm can take minutes to serve a version it has just accepted). With neither, the
//     Release run for the version pull request's merge was replaced before it started, or its
//     publish failed, and that version was never published: exit 1.
//
//   node scripts/check-published.mjs release [--dry-run]
//     With no pending changesets: when npm has the version (or this run published it, as
//     PUBLISHED_PACKAGES says) and GitHub has no release for it, create the release, with the
//     version's CHANGELOG.md entry as its notes, and its tag when that is missing too. The tag goes
//     on the commit the version was published from: GITHUB_SHA when this run published it, or else
//     the commit npm's provenance for the version names (a later push's GITHUB_SHA is code npm never
//     got). Without provenance, it warns and creates nothing. changesets/action creates both after a
//     publish; this covers a publish whose tag or release failed, on a re-run (which publishes
//     nothing new) or on the next push. With --dry-run it says what it would create, and creates
//     nothing.
//
// Environment: GH_TOKEN (without it, GitHub is read anonymously and nothing can be created),
// GITHUB_REPOSITORY (dgesteves/signoff-ui by default), GITHUB_SHA, GITHUB_API_URL, NPM_REGISTRY
// (https://registry.npmjs.org by default) and PUBLISHED_PACKAGES (changesets/action's
// `published-packages` output, [{ "name", "version" }]).
import { Buffer } from 'node:buffer';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');
const TIMEOUT_MS = 30_000;
const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1';

/**
 * The commit that npm's attestations for a version (the JSON of
 * `/-/npm/v1/attestations/<name>@<version>`) say it was built from in `repo`: the release workflow
 * publishes with provenance, an SLSA statement whose resolved dependency is the checkout, as
 * `git+https://github.com/<repo>@<ref>` with its `gitCommit`. undefined when they name none.
 */
export function provenanceCommit(attestations, repo) {
  for (const attestation of Array.isArray(attestations?.attestations) ? attestations.attestations : []) {
    if (attestation?.predicateType !== SLSA_PROVENANCE) continue;
    let statement;
    try {
      statement = JSON.parse(Buffer.from(attestation.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
    } catch {
      continue;
    }
    const dependencies = statement?.predicate?.buildDefinition?.resolvedDependencies;
    for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
      const commit = dependency?.digest?.gitCommit;
      if (
        typeof dependency?.uri === 'string' &&
        dependency.uri.startsWith(`git+https://github.com/${repo}@`) &&
        typeof commit === 'string' &&
        /^[0-9a-f]{40}$/.test(commit)
      ) {
        return commit;
      }
    }
  }
  return undefined;
}

/**
 * The entry for `version` in a CHANGELOG.md, without its heading, found as changesets/action finds
 * the notes of the releases it creates: from the heading that reads `version` to the next heading of
 * its depth, skipping fenced code.
 */
export function changelogEntry(changelog, version) {
  const heading = /^(#{1,6})\s(.*)$|^(`{3,})/gm;
  let start;
  let end;
  for (let match; (match = heading.exec(changelog)) !== null;) {
    if (match[3]) {
      const fence = new RegExp(`^${match[3]}`, 'gm');
      fence.lastIndex = heading.lastIndex;
      if (!fence.exec(changelog)) break;
      heading.lastIndex = fence.lastIndex;
      continue;
    }
    const depth = match[1].length;
    if (match[2].trim() === version) {
      start = { index: heading.lastIndex, depth };
    } else if (start && depth === start.depth) {
      end = match.index;
      break;
    }
  }
  return start ? changelog.slice(start.index, end).trim() : undefined;
}

/**
 * Runs `npm` or `release` (see the top of this file) and returns the exit code. Lines for the log,
 * `::error::` and `::warning::` annotations included, go to `log`.
 */
export async function run(argv, { env = process.env, fetch = globalThis.fetch, root = ROOT, log = console.log } = {}) {
  const [command] = argv;
  const dryRun = argv.includes('--dry-run');
  const { name, version } = JSON.parse(readFileSync(join(root, 'packages/signoff-ui/package.json'), 'utf8'));
  const tag = `${name}@${version}`;
  // A scoped name's slash is %2f in the registry's URLs.
  const npmName = name.replaceAll('/', '%2f');
  const repo = env.GITHUB_REPOSITORY || 'dgesteves/signoff-ui';
  const api = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repo}`;
  const registry = (env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/$/, '');
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'signoff-ui-release',
    ...(env.GH_TOKEN ? { authorization: `Bearer ${env.GH_TOKEN}` } : {}),
  };

  /** Whether `url` is there (200) or not (404). Any other answer throws. */
  const exists = async (url, init) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 404) return false;
    if (response.ok) return true;
    throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
  };
  const onNpm = () => exists(`${registry}/${npmName}/${version}`, { headers: { accept: 'application/json' } });
  const hasTag = () => exists(`${api}/git/ref/tags/${encodeURIComponent(tag)}`, { headers });
  const hasRelease = () => exists(`${api}/releases/tags/${encodeURIComponent(tag)}`, { headers });
  /** The commit npm's provenance says the version was published from, or undefined. */
  const publishedFrom = async () => {
    const url = `${registry}/-/npm/v1/attestations/${npmName}@${version}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
    return provenanceCommit(await response.json(), repo);
  };

  if (command === 'npm') {
    let released;
    try {
      released = (await onNpm()) || (await hasTag());
    } catch (error) {
      // This runs after the version pull request is updated, so a registry or API outage only warns.
      log(`::warning::Could not check whether npm has ${tag}: ${error.message}`);
      return 0;
    }
    if (released) {
      log(`npm has ${tag}, or it has its tag: the version on main was released.`);
      return 0;
    }
    log(
      `::error::${tag} is the version on main, but npm doesn't have it and it has no tag, so it was never published. ` +
        'The Release run for the merge of its version pull request was replaced by a newer run before it started, ' +
        'or its publish failed: re-run that run. RELEASING.md has the steps.',
    );
    return 1;
  }

  if (command === 'release') {
    if (await hasRelease()) {
      log(`${tag} has its GitHub release: nothing to create.`);
      return 0;
    }
    let published;
    try {
      published = JSON.parse(env.PUBLISHED_PACKAGES || '[]');
    } catch {
      // Not changesets/action's JSON: read npm instead.
    }
    const publishedHere =
      Array.isArray(published) && published.some((pkg) => pkg?.name === name && pkg?.version === version);
    if (!publishedHere && !(await onNpm())) {
      log(
        dryRun
          ? `npm doesn't have ${tag}: a publish would publish it, and changesets/action would create its tag and GitHub release.`
          : `::notice::npm doesn't have ${tag}, so it gets no tag or GitHub release yet.`,
      );
      return 0;
    }
    const notes = changelogEntry(readFileSync(join(root, 'packages/signoff-ui/CHANGELOG.md'), 'utf8'), version);
    if (!notes) {
      log(
        `::error::packages/signoff-ui/CHANGELOG.md has no entry for ${version}, the notes of the GitHub release ${tag}.`,
      );
      return 1;
    }
    const tagged = await hasTag();
    const source = publishedHere ? 'This run published' : 'npm has';
    // The commit to tag, when the tag is missing: the one the version was published from. This
    // run's commit only when this run published it; a later push's commit is code npm never got.
    let target;
    let where = '';
    if (!tagged && publishedHere) {
      target = env.GITHUB_SHA;
      where = `, and its tag at ${target || "the run's commit"}`;
    } else if (!tagged) {
      target = await publishedFrom();
      if (!target) {
        log(
          `::warning::npm has ${tag}, and it has no tag or GitHub release, but no provenance names the commit it ` +
            `was published from, so ${dryRun ? 'a run would create' : 'this run creates'} neither. Create them by ` +
            'hand at the merge commit of its version pull request: RELEASING.md has the command.',
        );
        return 0;
      }
      where = `, and its tag at ${target}, the commit npm's provenance says it was published from`;
    }
    const prerelease = version.includes('-');
    const what = `the GitHub release ${tag}${where}`;
    if (dryRun) {
      log(`${source} ${tag}, and it has no GitHub release. Would create ${what}, with these notes:\n\n${notes}`);
      return 0;
    }
    if (!tagged && !target) {
      log(`::error::${tag} has no tag, and GITHUB_SHA doesn't say which commit to tag.`);
      return 1;
    }
    const release = {
      tag_name: tag,
      name: tag,
      body: notes,
      prerelease,
      make_latest: String(!prerelease),
      ...(tagged ? {} : { target_commitish: target }),
    };
    const response = await fetch(`${api}/releases`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(release),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Creating ${what} failed: ${response.status} ${await response.text()}`);
    log(`Created ${what}: ${(await response.json()).html_url}`);
    return 0;
  }

  log('Usage: node scripts/check-published.mjs npm | release [--dry-run]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    console.log(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
