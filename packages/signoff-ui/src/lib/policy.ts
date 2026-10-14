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
   * a nested argument (`'options.cwd'`). Absent: any arguments.
   */
  args?: Readonly<Record<string, string>> | undefined;
  /** A test of your own on the input, on top of `args`. Code, so storage does not keep it. */
  when?: ((input: unknown) => boolean) | undefined;
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
  toolName: string;
  input: unknown;
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

/**
 * Whether a whole value matches a glob (see `globToRegExp`). It reads the value once, keeping the
 * places in the pattern that match so far, so its time grows with the value's length times the
 * pattern's, and no more: a long argument written by a model can't hold up the server or the page.
 */
export function matchesGlob(value: string, pattern: string): boolean {
  const parts = globParts(pattern);
  let places = new Set([0]);
  for (let i = 0; ; i++) {
    // A `*` or `**` can match nothing, so the place after it is reached too (the loop visits what it adds).
    for (const place of places) if (parts[place]! < ONE) places.add(place + 1);
    if (i === value.length) return places.has(parts.length);
    // What a single `*` or `?` may match: no shell control character, and no `$` that starts `$(`.
    const safe = !SHELL_CONTROL.includes(value[i]!) && !value.startsWith('$(', i);
    const next = new Set<number>();
    for (const place of places) {
      const part = parts[place];
      if (part === ANY || (part === STAR && safe)) next.add(place);
      else if (part === value.charCodeAt(i) || (part === ONE && safe)) next.add(place + 1);
    }
    places = next;
  }
}

/** An argument by name, dotted names reading nested objects: `'options.cwd'`. */
function argument(input: unknown, name: string): unknown {
  if (input === null || typeof input !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(input, name)) return (input as Record<string, unknown>)[name];
  let value: unknown = input;
  for (const key of name.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A string, number or boolean argument as text; anything else matches no pattern. */
function argumentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return undefined;
}

/** Whether a rule applies to a call: its tool, every argument pattern, and its own test. */
export function ruleMatches(rule: ApprovalRule, toolName: string, input: unknown): boolean {
  if (!matchesGlob(toolName, rule.tool)) return false;
  for (const [name, pattern] of Object.entries(rule.args ?? {})) {
    const text = argumentText(argument(input, name));
    if (text === undefined || !matchesGlob(text, pattern)) return false;
  }
  if (rule.when) {
    try {
      if (!rule.when(input)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** How narrow a rule is, to report the most specific of several that match. */
const specificity = (rule: ApprovalRule) =>
  (rule.tool.includes('*') || rule.tool.includes('?') ? 0 : 100) +
  Object.keys(rule.args ?? {}).length * 10 +
  (rule.when ? 5 : 0);

/**
 * The rule that decides a call, if any. A deny rule wins over an allow rule, whatever their
 * order; among rules of the same effect the most specific is the one reported.
 */
export function evaluateRules(rules: readonly ApprovalRule[], toolName: string, input: unknown): RuleMatch | undefined {
  let best: ApprovalRule | undefined;
  for (const rule of rules) {
    if (!ruleMatches(rule, toolName, input)) continue;
    if (
      !best ||
      (rule.effect === 'deny' && best.effect === 'allow') ||
      (rule.effect === best.effect && specificity(rule) > specificity(best))
    )
      best = rule;
  }
  return best ? { effect: best.effect, rule: best } : undefined;
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
  return words.join(' ');
}

/**
 * The argument patterns a rule made from this call would start with: for a shell command, its
 * program and subcommand (`npm test*`); otherwise each string, number and boolean argument as it
 * is (globs escaped). The person can widen them before saving.
 */
export function suggestArgs(input: unknown): Record<string, string> | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (typeof record.command === 'string') {
    const prefix = commandPrefix(record.command);
    return prefix ? { command: `${prefix.replace(/[\\*?]/g, '\\$&')}*` } : undefined;
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
    parts[index] = { ...(parts[index] as object), input };
    return { ...message, parts };
  });
}

/* A person's rules with each request: plain data from the page, checked again on the server. */

/** Past every character code: where a pattern starts and ends, for `mayOverlap`. */
const EDGE = 0x10000;

/**
 * Whether two tool patterns could match one name: their literal starts agree, and so do their
 * literal ends. It can say yes for two that never meet, never no for two that do.
 */
function mayOverlap(a: string, b: string): boolean {
  // Marked at both ends with a code no character has, so a pattern with no wildcard can't meet one
  // that needs more characters than it has.
  const x = [EDGE, ...globParts(a), EDGE];
  const y = [EDGE, ...globParts(b), EDGE];
  // While both are literal (past its end, a part is undefined and stops it too).
  const agree = (p: number[], q: number[]) => {
    for (let i = 0; p[i]! >= 0 && q[i]! >= 0; i++) if (p[i] !== q[i]) return false;
    return true;
  };
  return agree(x, y) && agree(x.reverse(), y.reverse());
}

/**
 * The rules less the allow rules that left-out deny rules would overrule: those on a tool one of
 * them could name, or all of them for one with no name it can read (`undefined`). The calls they
 * cover then go to the page, which has every rule.
 */
function withoutOverruled(rules: ApprovalRule[], leftOut: ReadonlyArray<string | undefined>): ApprovalRule[] {
  return rules.filter(
    (rule) => rule.effect === 'deny' || !leftOut.some((tool) => tool === undefined || mayOverlap(rule.tool, tool)),
  );
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
   * pattern's, whatever the number of `*`, so `maxLength` is what bounds it.
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

/**
 * The rules a client sent, such as a request body's `rules`, checked on the server: each field of
 * the right type and within `limits`, other fields dropped. A rule that fails a check is left out,
 * and so is everything when `value` is not an array. A deny rule left out takes with it the allow
 * rules it could overrule: those on a tool it names, or all of them when its tool is missing, too
 * long, or past `maxRules`. A rule left out still holds on the page, which answers the call when
 * the server asks.
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
  for (const [i, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const { id, tool, args, effect, scope, createdAt, reason } = item as Record<string, unknown>;
    // A deny rule counts as left out until it passes every check.
    if (effect === 'deny') leftOut.push(i < maxRules && text(tool) ? tool : undefined);
    if (i >= maxRules || !text(id) || !pattern(tool)) continue;
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
  return withoutOverruled(rules, leftOut);
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
 * The decisions to offer for an ACP request: one per option the agent sent, plus
 * `allow-session`, which the client keeps as a rule of its own (ACP has no session option).
 */
export function decisionsFromAcpOptions(options: readonly AcpPermissionOption[]): ApprovalDecision[] {
  const offered = new Set(options.map((option) => ACP_KIND[option.kind]).filter(Boolean));
  if (offered.has('allow-once')) offered.add('allow-session');
  return APPROVAL_DECISIONS.filter((d) => offered.has(d));
}

/**
 * A decision as ACP's response: the option of the same kind. `allow-session` selects
 * `allow_once`: the session rule stays on the client, so it never grants more than the agent's
 * "once". Without a matching option the request is cancelled, as ACP asks of a client that can't answer.
 */
export function toAcpPermissionResponse(
  decision: ApprovalDecision,
  options: readonly AcpPermissionOption[],
): AcpRequestPermissionResponse {
  const want = decision === 'allow-session' ? 'allow-once' : decision;
  const option = options.find((o) => ACP_KIND[o.kind] === want);
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
