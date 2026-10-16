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
  /** The tool's name, or a glob over names: `*` for every tool, `mcp_github_*` for a family. */
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

/** Matching work left for one call, in steps: each character read costs the places that match so far, plus one. */
interface Budget {
  left: number;
  /** The argument texts read so far, each credited once, with its commands once a deny rule splits it. */
  texts?: Map<string, Array<[string, number[]]> | undefined>;
}

/**
 * The steps `evaluateRules` has for a call, all its rules together: this many, a few tens of
 * milliseconds, and `STEPS_PER_CHARACTER` more for each character of the arguments they read. A rule
 * it hasn't decided by then counts against the call: an allow rule allows nothing, a deny rule denies.
 */
const MATCH_STEPS = 5_000_000;
const STEPS_PER_CHARACTER = 30;

/** Credit the budget for an argument's text, once: a long argument gets time in proportion to its length. */
function credit(text: string, budget: Budget) {
  budget.texts ??= new Map();
  if (budget.texts.has(text)) return;
  budget.texts.set(text, undefined);
  budget.left += STEPS_PER_CHARACTER * text.length;
}

/**
 * Whether `value` matches a glob's parts from one of the `starts` (ascending) to its end, or
 * `undefined` once `budget` runs out. It reads the value once, keeping the places in the pattern that
 * match so far, each once, so its time grows with the value's length times the pattern's, and no
 * more. With `loose`, `*` and `?` match any character, as they do in a tool's name.
 */
function globMatch(
  value: string,
  parts: readonly number[],
  starts: readonly number[],
  loose: boolean,
  budget: Budget,
): boolean | undefined {
  // The step at which each place was last reached, so a place joins a step's list once.
  const seen = new Int32Array(parts.length + 1).fill(-1);
  let places: number[] = [];
  const reach = (list: number[], place: number, step: number) => {
    if (seen[place] === step) return;
    seen[place] = step;
    list.push(place);
  };
  for (let i = 0, s = 0; ; i++) {
    if (starts[s] === i) reach(places, 0, i);
    while (starts[s]! <= i) s++;
    // A `*` or `**` can match nothing, so the place after it is reached too (the loop visits what it adds).
    for (let k = 0; k < places.length; k++) if (parts[places[k]!]! < ONE) reach(places, places[k]! + 1, i);
    if (i === value.length) return seen[parts.length] === i;
    if (!places.length && s === starts.length) return false;
    if ((budget.left -= places.length + 1) < 0) return undefined;
    // What a single `*` or `?` may match: no shell control character, and no `$` that starts `$(`.
    const safe = loose || (!SHELL_CONTROL.includes(value[i]!) && !value.startsWith('$(', i));
    const next: number[] = [];
    for (const place of places) {
      const part = parts[place];
      if (part === ANY || (part === STAR && safe)) reach(next, place, i + 1);
      else if (part === value.charCodeAt(i) || (part === ONE && safe)) reach(next, place + 1, i + 1);
    }
    places = next;
  }
}

/**
 * Whether a whole value matches a glob (see `globToRegExp`). It reads the value once, keeping the
 * places in the pattern that match so far, so its time grows with the value's length times the
 * pattern's, and no more: a long argument written by a model can't hold up the server or the page.
 */
export function matchesGlob(value: string, pattern: string): boolean {
  return globMatch(value, globParts(pattern), [0], false, { left: Infinity }) === true;
}

