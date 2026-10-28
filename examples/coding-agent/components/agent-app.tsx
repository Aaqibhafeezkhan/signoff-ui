'use client';

import { useChat } from '@ai-sdk/react';
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import {
  AgentMessage,
  AgentStatus,
  deriveAgentState,
  getToolPartName,
  reviewToolOutput,
  RunMeter,
  setToolInput,
  useApprovalPolicy,
  useRunTiming,
  type ToolPart,
} from 'signoff-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRICING } from '@/lib/config';
import { BRANCH, REPO, TASK } from '@/lib/project';
import { ruleStorage } from '@/lib/rule-storage';
import { DEFAULT_RULES } from '@/lib/rules';
import { agentTransport } from '@/lib/transport';
import type { Mode, RunMessage } from '@/lib/types';
import { filesFromMessages } from '@/lib/workspace';
import { SparkIcon } from './icons';
import { ChangesCard, DecisionsPanel, decisionsFrom, FilesPanel, RulesPanel } from './panels';
import { ReviewTool } from './review';
import { TOOL_META } from './tool-meta';

/** Tools the page answers: the run waits on you while one is open. */
const CLIENT_TOOLS = ['review_changes'];

const SCRIPTED_HINT =
  'The scripted agent revises when you leave a comment, whatever it says: click a line number, then press C.';

/**
 * The app: a task, the run (tool calls, approvals, reviews) and, beside it, the run's status, your
 * approval rules, every decision and the project's files.
 */
