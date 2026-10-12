import type { LanguageModel } from 'ai';
import type { DiffReviewToolOutput } from 'signoff-ui/core';
import { pause } from './pace';
import { BRANCH, PROJECT, type Files } from './project';
import { canRevise, hasFix, proposeFix, proposeRevision } from './scripted-edits';
import { runTests, type CommandResult } from './shell';
import { applyReview, changesFrom, isReviewOutput } from './workspace';

/*
 * The scripted agent: a language model (AI SDK's LanguageModelV4) that plays one task, so the app
 * runs with no API key. Each call reads the conversation, works out where the run is from the tool
 * results so far (what you approved, applied, rejected and commented), and streams the next step:
 * reasoning, text and tool calls, with a model's timing. The route runs it exactly as it runs a
 * real model: the same tools, approval rules and review round trips.
 */

type Model = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type Prompt = Parameters<Model['doStream']>[0]['prompt'];
type StreamPart = Awaited<ReturnType<Model['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;
type ContentPart = Exclude<Prompt[number]['content'], string>[number];
type ToolOutput = Extract<ContentPart, { type: 'tool-result' }>['output'];
type Usage = Extract<StreamPart, { type: 'finish' }>['usage'];

export const SCRIPTED_MODEL_ID = 'scripted-agent';

interface Call {
  id: string;
  name: string;
  input: unknown;
}

/** One model call: how long before the first token, then what it streams. */
interface Step {
  delay: number;
  reasoning?: string;
  text?: string;
  calls?: Call[];
}

/** Where the run is: which run (one per user message), each tool call's result, the files as applied. */
interface RunState {
  run: number;
  outputs: ReadonlyMap<string, ToolOutput>;
  files: Files;
}

function readPrompt(prompt: Prompt): RunState {
  let run = 0;
  let files = PROJECT;
  const outputs = new Map<string, ToolOutput>();
  for (const message of prompt) {
    if (message.role === 'user') run++;
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue;
      outputs.set(part.toolCallId, part.output);
      if (part.toolName === 'review_changes' && part.output.type === 'json' && isReviewOutput(part.output.value))
        files = applyReview(files, part.output.value);
    }
  }
  return { run, outputs, files };
}

const COMMIT = 'git commit -am "fix: keep the base letter of accented characters"';

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const code = (text: string) => `\`${text}\``;

/** What a review did beyond applying: rejected or undecided files, and what was applied in part. */
function reviewNote(review: DiffReviewToolOutput): string {
  const notes: string[] = [];
  const left = review.files.filter((f) => f.decision === 'rejected' || f.decision === 'pending').map((f) => f.path);
  const partial = review.files.filter((f) => f.decision === 'partial').map((f) => f.path);
  if (left.length > 0)
    notes.push(
      `You left out the change to ${list(left.map(code))}, so ${left.length === 1 ? 'it stays as it was' : 'they stay as they were'}.`,
    );
  if (partial.length > 0) notes.push(`You applied part of the change to ${list(partial.map(code))}.`);
  return notes.join(' ');
}

function quoteComments(review: DiffReviewToolOutput): string {
  const lines = review.comments.slice(0, 3).map((comment) => {
    const where =
      comment.startLine === undefined
        ? ''
        : comment.endLine !== undefined && comment.endLine !== comment.startLine
          ? `, lines ${comment.startLine}–${comment.endLine}`
          : `, line ${comment.startLine}`;
    return `- “${comment.text.trim().replace(/\s+/g, ' ')}” on ${code(comment.path)}${where}`;
  });
  const more = review.comments.length > 3 ? `\n- and ${review.comments.length - 3} more` : '';
  return `You commented:\n\n${lines.join('\n')}${more}\n\n`;
}

