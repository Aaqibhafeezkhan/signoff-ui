// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/*
 * The websites moved from *-demo.vercel.app to signoff-ui.vercel.app, onsystem.vercel.app and
 * ondocs.vercel.app. The old addresses redirect, but links, metadata and the registry URL use the
 * new ones. Changelogs keep what was published, and the migration guide names the old address on
 * purpose.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const OLD = /(?:design-system-mcp|ask-my-site|agent-ui-kit)-demo\.vercel\.app/;
const KEEP = [/(?:^|\/)CHANGELOG\.md$/, /^examples\/playground\/content\/docs\/migrating-from-agent-ui-kit\.md$/];
const BINARY = /\.(?:png|jpe?g|webp|gif|ico|svg|mp4|webm|woff2?|ttf|pdf)$/i;

it('links to the websites at their current addresses', () => {
  const stale = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !BINARY.test(file) && !KEEP.some((keep) => keep.test(file)))
    .filter((file) => {
      const full = join(root, file);
      return existsSync(full) && OLD.test(readFileSync(full, 'utf8'));
    });
  expect(stale).toEqual([]);
});
