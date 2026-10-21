/**
 * Text and URLs from the agent, shown to the person who decides on them. A prompt injection can
 * write them too, so the components show what would make them read as something other than what
 * runs or opens: characters that do not show, a long run of spaces or of blank lines, and a link
 * whose text names another host. No React here, so servers can call these too.
 */

/**
 * Characters that do not show: format characters (Default_Ignorable_Code_Point: bidi controls,
 * zero-width spaces and joiners, Unicode tags, variation selectors, fillers), the interlinear
 * annotation characters, control characters, and the line and paragraph separators. Tab, newline
 * and a carriage return that ends a line show as what they are, and are left out in `invisible` below.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Zl}\p{Zp}\uFFF9-\uFFFB]/u;
/** The quick test: text with none of these has nothing to show. */
const ANY_INVISIBLE = /(?![\t\n\r])[\p{Cc}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}\uFFF9-\uFFFB]|\r(?!\n|$)/u;
/** Spaces other than U+0020, and the blank braille pattern: they look like a space and are not one. */
const OTHER_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u2800]/u;
const ANY_BLANK = /[ \t]{2}|[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u2800]|\n(?:[ \t\r]*\n){3}/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
/** A character that can be an emoji, which a variation selector after it shows as one or as text. */
const EMOJI = /\p{Emoji}/u;
const IN_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;
/** A run of spaces and tabs this wide, a tab counting 8, shows as a mark: about a third of a narrow card. */
const BLANK_RUN = 16;
/**
 * A run of blank characters with this many blank lines in it or more, so 4 line breaks, shows as a
 * mark: blank lines push what follows down, out of view below. Code has up to 2 in a row (PEP 8
 * between definitions), and keeps them.
 */
const BLANK_LINES = 3;

export interface RevealTextOptions {
  /**
   * Also mark spaces: a run of spaces and tabs 16 columns wide or more, as its count, a run of 3
   * blank lines or more, as its count too, and spaces other than U+0020, as their code points. For a
   * command or a path; not for code, which lines up with spaces.
   */
  blanks?: boolean | undefined;
}

/** A run of characters to show as a mark, in place of the characters. */
export interface RevealedMark {
  /** `invisible`: characters that do not show. `blank`: a long run of spaces and tabs, or of blank lines. */
  kind: 'invisible' | 'blank';
  /** The characters. */
  text: string;
  /** How many characters there are. */
  count: number;
  /** For a run of blank lines, how many line breaks it has, which the mark shows (`↵ ×60`); 0 for any other mark. */
  lines: number;
  /** Their code points, each once, in order (`U+202E`); empty for a blank run. */
  codes: string[];
  /** What the mark shows: `U+202E`, `U+200B ×240`, `␣ ×240`, and `↵ ×60` for a run of 60 line breaks. */
  shown: string;
}

/** A part of the text: as it is, or a mark. */
export type RevealedPart = string | RevealedMark;

const codeOf = (char: string) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * The quick test: false when `revealText` would mark nothing in the text. True does not always mean
 * it marks something: the joiner in an emoji, or a run of 2 spaces, is left as it is.
 */
export function hasHidden(text: string, options: RevealTextOptions = {}): boolean {
  return ANY_INVISIBLE.test(text) || (!!options.blanks && ANY_BLANK.test(text));
}

/**
 * The text in parts, with marks in place of what would make it read as something it is not:
 * characters that do not show, such as a bidi override (`U+202E`), which shows the text after it
 * reversed, or a zero-width space, and with `blanks`, long runs of spaces or of blank lines. Text
 * with none of them is one part, the text itself. The joiners and variation selectors in an emoji
 * are left as they are.
 */
