// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * npm enforces an optional peer's range whenever the app has that package, whether or not it imports
 * the entry that needs it, and stops the install with ERESOLVE when the version is out of range. On 0.x
 * a caret takes one minor (`^0.15.0` is 0.15.x only), so every app on another assistant-ui minor, the
 * next one included, couldn't `npm i signoff-ui`. `signoff-ui/assistant-ui` imports only assistant-ui's
 * types, and they compile from 0.15 on (0.14's approval has no `display` or `prompt`).
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const pkg = JSON.parse(read('../package.json')) as {
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const range = pkg.peerDependencies['@assistant-ui/react']!;

type Version = [number, number, number];

const parse = (version: string): Version => {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(version);
  if (!match) throw new Error(`Not a version: ${version}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
};

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** npm's reading of the range forms used here: `||`, `>=`, `<` and `^`, which takes one minor on 0.x. */
function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split('||').some((set) =>
    set
      .trim()
      .split(/\s+/)
      .every((comparator) => {
        const [, op, bound] = /^(\^|>=|<)(.+)$/.exec(comparator) ?? [];
        const b = parse(bound ?? comparator);
        if (op === '>=') return compare(v, b) >= 0;
        if (op === '<') return compare(v, b) < 0;
        if (op === '^') {
          const below: Version = b[0] > 0 ? [b[0] + 1, 0, 0] : b[1] > 0 ? [0, b[1] + 1, 0] : [0, 0, b[2] + 1];
          return compare(v, b) >= 0 && compare(v, below) < 0;
        }
        throw new Error(`Unsupported comparator: ${comparator}`);
      }),
  );
}

describe('the optional @assistant-ui/react peer', () => {
  it('reads ranges as npm does', () => {
    expect(satisfies('0.15.28', '^0.15.0')).toBe(true);
    expect(satisfies('0.16.0', '^0.15.0')).toBe(false);
    expect(satisfies('19.2.0', '^18.2.0 || ^19.0.0')).toBe(true);
    expect(satisfies('20.0.0', '^18.2.0 || ^19.0.0')).toBe(false);
  });

  it('takes every assistant-ui 0.x minor from 0.15 on, so npm installs signoff-ui next to it', () => {
    const tested = pkg.devDependencies['@assistant-ui/react']!.replace(/^\^/, '');
    for (const version of ['0.15.0', tested, '0.15.28', '0.16.0', '0.17.2', '0.99.0'])
      expect(satisfies(version, range), version).toBe(true);
  });

  it('leaves out 0.14, whose types the binding does not compile against, and 1.0', () => {
    for (const version of ['0.14.0', '0.14.9', '1.0.0']) expect(satisfies(version, range), version).toBe(false);
  });

  it('is in the README, with what to do on an older assistant-ui', () => {
    const readme = read('../../../README.md');
    const floor = /^>=(\d+\.\d+)\.0 /.exec(range)?.[1];
    expect(floor).toBeDefined();
    expect(readme).toContain(`needs \`@assistant-ui/react\` ${floor} or later`);
    expect(readme).toContain('--legacy-peer-deps');
  });
});
