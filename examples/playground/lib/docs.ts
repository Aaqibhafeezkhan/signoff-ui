import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getApiIndex, getInterface } from './api';
import { componentAbout, componentHref, COMPONENTS } from './components';
import { SITE_URL } from './site';

/*
 * The docs: guides written in Markdown under content/docs, read when the site builds. The same
 * Markdown renders the page, is served at /docs/<slug>.md, and is what "Copy page" copies.
 */

export interface DocPage {
  /** The Markdown file under content/docs, without the extension. */
  slug: string;
  href: string;
  title: string;
  /** The sidebar's shorter name for it, when the title is long. */
  label?: string;
  description: string;
}

export interface NavGroup {
  title: string;
  /** `title` is the sidebar's label; `page` the page's own title, for previous and next. */
  items: Array<{ title: string; page: string; href: string }>;
}

export const GUIDES: DocPage[] = [
  {
    slug: 'introduction',
    href: '/docs',
    title: 'Introduction',
    description:
      'What signoff-ui is: reviewing what an agent changed and approving what it may do, with the result going back to the agent.',
  },
  {
    slug: 'getting-started',
    href: '/docs/getting-started',
    title: 'Getting started',
    description:
      'Install from npm or the shadcn registry, add the styles, and build a Next.js run with a diff review and an approval. AI SDK 6 or 7, React 18 or 19.',
  },
  {
    slug: 'chat-ui',
    href: '/docs/chat-ui',
    title: 'Inside your chat UI',
    label: 'Chat UIs',
    description:
      'Use the review and approval components in assistant-ui, AI Elements or your own chat, with the code for each.',
  },
  {
    slug: 'own-renderer',
    href: '/docs/own-renderer',
    title: 'Bring your own diff renderer',
    label: 'Your diff renderer',
    description:
      'Keep @pierre/diffs, or the diff renderer you have, and review with useDiffReview: decisions per hunk, comments on lines, and the result the agent gets back.',
  },
  {
    slug: 'ag-ui',
    href: '/docs/ag-ui',
    title: 'AG-UI agents',
    label: 'AG-UI',
    description:
      'Render LangGraph, CrewAI, Mastra and other AG-UI agents with the same components, interrupts included, through useAgUiAgent.',
  },
  {
    slug: 'copilotkit',
    href: '/docs/copilotkit',
    title: 'CopilotKit',
    description:
      'The approval card, approval rules and DiffReview inside CopilotKit: its human-in-the-loop and interrupt hooks render them, with a runnable example.',
  },
  {
    slug: 'acp',
    href: '/docs/acp',
    title: 'Agent Client Protocol',
    label: 'ACP',
    description:
      'Render an ACP prompt turn with the same components: session updates as message parts, permission requests as approval cards, edits as diffs.',
  },
  {
    slug: 'accessibility',
    href: '/docs/accessibility',
    title: 'Accessibility',
    description:
      'Keyboard shortcuts scoped to focus, managed focus, announcements, contrast and how they are tested, with axe in jsdom and in Chrome.',
  },
  {
    slug: 'labels',
    href: '/docs/labels',
    title: 'Labels and translations',
    label: 'Labels',
    description:
      'Every word the components show or announce is a label: translate them all with one provider, or change a few, with a complete Portuguese example.',
  },
  {
    slug: 'limits',
    href: '/docs/limits',
    title: 'Performance and limits',
    label: 'Performance',
    description:
      'Bundle size per import, the stylesheet, known limitations with measured numbers, and what comes next.',
  },
  {
    slug: 'api',
    href: '/docs/api',
    title: 'API index',
    description:
      'Every export of each entry point, read from the published types: a link to the component page that documents it, or its signature and description.',
  },
  {
    slug: 'comparison',
    href: '/docs/comparison',
    title: 'signoff-ui vs assistant-ui, AI Elements and @pierre/diffs',
    label: 'Comparison',
    description:
      'How signoff-ui is different from assistant-ui, AI Elements, @pierre/diffs and other diff viewers, what each does better, and how to use them together.',
  },
  {
    slug: 'migrating-from-agent-ui-kit',
    href: '/docs/migrating-from-agent-ui-kit',
    title: 'Migrating from @dgesteves/agent-ui-kit',
    label: 'Migration',
    description:
      'The package is now signoff-ui: swap it, rename the CSS variables, classes and attributes with one command, and what changed in styles.css.',
  },
];

