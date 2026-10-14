'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decisionEffect,
  evaluateRules,
  ruleFromDecision,
  toPlainRules,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalRule,
  type RuleMatch,
} from './lib/policy';
import { approvalPolicyLabels, type SignoffLabelsInput } from './lib/labels';
import { useLabels } from './labels';

/** The labels' sections this module reads. */
const LABELS = { approvalPolicy: approvalPolicyLabels };

export type { ApprovalDecision, ApprovalRequest, ApprovalRule, RuleMatch } from './lib/policy';

/**
 * Where `always` rules are kept between visits. Session rules are never saved, and nor is a rule
 * with a `when`: `when` is code, and without it the rule would cover more calls than it does.
 */
export interface ApprovalRuleStorage {
  load(): readonly ApprovalRule[] | PromiseLike<readonly ApprovalRule[]>;
  save(rules: readonly ApprovalRule[]): void | PromiseLike<void>;
  /**
   * The ids of `always` default rules the person removed, so they stay removed on the next load.
   * Optional: without this and `saveRemovedDefaults`, a removed default comes back on each load.
   */
  loadRemovedDefaults?(): readonly string[] | PromiseLike<readonly string[]>;
  saveRemovedDefaults?(ids: readonly string[]): void | PromiseLike<void>;
}

/** Rules kept in memory, for this page only: the default. */
export function memoryRuleStorage(initial: readonly ApprovalRule[] = []): ApprovalRuleStorage {
  let rules = [...initial];
  let removed: string[] = [];
  return {
    load: () => rules,
    save: (next) => {
      rules = [...next];
    },
    loadRemovedDefaults: () => removed,
    saveRemovedDefaults: (ids) => {
      removed = [...ids];
    },
  };
}

/**
 * Rules kept in `localStorage` (or another `Storage`) as JSON under `key`, and the ids of default
 * rules the person removed under `<key>:removed-defaults`. A rule with a `when` is not kept: JSON
 * can't hold the code. Nothing is read or written on the server.
 */
