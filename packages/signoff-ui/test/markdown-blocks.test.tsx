import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type remarkGfmType from 'remark-gfm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '../src/markdown';

// How much text each parse reads: react-markdown attaches its remark plugins once per parse, and the
// transformer added here sees the parsed tree, which ends where the text it was given ends.
const parsed = vi.hoisted(() => ({ lengths: [] as number[] }));
vi.mock('remark-gfm', async (importOriginal) => {
  const { default: remarkGfm } = await importOriginal<{ default: typeof remarkGfmType }>();
  return {
    default: function measuringRemarkGfm(this: unknown, ...args: Parameters<typeof remarkGfm>) {
      remarkGfm.apply(this as never, args);
      return (tree: { position?: { end: { offset?: number } } }) => {
        parsed.lengths.push(tree.position?.end.offset ?? 0);
      };
    },
  };
});

beforeEach(() => {
  parsed.lengths = [];
});

const read = () => parsed.lengths.reduce((sum, n) => sum + n, 0);

/** A long answer, as a coding agent writes one: headings, paragraphs, lists, code with blank lines, tables. */
function answer(chars: number) {
  const blocks: string[] = [];
  for (let i = 0; blocks.join('\n\n').length < chars; i++) {
    blocks.push(
      [
        `## Step ${i}`,
        `The function **compute${i}** now takes a \`limit\` and returns early, as [the docs](https://example.com/${i}) say [1].`,
        `- first point about ${i}\n- second point, with \`code${i}\`\n\n- a third, after a blank line\n\n  with a paragraph of its own`,
        '```ts\n' + `export function f${i}(x: number) {\n  const y = x * ${i};\n\n  return y;\n}\n` + '```',
        `| a | b |\n| - | - |\n| ${i} | ${i * 2} |`,
        `> A quote about ${i}.\n>\n> Its second paragraph.`,
        `1. one\n2. two\n\n3. three, loose`,
        '````md\n```js\nnested ' + i + '\n\n```\n````',
        `Setext ${i}\n---`,
        '***',
      ][i % 10]!,
    );
  }
  return blocks.join('\n\n');
}

/** The markup, without the line breaks between top-level elements, which do not render. */
const markup = (text: string, streaming = false) =>
  renderToStaticMarkup(
    <Markdown citations={2} streaming={streaming}>
      {text}
    </Markdown>,
  ).replace(/>\n</g, '><');

/**
 * The markup of one parse of the whole text: a link reference definition reaches across blocks, so
 * text with one is parsed whole. It goes first, so that it is found however the rest would be cut.
 */
const wholeMarkup = (text: string) => markup(`[unused]: https://example.com\n\n${text}`);

