import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LanguageModel } from 'ai';
import { version } from 'react';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_SDK_MAJOR, headingId } from './utils';

/*
 * examples/nextjs-minimal, the walkthrough in Getting started as an app (readme.test.ts checks the
 * two are the same files): it opens on the command that starts it with no API key, the page says
 * why a run failed, the route says at `messages` what an approval is, and messages typed from the
 * route's tools (InferUITools) accept the review's result. CI builds the example and runs it in
 * Chrome (scripts/smoke-nextjs-minimal.mjs); these run with the library's tests.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const example = join(root, 'examples/nextjs-minimal');
const read = (path: string) => readFileSync(join(example, path), 'utf8');
const guide = readFileSync(join(root, 'examples/playground/content/docs/getting-started.md'), 'utf8');

// The example's `signoff-ui` is the built package, and its React and AI SDK 7 must be the suite's.
const built = existsSync(join(root, 'packages/signoff-ui/dist/index.d.ts'));
const sameStack = built && AI_SDK_MAJOR >= 7 && Number(version.split('.')[0]) >= 19;

describe('the examples: their READMEs', () => {
  it.each(['nextjs-minimal', 'coding-agent'])('%s: opens on the command that starts it, with no API key', (name) => {
    const readme = readFileSync(join(root, 'examples', name, 'README.md'), 'utf8');
    const first = /```bash\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    const dev = (
      JSON.parse(readFileSync(join(root, 'examples', name, 'package.json'), 'utf8')) as { scripts: { dev: string } }
    ).scripts.dev;
    const devPort = /--port (\d+)/.exec(dev)?.[1] ?? '';
    expect(first).toMatch(
      new RegExp(
        `^npx create-next-app@latest (\\S+) --example https://github\\.com/dgesteves/signoff-ui/tree/main/examples/${name}\\ncd \\1\\nnpm run dev +# http://localhost:${devPort}\\n$`,
      ),
    );
    expect(readme).toMatch(/no API key/);
  });
});

describe('examples/nextjs-minimal: the route', () => {
  it('says at `messages` what an approval is, with a link to the section in Getting started', () => {
    const route = read('app/api/chat/route.ts');
    const lines = route.split('\n');
    const at = lines.findIndex((line) => line.includes('const { messages }'));
    expect(at).toBeGreaterThan(0);
    // The comment right above the line that takes the messages from the request.
    const comment: string[] = [];
    for (let i = at - 1; i >= 0 && /^\s*\/\//.test(lines[i]!); i--) comment.unshift(lines[i]!);
    const link = /https:\/\/signoff-ui\.vercel\.app\/docs\/getting-started#([\w-]+)/.exec(comment.join('\n'));
    expect(link?.[1]).toBe('what-an-approval-is');
    const ids = [...guide.matchAll(/^###? (.+)$/gm)].map(([, text]) => headingId(text!));
    expect(ids).toContain(link?.[1]);
  });
});

describe('examples/nextjs-minimal: typed messages', () => {
  /*
   * The example's route and client, in memory, with the client's messages typed from the route's
   * tools, as AI SDK recommends: `UIMessage<…, InferUITools<typeof tools>>`. Each tool's output type
   * comes from its outputSchema, so the client's addToolOutput takes reviewToolOutput's result only
   * when review_changes has one.
   */
  function typeErrors() {
    const route = read('app/api/chat/route.ts');
    const client = read('app/agent-run.tsx');
    const ownType = 'type Message = UIMessage<{ usage?: LanguageModelUsage }>;';
    expect(route).toContain('\nconst tools = {\n');
    expect(client).toContain(ownType);
    const sources = new Map([
      [
        join(example, 'app/api/chat/route.ts'),
        "import type { InferUITools, UIDataTypes } from 'ai';\n" +
          route.replace('\nconst tools = {\n', '\nexport const tools = {\n') +
          '\nexport type TypedMessage = UIMessage<{ usage?: LanguageModelUsage }, UIDataTypes, InferUITools<typeof tools>>;\n',
      ],
      [
        join(example, 'app/agent-run.tsx'),
        client.replace(ownType, "type Message = import('./api/chat/route').TypedMessage;"),
      ],
    ]);
    // The example's own compiler options, its `@/*` alias included.
    const config = ts.readConfigFile(join(example, 'tsconfig.json'), ts.sys.readFile).config as object;
    const { options } = ts.parseJsonConfigFileContent(config, ts.sys, example);
    delete options.incremental;
    delete options.plugins;
    const host = ts.createCompilerHost(options);
    const { fileExists, readFile, getSourceFile } = host;
    host.fileExists = (file) => sources.has(file) || fileExists(file);
    host.readFile = (file) => sources.get(file) ?? readFile(file);
    host.getSourceFile = (file, language, ...rest) => {
      const code = sources.get(file);
      return code === undefined ? getSourceFile(file, language, ...rest) : ts.createSourceFile(file, code, language);
    };
    const program = ts.createProgram([...sources.keys()], options, host);
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const where = diagnostic.file
        ? `${diagnostic.file.fileName.slice(example.length + 1)}(${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}): `
        : '';
      return where + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    });
  }

  it.skipIf(!built || AI_SDK_MAJOR < 7)(
    "accept reviewToolOutput's result: review_changes has an outputSchema",
    { timeout: 60_000 },
    () => {
      expect(typeErrors()).toEqual([]);
    },
  );
});

describe('examples/nextjs-minimal: a run that fails', () => {
  // The route's onError. The default sends "An error occurred." whatever failed.
  const onError = (error: unknown) => (error instanceof Error ? error.message : 'An error occurred.');

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('the route passes the error on', () => {
    expect(read('app/api/chat/route.ts')).toContain(
      "onError: (error) => (error instanceof Error ? error.message : 'An error occurred.'),",
    );
  });

  it.skipIf(!sameStack)(
    'the page says why, a missing API key included, in an alert under the status',
    { timeout: 30_000 },
    async () => {
      vi.stubEnv('OPENAI_API_KEY', undefined);
      // The AI SDK logs the error on the server too.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { streamText } = await import('ai');
      // The walkthrough's provider, which the playground installs (readme.test.ts relies on it too).
      const openai = createRequire(join(root, 'examples/playground/package.json')).resolve('@ai-sdk/openai');
      const { createOpenAI } = (await import(openai)) as {
        createOpenAI: (settings: { fetch: typeof fetch }) => (modelId: string) => LanguageModel;
      };
      // What the walkthrough's route answers with no key: openai('gpt-5.4-mini') fails before it makes a
      // request (this fetch would fail the test), and onError passes the message on.
      const model = createOpenAI({ fetch: () => Promise.reject(new Error('The test makes no requests.')) })(
        'gpt-5.4-mini',
      );
      vi.stubGlobal('fetch', () =>
        streamText({ model, prompt: 'Add rate limiting' }).toUIMessageStreamResponse({ onError }),
      );
      const { AgentRun } = await import('../../../examples/nextjs-minimal/app/agent-run');
      const user = userEvent.setup();
      render(<AgentRun />);

      await user.type(screen.getByRole('textbox', { name: 'Message the agent' }), 'Add rate limiting');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      // AgentStatus's own live regions are alerts too, so look for the message.
      const reason = await screen.findByText(
        "OpenAI API key is missing. Pass it using the 'apiKey' parameter or the OPENAI_API_KEY environment variable.",
        {},
        { timeout: 5_000 },
      );
      expect(reason).toHaveAttribute('role', 'alert');
      expect(document.querySelector('[data-slot="signoff-agent-status"]')).toHaveAttribute('data-state', 'error');
    },
  );
});
