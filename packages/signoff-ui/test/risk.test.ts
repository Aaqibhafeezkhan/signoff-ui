// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonSchema, readUIMessageStream, streamText, tool, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as core from '../src/core';
import * as index from '../src/index';
import { AI_SDK_MAJOR } from './utils';

/*
 * Approval cards claim no risk nobody gave. An MCP server gives one for its tools, in their
 * annotations: riskFromMcpAnnotations reads the hints the server set, and only those, since the
 * MCP spec's defaults for missing ones (destructive, open world) would rate every tool with no
 * annotations as risky. AI SDK 7's MCP client puts a tool's annotations in its `metadata`, which
 * reaches each of its calls' parts as `toolMetadata`, where the docs read it.
 */

const { riskFromMcpAnnotations } = core;

const root = fileURLToPath(new URL('../../../', import.meta.url));
const page = readFileSync(join(root, 'examples/playground/content/components/use-approval-policy.md'), 'utf8');

/** A `###` section of the page, from its heading to the next heading. */
function section(heading: string) {
  const start = page.indexOf(`\n### ${heading}\n`);
  expect(start, `a "### ${heading}" section`).toBeGreaterThan(-1);
  const end = page.indexOf('\n### ', start + 1);
  return page.slice(start, end === -1 ? undefined : end);
}

/** The code spans of a stretch of text. */
const codes = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map(([, code]) => code!);

describe('riskFromMcpAnnotations', () => {
  it('is in signoff-ui/core, for a route, and in the main entry', () => {
    expect(core.riskFromMcpAnnotations).toBeTypeOf('function');
    expect((index as Record<string, unknown>).riskFromMcpAnnotations).toBe(core.riskFromMcpAnnotations);
  });

  it('rates a destructive tool high, a read-only one low, and one that changes things or reaches out medium', () => {
    expect(riskFromMcpAnnotations({ destructiveHint: true })).toBe('high');
    expect(riskFromMcpAnnotations({ readOnlyHint: false, destructiveHint: true })).toBe('high');
    expect(riskFromMcpAnnotations({ readOnlyHint: true })).toBe('low');
    expect(riskFromMcpAnnotations({ readOnlyHint: true, destructiveHint: false, openWorldHint: false })).toBe('low');
    expect(riskFromMcpAnnotations({ readOnlyHint: false })).toBe('medium');
    expect(riskFromMcpAnnotations({ readOnlyHint: false, destructiveHint: false })).toBe('medium');
    expect(riskFromMcpAnnotations({ openWorldHint: true })).toBe('medium');
    expect(riskFromMcpAnnotations({ readOnlyHint: false, destructiveHint: false, openWorldHint: false })).toBe(
      'medium',
    );
  });

  it('takes the first hint that applies: destructive, then read-only, then the rest', () => {
    // Hints that disagree: a risk badge errs high.
    expect(riskFromMcpAnnotations({ readOnlyHint: true, destructiveHint: true })).toBe('high');
    expect(riskFromMcpAnnotations({ destructiveHint: true, openWorldHint: true })).toBe('high');
    // A read-only tool that reads the web still changes nothing.
    expect(riskFromMcpAnnotations({ readOnlyHint: true, openWorldHint: true })).toBe('low');
  });

  it("claims no risk the server didn't give: missing hints keep no spec default", () => {
    // The spec's defaults would make each of these destructive and open world, so 'high'.
    for (const annotations of [{}, { title: 'Search' }, { idempotentHint: true }, { destructiveHint: false }]) {
      expect(riskFromMcpAnnotations(annotations), JSON.stringify(annotations)).toBeUndefined();
    }
    expect(riskFromMcpAnnotations({ openWorldHint: false })).toBeUndefined();
    expect(
      riskFromMcpAnnotations({ destructiveHint: false, openWorldHint: false, idempotentHint: true }),
    ).toBeUndefined();
  });

  it('reads only true and false: other values, and annotations that are no object, count as missing', () => {
    for (const annotations of [
      { destructiveHint: 'true' },
      { destructiveHint: 1 },
      { readOnlyHint: 'false' },
      { readOnlyHint: null },
      { openWorldHint: {} },
    ]) {
      expect(riskFromMcpAnnotations(annotations), JSON.stringify(annotations)).toBeUndefined();
    }
    for (const annotations of [undefined, null, true, 'destructive', 42, []]) {
      expect(riskFromMcpAnnotations(annotations), String(annotations)).toBeUndefined();
    }
  });
});

