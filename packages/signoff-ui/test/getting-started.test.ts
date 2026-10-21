// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { AI_SDK_MAJOR, headingId, section } from './utils';

/*
 * Getting started and Inside your chat UI, read the way a newcomer reads them: the page opens on a
 * start that needs no API key, says why a run failed and what an approval protects, and the
 * snippets people copy as whole files typecheck, typed messages included. The walkthrough's three
 * files are checked against examples/nextjs-minimal in readme.test.ts.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const docs = join(root, 'examples/playground/content/docs');
const guide = readFileSync(join(docs, 'getting-started.md'), 'utf8');
const chatUi = readFileSync(join(docs, 'chat-ui.md'), 'utf8');

/** `##` or `###` headings outside code blocks, with the id the site gives each (lib/docs.ts). */
function headings(markdown: string) {
  const found: Array<{ depth: number; text: string; id: string }> = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const match = fenced ? null : /^(##|###) (.+)$/.exec(line);
    if (!match) continue;
    const text = match[2]!.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    found.push({ depth: match[1]!.length, text, id: headingId(text) });
  }
  return found;
}

/** The code of the block titled `title`, such as ```tsx title="app/page.tsx". */
function block(markdown: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\`\`\`tsx? title="${escaped}"\\n([\\s\\S]*?)\`\`\``).exec(markdown)?.[1] ?? '';
}

/*
 * Snippets as files of an app, in memory, in a folder of the playground, which installs every
 * package they import. `signoff-ui` resolves to the built package (`pnpm build:lib`), as from npm.
 */
const app = join(root, 'examples/playground/.getting-started-snippets');
const built = existsSync(join(root, 'packages/signoff-ui/dist/index.d.ts'));

/** TypeScript errors in the files, with create-next-app's compiler options and its `@/*` alias, or `overrides`. */
function typeErrors(files: Record<string, string>, overrides: ts.CompilerOptions = {}) {
  for (const [path, code] of Object.entries(files)) if (!code.trim()) throw new Error(`${path}: no such block`);
  const sources = new Map(Object.entries(files).map(([path, code]) => [join(app, path), code]));
  // TypeScript looks for a file only in a folder that exists: the in-memory files' folders do.
  const folders = new Set<string>();
  for (let folder of [...sources.keys()].map(dirname))
    for (; folder.startsWith(app); folder = dirname(folder)) folders.add(folder);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2017,
    lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.d.ts'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: ts.JsxEmit.ReactJSX,
    types: [],
    paths: { '@/*': [`${app}/*`] },
    ...overrides,
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, directoryExists, getSourceFile } = host;
  host.fileExists = (file) => sources.has(file) || fileExists(file);
  host.readFile = (file) => sources.get(file) ?? readFile(file);
  host.directoryExists = (dir) => folders.has(dir) || (directoryExists?.(dir) ?? true);
  host.getSourceFile = (file, language, ...rest) => {
    const code = sources.get(file);
    return code === undefined ? getSourceFile(file, language, ...rest) : ts.createSourceFile(file, code, language);
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where = diagnostic.file
      ? `${diagnostic.file.fileName.slice(app.length + 1)}(${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}): `
      : '';
    return where + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  });
}

/**
 * The compiler options of Vite's react-ts template (create-vite 9.3.1, tsconfig.app.json), which its
 * build script checks with `tsc -b` before `vite build`. TypeScript 6 makes `strict` the default.
 */
const viteOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  allowArbitraryExtensions: true,
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  moduleDetection: ts.ModuleDetectionKind.Force,
  noUnusedLocals: true,
  noUnusedParameters: true,
  erasableSyntaxOnly: true,
  noFallthroughCasesInSwitch: true,
};

const typecheck = it.skipIf(!built || AI_SDK_MAJOR < 7);

