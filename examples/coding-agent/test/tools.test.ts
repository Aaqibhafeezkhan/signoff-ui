import type { InferUITools } from 'ai';
import type { DiffReviewToolOutput } from 'signoff-ui/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { approvalFor } from '../lib/approval';
import { DEFAULT_LIVE_MODEL, liveModelId } from '../lib/config';
import { PROJECT, type Files } from '../lib/project';
import { proposeFix, proposeRevision } from '../lib/scripted-edits';
import { runCommand } from '../lib/shell';
import { createTools, type AgentTools } from '../lib/tools';
import { applyReview, changesFrom, normalizePath } from '../lib/workspace';

const call = (toolName: string, input: unknown) => ({ toolCall: { toolName, input } });
const command = (value: string) => call('run_command', { command: value });

/** The project with proposed files written as they are. */
const write = (files: Files, proposed: { files: Array<{ path: string; content: string }> }, only?: string[]) => ({
  ...files,
  ...Object.fromEntries(proposed.files.filter((f) => !only || only.includes(f.path)).map((f) => [f.path, f.content])),
});

describe('approval rules on the server', () => {
  it("keeps the server's deny over a person's allow", () => {
    const approve = approvalFor([{ id: 'all', tool: 'run_command', effect: 'allow', scope: 'session' }]);
    expect(approve(command('npm test'))).toMatchObject({ type: 'approved' });
    expect(approve(command('git push -u origin main'))).toMatchObject({
      type: 'denied',
      reason: expect.stringContaining('**git*push**'),
    });
  });

  it("says whose rule decided: the server's or the person's, with the rule and its own reason", () => {
    const approve = approvalFor([
      { id: 't', tool: 'run_command', args: { command: 'npm test*' }, effect: 'allow', scope: 'session' },
      {
        id: 'c',
        tool: 'run_command',
        args: { command: 'curl*' },
        effect: 'deny',
        scope: 'always',
        reason: 'No network',
      },
    ]);
    expect(approve(command('npm test'))).toEqual({
      type: 'approved',
      reason: 'Allowed by your rule: run_command with command npm test*',
    });
    expect(approve(command('curl https://example.com'))).toEqual({
      type: 'denied',
      reason: 'Denied by your rule: run_command with command curl* (No network)',
    });
    expect(approve(command('git push'))).toEqual({
      type: 'denied',
      reason:
        "Denied by the server's rule: run_command with command **git*push** (A person pushes and opens the pull request.)",
    });
  });

  it('asks a person about what no rule covers, with why the tool asks', () => {
    const approve = approvalFor([
      { id: 't', tool: 'run_command', args: { command: 'npm test*' }, effect: 'allow', scope: 'session' },
    ]);
    // A single * never runs past a shell operator.
    expect(approve(command('npm test && rm -rf ~'))).toEqual({
      type: 'user-approval',
      reason: 'Runs a shell command in the repository.',
    });
    expect(approve(call('read_file', { path: 'src/slugify.ts' }))).toEqual({
      type: 'user-approval',
      reason: 'Reads a file in the repository.',
    });
  });

  it('leaves the review alone: the review is the approval', () => {
    expect(approvalFor([])(call('review_changes', { files: [] }))).toBe('not-applicable');
  });
});

