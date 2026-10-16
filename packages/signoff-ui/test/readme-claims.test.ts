// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * What the README tells someone deciding whether to use the kit, against what ships: one pitch on
 * the README, npm and the site's meta description, a start that needs no API key before
 * one that does, a quickstart that says why a run failed and what an approval protects, and
 * comparisons and protocol notes that match the code, and the docs pages that say them too. npm
 * publishes this README (scripts/npm-readme.mjs), so it ships with each release. readme.test.ts
 * typechecks the quickstart's files.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const readme = read('README.md');
const pkg = JSON.parse(read('packages/signoff-ui/package.json')) as {
  description: string;
  keywords: string[];
  engines?: { node?: string };
};

/** A `## ` section of the README, without its heading. */
function section(heading: string) {
  const start = readme.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start + heading.length + 5, end === -1 ? undefined : end);
}

const quickstart = section('Quickstart');
/** A quickstart file, by the `// app/...` line it starts with. */
const file = (path: string) =>
  new RegExp(`\`\`\`tsx?\\n// ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)\`\`\``).exec(
    quickstart,
  )?.[1] ?? '';

/**
 * The id the docs site gives a heading: lib/docs.ts's slugify of its plainText, copied rather than
 * imported, so this test doesn't load the playground's component and API modules lib/docs.ts uses.
 */