/** The end of the run, in a few lines: what the change does, the files, the commit and the push. */
function summary(state: RunState, outcome: { commit?: string; push?: ToolOutput; testsRan: boolean }): string {
  const src = state.files['src/slugify.ts'] ?? '';
  const fixed = src.includes('stripAccents(text') && src.includes('function stripAccents');
  const spells = fixed && src.includes('ß');
  const tests = runTests(state.files);
  const lines = [
    fixed
      ? `Done. ${code("slugify('Crème brûlée')")} now returns ${code('creme-brulee')}${spells ? `, and ${code("slugify('Straße')")} returns ${code('strasse')}` : ''}.`
      : 'Done, without the fix itself: you left out the change that strips the accents.',
    '',
    ...changesFrom(state.files).map(({ path }) => {
      if (path === 'src/slugify.ts')
        return `- ${code(path)}: strips accents before it splits the words${spells ? ', and spells out ß, ø and the like' : ''}`;
      if (path === 'test/slugify.test.ts')
        return `- ${code(path)}: ${tests.length} tests${outcome.testsRan ? ', all passing' : ', not run'}`;
      if (path === 'README.md') return `- ${code(path)}: an example with accents`;
      return `- ${code(path)}: changed`;
    }),
  ];
  if (outcome.commit) lines.push(`- Committed on ${code(BRANCH)} as ${code(outcome.commit)}`);
  const push = outcome.push;
  if (push?.type === 'execution-denied') {
    lines.push(
      '',
      // The reason lib/approval.ts gives a call the server's rules deny.
      push.reason?.startsWith("Denied by the server's rule")
        ? `A rule on the server blocks ${code('git push')}, so the branch stays local: push it and open the pull request when you're ready.`
        : 'You denied the push, so the branch stays local.',
    );
  } else if (push?.type === 'json') {
    lines.push('', `Pushed ${code(BRANCH)}: open the pull request when you're ready.`);
  }
  return lines.join('\n');
}

function failures(state: RunState): string {
  const failed = runTests(state.files).filter((t) => t.error);
  const total = runTests(state.files).length;
  const why = failed.some((t) => t.error?.startsWith('ReferenceError'))
    ? `${code('src/slugify.ts')} calls ${code('stripAccents')}, but the part that defines it was left out.`
    : failed.some((t) => t.name === 'strips accents')
      ? `The test for accents is in, but the fix in ${code('src/slugify.ts')} was left out.`
      : 'The part of the change these tests need was left out.';
  return (
    `${failed.length} of ${total} tests fail:\n\n` +
    failed.map((t) => `- ${t.name}: ${t.error?.split('\n')[0]}`).join('\n') +
    `\n\n${why} I won't commit a failing build. Start a new run to try again.`
  );
}

