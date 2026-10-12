import type { LanguageModelUsage, UIMessage } from 'ai';

/** Who plays the agent: the scripted model (no key), or a real one (OPENAI_API_KEY set). */
export type Mode = 'scripted' | 'live';

export interface RunMetadata {
  /** The model's id, for the run meter. */
  model?: string;
  /** Tokens across the run so far, review and approval round trips included. */
  usage?: LanguageModelUsage;
}

export type RunMessage = UIMessage<RunMetadata>;
