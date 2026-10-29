import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as client from '@ag-ui/client';
import type { BaseEvent, RunAgentInput } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';
import { act, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as agUi from '../src/ag-ui';
import * as kit from '../src/index';

/*
 * The AG-UI page's "Render an agent" sample, run as copied: its code block compiled, its imports
 * this package's source and @ag-ui/client, against a server stubbed behind fetch. A failed run
 * shows why, rather than a bare "Error", and `send` doesn't leave its rejection unhandled; a run
 * paused on a question that isn't a tool approval reads as waiting, not done.
 */

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '../../../examples/playground/content/docs/ag-ui.md'), 'utf8');
const TITLE = 'app/agent-run.tsx';
const code = page.split(`\`\`\`tsx title="${TITLE}"\n`)[1]?.split('\n```')[0] ?? '';

/** The sample as a module, with an agent of its own. */
function load() {
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const modules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'signoff-ui': kit,
    'signoff-ui/ag-ui': agUi,
    '@ag-ui/client': client,
  };
  const module = { exports: {} as { AgentRun: ComponentType; send: (text: string) => Promise<void> } };
  const require = (id: string) => {
    if (!(id in modules)) throw new Error(`${TITLE} imports ${id}`);
    return modules[id];
  };
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports;
}

/** Answers each request with the next of these runs, as server-sent events, or fails it with the error. */
function serve(...runs: ((input: RunAgentInput) => BaseEvent[] | Error)[]) {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const run = runs.shift();
    if (!run) throw new Error('no more runs');
    const reply = run(JSON.parse(String(init.body)) as RunAgentInput);
    if (reply instanceof Error) throw reply;
    const body = reply.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function sendAndRender(text: string) {
  const { AgentRun, send } = load();
  const { container } = render(<AgentRun />);
  await act(() => send(text));
  return container.querySelector<HTMLElement>('[data-slot="signoff-agent-status"]')!;
}

describe('the AG-UI page’s sample', () => {
  it('is on the page', () => {
    expect(code).toContain('useAgUiAgent(agent)');
  });

  it('shows why a run failed, and send resolves', async () => {
    serve(({ threadId, runId }) => [
      { type: EventType.RUN_STARTED, threadId, runId },
      { type: EventType.RUN_ERROR, message: 'Model overloaded', code: 'overloaded' } as BaseEvent,
    ]);
    const status = await sendAndRender('Add zod');
    expect(status.dataset.state).toBe('error');
    expect(status).toHaveTextContent('Model overloaded');
  });

  it('shows why a request failed before the run started', async () => {
    serve(() => new TypeError('fetch failed'));
    const status = await sendAndRender('Add zod');
    expect(status.dataset.state).toBe('error');
    expect(status).toHaveTextContent('fetch failed');
  });

  it('reads a run paused on a question, not a tool approval, as waiting with the question', async () => {
    serve(({ threadId, runId }) => [
      { type: EventType.RUN_STARTED, threadId, runId },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'I can book that.' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
      {
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
        outcome: { type: 'interrupt', interrupts: [{ id: 'int1', reason: 'input_required', message: 'Which city?' }] },
      } as BaseEvent,
    ]);
    const status = await sendAndRender('Book a table');
    expect(status.dataset.state).toBe('awaiting-approval');
    expect(status).toHaveTextContent('Which city?');
  });

  it('typechecks against the installed @ag-ui/client', { timeout: 60_000 }, () => {
    const file = join(here, 'agent-run.tsx');
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
      jsx: ts.JsxEmit.ReactJSX,
      types: [],
      paths: { 'signoff-ui': [join(here, '../src/index.ts')], 'signoff-ui/ag-ui': [join(here, '../src/ag-ui.ts')] },
    };
    const host = ts.createCompilerHost(options);
    const { fileExists, readFile, getSourceFile } = host;
    host.fileExists = (name) => name === file || fileExists(name);
    host.readFile = (name) => (name === file ? code : readFile(name));
    host.getSourceFile = (name, language, ...rest) =>
      name === file ? ts.createSourceFile(name, code, language) : getSourceFile(name, language, ...rest);
    const program = ts.createProgram([file], options, host);
    const source = program.getSourceFile(file)!;
    const errors = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map(
      (diagnostic) =>
        `${TITLE}(${source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}): ` +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    );
    expect(errors).toEqual([]);
  });
});
