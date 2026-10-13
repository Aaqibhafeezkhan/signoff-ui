'use client';

import { ApprovalCard, APPROVAL_DECISIONS, type ApprovalChoice } from 'signoff-ui';
import { useState } from 'react';
import { JsonBlock } from '../terminal';

export function ApprovalCardDemo() {
  const [choice, setChoice] = useState<ApprovalChoice>();
  const status = !choice ? 'pending' : choice.decision.startsWith('allow') ? 'approved' : 'denied';
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <ApprovalCard
        toolName="run_command"
        title="Run command"
        description="Installs a package from the npm registry and updates package.json and pnpm-lock.yaml."
        input={{ command: 'pnpm add @upstash/ratelimit', cwd: '~/acme/chat-app' }}
        risk="high"
        status={status}
        reason={choice?.reason}
        decision={choice?.decision}
        // Once, for this session or always, the arguments editable first.
        decisions={APPROVAL_DECISIONS}
        editable
        onDecide={setChoice}
      />
      {choice && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <p className="text-fg-muted text-xs">
              What <code className="inline-code">onDecide</code> got:
            </p>
            <button
              type="button"
              onClick={() => setChoice(undefined)}
              className="text-signoff-fg-muted hover:text-signoff-fg focus-visible:outline-signoff-ring ml-auto cursor-pointer rounded-sm text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Reset
            </button>
          </div>
          <JsonBlock value={choice} title="ApprovalChoice" />
        </div>
      )}
    </div>
  );
}