const guides = (...slugs: string[]) =>
  slugs.map((slug) => {
    const doc = GUIDES.find((d) => d.slug === slug)!;
    return { title: doc.label ?? doc.title, page: doc.title, href: doc.href };
  });

/** The sidebar, in reading order: what to read first, the guides, each component, and the rest. */
export const NAV: NavGroup[] = [
  { title: 'Get started', items: guides('introduction', 'getting-started') },
  {
    title: 'Guides',
    items: guides('chat-ui', 'own-renderer', 'ag-ui', 'copilotkit', 'acp', 'labels', 'accessibility'),
  },
  {
    title: 'Components',
    items: [
      { title: 'All components', page: 'All components', href: '/components' },
      ...COMPONENTS.map((c) => ({ title: c.name, page: c.name, href: componentHref(c.slug) })),
    ],
  },
  { title: 'Resources', items: guides('api', 'limits', 'comparison', 'migrating-from-agent-ui-kit') },
];

// Every guide is in the sidebar once.
const listed = NAV.flatMap((group) => group.items.map((item) => item.href));
for (const doc of GUIDES) {
  if (!listed.includes(doc.href)) throw new Error(`lib/docs.ts: ${doc.slug} is in no NAV group`);
}

/**
 * Every docs page in sidebar order, for previous and next. The components page has neither, and
 * neither has the migration guide: it is there for those who need it, not as a next step.
 */
const ORDER = NAV.flatMap((group) => group.items)
  .filter((item) => item.href.startsWith('/docs') && item.href !== '/docs/migrating-from-agent-ui-kit')
  .map((item) => ({ title: item.page, href: item.href }));

export function getGuide(slug: string) {
  return GUIDES.find((doc) => doc.slug === slug);
}

/** The pages before and after this one, in sidebar order. */
export function getPager(href: string) {
  const index = ORDER.findIndex((page) => page.href === href);
  return index === -1 ? {} : { prev: ORDER[index - 1], next: ORDER[index + 1] };
}

// `next build` and `next start` run in examples/playground.
const readSource = (slug: string) => readFileSync(join(process.cwd(), 'content/docs', `${slug}.md`), 'utf8');

const EXPORTS_MARKER = /^<!-- exports: (\S+) -->$/gm;

/**
 * A guide's Markdown, as the page, its .md, search, Ask and llms-full.txt read it. In the API index,
 * each `<!-- exports: <entry point> -->` line becomes that entry point's exports, and every entry
 * point must have one, so an API index without any fails the build too.
 */
export function readGuide(doc: DocPage) {
  const markdown = readSource(doc.slug);
  const named = [...markdown.matchAll(EXPORTS_MARKER)].map((match) => match[1]!);
  if (doc.slug !== 'api' && named.length === 0) return markdown;
  const index = apiIndexMarkdown();
  const file = `content/docs/${doc.slug}.md`;
  const unknown = named.filter((name) => !index.has(name));
  if (unknown.length > 0) throw new Error(`${file}: signoff-ui has no entry point ${unknown.join(', ')}`);
  const missing = [...index.keys()].filter((name) => !named.includes(name));
  if (missing.length > 0)
    throw new Error(`${file}: add a <!-- exports: <entry point> --> line for ${missing.join(', ')}`);
  return markdown.replace(EXPORTS_MARKER, (_, name: string) => index.get(name)!);
}

/** Where the docs show an export in full: its section of a component page's API reference. */
function componentSections() {
  const sections = new Map<string, { title: string; href: string }>();
  for (const c of COMPONENTS) {
    const add = (name: string | undefined, id: string) => {
      if (name && !sections.has(name)) sections.set(name, { title: c.name, href: `${componentHref(c.slug)}#${id}` });
    };
    for (const entry of c.api) {
      const id = entry.name.toLowerCase();
      for (const name of [entry.name, entry.props, entry.parameters, entry.returns]) add(name, id);
    }
    for (const name of c.types ?? []) add(name, name.toLowerCase());
  }
  return sections;
}

/** Text that matches itself in a RegExp: every metacharacter escaped, as src/lib/policy.ts does it. */
function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** A declaration longer than this shows only its first line. */
const MAX_DECLARATION_LINES = 30;

