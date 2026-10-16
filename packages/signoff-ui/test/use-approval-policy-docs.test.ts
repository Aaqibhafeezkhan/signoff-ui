// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateRules, toToolApproval, type ApprovalRule } from '../src/lib/policy';

/*
 * The useApprovalPolicy page says what an argument pattern can and can't do: an allow pattern
 * matches from the value's first character, a deny pattern also reads each command of a line, and
 * neither is a sandbox. Each command the page names is checked against the matcher, so the page
 * changes when the matcher does.
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
const denies = (pattern: string, command: unknown) =>
  evaluateRules(deny(pattern), 'run_command', { command })?.effect === 'deny';
/** The code spans of a stretch of text. */
const codes = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map(([, code]) => code!);

describe('the useApprovalPolicy page: patterns', () => {
  const patterns = section('The patterns');
  const reads = paragraph(patterns, 'A deny rule reads more');
  const caveat = paragraph(patterns, 'Patterns are a convenience, not a sandbox.');
  /** The commands the page says `git push*` misses: the code spans after "but not", up to the sentence's end. */
  const missed = codes(/but not ((?:`[^`]*`|[^.`])*)\./.exec(caveat)?.[1] ?? '');

  it('says a pattern matches from the first character, and is a convenience, not a sandbox', () => {
    expect(patterns).toContain('A pattern matches the whole argument, from its first character.');
    expect(caveat).not.toBe('');
  });

  it('names commands that a `git push*` deny rule really denies, and one it really leaves', () => {
    /** The code spans after "So `git push*` denies", up to ", and not": the commands it says are denied. */
    const denied = codes(/So `git push\*` denies (.*?), and not /.exec(reads)?.[1] ?? '');
    expect(denied).toEqual([
      'git status && git push',
      '/usr/bin/git push',
      'GIT_TRACE=1 git push',
      'env git push',
      'bash -c "git push"',
    ]);
    for (const command of denied) expect(denies('git push*', command), command).toBe(true);
    expect(reads).toContain(', and not `echo git push`.');
    expect(denies('git push*', 'echo git push')).toBe(false);
    expect(reads).toContain('it also denies `git commit -m "wip; git push"`');
    expect(denies('git push*', 'git commit -m "wip; git push"')).toBe(true);
    expect(reads).toContain("`rm*` denies `['rm', '-rf', '~']`");
    expect(denies('rm*', ['rm', '-rf', '~'])).toBe(true);
    expect(reads).toContain('`npm test*` allows neither ` npm test` nor `FOO=1 npm test`');
    const allows = (command: string) =>
      evaluateRules(
        [{ id: 'test', tool: 'run_command', args: { command: 'npm test*' }, effect: 'allow', scope: 'always' }],
        'run_command',
        { command },
      )?.effect === 'allow';
    expect([allows('npm test -- --watch'), allows(' npm test'), allows('FOO=1 npm test')]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('names commands that a `git push*` deny rule really misses', () => {
    expect(caveat).toContain('`git push*` denies `git push origin main`');
    expect(denies('git push*', 'git push origin main')).toBe(true);
    expect(missed).toEqual(['git -C . push', 'git --git-dir=.git push']);
    // When deny rules learn to read these too, this fails: update the page then.
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
    expect(text).toContain('It can approve one their patterns miss, such as `git -C . push` past a `git push*`');
    expect(text).toContain("`otherwise: 'denied'`");
    const server = toToolApproval(deny('git push*'), { otherwise: 'not-applicable' });
    const yours = toToolApproval([{ id: 'all', tool: 'run_command', effect: 'allow', scope: 'session' }]);
    const both = (command: string) => {
      const options = { toolCall: { toolName: 'run_command', input: { command } } };
      const decided = server(options);
      return decided === 'not-applicable' ? yours(options) : decided;
    };
    expect(both('git push origin main')).toMatchObject({ type: 'denied' });
    expect(both('git status && git push')).toMatchObject({ type: 'denied' });
    expect(both('git -C . push')).toMatchObject({ type: 'approved' });
  });
});
