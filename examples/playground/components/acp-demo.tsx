'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AgentMessage,
  AgentStatus,
  ApprovalCard,
  DiffReview,
  deriveAgentState,
  type ApprovalDecision,
  type ToolMeta,
} from 'signoff-ui';
import {
  acpToolName,
  answerAcpPermission,
  createAcpTurn,
  decisionsFromAcpOptions,
  endAcpTurn,
  fromAcpDiffs,
  reduceAcpTurn,
  requestAcpPermission,
  toAcpMessage,
  toAcpPermissionResponse,
  type AcpPermissionOption,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionNotification,
  type AcpSessionUpdate,
  type AcpTurn,
} from 'signoff-ui/acp';
import { AFTER, BEFORE, ROOT } from '@/lib/acp-script';
import { Prompt, ResetButton, RunButton, RunPlan } from './demo-run';
import { FileOutput } from './file-output';
import { JsonBlock, TerminalBlock } from './terminal';
import { tokenizeTerminal, tokenizeTerminalLine } from '@/lib/terminal';

const PROMPT = 'The formatDuration test fails. Fix it.';
const SESSION = 'sess_demo';

/** What an ACP client handles for the agent: its `session/update` notifications and `session/request_permission` requests. */
interface AcpClient {
  sessionUpdate(params: AcpSessionNotification): Promise<void>;
  requestPermission(params: AcpRequestPermissionRequest): Promise<AcpRequestPermissionResponse>;
}

/** The read call's output is the file's source: code in the site's block, its path from the project root. */
const TOOLS: Record<string, ToolMeta> = {
  read: {
    renderOutput: (output, part) => {
      const path = String((part.input as { path?: unknown } | undefined)?.path ?? 'file');
      return typeof output === 'string' ? (
        <FileOutput path={path.replace(`${ROOT}/`, '')} content={output} />
      ) : (
        <JsonBlock value={output} title="Output" />
      );
    },
  },
};

const ONCE_OR_ALWAYS: AcpPermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

const text = (content: string) => ({ type: 'content' as const, content: { type: 'text', text: content } });

/**
 * A scripted ACP agent, no real one: it plays the session updates a coding agent sends for one
 * prompt turn, asks permission to edit a file and to run the tests, and returns the turn's
 * `stopReason`, with model-like pacing. An agent over stdio or WebSocket sends the same messages.
 */
async function runScriptedAgent(client: AcpClient, signal: AbortSignal): Promise<{ stopReason: string }> {
  const wait = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      });
    });
  const send = async (update: AcpSessionUpdate & Record<string, unknown>, ms = 220) => {
    await wait(ms);
    await client.sessionUpdate({ sessionId: SESSION, update });
  };
  const say = async (sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk', words: string) => {
    for (const piece of words.match(/\S+\s*/g) ?? [])
      await send({ sessionUpdate, content: { type: 'text', text: piece } }, 35);
  };
  const ask = async (toolCall: AcpRequestPermissionRequest['toolCall'], options: AcpPermissionOption[]) => {
    await wait(300);
    const { outcome } = await client.requestPermission({ sessionId: SESSION, toolCall, options });
    return (
      outcome.outcome === 'selected' && options.find((o) => o.optionId === outcome.optionId)?.kind.startsWith('allow')
    );
  };

  await say(
    'agent_thought_chunk',
    'The test expects 59,950 ms to read 59.9s and gets 60.0s, so the seconds are rounded where they should be cut.',
  );
  await say('agent_message_chunk', "I'll read the formatter first.");
  const file = `${ROOT}/lib/format.ts`;
  await send({
    sessionUpdate: 'tool_call',
    toolCallId: 'read-1',
    title: 'Read lib/format.ts',
    kind: 'read',
    status: 'in_progress',
    rawInput: { path: file },
    locations: [{ path: file }],
  });
  await send(
    { sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'completed', content: [text(BEFORE)] },
    650,
  );
  await say('agent_message_chunk', ' `toFixed(1)` rounds. Cutting to tenths first fixes it.');

  const edit = {
    toolCallId: 'edit-1',
    title: 'Edit lib/format.ts',
    kind: 'edit',
    status: 'pending' as const,
    rawInput: { path: file },
    content: [{ type: 'diff' as const, path: file, oldText: BEFORE, newText: AFTER }],
  };
  await send({ sessionUpdate: 'tool_call', ...edit });
  if (!(await ask(edit, ONCE_OR_ALWAYS))) {
    await send({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'edit-1',
      status: 'failed',
      content: [text('Rejected by the user')],
    });
    await say('agent_message_chunk', " I left lib/format.ts as it was. Tell me if you'd rather change the test.");
    return { stopReason: 'end_turn' };
  }
  await send({ sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'completed' }, 400);
  await say('agent_message_chunk', ' Edited. Now the tests:');

  const command = 'pnpm test lib/format';
  const tests = {
    toolCallId: 'test-1',
    title: command,
    kind: 'execute',
    status: 'pending' as const,
    rawInput: { command },
  };
  await send({ sessionUpdate: 'tool_call', ...tests });
  if (!(await ask(tests, ONCE_OR_ALWAYS))) {
    await say('agent_message_chunk', ' Skipped the tests. Run `pnpm test lib/format` when you want to check it.');
    return { stopReason: 'end_turn' };
  }
  await send({ sessionUpdate: 'tool_call_update', toolCallId: 'test-1', status: 'in_progress' });
  await send(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'test-1',
      status: 'completed',
      content: [text('Tests  14 passed (14)')],
    },
    900,
  );
  await say('agent_message_chunk', ' The test passes: 59,950 ms now reads **59.9s**.');
  return { stopReason: 'end_turn' };
}

