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
/** The matcher's source, for the steps each rule starts with and earns for each character it reads. */
const policy = readFileSync(join(root, 'packages/signoff-ui/src/lib/policy.ts'), 'utf8');

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
    expect(reads).toContain(
      'any word after `sudo` or `timeout` may start the command, `sudo grep -rn "git push" docs` too.',
    );
    expect(denies('git push*', 'sudo grep -rn "git push" docs')).toBe(true);
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

  it("says a deny rule's `*` covers every tool name, and an allow rule's leaves an ACP title to a person", () => {
    expect(patterns).toContain(
      "so `*` denies every tool, even one named after an ACP title such as ``Run `ls > out.txt` ``, which an allow rule's `*` leaves to a person.",
    );
    const title = 'Run `ls > out.txt`';
    const any = (effect: 'allow' | 'deny') =>
      evaluateRules([{ id: 'any', tool: '*', effect, scope: 'always' }], title, {})?.effect;
    expect([any('deny'), any('allow')]).toEqual(['deny', undefined]);
  });

  it('says what happens to a rule that stops before it can tell, with the reason it gives', () => {
    const bound = paragraph(patterns, 'Each rule gets ');
    expect(policy).toContain('const RULE_STEPS = 20_000;');
    expect(policy).toContain('const STEPS_PER_CHARACTER = 30;');
    expect(bound).toContain('Each rule gets 20,000 matching steps, and 30 more for each character it reads');
    expect(bound).toContain('That bounds each rule, not a call, whose matching grows with the number of rules');
    expect(bound).toContain('a rule such as `**PRIVATE KEY**` is decided on an argument of any length');
    const reason = /`toToolApproval`'s is "([^"]*)…"/.exec(bound)?.[1];
    expect(reason).toBe('Denied: the arguments are too long to check against a rule: ');
    const slow = `*${'a'.repeat(498)}b`;
    const status = toToolApproval([
      { id: 'slow', tool: 'write_file', args: { content: slow }, effect: 'deny', scope: 'always', reason: 'No keys' },
    ])({ toolCall: { toolName: 'write_file', input: { content: 'a'.repeat(20_000) } } });
    expect(status).toEqual({ type: 'denied', reason: `${reason}write_file with content ${slow}` });
    const key = [
      { id: 'key', tool: 'write_file', args: { content: '**PRIVATE KEY**' }, effect: 'deny', scope: 'always' },
    ] as const satisfies ApprovalRule[];
    expect(evaluateRules(key, 'write_file', { content: 'x'.repeat(1_000_000) })).toBeUndefined();
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

  it("says what bounds a call's matching, and to cap the arguments on a route that takes rules", () => {
    const bound = paragraph(text, 'The route gets whatever the client sent');
    expect(policy).toContain('const STEPS_PER_CHARACTER = 30;');
    expect(bound).toContain('bounded at about 30 steps for each character it reads');
    expect(bound).toContain('grows with the number of rules times the length of its arguments');
    expect(bound).toContain('cap the length of the arguments they read');
    expect(bound).not.toMatch(/however many|can't hold up/);
  });

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
