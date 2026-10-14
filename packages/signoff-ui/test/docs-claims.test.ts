// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toToolApproval, type ApprovalRule } from '../src/lib/policy';

/*
 * What the docs claim about the kit, and about the libraries they compare it with, checked against
 * the code and the changelog where they can be, so a claim can't outlive the behaviour behind it.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const doc = (page: string) => readFileSync(join(root, 'examples/playground/content/docs', `${page}.md`), 'utf8');

/** A page's section, from its `## ` heading to the next one. */
function section(markdown: string, heading: string) {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

/** A bulleted item, from its bold lead to the end of its line. */
const item = (markdown: string, lead: string) =>
  markdown.split('\n').find((line) => line.startsWith(`- **${lead}`)) ?? '';

const limits = doc('limits');
const comparison = doc('comparison');
const accessibility = doc('accessibility');

describe("Performance and limits: What's next", () => {
  const next = section(limits, "What's next");

  it('keeps its heading, which the feature request form links to as the roadmap', () => {
    const form = readFileSync(join(root, '.github/ISSUE_TEMPLATE/feature_request.yml'), 'utf8');
    expect(form).toContain('signoff-ui.vercel.app/docs/limits#whats-next');
    expect(next).not.toBe('');
  });

  it('lists no work that has shipped: sub-agents nest in the timeline since 0.7.0', () => {
    const changelog = readFileSync(join(root, 'packages/signoff-ui/CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('Sub-agents nest in the timeline.');
    expect(next).not.toMatch(/sub-agent/i);
  });
});

describe('Performance and limits: rules', () => {
  const limitations = section(limits, 'Known limitations');

  it("calls a client's rules a person's grants on top of the server's policy", () => {
    expect(item(limitations, 'Rules from the client.')).toContain("a person's grants on top of your server policy");
  });

  const noPush: ApprovalRule[] = [
    { id: 'no-push', tool: 'run_command', args: { command: 'git push*' }, effect: 'deny', scope: 'always' },
  ];
  /** The server's answer with only that deny rule: a call it doesn't cover goes on to the person's rules. */
  const deny = (command: string) =>
    toToolApproval(noPush, { otherwise: 'not-applicable' })({
      toolCall: { toolName: 'run_command', input: { command } },
    });

  it('says patterns are a convenience, not a sandbox, with commands a deny pattern misses that it really misses', () => {
    const bullet = item(limitations, 'Patterns are a convenience, not a sandbox.');
    expect(bullet).toContain('`git push*`');
    expect(deny('git push origin main')).toMatchObject({ type: 'denied' });
    const missed = ['git status && git push', '/usr/bin/git push', 'GIT_TRACE=1 git push'];
    for (const command of missed) {
      expect(bullet, command).toContain(`\`${command}\``);
      // When deny rules learn to read each command of a line, this fails: update the bullet then.
      expect(deny(command), command).toBe('not-applicable');
    }
  });

  it("shows a server allowlist that does deny those commands (`otherwise: 'denied'`)", () => {
    const bullet = item(limitations, 'Patterns are a convenience, not a sandbox.');
    expect(bullet).toContain("{ otherwise: 'denied' }");
    const allowed: ApprovalRule[] = [
      { id: 'status', tool: 'run_command', args: { command: 'git status*' }, effect: 'allow', scope: 'always' },
    ];
    const server = toToolApproval(allowed, { otherwise: 'denied' });
    const run = (command: string) => server({ toolCall: { toolName: 'run_command', input: { command } } });
    expect(run('git status --short')).toMatchObject({ type: 'approved' });
    for (const command of ['git status && git push', '/usr/bin/git push', 'GIT_TRACE=1 git push'])
      expect(run(command), command).toBe('denied');
  });
});

describe('Comparison', () => {
  it("gives assistant-ui's release cadence as measured: several stable releases a month, not near daily", () => {
    const theirs = item(section(comparison, 'What they do better'), 'assistant-ui');
    expect(theirs).not.toMatch(/near[- ]daily/i);
    expect(theirs).toContain('several releases a month');
  });

  it('says sub-agents nest, as the timeline does since 0.7.0', () => {
    expect(comparison).toContain('Sub-agents nest under the call that started them.');
    expect(comparison).not.toMatch(/\bflat\b/i);
  });
});

describe('Accessibility: focus', () => {
  const focus = section(accessibility, 'Focus is managed');

  it("doesn't promise focus is never lost: ToolApprovalBatch leaves the page once it has answered", () => {
    expect(focus).not.toBe('');
    expect(accessibility).not.toMatch(/never lost/i);
    expect(focus).toMatch(/`ToolApprovalBatch`[^.]*takes focus with it|takes focus with it[^.]*`ToolApprovalBatch`/);
  });

  it("doesn't call the review one tab stop: each hunk's buttons and each file's controls are in the Tab order", () => {
    expect(accessibility).not.toMatch(/review is one tab stop/i);
    expect(focus).toMatch(/each hunk's buttons and each file's controls[^.]*Tab order/);
  });

  it('ties the check to CI failing on a violation, not to a result on a given day', () => {
    const tested = section(accessibility, "How it's tested");
    expect(tested).not.toMatch(/currently report/i);
    expect(tested).toContain('a violation in either fails it');
  });
});
