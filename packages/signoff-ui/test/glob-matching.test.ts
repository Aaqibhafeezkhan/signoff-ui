// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateRules, globToRegExp, matchesGlob, toToolApproval, type ApprovalRule } from '../src/lib/policy';

/*
 * matchesGlob reads the value once, keeping the places in the pattern that match so far. It used to
 * test the RegExp from globToRegExp, which backtracks: with a few `*`, a long value that doesn't
 * match took seconds, and each `*` more multiplied it (#88). On values short enough for the old
 * matcher to finish, the two must agree, and globToRegExp must still build the same RegExp.
 */

/* The matcher before #88, as it was: a RegExp per pattern, tested on the value. */
const SHELL_CONTROL = ';&|`<>\r\n';
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
function oldGlobToRegExp(pattern: string): RegExp {
  const safe = `(?:(?!\\$\\()[^${escapeRegExp(SHELL_CONTROL)}])`;
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '\\' && i + 1 < pattern.length) {
      source += escapeRegExp(pattern[++i]!);
    } else if (char === '*' && pattern[i + 1] === '*') {
      source += '[\\s\\S]*';
      while (pattern[i + 1] === '*') i++;
    } else if (char === '*') {
      source += `${safe}*`;
    } else if (char === '?') {
      source += safe;
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

/** A seeded generator (mulberry32), so the corpus is the same on every run. */
function generator(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Plain characters, every shell control character, `$(` and its halves, the glob characters
// themselves, a backslash, a line separator and both halves of an emoji's surrogate pair.
const CHARACTERS = [
  'a',
  'b',
  'a',
  'b',
  ' ',
  '.',
  '/',
  '-',
  ';',
  '&',
  '|',
  '`',
  '<',
  '>',
  '\r',
  '\n',
  '$',
  '(',
  ')',
  '$(',
  '{',
  '*',
  '?',
  '\\',
  '\u2028',
  'é',
  '😀',
  '\ud83d',
];
// What a pattern is made of: wildcards, escapes (a trailing `\` is a literal backslash) and characters.
const PIECES = [
  '*',
  '*',
  '**',
  '***',
  '?',
  '\\*',
  '\\?',
  '\\\\',
  '\\',
  '\\a',
  ...CHARACTERS.filter((c) => c !== '*' && c !== '?' && c !== '\\'),
];

function corpus(count: number) {
  const random = generator(88);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const text = (max: number) =>
    Array.from({ length: Math.floor(random() * (max + 1)) }, () => pick(CHARACTERS)).join('');
  const cases: Array<[pattern: string, value: string]> = [];
  for (let n = 0; n < count; n++) {
    const pieces = Array.from({ length: Math.floor(random() * 7) }, () => pick(PIECES));
    const pattern = pieces.join('');
    // Values made from the pattern, so many match, and some that are only near it or random.
    for (let v = 0; v < 12; v++) {
      let value = pieces
        .map((piece) =>
          piece.startsWith('**')
            ? text(4)
            : piece === '*'
              ? text(3)
              : piece === '?'
                ? pick(CHARACTERS)
                : piece.length > 1
                  ? piece[1]
                  : piece,
        )
        .join('');
      if (v % 3 === 1 && value) {
        const at = Math.floor(random() * value.length);
        value = value.slice(0, at) + pick(CHARACTERS) + value.slice(at + 1);
      }
      if (v % 4 === 3) value = text(10);
      cases.push([pattern, value]);
    }
  }
  return cases;
}

describe('matchesGlob and the matcher it replaced', () => {
  it('give the same answer on every pattern and value of a generated corpus', () => {
    const cases = corpus(5000);
    const differ = cases.filter(
      ([pattern, value]) => matchesGlob(value, pattern) !== oldGlobToRegExp(pattern).test(value),
    );
    expect(differ).toEqual([]);
    // globToRegExp, kept for callers that want a RegExp, builds the same one as before.
    const patterns = [...new Set(cases.map(([pattern]) => pattern))];
    expect(patterns.filter((pattern) => globToRegExp(pattern).source !== oldGlobToRegExp(pattern).source)).toEqual([]);
    // The corpus holds both answers in numbers, and every kind of wildcard and escape.
    const matched = cases.filter(([pattern, value]) => matchesGlob(value, pattern)).length;
    expect({ matched: matched > cases.length / 4, unmatched: cases.length - matched > cases.length / 4 }).toEqual({
      matched: true,
      unmatched: true,
    });
  });

  it.each([
    ['echo *', 'echo $(whoami)', false],
    ['echo $*', 'echo $(whoami)', true],
    ['echo *(*', 'echo $(whoami)', false],
    ['echo **(*', 'echo $(whoami)', true],
    ['echo ?(x)', 'echo $(x)', false],
    ['echo *', 'echo a$', true],
    ['a*', 'a\u2028b', true],
    ['?', '😀', false],
    ['??', '😀', true],
    ['\\', '\\', true],
    ['a\\', 'a', false],
    ['***', 'a;b', true],
    ['*\\**', 'a*b', true],
  ])('%j against %j: %s, as before', (pattern, value, expected) => {
    expect(matchesGlob(value, pattern)).toBe(expected);
    expect(oldGlobToRegExp(pattern).test(value)).toBe(expected);
  });
});

describe('matching time', () => {
  // A value of only `a`s, which none of these patterns match: the RegExp's worst case (#88).
  const value = 'a'.repeat(10_000);
  const patterns = ['*a*a*b', '**a**a**b', '*a*a*a*b'];

  it.each(patterns)('%s on 10,000 characters takes under 50 ms', (pattern) => {
    const start = performance.now();
    expect(matchesGlob(value, pattern)).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it.each(patterns)('%s as an argument pattern, on the server and on the page, takes under 50 ms', (pattern) => {
    const rules: ApprovalRule[] = [
      { id: 'r', tool: 'run_command', args: { command: pattern }, effect: 'deny', scope: 'always' },
    ];
    const call = { toolName: 'run_command', input: { command: value } };
    const start = performance.now();
    expect(toToolApproval(rules)({ toolCall: call })).toBe('user-approval');
    expect(evaluateRules(rules, call.toolName, call.input)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('still matches a long value that does match', () => {
    const start = performance.now();
    expect(matchesGlob(`${value}b`, '*a*a*a*b')).toBe(true);
    expect(matchesGlob(`npm test ${value}`, 'npm test*')).toBe(true);
    expect(matchesGlob(`npm test ${value}; rm -rf ~`, 'npm test*')).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