/** The approval for a call the agent asked permission for: its diff, if it edits files, and the agent's options. */
function Permission({
  turn,
  toolCallId,
  onDecide,
}: {
  turn: AcpTurn;
  toolCallId: string;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const call = turn.toolCalls[toolCallId]!;
  const { options, decision } = turn.permissions[toolCallId]!;
  const files = fromAcpDiffs(call.content, { root: ROOT });
  return (
    <ApprovalCard
      toolName={acpToolName(call)}
      title={call.title ?? undefined}
      input={call.rawInput}
      risk={call.kind === 'execute' ? 'medium' : 'low'}
      headingLevel={3}
      preview={
        files.length > 0 ? <DiffReview files={files} readOnly title="Proposed edit" headingLevel={4} /> : undefined
      }
      status={decision === undefined ? 'pending' : decision.startsWith('allow') ? 'approved' : 'denied'}
      decision={decision === 'cancelled' ? undefined : decision}
      // ACP has no "this session" option: offer what the agent offered.
      // The agent keeps what "always" means: no argument patterns to show.
      ruleScope={false}
      decisions={decisionsFromAcpOptions(options).filter((d) => d !== 'allow-session')}
      onDecide={(choice) => onDecide(choice.decision)}
    />
  );
}

function Run({ onReset }: { onReset: () => void }) {
  const [turn, setTurn] = useState<AcpTurn>();
  const waiting = useRef(new Map<string, (response: AcpRequestPermissionResponse) => void>());
  const abort = useRef<AbortController>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = () => {
    const controller = new AbortController();
    abort.current = controller;
    setTurn(createAcpTurn());
    const client: AcpClient = {
      sessionUpdate: async (params) => setTurn((t) => t && reduceAcpTurn(t, params)),
      requestPermission: (params) =>
        new Promise((resolve) => {
          waiting.current.set(params.toolCall.toolCallId, resolve);
          setTurn((t) => t && requestAcpPermission(t, params));
        }),
    };
    runScriptedAgent(client, controller.signal).then(
      (result) => setTurn((t) => t && endAcpTurn(t, result)),
      () => {},
    );
  };

  const decide = (toolCallId: string, decision: ApprovalDecision) => {
    const options = turn?.permissions[toolCallId]?.options ?? [];
    setTurn((t) => t && answerAcpPermission(t, toolCallId, decision));
    waiting.current.get(toolCallId)?.(toAcpPermissionResponse(decision, options));
    waiting.current.delete(toolCallId);
  };

  const message = turn && toAcpMessage(turn);
  const { state, detail } = deriveAgentState({ status: turn?.status ?? 'ready', message });
  const finished = state === 'done' || state === 'stopped' || state === 'error';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Prompt>{PROMPT}</Prompt>
        {!turn && <RunButton onClick={start}>Run the ACP agent</RunButton>}
        <AgentStatus state={state} detail={detail} size="sm" />
        {turn && finished ? <ResetButton onClick={onReset} /> : null}
      </div>
      {!turn && (
        <RunPlan
          label="What the turn does"
          steps={[
            { name: 'read', note: 'lib/format.ts' },
            { name: 'edit', note: 'asks permission, with the diff' },
            { name: 'execute', note: 'asks to run the tests' },
          ]}
        />
      )}
      {turn && message ? (
        <AgentMessage
          message={message}
          streaming={turn.status === 'streaming'}
          active={!finished}
          failed={turn.status === 'error'}
          tools={TOOLS}
          renderTool={(part) => {
            if (!turn.permissions[part.toolCallId]) return undefined;
            const call = turn.toolCalls[part.toolCallId];
            // A command that ran once allowed: what it printed, under its approval.
            const printed =
              call?.kind === 'execute' && part.state === 'output-available' && typeof part.output === 'string'
                ? part.output
                : undefined;
            const command = (part.input as { command?: unknown } | undefined)?.command;
            return (
              <div className="flex flex-col gap-2">
                <Permission turn={turn} toolCallId={part.toolCallId} onDecide={(d) => decide(part.toolCallId, d)} />
                {printed !== undefined && (
                  <TerminalBlock
                    title={ROOT}
                    lines={[
                      ...(typeof command === 'string' ? [tokenizeTerminalLine(`$ ${command}`)] : []),
                      ...tokenizeTerminal(printed),
                    ]}
                  />
                )}
              </div>
            );
          }}
        />
      ) : null}
    </div>
  );
}

export default function AcpDemo() {
  const [session, setSession] = useState(0);
  return <Run key={session} onReset={() => setSession((s) => s + 1)} />;
}
