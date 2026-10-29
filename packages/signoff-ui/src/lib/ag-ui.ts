/**
 * AG-UI to AI SDK message parts, so the components render any AG-UI agent (LangGraph, CrewAI,
 * Mastra, Pydantic AI...). The types below mirror the parts of AG-UI 1.0 that are read
 * here, structurally, so `@ag-ui/core` and `@ag-ui/client` objects fit without either being a
 * dependency. The AI SDK types come from ./ai-types, so the entry needs no `ai` either.
 */
import type { ChatStatus, DynamicToolUIPart, RunUsage, SubagentPart, SubagentStatus, UIMessage } from './ai-types';
import { addUsage } from './usage';

/** An AG-UI event. Only `type` is required here; the fields each event type carries are read as needed. */
export interface AgUiEvent {
  type: string;
}

export interface AgUiToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/** Text, image, audio, video or document content (AG-UI `ContentPart`). */
export interface AgUiContentPart {
  type: string;
  text?: string;
  source?: { type: string; value: string; mimeType?: string };
}

/** Any AG-UI message: user, assistant, reasoning, tool, activity, system or developer. */
export interface AgUiMessage {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: readonly AgUiToolCall[];
  toolCallId?: string;
  error?: string;
  activityType?: string;
  /** The sub-agent that wrote it. Absent for the agent's own messages. */
  subagentRunId?: string;
}

/** A pause for human input (AG-UI `Interrupt`). `toolCallId` binds it to a tool call to approve. */
export interface AgUiInterrupt {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
  responseSchema?: Record<string, unknown>;
  /** When it expires (ISO 8601). From then on AG-UI takes only a cancellation for it. */
  expiresAt?: string | undefined;
}

/** An answer to an interrupt, sent in `RunAgentInput.resume` (AG-UI `ResumeEntry`). */
export interface AgUiResumeEntry {
  interruptId: string;
  status: 'resolved' | 'cancelled';
  payload?: unknown;
}

/** AG-UI `TokenUsage`. Totals include cached and reasoning tokens, as in the AI SDK. */
export interface AgUiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
}

/** A decision on a tool-call interrupt, as the tool part shows it. */
export interface AgUiApproval {
  /** The interrupt id, which is also the approval id `ToolApprovalCard` responds with. */
  id: string;
  /** Undefined while nobody has answered. */
  approved?: boolean | undefined;
  reason?: string | undefined;
  /** The interrupt's message, e.g. "Send email to a@b.com?". */
  requestReason?: string | undefined;
}

/** A sub-agent the runs started (`SUBAGENT_STARTED`), and how it ended. */
export interface AgUiSubagent {
  subagentRunId: string;
  /** Undefined until its `SUBAGENT_STARTED` arrives. */
  name?: string | undefined;
  /** The tool call that started it, which it nests under. */
  parentToolCallId?: string | undefined;
  /** The sub-agent that started it, when one did. */
  parentSubagentRunId?: string | undefined;
  /** `running` from its start or its first event, then `done` or `suspended` (`SUBAGENT_FINISHED`), or `error`. */
  status: SubagentStatus;
  /** From `SUBAGENT_ERROR`. */
  error?: { message: string; code?: string | undefined } | undefined;
}

/** What the event stream says about runs, beyond the messages themselves. */
export interface AgUiRunState {
  /** `useChat`-style: `submitted` until content streams, `ready` once the run ends, `error` after `RUN_ERROR`. */
  status: ChatStatus;
  error?: { message: string; code?: string | undefined } | undefined;
  /** Token usage summed over the runs seen, for `RunMeter`. */
  usage?: RunUsage | undefined;
  /** The step in progress (`STEP_STARTED`), e.g. a LangGraph node. */
  step?: string | undefined;
  /** Interrupts the last run ended with. The next run must answer all of them. */
  interrupts: AgUiInterrupt[];
  /** Answers given so far to `interrupts`, by interrupt id. */
  answers: Record<string, AgUiResumeEntry>;
  /** Tool-call interrupts and their decisions, by tool call id. Kept across runs. */
  approvals: Record<string, AgUiApproval>;
  /**
   * Text and reasoning messages, and tool calls, still streaming. A cancelled run (`RUN_FINISHED`
   * with a `cancelled` outcome) leaves them as they were, cut off, until the next run starts.
   */
  streaming: { messages: string[]; toolCalls: string[] };
  /** Sub-agents, in the order they were first seen. Kept across runs. */
  subagents?: AgUiSubagent[] | undefined;
}

