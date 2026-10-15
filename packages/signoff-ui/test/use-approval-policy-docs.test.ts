// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateRules, toToolApproval, type ApprovalRule } from '../src/lib/policy';

/*
 * The useApprovalPolicy page says what an argument pattern can't do: it matches from the value's
 * first character, so a deny rule is a convenience, not a sandbox. Each command the page names is
 * checked against the matcher, so the page changes when deny rules learn to read each command of a
 * line.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const page = readFileSync(join(root, 'examples/playground/content/components/use-approval-policy.md'), 'utf8');

/** A `###` section, from its heading to the next heading. */
function section(heading: string) {
  const start = page.indexOf(`\n### ${heading}\n`);
  expect(start, `a "### ${heading}" section`).toBeGreaterThan(-1);
  const end = page.indexOf('\n### ', start + 1);
  return page.slice(start, end === -1 ? undefined : end);
}

/** The paragraph of a section that starts with `lead`. */
const paragraph = (text: string, lead: string) => text.split('\n\n').find((p) => p.trimStart().startsWith(lead)) ?? '';

const deny = (pattern: string): ApprovalRule[] => [
  { id: 'deny', tool: 'run_command', args: { command: pattern }, effect: 'deny', scope: 'always' },
];
const denies = (pattern: string, command: string) =>
  evaluateRules(deny(pattern), 'run_command', { command })?.effect === 'deny';

describe('the useApprovalPolicy page: patterns', () => {
  const patterns = section('The patterns');
  const caveat = paragraph(patterns, 'Patterns are a convenience, not a sandbox.');
  /** The commands the page says `git push*` misses: the code spans after "but not". */
  const missed = [...(/but not ([^.]*)\./.exec(caveat)?.[1] ?? '').matchAll(/`([^`]+)`/g)].map(([, code]) => code!);

  it('says a pattern matches from the first character, and is a convenience, not a sandbox', () => {
    expect(patterns).toContain('A pattern matches the whole argument, from its first character.');
    expect(caveat).not.toBe('');
  });

  it('names commands that a `git push*` deny rule really misses', () => {
    expect(caveat).toContain('`git push*` denies `git push origin main`');
    expect(denies('git push*', 'git push origin main')).toBe(true);
    expect(missed).toEqual(['git status && git push', '/usr/bin/git push', 'GIT_TRACE=1 git push']);
    // When deny rules learn to read each command of a line, this fails: update the page then.
    for (const command of missed) expect(denies('git push*', command), command).toBe(false);
  });

  it('gives a pattern that denies those too', () => {
    expect(caveat).toContain('`**git*push**` denies those too');
    for (const command of missed) expect(denies('**git*push**', command), command).toBe(true);
  });

  it("protects other people with a server allowlist (`otherwise: 'denied'`) or a real shell parser", () => {
    expect(caveat).toContain("toToolApproval(allowed, { otherwise: 'denied' })");
    expect(caveat).toContain('a real shell parser');
    const allowed: ApprovalRule[] = [
      { id: 'status', tool: 'run_command', args: { command: 'git status*' }, effect: 'allow', scope: 'always' },
    ];
    const server = toToolApproval(allowed, { otherwise: 'denied' });
    const run = (command: string) => server({ toolCall: { toolName: 'run_command', input: { command } } });
    expect(run('git status --short')).toMatchObject({ type: 'approved' });
    for (const command of missed) expect(run(command), command).toBe('denied');
  });
});

describe("the useApprovalPolicy page: the server's rules win", () => {
  const text = section("The server's rules win");

  it("says a client's rule can approve a call the server's deny patterns miss, as it does", () => {
    expect(text).toContain(
      'It can approve one their patterns miss, such as `git status && git push` past a `git push*`',
    );
    expect(text).toContain("`otherwise: 'denied'`");
    const server = toToolApproval(deny('git push*'), { otherwise: 'not-applicable' });
    const yours = toToolApproval([{ id: 'all', tool: 'run_command', effect: 'allow', scope: 'session' }]);
    const both = (command: string) => {
      const options = { toolCall: { toolName: 'run_command', input: { command } } };
      const decided = server(options);
      return decided === 'not-applicable' ? yours(options) : decided;
    };
    expect(both('git push origin main')).toMatchObject({ type: 'denied' });
    expect(both('git status && git push')).toMatchObject({ type: 'approved' });
  });
});
