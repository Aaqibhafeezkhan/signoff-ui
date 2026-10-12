import { parseFileChange, toPatch, type HunkDecision, type ParsedFileDiff } from 'signoff-ui/core';
import { BRANCH, REPO, type Files } from './project';
import { changesFrom } from './workspace';

/*
 * The commands the agent may run, simulated over the in-memory project: nothing is executed. The
 * test run reads the files instead of running them, so its results follow what you applied in the
 * reviews: reject the fix but keep its test, and the test fails.
 */

export interface CommandResult {
  exitCode: number;
  /** What the command printed. */
  output: string;
}

export interface TestResult {
  name: string;
  /** Why it failed; passed when absent. */
  error?: string;
}

const TEST_FILE = /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?$/;
const TEST_CALL = /\b(?:test|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

/** Every test in the project's test files, passed or failed. */
export function runTests(files: Files): TestResult[] {
  const source = Object.entries(files)
    .filter(([path]) => !TEST_FILE.test(path) && /\.[cm]?[jt]sx?$/.test(path))
    .map(([, content]) => content)
    .join('\n');
  const names = Object.entries(files)
    .filter(([path]) => TEST_FILE.test(path))
    .flatMap(([, content]) => [...content.matchAll(TEST_CALL)].map((match) => match[2]!));

  // What the source does, read from it: enough for this project's tests.
  const defined = /\b(?:function|const|let)\s+stripAccents\b/.test(source);
  const called = /\bstripAccents\(/.test(source.replace(/\bfunction\s+stripAccents\(/g, ''));
  if (called && !defined) return names.map((name) => ({ name, error: 'ReferenceError: stripAccents is not defined' }));
  const normalizes = /\.normalize\(\s*['"]NFK?D['"]\s*\)/.test(source);
  const stripsAccents = normalizes && (!defined || called);
  const spellsOut = stripsAccents && /ß/.test(source);

  const expected = (actual: string, wanted: string) =>
    `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n  '${actual}' !== '${wanted}'`;
  return names.map((name): TestResult => {
    if (name === 'strips accents' && !stripsAccents) return { name, error: expected('cr-me-br-l-e', 'creme-brulee') };
    if (name === 'spells out letters with no accent to strip' && !spellsOut)
      return { name, error: expected('stra-e', 'strasse') };
    return { name };
  });
}

function npmTest(files: Files): CommandResult {
  let pkg: { name?: string; version?: string } = {};
  try {
    pkg = JSON.parse(files['package.json'] ?? '{}') as typeof pkg;
  } catch {
    // A package.json the agent broke: the header goes without the name.
  }
  const header = `> ${pkg.name ?? 'package'}@${pkg.version ?? '0.0.0'} test\n> node --test\n`;
  const results = runTests(files);
  if (results.length === 0) return { exitCode: 1, output: `${header}\nNo tests found.` };
  const failed = results.filter((result) => result.error);
  const lines = results.map((result, i) => {
    // A steady duration per test, so a run reads the same every time.
    const ms = (0.2 + ((i * 7) % 9) / 10).toFixed(1);
    return result.error
      ? `✖ ${result.name} (${ms}ms)\n${result.error.replace(/^/gm, '  ')}`
      : `✔ ${result.name} (${ms}ms)`;
  });
  return {
    exitCode: failed.length > 0 ? 1 : 0,
    output: [
      header,
      ...lines,
      `ℹ tests ${results.length}`,
      `ℹ pass ${results.length - failed.length}`,
      `ℹ fail ${failed.length}`,
    ].join('\n'),
  };
}

/** The project's changes as the review component parses them, every hunk accepted. */
function parsedChanges(files: Files): { parsed: ParsedFileDiff[]; decisions: Record<string, HunkDecision> } {
  const parsed = changesFrom(files).map((change) => parseFileChange(change));
  const decisions: Record<string, HunkDecision> = {};
  for (const file of parsed) for (const hunk of file.hunks) decisions[hunk.id] = 'accepted';
  return { parsed, decisions };
}

/** A short, steady commit hash from the contents: the same files give the same hash. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function gitCommit(command: string, files: Files): CommandResult {
  const { parsed } = parsedChanges(files);
  if (parsed.length === 0) return { exitCode: 1, output: `On branch ${BRANCH}\nnothing to commit, working tree clean` };
  const message = /\s-[a-z]*m\s+(["'])((?:\\.|(?!\1).)*)\1/.exec(command)?.[2] ?? 'Update';
  const additions = parsed.reduce((n, file) => n + file.additions, 0);
  const deletions = parsed.reduce((n, file) => n + file.deletions, 0);
  const id = hash(message + parsed.map((file) => file.path + file.newContent).join('\n'));
  return {
    exitCode: 0,
    output:
      `[${BRANCH} ${id}] ${message}\n` +
      ` ${plural(parsed.length, 'file')} changed, ${plural(additions, 'insertion')}(+), ${plural(deletions, 'deletion')}(-)`,
  };
}

function gitStatus(files: Files): CommandResult {
  const changes = changesFrom(files);
  if (changes.length === 0)
    return { exitCode: 0, output: `On branch ${BRANCH}\nnothing to commit, working tree clean` };
  const lines = changes.map((c) => `\t${c.status === 'added' ? 'new file' : 'modified'}:   ${c.path}`);
  return { exitCode: 0, output: [`On branch ${BRANCH}`, 'Changes since main:', ...lines].join('\n') };
}

function gitDiff(files: Files): CommandResult {
  const { parsed, decisions } = parsedChanges(files);
  return { exitCode: 0, output: toPatch(parsed, decisions) };
}

function gitPush(): CommandResult {
  return {
    exitCode: 0,
    output: `To github.com:${REPO}.git\n * [new branch]      ${BRANCH} -> ${BRANCH}`,
  };
}

/** Runs a command against the project, in simulation. */
export function runCommand(command: string, files: Files): CommandResult {
  const line = command.trim();
  if (/^(?:npm (?:run )?test|node --test)(?:\s|$)/.test(line)) return npmTest(files);
  if (/^git status(?:\s|$)/.test(line)) return gitStatus(files);
  if (/^git diff(?:\s|$)/.test(line)) return gitDiff(files);
  if (/^git commit(?:\s|$)/.test(line)) return gitCommit(line, files);
  if (/^git push(?:\s|$)/.test(line)) return gitPush();
  const program = line.split(/\s+/)[0] || line;
  return {
    exitCode: 127,
    output: `${program}: not available here. This demo simulates npm test, git status, git diff, git commit and git push, and runs nothing.`,
  };
}
