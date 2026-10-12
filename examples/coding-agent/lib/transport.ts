import { DefaultChatTransport } from 'ai';
import type { ApprovalRule } from 'signoff-ui/core';
import { plainRule } from './rules';
import type { Mode, RunMessage } from './types';

/** What each request carries besides the messages, read as it goes: the agent, and your rules. */
const outgoing: { mode: Mode; rules: readonly ApprovalRule[] } = { mode: 'scripted', rules: [] };

/** Update what the next request carries. Rules change between requests, so they are read late. */
export function setOutgoing(next: Partial<typeof outgoing>) {
  Object.assign(outgoing, next);
}

/** The page's transport to app/api/agent/route.ts. */
export const transport = new DefaultChatTransport<RunMessage>({
  api: '/api/agent',
  body: () => ({ mode: outgoing.mode, rules: outgoing.rules.map(plainRule) }),
});
