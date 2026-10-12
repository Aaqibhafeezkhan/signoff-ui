'use client';

/**
 * `signoff-ui/custom-markdown`: `AgentMessage` and `Reasoning` for your own Markdown renderer, such
 * as Streamdown, without react-markdown. Pass `renderMarkdown`, or set it once with
 * `MarkdownRendererProvider`; without one, text shows as it is.
 */
import { AgentMessageBase, type AgentMessageProps } from './agent-message-base';
import { PlainText } from './markdown-renderer';
import { ReasoningBase, type ReasoningProps } from './reasoning-base';

export type { AgentMessageProps } from './agent-message-base';
export type { ReasoningProps } from './reasoning-base';
export {
  MarkdownRendererProvider,
  type MarkdownRenderer,
  type MarkdownRendererProps,
  type MarkdownRendererProviderProps,
} from './markdown-renderer';

/** `AgentMessage` from the main entry, without its built-in Markdown renderer: pass `renderMarkdown`. */
export function AgentMessage(props: AgentMessageProps) {
  return <AgentMessageBase {...props} builtInMarkdown={PlainText} />;
}

/** `Reasoning` from the main entry, without its built-in Markdown renderer: pass `renderMarkdown`. */
export function Reasoning(props: ReasoningProps) {
  return <ReasoningBase {...props} builtInMarkdown={PlainText} />;
}
