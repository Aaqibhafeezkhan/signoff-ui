/*
 * Builds ask-index.json, which the Ask dialog (/api/ask) and the MCP server (/api/mcp) search: every
 * docs page as the Markdown it is served as at <page>.md, split into sections by ondocs. Runs
 * before `next build` and `next dev` (package.json), from examples/playground, and needs the
 * library built (pnpm build:lib), whose types the component pages are written from.
 *
 * The index is keyword-only: building it calls no model and needs no key, and an agent's search
 * over MCP costs nothing.
 */
import { buildIndex, fromMarkdown, type SourceDocument } from 'ondocs';
import { writeIndexFile } from 'ondocs/node';
import { componentMarkdown } from '../lib/component-markdown';
import { componentHref, COMPONENTS } from '../lib/components';
import { GUIDES, readGuide, toMarkdown } from '../lib/docs';

const pages = [
  ...GUIDES.map((doc) => ({ id: `${doc.slug}.md`, url: doc.href, markdown: toMarkdown(doc, readGuide(doc)) })),
  ...COMPONENTS.map((c) => ({
    id: `components/${c.slug}.md`,
    url: componentHref(c.slug),
    markdown: componentMarkdown(c),
  })),
];

const documents = pages
  .map((page) => fromMarkdown(page.markdown, { id: page.id, url: page.url }))
  .filter((doc): doc is SourceDocument => doc !== null);
const { index, stats } = await buildIndex({ documents });
await writeIndexFile('ask-index.json', index);
console.log(`ask-index.json: ${stats.documents} pages, ${stats.chunks} sections, keyword-only`);
