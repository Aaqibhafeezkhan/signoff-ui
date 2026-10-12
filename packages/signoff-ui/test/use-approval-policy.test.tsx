import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRule } from '../src/lib/policy';
import {
  memoryRuleStorage,
  useApprovalPolicy,
  webStorageRules,
  type ApprovalAuditEvent,
  type ApprovalRuleStorage,
} from '../src/use-approval-policy';

const request = (command: string, id = `a-${command}`) => ({ id, toolName: 'run_command', input: { command } });

const READ: ApprovalRule = { id: 'default:read', tool: 'read_file', effect: 'allow', scope: 'always' };
const LIST: ApprovalRule = { id: 'default:list', tool: 'list_files', effect: 'allow', scope: 'always' };
const COMMIT: ApprovalRule = {
  id: 'default:commit',
  tool: 'run_command',
  args: { command: 'git commit*' },
  effect: 'allow',
  scope: 'always',
};

/** localStorage as a Map, to look inside. */
function fakeStorage() {
  const items = new Map<string, string>();
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  } as Storage;
  return { items, storage };
}

/** A page load: the hook with these defaults, once the storage has loaded. */
async function load(storage: ApprovalRuleStorage, defaultRules: readonly ApprovalRule[]) {
  const hook = renderHook(() => useApprovalPolicy({ storage, defaultRules }));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}
const ids = (hook: { result: { current: { rules: readonly ApprovalRule[] } } }) =>
  hook.result.current.rules.map((r) => r.id);