const headingId = (heading: string) =>
  heading
    // plainText: code, links and emphasis as their text.
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(.*?)\1/g, '$2')
    .trim()
    // slugify
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/** The `##` and `###` headings' ids of a Markdown file, outside code blocks (lib/docs.ts's getHeadings). */
function headingIds(path: string) {
  let fenced = false;
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => {
      if (line.startsWith('```')) fenced = !fenced;
      return !fenced && /^#{2,3} /.test(line);
    })
    .map((line) => headingId(line.replace(/^#+ /, '')));
}

/*
 * The sections every component page has around its own Markdown (component-page.tsx's
 * componentHeadings). Its API entries and Theming are left out: a link to one needs adding here.
 */
const componentPageIds = ['example', 'installation', 'usage', 'how-it-works', 'api-reference', 'accessibility'];

describe('the pitch', () => {
  const lead = readme.split('\n')[2] ?? '';

  it('is one line on the README and npm', () => {
    // The home page's hero says it in fewer words, for a first screen of 45 at most
    // (examples/playground/test/first-screen.test.ts); its meta description is this line (below).
    expect(lead).toMatch(
      /^Review what your agent changed and approve what it may do: React components for .+ or your own chat\.$/,
    );
    expect(pkg.description).toBe(lead);
  });

  it('names every protocol and chat kit it works with', () => {
    for (const name of ['AI SDK 6 & 7', 'AG-UI', 'ACP', 'assistant-ui', 'AI Elements']) expect(lead).toContain(name);
  });

  it("fits npm's 255 characters, so the registry shows it whole", () => {
    expect(pkg.description.length).toBeLessThanOrEqual(255);
  });

  it("is the home page's meta description, short of one clause so a search result shows it whole", () => {
    // The page's title is the tagline, so the description is what follows it, without "that return
    // a result your agent acts on", which would take it past the 160 characters a result shows.
    const page = read('examples/playground/app/(home)/page.tsx');
    const description = /pageMetadata\(\{[\s\S]*?description:\s*'([^']*)'/.exec(page)?.[1] ?? '';
    const pitch = lead.slice(lead.indexOf(': ') + 2);
    expect(description).toBe(pitch.replace(' that return a result your agent acts on', ''));
    expect(description.length).toBeLessThanOrEqual(160);
    for (const name of ['AI SDK 6 & 7', 'AG-UI', 'ACP', 'assistant-ui', 'AI Elements'])
      expect(description).toContain(name);
  });
});

describe('package.json', () => {
  it('has a keyword for each protocol, chat kit and agent the docs cover', () => {
    for (const keyword of [
      'ai-sdk',
      'ai-elements',
      'assistant-ui',
      'ag-ui',
      'langgraph',
      'acp',
      'agent-client-protocol',
      'claude-code',
      'codex',
      'nextjs',
      'approval-rules',
      'permissions',
      'hunk',
      'patch',
    ])
      expect(pkg.keywords).toContain(keyword);
    expect(new Set(pkg.keywords).size).toBe(pkg.keywords.length);
  });

  it('says which Node versions it runs on', () => {
    // ESM only: the Node versions that load an ES module from require() without a flag. Node 22
    // unflagged it in 22.12 and backported it to 20.19; 22.0 to 22.11 throw ERR_REQUIRE_ESM.
    expect(pkg.engines).toEqual({ node: '^20.19.0 || >=22.12.0' });
  });
});

describe('the README top', () => {
  it("labels the shadcn badge as a registry, not the @signoff-ui namespace, which shadcn's directory doesn't list yet", () => {
    const top = readme.slice(0, readme.indexOf('<!-- npm-readme:video -->'));
    expect(top).toMatch(/\[!\[shadcn registry\]\(https:\/\/img\.shields\.io\/badge\/shadcn-registry-/);
    expect(top).not.toContain('%40signoff--ui');
  });
});

describe('the quickstart', () => {
  it('opens on the start that needs no API key, before the one that does', () => {
    const first = /```bash\n([\s\S]*?)```/.exec(quickstart)?.[1] ?? '';
    const port = (name: string) =>
      /--port (\d+)/.exec(
        (JSON.parse(read(`examples/${name}/package.json`)) as { scripts: { dev: string } }).scripts.dev,
      )?.[1];
    expect(first).toBe(
      `npx create-next-app@latest my-agent --example https://github.com/dgesteves/signoff-ui/tree/main/examples/coding-agent\ncd my-agent\nnpm run dev   # http://localhost:${port('coding-agent') ?? ''}\n`,
    );
    const quickstartApp = quickstart.indexOf(
      'npx create-next-app@latest my-quickstart --example https://github.com/dgesteves/signoff-ui/tree/main/examples/nextjs-minimal',
    );
    expect(quickstartApp).toBeGreaterThan(0);
    for (const needsKey of ['OPENAI_API_KEY', '@ai-sdk/openai'])
      expect(quickstart.indexOf(needsKey), needsKey).toBeGreaterThan(quickstartApp);
  });

  it('installs only the kit for a first sign-off, and the AI SDK after it, for an agent', () => {
    const kitOnly = quickstart.indexOf('```bash\nnpm i signoff-ui\n```');
    const firstSignOff = quickstart.indexOf('/docs/getting-started#your-first-sign-off');
    const aiSdk = quickstart.indexOf('```bash\nnpm i signoff-ui ai @ai-sdk/react @ai-sdk/openai zod\n```');
    expect(kitOnly).toBeGreaterThan(0);
    expect(firstSignOff).toBeGreaterThan(kitOnly);
    expect(aiSdk).toBeGreaterThan(firstSignOff);
  });

  it('shows why a run failed: the client renders useChat’s error, and the route sends its message', () => {
    const client = file('app/agent-run.tsx');
    expect(client).toMatch(
      /const \{ messages, status, error, sendMessage, addToolOutput, addToolApprovalResponse \} = useChat/,
    );
    expect(client).toContain('{error && <p role="alert">{error.message}</p>}');
    expect(file('app/api/chat/route.ts')).toContain(
      "onError: (error) => (error instanceof Error ? error.message : 'An error occurred.'),",
    );
  });

  it('gives review_changes an outputSchema, so messages typed with InferUITools accept its output', () => {
    const route = file('app/api/chat/route.ts');
    const tool = route.slice(route.indexOf('review_changes: tool({'), route.indexOf('run_command: tool({'));
    expect(tool).toContain('outputSchema: z.custom<DiffReviewToolOutput>(),');
    expect(route).toContain("import type { DiffReviewToolOutput } from 'signoff-ui/core';");
  });

  it('says at `messages` what an approval is, with a link to the section in Getting started', () => {
    const lines = file('app/api/chat/route.ts').split('\n');
    const at = lines.findIndex((line) => line.includes('const { messages }'));
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(Math.max(0, at - 3), at).join('\n')).toContain(
      'https://signoff-ui.vercel.app/docs/getting-started#what-an-approval-is',
    );
  });
});

describe('the README’s claims', () => {
  it('says sub-agents nest, as they have since 0.7.0, and nowhere that the kit renders them flat', () => {
    expect(readme).not.toMatch(/renders? (them )?flat/);
    expect(section('Components')).toContain('sub-agents nested under the call that started them');
  });

  it('says what an ACP approval card offers: Always only for a single allow_always option', () => {
    const acp = section('Works inside assistant-ui, AI Elements or your own chat')
      .split('\n')
      .find((line) => line.startsWith('- **Agent Client Protocol:**'));
    expect(acp).toBeDefined();
    expect(acp).not.toContain("with the agent's options on the approval card");
    expect(acp).toContain('Always only when the agent sent a single `allow_always` option');
    expect(acp).toContain('cancel');
  });

  it('compares the review with @pierre/diffs, the renderer many coding-agent UIs use', () => {
    const bullet = /^- \*\*@pierre\/diffs\*\* .+$/m.exec(section('How it compares'))?.[0] ?? '';
    expect(bullet).not.toBe('');
    // DiffReview's size up front, as the docs' size table has it (`pnpm size` keeps that table
    // measured). The table leaves out the diff worker DiffReview starts for a large file, so the
    // bullet adds it, as Pierre's figure leaves out what it loads later: dist/lib/diff-worker.js
    // bundled as its own entry with scripts/size.mjs's settings is 6.7 kB gzipped (6,853 bytes).
    const limits = read('examples/playground/content/docs/limits.md');
    const size = /^\| `DiffReview` +\| +([\d.]+ kB) \|$/m.exec(limits)?.[1];
    expect(size).toBeDefined();
    expect(bullet).toContain(
      `\`DiffReview\` is ${size ?? ''} up front, plus a 6.7 kB worker it starts for large files.`,
    );
    expect(bullet).not.toContain('all of `DiffReview`');
  });

  it('compares with @pierre/diffs on the docs’ comparison page too, in the same words', () => {
    const readmeBullet = /^- \*\*@pierre\/diffs\*\* .+$/m.exec(section('How it compares'))?.[0];
    const comparison = read('examples/playground/content/docs/comparison.md');
    const better = comparison.slice(comparison.indexOf('\n## What they do better\n'), comparison.indexOf('\n## Where'));
    expect(readmeBullet).toBeDefined();
    expect(better.split('\n')).toContain(readmeBullet);
    // The intro names it with the other libraries, as the README's does.
    expect(comparison.split('\n\n')[0]).toContain('[@pierre/diffs](https://diffs.com) renders diffs');
  });

  it('says on the ACP docs page, as here, that the card offers Always only for a single allow_always option', () => {
    const intro = read('examples/playground/content/docs/acp.md').split('\n\n')[0] ?? '';
    expect(intro).not.toContain('with the options the agent offered');
    expect(intro).toContain('Always only when the agent sent a single `allow_always` option');
    expect(intro).toContain('cancel');
  });

  it('links only to docs pages and headings that exist', () => {
    const links = [...readme.matchAll(/https:\/\/signoff-ui\.vercel\.app\/docs\/([\w/-]+)(?:#([\w-]+))?/g)];
    expect(links.length).toBeGreaterThan(10);
    for (const [, page = '', anchor] of links) {
      // /docs/<page> is content/docs/<page>.md, and /docs/components/<slug> content/components/<slug>.md.
      const component = /^components\/([\w-]+)$/.exec(page)?.[1];
      const path = join(
        root,
        'examples/playground/content',
        component ? `components/${component}.md` : `docs/${page}.md`,
      );
      expect(existsSync(path), page).toBe(true);
      if (!anchor) continue;
      const ids = [...headingIds(path), ...(component ? componentPageIds : [])];
      expect(ids, `${page}#${anchor}`).toContain(anchor);
    }
  });
});
