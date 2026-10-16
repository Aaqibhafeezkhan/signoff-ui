/**
 * Approval rules: what a person decided once, applied to the calls that follow. Pure, with no React,
 * so the same rules decide on the client (answering a request before anyone is asked) and on the
 * server (`toToolApproval`, for AI SDK 7's `toolApproval`).
 */

/** What a person can decide about a tool call, and for how long it holds. */
export type ApprovalDecision = 'allow-once' | 'allow-session' | 'allow-always' | 'deny-once' | 'deny-always';

export const APPROVAL_DECISIONS: readonly ApprovalDecision[] = [
  'allow-once',
  'allow-session',
  'allow-always',
  'deny-once',
  'deny-always',
];

/** A standing decision about a tool's calls: allowed or denied, for the session or always. */
export interface ApprovalRule {
  /** Unique among the rules. */
  id: string;
  /**
   * The tool's name, or a glob over names: `*` for every tool, `mcp_github_*` for a family. In a
   * deny rule `*` and `?` match any character of a name; in an allow rule they stop at a shell
   * operator, as in `args`.
   */
  tool: string;
  /**
   * Globs by argument name, which must all match: `{ command: 'npm test*' }`. A dotted name reads
   * a nested argument (`'options.cwd'`), and a key of that name too. A deny rule's globs also match
   * each command of a shell line (see `ruleMatches`). Absent: any arguments.
   */
  args?: Readonly<Record<string, string>> | undefined;
  /** A test of your own on the input, on top of `args`. Code, so storage does not keep the rule. */
  when?: ((input: unknown) => boolean) | undefined;
  /** Whether the calls it covers run without asking, or are refused. A deny rule wins over an allow rule. */
  effect: 'allow' | 'deny';
  /** `session`: until the page reloads or the session is cleared. `always`: kept by the storage. */
  scope: 'session' | 'always';
  /** When it was made, in milliseconds since the epoch. */
  createdAt?: number | undefined;
  /** Why it was made, e.g. the reason a person gave when denying. */
  reason?: string | undefined;
}

/** A tool call that needs a decision. */
export interface ApprovalRequest {
  /**
   * The id a response answers: AI SDK's `approval.id`, an AG-UI interrupt's id, or for ACP the
   * tool call's id.
   */
  id: string;
  /** The tool's name, which a rule's `tool` matches. */
  toolName: string;
  /** The call's arguments, which a rule's `args` and `when` match. */
  input: unknown;
  /** The tool call's own id, when the request has one apart from `id`, as AI SDK's approvals do. */
  toolCallId?: string | undefined;
}

/** The rule that decides a call. */
export interface RuleMatch {
  effect: 'allow' | 'deny';
  rule: ApprovalRule;
  /**
   * The rule is a deny rule that ran out of steps before it could tell whether it covers the call,
   * the arguments being too long for its patterns, and no other deny rule covers it: the call is
   * denied, and the rule's own `reason` doesn't apply.
   */
  unchecked?: boolean | undefined;
}

/**
 * Characters a single `*` or `?` never matches: what chains, pipes, substitutes or redirects a
 * shell command. So `npm test*` allows `npm test -- --watch` but not `npm test && rm -rf ~`.
 */
const SHELL_CONTROL = ';&|`<>\r\n';

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/* A glob's parts: a character, as its code, or one of these. */
const ONE = -1; // ?
const STAR = -2; // *
const ANY = -3; // ** (or more)
const END = 0x10000; // past the last part, in `globMatch`: no character's code

/** A pattern in parts: `\` and the character it makes literal, a run of `*`, or one character. */
const globParts = (pattern: string) =>
  (pattern.match(/\\[\s\S]|\*+|[\s\S]/g) ?? []).map((part) =>
    part[0] === '\\' && part[1]
      ? part.charCodeAt(1)
      : part[1]
        ? ANY
        : part === '*'
          ? STAR
          : part === '?'
            ? ONE
            : part.charCodeAt(0),
  );

/**
 * A glob as a regular expression over the whole value:
 * - `*` matches any run of characters but shell control characters (`;`, `&`, `|`, `` ` ``, `<`,
 *   `>`, line breaks) and `$(`;
 * - `?` matches one such character;
 * - `**` matches any run of characters at all;
 * - `\` makes the next character literal; everything else is literal.
 *
 * The expression backtracks: with a few `*` and a long value it doesn't match, a test can take
 * seconds. `matchesGlob` gives the same answers without backtracking.
 */
export function globToRegExp(pattern: string): RegExp {
  const safe = `(?:(?!\\$\\()[^${escapeRegExp(SHELL_CONTROL)}])`;
  const source = globParts(pattern).map((part) =>
    part === ANY
      ? '[\\s\\S]*'
      : part === STAR
        ? `${safe}*`
        : part === ONE
          ? safe
          : escapeRegExp(String.fromCharCode(part)),
  );
  return new RegExp(`^${source.join('')}$`);
}

/**
 * Matching work a rule has left for a call, in steps. Each character it reads costs the places in
 * the pattern that match so far, plus one, and earns `STEPS_PER_CHARACTER`. An empty value, such as
 * an array's item, counts as one character.
 */
interface Budget {
  left: number;
}

/**
 * The steps a rule starts with, for the tool's name and again for its arguments: enough for any
 * pattern on a short argument. Each character it reads earns it `STEPS_PER_CHARACTER` more, several
 * times what a common pattern takes, so a rule such as `**PRIVATE KEY**` never runs out, however
 * long the argument. A pattern that takes more for each character, such as 500 characters of `a`
 * against an argument of `a`s, stops after a few hundred: each rule's work grows with what it reads,
 * and no more.
 */
