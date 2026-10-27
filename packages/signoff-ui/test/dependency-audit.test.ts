// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/* pnpm 12 writes pnpm-lock.yaml as two YAML documents, and GitHub's dependency graph reads only the
   first, which holds pnpm's own packages: Dependabot can't alert on anything this repository or its
   site installs. `pnpm audit` takes its place, on every pull request for the production
   dependencies, and daily for the whole tree. The advisories it skips are in pnpm-workspace.yaml,
   each with the reason. */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
}

interface Job {
  if?: string;
  steps: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job | undefined>;
}

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
/** A workflow, or one with no triggers and no jobs when the file is missing. */
const workflow = (path: string): Workflow =>
  existsSync(join(root, path)) ? (parse(read(path)) as Workflow) : { on: {}, jobs: {} };
/** The commands of a job's steps that run `pnpm audit`. */
const audits = (job: Job | undefined) =>
  (job?.steps ?? []).map((step) => step.run ?? '').filter((run) => /\bpnpm audit\b/.test(run));

describe('pnpm audit on every pull request', () => {
  const main = workflow('.github/workflows/ci.yml').jobs.ci;

  it('fails the main CI job on a moderate or worse advisory in a production dependency', () => {
    expect(main?.if).toBe("github.event_name != 'schedule'");
    expect(audits(main)).toEqual(['pnpm audit --prod --audit-level=moderate']);
  });
});

describe('pnpm audit daily, over the whole tree', () => {
  const audit = workflow('.github/workflows/audit.yml');

  it('is a workflow of its own', () => {
    expect(existsSync(join(root, '.github/workflows/audit.yml'))).toBe(true);
  });

  it('runs daily, by hand, and on a pull request that changes the lockfile or the audit settings', () => {
    expect(audit.on.schedule).toEqual([{ cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/) }]);
    expect(audit.on).toHaveProperty('workflow_dispatch');
    expect(audit.on.pull_request).toEqual({
      paths: ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.github/workflows/audit.yml'],
    });
  });

  it('can only read the repository', () => {
    expect(audit.permissions).toEqual({ contents: 'read' });
  });

  it('audits the dev and the production dependencies, at every severity', () => {
    expect(Object.values(audit.jobs).flatMap(audits)).toEqual(['pnpm audit']);
  });
});

describe('the advisories pnpm audit skips', () => {
  const source = read('pnpm-workspace.yaml');
  const lines = source.split('\n');
  const { auditConfig } = parse(source) as { auditConfig?: { ignoreGhsas?: string[] } };

  it('each come with a comment that says why', () => {
    for (const id of auditConfig?.ignoreGhsas ?? []) {
      expect(id).toMatch(/^GHSA(?:-[2-9cfghjmpqrvwx]{4}){3}$/);
      const line = lines.findIndex((text) => text.trim() === `- ${id}`);
      expect(lines[line - 1]?.trim(), id).toMatch(/^# /);
    }
  });
});