export function webStorageRules(
  key = 'signoff-ui:approval-rules',
  storage: () => Storage | undefined = () => (typeof window === 'undefined' ? undefined : window.localStorage),
): ApprovalRuleStorage {
  const read = (name: string): unknown[] => {
    try {
      const text = storage()?.getItem(name);
      const parsed: unknown = text ? JSON.parse(text) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (name: string, value: unknown) => {
    try {
      storage()?.setItem(name, JSON.stringify(value));
    } catch {
      // Full or blocked storage: the rules still hold for this page.
    }
  };
  const removedKey = `${key}:removed-defaults`;
  return {
    load: () => read(key).filter(isRule),
    // Not a rule with a `when`: JSON would keep it without the `when`, covering more calls.
    save: (rules) =>
      write(
        key,
        rules.filter((rule) => !rule.when),
      ),
    loadRemovedDefaults: () => read(removedKey).filter((id): id is string => typeof id === 'string'),
    saveRemovedDefaults: (ids) => write(removedKey, ids),
  };
}

function isRule(value: unknown): value is ApprovalRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<ApprovalRule>;
  return (
    typeof rule.id === 'string' &&
    typeof rule.tool === 'string' &&
    (rule.effect === 'allow' || rule.effect === 'deny') &&
    (rule.scope === 'session' || rule.scope === 'always') &&
    (rule.args === undefined ||
      (typeof rule.args === 'object' && Object.values(rule.args).every((v) => typeof v === 'string')))
  );
}

/** Everything the policy did, for an audit trail. */
export type ApprovalAuditEvent =
  | {
      type: 'decision';
      at: number;
      request: ApprovalRequest;
      decision: ApprovalDecision;
      /** A person decided, or one of the rules did. */
      by: 'user' | 'rule';
      /** The rule that decided, or the one this decision made. */
      rule?: ApprovalRule | undefined;
      reason?: string | undefined;
      /** The arguments as approved, when the person edited them. */
      input?: unknown;
    }
  | { type: 'rule-added' | 'rule-removed'; at: number; rule: ApprovalRule }
  | { type: 'session-cleared'; at: number; rules: ApprovalRule[] };

/** A decision, ready to send: `approved` and `reason` for the agent, the rest for your app. */
export interface ApprovalOutcome {
  id: string;
  approved: boolean;
  reason?: string | undefined;
  /** The arguments to run with, when the person edited them. */
  input?: unknown;
  decision: ApprovalDecision;
  by: 'user' | 'rule';
  rule?: ApprovalRule | undefined;
}

export interface UseApprovalPolicyOptions {
  /** Controlled rules. */
  rules?: readonly ApprovalRule[] | undefined;
  /**
   * Rules to start with, before any the storage loads. An `always` default the person removes stays
   * removed on later loads, with a storage that keeps removed defaults (`webStorageRules` and
   * `memoryRuleStorage` do). A default you add later appears, removed ones aside.
   */
  defaultRules?: readonly ApprovalRule[] | undefined;
  onRulesChange?: ((rules: ApprovalRule[]) => void) | undefined;
  /** Where `always` rules are loaded from and saved to. Default: memory, for this page. */
  storage?: ApprovalRuleStorage | undefined;
  /** Every decision, rule added or removed, and session cleared, as it happens. */
  onAudit?: ((event: ApprovalAuditEvent) => void) | undefined;
  /**
   * Words to use instead of the English defaults: the reason a deny rule without one of its own
   * sends (`labels.approvalPolicy.ruleDenial`). See `SignoffLabelsProvider`.
   */
  labels?: SignoffLabelsInput | undefined;
}

export interface ApprovalPolicy {
  rules: readonly ApprovalRule[];
  /**
   * The rules as they are now, as plain data to send with a request (see `toPlainRules`: a rule
   * with a `when` stays on the page, and a deny one keeps back the allow rules it would overrule,
   * so the server asks about those calls). The same function for the policy's life, so a transport
   * made once can call it in `body`, and it has a rule a decision just made before the page re-renders.
   */
  getRules(): ApprovalRule[];
  /** The storage has loaded: after the first render, or once an async storage's promise settles. */
  ready: boolean;
  /** The rule that decides a call, if one does. */
  match(toolName: string, input: unknown): RuleMatch | undefined;
  /**
   * Record a person's decision and the rule it leaves (for session and always decisions, over the
   * call's `args` when given, else every call of the tool), and return it ready to send.
   */
  decide(
    request: ApprovalRequest,
    decision: ApprovalDecision,
    options?: { reason?: string | undefined; input?: unknown; args?: Record<string, string> | undefined },
  ): ApprovalOutcome;
  /** Answer a request from the rules, if one matches, recorded as decided by that rule. */
  answer(request: ApprovalRequest): ApprovalOutcome | undefined;
  /** How an answered request was decided, by its id: by a person or by which rule. */
  outcomeOf(id: string): ApprovalOutcome | undefined;
  addRule(rule: ApprovalRule): void;
  removeRule(id: string): void;
  /** Forget the session rules. */
  clearSession(): void;
}

/**
 * Approval rules, held for the page: once, for the session or always, scoped by tool and by
 * argument patterns, deny winning over allow. Pass the policy to `ToolApprovalCard`, `AgentMessage`
 * or `ToolApprovalBatch`, and they offer the choices, answer what a rule already decides, and record
 * the rest. Persistence is pluggable: `always` rules go to `storage`, session rules stay in memory.
 */
export function useApprovalPolicy({
  rules: rulesProp,
  defaultRules = [],
  onRulesChange,
  storage: storageProp,
  onAudit,
  labels,
}: UseApprovalPolicyOptions = {}): ApprovalPolicy {
  const ruleDenial = useLabels(LABELS, labels).approvalPolicy.ruleDenial;
  const [fallbackStorage] = useState(() => memoryRuleStorage());
  const storage = storageProp ?? fallbackStorage;
  // The storage is read after the first render, on the client: a server render and the hydrating
  // client then agree, whatever is stored.
  const [own, setOwn] = useState<readonly ApprovalRule[]>(defaultRules);
  const [ready, setReady] = useState(false);
  const rules = rulesProp ?? own;
  // The latest rules for handlers that run before a re-render, such as two answers in one tick.
  const latest = useRef(rules);
  useEffect(() => {
    latest.current = rules;
  }, [rules]);
  const outcomes = useRef(new Map<string, ApprovalOutcome>());
  // The ids of `always` defaults the person removed, as last loaded or saved.
  const removedDefaults = useRef<readonly string[]>([]);

  // Loaded once, from the storage the policy started with: an inline storage object (a new one on
  // every render) does not reload it. Saves go to the current one.
  const [loadFrom] = useState(storage);
  useEffect(() => {
    let live = true;
    const apply = ([loaded, removed]: readonly [readonly ApprovalRule[], readonly string[]]) => {
      if (!live) return;
      removedDefaults.current = removed;
      // The defaults, less the ones the person removed, then the saved rules, which win.
      const gone = new Set(removed);
      setOwn((current) => merge(gone.size ? current.filter((r) => !gone.has(r.id)) : current, loaded));
      setReady(true);
    };
    const loaded = loadFrom.load();
    const removed = loadFrom.loadRemovedDefaults?.() ?? [];
    if (isThenable(loaded) || isThenable(removed)) {
      // Removed defaults that fail to load leave the defaults as they are; the saved rules still load.
      const removedOrNone = Promise.resolve(removed).then(undefined, () => []);
      Promise.all([loaded, removedOrNone]).then(apply, () => live && setReady(true));
    } else apply([loaded, removed]);
    return () => {
      live = false;
    };
  }, [loadFrom]);

  const audit = (event: ApprovalAuditEvent) => onAudit?.(event);
  const setRules = (next: ApprovalRule[]) => {
    latest.current = next;
    if (rulesProp === undefined) setOwn(next);
    onRulesChange?.(next);
    // A rule with a `when` stays in memory: saved, it would load without it.
    void storage.save(next.filter((r) => r.scope === 'always' && !r.when));
    if (storage.saveRemovedDefaults) {
      // An `always` default missing from the rules was removed; one that is back was restored.
      const kept = new Set(next.map((r) => r.id));
      const defaults = defaultRules.filter((r) => r.scope === 'always').map((r) => r.id);
      const removed = [...new Set([...removedDefaults.current, ...defaults])].filter((id) => !kept.has(id));
      if (removed.join('\n') !== removedDefaults.current.join('\n')) {
        removedDefaults.current = removed;
        void storage.saveRemovedDefaults(removed);
      }
    }
  };

  const record = (outcome: ApprovalOutcome) => {
    outcomes.current.set(outcome.id, outcome);
    return outcome;
  };
  const getRules = useCallback(() => toPlainRules(latest.current), []);

  return {
    rules,
    getRules,
    ready,
    match: (toolName, input) => evaluateRules(latest.current, toolName, input),
    decide(request, decision, { reason, input, args } = {}) {
      const rule = ruleFromDecision(decision, request, { args, reason });
      if (rule) {
        setRules([...latest.current, rule]);
        audit({ type: 'rule-added', at: Date.now(), rule });
      }
      const { approved } = decisionEffect(decision);
      audit({
        type: 'decision',
        at: Date.now(),
        request,
        decision,
        by: 'user',
        rule,
        ...(reason ? { reason } : {}),
        ...(input !== undefined ? { input } : {}),
      });
      return record({
        id: request.id,
        approved,
        ...(reason ? { reason } : {}),
        ...(input !== undefined ? { input } : {}),
        decision,
        by: 'user',
        rule,
      });
    },
    answer(request) {
      const known = outcomes.current.get(request.id);
      if (known) return known;
      const match = evaluateRules(latest.current, request.toolName, request.input);
      if (!match) return undefined;
      const decision: ApprovalDecision =
        match.effect === 'allow' ? (match.rule.scope === 'session' ? 'allow-session' : 'allow-always') : 'deny-always';
      const reason = match.effect === 'deny' ? (match.rule.reason ?? ruleDenial) : undefined;
      audit({ type: 'decision', at: Date.now(), request, decision, by: 'rule', rule: match.rule, reason });
      return record({
        id: request.id,
        approved: match.effect === 'allow',
        ...(reason ? { reason } : {}),
        decision,
        by: 'rule',
        rule: match.rule,
      });
    },
    outcomeOf: (id) => outcomes.current.get(id),
    addRule(rule) {
      setRules([...latest.current.filter((r) => r.id !== rule.id), rule]);
      audit({ type: 'rule-added', at: Date.now(), rule });
    },
    removeRule(id) {
      const rule = latest.current.find((r) => r.id === id);
      if (!rule) return;
      setRules(latest.current.filter((r) => r.id !== id));
      audit({ type: 'rule-removed', at: Date.now(), rule });
    },
    clearSession() {
      const session = latest.current.filter((r) => r.scope === 'session');
      if (session.length === 0) return;
      setRules(latest.current.filter((r) => r.scope !== 'session'));
      audit({ type: 'session-cleared', at: Date.now(), rules: session });
    },
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Rules from both lists, the later one winning for an id that repeats, but not over a rule with a
 * `when`: an earlier version saved such a rule without it.
 */
function merge(first: readonly ApprovalRule[], second: readonly ApprovalRule[]): ApprovalRule[] {
  const byId = new Map(first.map((r) => [r.id, r]));
  for (const rule of second) if (!byId.get(rule.id)?.when) byId.set(rule.id, rule);
  return [...byId.values()];
}