export function AgentApp({ liveModel }: { liveModel: string | undefined }) {
  // The scripted agent even when the server has a key: a live run spends tokens, so a person picks it.
  const [mode, setMode] = useState<Mode>('scripted');
  const [run, setRun] = useState(0);
  const [draft, setDraft] = useState(TASK);
  const [reply, setReply] = useState('');

  // Your approval rules: the cards record them, and each request takes them to the server.
  const policy = useApprovalPolicy({ storage: ruleStorage, defaultRules: DEFAULT_RULES });
  // getRules is read as each request goes out: a "For this session" goes with the approval that made it.
  const { getRules } = policy;
  const transport = useMemo(() => agentTransport(mode, getRules), [mode, getRules]);

  const { messages, status, error, sendMessage, setMessages, stop, addToolOutput, addToolApprovalResponse } =
    useChat<RunMessage>({
      id: mode,
      transport,
      // Continue once the review is in and every approval has an answer.
      sendAutomaticallyWhen: (chat) =>
        lastAssistantMessageIsCompleteWithToolCalls(chat) || lastAssistantMessageIsCompleteWithApprovalResponses(chat),
    });

  const running = status === 'submitted' || status === 'streaming';
  const last = messages.findLast((m) => m.role === 'assistant');
  // The reply to the message you sent last, once it starts: the meter shows this run, not the one before.
  const current = last === messages.at(-1) ? last : undefined;
  const { state, detail } = deriveAgentState({ status, message: last, pendingClientTools: CLIENT_TOOLS });
  const timing = useRunTiming(status, messages);
  const files = useMemo(() => filesFromMessages(messages), [messages]);
  const started = messages.length > 0;
  const ended = state === 'done' || state === 'stopped' || state === 'error';
  const task = messages[0]?.parts.find((p) => p.type === 'text')?.text;

  // Follow the run while it works, if the reader is at its end; never while it waits on them.
  const endRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(false);
  useEffect(() => {
    const onScroll = () => {
      const top = endRef.current?.getBoundingClientRect().top;
      followRef.current = top !== undefined && top <= window.innerHeight + 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const working = state === 'thinking' || state === 'working';
  useEffect(() => {
    if (working && followRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, working]);
  const shouldScroll = useCallback(() => followRef.current, []);

  const start = (text: string) => {
    if (!text.trim()) return;
    followRef.current = true;
    void sendMessage({ text });
  };
  const runAgain = () => {
    setRun((n) => n + 1);
    setMessages([]);
    // The scripted agent plays its task again; a live run starts from the task box.
    if (mode === 'scripted') start(TASK);
  };
  const switchMode = (next: Mode) => {
    if (running) void stop();
    setMode(next);
    setRun((n) => n + 1);
  };

  const renderTool = useCallback(
    (part: ToolPart) =>
      getToolPartName(part) === 'review_changes' ? (
        <ReviewTool
          part={part}
          before={filesFromMessages(messages, part.toolCallId)}
          hint={mode === 'scripted' ? SCRIPTED_HINT : undefined}
          shouldScroll={shouldScroll}
          onSubmit={(result) =>
            void addToolOutput({
              tool: 'review_changes',
              toolCallId: part.toolCallId,
              output: reviewToolOutput(result),
            })
          }
        />
      ) : undefined,
    [messages, mode, shouldScroll, addToolOutput],
  );
  const editInput = useCallback(
    (toolCallId: string, input: unknown) => setMessages((current) => setToolInput(current, toolCallId, input)),
    [setMessages],
  );

  const statusLabel =
    state === 'awaiting-approval'
      ? detail === 'review_changes'
        ? 'Waiting for your review'
        : 'Waiting for your approval'
      : undefined;
  // The tool at work; while the run waits, the label says on what.
  const statusDetail = state === 'working' && detail ? (TOOL_META[detail]?.label ?? detail) : undefined;
  const meter = {
    usage: current?.metadata?.usage,
    pricing: PRICING,
    ttftMs: timing.ttftMs,
    durationMs: timing.startedAt !== undefined ? timing.activeMs : undefined,
    live: running,
  };
  const agentStatus = (
    <AgentStatus
      state={state}
      label={statusLabel}
      detail={statusDetail}
      elapsedMs={timing.startedAt !== undefined ? timing.activeMs : undefined}
    />
  );

  return (
    <div className="layout">
      <main id="main" className="main">
        <div className="status-strip">
          {agentStatus}
          <RunMeter {...meter} className="status-strip-meter" />
        </div>

        <div className="intro">
          <h1 className="intro-title">Review what the agent changes, approve what it runs</h1>
          <p className="intro-text">
            It works on a small repository in the background. Your rules answer the calls they cover, it asks you about
            the rest, and nothing it writes lands until you apply it in a review.
          </p>
        </div>

        <section className="panel task" aria-labelledby="task-heading">
          <div className="task-head">
            <h2 id="task-heading" className="panel-title">
              Task
            </h2>
            {liveModel ? (
              <ModeSwitch mode={mode} onChange={switchMode} liveModel={liveModel} />
            ) : (
              <span className="chip">Scripted agent</span>
            )}
          </div>
          {started || mode === 'scripted' ? (
            <p className="task-text">{task ?? TASK}</p>
          ) : (
            <textarea
              className="textarea"
              aria-label="Task for the agent"
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <div className="task-meta">
            <span className="chip chip-repo">
              <span className="chip-dot" aria-hidden="true" />
              {REPO}
            </span>
            <span className="mono muted">{BRANCH}</span>
          </div>
          <div className="task-actions">
            {!started && (
              <button
                type="button"
                className="button button-primary"
                disabled={!policy.ready}
                onClick={() => start(mode === 'scripted' ? TASK : draft)}
              >
                Start the run
              </button>
            )}
            {running && (
              <button type="button" className="button" onClick={() => void stop()}>
                Stop
              </button>
            )}
            {started && !running && (
              <button type="button" className="button" onClick={runAgain}>
                {mode === 'scripted' ? 'Run again' : 'New run'}
              </button>
            )}
            <p className="task-note">
              {mode === 'scripted'
                ? started
                  ? 'Your session rules hold for the next run. Clear them under Approval rules.'
                  : 'No API key needed: a scripted agent plays the run. Approve the tests for this session, comment on a line of the diff, and watch your rules answer the rest.'
                : `Live: ${liveModel}, on the server's OpenAI key.`}
            </p>
          </div>
        </section>

        {!started && mode === 'scripted' && <HowItRuns />}

        <div key={run} className="conversation">
          {messages.map((message, index) =>
            message.role === 'user' ? (
              index > 0 && (
                <div key={message.id} className="you">
                  <span className="you-label">You</span>
                  <p>{message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}</p>
                </div>
              )
            ) : (
              <div key={message.id} className="agent">
                <span className="agent-label" aria-hidden="true">
                  <span className="agent-glyph">
                    <SparkIcon />
                  </span>
                  Agent
                </span>
                <AgentMessage
                  message={message}
                  streaming={running && message === last}
                  // Once the run has ended, calls that never settled read "Stopped".
                  active={message === last && !ended}
                  // And once the run failed, approved calls whose result never came back.
                  failed={status === 'error'}
                  // The time a review takes is yours, not the tool's: its call shows no duration.
                  pendingClientTools={CLIENT_TOOLS}
                  tools={TOOL_META}
                  renderTool={renderTool}
                  onToolApproval={addToolApprovalResponse}
                  approvalPolicy={policy}
                  onToolInputEdit={editInput}
                  approvalProps={{ autoFocus: true }}
                />
              </div>
            ),
          )}
          {status === 'submitted' && messages.at(-1)?.role === 'user' && <Thinking />}
        </div>

        {error && (
          <p className="error" role="alert">
            {error.message}
          </p>
        )}
        {state === 'done' && !running && <ChangesCard files={files} />}
        {mode === 'live' && started && !running && (
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reply.trim()) return;
              start(reply);
              setReply('');
            }}
          >
            <textarea
              className="textarea"
              aria-label="Reply to the agent"
              placeholder="Reply to the agent"
              rows={2}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
            <button type="submit" className="button button-primary">
              Send
            </button>
          </form>
        )}
        <div ref={endRef} className="end" />
      </main>

      <aside className="side" aria-label="Run, rules and files">
        <section className="panel side-status" aria-labelledby="status-heading">
          <h2 id="status-heading" className="panel-title">
            Status
          </h2>
          {agentStatus}
        </section>
        <div className="side-meter">
          <RunMeter
            variant="expanded"
            {...meter}
            model={last?.metadata?.model ?? (mode === 'live' ? liveModel : 'scripted-agent')}
          />
        </div>
        <RulesPanel policy={policy} />
        <DecisionsPanel decisions={decisionsFrom(messages, policy)} />
        <FilesPanel files={files} />
      </aside>
    </div>
  );
}

/** What the run will do, before it starts: where your rules answer, and where you do. */
function HowItRuns() {
  return (
    <section className="panel" aria-labelledby="how-heading">
      <h2 id="how-heading" className="panel-title">
        How the run goes
      </h2>
      <ol className="steps">
        <li>
          <span>
            <strong>It reads the code.</strong> Your rules allow <code>list_files</code> and <code>read_file</code>, so
            nobody is asked.
          </span>
        </li>
        <li>
          <span>
            <strong>It asks to run the tests.</strong> Approve <code>npm test</code> once, for this session or always:
            the last two leave a rule.
          </span>
        </li>
        <li>
          <span>
            <strong>You review its fix</strong> across three files: accept or reject each hunk, comment on a line, mark
            files viewed. Your comments go back to the agent, and it revises.
          </span>
        </li>
        <li>
          <span>
            <strong>It tests, commits and pushes.</strong> The tests run on your session rule, the commit on a default
            rule, and the server&apos;s rule blocks the push.
          </span>
        </li>
      </ol>
    </section>
  );
}

function Thinking() {
  return (
    <div className="thinking" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function ModeSwitch({ mode, onChange, liveModel }: { mode: Mode; onChange: (mode: Mode) => void; liveModel: string }) {
  return (
    <div role="group" aria-label="Agent" className="segmented">
      {(['scripted', 'live'] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)} className="segmented-item">
          {m === 'live' ? liveModel : 'Scripted'}
        </button>
      ))}
    </div>
  );
}
