/*
 * What the home page says the components do, against what they do.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const landing = readFileSync(join(import.meta.dirname, '../components/landing.tsx'), 'utf8');

/** The body of one of the "Works with" cards, as one line of text. */
function card(title: string) {
  const start = landing.indexOf(`title: '${title}'`);
  assert.notEqual(start, -1, `no card titled ${title}`);
  const body = /body: \(\s*<>([\s\S]*?)<\/>/.exec(landing.slice(start))?.[1] ?? '';
  return body.replace(/\s+/g, ' ').trim();
}

describe('the Agent Client Protocol card', () => {
  it('says the approval card answers by kind of option, not with the agent’s labels', () => {
    // signoff-ui/acp reduces the agent's options to their kind, and Always answers with an
    // allow_always option the card does not name: with Claude Code's ExitPlanMode, the one that
    // clears the context and turns on auto mode.
    const text = card('Agent Client Protocol');
    assert.doesNotMatch(text, /agent’s own options/);
    assert.match(text, /maps the agent’s options to Approve, Always and Deny/);
  });
});
