/*
 * The code and output colours, in both themes: every colour Shiki's theme pair gives a token
 * (lib/highlight.ts) and every colour of the output grammar (app/globals.css) reads at 4.5:1 or
 * more on the surfaces code sits on, and the CSS copies of the pair's colours match the pair.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CODE_COLORS } from '../lib/highlight';

const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8');

/** `--site-name: light-dark(#light, #dark)` from app/globals.css. */
const tokens = Object.fromEntries(
  [...css.matchAll(/--site-([\w-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/g)].map(
    ([, name = '', light = '', dark = '']) => [name, { light, dark }],
  ),
);

function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = ['light', 'dark'] as const;
// Code blocks, and the page, panels and demo frames that output and inline code sit on.
const SURFACES = ['code', 'ink', 'raised', 'surface', 'surface-2'];
const OUTPUT = Object.keys(tokens).filter((name) => /^(code|term)-/.test(name));

describe('code colours', () => {
  it('reads every token of the output grammar and the CSS copy of the pair', () => {
    assert.deepEqual(OUTPUT.sort(), [
      'code-comment',
      'code-fg',
      'code-fn',
      'code-keyword',
      'code-number',
      'code-property',
      'code-punctuation',
      'code-string',
      'term-error',
      'term-ok',
      'term-warn',
    ]);
    for (const surface of SURFACES) assert.ok(tokens[surface], surface);
  });

  for (const theme of THEMES) {
    it(`keeps Shiki's ${theme} theme at 4.5:1 or more on its own background`, () => {
      const { bg, ...colors } = CODE_COLORS[theme];
      assert.equal(bg, tokens.code?.[theme], 'the theme background is the code surface');
      for (const [name, color] of Object.entries(colors)) {
        const ratio = contrast(color, bg);
        assert.ok(ratio >= 4.5, `${name} ${color} on ${bg}: ${ratio.toFixed(2)}`);
      }
    });

    it(`keeps the output colours at 4.5:1 or more on every surface, ${theme}`, () => {
      for (const name of OUTPUT) {
        for (const surface of SURFACES) {
          const color = tokens[name]![theme];
          const background = tokens[surface]![theme];
          const ratio = contrast(color, background);
          assert.ok(ratio >= 4.5, `${name} ${color} on ${surface} ${background}: ${ratio.toFixed(2)}`);
        }
      }
    });

    it(`colours output like code, ${theme}: the CSS tokens are the pair's colours`, () => {
      for (const name of ['fg', 'keyword', 'string', 'number', 'comment', 'punctuation', 'property', 'fn'] as const) {
        assert.equal(tokens[`code-${name}`]?.[theme], CODE_COLORS[theme][name], name);
      }
    });
  }

  it('gives every output and JSON kind a colour from those tokens', () => {
    for (const kind of [
      'prompt',
      'command',
      'error',
      'warn',
      'info',
      'ok',
      'rule',
      'path',
      'string',
      'heading',
      'strong',
      'code',
      'marker',
    ]) {
      assert.match(css, new RegExp(`\\.term-${kind}\\b[^{]*\\{[^}]*color: var\\(--site-(code|term)-`), kind);
    }
    for (const kind of ['key', 'string', 'number', 'literal', 'punctuation']) {
      assert.match(css, new RegExp(`\\.json-${kind}\\b[^{]*\\{[^}]*color: var\\(--site-code-`), kind);
    }
  });
});
