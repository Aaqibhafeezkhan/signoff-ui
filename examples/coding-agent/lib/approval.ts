import { toToolApproval, type ApprovalRule, type ToolApprovalStatusLike } from 'signoff-ui/core';
import { SERVER_RULES } from './rules';

/** Why a tool asks, shown on its approval card. */
const ASK: Record<string, string> = {
  list_files: 'Lists the files in the repository.',
  read_file: 'Reads a file in the repository.',
  run_command: 'Runs a shell command in the repository.',
};

/**
 * AI SDK 7's `toolApproval`, from the rules: the server's first, which no rule from the page can
 * override, then the person's own (sent with each request), and a person decides the rest. The
 * review tool needs none: the review is the approval.
 */
export function approvalFor(rules: readonly ApprovalRule[]) {
  const server = toToolApproval(SERVER_RULES, { otherwise: 'not-applicable' });
  const yours = toToolApproval(rules);
  return (options: { toolCall: { toolName: string; input: unknown } }): ToolApprovalStatusLike => {
    const { toolName } = options.toolCall;
    if (toolName === 'review_changes') return 'not-applicable';
    const decided = server(options);
    if (decided !== 'not-applicable') return decided;
    const status = yours(options);
    return status === 'user-approval' ? { type: 'user-approval', reason: ASK[toolName] } : status;
  };
}
