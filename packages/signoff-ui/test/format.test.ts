import { describe, expect, it } from 'vitest';
import { formatCost, formatDuration, formatDurationLong, formatTokens, safeStringify } from '../src/lib/format';

describe('formatDuration', () => {
  it.each([
    [0, '0ms'],
    [999.4, '999ms'],
    [999.6, '1.00s'],
    [1_234, '1.23s'],
    [9_994, '9.99s'],
    [9_996, '10.0s'],
    [59_940, '59.9s'],
    [59_960, '1m 00s'],
    [61_000, '1m 01s'],
    [119_600, '2m 00s'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it('never rounds up into a value its unit cannot show', () => {
    for (let ms = 0; ms < 130_000; ms += 0.5) {
      expect(formatDuration(ms)).not.toMatch(/^1000ms$|^10\.00s$|^60\.0s$|m 60s$/);
    }
  });
});

describe('formatDurationLong', () => {
  it.each([
    [999.6, '1.0 seconds'],
    [59_960, '1 minute 0 seconds'],
    [119_600, '2 minutes 0 seconds'],
    [125_000, '2 minutes 5 seconds'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatDurationLong(ms)).toBe(text);
  });
});

describe('formatTokens', () => {
  it.each([
    [999.4, '999'],
    [999.6, '1.00k'],
    [9_994, '9.99k'],
    [9_999.5, '10.0k'],
    [999_940, '999.9k'],
    [999_950, '1.00M'],
    [-999.6, '-1.00k'],
  ])('%d -> %s', (n, text) => {
    expect(formatTokens(n)).toBe(text);
  });

  it('never rounds up into a value its unit cannot show', () => {
    for (const base of [1_000, 10_000, 1_000_000]) {
      for (let n = base - 60; n < base + 60; n += 0.25) {
        expect(formatTokens(n)).not.toMatch(/^1000$|^10\.00k$|^1000\.0k$/);
      }
    }
  });
});

describe('formatCost', () => {
  it.each([
    [0, '$0.00'],
    [0.0099, '$0.0099'],
    [0.009996, '$0.010'],
    [0.0123, '$0.012'],
    [0.9994, '$0.999'],
    [0.9996, '$1.00'],
    [12.5, '$12.50'],
  ])('%d -> %s', (usd, text) => {
    expect(formatCost(usd)).toBe(text);
  });

  it('prints 4 decimals below $0.01, 3 below $1 and 2 above, judged by the printed value', () => {
    const values: number[] = [];
    for (const edge of [0.01, 1]) for (let k = -200; k <= 200; k++) values.push(edge + k * edge * 1e-5);
    for (let usd = 0.0001; usd < 3; usd *= 1.003) values.push(usd);
    for (const usd of values) {
      const text = formatCost(usd);
      const [, digits = ''] = /^\$\d+\.(\d+)$/.exec(text) ?? [];
      const printed = Number(text.slice(1));
      const expected = printed < 0.01 ? 4 : printed < 1 ? 3 : 2;
      expect({ usd, text, decimals: digits.length }).toEqual({ usd, text, decimals: expected });
      expect(Math.abs(printed - usd)).toBeLessThanOrEqual(0.5 * 10 ** -expected + 1e-12);
    }
  });
});

describe('safeStringify', () => {
  it('writes out an object that comes twice, side by side, each time', () => {
    const env = { NODE_ENV: 'production' };
    expect(JSON.parse(safeStringify({ build: { env }, test: { env } }))).toEqual({
      build: { env: { NODE_ENV: 'production' } },
      test: { env: { NODE_ENV: 'production' } },
    });
    const files = ['a.ts', 'b.ts'];
    expect(safeStringify([files, files], 0)).toBe('[["a.ts","b.ts"],["a.ts","b.ts"]]');
  });

  it('writes an object inside itself as [Circular], however deep', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    node.child = { parent: node, list: [node] };
    expect(safeStringify(node, 0)).toBe(
      '{"name":"root","self":"[Circular]","child":{"parent":"[Circular]","list":["[Circular]"]}}',
    );
    // A cycle beside a shared object: each is what it is.
    const shared = { id: 1 };
    const loop: unknown[] = [shared];
    loop.push(loop, shared);
    expect(safeStringify(loop, 0)).toBe('[{"id":1},"[Circular]",{"id":1}]');
  });

  it('writes bigints, strings and undefined, and falls back to String for what JSON cannot write', () => {
    expect(safeStringify({ size: 10n }, 0)).toBe('{"size":"10n"}');
    expect(safeStringify('a "b"')).toBe('"a \\"b\\""');
    expect(safeStringify(undefined)).toBe('undefined');
    expect(safeStringify(() => 1)).toBe('() => 1');
    const broken = {
      toJSON() {
        throw new Error('no');
      },
      toString: () => 'broken',
    };
    expect(safeStringify(broken)).toBe('broken');
  });
});