export function createAgUiRun(interrupts: readonly AgUiInterrupt[] = []): AgUiRunState {
  return withInterrupts(
    {
      status: 'ready',
      interrupts: [],
      answers: {},
      approvals: {},
      streaming: { messages: [], toolCalls: [] },
      subagents: [],
    },
    interrupts,
  );
}

function withInterrupts(run: AgUiRunState, interrupts: readonly AgUiInterrupt[]): AgUiRunState {
  const approvals = { ...run.approvals };
  for (const interrupt of interrupts) {
    if (interrupt.toolCallId)
      approvals[interrupt.toolCallId] = { id: interrupt.id, requestReason: interrupt.message ?? undefined };
  }
  return { ...run, interrupts: [...interrupts], answers: {}, approvals };
}

/** Fields read from events, all optional so one shape covers every event type. */
interface EventFields {
  type: string;
  messageId?: string;
  toolCallId?: string;
  stepName?: string;
  message?: string;
  code?: string;
  usage?: readonly AgUiTokenUsage[];
  outcome?: { type: string; interrupts?: readonly AgUiInterrupt[] };
  subagentRunId?: string;
  name?: string;
  parentToolCallId?: string;
  parentSubagentRunId?: string;
}

const add = (list: string[], id: string | undefined) => (id === undefined || list.includes(id) ? list : [...list, id]);
const remove = (list: string[], id: string | undefined) => (list.includes(id!) ? list.filter((x) => x !== id) : list);

const ended = (status: SubagentStatus) => status === 'done' || status === 'error';

/** The run with sub-agent `id` changed, or added first (running) when it is new. */
function withSubagent(run: AgUiRunState, id: string, change: (subagent: AgUiSubagent) => AgUiSubagent) {
  const list = run.subagents ?? [];
  const at = list.findIndex((s) => s.subagentRunId === id);
  const current = list[at] ?? { subagentRunId: id, status: 'running' };
  const next = change(current);
  if (next === current && at !== -1) return run;
  return { ...run, subagents: at === -1 ? [...list, next] : list.map((s, i) => (i === at ? next : s)) };
}

/**
 * Fold one AG-UI event into the run state. Pure, so it fits `useReducer` or any store;
 * `useAgUiAgent` uses it with an `@ag-ui/client` agent.
 */