describe('Getting started: the first section', () => {
  const first = headings(guide)[0];
  const start = section(guide, first?.text ?? '');
  /** Each `create-next-app --example` command: the example it starts from, and the port it opens on. */
  const commands = [
    ...start.matchAll(
      /npx create-next-app@latest (\S+) --example https:\/\/github\.com\/dgesteves\/signoff-ui\/tree\/main\/(examples\/[\w-]+)\ncd \1\nnpm run dev +# http:\/\/localhost:(\d+)\n/g,
    ),
  ].map(([, , example, port]) => ({ example: example!, port: port! }));

  it('is the start that needs no API key, before the requirements and the install', () => {
    expect(first?.depth).toBe(2);
    expect(first?.text).toMatch(/(without an|no) API key/i);
    expect(guide.indexOf(start)).toBeLessThan(guide.indexOf('\n## Requirements\n'));
  });

  it('starts the reference app and the walkthrough as an app, each in one command', () => {
    expect(commands.map((command) => command.example)).toEqual(['examples/coding-agent', 'examples/nextjs-minimal']);
  });

  it.each(commands)('$example: opens on the port its dev script uses', ({ example, port }) => {
    const pkg = JSON.parse(readFileSync(join(root, example, 'package.json'), 'utf8')) as {
      scripts: { dev: string };
    };
    expect(pkg.scripts.dev).toMatch(new RegExp(`--port ${port}\\b`));
  });
});

describe('Getting started: your first sign-off', () => {
  const code = block(guide, 'app/first-sign-off.tsx');

  it('comes before the walkthrough, and needs no AI SDK, model or key', () => {
    expect(code).not.toBe('');
    expect(guide.indexOf(code)).toBeLessThan(guide.indexOf('\n## Render a run\n'));
    expect(code).not.toMatch(/from '(ai|@ai-sdk\/[\w-]+)'/);
  });

  typecheck('typechecks as copied', { timeout: 60_000 }, () => {
    expect(typeErrors({ 'app/first-sign-off.tsx': code })).toEqual([]);
  });
});

describe('Getting started: Render a run', () => {
  const walkthrough = section(guide, 'Render a run');

  it('says why a run failed: the route passes the error on, and the page shows it', () => {
    const failed = section(walkthrough, 'When a run fails', 3);
    expect(failed).toContain('OPENAI_API_KEY');
    expect(failed).toContain('{error && <p role="alert">{error.message}</p>}');
    // Without onError, the message the page shows is "An error occurred." whatever failed.
    expect(block(walkthrough, 'app/api/chat/route.ts')).toContain(
      "onError: (error) => (error instanceof Error ? error.message : 'An error occurred.')",
    );
  });

  it('says what an approval protects, and what to do before a tool has real effects', () => {
    const approval = section(walkthrough, 'What an approval is', 3);
    expect(approval).toMatch(/doesn't protect your server/);
    for (const term of ['sandbox', 'validateUIMessages', 'toolApproval', 'experimental_toolApprovalSecret'])
      expect(approval).toContain(term);
  });
});

describe('Getting started: typed messages', () => {
  const typed = section(section(guide, 'Render a run'), 'Typed messages', 3);
  const tools = block(typed, 'lib/tools.ts');
  /** The walkthrough's client, with its messages typed from the tools. */
  const ownType = 'type Message = UIMessage<{ usage?: LanguageModelUsage }>;';
  const client = block(guide, 'app/agent-run.tsx').replace(ownType, "import type { Message } from '@/lib/tools';");
  const outputSchema = /^ *outputSchema: z\.custom<DiffReviewToolOutput>\(\),\n/m;

  it("gives review_changes an outputSchema, and the client the tools' message type", () => {
    expect(tools).toMatch(outputSchema);
    expect(tools).toContain('InferUITools<typeof tools>');
    expect(typed).toContain("import type { Message } from '@/lib/tools';");
    expect(block(guide, 'app/agent-run.tsx')).toContain(ownType);
  });

  typecheck("typechecks with the walkthrough's client typed from the tools", { timeout: 60_000 }, () => {
    expect(typeErrors({ 'lib/tools.ts': tools, 'app/agent-run.tsx': client })).toEqual([]);
  });

  typecheck("needs the outputSchema: without it, reviewToolOutput's result is rejected", { timeout: 60_000 }, () => {
    const errors = typeErrors({ 'lib/tools.ts': tools.replace(outputSchema, ''), 'app/agent-run.tsx': client });
    expect(errors.join('\n')).toContain("Type 'DiffReviewToolOutput' is not assignable to type 'undefined'.");
  });

  it('is where Inside your chat UI sends typed apps', () => {
    expect(chatUi).toContain('outputSchema');
    expect(chatUi).toContain('(/docs/getting-started#typed-messages)');
  });
});

describe('Getting started: Vite and other bundlers', () => {
  const vite = section(guide, 'Vite and other bundlers');
  /** The snippet that points useChat at your server: its imports, and the call. */
  const snippet = /```tsx\n([\s\S]*?)```/.exec(vite)?.[1] ?? '';
  const imports = snippet
    .split('\n')
    .filter((line) => line.startsWith('import '))
    .join('\n');
  const call = /^const \{[\s\S]*?^\}\);$/m.exec(snippet)?.[0] ?? '';
  /** The walkthrough's client, and its useChat call, which the snippet's takes the place of. */
  const client = block(guide, 'app/agent-run.tsx');
  const clientCall = /^ {2}const \{[^}]*\} = useChat<Message>\(\{\n[\s\S]*?^ {2}\}\);$/m;
  /** The walkthrough's client with `useChat` called as the snippet calls it, as a Vite app's file. */
  const viteClient = (useChat: string) => ({
    'src/agent-run.tsx': client
      .replace(/^import /m, (first) => `${imports}\n${first}`)
      .replace(clientCall, () => useChat.replace(/^(?=.)/gm, '  ')),
  });

  it("is the walkthrough's useChat, typed the same, with a transport added", () => {
    expect(client).toMatch(clientCall);
    expect(imports).toBe("import { DefaultChatTransport } from 'ai';");
    expect(call).toContain('} = useChat<Message>({');
    expect(call).toMatch(/^ {2}transport: new DefaultChatTransport\(/m);
  });

  typecheck("typechecks in the walkthrough's client with Vite's react-ts options", { timeout: 60_000 }, () => {
    expect(typeErrors(viteClient(call), viteOptions)).toEqual([]);
  });

  typecheck("needs the type argument: without it, RunMeter's usage is rejected", { timeout: 60_000 }, () => {
    const errors = typeErrors(viteClient(call.replace('useChat<Message>(', 'useChat(')), viteOptions);
    expect(errors.join('\n')).toContain("Property 'usage' does not exist on type '{}'.");
  });
});