const RULE_STEPS = 20_000;
const STEPS_PER_CHARACTER = 30;

/** A value to match, and where in it a match may start, ascending. */
type Candidate = readonly [value: string, starts: readonly number[]];

const FROM_START: readonly number[] = [0];

/**
 * Whether a glob's parts match one of the values from one of its starts to its end, or `undefined`
 * once `budget` runs out. It reads each value once, keeping the places in the pattern that match so
 * far, each once, so its time grows with the values' length times the pattern's, and no more. With
 * `loose`, `*` and `?` match any character, as they do in a deny rule's tool pattern.
 */
function globMatch(
  values: readonly Candidate[],
  parts: readonly number[],
  loose: boolean,
  budget: Budget,
): boolean | undefined {
  const end = parts.length;
  // The parts, and past the last one a part no character matches: the loops never read past them.
  const pattern = Int32Array.from([...parts, END]);
  // Whether a single `*` or `?` must stop at a shell operator: none in the pattern, nothing to check.
  const narrow = !loose && parts.some((part) => part === STAR || part === ONE);
  // The places in the pattern that match so far, `count` of them, and those after the next character.
  let places = new Int32Array(end + 1);
  let next = new Int32Array(end + 1);
  // The step at which each place was last reached, so a place joins a step's list once. Steps count
  // on from one value to the next, so no mark carries over.
  const seen = new Int32Array(end + 1).fill(-1);
  let step = 0;
  for (const [value, starts] of values) {
    let count = 0;
    for (let i = 0, s = 0; ; i++, step++) {
      if (s < starts.length && starts[s] === i && seen[0] !== step) {
        seen[0] = step;
        places[count++] = 0;
      }
      while (s < starts.length && starts[s]! <= i) s++;
      // A `*` or `**` can match nothing, so the place after it is reached too (the loop visits what it adds).
      for (let k = 0; k < count; k++) {
        const after = places[k]! + 1;
        if (pattern[after - 1]! < ONE && seen[after] !== step) {
          seen[after] = step;
          places[count++] = after;
        }
      }
      if (i === value.length) {
        if (seen[end] === step) return true;
        // An empty value reads no character, and counts as one: so the steps grow with the values read.
        if (!i && (budget.left += STEPS_PER_CHARACTER - count - 1) < 0) return undefined;
        break;
      }
      if (!count && s === starts.length) break;
      if ((budget.left += STEPS_PER_CHARACTER - count - 1) < 0) return undefined;
      const code = value.charCodeAt(i);
      // What a single `*` or `?` may match: no shell control character, and no `$` that starts `$(`.
      const safe = !narrow || (!SHELL_CONTROL.includes(value[i]!) && !(code === 36 && value.charCodeAt(i + 1) === 40));
      let reached = 0;
      for (let k = 0; k < count; k++) {
        const place = places[k]!;
        const part = pattern[place]!;
        const to =
          part === ANY || (part === STAR && safe) ? place : part === code || (part === ONE && safe) ? place + 1 : -1;
        if (to >= 0 && seen[to] !== step + 1) {
          seen[to] = step + 1;
          next[reached++] = to;
        }
      }
      const read = places;
      places = next;
      next = read;
      count = reached;
    }
    step++;
  }
  return false;
}

/**
 * Whether a whole value matches a glob (see `globToRegExp`). It reads the value once, keeping the
 * places in the pattern that match so far, so its time grows with the value's length times the
 * pattern's, and no more: a long argument written by a model can't hold up the server or the page.
 */
export function matchesGlob(value: string, pattern: string): boolean {
  return globMatch([[value, FROM_START]], globParts(pattern), false, { left: Infinity }) === true;
}