/** The next step of the run, from where it is. */
function script(state: RunState): Step {
  const id = (name: string) => `r${state.run}-${name}`;
  const output = (name: string) => state.outputs.get(id(name));
  const json = <T>(name: string) => {
    const out = output(name);
    return out?.type === 'json' ? (out.value as T) : undefined;
  };
  const final = (text: string): Step => ({ delay: 600, text });
  const run = (name: string, command: string): Call => ({ id: id(name), name: 'run_command', input: { command } });
  const total = runTests(state.files).length;

  if (!output('list'))
    return {
      delay: 700,
      reasoning:
        'The slug loses letters, so something treats è and û as separators: probably a pattern that keeps only a to z and digits. Find slugify and its tests.',
      text: `I'll look at ${code('slugify')} and its tests first.`,
      calls: [{ id: id('list'), name: 'list_files', input: {} }],
    };

  if (!output('read-src'))
    return {
      delay: 450,
      calls: [
        { id: id('read-src'), name: 'read_file', input: { path: 'src/slugify.ts' } },
        { id: id('read-test'), name: 'read_file', input: { path: 'test/slugify.test.ts' } },
      ],
    };
  if (output('read-src')?.type !== 'json')
    return final(
      `I can't fix ${code('slugify')} without reading ${code('src/slugify.ts')}. Approve the read, or keep the rule that allows ${code('read_file')}, and start a new run.`,
    );
  if (!output('review-1') && hasFix(state.files))
    return final(`${code('slugify')} strips accents already in this workspace, so there is nothing to change.`);

  if (!output('test-1'))
    return {
      delay: 600,
      text: `${code('slugify')} keeps only ${code('a')} to ${code('z')} and digits, so ${code('è')} and ${code('û')} split the words. None of the ${total} tests covers accents. I'll run them first, to see where they stand.`,
      calls: [run('test-1', 'npm test')],
    };

  if (!output('review-1')) {
    const before = json<CommandResult>('test-1');
    const opener = !before
      ? 'Understood, no tests for now. '
      : before.exitCode === 0
        ? `All ${total} pass. `
        : 'Some fail already. ';
    return {
      delay: 800,
      text:
        `${opener}Here is the fix: split each letter from its accents and drop the accents, before the words are split. With it, a test and an example in the README.\n\n` +
        `Letters with no accent to strip, such as ß and ø, still split the words: ${code("slugify('Straße')")} gives ${code('stra-e')}. Leave a comment if you want them spelled out.`,
      calls: [{ id: id('review-1'), name: 'review_changes', input: proposeFix(state.files) }],
    };
  }

  const review = json<DiffReviewToolOutput>('review-1');
  if (!review || review.accepted === 0)
    return final('Nothing was applied, so the files are as they were. Start a new run to try again.');
  const commented = review.comments.length > 0;

  if (commented && !output('review-2') && canRevise(state.files))
    return {
      delay: 750,
      text:
        quoteComments(review) +
        `${reviewNote(review)} I now spell out the letters that have no accent to strip, ß as ss, ø as o and a few more, with a test. Here is the revision.`.trim(),
      calls: [{ id: id('review-2'), name: 'review_changes', input: proposeRevision(state.files) }],
    };

  if (!output('test-2')) {
    const revision = json<DiffReviewToolOutput>('review-2');
    const text = revision
      ? revision.accepted === 0
        ? 'You kept the first version.'
        : `Applied. ${reviewNote(revision)}`
      : commented
        ? `${quoteComments(review)}That needs the fix's ${code('stripAccents')} in ${code('src/slugify.ts')}, which you left out, so there is nothing to build it on. ${reviewNote(review)}`
        : reviewNote(review) || 'Applied.';
    return { delay: 500, text: `${text.trim()} Running the tests again.`, calls: [run('test-2', 'npm test')] };
  }

  const tests = json<CommandResult>('test-2');
  if (!output('commit')) {
    if (tests && tests.exitCode !== 0) return final(failures(state));
    return {
      delay: 450,
      text: tests ? `All ${total} tests pass. Committing.` : 'No tests, then. Committing.',
      calls: [run('commit', COMMIT)],
    };
  }

  const commit = json<CommandResult>('commit');
  const committed = commit?.exitCode === 0 ? /^\[\S+ ([0-9a-f]+)\]/.exec(commit.output)?.[1] : undefined;
  if (!committed)
    return final(
      `${commit ? `The commit failed: ${commit.output.split('\n')[0]}` : 'You denied the commit.'} The changes are applied, not committed.\n\n` +
        summary(state, { testsRan: !!tests }),
    );
  if (!output('push'))
    return { delay: 400, text: 'Committed. Pushing the branch.', calls: [run('push', `git push -u origin ${BRANCH}`)] };

  return final(summary(state, { commit: committed, push: output('push'), testsRan: !!tests }));
}

/* Streaming: the step as a model streams it, word by word, with tool inputs arriving in pieces. */

interface Timed {
  part: StreamPart;
  /** Milliseconds to wait before it. */
  delay: number;
}

/** Words per delta, in turn: models stream a word or a few at a time. */
const GROUPS = [2, 1, 3, 2, 1, 2];

function deltas(text: string): Array<{ delta: string; words: number }> {
  const words = text.match(/\S+\s*|\s+/g) ?? [];
  const out: Array<{ delta: string; words: number }> = [];
  for (let i = 0, g = 0; i < words.length; g++) {
    const n = GROUPS[g % GROUPS.length]!;
    out.push({ delta: words.slice(i, i + n).join(''), words: n });
    i += n;
  }
  return out;
}