describe('Getting started: linting the copied files', () => {
  const linting = section(section(guide, 'Install'), 'Linting the copied files', 3);

  it("says the files pass a new Next.js app's ESLint config, and how to keep a design-system check off them", () => {
    expect(linting).toContain("a new Next.js app's ESLint config");
    expect(linting).toContain('components/signoff-ui');
    expect(linting).toContain('(https://onsystem.vercel.app/docs/configuration#code-from-shadcn-registries)');
  });
});

describe('Inside your chat UI', () => {
  typecheck('message-parts.tsx typechecks as copied', { timeout: 60_000 }, () => {
    expect(typeErrors({ 'components/message-parts.tsx': block(chatUi, 'components/message-parts.tsx') })).toEqual([]);
  });
});

describe('links between the two pages', () => {
  const pages: Record<string, string> = { 'getting-started': guide, 'chat-ui': chatUi };

  // /llms-full.txt and the page-as-Markdown make only links that start with `/` absolute (lib/docs.ts),
  // and the site's smoke check fails on any relative link left in them.
  it.each(Object.entries(pages))(
    '%s: links to its own headings as /docs/<page>#id, never a bare #id',
    (page, markdown) => {
      const bare = [...markdown.matchAll(/\]\(#[^)]*\)/g)].map(([link]) => link);
      expect(bare, `write these as ](/docs/${page}#id)`).toEqual([]);
    },
  );

  it.each(Object.entries(pages))('%s: each link to a heading of either page finds it', (_page, markdown) => {
    const links = [...markdown.matchAll(/\]\(\/docs\/(getting-started|chat-ui)#([\w-]+)\)/g)].map(([, target, id]) => ({
      page: target!,
      id: id!,
    }));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links)
      expect(
        headings(pages[link.page]!).map((heading) => heading.id),
        `${link.page}#${link.id}`,
      ).toContain(link.id);
  });
});