describe('useApprovalPolicy', () => {
  it('remembers session and always decisions as rules, and answers the next call from them', async () => {
    const audit: ApprovalAuditEvent[] = [];
    const { result } = renderHook(() => useApprovalPolicy({ onAudit: (e) => audit.push(e) }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let outcome = result.current.decide(request('npm test'), 'allow-once');
    expect(outcome).toEqual({ id: 'a-npm test', approved: true, decision: 'allow-once', by: 'user', rule: undefined });
    expect(result.current.rules).toEqual([]);
    act(() => {
      outcome = result.current.decide(request('npm test --watch'), 'allow-session', { args: { command: 'npm test*' } });
    });
    expect(result.current.rules).toMatchObject([
      { tool: 'run_command', args: { command: 'npm test*' }, scope: 'session' },
    ]);
    expect(result.current.match('run_command', { command: 'npm test -- -u' })?.effect).toBe('allow');
    // A later call the rule covers is answered without anyone.
    expect(result.current.answer(request('npm test -- -u'))).toMatchObject({
      approved: true,
      decision: 'allow-session',
      by: 'rule',
    });
    expect(result.current.answer(request('npm publish'))).toBeUndefined();
    expect(result.current.outcomeOf('a-npm test -- -u')).toMatchObject({ by: 'rule' });
    expect(audit.map((e) => [e.type, 'by' in e ? e.by : undefined])).toEqual([
      ['decision', 'user'],
      ['rule-added', undefined],
      ['decision', 'user'],
      ['decision', 'rule'],
    ]);
  });

  it('denies from a deny rule with its reason, ahead of an allow rule', async () => {
    const { result } = renderHook(() => useApprovalPolicy());
    act(() => {
      result.current.decide(request('rm -rf dist'), 'allow-always');
      result.current.decide(request('rm -rf /'), 'deny-always', {
        args: { command: 'rm -rf /*' },
        reason: 'Never the root',
      });
    });
    expect(result.current.answer(request('rm -rf /home'))).toMatchObject({
      approved: false,
      decision: 'deny-always',
      reason: 'Never the root',
      by: 'rule',
    });
    expect(result.current.answer(request('rm -rf build'))).toMatchObject({ approved: true, decision: 'allow-always' });
  });

  it('answers the same request once, with the outcome it already gave', async () => {
    const onAudit = vi.fn();
    const { result } = renderHook(() =>
      useApprovalPolicy({ defaultRules: [{ id: 'r', tool: '*', effect: 'allow', scope: 'session' }], onAudit }),
    );
    const first = result.current.answer(request('ls', 'same'));
    expect(result.current.answer(request('ls', 'same'))).toBe(first);
    expect(onAudit).toHaveBeenCalledTimes(1);
  });

  it('saves always rules to the storage, never session ones, and loads them back', async () => {
    const storage = memoryRuleStorage();
    const save = vi.spyOn(storage, 'save');
    const first = renderHook(() => useApprovalPolicy({ storage }));
    act(() => {
      first.result.current.decide(request('npm ci'), 'allow-always');
      first.result.current.decide(request('npm test'), 'allow-session');
    });
    expect(save.mock.calls.at(-1)![0]).toHaveLength(1);
    expect(save.mock.calls.at(-1)![0][0]).toMatchObject({ scope: 'always' });
    first.unmount();
    const second = renderHook(() => useApprovalPolicy({ storage }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.rules).toMatchObject([{ scope: 'always' }]);
  });

  it('loads from an async storage, keeping default rules, and stays not ready until then', async () => {
    let resolve!: (rules: ApprovalRule[]) => void;
    const storage = { load: () => new Promise<ApprovalRule[]>((r) => (resolve = r)), save: vi.fn() };
    const preset: ApprovalRule = { id: 'preset', tool: 'read_file', effect: 'allow', scope: 'always' };
    const { result } = renderHook(() => useApprovalPolicy({ storage, defaultRules: [preset] }));
    expect(result.current.ready).toBe(false);
    expect(result.current.rules).toEqual([preset]);
    await act(async () => resolve([{ id: 'saved', tool: 'run_command', effect: 'deny', scope: 'always' }]));
    expect(result.current.ready).toBe(true);
    expect(result.current.rules.map((r) => r.id)).toEqual(['preset', 'saved']);
  });

  it('keeps a removed default removed across loads, and shows a default added later', async () => {
    const { items, storage: local } = fakeStorage();
    const storage = webStorageRules('rules', () => local);

    // A first visit: nothing saved, so the defaults.
    const first = await load(storage, [READ, LIST]);
    expect(ids(first)).toEqual(['default:read', 'default:list']);
    act(() => first.result.current.removeRule('default:read'));
    expect(ids(first)).toEqual(['default:list']);
    first.unmount();
    expect(JSON.parse(items.get('rules:removed-defaults')!)).toEqual(['default:read']);

    // The next visit: still removed.
    const second = await load(storage, [READ, LIST]);
    expect(ids(second)).toEqual(['default:list']);
    second.unmount();

    // A later version of the app adds a default: it appears, and the removed one stays removed.
    const third = await load(storage, [READ, LIST, COMMIT]);
    expect(ids(third)).toEqual(['default:list', 'default:commit']);
    expect(third.result.current.match('read_file', { path: 'a.ts' })).toBeUndefined();
  });

  it('keeps every default removed once all are, and brings one back when it is added again', async () => {
    const storage = memoryRuleStorage();
    const first = await load(storage, [READ, LIST]);
    act(() => {
      first.result.current.removeRule('default:read');
      first.result.current.removeRule('default:list');
    });
    first.unmount();
    const second = await load(storage, [READ, LIST]);
    expect(ids(second)).toEqual([]);

    // "Reset": the default added back, as the app's own rule.
    act(() => second.result.current.addRule({ ...READ }));
    second.unmount();
    const third = await load(storage, [READ, LIST]);
    expect(ids(third)).toEqual(['default:read']);
  });

  it('keeps rules saved before removed defaults were kept, and brings back session defaults', async () => {
    const { items, storage: local } = fakeStorage();
    // Saved by an earlier version: always rules, no removed defaults.
    items.set('rules', JSON.stringify([LIST, { id: 'mine', tool: 'run_command', effect: 'deny', scope: 'always' }]));
    const session: ApprovalRule = { id: 'default:session', tool: 'search', effect: 'allow', scope: 'session' };
    const storage = webStorageRules('rules', () => local);
    const first = await load(storage, [READ, LIST, session]);
    expect(ids(first)).toEqual(['default:read', 'default:list', 'default:session', 'mine']);

    // Clearing the session's rules removes no default for good.
    act(() => first.result.current.clearSession());
    expect(ids(first)).toEqual(['default:read', 'default:list', 'mine']);
    first.unmount();
    expect(items.has('rules:removed-defaults')).toBe(false);
    const second = await load(storage, [READ, LIST, session]);
    expect(ids(second)).toEqual(['default:read', 'default:list', 'default:session', 'mine']);
  });

  it('brings a removed default back with a storage that keeps no removed defaults', async () => {
    const saved = memoryRuleStorage();
    const storage: ApprovalRuleStorage = { load: () => saved.load(), save: (rules) => saved.save(rules) };
    const first = await load(storage, [READ, LIST]);
    act(() => first.result.current.removeRule('default:read'));
    first.unmount();
    expect(ids(await load(storage, [READ, LIST]))).toEqual(['default:read', 'default:list']);
  });

  it('loads removed defaults from an async storage, and the rules when they fail to load', async () => {
    const saved = memoryRuleStorage([LIST]);
    const removed = vi.fn(() => Promise.resolve(['default:read']));
    const storage: ApprovalRuleStorage = {
      load: () => saved.load(),
      save: (rules) => saved.save(rules),
      loadRemovedDefaults: removed,
      saveRemovedDefaults: vi.fn(),
    };
    expect(ids(await load(storage, [READ, LIST]))).toEqual(['default:list']);
    removed.mockImplementation(() => Promise.reject(new Error('offline')));
    expect(ids(await load(storage, [READ, LIST]))).toEqual(['default:read', 'default:list']);
  });

  it('is ready after a storage that fails to load', async () => {
    const storage = { load: () => Promise.reject(new Error('offline')), save: vi.fn() };
    const { result } = renderHook(() => useApprovalPolicy({ storage }));
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it('follows controlled rules, and reports changes', () => {
    const onRulesChange = vi.fn();
    const rules: ApprovalRule[] = [{ id: 'r', tool: 'run_command', effect: 'allow', scope: 'always' }];
    const { result, rerender } = renderHook(
      (props: { rules: ApprovalRule[] }) => useApprovalPolicy({ ...props, onRulesChange }),
      {
        initialProps: { rules },
      },
    );
    expect(result.current.match('run_command', {})?.rule.id).toBe('r');
    act(() => result.current.removeRule('r'));
    expect(onRulesChange).toHaveBeenLastCalledWith([]);
    // Still controlled: the rules are the caller's until it passes new ones.
    rerender({ rules });
    expect(result.current.rules).toEqual(rules);
  });

  it('adds and removes rules, and clears the session ones', () => {
    const audit: ApprovalAuditEvent[] = [];
    const { result } = renderHook(() => useApprovalPolicy({ onAudit: (e) => audit.push(e) }));
    act(() => {
      result.current.addRule({ id: 'a', tool: 'x', effect: 'allow', scope: 'always' });
      result.current.addRule({ id: 's', tool: 'y', effect: 'allow', scope: 'session' });
      // The same id replaces the rule.
      result.current.addRule({ id: 'a', tool: 'z', effect: 'allow', scope: 'always' });
    });
    expect(result.current.rules.map((r) => [r.id, r.tool])).toEqual([
      ['s', 'y'],
      ['a', 'z'],
    ]);
    act(() => result.current.clearSession());
    expect(result.current.rules.map((r) => r.id)).toEqual(['a']);
    act(() => {
      result.current.clearSession();
      result.current.removeRule('missing');
      result.current.removeRule('a');
    });
    expect(result.current.rules).toEqual([]);
    expect(audit.map((e) => e.type)).toEqual([
      'rule-added',
      'rule-added',
      'rule-added',
      'session-cleared',
      'rule-removed',
    ]);
  });
});
