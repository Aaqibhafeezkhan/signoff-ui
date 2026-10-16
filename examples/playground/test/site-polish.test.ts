/*
 * Link preview alt text, the sitemap's dates on a host's shallow clone, hit areas on phones, and the
 * approval rules demo's markup. `pnpm a11y` checks the same pages in Chrome.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

const SITE = join(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(SITE, path), 'utf8');

/** Each `<tag` in a component's source: its text up to the next one, and its className. */
function tags(text: string, tag: string) {
  return text
    .split(`<${tag}`)
    .slice(1)
    .map((rest) => ({
      text: rest,
      className:
        /className=(?:"([^"]*)"|\{`([^`]*)`\})/
          .exec(rest)
          ?.slice(1)
          .find((v) => v !== undefined) ?? '',
    }));
}

describe('link previews', () => {
  const images = readdirSync(join(SITE, 'app'), { recursive: true, encoding: 'utf8' }).filter((path) =>
    path.endsWith('opengraph-image.tsx'),
  );
  const alt = (path: string) => /export const alt = (.+);/.exec(source(path))?.[1] ?? '';

  it('give every image an alt that names the site, and none reads "An signoff-ui"', () => {
    assert.ok(images.length >= 5, images.join(', '));
    for (const path of images) {
      assert.match(alt(join('app', path)), /signoff-ui|\$\{PACKAGE\}/, path);
      assert.doesNotMatch(alt(join('app', path)), /\bAn signoff-ui\b/, path);
    }
  });

  it('say what a page’s card shows: its title and summary, or the component and what it does', () => {
    // One alt serves every page of a dynamic route, so it describes the card rather than one page.
    assert.match(
      alt('app/docs/[slug]/opengraph-image.tsx'),
      /^'Preview card from the signoff-ui docs, .*title and summary'$/,
    );
    assert.match(
      alt('app/docs/components/[slug]/opengraph-image.tsx'),
      /^'Preview card from the signoff-ui docs, .*component name and what it does'$/,
    );
  });
});

