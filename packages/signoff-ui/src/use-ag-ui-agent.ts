'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ChatStatus, RunUsage, UIMessage } from './lib/ai-types';
import {
  answerAgUiInterrupt,
  createAgUiRun,
  fromAgUiMessages,
  getAgUiResume,
  reduceAgUiRun,
  reopenAgUiInterrupts,
  type AgUiApprovalResponse,
  type AgUiEvent,
  type AgUiInterrupt,
  type AgUiMessage,
  type AgUiResumeEntry,
  type AgUiRunState,
} from './lib/ag-ui';

/** What `useAgUiAgent` uses of an agent. Any `@ag-ui/client` agent fits: `HttpAgent`, or an integration's own `AbstractAgent`. */
export interface AgUiAgentLike {
  messages: readonly AgUiMessage[];
  pendingInterrupts?: readonly AgUiInterrupt[] | undefined;
  subscribe(subscriber: AgUiSubscriber): { unsubscribe(): void };
  runAgent(parameters?: { resume?: AgUiResumeEntry[] }): Promise<unknown>;
  abortRun?(): void;
}

/** The subscriber callbacks `useAgUiAgent` registers (a subset of `@ag-ui/client`'s `AgentSubscriber`). */
export interface AgUiSubscriber {
  onRunInitialized?(params: { messages: readonly AgUiMessage[]; input?: { runId?: string } }): void;
  onEvent?(params: { event: AgUiEvent }): void;
  onMessagesChanged?(params: { messages: readonly AgUiMessage[] }): void;
  onRunFailed?(params: { error: Error }): void;
  onRunFinalized?(params: { messages: readonly AgUiMessage[]; input?: { runId?: string } }): void;
}

export interface UseAgUiAgentOptions {
  /**
   * Starts the run that resumes the agent once every open interrupt has an answer. By default the
   * hook calls `agent.runAgent({ resume })`, which sends no tools, context or forwarded props, so a
   * run you started with them resumes without them. Pass the ones your runs send:
   * `(parameters) => agent.runAgent({ ...parameters, tools, context })`. In CopilotKit, resume
   * through it, so the run gets the frontend tools you registered:
   * `(parameters) => copilotkit.runAgent({ agent, ...parameters })`.
   */
  runAgent?: ((parameters: { resume: AgUiResumeEntry[] }) => Promise<unknown>) | undefined;
}

export interface UseAgUiAgentResult {
  /** The conversation as AI SDK messages: pass each to `AgentMessage`. */
  messages: UIMessage[];
  /** `useChat`-style status, for `deriveAgentState` and `AgentStatus`. */
  status: ChatStatus;
  /** Why the run failed, or why the answers to its interrupts didn't go (`status` is then `error`). */
  error: AgUiRunState['error'];
  /** Token usage summed over the runs seen, for `RunMeter`. */
  usage: RunUsage | undefined;
  /** The step in progress, e.g. a LangGraph node. */
  step: string | undefined;
  /** Open interrupts. Those bound to a tool call show as approval cards; answer the rest with `resolve`. */
  interrupts: AgUiInterrupt[];
  /**
   * Answer a tool-call interrupt. Pass it as `AgentMessage`'s `onToolApproval`. The agent resumes
   * once every open interrupt has an answer, since AG-UI resumes them all in one run. The first
   * answer stands: another one for the same interrupt is ignored. If the run that resumes fails or
   * is stopped before it finishes, its interrupts are open again, and `error` says why it failed:
   * the promise doesn't reject. The card of a call that hasn't run asks again. A call that ran
   * shows its result instead, with no card: answer its interrupt with `resolve`, as the client
   * turns down any run that doesn't. A denial of an expired interrupt (`expiresAt`) cancels it, and
   * an approval of one is refused, as AG-UI takes only a cancellation then.
   */
  respond: (response: AgUiApprovalResponse) => Promise<void>;
  /** Answer any interrupt with your own payload (match its `responseSchema`), as `respond` does. */
  resolve: (entry: AgUiResumeEntry) => Promise<void>;
  /**
   * Arguments a person edited for a tool call, sent as the approval payload's `editedArgs` (and as
   * `input`, deprecated) when it is approved. Pass it as `AgentMessage`'s `onToolInputEdit`, so
   * approval cards offer editing.
   */
  editInput: (toolCallId: string, input: unknown) => void;
  /**
   * Abort the run in progress, even before the server has answered. It ends like a cancelled run:
   * what was streaming stays cut off, which `deriveAgentState` reads as `stopped`. A stopped resume
   * opens its interrupts again, as the client still holds them: see `respond`.
   */
  stop: () => void;
}

const CANCELLED = { type: 'RUN_FINISHED', outcome: { type: 'cancelled' } };

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface Snapshot {
  messages: readonly AgUiMessage[];
  run: AgUiRunState;
}

