/*
 * The site's grammar for terminal and agent output: a few rules, not a language, so a command and
 * what it printed, a log or an agent's Markdown reads with structure instead of as one colour.
 * The same rules on the server (code blocks in the docs) and in the browser (the demos' tool
 * output). Each kind is a class in app/globals.css (`.term-<kind>`), coloured from the theme pair
 * in lib/highlight.ts plus three semantic colours, at 4.5:1 in both themes (test/code-colors.test.ts).
 *
 *   $ ❯ >          the prompt dim, the command after it bright
 *   error, warn    red and amber; `info` dim; ✓, passed, done green
 *   rule ids       in the accent, on a line with an error or a warning (`no-unknown-variant`)
 *   paths, 12:5    dim; quoted strings and package names tinted like strings in code
 *   Markdown       # headings bold, **bold**, `code` tinted, bullets and table pipes dim
 */

export type TermKind =
  | 'prompt'
  | 'command'
  | 'error'
  | 'warn'
  | 'info'
  | 'ok'
  | 'rule'
  | 'path'
  | 'string'
  | 'heading'
  | 'strong'
  | 'code'
  | 'marker';

export interface TermToken {
  text: string;
  kind?: TermKind;
}

export type TermLine = TermToken[];

const INLINE = new RegExp(
  [
    '(?<code>`[^`\\n]+`)',
    '(?<bold>\\*\\*[^*\\n]+\\*\\*)',
    '(?<url>https?:\\/\\/[^\\s)\\]>\'"]+)',
    // A quoted string, not an apostrophe: no word character just outside either quote.
    '(?<str>(?<![\\w])"[^"\\n]*"(?![\\w])|(?<![\\w])\'[^\'\\n]*\'(?![\\w]))',
    '(?<pkg>(?<![\\w/])@[\\w.-]+\\/[\\w.-]+)',
    // A path with a slash, or a file name with an extension, and an optional :line:col.
    // Each segment ends at its slash, so a long word can't be split many ways (no backtracking).
    '(?<path>(?:~|\\.{1,2})?\\/?(?:[\\w.@-]+\\/)+[\\w.@-]*(?::\\d+(?::\\d+)?)?|\\b[\\w.-]+\\.(?:tsx?|jsx?|mjs|cjs|json|mdx?|css|ya?ml|lock|sh|html)\\b(?::\\d+(?::\\d+)?)?)',
    '(?<error>\\b(?:[Ee]rrors?|ERROR|ERR!?|[Ff]ail(?:ed|s|ure)?|FAIL)\\b|\\bE[A-Z]{3,}\\b|[✗✖×])',
    '(?<warn>\\b(?:[Ww]arn(?:ings?)?|WARN(?:ING)?)\\b|⚠)',
    '(?<info>\\b(?:info|INFO|debug|DEBUG)\\b)',
    // "Done" and "ok" only where a line starts with them ("Done in 1.8s"), not in a sentence.
    '(?<ok>[✓✔]|\\b(?:passed|PASS(?:ED)?|[Ss]uccess(?:ful)?|succeeded)\\b|^\\s*(?:[Dd]one|ok|OK)\\b)',
    '(?<position>\\b\\d+:\\d+\\b)',
    '(?<version>\\bv?\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?\\b)',
    '(?<kebab>\\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\\b)',
  ].join('|'),
  'g',
);

const KIND_OF: Record<string, TermKind> = {
  url: 'path',
  str: 'string',
  pkg: 'string',
  path: 'path',
  error: 'error',
  warn: 'warn',
  info: 'info',
  ok: 'ok',
  position: 'path',
  version: 'path',
};

function push(line: TermLine, text: string, kind?: TermKind) {
  if (!text) return;
  const last = line.at(-1);
  if (last && last.kind === kind) last.text += text;
  else line.push(kind ? { text, kind } : { text });
}