describe('sitemap dates on a shallow clone', () => {
  const temp = mkdtempSync(join(tmpdir(), 'signoff-ui-history-'));
  after(() => rmSync(temp, { recursive: true, force: true }));

  // Not on Vercel unless a test says so, and none of the person's git config (signing, hooks).
  type Env = Record<string, string>;
  const { VERCEL: _vercel, ...outside } = process.env;
  const env = {
    ...outside,
    GIT_CONFIG_GLOBAL: join(temp, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  writeFileSync(join(temp, 'gitconfig'), '');
  const run = (cwd: string, command: string, args: string[], extra: Env = {}) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...env, ...extra } });
    assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const OLD = '2026-01-02T03:04:05Z';

  // A repository whose docs page last changed four commits ago, and a host's clone of the last one.
  const origin = join(temp, 'origin');
  mkdirSync(join(origin, 'examples/playground'), { recursive: true });
  run(origin, 'git', ['init', '-q', '-b', 'main']);
  writeFileSync(join(origin, 'examples/playground/page.md'), '# A page\n');
  run(origin, 'git', ['add', '-A']);
  run(origin, 'git', ['commit', '-qm', 'page'], { GIT_AUTHOR_DATE: OLD, GIT_COMMITTER_DATE: OLD });
  for (const n of [1, 2, 3]) {
    writeFileSync(join(origin, 'other.md'), `${n}\n`);
    run(origin, 'git', ['add', '-A']);
    run(origin, 'git', ['commit', '-qm', `other ${n}`]);
  }
  const clone = (name: string) => {
    run(temp, 'git', ['clone', '-q', '--depth', '1', pathToFileURL(origin).href, name]);
    return join(temp, name, 'examples/playground');
  };

  // The playground's own script, which `pnpm build` runs before `next build`, run in the clone. What
  // it prints, git's errors included, goes to stderr.
  const scripts = (JSON.parse(source('package.json')) as { scripts: Record<string, string> }).scripts;
  const unshallow = (cwd: string, extra: Env = {}) => {
    const result = spawnSync(process.execPath, [join(SITE, 'scripts/unshallow.mjs')], {
      cwd,
      encoding: 'utf8',
      env: { ...env, ...extra },
    });
    // It never fails the build: without history, pages go without a date, as before.
    assert.equal(result.status, 0, result.stderr);
    return result.stderr;
  };
  const shallow = (cwd: string) => run(cwd, 'git', ['rev-parse', '--is-shallow-repository']);
  // What the sitemap and the docs pages read, from lib/git.ts run in the clone as `next build` runs.
  const lastModified = (cwd: string) =>
    run(cwd, process.execPath, [
      '--input-type=module',
      '-e',
      `const { lastModified } = await import(${JSON.stringify(pathToFileURL(join(SITE, 'lib/git.ts')).href)});
       process.stdout.write(lastModified('examples/playground/page.md')?.toISOString() ?? 'none');`,
    ]);

  it('runs before next build', () => {
    assert.equal(scripts.unshallow, 'node scripts/unshallow.mjs');
    assert.match(scripts.build ?? '', /^pnpm unshallow && /);
  });

  it('fetches the history on Vercel, so a page not changed lately keeps its date', () => {
    const cwd = clone('on-vercel');
    assert.equal(lastModified(cwd), 'none');
    assert.equal(unshallow(cwd, { VERCEL: '1' }), '');
    assert.equal(shallow(cwd), 'false');
    assert.equal(lastModified(cwd), new Date(OLD).toISOString());
  });

  it('says so in the build log when the clone is still shallow, as one with no remote is', () => {
    const cwd = clone('no-remote');
    run(cwd, 'git', ['remote', 'remove', 'origin']);
    // git fetches nothing here, and git 2.54 prints nothing about it and exits with 0, so the last
    // line of the log is the script's own.
    const log = unshallow(cwd, { VERCEL: '1' });
    assert.equal(shallow(cwd), 'true');
    assert.equal(lastModified(cwd), 'none');
    assert.match(
      log,
      /(^|\n)sitemap dates: the clone is still shallow, .*set VERCEL_DEEP_CLONE=true on the project\n$/,
    );
  });

  it('leaves any other clone as it is: CI and local builds fetch nothing', () => {
    const cwd = clone('elsewhere');
    assert.equal(unshallow(cwd), '');
    assert.equal(shallow(cwd), 'true');
    assert.equal(lastModified(cwd), 'none');
  });
});

describe('hit areas on phones', () => {
  // app/globals.css: on a coarse pointer a positioned `.tap-target` gets a 44 by 44 px hit area.
  const hasTapTarget = (className: string, name: string) => {
    assert.match(className, /(^|\s)tap-target(\s|$)/, name);
    assert.match(className, /(^|\s)relative(\s|$)/, name);
  };

  it('extend the header’s Menu and Ask buttons', () => {
    const menu = tags(source('components/site-header.tsx'), 'button').find((b) => b.text.includes('aria-label="Menu"'));
    const ask = tags(source('components/ask.tsx'), 'button').find((b) => b.text.includes('data-ask-trigger'));
    hasTapTarget(menu?.className ?? '', 'Menu');
    hasTapTarget(ask?.className ?? '', 'Ask');
  });

  it('extend every button in the approval rules demo, Remove too', () => {
    const buttons = tags(source('components/demos/use-approval-policy.tsx'), 'button');
    assert.equal(buttons.length, 3);
    for (const button of buttons) hasTapTarget(button.className, button.text.slice(0, 80));
  });
});

describe('the approval rules demo', () => {
  const demo = source('components/demos/use-approval-policy.tsx');

  it('holds its rules and audit trail in a plain block, not a complementary landmark inside main', () => {
    assert.doesNotMatch(demo, /<aside\b/);
  });

  it('names its cards apart from the ApprovalCard demo’s, which shares the components page', () => {
    const card = /title="([^"]+)"/.exec(source('components/demos/approval-card.tsx'))?.[1];
    const label = /label: '([^']+)'/.exec(demo)?.[1];
    assert.equal(card, 'Run command');
    assert.ok(label, 'the demo gives its tool no label');
    assert.notEqual(label, card);
  });
});
