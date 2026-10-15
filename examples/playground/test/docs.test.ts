/*
 * The docs pages' titles and descriptions (lib/docs.ts), which the browser tab, previous and next,
 * search, llms.txt and the link previews show, against what the pages say. Needs the library built
 * (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getGuide, plainText, readGuide } from '../lib/docs';

/** The bold names that open the bullets under a `##` heading. */
function boldBullets(markdown: string, heading: string) {
  const section = markdown.split(/^## /m).find((part) => part.startsWith(`${heading}\n`)) ?? '';
  return [...section.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => plainText(match[1]!));
}

describe('the comparison page', () => {
  const doc = getGuide('comparison')!;
  const compared = boldBullets(readGuide(doc), 'What they do better');

  it('compares with more than one project', () => {
    assert.ok(compared.length > 1, `found ${JSON.stringify(compared)} under "What they do better"`);
  });

  it('names every project it compares with in its title and description', () => {
    for (const name of compared) {
      assert.ok(doc.title.includes(name), `the title "${doc.title}" leaves out ${name}`);
      assert.ok(doc.description.includes(name), `the description "${doc.description}" leaves out ${name}`);
    }
  });
});
