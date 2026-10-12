import type { ApprovalRule } from 'signoff-ui/core';

/*
 * Approval rules. A rule allows or denies a tool's calls, all of them or those whose arguments match
 * a glob, so nobody is asked. Deny wins over allow.
 */

/**
 * The server's rules: they hold for everyone, whatever the page sends, and the page can't remove
 * them. Rules that protect other people belong here, not in the browser.
 */
export const SERVER_RULES: readonly ApprovalRule[] = [
  {
    id: 'server:no-push',
    tool: 'run_command',
    args: { command: 'git push*' },
    effect: 'deny',
    scope: 'always',
    reason: 'A person pushes and opens the pull request.',
  },
];

/**
 * Your rules on a first visit: reading and committing need no approval. They live in this browser
 * (localStorage) with the ones you add with "Always". One you remove stays removed; "Reset" puts
 * these back.
 */
export const DEFAULT_RULES: readonly ApprovalRule[] = [
  { id: 'default:list', tool: 'list_files', effect: 'allow', scope: 'always' },
  { id: 'default:read', tool: 'read_file', effect: 'allow', scope: 'always' },
  { id: 'default:commit', tool: 'run_command', args: { command: 'git commit*' }, effect: 'allow', scope: 'always' },
];
