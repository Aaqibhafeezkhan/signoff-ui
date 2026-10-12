import { DefaultChatTransport } from 'ai';
import type { ApprovalRule } from 'signoff-ui/core';
import type { Mode, RunMessage } from './types';

/**
 * The page's transport to app/api/agent/route.ts. Besides the messages, each request carries the
 * agent to use and your rules: `getRules` is `useApprovalPolicy`'s, called as the request goes out,
 * so a rule a decision just made (a "For this session") goes with the approval that made it.
 */
export function agentTransport(mode: Mode, getRules: () => ApprovalRule[]) {
  return new DefaultChatTransport<RunMessage>({
    api: '/api/agent',
    body: () => ({ mode, rules: getRules() }),
  });
}