describe('Markdown, a block at a time', () => {
  // Every delta parsed the whole text again: 21 ms a delta at 20,000 characters, 56 ms at 50,000.
  it('parses only the last blocks again when a streamed answer grows', () => {
    const text = answer(20_000);
    const { rerender } = render(<Markdown streaming>{text}</Markdown>);
    expect(read()).toBeGreaterThanOrEqual(text.length - 100);
    parsed.lengths = [];
    rerender(<Markdown streaming>{`${text}\n\nThe last`}</Markdown>);
    expect(parsed.lengths).toHaveLength(1);
    expect(read()).toBeLessThan(2_000);
  });

  it('renders a long answer as one parse of the whole text does', () => {
    const text = answer(12_000);
    const whole = wholeMarkup(text);
    expect(parsed.lengths).toHaveLength(1);
    parsed.lengths = [];
    expect(markup(text)).toBe(whole);
    expect(parsed.lengths.length).toBeGreaterThan(5);
  });

  it('closes unterminated syntax in the last block and puts the caret at the end', () => {
    const { container } = render(<Markdown streaming>{`${answer(2_000)}\n\nNow **the last`}</Markdown>);
    expect(parsed.lengths.length).toBeGreaterThan(1);
    const last = container.querySelector('[data-slot="signoff-markdown"] > :last-child')!;
    const strong = last.querySelector('strong')!;
    expect(strong).toHaveTextContent(/^the last$/);
    // One caret, after the last text.
    const carets = container.querySelectorAll('[aria-hidden="true"].bg-signoff-accent');
    expect(carets).toHaveLength(1);
    expect(strong.lastElementChild).toBe(carets[0]);
  });

  it('parses text with reference or footnote definitions whole, so they resolve from every block', () => {
    const filler = answer(2_000);
    const { container } = render(
      <Markdown>{`See [the docs][d] and the note[^1].\n\n${filler}\n\n[d]: https://example.com/docs\n\n[^1]: The note.`}</Markdown>,
    );
    expect(parsed.lengths).toHaveLength(1);
    expect(container.querySelector('a[href="https://example.com/docs"]')).toHaveTextContent('the docs');
    expect(container.querySelector('[data-footnotes]')).toHaveTextContent('The note.');
  });

  // CommonMark applies a definition in a list item or a quote to the whole text too.
  it.each([
    ['a list item', '- [d]: https://example.com/docs'],
    ['a quote', '> [d]: https://example.com/docs'],
    ['a list item, indented under it', '- Sources\n\n  [d]: https://example.com/docs'],
    ['a quote in a numbered list item', '1. > [d]: https://example.com/docs'],
  ])('resolves a reference to a definition in %s, from another block', (_, definition) => {
    const { container } = render(
      <Markdown>{`See [the docs][d].\n\n${answer(1_200)}\n\nSources:\n\n${definition}`}</Markdown>,
    );
    expect(parsed.lengths).toHaveLength(1);
    expect(container.querySelector('a[href="https://example.com/docs"]')).toHaveTextContent('the docs');
  });

  it('resolves a footnote defined in a list item, from another block', () => {
    const { container } = render(
      <Markdown>{`A note[^1].\n\n${answer(1_200)}\n\nNotes:\n\n- [^1]: The note.`}</Markdown>,
    );
    expect(parsed.lengths).toHaveLength(1);
    expect(container.querySelector('[data-footnotes]')).toHaveTextContent('The note.');
  });

  // A TypeScript index signature or a line of JSX in fenced code is only code.
  it('still cuts text whose fenced code holds what looks like a definition or HTML', () => {
    const code = '```ts\ninterface Scores {\n  [name: string]: number;\n}\n[key: string]: T\n<div>{x}</div>\n```';
    const text = `${answer(4_000)}\n\n${code}\n\n${answer(2_000)}`;
    const whole = wholeMarkup(text);
    expect(parsed.lengths).toHaveLength(1);
    parsed.lengths = [];
    expect(markup(text)).toBe(whole);
    expect(parsed.lengths.length).toBeGreaterThan(5);
  });

  // Under a list item, the fence's closing line is indented, as a fence at the margin may be: cut,
  // a later code block of terminal output would split into paragraphs and swallow the text after it.
  it.each([
    ['a numbered list item', '1. ```bash\n   pnpm install\n   pnpm test\n   ```'],
    ['a list item', '- ```bash\n  pnpm install\n  pnpm test\n  ```'],
  ])('renders a code fence opened on the line of %s as one whole parse does', (_, item) => {
    const steps = Array.from({ length: 24 }, (_, i) => `Step ${i} checks package ${i} and says what it found.`);
    const output = '```\nRUN  v4.1.0\n\nTest Files  12 passed (12)\n\nTests  140 passed (140)\n```';
    const text = `To check:\n\n${item}\n\n${steps.join('\n\n')}\n\nThe output:\n\n${output}\n\nAll green.`;
    const whole = wholeMarkup(text);
    // Two code blocks, and the last line a paragraph after them.
    expect(whole.split('<pre')).toHaveLength(3);
    expect(whole).toMatch(/<p[^>]*>All green\.<\/p><\/div>$/);
    parsed.lengths = [];
    expect(markup(text)).toBe(whole);
    expect(parsed.lengths).toHaveLength(1);
  });

  // A fence on a line of its own under a list item opens and closes at the same indent, so it is
  // followed as one at the margin is.
  it('still cuts text whose code fences are indented under list items', () => {
    const steps =
      '1. Install:\n\n   ```bash\n   pnpm install\n\n   pnpm build\n   ```\n\n' +
      '2. Check:\n   ```bash\n   pnpm test\n   ```\n\n- Or with npm:\n\n  ```bash\n  npm test\n  ```';
    const text = `${answer(2_000)}\n\n${steps}\n\n${answer(2_000)}\n\n${steps}`;
    const whole = wholeMarkup(text);
    expect(parsed.lengths).toHaveLength(1);
    parsed.lengths = [];
    expect(markup(text)).toBe(whole);
    expect(parsed.lengths.length).toBeGreaterThan(3);
  });
});
