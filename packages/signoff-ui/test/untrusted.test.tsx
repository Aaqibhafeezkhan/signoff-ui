import { render, screen, within } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { ApprovalCard } from '../src/approval-card';
import { DiffReview } from '../src/diff-review';
import { revealText, safeUrl } from '../src/core';
import { linkHostMismatch } from '../src/lib/untrusted';
import { Markdown } from '../src/markdown';
import { Sources } from '../src/sources';
import { axe } from './utils';

/*
 * The person who approves a command or reviews a diff reads what the agent wrote, which a prompt
 * injection can write too. Text that shows something other than what runs is made visible: bidi
 * controls, zero-width and other invisible characters, long runs of spaces and of blank lines, the
 * end of a command that filler would push out of view to the side or below, and a link whose text
 * names another host than the one it goes to.
 */

const RLO = '\u202E';
const ZWSP = '\u200B';
/** Text a person reads: the page's text without what only screen readers get. */
function visibleText(el: Element) {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove();
  return copy.textContent ?? '';
}
const card = () => screen.getByRole('group');

describe('ApprovalCard: a command shows what runs', () => {
  it('shows a bidi override as its code point, not reversing the text after it', async () => {
    const { container } = render(
      <ApprovalCard toolName="run_command" input={{ command: `cat src/notes${RLO}txt.sh`, cwd: `~/app${ZWSP}` }} />,
    );
    expect(card().textContent).not.toMatch(/[\u202E\u200B]/);
    expect(visibleText(card())).toContain('cat src/notesU+202Etxt.sh');
    expect(visibleText(card())).toContain('~/appU+200B');
    // Screen readers hear what it is.
    expect(within(card()).getByText('U+202E', { selector: '[aria-hidden]' }).parentElement).toHaveTextContent(
      'Invisible character U+202E',
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a long run of spaces as a count, so the end of the command stays in view', () => {
    render(
      <ApprovalCard toolName="run_command" input={{ command: `npm test${' '.repeat(240)}--script-shell=./x.sh` }} />,
    );
    expect(card().textContent).not.toMatch(/ {16}/);
    expect(visibleText(card())).toContain('npm test␣ ×240--script-shell=./x.sh');
    expect(card()).toHaveTextContent('240 blank characters');
  });

  it('shows a run of blank lines as a count, so the end of the command stays in view below', () => {
    // 60 line breaks would make the card taller than a screen, with the end below it.
    render(
      <ApprovalCard toolName="run_command" input={{ command: `npm test${'\n'.repeat(60)}--script-shell=./x.sh` }} />,
    );
    expect(card().textContent).not.toContain('\n');
    expect(visibleText(card())).toContain('npm test↵ ×60--script-shell=./x.sh');
    expect(card()).toHaveTextContent('60 line breaks');
  });

  it('counts the line breaks of a run of blank lines, not its characters', () => {
    // CRLF, with spaces on each line: 60 line breaks, 240 characters.
    render(
      <ApprovalCard
        toolName="run_command"
        input={{ command: `npm test${'  \r\n'.repeat(60)}--script-shell=./x.sh` }}
      />,
    );
    expect(visibleText(card())).toContain('npm test↵ ×60--script-shell=./x.sh');
    expect(card()).toHaveTextContent('60 line breaks');
  });

  it('shows a variation selector after a letter, where it shows nothing', () => {
    render(<ApprovalCard toolName="run_command" input={{ command: 'cat src/notes\uFE0F.txt' }} />);
    expect(visibleText(card())).toContain('cat src/notesU+FE0F.txt');
  });

  it('wraps the command, so no filler before its end pushes that end out of view to the side', () => {
    // Runs of 15 spaces, under the length that shows as a count, each followed by a dot or by a
    // combining accent, which sits on the space before it and hardly shows.
    for (const filler of ['.', '\u0301']) {
      const command = `npm test${(' '.repeat(15) + filler).repeat(16)} --script-shell=./x.sh`;
      const { unmount } = render(<ApprovalCard toolName="run_command" input={{ command, cwd: '~/app' }} />);
      const line = within(card()).getByText(/--script-shell=\.\/x\.sh$/);
      expect(line.textContent).toBe(`$${command}`);
      // A box that scrolls sideways (whitespace-pre) would leave the end out of view: this one wraps,
      // anywhere if it has to, and so does the cwd.
      expect(line).toHaveClass('whitespace-pre-wrap', '[overflow-wrap:anywhere]');
      expect(line).not.toHaveClass('whitespace-pre');
      expect(within(card()).getByText('~/app')).toHaveClass('whitespace-pre-wrap', '[overflow-wrap:anywhere]');
      unmount();
    }
  });

  it('shows a command with no such characters as it is', () => {
    const command = 'git commit -m "fix: lint ✨ ❤\uFE0F 👩\u200D💻"\r\n\techo   done';
    const { container } = render(<ApprovalCard toolName="run_command" input={{ command }} />);
    expect(container.querySelector('[data-slot="signoff-untrusted"]')).toBeNull();
    expect(card().textContent).toContain(command);
  });
});

describe('DiffReview: paths and lines show what is there', () => {
  it('shows bidi controls in a path and in a line as their code points', async () => {
    const path = `src/notes${RLO}gpj.exe`;
    // Trojan Source: the line reads as a comment after the string, and is not.
    const line = `if (level != "user${RLO} \u2066// admin only\u2069 \u2066") {`;
    const { container } = render(
      <DiffReview
        files={[
          { path, oldContent: 'a\n', newContent: `${line}\n` },
          { path: 'src/b.ts', oldContent: 'a\n', newContent: 'b\n' },
        ]}
      />,
    );
    const review = screen.getByRole('region');
    expect(visibleText(review)).not.toMatch(/[\u202E\u2066\u2069]/);
    expect(visibleText(review)).toContain('notesU+202Egpj.exe');
    expect(visibleText(review)).toContain('"userU+202E U+2066// admin onlyU+2069 U+2066")');
    // The file navigator too.
    expect(visibleText(screen.getByRole('navigation'))).toContain('notesU+202Egpj.exe');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows them in the note of a file renamed without changes', () => {
    const { container } = render(
      <DiffReview
        files={[{ path: 'src/notes.sh', oldPath: `src/notes${RLO}txt.sh`, oldContent: 'a\n', newContent: 'a\n' }]}
      />,
    );
    const note = screen.getByText(/^Renamed from/);
    expect(visibleText(note)).toBe('Renamed from src/notesU+202Etxt.sh, without changes.');
    expect(note).toHaveTextContent('Invisible character U+202E');
    // The header's path shows it too, so no U+202E is left anywhere a person reads.
    expect(visibleText(container)).not.toContain(RLO);
  });
});

describe('Markdown: a link whose text names another host shows where it goes', () => {
  it('shows the real host beside a URL that is not where the link goes', () => {
    render(
      <Markdown>
        {
          '[https://github.com/dgesteves/signoff-ui](https://evil.example/login) and [docs](https://react.dev/learn), [react.dev](https://react.dev/learn), <https://github.com/x>'
        }
      </Markdown>,
    );
    const spoofed = screen.getByRole('link', { name: /^https:\/\/github\.com\/dgesteves/ });
    expect(spoofed).toHaveAttribute('href', 'https://evil.example/login');
    expect(spoofed).toHaveTextContent('evil.example');
    expect(spoofed).toHaveAccessibleName(/Links to evil\.example/);
    // Links whose text names no other host are left alone.
    expect(screen.getByRole('link', { name: 'docs' })).toHaveTextContent(/^docs$/);
    expect(screen.getByRole('link', { name: 'react.dev' })).toHaveTextContent(/^react\.dev$/);
    expect(screen.getByRole('link', { name: 'https://github.com/x' })).toHaveTextContent(/^https:\/\/github\.com\/x$/);
  });

  it('shows the host beside a domain with a variation selector in it or after it', () => {
    render(
      <Markdown>
        {'[github.com\uFE0F](https://evil.example/login) and [git\uFE0Fhub.com/login](https://evil.example/login)'}
      </Markdown>,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://evil.example/login');
      expect(link).toHaveTextContent(/evil\.example$/);
      expect(link).toHaveAccessibleName(/Links to evil\.example/);
    }
  });

  it('leaves a link with an emoji in its text alone', () => {
    render(
      <Markdown>
        {'[❤\uFE0F Sponsor](https://github.com/sponsors/x) and [👩\u200D💻 Docs](https://react.dev/learn)'}
      </Markdown>,
    );
    expect(document.querySelector('[data-slot="signoff-link-host"]')).toBeNull();
    for (const link of screen.getAllByRole('link')) expect(link).not.toHaveAccessibleName(/Links to/);
  });

  it('shows the host of a look-alike domain as the browser resolves it', () => {
    // A Cyrillic і in place of the Latin i.
    render(<Markdown>{'[g\u0456thub.com](https://g\u0456thub.com/login)'}</Markdown>);
    expect(screen.getByRole('link')).toHaveTextContent('xn--');
  });

  it('shows the host beside a domain among other words, and not beside a file name', () => {
    render(
      <Markdown>
        {
          '[Visit github.com →](https://evil.example/login) and [Read README.md](https://github.com/a/b/blob/main/README.md)'
        }
      </Markdown>,
    );
    const visit = screen.getByRole('link', { name: /^Visit github\.com/ });
    expect(visit).toHaveTextContent(/evil\.example$/);
    expect(visit).toHaveAccessibleName(/Links to evil\.example/);
    expect(screen.getByRole('link', { name: 'Read README.md' })).toHaveTextContent(/^Read README\.md$/);
  });
});

describe('Sources and attachments link only to safe URLs', () => {
  const message = (url: string, mediaType = 'application/pdf') =>
    ({
      id: 'm',
      role: 'assistant',
      parts: [{ type: 'file', mediaType, url, filename: 'report' }],
    }) as unknown as UIMessage;

  it('renders a source with a javascript: URL as text, not a link', () => {
    render(<Sources sources={[{ type: 'source-url', sourceId: '1', url: 'javascript:alert(1)', title: 'Docs' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Docs')).toBeInTheDocument();
  });

  it('renders a file part with a javascript: URL as text, not a link or an image', () => {
    const { unmount } = render(<AgentMessage message={message('javascript:alert(1)')} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('report')).toBeInTheDocument();
    unmount();
    const { container } = render(
      <AgentMessage message={message('javascript:alert(1)', 'image/png')} allowedImageHosts={['*']} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(document.querySelector('[href^="javascript"], [src^="javascript"]')).toBeNull();
  });

  it('still links http(s), mailto, relative, data: and blob: files', () => {
    for (const url of ['https://example.com/r.pdf', '/files/r.pdf', 'data:application/pdf;base64,AAAA', 'blob:x']) {
      const { unmount } = render(<AgentMessage message={message(url)} />);
      expect(screen.getByRole('link')).toHaveAttribute('href', url);
      unmount();
    }
    render(<Sources sources={[{ id: 'a', url: 'mailto:team@example.com', title: 'Team' }]} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'mailto:team@example.com');
  });
});

describe('revealText', () => {
  it('leaves text with nothing hidden as one part', () => {
    for (const text of [
      'npm test',
      'a\tb\nc\r\n',
      'emoji ❤\uFE0F 👩\u200D💻 👍🏽 1\uFE0F\u20E3',
      'Ünïcödé 文字 עברית',
      'x\r',
    ])
      expect(revealText(text, { blanks: true })).toEqual([text]);
    expect(revealText(`a${' '.repeat(15)}b`, { blanks: true })).toEqual([`a${' '.repeat(15)}b`]);
    // Without `blanks`, spaces are left as they are: code lines up with them.
    expect(revealText(`a${' '.repeat(40)}b\u00A0c`)).toEqual([`a${' '.repeat(40)}b\u00A0c`]);
  });

  it('marks a run of characters that do not show once, with each code point', () => {
    expect(revealText(`a${RLO}b`)).toEqual([
      'a',
      { kind: 'invisible', text: RLO, count: 1, lines: 0, codes: ['U+202E'], shown: 'U+202E' },
      'b',
    ]);
    expect(revealText(`a${ZWSP.repeat(240)}`)).toEqual([
      'a',
      { kind: 'invisible', text: ZWSP.repeat(240), count: 240, lines: 0, codes: ['U+200B'], shown: 'U+200B ×240' },
    ]);
    // Unicode tags, which can spell out a hidden instruction: astral, counted as characters.
    const tags = Array.from('ignore', (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    const [, mark] = revealText(`ok${tags}`) as [string, { count: number; shown: string; codes: string[] }];
    expect(mark.count).toBe(6);
    expect(mark.codes[0]).toBe('U+E0069');
    expect(mark.shown).toBe('U+E0069 … ×6');
  });

  it('marks a variation selector that is in no emoji, as after a letter', () => {
    const marked = (text: string) =>
      revealText(text)
        .filter((p) => typeof p !== 'string')
        .map((p) => (p as { shown: string }).shown);
    expect(marked('cat src/notes\uFE0F.txt')).toEqual(['U+FE0F']);
    expect(marked('git\uFE0Ehub.com')).toEqual(['U+FE0E']);
    expect(marked('\uFE0Fstart')).toEqual(['U+FE0F']);
    // After a digit, only a keycap keeps it.
    expect(marked('notes1\uFE0F.txt')).toEqual(['U+FE0F']);
    expect(marked('1\uFE0F\u20E3 #\uFE0F\u20E3')).toEqual([]);
    // Two in a row: the second follows no emoji.
    expect(marked('\u2764\uFE0F\uFE0F')).toEqual(['U+FE0F']);
    // Emoji keep theirs: a heart, a copyright sign, a flag of joined emoji.
    expect(marked('\u2764\uFE0F \u00A9\uFE0F \u{1F3F3}\uFE0F\u200D\u{1F308}')).toEqual([]);
  });

  it('marks control characters, ANSI escapes included, and a carriage return inside a line', () => {
    const parts = revealText('\u001b[31mred\u001b[0m a\rb\u0000');
    expect(parts.filter((p) => typeof p !== 'string').map((p) => (p as { shown: string }).shown)).toEqual([
      'U+001B',
      'U+001B',
      'U+000D',
      'U+0000',
    ]);
  });

  it('with blanks, marks a long run of spaces and tabs, and spaces that are not U+0020', () => {
    expect(revealText(`a${' '.repeat(16)}b`, { blanks: true })).toEqual([
      'a',
      { kind: 'blank', text: ' '.repeat(16), count: 16, lines: 0, codes: [], shown: '␣ ×16' },
      'b',
    ]);
    // A tab counts 8 columns.
    expect(revealText('a\t\tb', { blanks: true })[1]).toMatchObject({ kind: 'blank', count: 2 });
    expect(revealText('rm\u00A0-rf', { blanks: true })[1]).toMatchObject({ kind: 'invisible', codes: ['U+00A0'] });
  });

  it('with blanks, marks a run of 3 blank lines or more, line breaks and all, and leaves 2 as they are', () => {
    expect(revealText('a\n\n\n\nb', { blanks: true })).toEqual([
      'a',
      { kind: 'blank', text: '\n\n\n\n', count: 4, lines: 4, codes: [], shown: '↵ ×4' },
      'b',
    ]);
    // Spaces and the carriage returns of CRLF on those lines are part of the run, and the mark
    // counts its line breaks.
    expect(revealText(`a${'  \r\n'.repeat(4)}b`, { blanks: true })).toEqual([
      'a',
      { kind: 'blank', text: '  \r\n'.repeat(4), count: 16, lines: 4, codes: [], shown: '↵ ×4' },
      'b',
    ]);
    expect(revealText(`a${'\r\n'.repeat(60)}b`, { blanks: true })[1]).toMatchObject({
      count: 120,
      lines: 60,
      shown: '↵ ×60',
    });
    // Two blank lines, as between Python definitions, stay as they are.
    const code = 'import os\n\n\ndef main():\n    pass\r\n\r\n\r\nmain()';
    expect(revealText(code, { blanks: true })).toEqual([code]);
    // Below that, a line's spaces count on their own, and the line break before them stays.
    expect(revealText(`a\n\n${' '.repeat(16)}b`, { blanks: true })).toEqual([
      'a\n\n',
      { kind: 'blank', text: ' '.repeat(16), count: 16, lines: 0, codes: [], shown: '␣ ×16' },
      'b',
    ]);
    // Without blanks, line breaks are left as they are.
    expect(revealText('a\n\n\n\n\nb')).toEqual(['a\n\n\n\n\nb']);
  });
});

describe('safeUrl', () => {
  it('allows http, https, mailto and relative URLs', () => {
    for (const url of [
      'https://a.example/x',
      'HTTP://a.example',
      'mailto:a@b.example',
      '/x',
      '#y',
      'z?a=b',
      '//cdn.example/i.png',
      ' https://a.example',
    ])
      expect(safeUrl(url)).toBe(url);
  });

  it('allows data: and blob: for files only', () => {
    expect(safeUrl('data:image/png;base64,AAAA')).toBeUndefined();
    expect(safeUrl('data:image/png;base64,AAAA', { files: true })).toBe('data:image/png;base64,AAAA');
    expect(safeUrl('blob:https://a.example/1', { files: true })).toBe('blob:https://a.example/1');
  });

  it('refuses every other scheme, however it is written', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      '\u0001javascript:alert(1)',
      'java\tscript:alert(1)',
      'vbscript:x',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      '',
      undefined,
      null,
    ])
      expect(safeUrl(url)).toBeUndefined();
    expect(safeUrl('java\tscript:alert(1)', { files: true })).toBeUndefined();
  });
});

describe('linkHostMismatch', () => {
  it('names the host when the text names another', () => {
    expect(linkHostMismatch('https://github.com/x', 'https://evil.example/login')).toBe('evil.example');
    expect(linkHostMismatch('github.com', 'https://evil.example')).toBe('evil.example');
    expect(linkHostMismatch('www.github.com/x', 'https://github.com.evil.example/')).toBe('github.com.evil.example');
    expect(linkHostMismatch('https://github.com/x', 'https://github.com@evil.example/')).toBe('evil.example');
    expect(linkHostMismatch('http://localhost:3000', 'https://evil.example')).toBe('evil.example');
    expect(linkHostMismatch('support@github.com', 'mailto:help@evil.example')).toBe('evil.example');
    expect(linkHostMismatch('https://github.com', '//evil.example/x')).toBe('evil.example');
    // Text a bidi override turns around.
    expect(linkHostMismatch(`${RLO}moc.buhtig//:sptth`, 'https://evil.example')).toBe('evil.example');
  });

  it('names the host when a word anywhere in the text names another', () => {
    for (const text of [
      'Visit github.com',
      'github.com →',
      'github.com!',
      'github.com/login →',
      'github.com ❤\uFE0F',
      'Visit github.com.',
      '(github.com)',
      '/github.com',
      '.github.com',
      'github.com@',
      'Docs: https://github.com/x',
    ])
      expect(linkHostMismatch(text, 'https://evil.example/login')).toBe('evil.example');
    // Every host the text names counts, not only the first.
    expect(linkHostMismatch('evil.example, not https://github.com', 'https://evil.example')).toBe('evil.example');
    expect(linkHostMismatch('https://evil.example or github.com', 'https://evil.example')).toBe('evil.example');
  });

  it('names nothing for a file name among words, the name before an @, or a word in a URL', () => {
    expect(linkHostMismatch('Read README.md', 'https://github.com/a/b/blob/main/README.md')).toBeUndefined();
    expect(linkHostMismatch('Next.js docs', 'https://nextjs.org/docs')).toBeUndefined();
    expect(linkHostMismatch('Visit react.dev →', 'https://react.dev/learn')).toBeUndefined();
    expect(linkHostMismatch('jane.doe@github.com', 'mailto:jane.doe@github.com')).toBeUndefined();
    // An autolink: the words in its path and query are not where it goes.
    const autolink = 'https://www.npmjs.com/package/lodash.debounce?from=evil.example';
    expect(linkHostMismatch(autolink, autolink)).toBeUndefined();
    expect(linkHostMismatch('github.com/vercel/next.js', 'https://github.com/vercel/next.js')).toBeUndefined();
  });

  it('reads long text once, not once from each of its characters', () => {
    const start = performance.now();
    for (const text of [
      'a'.repeat(100_000),
      'ab.'.repeat(30_000),
      `https://${'a'.repeat(100_000)}`,
      '1.'.repeat(50_000),
      'a@'.repeat(50_000),
      `${'a.'.repeat(50_000)}@x.com`,
      'a\u3002'.repeat(50_000),
    ])
      linkHostMismatch(text, 'https://evil.example/login');
    // Read from each character, the first alone takes seconds.
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('names nothing for the joiner and the variation selector inside an emoji', () => {
    expect(linkHostMismatch('❤\uFE0F Sponsor', 'https://github.com/sponsors/x')).toBeUndefined();
    expect(linkHostMismatch('👩\u200D💻 Docs', 'https://react.dev/learn')).toBeUndefined();
    expect(linkHostMismatch('github.com ❤\uFE0F', 'https://github.com/sponsors/x')).toBeUndefined();
    // A bidi override beside one still names the host.
    expect(linkHostMismatch(`❤\uFE0F Sponsor${RLO}`, 'https://github.com/sponsors/x')).toBe('github.com');
  });

  it('names the host for a variation selector in no emoji, which shows nothing', () => {
    for (const text of [
      'github.com\uFE0F',
      'github.com\uFE0E',
      'git\uFE0Fhub.com/login',
      'github.com\uFE0F/login',
      'git1\uFE0Fhub.com',
    ])
      expect(linkHostMismatch(text, 'https://evil.example/login')).toBe('evil.example');
    // One an emoji keeps does not hide the name either: ℹ, an emoji, reads as i in a host.
    expect(linkHostMismatch('githubℹ\uFE0F.com', 'https://evil.example/login')).toBe('evil.example');
    expect(linkHostMismatch('github.com', 'https://evil.example/login')).toBe('evil.example');
  });

  it('names the host when the URL puts a name before it, whatever the text says', () => {
    // An autolink: the text is the URL, which reads as github.com and goes to evil.example.
    const spoof = 'https://github.com@evil.example/x';
    expect(linkHostMismatch(spoof, spoof)).toBe('evil.example');
    expect(linkHostMismatch('the docs', 'https://github.com:pass@evil.example/')).toBe('evil.example');
  });

  it('names the host when the text puts a domain before an @, which reads as the host', () => {
    for (const text of [
      'https://github.com@evil.example/login',
      'https://github.com:443@evil.example',
      'https://github.com?@evil.example',
      'github.com@evil.example',
      '(github.com@evil.example)',
      'x/github.com@evil.example',
    ])
      expect(linkHostMismatch(text, 'https://evil.example/login')).toBe('evil.example');
    // A name that is no domain, an email address a mailto link writes to, or a path with an @ in it.
    expect(linkHostMismatch('ssh://git@github.com/a/b', 'https://github.com/a/b')).toBeUndefined();
    expect(linkHostMismatch('github.com@evil.example', 'mailto:github.com@evil.example')).toBeUndefined();
    expect(linkHostMismatch('https://evil.example@evil.example', 'https://evil.example')).toBeUndefined();
    expect(
      linkHostMismatch('npmjs.com/package/@types/node', 'https://www.npmjs.com/package/@types/node'),
    ).toBeUndefined();
    expect(linkHostMismatch('medium.com/@user/post', 'https://medium.com/@user/post')).toBeUndefined();
  });

  it('reads the full stops a URL reads as dots, and an IP address, as a host', () => {
    for (const text of [
      'github\u3002com',
      'github\uFF0Ecom',
      'github\uFF61com/login',
      'https://github\u3002com',
      '\uFF47\uFF49\uFF54\uFF48\uFF55\uFF42\uFF0E\uFF43\uFF4F\uFF4D',
      '8.8.8.8',
      '8\u30028\u30028\u30028',
      '10.0.0.1:8080/admin',
    ])
      expect(linkHostMismatch(text, 'https://evil.example/login')).toBe('evil.example');
    expect(linkHostMismatch('github\u3002com', 'https://github.com')).toBeUndefined();
    expect(linkHostMismatch('8.8.8.8', 'https://8.8.8.8/')).toBeUndefined();
    // A sentence in Chinese, Japanese or Korean ends with U+3002; a version or an octet past 255 is no address.
    expect(
      linkHostMismatch('\u8A73\u7D30\u306F\u3053\u3061\u3089\u3002\u6B21\u3078', 'https://docs.example'),
    ).toBeUndefined();
    expect(linkHostMismatch('\u30C6\u30B9\u30C8\u3002React', 'https://docs.example')).toBeUndefined();
    for (const text of ['1.2.3', 'v1.2.3.4', '1.2.3.4.5', '8.8.8.256', 'Chrome 131.0.6778.85'])
      expect(linkHostMismatch(text, 'https://github.com/a/b/releases')).toBeUndefined();
  });

  it('reads a file name whose extension is a top-level domain as a domain, unless the link goes to that file', () => {
    expect(linkHostMismatch('docs.rs', 'https://evil.example/login')).toBe('evil.example');
    expect(linkHostMismatch('bun.sh', 'https://evil.example/login')).toBe('evil.example');
    expect(linkHostMismatch('vercel.sh', 'https://evil.example/login')).toBe('evil.example');
    expect(linkHostMismatch('get.zip', 'https://evil.example/')).toBe('evil.example');
    expect(linkHostMismatch('README.md', 'https://evil.example/login')).toBe('evil.example');
    // The link goes to the file the text names, or to the host it names.
    expect(linkHostMismatch('setup.py', 'https://github.com/a/b/blob/main/setup.py')).toBeUndefined();
    expect(linkHostMismatch('install.sh', 'https://example.com/scripts/install.sh?raw=1')).toBeUndefined();
    expect(linkHostMismatch('docs.rs', 'https://docs.rs/serde')).toBeUndefined();
    // Other extensions are no domain: the name is a file's wherever the link goes.
    expect(linkHostMismatch('package.json', 'https://github.com/a/b')).toBeUndefined();
  });

  it('names nothing when the text names the same host, or none', () => {
    expect(linkHostMismatch('https://www.GitHub.com/a', 'https://github.com/b')).toBeUndefined();
    expect(linkHostMismatch('the docs', 'https://evil.example')).toBeUndefined();
    expect(linkHostMismatch('github.com', '/relative')).toBeUndefined();
    // A file's or a product's name is not a host.
    expect(linkHostMismatch('README.md', 'https://github.com/a/b/blob/main/README.md')).toBeUndefined();
    expect(linkHostMismatch('Next.js', 'https://nextjs.org')).toBeUndefined();
    expect(linkHostMismatch('package.json', 'https://github.com/a/b')).toBeUndefined();
    expect(linkHostMismatch('https://github.com', 'mailto:')).toBeUndefined();
  });
});