/** Inline tokens of a stretch of output: code spans, bold, strings, paths, levels, rule ids. */
export function tokenizeInline(text: string, line: TermLine = []): TermLine {
  // Kebab-case words are rule ids only next to a level, as lint output prints them.
  const leveled = /\b(?:[Ee]rrors?|ERROR|[Ww]arn(?:ings?)?|WARN(?:ING)?)\b|[✗✖×⚠]/.test(text);
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const groups = match.groups ?? {};
    const name = Object.keys(groups).find((key) => groups[key] !== undefined);
    if (!name) continue;
    push(line, text.slice(at, match.index));
    const value = match[0];
    if (name === 'code') {
      push(line, '`', 'marker');
      push(line, value.slice(1, -1), 'code');
      push(line, '`', 'marker');
    } else if (name === 'bold') {
      push(line, '**', 'marker');
      push(line, value.slice(2, -2), 'strong');
      push(line, '**', 'marker');
    } else if (name === 'kebab') {
      push(line, value, leveled ? 'rule' : undefined);
    } else {
      push(line, value, KIND_OF[name]);
    }
    at = match.index + value.length;
  }
  push(line, text.slice(at));
  return line;
}

/** One line of output, with its line-level structure: a prompt, a heading, a bullet, a table row. */
export function tokenizeTerminalLine(text: string): TermLine {
  const line: TermLine = [];
  const prompt = /^(\s*)([$❯>])(\s+)(.*)$/.exec(text);
  if (prompt) {
    push(line, prompt[1]!);
    push(line, prompt[2]!, 'prompt');
    push(line, prompt[3]!);
    push(line, prompt[4]!, 'command');
    return line;
  }
  const heading = /^(#{1,6})(\s+)(.*)$/.exec(text);
  if (heading) {
    push(line, heading[1]!, 'marker');
    push(line, heading[2]!);
    push(line, heading[3]!, 'heading');
    return line;
  }
  if (/^\s*\|.*\|\s*$/.test(text)) {
    // A table's separator row is all structure; other rows are cells between pipes.
    if (/^[\s|:-]+$/.test(text)) {
      push(line, text, 'marker');
      return line;
    }
    for (const part of text.split(/(\|)/)) {
      if (part === '|') push(line, part, 'marker');
      else tokenizeInline(part, line);
    }
    return line;
  }
  const bullet = /^(\s*)([-*•]|\d+[.)]|\+)(\s+)(.*)$/.exec(text);
  if (bullet) {
    push(line, bullet[1]!);
    // `+ package 1.2.3` is what a package manager added: green, like a passing line.
    push(line, bullet[2]!, bullet[2] === '+' ? 'ok' : 'marker');
    push(line, bullet[3]!);
    tokenizeInline(bullet[4]!, line);
    return line;
  }
  return tokenizeInline(text, line);
}

/** Terminal or agent output, line by line. */
export function tokenizeTerminal(text: string): TermLine[] {
  return text.replace(/\n$/, '').split('\n').map(tokenizeTerminalLine);
}

export type JsonKind = 'key' | 'string' | 'number' | 'literal' | 'punctuation';

export interface JsonToken {
  text: string;
  kind?: JsonKind;
}

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

/**
 * JSON, line by line, in the kinds Shiki's json grammar gives the theme pair: keys, strings,
 * numbers, literals and punctuation. For JSON made in the browser (a demo's result), where the
 * build-time highlighter can't reach.
 */
export function tokenizeJson(text: string): JsonToken[][] {
  return text.split('\n').map((source) => {
    const line: JsonToken[] = [];
    let at = 0;
    for (const match of source.matchAll(JSON_TOKEN)) {
      if (match.index > at) line.push({ text: source.slice(at, match.index) });
      const [value, string, colon, number, literal] = match;
      if (string !== undefined) {
        line.push({ text: string, kind: colon ? 'key' : 'string' });
        if (colon) line.push({ text: colon, kind: 'punctuation' });
      } else if (number !== undefined) line.push({ text: value, kind: 'number' });
      else if (literal !== undefined) line.push({ text: value, kind: 'literal' });
      else line.push({ text: value, kind: 'punctuation' });
      at = match.index + value.length;
    }
    if (at < source.length) line.push({ text: source.slice(at) });
    return line;
  });
}

/** A short, stable key for a piece of code: the demos look up its build-time highlighting by it. */
export function codeKey(code: string): string {
  // FNV-1a, 32 bits, with the length: enough to tell a handful of files apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${code.length.toString(36)}`;
}
