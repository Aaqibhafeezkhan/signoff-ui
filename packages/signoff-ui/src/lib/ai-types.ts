/**
 * The AI SDK types the AG-UI and ACP adapters return, declared here so those entries import nothing
 * from `ai`, an optional peer that their apps need not install. Each is the part of the AI SDK 6 and 7
 * type of the same name that the adapters produce, so what they return goes to `AgentMessage`,
 * `useChat` and anything else typed with `ai` as it is (test/peer-dependencies.test.ts checks it).
 */

/** The AI SDK's `ChatStatus`. */
export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

/** The AI SDK's `LanguageModelUsage`, without the provider's `raw` usage. */
export interface LanguageModelUsage {
  inputTokens: number | undefined;
  inputTokenDetails: {
    noCacheTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
  };
  outputTokens: number | undefined;
  outputTokenDetails: {
    textTokens: number | undefined;
    reasoningTokens: number | undefined;
  };
  totalTokens: number | undefined;
}

/** Token usage, compatible with the AI SDK `LanguageModelUsage` shape (the same type as lib/ai.ts's). */
export type RunUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  inputTokenDetails?: Partial<LanguageModelUsage['inputTokenDetails']> | undefined;
  outputTokenDetails?: Partial<LanguageModelUsage['outputTokenDetails']> | undefined;
};

/** What AI SDK 7 adds to a tool call's approval, which AI SDK 6 leaves out. */
type ApprovalExtras = { requestReason?: string; isAutomatic?: boolean };
/** A tool call's approval, once answered. */
type Answered<Approved extends boolean> = { id: string; approved: Approved; reason?: string } & ApprovalExtras;

/**
 * The AI SDK's `DynamicToolUIPart`, a tool call in each of its states. A streaming call's `input` is
 * there even when undefined: AI SDK 6.0.0 requires the key, later releases make it optional.
 */
export type DynamicToolUIPart = {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  title?: string;
  providerExecuted?: boolean;
} & (
  | { state: 'input-streaming'; input: unknown; output?: never; errorText?: never; approval?: never }
  | { state: 'input-available'; input: unknown; output?: never; errorText?: never; approval?: never }
  | {
      state: 'approval-requested';
      input: unknown;
      output?: never;
      errorText?: never;
      approval: { id: string; approved?: never; reason?: never } & ApprovalExtras;
    }
  | { state: 'approval-responded'; input: unknown; output?: never; errorText?: never; approval: Answered<boolean> }
  | { state: 'output-available'; input: unknown; output: unknown; errorText?: never; approval?: Answered<true> }
  | { state: 'output-error'; input: unknown; output?: never; errorText: string; approval?: Answered<true> }
  | { state: 'output-denied'; input: unknown; output?: never; errorText?: never; approval: Answered<false> }
);

/** The parts the adapters make: text, reasoning, files, tool calls, and `data-*` parts such as sub-agents. */
export type UIMessagePart =
  | { type: 'text'; text: string; state?: 'streaming' | 'done' }
  | { type: 'reasoning'; text: string; state?: 'streaming' | 'done' }
  | { type: 'file'; mediaType: string; filename?: string; url: string }
  | DynamicToolUIPart
  | { type: `data-${string}`; id?: string; data: unknown };

/** The AI SDK's `UIMessage`, with the parts above. */
export interface UIMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  metadata?: unknown;
  parts: UIMessagePart[];
}

/** Where a sub-agent is: working, finished, failed, or paused until a later run (AG-UI's `suspended`). */
export type SubagentStatus = 'running' | 'done' | 'error' | 'suspended';

/** A sub-agent's work, in its parent's message (lib/ai.ts's `SubagentPart`, with these parts). */
export interface SubagentPart {
  type: 'data-signoff-subagent';
  id?: string;
  data: {
    subagentRunId: string;
    parentToolCallId?: string | undefined;
    name?: string | undefined;
    status: SubagentStatus;
    errorText?: string | undefined;
    parts: UIMessagePart[];
  };
}
