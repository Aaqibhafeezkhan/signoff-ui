import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { ApprovalRule } from 'signoff-ui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangesCard } from '../components/panels';
import { PROJECT } from '../lib/project';
import { ruleStorage } from '../lib/rule-storage';
import { proposeFix } from '../lib/scripted-edits';
import { agentTransport } from '../lib/transport';

/* The page's side, without a browser: what each request carries, what the browser keeps, and the run's changes. */

afterEach(() => vi.unstubAllGlobals());

const rule: ApprovalRule = {
  id: 'tests',
  tool: 'run_command',
  args: { command: 'npm test*' },
  effect: 'allow',
  scope: 'session',
};

describe('the transport', () => {
  it('sends the agent it was made for, and the rules getRules returns as each request goes out', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('');
    });
    let rules: ApprovalRule[] = [];
    const transport = agentTransport('live', () => rules);
    const send = () =>
      transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'run',
        messageId: undefined,
        messages: [],
        abortSignal: undefined,
      });

    await send();
    // A decision adds a rule after the transport was made: the next request takes it.
    rules = [rule];
    await send();
    expect(bodies).toEqual([
      expect.objectContaining({ mode: 'live', rules: [] }),
      expect.objectContaining({ mode: 'live', rules: [rule] }),
    ]);
  });
});

describe('your rules in this browser', () => {
  function fakeLocalStorage() {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
  }

  it('keeps your rules and the defaults you removed, and leaves the defaults to useApprovalPolicy', async () => {
    const localStorage = fakeLocalStorage();
    vi.stubGlobal('window', { localStorage });

    // A first visit: nothing saved, so the policy starts from DEFAULT_RULES alone.
    expect(await ruleStorage.load()).toEqual([]);
    expect(await ruleStorage.loadRemovedDefaults?.()).toEqual([]);

    // Saved under the key the app has always used, so rules saved before still load.
    const always = { ...rule, scope: 'always' } as const;
    await ruleStorage.save([always]);
    expect(JSON.parse(localStorage.items.get('coding-agent:approval-rules') ?? '[]')).toEqual([always]);
    expect(await ruleStorage.load()).toEqual([always]);

    // A default you remove is kept as removed, so it stays out on the next load.
    await ruleStorage.saveRemovedDefaults?.(['default:list']);
    expect(await ruleStorage.loadRemovedDefaults?.()).toEqual(['default:list']);
  });
});

describe("the run's changes", () => {
  it('puts "Copy as a patch" in the review\'s header, in its actions slot', () => {
    const files = { ...PROJECT, ...Object.fromEntries(proposeFix(PROJECT).files.map((f) => [f.path, f.content])) };
    const html = renderToString(createElement(ChangesCard, { files }));

    const review = html.indexOf('data-slot="signoff-diff-review"');
    const slot = html.indexOf('data-signoff-slot', review);
    const button = html.indexOf('>Copy as a patch</button>');
    const firstFile = html.indexOf('data-slot="signoff-diff-file"');
    expect(review).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(review);
    expect(button).toBeGreaterThan(slot);
    expect(button).toBeLessThan(firstFile);
    expect(html.split('Copy as a patch')).toHaveLength(2);
  });
});