/** A declaration's first line, with what it opens closed over an ellipsis: `interface X { … }`. */
function firstLine(declaration: string) {
  const line = declaration.split('\n')[0]!;
  const close = { '{': ' }', '[': ' ]', '(': ' )' }[line.at(-1)!];
  return close ? `${line} …${close}` : `${line} …`;
}
/** The most pages an export's "In the docs" line links. */
const MAX_MENTIONS = 4;

let apiIndex: Map<string, string> | undefined;

/**
 * Each entry point's exports as Markdown, for the API index. First the exports another entry point
 * lists, as links, then the ones a component page documents, as one line of links to their sections
 * there: a section of their own here would only repeat the first line, and would take the places
 * in Ask's and the MCP server's results that the component page's own sections should get. Then a
 * `###` heading for each other export, with its declaration (inline code when it is one line), its
 * description, and the pages that use it in code (the migration guide's renames aside).
 */
function apiIndexMarkdown() {
  if (apiIndex) return apiIndex;
  const entryPoints = getApiIndex();
  const documented = componentSections();
  const pages = [
    ...GUIDES.filter((doc) => !['api', 'migrating-from-agent-ui-kit'].includes(doc.slug)).map((doc) => ({
      title: doc.label ?? doc.title,
      href: doc.href,
      markdown: readSource(doc.slug),
    })),
    ...COMPONENTS.map((c) => ({ title: c.name, href: componentHref(c.slug), markdown: componentAbout(c.slug) ?? '' })),
  ];
  // What each page has as code: its code blocks, and its inline code (`evaluateRules(…)`).
  const code = pages.map((page) => ({
    ...page,
    blocks: [...page.markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)].map((match) => match[1]!).join('\n'),
    spans: [...page.markdown.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!),
  }));
  const mentions = (name: string) => {
    const word = new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`);
    return code
      .filter((page) => word.test(page.blocks) || page.spans.some((span) => span.startsWith(name) && word.test(span)))
      .slice(0, MAX_MENTIONS);
  };
  // Each heading is the export's name, or the name and its entry point when an export listed
  // before it has the name, so every id is unique.
  const headings = new Map<string, string>();
  const used = new Set<string>();
  for (const point of entryPoints) {
    for (const item of point.exports) {
      if (documented.has(item.name)) continue;
      headings.set(`${point.name} ${item.name}`, used.has(item.name) ? `${item.name} (${point.name})` : item.name);
      used.add(item.name);
    }
  }
  /** Where an export is shown: its component page's section, or its heading here. */
  const target = (entryPoint: string, name: string) =>
    documented.get(name)?.href ?? `#${slugify(headings.get(`${entryPoint} ${name}`)!)}`;
  const sections = entryPoints.map((point): [string, string] => {
    const from = new Map<string, string[]>();
    for (const { name, entryPoint } of point.shared) from.set(entryPoint, [...(from.get(entryPoint) ?? []), name]);
    const also = [...from].map(([other, names]) => {
      const link = `[\`${other}\`](#${slugify(other)})`;
      if (entryPoints.find((p) => p.name === other)!.exports.length === names.length)
        return `It also exports everything in ${link}.`;
      const links = names.map((name) => `[\`${name}\`](${target(other, name)})`);
      return `It also exports these, listed under ${link}: ${links.join(', ')}.`;
    });
    const onPages = point.exports
      .filter((item) => documented.has(item.name))
      .map((item) => `[\`${item.name}\`](${target(point.name, item.name)})`);
    const pagesLine = onPages.length > 0 && `On the component pages: ${onPages.join(', ')}.`;
    const blocks = point.exports
      .filter((item) => !documented.has(item.name))
      .map((item) => {
        const declaration =
          item.declaration.split('\n').length > MAX_DECLARATION_LINES ? firstLine(item.declaration) : item.declaration;
        // One line reads as inline code; a code block is for more, or for a line with a backtick.
        const shown = /[\n`]/.test(declaration) ? `\`\`\`ts\n${declaration}\n\`\`\`` : `\`${declaration}\``;
        const named = mentions(item.name).map((mention) => `[${mention.title}](${mention.href})`);
        return [
          `### ${headings.get(`${point.name} ${item.name}`)}`,
          shown,
          item.description,
          named.length > 0 && `In the docs: ${named.join(', ')}.`,
        ]
          .filter(Boolean)
          .join('\n\n');
      });
    return [point.name, [...also, pagesLine, ...blocks].filter(Boolean).join('\n\n')];
  });
  apiIndex = new Map(sections);
  return apiIndex;
}

export interface Heading {
  id: string;
  text: string;
  depth: 2 | 3;
}

/** Plain text of inline Markdown: code spans, links and emphasis unwrapped. */
export function plainText(markdown: string) {
  return markdown
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(.*?)\1/g, '$2')
    .trim();
}

