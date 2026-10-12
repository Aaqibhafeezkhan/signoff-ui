'use client';

import {
  describeRule,
  DiffReview,
  evaluateRules,
  getToolPartName,
  getToolParts,
  parseFileChange,
  toPatch,
  type ApprovalDecision,
  type ApprovalPolicy,
  type ApprovalRule,
  type HunkDecision,
} from 'signoff-ui';
import { useMemo, useState } from 'react';
import { BRANCH, listPaths, PROJECT, type Files } from '@/lib/project';
import { DEFAULT_RULES, SERVER_RULES } from '@/lib/rules';
import type { RunMessage } from '@/lib/types';
import { changesFrom } from '@/lib/workspace';
import { BanIcon, CheckIcon, CloseIcon, LockIcon } from './icons';
import { TOOL_META } from './tool-meta';

/* The side panels: the approval rules, every decision made in the run, and the project's files. */

function RuleItem({ rule, onRemove }: { rule: ApprovalRule; onRemove?: () => void }) {
  const text = describeRule(rule);
  return (
    <li className="rule" data-effect={rule.effect}>
      <span className="rule-effect">{rule.effect === 'allow' ? 'Allow' : 'Deny'}</span>
      <span className="rule-body">
        <code className="rule-text">{text}</code>
        <span className="rule-meta">
          {rule.scope === 'session' ? 'This session' : 'Always'}
          {rule.reason ? ` · ${rule.reason}` : ''}
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          className="icon-button icon-button-small"
          aria-label={`Remove the rule: ${rule.effect} ${text}`}
          onClick={onRemove}
        >
          <CloseIcon width={14} height={14} />
        </button>
      )}
    </li>
  );
}

export function RulesPanel({ policy }: { policy: ApprovalPolicy }) {
  const hasSession = policy.rules.some((rule) => rule.scope === 'session');
  const reset = () => {
    for (const rule of policy.rules) policy.removeRule(rule.id);
    for (const rule of DEFAULT_RULES) policy.addRule({ ...rule });
  };
  return (
    <section className="panel" aria-labelledby="rules-heading">
      <h2 id="rules-heading" className="panel-title">
        Approval rules
      </h2>
      <p className="panel-note">
        Checked on the server before anyone is asked. Deny wins over allow. Approve “For this session” or “Always” on a
        card to add one.
      </p>
      <h3 className="rules-group">
        <LockIcon width={13} height={13} />
        On the server
      </h3>
      <ul className="rules">
        {SERVER_RULES.map((rule) => (
          <RuleItem key={rule.id} rule={rule} />
        ))}
      </ul>
      <h3 className="rules-group">Yours, kept in this browser</h3>
      {policy.ready &&
        (policy.rules.length > 0 ? (
          <ul className="rules">
            {policy.rules.map((rule) => (
              <RuleItem key={rule.id} rule={rule} onRemove={() => policy.removeRule(rule.id)} />
            ))}
          </ul>
        ) : (
          <p className="panel-note">None: every read and command asks you.</p>
        ))}
      <div className="panel-actions">
        <button type="button" className="button button-small" onClick={policy.clearSession} disabled={!hasSession}>
          Clear session rules
        </button>
        <button type="button" className="button button-small" onClick={reset}>
          Reset
        </button>
      </div>
    </section>
  );
}

const SCOPE: Record<ApprovalDecision, string> = {
  'allow-once': 'once',
  'allow-session': 'for this session',
  'allow-always': 'always',
  'deny-once': 'once',
  'deny-always': 'always',
};

interface Decision {
  id: string;
  label: string;
  summary: string | undefined;
  approved: boolean;
  by: string;
  note: string | undefined;
}

