import { evaluateRules } from 'signoff-ui/core';
import { describe, expect, it } from 'vitest';
import { approvalFor } from '../lib/approval';
import { DEFAULT_RULES, SERVER_RULES } from '../lib/rules';

/** What the server's rules alone say about a command: `deny`, or nothing. */
const server = (command: string) => evaluateRules(SERVER_RULES, 'run_command', { command })?.effect;

describe("the server's rule against pushing", () => {
  // A deny pattern matches from the argument's first character: `git push*` misses each of these
  // but the first two.
  it.each([
    'git push',
    'git push -u origin main',
    'git status && git push',
    'git commit -am "wip"; git push origin main',
    ' git push',
    '/usr/bin/git push',
    'GIT_TRACE=1 git push',
    'env git push',
    'git -C . push',
    'git  push origin main',
    'git push --force | cat',
    'git push $(git remote)',
  ])('denies `%s`', (command) => {
    expect(server(command)).toBe('deny');
  });

  it.each(['git status', 'git diff', 'npm test', 'git status && npm test', 'echo push; git status'])(
    'leaves `%s` to the other rules',
    (command) => {
      expect(server(command)).toBeUndefined();
    },
  );

  it("leaves the scripted run's commit to the default rule", () => {
    const commit = 'git commit -am "fix: keep the base letter of accented characters"';
    expect(server(commit)).toBeUndefined();
    expect(evaluateRules(DEFAULT_RULES, 'run_command', { command: commit })?.effect).toBe('allow');
  });

  it('denies a chained push that a rule from the page allows', () => {
    const approve = approvalFor([{ id: 'all', tool: 'run_command', effect: 'allow', scope: 'session' }]);
    expect(approve({ toolCall: { toolName: 'run_command', input: { command: 'git status && git push' } } })).toEqual({
      type: 'denied',
      reason:
        "Denied by the server's rule: run_command with command **git*push** (A person pushes and opens the pull request.)",
    });
  });
});