/** The id a heading gets: lowercase words joined by hyphens, as GitHub does it. */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** `##` and `###` headings, outside code blocks, for the table of contents and search. */
export function getHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;
    const match = /^(##|###) (.+)$/.exec(line);
    if (!match) continue;
    const text = plainText(match[2]!);
    headings.push({ id: slugify(text), text, depth: match[1]!.length as 2 | 3 });
  }
  return headings;
}

/** The page as one Markdown document: title, summary and body, with absolute links. */
export function toMarkdown(doc: DocPage, markdown: string) {
  const body = markdown
    // Install blocks are ordinary shell commands outside the site.
    .replace(/^```package-install$/gm, '```bash')
    .replace(/\]\((\/[^)]*)\)/g, `](${SITE_URL}$1)`)
    // A link to a heading of the page itself, as the API index has.
    .replace(/\]\((#[^)]*)\)/g, `](${SITE_URL}${doc.href}$1)`);
  return `# ${doc.title}\n\n> ${doc.description}\n\nSource: ${SITE_URL}${doc.href}\n\n${body.trim()}\n`;
}

/** Markdown as searchable text: no code blocks, markup, list markers or table rules. */
function textOf(markdown: string) {
  return markdown
    .replace(/^```[^\n]*\n[\s\S]*?^```$/gm, ' ')
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+\.|>(?: \[!\w+\])?)\s+/, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`|]|\*\*|<!--.*?-->/g, ' '),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchSection {
  title: string;
  href: string;
  /** What the section says, as plain text. */
  text: string;
}

/** The text before the first heading, then each `##` and `###` section with its own text. */
function sectionsOf(markdown: string, href: string) {
  const sections: SearchSection[] = [];
  let current: SearchSection & { lines: string[] } = { title: '', href, text: '', lines: [] };
  const close = () =>
    sections.push({ title: current.title, href: current.href, text: textOf(current.lines.join('\n')) });
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const match = fenced ? null : /^(##|###) (.+)$/.exec(line);
    if (!match) {
      current.lines.push(line);
      continue;
    }
    close();
    const title = plainText(match[2]!);
    current = { title, href: `${href}#${slugify(title)}`, text: '', lines: [] };
  }
  close();
  return { intro: sections[0]!.text, sections: sections.slice(1) };
}

/**
 * What the docs search looks through, served as /docs/search-index.json and loaded on first use:
 * each guide and its sections with their text, and each component with its "How it works"
 * sections and every prop, option and returned field, so "storage" finds useApprovalPolicy's option.
 */
export function getSearchIndex() {
  const guides = GUIDES.map((doc) => {
    const { intro, sections } = sectionsOf(readGuide(doc), doc.href);
    return { title: doc.title, description: doc.description, href: doc.href, text: intro, sections };
  });
  const components = COMPONENTS.map((c) => {
    const href = componentHref(c.slug);
    const about = componentAbout(c.slug);
    const how = about ? sectionsOf(about, href) : undefined;
    const api = c.api.flatMap((entry) =>
      [entry.props && { owner: entry.name, name: entry.props }, entry.parameters, entry.returns]
        .map((part) => (typeof part === 'string' ? { owner: part, name: part } : part))
        .filter((part) => !!part)
        .flatMap(({ owner, name }) =>
          getInterface(name).props.map((prop) => ({
            title: prop.name,
            href: `${href}#${`${owner}-${prop.name}`.toLowerCase()}`,
            text: prop.description,
          })),
        ),
    );
    return {
      title: c.name,
      description: c.summary,
      href,
      text: how?.intro ?? '',
      sections: [...(how?.sections ?? []), ...api],
    };
  });
  return [...guides, ...components];
}

export type SearchIndex = ReturnType<typeof getSearchIndex>;
