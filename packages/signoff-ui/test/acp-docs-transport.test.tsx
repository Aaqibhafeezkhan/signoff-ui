import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
  type PermissionOption,
  type ToolCall,
} from '@agentclientprotocol/sdk';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as acp from '../src/acp';
import * as kit from '../src/index';

/*
 * The ACP page's two files, run as copied: its code blocks compiled, their imports this package's
 * source, against an agent over the ACP SDK's own connection. An approved call that then fails
 * reads Failed, with the error, and Stop answers the permission request still open with
 * `cancelled`, as ACP requires of a client that sends session/cancel.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const page = readFileSync(join(root, 'examples/playground/content/docs/acp.md'), 'utf8');

/** A `tsx` block of the page, by its title, as a module. */
function load<T>(title: string): T {
  const code = page.split(`\`\`\`tsx title="${title}"\n`)[1]?.split('\n```')[0];
  if (!code) throw new Error(`no ${title} block on the page`);
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const modules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'signoff-ui': kit,
    'signoff-ui/acp': acp,
  };
  const module = { exports: {} as T };
  const require = (id: string) => {
    if (!(id in modules)) throw new Error(`${title} imports ${id}`);
    return modules[id];
  };
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports;
}

type UseAcpTurn = () => {
  turn: acp.AcpTurn | undefined;
  client: Client;
  prompt: (agent: Agent, sessionId: string, text: string) => Promise<void>;
  decide: (toolCallId: string, decision: kit.ApprovalDecision) => void;
  cancel: (agent: Agent, sessionId: string) => Promise<void>;
};
type AcpTurnView = (props: {
  turn: acp.AcpTurn;
  cwd: string;
  decide: (id: string, d: kit.ApprovalDecision) => void;
}) => React.ReactNode;

const { useAcpTurn } = load<{ useAcpTurn: UseAcpTurn }>('components/use-acp-turn.tsx');
const { AcpTurnView } = load<{ AcpTurnView: AcpTurnView }>('components/acp-turn.tsx');

// Claude Code's Edit: one allow_always option, which the card names.
const options: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
  { optionId: 'allow-with-updates', name: 'Yes, allow all edits during this session', kind: 'allow_always' },
  { optionId: 'reject', name: 'No', kind: 'reject_once' },
];
const edit: ToolCall = {
  toolCallId: 'edit-1',
  title: 'Edit src/config.ts',
  kind: 'edit',
  status: 'pending',
  rawInput: { file_path: '/repo/src/config.ts' },
  content: [
    {
      type: 'diff',
      path: '/repo/src/config.ts',
      oldText: 'export const PORT = 3000;\n',
      newText: 'export const PORT = Number(process.env.PORT ?? 3000);\n',
    },
  ],
};
const ERROR = 'EACCES: permission denied, open /repo/src/config.ts';

/**
 * An agent that asks before its edit, then reports it `completed` or `failed`. Like an agent that
 * runs a tool call to its end, it waits on the permission request without watching for
 * session/cancel: only the client's answer ends the wait.
 */
function connectAgent(client: Client, then: 'completed' | 'failed', log: string[]) {
  const toAgent = new TransformStream<Uint8Array, Uint8Array>();
  const toClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(
    (conn) => ({
      initialize: () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }),
      newSession: () => ({ sessionId: 's1' }),
      authenticate: () => {},
      cancel: () => void log.push('session/cancel'),
      async prompt({ sessionId }) {
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call', ...edit } });
        const { outcome } = await conn.requestPermission({ sessionId, toolCall: edit, options });
        log.push(`answer: ${outcome.outcome === 'selected' ? outcome.optionId : outcome.outcome}`);
        if (outcome.outcome === 'cancelled') return { stopReason: 'cancelled' };
        const text = then === 'failed' ? ERROR : 'Wrote src/config.ts';
        await conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: edit.toolCallId,
            status: then,
            content: [{ type: 'content', content: { type: 'text', text } }],
          },
        });
        return { stopReason: 'end_turn' };
      },
    }),
    ndJsonStream(toClient.writable, toAgent.readable),
  );
  return new ClientSideConnection(() => client, ndJsonStream(toAgent.writable, toClient.readable));
}

/** An app on the page's hook and view: a prompt, a Stop button, the turn. */
function App({ then, log }: { then: 'completed' | 'failed'; log: string[] }) {
  const { turn, client, prompt, decide, cancel } = useAcpTurn();
  const [agent] = useState(() => connectAgent(client, then, log));
  return (
    <>
      <button type="button" onClick={() => void prompt(agent, 's1', 'Read the port from the environment')}>
        Send
      </button>
      <button type="button" onClick={() => void cancel(agent, 's1')}>
        Stop
      </button>
      {turn && <p>{`Turn: ${turn.status}, ${turn.stopReason ?? 'running'}`}</p>}
      {turn && <AcpTurnView turn={turn} cwd="/repo" decide={decide} />}
    </>
  );
}

/** Sends the prompt, and waits for the edit's card. */
async function ask(then: 'completed' | 'failed') {
  const log: string[] = [];
  const user = userEvent.setup();
  render(<App then={then} log={log} />);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  const card = await screen.findByRole('group', { name: 'Edit src/config.ts' });
  // The card names what Always grants.
  expect(card).toHaveAccessibleDescription(/^Always: Yes, allow all edits during this session/);
  return { log, user };
}

const row = () => screen.getByRole('button', { name: /Edit src\/config\.ts/ });

describe('the ACP page, over a real connection', () => {
  it('returns cancel from useAcpTurn', () => {
    const { result } = renderHook(useAcpTurn);
    expect(Object.keys(result.current)).toEqual(['turn', 'client', 'prompt', 'decide', 'cancel']);
  });

  it('shows an approved call that then failed as Failed, with the error', async () => {
    const { log, user } = await ask('failed');
    await user.click(screen.getByRole('button', { name: /Approve/ }));
    await screen.findByText('Turn: ready, end_turn');
    expect(log).toEqual(['answer: allow-once']);
    // The card is gone: the default row has the result.
    expect(screen.queryByRole('group', { name: 'Edit src/config.ts' })).not.toBeInTheDocument();
    expect(row()).toHaveTextContent(/Failed/);
    expect(screen.getByText(ERROR)).toBeInTheDocument();
  });

  it('shows a completed call as Done, with its output', async () => {
    const { log, user } = await ask('completed');
    await user.click(screen.getByRole('button', { name: 'Always' }));
    await screen.findByText('Turn: ready, end_turn');
    expect(log).toEqual(['answer: allow-with-updates']);
    expect(screen.queryByRole('group', { name: 'Edit src/config.ts' })).not.toBeInTheDocument();
    expect(row()).toHaveTextContent(/Done/);
    await user.click(row());
    expect(await screen.findByText(/Wrote src\/config\.ts/)).toBeInTheDocument();
  });

  it('answers the open permission request with cancelled on Stop, after session/cancel', async () => {
    const { log, user } = await ask('completed');
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    // Without the answer, the agent would still be waiting, and the turn streaming.
    await screen.findByText('Turn: ready, cancelled');
    expect(log).toEqual(['session/cancel', 'answer: cancelled']);
    expect(screen.queryByRole('group', { name: 'Edit src/config.ts' })).not.toBeInTheDocument();
    expect(row()).toHaveTextContent(/Denied/);
  });
});