export function reduceAgUiRun(run: AgUiRunState, event: AgUiEvent): AgUiRunState {
  const e = event as EventFields;
  const id = e.subagentRunId;
  if (id !== undefined) {
    switch (e.type) {
      case 'SUBAGENT_STARTED':
        return withSubagent(run, id, (s) => ({
          ...s,
          name: e.name,
          parentToolCallId: e.parentToolCallId,
          parentSubagentRunId: e.parentSubagentRunId,
          // An end that arrived first stands; a suspended sub-agent starts again.
          status: ended(s.status) ? s.status : 'running',
        }));
      case 'SUBAGENT_FINISHED':
        return withSubagent(run, id, (s) =>
          ended(s.status) ? s : { ...s, status: e.outcome?.type === 'suspended' ? 'suspended' : 'done' },
        );
      case 'SUBAGENT_ERROR':
        return withSubagent(run, id, (s) =>
          ended(s.status) ? s : { ...s, status: 'error', error: { message: e.message ?? '', code: e.code } },
        );
    }
    // Its work, maybe before its start event: it is running.
    run = withSubagent(run, id, (s) => (s.status === 'suspended' ? { ...s, status: 'running' } : s));
  }
  const { messages, toolCalls } = run.streaming;
  const streaming = (next: Partial<AgUiRunState['streaming']>): AgUiRunState => ({
    ...run,
    status: 'streaming',
    streaming: { messages, toolCalls, ...next },
  });
  switch (e.type) {
    case 'RUN_STARTED':
      return {
        ...run,
        status: 'submitted',
        error: undefined,
        step: undefined,
        interrupts: [],
        answers: {},
        streaming: { messages: [], toolCalls: [] },
      };
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_CHUNK':
    case 'REASONING_START':
    case 'REASONING_MESSAGE_START':
    case 'REASONING_MESSAGE_CHUNK':
      return streaming({ messages: add(messages, e.messageId) });
    case 'TEXT_MESSAGE_END':
    case 'REASONING_MESSAGE_END':
    case 'REASONING_END':
      return { ...run, streaming: { messages: remove(messages, e.messageId), toolCalls } };
    case 'TOOL_CALL_START':
    case 'TOOL_CALL_CHUNK':
      return streaming({ toolCalls: add(toolCalls, e.toolCallId) });
    case 'TOOL_CALL_END':
    case 'TOOL_CALL_RESULT':
      return { ...run, streaming: { messages, toolCalls: remove(toolCalls, e.toolCallId) } };
    case 'TEXT_MESSAGE_CONTENT':
    case 'REASONING_MESSAGE_CONTENT':
    case 'TOOL_CALL_ARGS':
      return run.status === 'streaming' ? run : { ...run, status: 'streaming' };
    case 'STEP_STARTED':
      return { ...run, step: e.stepName };
    case 'STEP_FINISHED':
      return run.step === e.stepName ? { ...run, step: undefined } : run;
    case 'RUN_FINISHED': {
      // A cancelled run stopped part-way: what was still streaming stays unfinished, as after the AI
      // SDK's stop(), so deriveAgentState reads it as stopped rather than done.
      const ended = endRun(run, e.usage, e.outcome?.type === 'cancelled');
      return e.outcome?.type === 'interrupt' ? withInterrupts(ended, e.outcome.interrupts ?? []) : ended;
    }
    case 'RUN_ERROR':
      // HttpAgent reports its own abortRun() as an error with code `abort`: the run was stopped, not failed.
      if (e.code === 'abort') return endRun(run, e.usage, true);
      return { ...endRun(run, e.usage), status: 'error', error: { message: e.message ?? 'Run failed', code: e.code } };
    default:
      return run;
  }
}

function endRun(run: AgUiRunState, usage: readonly AgUiTokenUsage[] | undefined, cancelled = false): AgUiRunState {
  let total = run.usage;
  for (const entry of usage ?? []) total = addUsage(total, fromAgUiUsage(entry));
  const streaming = cancelled ? run.streaming : { messages: [], toolCalls: [] };
  return { ...run, status: 'ready', step: undefined, usage: total, streaming };
}

/** An AG-UI `TokenUsage` entry as AI SDK usage. */
export function fromAgUiUsage(usage: AgUiTokenUsage): RunUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    inputTokenDetails: { cacheReadTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteInputTokens },
    outputTokenDetails: { reasoningTokens: usage.reasoningTokens },
  };
}

/** A tool approval, as `ToolApprovalCard` and `AgentMessage`'s `onToolApproval` give it. */
export interface AgUiApprovalResponse {
  id: string;
  approved: boolean;
  reason?: string | undefined;
  /** Arguments the person edited, sent with an approval as the payload's `editedArgs` (and `input`, deprecated). */
  input?: unknown;
}

/**
 * Record an answer to an open interrupt. A tool approval becomes the conventional
 * `{ approved, reason? }` payload, with `editedArgs` when the person edited the arguments: AG-UI's
 * approve-with-edits field, a full replacement of the call's arguments. The same arguments go as
 * `input` too, the name earlier versions sent, which is deprecated. Pass a resume entry for other
 * interrupts.
 *
 * The first answer to an interrupt stands: for another one, or one that isn't open, the run comes
 * back unchanged, so it can't start a second resume. Once an interrupt's `expiresAt` has passed
 * (at `now`), AG-UI takes only a cancellation for it: a denial goes as one, and an approval or a
 * resolved entry is refused, with `status: 'error'` and an `interrupt_expired` error saying so.
 */
