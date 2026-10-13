/*
 * The output grammar (lib/terminal.ts): what each rule colours, and what it leaves alone.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codeKey, tokenizeJson, tokenizeTerminal, tokenizeTerminalLine, type TermLine } from '../lib/terminal';

/** A line as `[kind:text]` pieces, for readable expectations. */
const show = (line: TermLine) => line.map((t) => (t.kind ? `[${t.kind}:${t.text}]` : t.text)).join('');

describe('the output grammar', () => {
  it('dims the prompt and brightens the command', () => {
    assert.equal(
      show(tokenizeTerminalLine('$ pnpm add @upstash/ratelimit')),
      '[prompt:$] [command:pnpm add @upstash/ratelimit]',
    );
    assert.equal(show(tokenizeTerminalLine('❯ pnpm test')), '[prompt:❯] [command:pnpm test]');
  });

  it('colours levels, rule ids, paths and positions in lint output', () => {
    assert.equal(
      show(tokenizeTerminalLine('src/app.tsx:12:5  error  Unknown variant "ghost"  no-unknown-variant')),
      '[path:src/app.tsx:12:5]  [error:error]  Unknown variant [string:"ghost"]  [rule:no-unknown-variant]',
    );
    assert.equal(
      show(tokenizeTerminalLine('  warning  prefer-design-system-component')),
      '  [warn:warning]  [rule:prefer-design-system-component]',
    );
    assert.equal(show(tokenizeTerminalLine('info building')), '[info:info] building');
  });

  it('greens success, and a package manager’s added packages', () => {
    assert.equal(show(tokenizeTerminalLine('✓ 14 passed (14)')), '[ok:✓] 14 [ok:passed] (14)');
    assert.equal(show(tokenizeTerminalLine('Done in 1.8s')), '[ok:Done] in 1.8s');
    assert.equal(
      show(tokenizeTerminalLine('+ @upstash/ratelimit 2.0.6')),
      '[ok:+] [string:@upstash/ratelimit] [path:2.0.6]',
    );
  });

  it('gives Markdown its structure: headings, bold, code, bullets, tables', () => {
    const lines = tokenizeTerminal('## Findings\n- **2 errors** in `app/page.tsx`\n| Rule | Count |\n|---|---|');
    assert.deepEqual(lines.map(show), [
      '[marker:##] [heading:Findings]',
      '[marker:-] [marker:**][strong:2 errors][marker:**] in [marker:`][code:app/page.tsx][marker:`]',
      '[marker:|] Rule [marker:|] Count [marker:|]',
      '[marker:|---|---|]',
    ]);
  });

  it('leaves prose alone: apostrophes, kebab-case words without a level, "done" mid-sentence', () => {
    assert.equal(show(tokenizeTerminalLine("I don't think it's done")), "I don't think it's done");
    assert.equal(show(tokenizeTerminalLine('a rate-limiting check')), 'a rate-limiting check');
  });

  it('keeps every character, in order', () => {
    const text = "ENOENT: no such file, open 'middleware.ts'\n\n$ ls ./lib\n# Title **x**";
    assert.equal(
      tokenizeTerminal(text)
        .map((line) => line.map((t) => t.text).join(''))
        .join('\n'),
      text,
    );
  });

  it('tokenizes a long line quickly (no backtracking)', () => {
    const start = performance.now();
    tokenizeTerminalLine(`${'a'.repeat(4000)} ${'b-'.repeat(2000)}/${'c.'.repeat(2000)}`);
    assert.ok(performance.now() - start < 500);
  });
});

describe('JSON', () => {
  it('splits keys, strings, numbers, literals and punctuation', () => {
    const [line] = tokenizeJson('{"decision": "allow-once", "n": 2, "ok": true, "x": null}');
    assert.deepEqual(
      line!.filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`),
      [
        'punctuation:{',
        'key:"decision"',
        'punctuation::',
        'string:"allow-once"',
        'punctuation:,',
        'key:"n"',
        'punctuation::',
        'number:2',
        'punctuation:,',
        'key:"ok"',
        'punctuation::',
        'literal:true',
        'punctuation:,',
        'key:"x"',
        'punctuation::',
        'literal:null',
        'punctuation:}',
      ],
    );
  });
});

describe('codeKey', () => {
  it('is stable and tells contents apart', () => {
    assert.equal(codeKey('export const a = 1;'), codeKey('export const a = 1;'));
    assert.notEqual(codeKey('export const a = 1;'), codeKey('export const a = 2;'));
  });
});
