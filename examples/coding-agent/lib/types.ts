import type { LanguageModelUsage, UIMessage } from 'ai';

/**
 * Who plays the agent: the scripted model (the default), or a real one, offered when the server has
 * OPENAI_API_KEY and LIVE_MODE=1.
 */
export type Mode = 'scripted' | 'live';

export interface RunMetadata {
  /** The model's id, for the run meter. */
  model?: string;
  /** Tokens across the run so far, review and approval round trips included. */
  usage?: LanguageModelUsage;
}

export type RunMessage = UIMessage<RunMetadata>;
