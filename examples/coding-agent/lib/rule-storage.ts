import { webStorageRules } from 'signoff-ui';

/**
 * Your "always" rules, in localStorage, and the default rules you removed, so they stay removed.
 * Session rules are never saved. `useApprovalPolicy` starts from the defaults (`DEFAULT_RULES`).
 */
export const ruleStorage = webStorageRules('coding-agent:approval-rules');