export function answerAgUiInterrupt(
  run: AgUiRunState,
  answer: AgUiApprovalResponse | AgUiResumeEntry,
  now: number = Date.now(),
): AgUiRunState {
  let entry: AgUiResumeEntry =
    'interruptId' in answer
      ? answer
      : {
          interruptId: answer.id,
          status: 'resolved',
          payload: {
            approved: answer.approved,
            ...(answer.reason ? { reason: answer.reason } : {}),
            ...(answer.approved && answer.input !== undefined ? { editedArgs: answer.input, input: answer.input } : {}),
          },
        };
  const interrupt = run.interrupts.find((i) => i.id === entry.interruptId);
  if (!interrupt || run.answers[interrupt.id]) return run;
  if (interrupt.expiresAt !== undefined && Date.parse(interrupt.expiresAt) <= now) {
    const decision = 'interruptId' in answer ? undefined : answer;
    if (entry.status === 'resolved' && decision?.approved !== false) {
      const message = `Interrupt ${interrupt.id} expired at ${interrupt.expiresAt}: it can only be ${decision ? 'denied' : 'cancelled'} now.`;
      return { ...run, status: 'error', error: { message, code: 'interrupt_expired' } };
    }
    entry = { ...entry, status: 'cancelled' };
  }
  const approvals = { ...run.approvals };
  const approval = interrupt.toolCallId ? approvals[interrupt.toolCallId] : undefined;
  if (interrupt.toolCallId && approval) {
    const payload = entry.payload as { approved?: unknown; reason?: unknown } | undefined;
    approvals[interrupt.toolCallId] = {
      ...approval,
      approved: entry.status === 'resolved' && payload?.approved === true,
      reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
    };
  }
  return { ...run, answers: { ...run.answers, [entry.interruptId]: entry }, approvals };
}

/** The resume entries for the next run, once every open interrupt has an answer. */
export function getAgUiResume(run: AgUiRunState): AgUiResumeEntry[] | undefined {
  if (run.interrupts.length === 0) return undefined;
  const entries = run.interrupts.map((i) => run.answers[i.id]);
  return entries.every((e) => e !== undefined) ? entries : undefined;
}

/**
 * The open interrupts, or the ones given, with their answers taken back, as before anyone answered:
 * for a resume that never started, or one that started and ended without `RUN_FINISHED`. A call
 * with a result in `messages` keeps its decision for display, as the agent acted on it: the
 * timeline still says it was approved (or denied), and no card asks again.
 */
export function reopenAgUiInterrupts(
  run: AgUiRunState,
  interrupts: readonly AgUiInterrupt[] = run.interrupts,
  messages: readonly AgUiMessage[] = [],
): AgUiRunState {
  const reopened = withInterrupts(run, interrupts);
  for (const m of messages) {
    const decided = m.role === 'tool' ? run.approvals[m.toolCallId!] : undefined;
    if (decided?.approved !== undefined) reopened.approvals[m.toolCallId!] = decided;
  }
  return reopened;
}

type Part = UIMessage['parts'][number];

/** A sub-agent's messages, its part, and the parts its first message would have joined. */
interface Gathered {
  messages: AgUiMessage[];
  part: SubagentPart;
  at?: Part[];
}

/**
 * AG-UI messages as AI SDK `UIMessage`s: each user message, then the assistant, reasoning, tool and
 * activity messages after it grouped into one assistant message, the way the AI SDK groups a
 * multi-step run. Tool calls become dynamic tool parts with their results; with the run state,
 * streaming flags and tool-call interrupts (as approvals) are applied too. Activity messages become
 * `data-${activityType}` parts. System and developer messages are left out.
 *
 * A sub-agent's messages become one `data-signoff-subagent` part, after the tool call that started
 * it (`SUBAGENT_STARTED`'s `parentToolCallId`), which may be another sub-agent's, or else where its
 * first message was. `ToolCallTimeline` nests its calls under that call. A user message of its own,
 * the task its parent gave it, is left out, and doesn't end the parent's turn.
 */