/** Where a shell line splits into commands: its operators, `$(`, and the parentheses of a subshell. */
const COMMAND_BREAK = /[;&|`<>\r\n()]/;
/** Words that run the next one, past options of their own: `nohup git push`, `if git push; then`. */
const RUNS_NEXT = /^(?:[!{]|if|then|else|elif|do|while|until|time|command|exec|builtin|nohup)$/;
/** Programs that run a command among their arguments: `sudo -u root git push`, `sh -c "git push"`. */
const RUNS_LATER = /^(?:sudo|doas|env|nice|xargs|timeout|watch|eval|(?:ba|da|k|z)?sh)$/;

/**
 * Each command of a shell line, split at operators even inside quotes, as the words a shell would run
 * (quotes and `\` taken off, one space between them), with where in it the command may start: its
 * first word past `NAME=value` settings, that word without its path (`/usr/bin/git` as `git`), the
 * word after one in `RUNS_NEXT`, and every word after one in `RUNS_LATER`.
 */
function commands(line: string): Array<[string, number[]]> {
  return line.split(COMMAND_BREAK).map((segment) => {
    // Runs of plain characters, `\` escapes and quoted strings (closed or not), then unquoted.
    const words = (segment.match(/(?:[^\s"'\\]|\\[\s\S]?|"(?:[^"\\]|\\[\s\S]?)*"?|'[^']*'?)+/g) ?? []).map((word) =>
      word.replace(/\\([\s\S])|["']/g, '$1'),
    );
    // Each word's offset in the words joined by spaces.
    const at: number[] = [];
    for (let k = 0, offset = 0; k < words.length; offset += words[k++]!.length + 1) at.push(offset);
    // Ascending: the word's offset, and the offset past its path, the program as a shell finds it.
    const starts: number[] = [];
    const start = (k: number) => {
      const path = words[k]!.lastIndexOf('/') + 1;
      starts.push(at[k]!, at[k]! + path);
      return words[k]!.slice(path);
    };
    for (let k = 0, options = false; k < words.length; k++) {
      if (/^[A-Za-z_]\w*=/.test(words[k]!) || (options && words[k]!.startsWith('-'))) continue;
      const name = start(k);
      if (RUNS_LATER.test(name)) while (++k < words.length) start(k);
      if (!RUNS_NEXT.test(name)) break;
      options = true;
    }
    return [words.join(' '), starts];
  });
}

/**
 * Whether a deny rule's pattern covers a text: the whole of it, as an allow rule reads it, or any of
 * its commands from where one may start (`commands`), so `git push*` denies `git status && git push`.
 */
function denyMatch(text: string, parts: readonly number[], budget: Budget): boolean | undefined {
  const whole = globMatch(text, parts, [0], false, budget);
  if (whole !== false) return whole;
  budget.texts ??= new Map();
  let lines = budget.texts.get(text);
  if (!lines) {
    budget.left -= text.length;
    budget.texts.set(text, (lines = commands(text)));
  }
  for (const [command, starts] of lines) {
    const result = budget.left < 0 ? undefined : globMatch(command, parts, starts, false, budget);
    if (result !== false) return result;
  }
  return false;
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
 * Whether an argument matches a pattern: as text for an allow rule. A deny rule reads a text's
 * commands too (`denyMatch`), an array by each item and by the items joined with spaces, and
 * covers any other object, which it can't read: it fails closed.
 */
function argumentMatches(value: unknown, parts: readonly number[], deny: boolean, budget: Budget) {
  const text = argumentText(value);
  if (text !== undefined) {
    credit(text, budget);
    return deny ? denyMatch(text, parts, budget) : globMatch(text, parts, [0], false, budget);
  }
  if (!deny || value == null) return false;
  const items = Array.isArray(value) ? value.map(argumentText) : [undefined];
  if (items.includes(undefined)) return true;
  const line = items.join(' ');
  credit(line, budget);
  for (const item of [...items, line]) {
    const result = denyMatch(item!, parts, budget);
    if (result !== false) return result;
  }
  return false;
}

/**
 * Whether a rule covers a call, within `budget`. A deny rule counts what it can't decide as covered:
 * an argument it can't read, a `when` that throws, or matching it had no budget left to finish.
 */
function covers(rule: ApprovalRule, toolName: string, input: unknown, budget: Budget): boolean {
  const deny = rule.effect !== 'allow';
  const decided = (result: boolean | undefined) => (deny ? result !== false : result === true);
  // A tool's name is no shell command: its `*` and `?` match any character.
  if (!decided(globMatch(toolName, globParts(rule.tool), [0], true, budget))) return false;
  for (const [name, pattern] of Object.entries(rule.args ?? {})) {
    const parts = globParts(pattern);
    const results = argumentValues(input, name).map((value) => decided(argumentMatches(value, parts, deny, budget)));
    // Each reading of the argument must match for an allow rule; one does for a deny rule.
    if (!results.length || (deny ? !results.includes(true) : results.includes(false))) return false;
  }
  if (!rule.when) return true;
  try {
    return !!rule.when(input);
  } catch {
    return deny;
  }
}

/**
 * Whether a rule applies to a call: its tool, every argument pattern, and its own test. A deny rule
 * reads more than an allow rule, to hold when a command is written another way: each command of a
 * shell line, from its first word past `NAME=value` settings and a path, or after `sudo`, `env`,
 * `sh -c`…; an array by its items; and an object, or a `when` that throws, as covered.
 */
export function ruleMatches(rule: ApprovalRule, toolName: string, input: unknown): boolean {
  return covers(rule, toolName, input, { left: MATCH_STEPS });
}

/** How narrow a rule is, to report the most specific of several that match. */
const specificity = (rule: ApprovalRule) =>
  (rule.tool.includes('*') || rule.tool.includes('?') ? 0 : 100) +
  Object.keys(rule.args ?? {}).length * 10 +
  (rule.when ? 5 : 0);

/**
 * The rule that decides a call, if any. A deny rule wins over an allow rule, whatever their
 * order; among rules of the same effect the most specific is the one reported. Matching all the
 * rules takes a bounded amount of work, a few tens of milliseconds and a little more for each
 * character of the arguments they read: what it can't finish counts against the call, so an allow
 * rule allows nothing and a deny rule denies.
 */
export function evaluateRules(rules: readonly ApprovalRule[], toolName: string, input: unknown): RuleMatch | undefined {
  const budget: Budget = { left: MATCH_STEPS };
  let best: ApprovalRule | undefined;
  // Deny rules first: one that matches wins, and then no allow rule is read.
  for (const allow of [false, true]) {
    for (const rule of rules)
      if (
        (rule.effect === 'allow') === allow &&
        (!best || specificity(rule) > specificity(best)) &&
        covers(rule, toolName, input, budget)
      )
        best = rule;
    if (best) return { effect: best.effect, rule: best };
  }
  return undefined;
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
   * rule: …" or "Denied by a rule: …", the rule in words (`describeRule`), then its own reason.
   */
  reason?: ((match: RuleMatch) => string) | undefined;
}

/** The reason `toToolApproval` gives unless told otherwise: "Denied by a rule: rm * (No deletes)". */
function ruleReason({ effect, rule }: RuleMatch) {
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
   * pattern's, whatever the number of `*`; `evaluateRules` bounds what one call's rules take.
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
