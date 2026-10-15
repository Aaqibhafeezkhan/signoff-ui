/*
 * The home page's first screen (ROADMAP Phase C): what it says, the figures it shows and where
 * they come from, and that nothing on it plays or takes focus by itself. scripts/smoke-playground.mjs
 * checks the same screen in Chrome: the review and the approval in view, no layout shift, the panel.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getGuide, readGuide } from '../lib/docs';
import { getProofFigures } from '../lib/proof';
import { AGENT_SETUP_PROMPT, MCP_DOCS_URL, REFERENCE_APP_COMMAND, SITE_URL } from '../lib/site';

const source = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');
const hero = source('components/hero.tsx');
const frame = source('components/signoff-frame.tsx');
const playground = source('components/playground.tsx');

/** A string constant of the hero, as written in its source. */
function constant(name: string) {
  const value = new RegExp(`export const ${name} =\\s*'([^']*)'`).exec(hero)?.[1];
  assert.ok(value, `components/hero.tsx exports no ${name}`);
  return value;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe('the first screen', () => {
  it('keeps the headline, and says who the kit is for in a 45-word hero', () => {
    const headline = constant('HEADLINE');
    const subLine = constant('SUB_LINE');
    assert.equal(headline, 'Review what your agent changed. Approve what it may do.');
    assert.match(subLine, /^React components for teams putting a coding agent in their own app\./);
    assert.ok(words(headline) + words(subLine) <= 45, `${words(headline) + words(subLine)} words`);
  });

  it('shows the review and the approval with nothing that plays or takes focus', () => {
    // The live frame: real components, still until the reader acts.
    assert.match(frame, /<DiffReview\b/);
    assert.match(frame, /<ApprovalCard\b/);
    assert.match(frame, /command: 'pnpm test'/);
    assert.doesNotMatch(frame, /autoFocus|globalShortcut|setTimeout|setInterval/);
    // The scripted run below waits to be asked: no timer starts it on load.
    assert.doesNotMatch(playground, /setTimeout\(startRun/);
    assert.match(playground, /location\.hash === '#run'/);
    assert.match(hero, /href="#run"/);
  });
});

describe('the proof row', () => {
  it('reads its sizes and the large diff from the limits page, which pnpm size and pnpm perf measure', () => {
    const limits = readGuide(getGuide('limits')!);
    const { sizes, rewriteReady } = getProofFigures();
    assert.match(sizes.min, /^\d+(\.\d)? kB$/);
    assert.match(sizes.max, /^\d+(\.\d)? kB$/);
    assert.ok(Number.parseFloat(sizes.min) < Number.parseFloat(sizes.max));
    for (const size of [sizes.min, sizes.max]) {
      assert.match(limits, new RegExp(`\\|\\s*${size.replace('.', '\\.')} \\|`), size);
    }
    assert.ok(limits.includes('| Full rewrite, 5,000 lines'), 'no 5,000-line rewrite row');
    assert.match(rewriteReady, /^\d+ ms$/);
  });

  it('leaves out the whole main entry, which is not an import an app makes', () => {
    const everything = /\| Everything in the main entry\s*\|\s*([\d.]+ kB) \|/.exec(readGuide(getGuide('limits')!));
    assert.ok(everything, 'no "Everything in the main entry" row');
    assert.notEqual(getProofFigures().sizes.max, everything[1]);
  });

  it('fails the build rather than show a figure the page no longer has', () => {
    assert.throws(() => getProofFigures('## Bundle size\n\n| Import | Gzipped |\n| --- | ---: |\n'), /Bundle size/);
    const sizesOnly =
      '## Bundle size\n\n| Import | Gzipped |\n| --- | ---: |\n| a | 0.4 kB |\n| b | 9.0 kB |\n\n## Large diffs\n';
    assert.throws(() => getProofFigures(sizesOnly), /Full rewrite, 5,000 lines/);
  });
});

describe('the calls to action', () => {
  it('copies the command Getting started gives for the reference app, which needs no API key', () => {
    const guide = readGuide(getGuide('getting-started')!);
    assert.ok(guide.includes(REFERENCE_APP_COMMAND), REFERENCE_APP_COMMAND);
    assert.match(guide.slice(0, guide.indexOf(REFERENCE_APP_COMMAND)), /## Try it without an API key/);
  });

  it('points coding agents to the docs over MCP, on a section the docs have', () => {
    assert.equal(MCP_DOCS_URL, '/docs#use-these-docs-from-your-agent');
    assert.match(readGuide(getGuide('introduction')!), /^## Use these docs from your agent$/m);
    assert.ok(AGENT_SETUP_PROMPT.includes(`${SITE_URL}/llms.txt`));
    assert.ok(AGENT_SETUP_PROMPT.includes(`${SITE_URL}/api/mcp`));
  });
});
