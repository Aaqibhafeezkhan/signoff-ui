// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ai from 'ai';
import { describe, expect, it } from 'vitest';

/*
 * "Works with", in the README and in Getting started: what CI tests kept apart from what should
 * work but isn't tested, and each tested entry tied to the CI job that runs it on every pull
 * request, so a claim can't outlive the job behind it. An entry moves to the tested column with a
 * job here. Then the Vite section, against examples/assistant-ui, the Vite app CI runs, and the
 * browsers line, against the browsers CI runs.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const readme = read('README.md');
const guide = read('examples/playground/content/docs/getting-started.md');
const intro = read('examples/playground/content/docs/introduction.md');
const ci = read('.github/workflows/ci.yml');

/** A `## ` section, from its heading to the next one. */
function section(markdown: string, heading: string) {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

/** The id the docs site gives a heading (lib/docs.ts), for headings of plain text. */
const headingId = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/** The matrix in a "Works with" section: its header, and each row's tested and untested entries. */
function matrix(markdown: string) {
  const lines = section(markdown, 'Works with')
    .split('\n')
    .filter((line) => line.startsWith('|'));
  const cells = (line: string) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
  const [header = [], , ...rows] = lines.map(cells);
  const entries = (cell = '') => (cell ? cell.split(', ') : []);
  return {
    header,
    rows: rows.map(([name = '', tested, untested]) => ({
      name,
      tested: entries(tested),
      untested: entries(untested),
    })),
  };
}

/** ci.yml's jobs by name, each with its text. */
const jobs = new Map(
  ci
    .slice(ci.indexOf('\njobs:\n'))
    .split(/\n {2}(?=[\w-]+:\n)/)
    .slice(1)
    .map((job) => [/^ {4}name: (.+)$/m.exec(job)?.[1] ?? '', job]),
);
const json = (path: string) =>
  JSON.parse(read(path)) as {
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: Record<string, string>;
  };
const dependency = (example: string, name: string) => {
  const pkg = json(`examples/${example}/package.json`);
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? '';
};

const MAIN = 'Lint, typecheck, test, build';
const NEXTJS = 'Next.js quickstart';
const CODING_AGENT = 'Coding agent reference app';
const ASSISTANT_UI = 'assistant-ui binding';

/*
 * Each entry the tested column names, as `row: entry`: the job that tests it, what that job runs,
 * and what else makes it that entry. The AI SDK 6 and React 18 jobs install their versions into
 * packages/signoff-ui while this suite runs, so the AI SDK 7 and React 19 entries read the
 * examples' versions, which the other jobs build.
 */
const TESTED: Record<string, { jobs: string[]; runs: string[]; also?: () => void }> = {
  'AI SDK: 6': { jobs: ['AI SDK 6'], runs: ['for version in ^6 6.0.0', 'pnpm test'] },
  'AI SDK: 7': {
    jobs: [NEXTJS, CODING_AGENT],
    runs: ['pnpm smoke:nextjs', 'pnpm smoke:coding-agent'],
    also: () => {
      expect(dependency('nextjs-minimal', 'ai')).toMatch(/^\^7\./);
      expect(dependency('coding-agent', 'ai')).toMatch(/^\^7\./);
    },
  },
  'React: 18': { jobs: ['React 18'], runs: ['react@^18.2.0', 'pnpm test'] },
  'React: 19': {
    jobs: [MAIN, NEXTJS],
    runs: ['pnpm build:playground', 'pnpm smoke:nextjs'],
    also: () => {
      expect(dependency('playground', 'react')).toMatch(/^\^19\./);
      expect(dependency('nextjs-minimal', 'react')).toMatch(/^\^19\./);
    },
  },
  'Node: 24': {
    jobs: [MAIN],
    runs: ['node-version-file: .nvmrc'],
    also: () => {
      expect(read('.nvmrc').trim()).toBe('24');
      for (const [name, job] of jobs) expect(job, name).toContain('node-version-file: .nvmrc');
    },
  },
  'Framework: Next.js 16 App Router': {
    jobs: [NEXTJS, CODING_AGENT],
    runs: ['pnpm --filter nextjs-minimal build', 'pnpm smoke:coding-agent'],
    also: () => {
      expect(dependency('nextjs-minimal', 'next')).toMatch(/^\^16\./);
      expect(existsSync(join(root, 'examples/nextjs-minimal/app/page.tsx'))).toBe(true);
    },
  },
  'Framework: Vite': {
    jobs: [ASSISTANT_UI],
    runs: ['pnpm smoke:assistant-ui'],
    also: () => {
      expect(json('examples/assistant-ui/package.json').scripts.build).toBe('vite build');
      expect(read('scripts/smoke-assistant-ui.mjs')).toContain("[vite, 'build'");
    },
  },
  'Chat UI: Your own': { jobs: [NEXTJS], runs: ['pnpm smoke:nextjs'] },
  'Chat UI: assistant-ui': {
    jobs: [ASSISTANT_UI],
    runs: ['pnpm smoke:assistant-ui'],
    also: () => expect(dependency('assistant-ui', '@assistant-ui/react')).not.toBe(''),
  },
  'Agent: AI SDK': { jobs: [NEXTJS, CODING_AGENT], runs: ['pnpm smoke:nextjs', 'pnpm smoke:coding-agent'] },
  'Agent: AG-UI': {
    jobs: [MAIN],
    runs: ['pnpm test:coverage'],
    also: () => expect(read('packages/signoff-ui/test/ag-ui.test.tsx')).toContain("from '@ag-ui/client'"),
  },
  'Agent: ACP': {
    jobs: [MAIN],
    runs: ['pnpm test:coverage'],
    also: () => expect(existsSync(join(root, 'packages/signoff-ui/test/acp.test.tsx'))).toBe(true),
  },
  'Styles: Tailwind v4': {
    jobs: [MAIN],
    runs: ['pnpm smoke:styles', 'pnpm build:playground'],
    also: () => expect(dependency('playground', 'tailwindcss')).toMatch(/^\^4\./),
  },
  'Styles: Tailwind v3': { jobs: [MAIN], runs: ['pnpm smoke:styles'] },
  'Styles: no Tailwind': {
    jobs: [MAIN, CODING_AGENT],
    runs: ['pnpm smoke:styles', 'pnpm smoke:coding-agent'],
    also: () => expect(dependency('coding-agent', 'tailwindcss')).toBe(''),
  },
  'Browser: Chrome': { jobs: [MAIN], runs: ['pnpm smoke:playground', 'pnpm a11y'] },
  'Browser: Firefox': { jobs: ['Firefox'], runs: ['BROWSER: firefox', 'pnpm smoke:playground', 'pnpm smoke:nextjs'] },
  "Browser: WebKit (Safari's engine)": {
    jobs: ["WebKit (Safari's engine)"],
    runs: ['BROWSER: webkit', 'pnpm smoke:playground', 'pnpm smoke:nextjs', 'runs-on: macos-'],
  },
};

/** The frameworks that stream AI SDK messages, which nothing in CI runs yet. */
const UNTESTED_AGENTS = ['`@mastra/ai-sdk`', 'Cloudflare Agents', 'Vercel Eve'];

describe('Works with', () => {
  const guideMatrix = matrix(guide);

  it('is a matrix in Getting started of what CI tests and what should work but is not tested', () => {
    expect(guideMatrix.header).toEqual(['Stack', 'Tested in CI', 'Should work, not tested in CI']);
    expect(guideMatrix.rows.map((row) => row.name)).toEqual([
      'AI SDK',
      'React',
      'Node',
      'Framework',
      'Chat UI',
      'Agent',
      'AG-UI framework',
      'Styles',
      'Browser',
    ]);
  });

  it('is the same matrix in the README', () => {
    expect(matrix(readme)).toEqual(guideMatrix);
  });

  it('ties each tested entry to a CI job that runs it on every pull request', () => {
    const tested = guideMatrix.rows.flatMap((row) => row.tested.map((entry) => `${row.name}: ${entry}`));
    expect([...tested].sort()).toEqual(Object.keys(TESTED).sort());
    for (const [entry, { jobs: names, runs, also }] of Object.entries(TESTED)) {
      for (const name of names) {
        const job = jobs.get(name);
        expect(job, `${entry}: no CI job "${name}"`).toBeDefined();
        expect(job, `${entry}: "${name}" doesn't run on pull requests`).toContain(
          "if: github.event_name != 'schedule'",
        );
      }
      for (const step of runs)
        expect(
          names.some((name) => jobs.get(name)?.includes(step)),
          `${entry}: ${names.join(', ')} run no "${step}"`,
        ).toBe(true);
      also?.();
    }
  });

  it('says in Getting started what each of those jobs runs, by the name the checks list shows', () => {
    const details = section(guide, 'Works with');
    for (const name of new Set(Object.values(TESTED).flatMap((entry) => entry.jobs)))
      expect(details, name).toContain(`**${name}**`);
  });

  it('keeps the frameworks that stream AI SDK messages untested, with how each connects', () => {
    const agent = guideMatrix.rows.find((row) => row.name === 'Agent');
    const untested = agent?.untested.join(', ') ?? '';
    const tested = guideMatrix.rows.flatMap((row) => row.tested).join(', ');
    for (const name of UNTESTED_AGENTS) {
      expect(untested, name).toContain(name);
      expect(tested, name).not.toContain(name.replaceAll('`', ''));
    }
    const details = section(guide, 'Works with');
    // Mastra serves the agent as AI SDK UI messages; Cloudflare's hook returns useChat's; Eve answers
    // approvals through respond(), not addToolApprovalResponse, so it needs a bridge.
    for (const term of [
      '`chatRoute()`',
      '`useAgentChat`',
      '`addToolApprovalResponse`',
      '`useEveAgent`',
      '`reducer: defaultMessageReducer()`',
      '`respond()`',
    ])
      expect(details, term).toContain(term);
  });

  it('gives the Node versions the package declares and CI does not run as untested', () => {
    const node = guideMatrix.rows.find((row) => row.name === 'Node');
    expect(json('packages/signoff-ui/package.json').engines?.node).toBe('^20.19.0 || >=22.12.0');
    expect(node?.untested).toEqual(['20 from 20.19', '22 from 22.12']);
  });

  it('is where the introduction sends frameworks that stream AI SDK messages', () => {
    const paragraph = intro.split('\n\n').find((part) => part.includes('Cloudflare Agents')) ?? '';
    for (const name of UNTESTED_AGENTS) expect(paragraph, name).toContain(name);
    expect(paragraph).toContain(`(/docs/getting-started#${headingId('Works with')})`);
    expect(paragraph).toMatch(/not tested/);
  });
});

describe('Vite and other bundlers', () => {
  const vite = section(guide, 'Vite and other bundlers');
  const example = 'https://github.com/dgesteves/signoff-ui/tree/main/examples/assistant-ui';

  it('is a section of Getting started, linked from the README, its Works with badges and the requirements', () => {
    expect(vite).not.toBe('');
    const id = headingId('Vite and other bundlers');
    const link = `https://signoff-ui.vercel.app/docs/getting-started#${id}`;
    expect(readme).toMatch(new RegExp(`\\[!\\[Vite\\]\\([^)]+\\)\\]\\(${link.replace(/[.?]/g, '\\$&')}\\)`));
    expect(section(readme, 'Quickstart')).toContain(`(${link})`);
    expect(section(guide, 'Requirements')).toContain(`(/docs/getting-started#${id})`);
  });

  it('puts the styles in the entry file, as examples/assistant-ui does, or after Tailwind v4 with its Vite plugin', () => {
    expect(vite).toContain('```ts title="src/main.tsx"');
    expect(vite).toContain("import 'signoff-ui/styles.css';");
    expect(read('examples/assistant-ui/src/main.tsx')).toContain("import 'signoff-ui/styles.css';");
    expect(vite).toContain('`@tailwindcss/vite`');
    expect(vite).toContain("@import 'tailwindcss';\n@import 'signoff-ui/tailwind.css';");
  });

  it("points useChat at your server with DefaultChatTransport, which ai exports, and drops Next.js' Suspense", () => {
    expect(vite).toContain("import { DefaultChatTransport } from 'ai';");
    expect(vite).toMatch(/transport: new DefaultChatTransport\(\{ api: '[^']+' \}\)/);
    expect(typeof ai.DefaultChatTransport).toBe('function');
    expect(vite).toContain('`<Suspense>`');
  });

  it('links examples/assistant-ui as the Vite app CI builds and runs', () => {
    expect(vite).toContain(`(${example})`);
    expect(json('examples/assistant-ui/package.json').scripts.dev).toMatch(/^vite /);
    expect(jobs.get(ASSISTANT_UI)).toContain('pnpm smoke:assistant-ui');
  });
});

describe('Requirements: browsers', () => {
  const browsers =
    section(guide, 'Requirements')
      .split('\n')
      .find((line) => line.startsWith('- **Browsers.**')) ?? '';

  it("gives Tailwind CSS v4's floor, which builds the kit's stylesheet", () => {
    expect(json('packages/signoff-ui/package.json').devDependencies?.tailwindcss).toMatch(/^\^4\./);
    for (const version of ['Chrome and Edge 111', 'Safari 16.4', 'Firefox 128']) expect(browsers).toContain(version);
    expect(browsers).toContain('(https://tailwindcss.com/docs/compatibility)');
  });

  it('names the browsers CI runs, each a job', () => {
    expect(browsers).toContain("Chrome, Firefox and WebKit (Safari's engine)");
    expect(jobs.get('Firefox')).toContain('BROWSER: firefox');
    expect(jobs.get("WebKit (Safari's engine)")).toContain('BROWSER: webkit');
  });
});
