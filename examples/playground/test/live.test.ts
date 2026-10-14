/*
 * Live mode is opt-in: a key set for Ask must not open the chat route to everyone.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveModeEnabled } from '../lib/live';

describe('live mode', () => {
  it('stays off with only the key', () => {
    assert.equal(liveModeEnabled({ OPENAI_API_KEY: 'k' }), false);
  });

  it('stays off without a key', () => {
    assert.equal(liveModeEnabled({ LIVE_MODE: '1' }), false);
    assert.equal(liveModeEnabled({ LIVE_MODE: '1', OPENAI_API_KEY: '' }), false);
  });

  it('turns on with the key and LIVE_MODE=1 only', () => {
    assert.equal(liveModeEnabled({ OPENAI_API_KEY: 'k', LIVE_MODE: '1' }), true);
    assert.equal(liveModeEnabled({ OPENAI_API_KEY: 'k', LIVE_MODE: 'true' }), false);
  });
});
