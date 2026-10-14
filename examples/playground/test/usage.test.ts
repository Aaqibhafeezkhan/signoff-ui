/*
 * A component page's imports and usage, copied into an app as they are, typecheck: with the npm
 * package, and with the files the shadcn CLI copies. Needs the library built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { COMPONENTS } from '../lib/components';

const SITE = join(import.meta.dirname, '..');
/** Where the shadcn CLI's copies come from. */
const KIT_SRC = join(SITE, '../../packages/signoff-ui/src');

const config = ts.getParsedCommandLineOfConfigFile(
  join(SITE, 'tsconfig.json'),
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  },
);
if (!config) throw new Error('tsconfig.json did not parse');

/**
 * The type errors in one file of an app, as `tsc` reports them. The file sits in the site, so
 * `signoff-ui`, `react` and `@ai-sdk/react` resolve as they do in an app that installed them;
 * `@/components/signoff-ui/*` resolves to the library's source, as the shadcn CLI copies it.
 */
function typeErrors(code: string) {
  const fileName = join(SITE, 'copied-usage.tsx');
  const options: ts.CompilerOptions = {
    ...config!.options,
    noEmit: true,
    incremental: false,
    paths: { '@/components/signoff-ui/*': [`${KIT_SRC}/*`] },
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (name, language, ...rest) =>
    name === fileName ? ts.createSourceFile(name, code, language, true) : getSourceFile(name, language, ...rest);
  host.fileExists = (name) => name === fileName || fileExists(name);
  host.readFile = (name) => (name === fileName ? code : readFile(name));
  const program = ts.createProgram([fileName], options, host);
  const file = program.getSourceFile(fileName)!;
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].map((d) => {
    const line = d.start === undefined ? 0 : file.getLineAndCharacterOfPosition(d.start).line + 1;
    return `${line}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
}

describe('the ApprovalCard page', () => {
  const page = COMPONENTS.find((c) => c.slug === 'approval-card')!;

  it('runs as copied from npm: its imports, then its usage', () => {
    assert.deepEqual(typeErrors(`${page.imports.npm}\n${page.usage}\n`), []);
  });

  it('runs as copied from the shadcn registry', () => {
    assert.deepEqual(typeErrors(`${page.imports.shadcn}\n${page.usage}\n`), []);
  });

  it('keeps the standalone card’s outcome, so a decision shows on the card', () => {
    // ApprovalCard is controlled for its outcome: without `status` it stays pending, and every
    // button after the first press does nothing.
    const standalone = page.usage.slice(page.usage.indexOf('<ApprovalCard'));
    assert.match(standalone, /\bstatus=\{/);
    assert.match(standalone, /\bdecision=\{choice\?\.decision\}/);
    assert.match(standalone, /\bonDecide=\{setChoice\}/);
  });
});