describe('the useApprovalPolicy page: risk from MCP annotations', () => {
  const text = section('Risk from MCP annotations');

  it('gives the levels the helper gives, row by row', () => {
    const rows = text
      .split('\n')
      .filter((line) => line.startsWith('| ') && !/^\| *-/.test(line))
      .slice(1)
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    expect(rows).toHaveLength(4);
    for (const [hints, risk] of rows) {
      const expected = risk === 'none' ? undefined : codes(risk!)[0];
      const each = codes(hints!).map((hint) => {
        const [name, value] = hint.split(': ');
        return { [name!]: value === 'true' };
      });
      // "none of these": no hint at all.
      for (const annotations of each.length ? each : [{}])
        expect(riskFromMcpAnnotations(annotations), `${hints} → ${risk}`).toBe(expected);
    }
  });

  it("says it is a hint, not a guarantee, and isn't what decides a call", () => {
    expect(text).toContain('It is a hint, not a guarantee');
    expect(text).toContain('keep it out of what decides a call');
    expect(text).toContain('Only hints the server set count: the MCP spec reads a missing');
  });
});

/** A model that calls one MCP-style tool, then answers. */
function model() {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] });
          if (calls++ === 0)
            c.enqueue({ type: 'tool-call', toolCallId: 'del', toolName: 'delete_note', input: '{"id":"n1"}' });
          else {
            c.enqueue({ type: 'text-start', id: 't' });
            c.enqueue({ type: 'text-delta', id: 't', delta: 'Done.' });
            c.enqueue({ type: 'text-end', id: 't' });
          }
          c.enqueue({
            type: 'finish',
            finishReason: { unified: calls === 1 ? 'tool-calls' : 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          });
          c.close();
        },
      }),
    }),
  });
}

// toolMetadata on tool parts and the V4 mock models are AI SDK 7.
describe.skipIf(AI_SDK_MAJOR < 7)("the page's snippet, on a run with an MCP tool", () => {
  /** The message the page gets, for a tool with the `metadata` AI SDK 7's MCP client gives it. */
  async function message() {
    const tools = {
      delete_note: tool({
        inputSchema: jsonSchema<{ id: string }>({ type: 'object' }),
        // As @ai-sdk/mcp builds it from the server's tool list.
        metadata: {
          clientName: 'notes',
          toolName: 'delete_note',
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
        execute: async () => ({ deleted: true }),
      }),
    };
    const stream = streamText({
      model: model(),
      prompt: 'Delete the note',
      tools,
      toolApproval: () => 'user-approval',
    }).toUIMessageStream({ onError: (error) => String(error) });
    let last: UIMessage | undefined;
    for await (const m of readUIMessageStream({ stream, terminateOnError: true })) last = m;
    return last!;
  }

  it("rates the call from its part's toolMetadata.annotations, as the page shows", async () => {
    const run = await message();
    const code = /```tsx\n([\s\S]*?)```/.exec(section('Risk from MCP annotations'))?.[1];
    expect(code, 'a ```tsx block').toBeDefined();
    const js = ts.transpileModule(code!, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    let given: { message?: UIMessage; tools?: Record<string, { risk?: unknown }> } | undefined;
    const AgentMessage = () => null;
    const jsx = (type: unknown, props: typeof given) => {
      if (type === AgentMessage) given = props;
      return null;
    };
    const modules: Record<string, unknown> = {
      'signoff-ui': { ...core, AgentMessage },
      'react/jsx-runtime': { jsx, jsxs: jsx },
    };
    const scope = { require: (name: string) => modules[name], exports: {}, message: run };
    // The docs' own code, run as written, with the message it leaves to the reader in scope.
    new Function(...Object.keys(scope), js)(...Object.values(scope));
    expect(given?.message).toBe(run);
    expect(given?.tools).toEqual({ delete_note: { risk: 'high' } });
  });
});
