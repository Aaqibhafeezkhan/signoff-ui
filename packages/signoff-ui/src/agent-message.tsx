'use client';

import { AgentMessageBase, type AgentMessageProps } from './agent-message-base';
import { Markdown } from './markdown';

export type { AgentMessageProps } from './agent-message-base';

/**
 * Renders an assistant `UIMessage` part by part: streaming markdown, collapsible
 * reasoning, consecutive tool calls grouped into a timeline (with inline approval
 * cards), files, and the message's sources with linked inline citations.
 */
export function AgentMessage(props: AgentMessageProps) {
  return <AgentMessageBase {...props} builtInMarkdown={Markdown} />;
}
