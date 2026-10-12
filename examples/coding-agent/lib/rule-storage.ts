import { webStorageRules, type ApprovalRuleStorage } from 'signoff-ui';
import { DEFAULT_RULES } from './rules';

const KEY = 'coding-agent:approval-rules';
const saved = webStorageRules(KEY);

function hasSaved() {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Your "always" rules, in localStorage: the defaults until you change them, then yours, even when
 * you remove them all. Session rules are never saved.
 */
export const ruleStorage: ApprovalRuleStorage = {
  load: () => (hasSaved() ? saved.load() : DEFAULT_RULES),
  save: (rules) => saved.save(rules),
};
