# Releasing

`signoff-ui` is published to npm from [`.github/workflows/release.yml`](.github/workflows/release.yml), never from a laptop.

## How a release happens

1. A pull request with a changeset merges to `main`. The release workflow opens or updates the version pull request, `chore: version packages`, which moves the version, the changelog and the range of `signoff-ui` that `examples/coding-agent` asks for.
2. CI runs on the version pull request as on any other (see [the release GitHub App](#the-release-github-app)). Merge it once `Lint, typecheck, test, build` passes, or let it merge by itself (`RELEASE_AUTO_MERGE`, below).
3. The merge runs the release workflow again. With no changesets left, it publishes to npm what npm doesn't have yet, then creates the tag `signoff-ui@X.Y.Z` and its GitHub release, with the version's `CHANGELOG.md` entry as the notes.

On a push to `main`, the workflow runs two jobs, one after the other:

- **Validate the package**, with read permissions: `pnpm build:lib`, `pnpm size`, the library's typecheck, `pnpm test` and `pnpm --filter signoff-ui lint:package` (publint and attw), on the commit the next job versions or publishes. The browser checks run in CI, on the version pull request, before it merges.
- **Version or publish**, the only job that can write or publish (its `id-token` is for npm trusted publishing): `changesets/action`, which opens the version pull request or runs `pnpm release` (`build:lib`, then `changeset publish`). It runs no tests, and installs without the pnpm store cache, which the jobs that run the dependencies' code save. Then:
  - with changesets pending, `node scripts/check-published.mjs npm` checks that npm has the version on `main`, or that the version has its tag, since npm can take a few minutes to serve a new version (see [release day](#release-day));
  - with none, `node scripts/check-published.mjs release` creates the tag and the GitHub release of the version on `main` when npm has it and they are missing.

Every action is pinned to a commit, with its version in a comment, and Dependabot moves both.

The changelog entries come from `scripts/changelog.mjs`, which wraps `@changesets/changelog-github`: each entry links its pull request and its commit, and thanks whoever wrote the changeset, except the maintainers named in `.changeset/config.json`. The version pull request and the GitHub release show the same entries.

## The release GitHub App

A push made with the workflow's own token starts no workflows. So before the App, CI on the version pull request waited for approval, and each version pull request needed an empty `chore: run CI` commit before `main` would take it. A push made with the App's token starts CI as any other push does.

The App has two repository permissions, Contents and Pull requests, read and write, and is installed on this repository only. Two repository secrets hold it: `RELEASE_APP_ID`, its client ID (or app ID), and `RELEASE_APP_PRIVATE_KEY`, a private key generated on its settings page. When both are set, the workflow uses the App's token, and the version commit, the version pull request, the tag and the GitHub release are the App's. To rotate the key, generate a new one on the App's page, replace `RELEASE_APP_PRIVATE_KEY`, then delete the old key there.

Without the secrets, the workflow uses its own token, as before. It starts CI on the version branch itself (`gh workflow run ci.yml`), but GitHub doesn't count those checks for the pull request: on the pull request, approve the CI run that waits for approval, or push an empty commit to `changeset-release/main`.

### Merging the version pull request by itself

To have each version pull request merge by itself once its CI passes, allow auto-merge (Settings, General) and add a repository variable `RELEASE_AUTO_MERGE` set to `true`. A merged changeset then reaches npm as soon as the version pull request's CI passes, so leave it off while releases are timed by hand. With the variable set and auto-merge not allowed, the merge step fails, after the version pull request is updated.

## A dry run

Run the workflow by hand on a branch: Actions, Release, Run workflow, or

```sh
gh workflow run release.yml --ref <branch>
```

It publishes, pushes and creates nothing:

- **Validate the package** runs as on a push.
- **Version or publish** doesn't run. In its place, **Dry run**, with read permissions only, gets a read-only token from the App when its secrets are set (if that step fails, the App or its secrets need fixing), then:
  - with changesets pending, checks that npm has the version on the branch (`check-published.mjs npm`); with none, says what a publish would publish, or the tag and release it would create, with their notes (`check-published.mjs release --dry-run`);
  - runs `pnpm version-packages` and prints the diff the version pull request would have, changelog entries included;
  - builds and packs the package in the runner, and prints its name, its version and how many files it has.

Do one after any change to the release workflow, before the next release.

## Release day

The workflow runs one release at a time. A run that waits behind another is replaced when a newer push to `main` arrives, and that can lose a version: if the run for the version pull request's merge is replaced by the run of a pull request with a changeset, that run only updates the version pull request, and the merged version never reaches npm.

So, before merging the version pull request, wait for any Release run in progress to finish. After merging it, merge nothing else until its Release run has started. If it is replaced anyway, the next run's "The version on main is on npm" step fails and names the version: re-run the replaced run, as below.

## When something fails

Re-running a Release run is safe: `changeset publish` publishes only the versions npm doesn't have, and the tag and release step creates only what is missing.

- **The Release run for the version pull request's merge was cancelled**, or a later run's "The version on main is on npm" step fails. Open the run for the merge commit (Actions, Release) and re-run all its jobs. It checks out that commit, publishes its version, and creates the tag and the GitHub release.
- **npm has the version, but its tag or GitHub release is missing.** Re-run the run: it publishes nothing, and creates them, with the tag at the run's commit. The next push to `main` creates them too, with the tag at that push's commit. Or create them by hand: `gh release create signoff-ui@X.Y.Z --target <merge commit> --title signoff-ui@X.Y.Z --notes-file <the version's CHANGELOG.md entry>`.
- **Validate the package fails on `main`.** Nothing was versioned or published. Fix `main`, and the next push runs the release again.
- **A broken version reached npm.** npm never takes the same version twice, and unpublishing breaks the installs that have it. Deprecate it, logged in to npm as an owner of the package: `npm deprecate signoff-ui@X.Y.Z "<what is broken, and the version to use>"`. Then release the fix as a patch changeset, as usual.
- **"Get a token from the release GitHub App" fails.** The App isn't installed on this repository, or a secret is wrong. Fix it and re-run, or delete both secrets to release with the workflow's own token.