export function revealText(text: string, options: RevealTextOptions = {}): RevealedPart[] {
  if (!hasHidden(text, options)) return [text];
  const chars = Array.from(text);
  const parts: RevealedPart[] = [];
  let plain = '';
  let mark: RevealedMark | undefined;
  /** The spaces, tabs and line breaks since the last other character, which may make a long run. */
  let run = '';
  const blank = (blanks: string, lines: number) => {
    if (plain) parts.push(plain);
    plain = '';
    const count = blanks.length;
    // A run of blank lines shows how many lines it pushes down, not its characters: the spaces on
    // those lines and the carriage returns of CRLF count in `count` only.
    const shown = lines ? `↵ ×${lines}` : `␣ ×${count}`;
    parts.push({ kind: 'blank', text: blanks, count, lines, codes: [], shown });
  };
  const flushRun = () => {
    const lines = run.split('\n').length - 1;
    // Enough blank lines to push what follows out of view below are one mark, line breaks and all.
    if (lines > BLANK_LINES) blank(run, lines);
    else {
      // Otherwise each line's spaces count on their own, and the line breaks stay as they are.
      for (const piece of run.split(/(\r?\n)/)) {
        let width = 0;
        for (const char of piece) width += char === '\t' ? 8 : char === ' ' ? 1 : 0;
        if (width >= BLANK_RUN) blank(piece, 0);
        else plain += piece;
      }
    }
    run = '';
  };
  const invisible = (char: string, i: number) => {
    if (char === '\t' || char === '\n') return false;
    if (char === '\r') return i < chars.length - 1 && chars[i + 1] !== '\n';
    // The joiner between two emoji that make one (woman, joiner, laptop), and a variation selector
    // after a character that can be an emoji, such as the one that makes a heart an emoji; after a
    // digit, `#` or `*`, only in a keycap (1, U+FE0F, U+20E3). After a letter one shows nothing, and
    // would hide in a word or a host: `git` U+FE0F `hub.com`. Compared by code point: a bundler may
    // print the escape in a string as the character itself, which does not show.
    const code = char.codePointAt(0);
    if (code === 0x200d) return !(IN_EMOJI.test(chars[i - 1] ?? '') && PICTOGRAPH.test(chars[i + 1] ?? ''));
    if (code === 0xfe0e || code === 0xfe0f) {
      const before = chars[i - 1];
      if (before === undefined || !EMOJI.test(before)) return true;
      return /^[\d#*]$/.test(before) && chars[i + 1]?.codePointAt(0) !== 0x20e3;
    }
    return INVISIBLE.test(char) || (!!options.blanks && OTHER_SPACE.test(char));
  };
  chars.forEach((char, i) => {
    if (invisible(char, i)) {
      if (run) flushRun();
      if (!mark) {
        if (plain) parts.push(plain);
        plain = '';
        mark = { kind: 'invisible', text: '', count: 0, lines: 0, codes: [], shown: '' };
        parts.push(mark);
      }
      mark.text += char;
      mark.count++;
      const code = codeOf(char);
      if (!mark.codes.includes(code)) mark.codes.push(code);
      return;
    }
    mark = undefined;
    // A carriage return here ends a line: one inside a line is a mark, above.
    if (options.blanks && (char === ' ' || char === '\t' || char === '\n' || char === '\r')) {
      run += char;
      return;
    }
    if (run) flushRun();
    plain += char;
  });
  if (run) flushRun();
  if (plain) parts.push(plain);
  for (const part of parts) {
    if (typeof part === 'string' || part.kind === 'blank') continue;
    const { codes, count } = part;
    part.shown =
      codes.length <= 2 && count === codes.length
        ? codes.join(' ')
        : `${codes[0]}${codes.length > 1 ? ' …' : ''} ×${count}`;
  }
  return parts;
}

/** The classes of a mark: a small badge in the warning color, on one line with the text. */
export const MARK_CLASS =
  'bg-signoff-warn/12 font-signoff-mono text-signoff-warn-fg ring-signoff-warn/40 mx-px inline-block rounded-[3px] px-0.5 text-[0.85em] leading-none whitespace-pre ring-1 ring-inset';

export interface SafeUrlOptions {
  /** Also allow `data:` and `blob:` URLs, which an attached file or an image can have. */
  files?: boolean | undefined;
}

/**
 * The URL when a link may use it: http, https, mailto, a relative URL, and with `files`, `data:`
 * and `blob:`. Anything else, `javascript:` first, is `undefined`, to render as text instead: React
 * 18 renders a `javascript:` link as it is, and React 19 only replaces it with one that throws.
 */
export function safeUrl(url: string | null | undefined, options: SafeUrlOptions = {}): string | undefined {
  if (!url) return undefined;
  // A scheme ends at the first colon, before any slash, question mark or hash; without one, the URL
  // is relative. Browsers skip leading spaces and control characters, so this does too.
  const scheme = /^[\p{Cc} ]*([^:/?#]*):/u.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined || scheme === 'http' || scheme === 'https' || scheme === 'mailto') return url;
  return options.files && (scheme === 'data' || scheme === 'blob') ? url : undefined;
}

/** A host link text names: in a URL (`https://github.com/x`), after `www.`, or in an email address. */
const NAMED_HOST =
  /(?:[a-z][a-z\d+.-]*:\/\/(?:[^\s/@]*@)?|\bwww\.|[^\s@<>()[\]]@)([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*)/iu;
/** Link text that is a domain, with or without a path: `github.com`, `github.com/x`. */
const DOMAIN_TEXT = /^((?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]+)\.?(?:[/?#:]\S*)?$/u;
/** A file's or a product's name, which reads like a domain and is not one: `README.md`, `Next.js`. */
const FILE_NAME =
  /\.(?:[cm]?[jt]sx?|json|mdx?|s?css|html?|py|rb|go|rs|sh|txt|ya?ml|toml|lock|vue|svelte|php|java|kt|swift|cpp|cs|sql|xml|csv|log|zip|pdf|png|jpe?g|gif|svg|webp)$/i;
/** Of those, the extensions that are top-level domains too: `docs.rs`, `bun.sh`, `get.zip`. */
const TLD_EXTENSION = /\.(?:md|py|rs|sh|zip)$/i;

/** A host as the browser resolves it (lowercase, look-alike letters in punycode), without `www.`. */
function normalHost(host: string): string | undefined {
  try {
    return new URL(`http://${host}`).hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return undefined;
  }
}

/** The last segment of a URL's path, decoded and in lowercase: `readme.md` for `/a/b/README.md`. */
function lastSegment(url: URL): string {
  const segment = url.pathname.split('/').pop() ?? '';
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return segment.toLowerCase();
  }
}

/**
 * The host a link goes to, when its text could make a person think it goes elsewhere: the text
 * names another host, or names one in look-alike letters (the host is in punycode, `xn--`), or has
 * characters that do not show, or the URL puts a name before the host (`https://github.com@evil.example`).
 * Otherwise `undefined`, and the link needs nothing beside it.
 */
export function linkHostMismatch(text: string, href: string): string | undefined {
  let url: URL;
  let target: string | undefined;
  try {
    // Against a base of its own, so that a relative URL, which stays on the page's site, has no host
    // to show, and `//evil.example/x` has evil.example.
    url = new URL(href, 'https://self.invalid');
    if (url.host === 'self.invalid') return undefined;
    if (url.protocol === 'http:' || url.protocol === 'https:') target = normalHost(url.hostname);
    else if (url.protocol === 'mailto:') target = normalHost(url.pathname.split('@').pop() ?? '');
  } catch {
    return undefined;
  }
  if (!target) return undefined;
  // What comes before an @ reads as the host, and is only a user name: whatever the text says.
  if (url.username || url.password) return target;
  const trimmed = text.trim();
  // Characters that do not show, as `revealText` marks them: not the joiner or the variation
  // selector inside an emoji, as in a red heart or a woman at a laptop.
  if (revealText(trimmed).some((part) => typeof part !== 'string')) return target;
  // Those left are an emoji's, and split no name: read without them, so that one after a host does
  // not keep the text from naming it.
  const shown = trimmed.replace(/\u200D|\uFE0E|\uFE0F/gu, '');
  const domain = DOMAIN_TEXT.exec(shown)?.[1];
  // A name such as `README.md` is a file's, unless its extension is a top-level domain too, as in
  // `docs.rs`: then only when the link goes to that file.
  const fileName =
    !!domain &&
    FILE_NAME.test(domain) &&
    (!TLD_EXTENSION.test(domain) || (shown === domain && lastSegment(url) === domain.toLowerCase()));
  const named = NAMED_HOST.exec(shown)?.[1] ?? (domain && !fileName ? domain : undefined);
  if (named === undefined) return undefined;
  return normalHost(named) !== target || target.split('.').some((label) => label.startsWith('xn--'))
    ? target
    : undefined;
}