export function fromAgUiMessages(messages: readonly AgUiMessage[], run?: AgUiRunState): UIMessage[] {
  const out: UIMessage[] = [];
  const results = new Map<string, AgUiMessage>();
  for (const message of messages)
    if (message.role === 'tool' && message.toolCallId) results.set(message.toolCallId, message);
  const streaming = (id: string) => run?.streaming.messages.includes(id) === true;
  let group: UIMessage | undefined;
  const assistant = (id: string) => {
    if (!group) {
      group = { id, role: 'assistant', parts: [] };
      out.push(group);
    }
    return group.parts;
  };
  // Sub-agents in the order they started, then any known only from their messages.
  const known = run?.subagents ?? [];
  const subagents = new Map<string, Gathered>();
  const gather = (id: string) => {
    if (!subagents.has(id))
      subagents.set(id, { messages: [], part: { type: 'data-signoff-subagent', id } as SubagentPart });
    return subagents.get(id)!;
  };
  for (const subagent of known) gather(subagent.subagentRunId);

  /** Adds an assistant, reasoning or activity message's parts. */
  const convert = (message: AgUiMessage, parts: () => Part[]) => {
    switch (message.role) {
      case 'assistant': {
        const into = parts();
        const text = typeof message.content === 'string' ? message.content : '';
        if (text) into.push({ type: 'text', text, state: streaming(message.id) ? 'streaming' : 'done' });
        for (const call of message.toolCalls ?? []) into.push(toolPart(call, results.get(call.id), run));
        break;
      }
      case 'reasoning': {
        const text = typeof message.content === 'string' ? message.content : '';
        if (text) parts().push({ type: 'reasoning', text, state: streaming(message.id) ? 'streaming' : 'done' });
        break;
      }
      case 'activity':
        parts().push({
          type: `data-${message.activityType ?? 'activity'}`,
          id: message.id,
          data: message.content,
        } as Part);
        break;
    }
  };

  for (const message of messages) {
    // A sub-agent's user message is the task its parent gave it, not the person's: it stays inside
    // the sub-agent, which shows what it did, and the parent's turn goes on.
    if (message.role === 'user' && message.subagentRunId === undefined) {
      group = undefined;
      out.push({ id: message.id, role: 'user', parts: userParts(message.content) });
    } else if (message.subagentRunId === undefined) {
      convert(message, () => assistant(message.id));
    } else if (message.role !== 'tool') {
      const found = gather(message.subagentRunId);
      if (!found.at) {
        found.at = assistant(message.id);
        found.at.push(found.part);
      }
      found.messages.push(message);
    }
  }

  for (const [id, { messages: own, part }] of subagents) {
    const parts: Part[] = [];
    for (const message of own) convert(message, () => parts);
    const state = known.find((s) => s.subagentRunId === id);
    part.data = {
      subagentRunId: id,
      parentToolCallId: state?.parentToolCallId,
      name: state?.name,
      // Without its events (history from before this page), it is running while one of its calls is.
      status:
        state?.status ??
        (parts.some((p) => p.type === 'dynamic-tool' && !p.state.startsWith('output')) ? 'running' : 'done'),
      errorText: state?.error?.message || undefined,
      parts,
    };
  }

  // Each goes after the call that started it, in the turn or in another sub-agent, never in itself.
  const homes = [...out.map((m) => m.parts), ...[...subagents.values()].map((found) => found.part.data.parts)];
  const holds = (part: SubagentPart, parts: Part[]): boolean =>
    part.data.parts === parts ||
    part.data.parts.some((p) => p.type === 'data-signoff-subagent' && holds(p as SubagentPart, parts));
  for (const { part, at } of subagents.values()) {
    for (const parts of homes) {
      let index = afterCall(parts, part.data.parentToolCallId);
      if (index === -1 || holds(part, parts)) continue;
      const from = at?.indexOf(part) ?? -1;
      if (from !== -1) {
        at!.splice(from, 1);
        if (at === parts && from < index) index--;
      }
      parts.splice(index, 0, part);
      break;
    }
  }
  return out;
}

/** Where a sub-agent started by `callId` goes in `parts`: after it and the sub-agents it started before. */
function afterCall(parts: readonly Part[], callId: string | undefined): number {
  let at = parts.findIndex((p) => p.type === 'dynamic-tool' && p.toolCallId === callId);
  if (at === -1) return -1;
  while ((parts[at + 1] as SubagentPart | undefined)?.data?.parentToolCallId === callId) at++;
  return at + 1;
}