function textParts(id: string, text: string): Timed[] {
  return [
    { part: { type: 'text-start', id }, delay: 0 },
    ...deltas(text).map(({ delta, words }): Timed => ({ part: { type: 'text-delta', id, delta }, delay: 24 * words })),
    { part: { type: 'text-end', id }, delay: 0 },
  ];
}

function reasoningParts(id: string, text: string): Timed[] {
  return [
    { part: { type: 'reasoning-start', id }, delay: 0 },
    ...deltas(text).map(({ delta, words }): Timed => ({
      part: { type: 'reasoning-delta', id, delta },
      delay: 16 * words,
    })),
    { part: { type: 'reasoning-end', id }, delay: 0 },
  ];
}

function callParts({ id, name, input }: Call): Timed[] {
  const json = JSON.stringify(input);
  const size = json.length > 400 ? 64 : 14;
  const pieces: Timed[] = [];
  for (let i = 0; i < json.length; i += size)
    pieces.push({ part: { type: 'tool-input-delta', id, delta: json.slice(i, i + size) }, delay: 22 });
  return [
    { part: { type: 'tool-input-start', id, toolName: name }, delay: 120 },
    ...pieces,
    { part: { type: 'tool-input-end', id }, delay: 0 },
    { part: { type: 'tool-call', toolCallId: id, toolName: name, input: json }, delay: 0 },
  ];
}

/** Tokens, estimated at four characters each: the prompt, the part of it seen before (cached), the output. */
function usageOf(prompt: Prompt, step: Step): Usage {
  const tokens = (chars: number) => Math.ceil(chars / 4);
  const sizes = prompt.map((message) => JSON.stringify(message.content).length);
  const lastReply = prompt.findLastIndex((message) => message.role === 'assistant');
  const input = tokens(sizes.reduce((a, b) => a + b, 0));
  const cached = lastReply === -1 ? 0 : tokens(sizes.slice(0, lastReply + 1).reduce((a, b) => a + b, 0));
  const reasoning = tokens(step.reasoning?.length ?? 0);
  const text = tokens((step.text?.length ?? 0) + JSON.stringify(step.calls ?? []).length);
  return {
    inputTokens: { total: input, noCache: input - cached, cacheRead: cached, cacheWrite: undefined },
    outputTokens: { total: reasoning + text, text, reasoning },
  };
}

function toStream(parts: readonly Timed[], signal: AbortSignal | undefined): ReadableStream<StreamPart> {
  let next = 0;
  return new ReadableStream<StreamPart>({
    async pull(controller) {
      const item = parts[next++];
      if (!item || signal?.aborted) return controller.close();
      if (item.delay > 0) await pause(item.delay, signal);
      if (signal?.aborted) return controller.close();
      controller.enqueue(item.part);
    },
  });
}

/** The scripted agent, as a model for `streamText`. */
export const scriptedModel: Model = {
  specificationVersion: 'v4',
  provider: 'scripted',
  modelId: SCRIPTED_MODEL_ID,
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error('The scripted agent only streams: call it with streamText.')),
  doStream: async ({ prompt, abortSignal }) => {
    const state = readPrompt(prompt);
    const step = script(state);
    const key = `r${state.run}-s${state.outputs.size}`;
    const parts: Timed[] = [
      { part: { type: 'stream-start', warnings: [] }, delay: step.delay },
      ...(step.reasoning ? reasoningParts(`${key}-reasoning`, step.reasoning) : []),
      ...(step.text ? textParts(`${key}-text`, step.text) : []),
      ...(step.calls ?? []).flatMap(callParts),
      {
        part: {
          type: 'finish',
          usage: usageOf(prompt, step),
          finishReason: { unified: step.calls?.length ? 'tool-calls' : 'stop', raw: undefined },
        },
        delay: 0,
      },
    ];
    return { stream: toStream(parts, abortSignal) };
  },
};
