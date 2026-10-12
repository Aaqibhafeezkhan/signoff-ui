import type { Files } from './project';
import type { ProposedFiles } from './tools';

/*
 * The scripted agent's edits, made on the files as they are: the fix, then the revision a review
 * comment asks for. Each is a change to what is there, so a revision builds on what you applied.
 */

const SRC = 'src/slugify.ts';
const TEST = 'test/slugify.test.ts';
const README = 'README.md';

const DOC = ' * Turns a title into a URL slug: lowercase words of letters and digits, joined by `separator`.\n';
const DOC_ACCENTS = ' * Accented letters keep their base letter.\n';
const DOC_LETTERS = ' * Accented letters keep their base letter, and letters such as ß are spelled out.\n';
const SPLIT = 'const words = text.toLowerCase().split(';
const SPLIT_STRIPPED = 'const words = stripAccents(text.toLowerCase()).split(';

const STRIP = `
/** "é" becomes "e": split each letter from its accents, then drop the accents. */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
}
`;

const STRIP_AND_SPELL = `
/** Letters with no accent to strip, spelled out: "ß" becomes "ss". */
const LETTERS: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th' };

/** "é" becomes "e": split each letter from its accents, then drop the accents. */
function stripAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[ßæœøłđþ]/g, (letter) => LETTERS[letter] ?? letter);
}
`;

const ACCENTS_TEST = `
test('strips accents', () => {
  assert.equal(slugify('Crème brûlée'), 'creme-brulee');
});
`;

const LETTERS_TEST = `
test('spells out letters with no accent to strip', () => {
  assert.equal(slugify('Straße'), 'strasse');
  assert.equal(slugify('Smørrebrød'), 'smorrebrod');
});
`;

const README_LAST = "slugify('Hello World', '_'); // 'hello_world'\n";
const README_ACCENTS = "slugify('Crème brûlée'); // 'creme-brulee'\n";

/** Whether the project strips accents already. */
export function hasFix(files: Files): boolean {
  return (files[SRC] ?? '').includes('stripAccents');
}

/** The fix: accents stripped before the words are split, a test, and an example in the README. */
export function proposeFix(files: Files): ProposedFiles {
  const src = files[SRC] ?? '';
  return {
    files: [
      { path: SRC, content: src.replace(DOC, DOC + DOC_ACCENTS).replace(SPLIT, SPLIT_STRIPPED) + STRIP },
      { path: TEST, content: (files[TEST] ?? '') + ACCENTS_TEST },
      { path: README, content: (files[README] ?? '').replace(README_LAST, README_LAST + README_ACCENTS) },
    ],
  };
}

/** Whether the revision can be made: the fix's `stripAccents` is in, as proposed. */
export function canRevise(files: Files): boolean {
  return (files[SRC] ?? '').includes(STRIP);
}

/** The revision: letters such as ß spelled out, with a test. */
export function proposeRevision(files: Files): ProposedFiles {
  return {
    files: [
      { path: SRC, content: (files[SRC] ?? '').replace(DOC_ACCENTS, DOC_LETTERS).replace(STRIP, STRIP_AND_SPELL) },
      { path: TEST, content: (files[TEST] ?? '') + LETTERS_TEST },
    ],
  };
}