/** The agent's messages and run state as an external store, subscribed while a component reads it. */
function createStore(agent: AgUiAgentLike) {
  let snapshot: Snapshot = { messages: [...agent.messages], run: createAgUiRun(agent.pendingInterrupts) };
  const listeners = new Set<() => void>();
  let subscription: { unsubscribe(): void } | undefined;
  /** Edited arguments by tool call id, until the approval that carries them is answered. */
  const edits = new Map<string, unknown>();
  const set = (next: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const update = (next: (run: AgUiRunState) => AgUiRunState) => {
    set({ run: next(snapshot.run) });
  };
  /** The interrupts the resume in flight answers, until its run starts (RUN_STARTED replaces them). */
  let resuming: readonly AgUiInterrupt[] | undefined;
  /**
   * The last run seen starting (`onRunInitialized`), and whether a resume has been asked for and
   * hasn't started yet. `@ag-ui/client` doesn't wait on `onRunFinalized`, so a run's can come once an
   * answer right after its `RUN_FINISHED` has started the next run: it is left out then.
   */
  let runId: string | undefined;
  let waiting = false;
  /** If the resume never started, take its answers back, so they can be given again. */
  const rollBack = (error?: AgUiRunState['error']) => {
    const answered = resuming;
    resuming = undefined;
    if (!answered || snapshot.run.interrupts !== answered) return false;
    update((run) => ({ ...reopenAgUiInterrupts(run), ...(error && { status: 'error' as const, error }) }));
    return true;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!subscription) {
        // Catch up on anything that happened before the first subscriber.
        snapshot = { ...snapshot, messages: [...agent.messages] };
        subscription = agent.subscribe({
          onRunInitialized: ({ messages, input }) => {
            runId = input?.runId;
            waiting = false;
            set({ messages: [...messages], run: { ...snapshot.run, status: 'submitted', error: undefined } });
          },
          onEvent: ({ event }) => {
            update((run) => reduceAgUiRun(run, event));
          },
          onMessagesChanged: ({ messages }) => {
            set({ messages: [...messages] });
          },
          onRunFailed: ({ error }) => {
            // stop() before the server answered: the fetch's AbortError comes here, not as RUN_ERROR.
            update((run) =>
              error.name === 'AbortError'
                ? reduceAgUiRun(run, CANCELLED)
                : { ...reduceAgUiRun(run, { type: 'RUN_ERROR' }), error: { message: error.message || 'Run failed' } },
            );
          },
          onRunFinalized: ({ messages, input }) => {
            // A late one, from a run before the newest: what it would cancel, take back or reopen is the newer run's.
            const id = input?.runId;
            if (id !== undefined && (waiting || (runId !== undefined && id !== runId))) return;
            set({ messages: [...messages] });
            // Aborted runs end without RUN_FINISHED: as a cancelled run, what was streaming stays cut off.
            update((run) =>
              run.status === 'submitted' || run.status === 'streaming' ? reduceAgUiRun(run, CANCELLED) : run,
            );
            // A resumed run that ended before it started (failed or stopped) never gave the agent its answers.
            rollBack();
            // One that started and ended without RUN_FINISHED (failed or stopped) leaves the client holding the
            // interrupts, and it turns down a run that doesn't answer them: open them again. A call that hasn't
            // run asks again; one that ran shows its result, and the app answers its interrupt with resolve.
            const pending = agent.pendingInterrupts ?? [];
            if (pending.length > 0 && snapshot.run.interrupts.length === 0)
              update((run) => reopenAgUiInterrupts(run, pending, snapshot.messages));
          },
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          subscription?.unsubscribe();
          subscription = undefined;
        }
      };
    },
    /** Record an answer; returns the resume entries once every open interrupt has one, the first time only. */
    answer(response: AgUiApprovalResponse | AgUiResumeEntry) {
      let answer = response;
      if (!('interruptId' in response)) {
        const toolCallId = snapshot.run.interrupts.find((i) => i.id === response.id)?.toolCallId;
        if (toolCallId && edits.has(toolCallId)) {
          if (response.approved && response.input === undefined) answer = { ...response, input: edits.get(toolCallId) };
          edits.delete(toolCallId);
        }
      }
      const run = answerAgUiInterrupt(snapshot.run, answer);
      // Not open, or answered already: the resume, if any, is on its way.
      if (run === snapshot.run) return undefined;
      set({ run });
      const resume = getAgUiResume(run);
      if (resume) {
        resuming = run.interrupts;
        waiting = true;
      }
      return resume;
    },
    /** The run that resumes failed: before it started, its answers are taken back. */
    fail(error: unknown) {
      const message = (error instanceof Error && error.message) || 'Run failed';
      if (!rollBack({ message }) && snapshot.run.status !== 'error')
        update((run) => ({ ...run, status: 'error', error: { message } }));
    },
    editInput(toolCallId: string, input: unknown) {
      edits.set(toolCallId, input);
    },
  };
}

/**
 * Render an AG-UI agent with these components: its messages as AI SDK parts, run status, usage,
 * and tool-call interrupts as approvals.
 *
 * ```tsx
 * const agent = useMemo(() => new HttpAgent({ url: '/api/agent' }), []);
 * const { messages, status, respond } = useAgUiAgent(agent);
 * ```
 *
 * When your runs send tools or context, pass `runAgent` so the run that resumes an interrupt sends
 * them too.
 */
export function useAgUiAgent(agent: AgUiAgentLike, options: UseAgUiAgentOptions = {}): UseAgUiAgentResult {
  const store = useMemo(() => createStore(agent), [agent]);
  const { messages, run } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // The latest render's runAgent, so an inline function doesn't make respond a new one each render.
  const runAgent = useRef(options.runAgent);
  useIsoLayoutEffect(() => {
    runAgent.current = options.runAgent;
  });
  const answer = useCallback(
    async (response: AgUiApprovalResponse | AgUiResumeEntry) => {
      const resume = store.answer(response);
      if (!resume) return;
      try {
        await (runAgent.current ? runAgent.current({ resume }) : agent.runAgent({ resume }));
      } catch (error) {
        // In `error`, as useChat reports a failed request: the cards call respond without catching.
        store.fail(error);
      }
    },
    [agent, store],
  );

  return {
    messages: useMemo(() => fromAgUiMessages(messages, run), [messages, run]),
    status: run.status,
    error: run.error,
    usage: run.usage,
    step: run.step,
    interrupts: run.interrupts,
    respond: answer,
    resolve: answer,
    editInput: store.editInput,
    stop: useCallback(() => agent.abortRun?.(), [agent]),
  };
}