/** Every approval in the run, newest first: who or which rule decided, and why. */
export function decisionsFrom(messages: readonly RunMessage[], policy: ApprovalPolicy): Decision[] {
  return messages
    .flatMap((message) => getToolParts(message.parts))
    .flatMap((part): Decision[] => {
      const approval = part.approval as
        { id: string; approved?: boolean; reason?: string; isAutomatic?: boolean } | undefined;
      if (!approval || approval.approved === undefined) return [];
      const name = getToolPartName(part);
      const input = part.input as Record<string, unknown> | undefined;
      const summary = typeof input?.command === 'string' ? input.command : (input?.path as string | undefined);
      const base = { id: approval.id, label: TOOL_META[name]?.label ?? name, summary, approved: approval.approved };
      if (approval.isAutomatic) {
        const server = evaluateRules(SERVER_RULES, name, part.input);
        const yours = server ? undefined : evaluateRules(policy.rules, name, part.input);
        const rule = server?.rule ?? yours?.rule;
        const verb = approval.approved ? 'Allowed' : 'Denied';
        return [
          {
            ...base,
            by: server ? `${verb} by the server's rule` : `${verb} by your rule`,
            note: rule ? describeRule(rule) : approval.reason,
          },
        ];
      }
      const decision = policy.outcomeOf(approval.id)?.decision;
      return [
        {
          ...base,
          by: `You ${approval.approved ? 'approved' : 'denied'}${decision ? ` ${SCOPE[decision]}` : ''}`,
          note: approval.reason,
        },
      ];
    })
    .reverse();
}

export function DecisionsPanel({ decisions }: { decisions: Decision[] }) {
  return (
    <section className="panel" aria-labelledby="decisions-heading">
      <h2 id="decisions-heading" className="panel-title">
        Decisions
      </h2>
      {decisions.length === 0 ? (
        <p className="panel-note">Each call the agent makes is decided here, by a rule or by you.</p>
      ) : (
        <ol className="decisions" aria-label="Newest first">
          {decisions.map((d) => (
            <li key={d.id} className="decision" data-approved={d.approved}>
              {d.approved ? (
                <CheckIcon className="decision-icon" width={14} height={14} />
              ) : (
                <BanIcon className="decision-icon" width={14} height={14} />
              )}
              <span className="decision-body">
                <span className="decision-call">
                  {d.label}
                  {d.summary && <code> {d.summary}</code>}
                </span>
                <span className="decision-by">
                  {d.by}
                  {d.note ? ` · ${d.note}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function stats(path: string, files: Files) {
  const { additions, deletions } = parseFileChange({
    path,
    oldContent: PROJECT[path],
    newContent: files[path],
  });
  return `+${additions} −${deletions}`;
}

export function FilesPanel({ files }: { files: Files }) {
  return (
    <section className="panel" aria-labelledby="files-heading">
      <h2 id="files-heading" className="panel-title">
        Files on <span className="mono">{BRANCH}</span>
      </h2>
      <ul className="files">
        {listPaths(files).map((path) => {
          const status = PROJECT[path] === undefined ? 'added' : PROJECT[path] === files[path] ? undefined : 'modified';
          return (
            <li key={path} data-status={status}>
              <span className="mono">{path}</span>
              {status && (
                <span className="file-stats">
                  <span className="sr-only">{status}, </span>
                  {stats(path, files)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** At the end of a run: everything it changed, as a review to read and a patch to copy. */
export function ChangesCard({ files }: { files: Files }) {
  const changes = useMemo(() => changesFrom(files), [files]);
  const { decisions, patch } = useMemo(() => {
    const parsed = changes.map((change) => parseFileChange(change));
    const all: Record<string, HunkDecision> = {};
    for (const file of parsed) for (const hunk of file.hunks) all[hunk.id] = 'accepted';
    return { decisions: all, patch: toPatch(parsed, all) };
  }, [changes]);
  const [copied, setCopied] = useState<'copied' | 'failed' | undefined>();
  if (changes.length === 0) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(patch);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <section className="panel changes" aria-labelledby="changes-heading">
      <h2 id="changes-heading" className="changes-title">
        What the run changed on <span className="mono">{BRANCH}</span>
      </h2>
      <DiffReview
        files={changes}
        readOnly
        defaultDecisions={decisions}
        title="Changes since main"
        // In the review's header, next to the layout toggle.
        actions={
          <>
            <button type="button" className="button button-small" onClick={copy}>
              Copy as a patch
            </button>
            {copied && (
              <span className="copy-note" aria-hidden="true">
                {copied === 'copied' ? 'Copied: git apply reads it.' : 'The browser blocked copying.'}
              </span>
            )}
            <span className="sr-only" role="status">
              {copied === 'copied' ? 'Patch copied' : copied === 'failed' ? 'Copying was blocked by the browser' : ''}
            </span>
          </>
        }
      />
    </section>
  );
}