describe('the simulated commands', () => {
  it('runs the tests from what the files say', () => {
    expect(runCommand('npm test', PROJECT)).toMatchObject({ exitCode: 0, output: expect.stringContaining('ℹ pass 4') });

    const fixed = write(PROJECT, proposeFix(PROJECT));
    expect(runCommand('npm test', fixed).output).toContain('ℹ pass 5');
    const revised = write(fixed, proposeRevision(fixed));
    expect(runCommand('npm test -- --test-reporter=spec', revised).output).toContain('ℹ pass 6');

    // The new test without the fix it tests fails, as it would.
    const testOnly = write(PROJECT, proposeFix(PROJECT), ['test/slugify.test.ts']);
    const failed = runCommand('npm test', testOnly);
    expect(failed.exitCode).toBe(1);
    expect(failed.output).toContain('✖ strips accents');
    expect(failed.output).toContain("'cr-me-br-l-e' !== 'creme-brulee'");
  });

  it('fails every test when the source calls what it does not define', () => {
    const src = proposeFix(PROJECT).files[0]!.content.replace(/\n\/\*\* "é"[\s\S]*$/, '\n');
    const result = runCommand('npm test', { ...PROJECT, 'src/slugify.ts': src });
    expect(result.output.match(/ReferenceError: stripAccents is not defined/g)).toHaveLength(4);
  });

  it('commits what changed, with a steady hash', () => {
    expect(runCommand('git commit -am "x"', PROJECT)).toMatchObject({ exitCode: 1 });
    const fixed = write(PROJECT, proposeFix(PROJECT));
    const first = runCommand('git commit -am "fix: accents"', fixed);
    expect(first.output).toMatch(
      /^\[fix\/slug-accents [0-9a-f]{7}\] fix: accents\n 3 files changed, 12 insertions\(\+\), 1 deletion\(-\)$/,
    );
    expect(runCommand('git commit -am "fix: accents"', fixed)).toEqual(first);
    expect(runCommand('git diff', fixed).output).toContain('+function stripAccents(text: string): string {');
  });

  it('says what it can run', () => {
    expect(runCommand('curl https://example.com', PROJECT)).toMatchObject({ exitCode: 127 });
  });
});

describe('the workspace', () => {
  it('applies a review, and leaves out a new file that was rejected', () => {
    const files = applyReview(PROJECT, {
      summary: '',
      accepted: 1,
      rejected: 1,
      pending: 0,
      files: [
        { path: './README.md', status: 'modified', decision: 'accepted', content: '# New\n' },
        { path: 'src/new.ts', status: 'added', decision: 'rejected', content: '' },
      ],
      rejectedHunks: [],
      comments: [],
    });
    expect(files['README.md']).toBe('# New\n');
    expect(files['src/new.ts']).toBeUndefined();
    expect(changesFrom(files).map((c) => [c.path, c.status])).toEqual([['README.md', 'modified']]);
    expect(normalizePath(' /src/a.ts')).toBe('src/a.ts');
  });
});

describe('the tools', () => {
  it("give review_changes the review's result as its output, for messages typed from the tools", () => {
    expect(createTools(PROJECT).review_changes.outputSchema).toBeDefined();
    // Checked by tsc (npm run typecheck). Without the outputSchema, InferUITools makes the output
    // undefined, and addToolOutput rejects reviewToolOutput's result.
    expectTypeOf<InferUITools<AgentTools>['review_changes']['output']>().toEqualTypeOf<DiffReviewToolOutput>();
  });
});

describe('live mode', () => {
  it('is on with OPENAI_API_KEY and LIVE_MODE=1, on OPENAI_MODEL or the default', () => {
    expect(liveModelId({})).toBeUndefined();
    expect(liveModelId({ OPENAI_API_KEY: 'k', LIVE_MODE: '1' })).toBe(DEFAULT_LIVE_MODEL);
    expect(liveModelId({ OPENAI_API_KEY: 'k', LIVE_MODE: '1', OPENAI_MODEL: 'gpt-x' })).toBe('gpt-x');
  });

  it('stays off with the key alone, or LIVE_MODE alone', () => {
    expect(liveModelId({ OPENAI_API_KEY: 'k' })).toBeUndefined();
    expect(liveModelId({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-x' })).toBeUndefined();
    expect(liveModelId({ OPENAI_API_KEY: 'k', LIVE_MODE: 'true' })).toBeUndefined();
    expect(liveModelId({ LIVE_MODE: '1' })).toBeUndefined();
    expect(liveModelId({ LIVE_MODE: '1', OPENAI_API_KEY: '' })).toBeUndefined();
  });
});
