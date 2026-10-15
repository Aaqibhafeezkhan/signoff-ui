/*
 * /llms.txt and /llms-full.txt, which coding agents read: built from the README with its badges
 * taken out, they still say what the kit works with, and no label is left on a line of its own.
 * Needs the library built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { llmsFullTxt, llmsTxt } from '../lib/llms';

const readme = readFileSync(join(import.meta.dirname, '../../../README.md'), 'utf8');
const files = { '/llms.txt': llmsTxt(), '/llms-full.txt': llmsFullTxt() };

describe('the README in /llms.txt and /llms-full.txt', () => {
  for (const [path, text] of Object.entries(files)) {
    it(`${path}: leaves no bold label alone on a line`, () => {
      let fenced = false;
      const bare = text.split('\n').filter((line) => {
        if (line.startsWith('```')) fenced = !fenced;
        return !fenced && /^\*\*[^*]+\*\*:?$/.test(line.trim());
      });
      assert.deepEqual(bare, []);
    });

    it(`${path}: lists what the kit works with, each linked to its docs`, () => {
      const line = text.split('\n').find((l) => l.startsWith('**Works with:**')) ?? '';
      for (const name of ['AI SDK 6 and 7', 'AI Elements', 'assistant-ui', 'AG-UI', 'ACP'])
        assert.match(line, new RegExp(`\\[${name}\\]\\(https://signoff-ui\\.vercel\\.app/docs/[\\w#-]+\\)`), name);
    });
  }

  it('/llms.txt opens on the README’s lead line', () => {
    assert.equal(files['/llms.txt'].split('\n')[2], `> ${readme.split('\n')[2] ?? ''}`);
  });
});