/** Where a shell line splits into commands, inside quotes too: its operators, `$(`, and a subshell's parentheses. */
const COMMAND_BREAK = ';&|`\r\n()';
/** Space between words; line breaks are in `COMMAND_BREAK`. */
const SPACE = /\s/;
/** A stretch of a line with nothing in it for `pieces` to do: no space, quote, `\`, redirect or break. */
const PLAIN = /[^\s"'\\<>;&|`()]+/y;
/** Words that run the next one, past options of their own: `nohup git push`, `if git push; then`. */
const RUNS_NEXT = /^(?:[!{]|if|then|else|elif|do|while|until|time|command|exec|builtin|nohup)$/;
/** Programs that run a command among their arguments: `sudo -u root git push`, `sh -c "git push"`. */
const RUNS_LATER = /^(?:sudo|doas|env|nice|xargs|timeout|watch|eval|(?:ba|da|k|z)?sh)$/;
/** `find`'s options that run the words after them: `find . -exec rm {} \;`. */
const RUNS_AFTER = /^-(?:exec|execdir|ok|okdir)$/;

/** A command of a shell line: its words, each as its runs of non-space characters. */
interface Piece {
  words: string[][];
  /** It starts inside a quote, so its first word began in the piece before. */
  continued: boolean;
}

/**
 * A shell line in pieces, split at each character of `COMMAND_BREAK`, inside quotes too, and inside
 * quotes at `<` and `>` as well, since a quoted line may be one a shell runs (`sh -c "git push 2>&1"`).
 * Each piece holds its words as a shell splits them, quotes and `\` taken off. Outside quotes, a
 * redirect goes with the word it names (`>out`, `2>/dev/null`, `>&2`, `<<'EOF'`), so the words on
 * either side of it are one command, as a shell runs them, and a `\` before a line break joins the
 * lines. It reads the line once.
 */
function pieces(line: string): Piece[] {
  const out: Piece[] = [];
  let words: string[][] = [];
  // The word being read, as its runs so far, and the run being read.
  let word: string[] | undefined;
  let run = '';
  // The quote the line is in, a quote inside it, and whether the word being read is the one a
  // redirect names.
  let quote = '';
  let inner = '';
  let target = false;
  let continued = false;
  const endRun = () => {
    if (run) (word ??= []).push(run);
    run = '';
  };
  const endWord = () => {
    endRun();
    if (word?.length && !target) words.push(word);
    word = undefined;
    target = false;
  };
  const endPiece = () => {
    endWord();
    out.push({ words, continued });
    words = [];
    inner = '';
    continued = quote !== '';
    if (continued) word = [];
  };
  // A plain stretch from `i`, added to the run at once, and where it ends.
  const plain = (i: number) => {
    PLAIN.lastIndex = i;
    PLAIN.test(line);
    run += line.slice(i, PLAIN.lastIndex);
    return PLAIN.lastIndex - 1;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const next = line[i + 1];
    if (c === '\\' && quote !== "'") {
      // Before a line break, `\` joins the lines. Before a break, it leaves the break to split the
      // line, as a quote does. In double quotes, `\"` is a quote to the shell the line is given to.
      // Any other character it makes literal.
      if (next === '\n') i++;
      else if (quote && next === '"') {
        inner = inner ? '' : next;
        i++;
      } else if (next !== undefined && !COMMAND_BREAK.includes(next) && !(quote && (next === '<' || next === '>'))) {
        run += next;
        i++;
      }
    } else if (quote) {
      // A quoted line may be one a shell runs, which reads its quotes in turn: `inner`, the other
      // quote, keeps its spaces in the run, from where it opens in the piece.
      if (c === quote) quote = inner = '';
      else if (c === '"' || c === "'") inner = inner ? '' : c;
      else if (COMMAND_BREAK.includes(c) || c === '<' || c === '>') endPiece();
      else if (SPACE.test(c)) {
        if (inner) run += c;
        else endRun();
      } else if (c === '\\') run += c;
      else i = plain(i);
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= [];
    } else if (COMMAND_BREAK.includes(c) || ((c === '<' || c === '>') && next === '(')) {
      // `<(` and `>(` run a command of their own: the next piece.
      endPiece();
    } else if (c === '<' || c === '>') {
      // A redirect. A number written against it is the descriptor it redirects, not a word.
      if (!word && /^\d+$/.test(run)) run = '';
      endWord();
      // `>>`, `<>`, `>&`, `<&`, `>|`, then `<<`, `<<<` and `<<-`.
      if (next === '&' || next === '>' || (c === '>' && next === '|')) i++;
      else if (c === '<' && next === '<') {
        i++;
        if (line[i + 1] === '<' || line[i + 1] === '-') i++;
      }
      while (line[i + 1] === ' ' || line[i + 1] === '\t') i++;
      target = true;
    } else if (SPACE.test(c)) endWord();
    else i = plain(i);
  }
  endPiece();
  return out;
}

/**
 * Each command of a shell line (`pieces`), as its words joined by one space, with where in it the
 * command may start: its first word past `NAME=value` settings, that word without its path
 * (`/usr/bin/git` as `git`), the word after one in `RUNS_NEXT` or `RUNS_AFTER`, and every word after
 * one in `RUNS_LATER`. A quoted word a command may start at is a line a shell may run, read the same
 * way (`sh -c "FOO=1 git push"`), and so is the first word of a piece that starts inside a quote,
 * where the words after it may start a command too (`FOO="a;b" git push`).
 */
function commands(line: string): Candidate[] {
  return pieces(line).map(({ words, continued }) => {
    const runs = words.flat();
    // Each run's offset in the runs joined by spaces, and each word's first run.
    const at: number[] = [];
    for (let k = 0, offset = 0; k < runs.length; offset += runs[k++]!.length + 1) at.push(offset);
    const first: number[] = [];
    for (let k = 0, run = 0; k < words.length; run += words[k++]!.length) first.push(run);
    const texts = words.map((word) => word.join(' '));
    const starts: number[] = [];
    /**
     * Where a command may start among items `k` to `end` (words, or a quoted word's runs), in one
     * pass: the offset of each, and past its path, the program as a shell finds it.
     */
    const read = (
      items: readonly string[],
      offset: (k: number) => number,
      nest: (k: number) => void,
      k: number,
      end: number,
    ) => {
      // Looking for the command, among its arguments, or past a program that runs any of them.
      let state: 'command' | 'arguments' | 'any' = 'command';
      let options = false;
      for (; k < end; k++) {
        const item = items[k]!;
        if (state === 'arguments') {
          if (RUNS_AFTER.test(item)) {
            state = 'command';
            options = false;
          }
          continue;
        }
        if (state === 'command' && (/^[A-Za-z_]\w*=/.test(item) || (options && item.startsWith('-')))) continue;
        const path = item.lastIndexOf('/') + 1;
        starts.push(offset(k), offset(k) + path);
        nest(k);
        if (state === 'any') continue;
        const name = item.slice(path);
        if (RUNS_LATER.test(name)) state = 'any';
        else if (RUNS_NEXT.test(name)) options = true;
        else state = 'arguments';
      }
    };
    const none = () => {};
    const inRuns = (k: number) => read(runs, (j) => at[j]!, none, first[k]!, first[k]! + words[k]!.length);
    const nest = (j: number) => {
      if (words[j]!.length > 1) inRuns(j);
    };
    const inWords = (k: number) => read(texts, (j) => at[first[j]!]!, nest, k, words.length);
    if (continued && words.length) {
      inRuns(0);
      inWords(1);
    } else inWords(0);
    return [runs.join(' '), starts.sort((a, b) => a - b)] as const;
  });
}

/**
 * A text's commands (`commands`), less the matches its whole already tried: from the start of a
 * command that is the whole text, as `a`s or `npm test` are.
 */
function commandsOf(text: string): Candidate[] {
  const list: Candidate[] = [];
  for (const [command, starts] of commands(text)) {
    const from = command === text ? starts.filter((start) => start > 0) : starts;
    if (from.length) list.push([command, from]);
  }
  return list;
}

/**
 * What a deny rule matches of some texts: each whole from its start, and then each of their
 * commands, split the first time a rule needs them.
 */
interface Reading {
  whole: Candidate[];
  commands?: Candidate[] | undefined;
}

/** Each argument as deny rules read it (`readingsOf`), worked out once for all the rules of a call. */
type Readings = Map<unknown, Reading[] | undefined>;

/** Some texts as a deny rule reads them, each text once however often it comes. */
const reading = (texts: readonly string[]): Reading => ({
  whole: [...new Set(texts)].map((text) => [text, FROM_START] as const),
});

/**
 * What a deny rule reads of an argument: a text, or an array's items and then the items joined by
 * spaces; `undefined` for one it can't read: an object, or an array with an item that isn't text.
 * Worked out once for all the rules of a call, in `readings`.
 */
function readingsOf(value: unknown, readings: Readings): Reading[] | undefined {
  if (readings.has(value)) return readings.get(value);
  const text = argumentText(value);
  const items = text === undefined && Array.isArray(value) ? value.map(argumentText) : [text];
  const read = items.includes(undefined)
    ? undefined
    : text === undefined
      ? [reading(items as string[]), reading([items.join(' ')])]
      : [reading([text])];
  readings.set(value, read);
  return read;
}

/**
 * Whether a deny rule's pattern covers one of a reading's texts: the whole of it, as an allow rule
 * reads it, or any of its commands from where one may start (`commands`), so `git push*` denies
 * `git status && git push`. All the texts go in one pass each way, so an array's items cost what
 * their characters do, not the pattern's length each.
 */
function denyMatch(texts: Reading, parts: readonly number[], budget: Budget): boolean | undefined {
  const whole = globMatch(texts.whole, parts, false, budget);
  if (whole !== false) return whole;
  texts.commands ??= texts.whole.flatMap(([text]) => commandsOf(text));
  return globMatch(texts.commands, parts, false, budget);
}

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * An argument by name, as each reading of it present: the key itself, and for a dotted name the
 * nested argument too (`'options.cwd'`), since a call may carry both.
 */
function argumentValues(input: unknown, name: string): unknown[] {
  if (input === null || typeof input !== 'object') return [];
  const values = own(input, name) ? [(input as Record<string, unknown>)[name]] : [];
  if (!name.includes('.')) return values;
  let value: unknown = input;
  for (const key of name.split('.')) {
    if (value === null || typeof value !== 'object' || !own(value, key)) return values;
    value = (value as Record<string, unknown>)[key];
  }
  return [...values, value];
}

/** A string, number or boolean argument as text; anything else matches no allow pattern. */
function argumentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return undefined;
}

/**
 * Whether an argument matches a pattern, or `undefined` once `budget` runs out: as text for an allow
 * rule. A deny rule reads a text's commands too, an array by its items, all in one pass, and by the
 * items joined with spaces (`readingsOf`), and covers any other object, which it can't read: it
 * fails closed.
 */
function argumentMatches(
  value: unknown,
  parts: readonly number[],
  deny: boolean,
  budget: Budget,
  readings: Readings,
): boolean | undefined {
  if (!deny) {
    const text = argumentText(value);
    return text !== undefined && globMatch([[text, FROM_START]], parts, false, budget);
  }
  if (value == null) return false;
  const read = readingsOf(value, readings);
  if (!read) return true;
  let result: boolean | undefined = false;
  for (const texts of read) {
    const matched = denyMatch(texts, parts, budget);
    if (matched) return true;
    if (matched === undefined) result = undefined;
  }
  return result;
}

/**
 * Whether a rule covers a call: `true`, `false`, or `undefined` when it ran out of steps before it
 * could tell. The tool's name is read first, on steps of its own, which a name of usual length never
 * runs out of: a rule on another tool doesn't count against the call. A deny rule counts what it
 * can't read as covered: an object argument, or a `when` that throws.
 */
function covers(rule: ApprovalRule, toolName: string, input: unknown, readings: Readings): boolean | undefined {
  const deny = rule.effect !== 'allow';
  // A tool's name is no shell command: in a deny rule, `*` and `?` match any character of it, so `*`
  // covers every tool. An allow rule's tool pattern reads a name as its argument patterns read text.
  const tool = globMatch([[toolName, FROM_START]], globParts(rule.tool), deny, { left: RULE_STEPS });
  if (tool !== true) return tool;
  const budget: Budget = { left: RULE_STEPS };
  let result: boolean | undefined = true;
  for (const [name, pattern] of Object.entries(rule.args ?? {})) {
    const parts = globParts(pattern);
    // Each reading of the argument must match for an allow rule; one does for a deny rule.
    let matched: boolean | undefined = false;
    for (const value of argumentValues(input, name)) {
      const one = argumentMatches(value, parts, deny, budget, readings);
      if (!deny && one !== true) return one;
      if (one !== false) matched = one;
      if (deny && one) break;
    }
    if (matched === false) return false;
    if (matched === undefined) result = undefined;
  }
  if (rule.when) {
    let test: boolean;
    try {
      test = !!rule.when(input);
    } catch {
      test = deny;
    }
    if (!test) return false;
  }
  return result;
}

/**
 * Whether a rule applies to a call: its tool, every argument pattern, and its own test. A deny rule
 * reads more than an allow rule, to hold when a command is written another way: each command of a
 * shell line, from its first word past `NAME=value` settings, a path and a redirect, or after `sudo`,
 * `env`, `sh -c`, `find -exec`… (see `commands`); an array by its items; and an object, or a `when`
 * that throws, as covered. Matching takes a bounded amount of work (see `evaluateRules`), and what
 * it can't finish counts against the call: an allow rule doesn't apply, a deny rule does.
 */
export function ruleMatches(rule: ApprovalRule, toolName: string, input: unknown): boolean {
  return covers(rule, toolName, input, new Map()) ?? rule.effect !== 'allow';
}

/** How narrow a rule is, to report the most specific of several that match. */
const specificity = (rule: ApprovalRule) =>
  (rule.tool.includes('*') || rule.tool.includes('?') ? 0 : 100) +
  Object.keys(rule.args ?? {}).length * 10 +
  (rule.when ? 5 : 0);

/**
 * The rule that decides a call, if any. A deny rule wins over an allow rule, whatever their
 * order; among rules of the same effect the most specific is the one reported. Each rule's matching
 * takes a bounded amount of work, in proportion to the arguments it reads, an array's item counting
 * as one character at least: far more than common patterns need, however long the arguments. The
 * bound is each rule's, so a call's work grows with the number of rules times the arguments' length,
 * and a deny rule reads a string up to twice (whole, then by command) and an array up to four times
 * (all its items in one pass, each once however often it comes, then the items joined, each both
 * ways): cap the arguments where a client sends rules. A rule that runs out before it can tell
 * counts against the call: an allow rule allows nothing, and a deny rule denies, reported as
 * `unchecked` when no other deny rule covers the call.
 */
export function evaluateRules(rules: readonly ApprovalRule[], toolName: string, input: unknown): RuleMatch | undefined {
  // Each argument as deny rules read it, worked out once for all the rules.
  const readings: Readings = new Map();
  let best: ApprovalRule | undefined;
  let unchecked: ApprovalRule | undefined;
  // Deny rules first: one that covers the call wins, and then no allow rule is read. A rule that
  // can't beat the best so far by specificity isn't read either.
  for (const rule of rules) {
    if (rule.effect === 'allow' || (best && specificity(rule) <= specificity(best))) continue;
    const covered = covers(rule, toolName, input, readings);
    if (covered) best = rule;
    else if (covered === undefined && (!unchecked || specificity(rule) > specificity(unchecked))) unchecked = rule;
  }
  if (best) return { effect: 'deny', rule: best };
  if (unchecked) return { effect: 'deny', rule: unchecked, unchecked: true };
  for (const rule of rules) {
    if (rule.effect !== 'allow' || (best && specificity(rule) <= specificity(best))) continue;
    if (covers(rule, toolName, input, readings) === true) best = rule;
  }
  return best && { effect: 'allow', rule: best };
}

/** What a decision does now, and the rule it leaves, if any. */
export function decisionEffect(decision: ApprovalDecision): {
  approved: boolean;
  scope: 'once' | 'session' | 'always';
} {
  const approved = decision.startsWith('allow');
  const scope = decision.endsWith('session') ? 'session' : decision.endsWith('always') ? 'always' : 'once';
  return { approved, scope };
}

/** Program and subcommand words of a shell command, before the first option or operator. */
function commandPrefix(command: string) {
  const words: string[] = [];
  for (const word of command.trim().split(/\s+/)) {
    if (!word || word.startsWith('-') || /[;&|`<>$'"\\*?]/.test(word) || words.length === 2) break;
    words.push(word);
  }
  return words;
}

/**
 * Programs that run what their arguments say, by name or path: shells, interpreters, `npx`, and
 * commands that run or fetch another. Their program-and-next-word pattern would cover any code:
 * `sudo rm*` allows `sudo rm -rf /`, and `npx prettier*` allows `npx prettier-evil`.
 */
const RUNS_ARGUMENTS = /^(?:.*\/)?(?:(?:ba|z)?sh|node|python[\d.]*|sudo|env|npx|xargs|curl|wget)$/;

/**
 * The argument patterns a rule made from this call would start with: for a shell command, its
 * program and subcommand (`npm test*`), or the whole command when it has no subcommand or runs what
 * its arguments say (`rm -rf build`, `node -e "…"`), since `rm*` would allow `rm -rf ~`; otherwise
 * each string, number and boolean argument as it is. Globs are escaped. The person can widen them
 * before saving.
 */
export function suggestArgs(input: unknown): Record<string, string> | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (typeof record.command === 'string') {
    // The prefix's words have no glob characters to escape.
    const words = commandPrefix(record.command);
    return {
      command:
        words[1] && !words.some((word) => RUNS_ARGUMENTS.test(word))
          ? `${words.join(' ')}*`
          : record.command.replace(/[\\*?]/g, '\\$&'),
    };
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(record)) {
    const text = argumentText(value);
    if (text !== undefined) out[name] = text.replace(/[\\*?]/g, '\\$&');
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

let ruleIds = 0;

/**
 * The rule a decision leaves: none for `allow-once` and `deny-once`. `args` narrows it to some
 * arguments; without it, it covers every call of the tool.
 */
export function ruleFromDecision(
  decision: ApprovalDecision,
  request: Pick<ApprovalRequest, 'toolName'>,
  {
    args,
    reason,
    id,
    now,
  }: { args?: Record<string, string> | undefined; reason?: string; id?: string; now?: number } = {},
): ApprovalRule | undefined {
  const { approved, scope } = decisionEffect(decision);
  if (scope === 'once') return undefined;
  return {
    id: id ?? `rule-${Date.now().toString(36)}-${++ruleIds}`,
    tool: request.toolName.replace(/[\\*?]/g, '\\$&'),
    ...(args && Object.keys(args).length > 0 ? { args: { ...args } } : {}),
    effect: approved ? 'allow' : 'deny',
    scope: scope === 'session' ? 'session' : 'always',
    createdAt: now ?? Date.now(),
    ...(reason ? { reason } : {}),
  };
}

/** A rule in words: "run_command with command npm test*". */
export function describeRule(rule: Pick<ApprovalRule, 'tool' | 'args'>): string {
  const args = Object.entries(rule.args ?? {});
  const tool = rule.tool === '*' ? 'any tool' : rule.tool.replace(/\\(.)/g, '$1');
  return args.length === 0 ? `${tool}, any arguments` : `${tool} with ${args.map(([k, v]) => `${k} ${v}`).join(', ')}`;
}

/* AI SDK 7: the same rules on the server, for `streamText({ toolApproval })`. */

/** AI SDK 7's `ToolApprovalStatus`, as `toToolApproval` returns it. */
export type ToolApprovalStatusLike =
  | 'not-applicable'
  | 'approved'
  | 'denied'
  | 'user-approval'
  | { type: 'approved' | 'denied' | 'user-approval'; reason?: string };

/** How `toToolApproval` answers: for the calls no rule covers, and in the reason a rule gives. */
export interface ToToolApprovalOptions {
  /**
   * What a call no rule covers gets. Default `'user-approval'`: a person decides.
   * `'not-applicable'` leaves the call to another `toolApproval`, such as a second set of rules.
   */
  otherwise?: ToolApprovalStatusLike | undefined;
  /**
   * The reason for a call a rule decides, which the approval keeps as `approval.reason`: say whose
   * rules these are, so a page can tell the server's from the person's. Default: "Allowed by a
   * rule: …" or "Denied by a rule: …", the rule in words (`describeRule`), then its own reason; for
   * an `unchecked` match, "Denied: the arguments are too long to check against a rule: …".
   */
  reason?: ((match: RuleMatch) => string) | undefined;
}

/**
 * The reason `toToolApproval` gives unless told otherwise: "Denied by a rule: rm * (No deletes)", or
 * for an `unchecked` rule "Denied: the arguments are too long to check against a rule: …".
 */
function ruleReason({ effect, rule, unchecked }: RuleMatch) {
  if (unchecked) return `Denied: the arguments are too long to check against a rule: ${describeRule(rule)}`;
  return `${effect === 'allow' ? 'Allowed' : 'Denied'} by a rule: ${describeRule(rule)}${
    rule.reason ? ` (${rule.reason})` : ''
  }`;
}

/**
 * Rules as AI SDK 7's generic `toolApproval` function: a matching rule approves or denies the call
 * on the server, with the rule in the reason (`reason` words it), and any other call gets
 * `otherwise` (by default `'user-approval'`, a person decides). The SDK checks it again on the
 * approved call before it runs, edited arguments included.
 *
 * Rules a client sends are the choices of the person using it: take them for that person's own
 * runs only, and keep rules that protect others on the server.
 */
export function toToolApproval(
  rules: readonly ApprovalRule[] | (() => readonly ApprovalRule[]),
  { otherwise = 'user-approval', reason = ruleReason }: ToToolApprovalOptions = {},
): (options: { toolCall: { toolName: string; input: unknown } }) => ToolApprovalStatusLike {
  return ({ toolCall }) => {
    const match = evaluateRules(typeof rules === 'function' ? rules() : rules, toolCall.toolName, toolCall.input);
    if (!match) return otherwise;
    return { type: match.effect === 'allow' ? 'approved' : 'denied', reason: reason(match) };
  };
}

/** A decision as the response `addToolApprovalResponse` (from `useChat`) takes. */
export function toToolApprovalResponse(
  id: string,
  decision: ApprovalDecision,
  reason?: string,
): { id: string; approved: boolean; reason?: string } {
  const { approved } = decisionEffect(decision);
  return reason ? { id, approved, reason } : { id, approved };
}

/**
 * Messages with one tool call's input replaced, for approving edited arguments with AI SDK 7: set
 * them with `setMessages` (from `useChat`), then answer the approval. The server runs the call with the
 * input in the messages, after checking it against the tool's schema and `toolApproval` again.
 * When the tool's schema changed what the model sent (a default filled in, a value coerced, a key
 * dropped), the approval keeps what the model sent as `inputSchemaInput`, and the server checks the
 * call against it, so it gets the edit too. The server runs only an edit that comes out of the
 * schema unchanged, and out of `experimental_refineToolInput` too when that is set: keep the fields
 * the schema fills in (the card starts an edit from the input it shows, defaults included), and use
 * transforms that give the same result when run twice.
 * With `experimental_toolApprovalSecret` set, the server signs the input it asked about and refuses
 * any other, so edits fail there by design.
 */
export function setToolInput<M extends { parts: readonly unknown[] }>(
  messages: readonly M[],
  toolCallId: string,
  input: unknown,
): M[] {
  return messages.map((message) => {
    const index = message.parts.findIndex(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        (part as { toolCallId?: unknown }).toolCallId === toolCallId &&
        'input' in part,
    );
    if (index === -1) return message;
    const parts = [...message.parts];
    const part = parts[index] as { approval?: unknown };
    const { approval } = part;
    parts[index] =
      typeof approval === 'object' && approval !== null && 'inputSchemaInput' in approval
        ? { ...part, input, approval: { ...approval, inputSchemaInput: input } }
        : { ...part, input };
    return { ...message, parts };
  });
}

/* A person's rules with each request: plain data from the page, checked again on the server. */

/**
 * A tool pattern's literal start, and its literal end backwards: what comes before its first
 * wildcard, and after its last. A `\` escape counts as a wildcard too, which can only make the
 * pattern seem to match more. Each has a `\uffff` where the pattern starts or ends, so one with no
 * wildcard can't meet a pattern that needs more characters than it has.
 */
function ends(tool: string): string[] {
  const runs = `\uffff${tool}\uffff`.split(/\\[\s\S]|[*?]/);
  return [runs[0]!, runs.at(-1)!.split('').reverse().join('')];
}

/**
 * Whether two tool patterns, as `ends`, could match one name: of their literal starts one starts
 * the other, and so it is with their ends. It can say yes for two that never meet, never no for
 * two that do.
 */
const mayOverlap = (x: string[], y: string[]) =>
  x.every((end, i) => end.slice(0, y[i]!.length) === y[i]!.slice(0, end.length));

/**
 * The rules less the allow rules that left-out deny rules would overrule: those on a tool one of
 * them could name. The calls they cover then go to the page, which has every rule.
 */
function withoutOverruled(rules: ApprovalRule[], leftOut: string[]): ApprovalRule[] {
  // Each pattern's ends once: a pair then costs only the two compares in `mayOverlap`.
  const denied = leftOut.map(ends);
  return rules.filter((rule) => {
    const tool = rule.effect === 'allow' && ends(rule.tool);
    return !tool || !denied.some((other) => mayOverlap(tool, other));
  });
}

/**
 * Rules as plain data, to send with a request: copies, as JSON carries them. A rule with a `when`
 * is left out, since `when` is code and without it the rule would cover more calls than it does on
 * the page. For a deny rule with a `when`, so are the allow rules on the tools it covers, which it
 * would overrule on the page: the server asks about those calls, and the page answers them with
 * every rule.
 */
export function toPlainRules(rules: readonly ApprovalRule[]): ApprovalRule[] {
  const sent = rules.filter((rule) => !rule.when);
  const leftOut = rules.filter((rule) => rule.when && rule.effect === 'deny').map((rule) => rule.tool);
  return JSON.parse(JSON.stringify(withoutOverruled(sent, leftOut))) as ApprovalRule[];
}

/** What `parseApprovalRules` accepts from a client. */
export interface ApprovalRuleLimits {
  /** How many rules are read: those after the first `maxRules` are left out. Default 100. */
  maxRules?: number | undefined;
  /** Argument patterns in one rule. Default 20. */
  maxArgs?: number | undefined;
  /** Characters in one string: an id, a tool, an argument's name or pattern, a reason. Default 500. */
  maxLength?: number | undefined;
  /**
   * `*` wildcards in one pattern, `**` counting as one. Default 3, enough for a rule on what a
   * command contains (`git push*--force*`). Matching takes the argument's length times the
   * pattern's, whatever the number of `*`; `evaluateRules` bounds what each rule takes.
   */
  maxWildcards?: number | undefined;
}

/** The `*` wildcards in a pattern: a run of them counts once, an escaped one not at all. */
function wildcards(pattern: string) {
  let count = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') i++;
    else if (pattern[i] === '*') {
      count++;
      while (pattern[i + 1] === '*') i++;
    }
  }
  return count;
}

/** Tools named by the deny rules `parseApprovalRules` leaves out: past this many, it keeps no allow rule. */
const MAX_LEFT_OUT_TOOLS = 10;

/**
 * The rules a client sent, such as a request body's `rules`, checked on the server: each field of
 * the right type and within `limits`, other fields dropped. A rule that fails a check is left out,
 * and so is everything when `value` is not an array. A deny rule left out takes with it the allow
 * rules it could overrule: those on a tool it names, or all of them when its tool is missing, not
 * a string or too long, when it comes after the first `maxRules`, or when the deny rules left out
 * name more than 10 tools. A rule left out still holds on the page, which answers the call when the
 * server asks.
 */
export function parseApprovalRules(
  value: unknown,
  { maxRules = 100, maxArgs = 20, maxLength = 500, maxWildcards = 3 }: ApprovalRuleLimits = {},
): ApprovalRule[] {
  if (!Array.isArray(value)) return [];
  const text = (v: unknown): v is string => typeof v === 'string' && v.length <= maxLength;
  const pattern = (v: unknown): v is string => text(v) && wildcards(v) <= maxWildcards;
  const rules: ApprovalRule[] = [];
  // The tool of each deny rule left out: `undefined` when it can't bound the calls the rule covers.
  const leftOut: Array<string | undefined> = [];
  for (const item of value.slice(0, maxRules)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const { id, tool, args, effect, scope, createdAt, reason } = item as Record<string, unknown>;
    // A deny rule counts as left out until it passes every check.
    if (effect === 'deny') leftOut.push(text(tool) ? tool : undefined);
    if (!text(id) || !pattern(tool)) continue;
    if ((effect !== 'allow' && effect !== 'deny') || (scope !== 'session' && scope !== 'always')) continue;
    if ((createdAt !== undefined && !Number.isFinite(createdAt)) || (reason !== undefined && !text(reason))) continue;
    let checked: Record<string, string> | undefined;
    if (args !== undefined) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
      const entries = Object.entries(args);
      if (entries.length > maxArgs || !entries.every(([name, glob]) => text(name) && pattern(glob))) continue;
      checked = Object.fromEntries(entries) as Record<string, string>;
    }
    if (effect === 'deny') leftOut.pop();
    rules.push({
      id,
      tool,
      ...(checked ? { args: checked } : {}),
      effect,
      scope,
      ...(createdAt !== undefined ? { createdAt: createdAt as number } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
  }
  const tools = new Set(leftOut);
  // A deny rule whose tool can't be read, or one past `maxRules`, could be on any tool. Past a few
  // tools, no allow rule stays either: each one is checked against each tool, so the check grows
  // with the number of rules, not its square.
  const anyTool =
    tools.has(undefined) ||
    tools.size > MAX_LEFT_OUT_TOOLS ||
    value.slice(maxRules).some((item) => item?.effect === 'deny');
  if (anyTool) return rules.filter((rule) => rule.effect === 'deny');
  return tools.size ? withoutOverruled(rules, [...tools] as string[]) : rules;
}

/* Agent Client Protocol: `session/request_permission`, typed here so nothing new is installed. */

/** ACP `PermissionOptionKind`. */
export type AcpPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

/** ACP `PermissionOption`: a choice the agent offers. */
export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

/** What `toAcpPermissionResponse` reads of ACP's `RequestPermissionRequest`. */
export interface AcpRequestPermissionRequest {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title?: string | null | undefined;
    /** The tool's programmatic name, when the agent sends one (ACP 1.8). */
    name?: string | null | undefined;
    kind?: string | null | undefined;
    rawInput?: unknown;
  };
  options: readonly AcpPermissionOption[];
}

/** ACP `RequestPermissionResponse`. */
export interface AcpRequestPermissionResponse {
  outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string };
}

const ACP_KIND: Record<AcpPermissionOptionKind, ApprovalDecision> = {
  allow_once: 'allow-once',
  allow_always: 'allow-always',
  reject_once: 'deny-once',
  reject_always: 'deny-always',
};

/**
 * The tool name rules and cards use for an ACP tool call: its programmatic `name` when the agent
 * sends one, else its `kind` (`edit`, `execute`…), else its `title`.
 */
export function acpToolName(toolCall: {
  name?: string | null | undefined;
  kind?: string | null | undefined;
  title?: string | null | undefined;
}): string {
  return toolCall.name || toolCall.kind || toolCall.title || 'tool';
}

/** An ACP permission request as the card's request: the tool call's id, name, and raw input. */
export function fromAcpPermissionRequest(request: AcpRequestPermissionRequest): ApprovalRequest & { title?: string } {
  const { toolCall } = request;
  return {
    id: toolCall.toolCallId,
    toolCallId: toolCall.toolCallId,
    toolName: acpToolName(toolCall),
    input: toolCall.rawInput,
    ...(toolCall.title ? { title: toolCall.title } : {}),
  };
}

/**
 * The option a decision answers: the agent's only option of that kind, `allow_once` for
 * `allow-session`. None when the agent sent several, as they grant different things. `deny-once`
 * takes the agent's first `reject_once` even then: a "no" grants nothing, and the card can always
 * decline.
 */
function acpOption(decision: ApprovalDecision, options: readonly AcpPermissionOption[]) {
  const want = decision === 'allow-session' ? 'allow-once' : decision;
  const matching = options.filter((o) => ACP_KIND[o.kind] === want);
  return matching.length === 1 || want === 'deny-once' ? matching[0] : undefined;
}

/**
 * The decisions to offer for an ACP request: one per kind of option the agent sent, plus
 * `allow-session`, which the client keeps as a rule of its own (ACP has no session option). A kind
 * the agent sent several options of is left out, since a button can't say which one it picks:
 * Claude Code's ExitPlanMode sends up to three `allow_always` options, one of them clearing the
 * context and switching to auto mode, so it gets Approve and Deny but no Always. Deny stays
 * whenever the agent sent a `reject_once`, and answers its first one.
 */
export function decisionsFromAcpOptions(options: readonly AcpPermissionOption[]): ApprovalDecision[] {
  return APPROVAL_DECISIONS.filter((d) => acpOption(d, options));
}

/**
 * A decision as ACP's response: the agent's one option of the same kind. `allow-session` selects
 * `allow_once`: the session rule stays on the client, so it never grants more than the agent's
 * "once". With no option of that kind, or several, the request is cancelled, as ACP asks of a
 * client that can't answer: it never picks one of several grants for the person. `deny-once`
 * answers the first of several `reject_once` options, since a denial grants nothing.
 */
export function toAcpPermissionResponse(
  decision: ApprovalDecision,
  options: readonly AcpPermissionOption[],
): AcpRequestPermissionResponse {
  const option = acpOption(decision, options);
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

/** An ACP response as the decision it records, or `cancelled`. */
export function fromAcpPermissionResponse(
  response: AcpRequestPermissionResponse,
  options: readonly AcpPermissionOption[],
): ApprovalDecision | 'cancelled' {
  if (response.outcome.outcome === 'cancelled') return 'cancelled';
  const { optionId } = response.outcome;
  const option = options.find((o) => o.optionId === optionId);
  return option ? ACP_KIND[option.kind] : 'cancelled';
}