function userParts(content: unknown): Part[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: Part[] = [];
  for (const part of content as AgUiContentPart[]) {
    if (part.type === 'text' && part.text) parts.push({ type: 'text', text: part.text });
    else if (part.source && (part.source.type === 'url' || part.source.type === 'data')) {
      const mediaType =
        part.source.mimeType ?? (part.type === 'document' ? 'application/octet-stream' : `${part.type}/*`);
      const url = part.source.type === 'url' ? part.source.value : `data:${mediaType};base64,${part.source.value}`;
      parts.push({ type: 'file', mediaType, url });
    }
  }
  return parts;
}

function toolPart(call: AgUiToolCall, result: AgUiMessage | undefined, run: AgUiRunState | undefined): Part {
  const base = { type: 'dynamic-tool' as const, toolName: call.function.name, toolCallId: call.id };
  const approval = run?.approvals[call.id];
  const decided = approval && { id: approval.id, requestReason: approval.requestReason, reason: approval.reason };
  const streaming = run?.streaming.toolCalls.includes(call.id) === true && !result;
  const input = streaming ? parsePartialJson(call.function.arguments) : parseArguments(call.function.arguments);
  // Denied, or the interrupt cancelled: the resumed run may still post a result for the call, but it was a no.
  if (approval?.approved === false)
    return { ...base, state: 'output-denied', input, approval: { ...decided!, approved: false } } as Part;
  let part: DynamicToolUIPart;
  if (result?.error) {
    part = { ...base, state: 'output-error', input, errorText: result.error };
  } else if (result) {
    part = { ...base, state: 'output-available', input, output: parseOutput(result.content) };
  } else if (streaming) {
    return { ...base, state: 'input-streaming', input };
  } else if (!approval) {
    return { ...base, state: 'input-available', input };
  } else if (approval.approved === undefined) {
    return { ...base, state: 'approval-requested', input, approval: { ...decided!, reason: undefined } } as Part;
  } else {
    return { ...base, state: 'approval-responded', input, approval: { ...decided!, approved: true } } as Part;
  }
  // A call that ran after its approval keeps it, so the timeline can say who approved it.
  return approval?.approved ? ({ ...part, approval: { ...decided!, approved: true } } as Part) : part;
}

function parseArguments(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Tool results arrive as strings; JSON objects and arrays are parsed so the timeline can show them as data. */
function parseOutput(content: unknown): unknown {
  if (Array.isArray(content)) {
    const parts = content as AgUiContentPart[];
    return parts.every((p) => p.type === 'text') ? parseOutput(parts.map((p) => p.text ?? '').join('')) : content;
  }
  if (typeof content !== 'string' || !/^\s*[[{]/.test(content)) return content;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

/**
 * Parse JSON that may be cut off mid-stream, such as tool arguments as they arrive: open strings,
 * arrays and objects are closed, and a trailing key or partial literal is dropped.
 * `{"query": "stre` gives `{ query: 'stre' }`. Returns `undefined` when nothing parses.
 */
export function parsePartialJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Cut off: repair below.
  }
  let body = text;
  const { inString, escaped } = scan(body);
  // A cut-off \u escape goes, unless its backslash is itself escaped (C:\\u...).
  if (inString)
    body = `${(escaped ? body.slice(0, -1) : body).replace(/(^|[^\\])((?:\\\\)*)\\u[0-9a-fA-F]{0,3}$/, '$1$2')}"`;
  for (;;) {
    try {
      return JSON.parse(body + scan(body).closers) as unknown;
    } catch {
      const trimmed = trimLast(body);
      if (trimmed === body) return undefined;
      body = trimmed;
    }
  }
}

function scan(text: string) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  return { inString, escaped, closers: stack.reverse().join('') };
}

/** Drop the last incomplete token: a comma, a key and its colon, a string, or a partial number or literal. */
function trimLast(body: string): string {
  const t = body.trimEnd();
  if (t.endsWith(',')) return t.slice(0, -1);
  if (t.endsWith(':')) return t.slice(0, -1).replace(/"(?:[^"\\]|\\.)*"\s*$/, '');
  if (t.endsWith('"')) return t.replace(/"(?:[^"\\]|\\.)*"$/, '');
  return t.replace(/[^\s,:[\]{}"]+$/, '');
}
