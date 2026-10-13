import Link from 'next/link';
import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { slugify } from '@/lib/docs';
import { PackageInstall } from './code';
import { CodeBlock } from './code-block';
import { TableScroll } from './table-scroll';
import { Tabs } from './tabs';

/*
 * Renders a guide's Markdown on the server: headings with anchors, highlighted code under a bar
 * with a copy button, install commands as package-manager tabs, site links through next/link,
 * tables that scroll sideways in a region named after their heading, and these, which still read
 * as plain Markdown in the .md version and on GitHub:
 *
 *   > [!NOTE], > [!TIP] or > [!WARNING]     a callout (GitHub's alert syntax)
 *   <!-- steps --> before an ordered list    numbered steps
 *   <!-- cards --> before a list             a card per item, its bold lead as the title
 *   ```tsx tab="Label"                       consecutive blocks with a tab each become one set of tabs
 *   ```ts title="file.ts"                    a file name in the block's bar
 *   ```ts collapse                           a long block, folded behind "Show all N lines"
 */

/** The bit of a hast node this file reads. */
export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown; dataLabel?: unknown; dataCallout?: unknown };
  data?: { meta?: string | null };
  children?: HastNode[];
}

/** The bit of an mdast node the steps plugin reads. */
interface MdastNode {
  type: string;
  value?: string;
  ordered?: boolean | null;
  data?: { hProperties?: Record<string, unknown> };
  children?: MdastNode[];
}

function textOf(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function Heading({ level, node, children }: { level: 2 | 3 | 4; node?: HastNode; children: ReactNode }) {
  const id = slugify(textOf(node));
  const Tag = `h${level}` as const;
  return (
    <Tag id={id}>
      <a href={`#${id}`} className="heading-anchor">
        {children}
      </a>
    </Tag>
  );
}

/**
 * Names each table for its scrolling region: after the heading before it ("Large diffs"), numbered
 * when that heading has more than one, or after its column headers when no heading comes first.
 */
function labelTables() {
  return (tree: HastNode) => {
    const tables: Array<{ node: HastNode; heading: string }> = [];
    let heading = '';
    const visit = (node: HastNode) => {
      if (/^h[2-4]$/.test(node.tagName ?? '')) heading = textOf(node).trim();
      if (node.tagName === 'table') tables.push({ node, heading });
      else node.children?.forEach(visit);
    };
    visit(tree);
    for (const { node, heading } of tables) {
      const same = tables.filter((t) => t.heading === heading);
      const label = !heading
        ? columnsOf(node)
        : same.length > 1
          ? `${heading} (${same.findIndex((t) => t.node === node) + 1} of ${same.length})`
          : heading;
      node.properties = { ...node.properties, dataLabel: label };
    }
  };
}

/** A table's column headers, as "Case, First render, Ready". */
function columnsOf(table: HastNode): string {
  const cells: string[] = [];
  const visit = (node: HastNode) => {
    if (node.tagName === 'th') cells.push(textOf(node).trim());
    else if (node.tagName !== 'tbody') node.children?.forEach(visit);
  };
  visit(table);
  return cells.join(', ') || 'Table';
}

const metaOf = (node: HastNode | undefined) =>
  node?.children?.find((child) => child.tagName === 'code')?.data?.meta ?? '';
const attribute = (meta: string, name: string) => new RegExp(`${name}="([^"]+)"`).exec(meta)?.[1];

/** A fenced block: highlighted code, or package-manager tabs for ```package-install. */
export function FencedCode({ node, bare = false }: { node?: HastNode; bare?: boolean }) {
  const code = node?.children?.find((child) => child.tagName === 'code');
  const className = code?.properties?.className;
  const language = (Array.isArray(className) ? String(className[0] ?? '') : '').replace(/^language-/, '');
  const text = textOf(code).replace(/\n$/, '');
  if (language === 'package-install') return <PackageInstall command={text.trim()} />;
  const meta = metaOf(node);
  return (
    <CodeBlock
      code={text}
      language={language || undefined}
      title={attribute(meta, 'title')}
      bare={bare}
      collapse={/(^|\s)collapse(\s|$)/.test(meta)}
    />
  );
}

/** Groups consecutive fenced blocks that each have a `tab="…"` into one `code-tabs` element. */
function codeTabs() {
  const visit = (node: HastNode) => {
    if (!node.children) return;
    const out: HastNode[] = [];
    let run: HastNode[] = [];
    const flush = () => {
      if (run.length > 1) {
        out.push({ type: 'element', tagName: 'code-tabs', properties: {}, children: run });
      } else out.push(...run);
      run = [];
    };
    for (const child of node.children) {
      if (child.tagName === 'pre' && attribute(metaOf(child), 'tab')) run.push(child);
      else if (child.type === 'text' && !child.value?.trim() && run.length) continue;
      else {
        flush();
        visit(child);
        out.push(child);
      }
    }
    flush();
    node.children = out;
  };
  return visit;
}

const CALLOUTS: Record<string, 'note' | 'tip' | 'warning'> = {
  NOTE: 'note',
  IMPORTANT: 'note',
  TIP: 'tip',
  WARNING: 'warning',
  CAUTION: 'warning',
};

/** `> [!NOTE]` and its kind: the blockquote becomes a callout, without the marker. */
function callouts() {
  const visit = (node: HastNode) => {
    if (node.tagName === 'blockquote') {
      const first = node.children?.find((child) => child.type === 'element');
      const text = first?.tagName === 'p' ? first.children?.[0] : undefined;
      const match = text?.type === 'text' ? /^\[!(\w+)\][ \t]*\n?/.exec(text.value ?? '') : null;
      const kind = match && CALLOUTS[match[1]!.toUpperCase()];
      if (kind && text && first) {
        text.value = text.value!.slice(match[0].length);
        if (!textOf(first).trim()) node.children = node.children!.filter((child) => child !== first);
        node.properties = { ...node.properties, dataCallout: kind };
      }
    }
    node.children?.forEach(visit);
  };
  return visit;
}

/**
 * A list right after a marker gets a layout: `<!-- steps -->` before an ordered list numbers its
 * items as steps, `<!-- cards -->` before any list makes each item a card. The marker itself goes.
 */
function listLayouts() {
  const marker = (node: MdastNode | undefined) => /^<!--\s*(steps|cards)\s*-->$/.exec(node?.value?.trim() ?? '')?.[1];
  return (tree: MdastNode) => {
    const visit = (node: MdastNode) => {
      if (!node.children) return;
      node.children.forEach((child, i) => {
        const next = node.children![i + 1];
        const layout = child.type === 'html' ? marker(child) : undefined;
        if (layout && next?.type === 'list' && (layout === 'cards' || next.ordered)) {
          next.data = { ...next.data, hProperties: { ...next.data?.hProperties, className: [layout] } };
        }
        visit(child);
      });
      node.children = node.children.filter((child) => !(child.type === 'html' && marker(child)));
    };
    visit(tree);
  };
}

const CALLOUT_TITLES = { note: 'Note', tip: 'Tip', warning: 'Warning' };

/** A note, not a landmark: several on a page would each add one to landmark navigation. */
function Callout({ kind, children }: { kind: 'note' | 'tip' | 'warning'; children: ReactNode }) {
  return (
    <div role="note" className="callout" data-kind={kind} aria-label={CALLOUT_TITLES[kind]}>
      <p className="callout-title" aria-hidden="true">
        {CALLOUT_TITLES[kind]}
      </p>
      {children}
    </div>
  );
}

/** Line-break opportunities after slashes, so paths wrap at a segment rather than mid-word. */
function breakable(children: ReactNode) {
  if (typeof children !== 'string' || !children.includes('/')) return children;
  return children.split('/').flatMap((part, i) => (i === 0 ? [part] : ['/', <wbr key={i} />, part]));
}

/**
 * Inline code. Over 28 characters it is marked `data-long`: only such a token may break, and only
 * on a phone (app/globals.css), after a slash where it has one.
 */
export function InlineCode({ children }: { children?: ReactNode }) {
  const long = typeof children === 'string' && children.length > 28;
  return <code data-long={long || undefined}>{long ? breakable(children) : children}</code>;
}

const components = {
  // Inline code only: fenced blocks render through `pre`, which reads the node itself.
  code: ({ children }) => <InlineCode>{children}</InlineCode>,
  h2: ({ node, children }) => (
    <Heading level={2} node={node as HastNode}>
      {children}
    </Heading>
  ),
  h3: ({ node, children }) => (
    <Heading level={3} node={node as HastNode}>
      {children}
    </Heading>
  ),
  h4: ({ node, children }) => (
    <Heading level={4} node={node as HastNode}>
      {children}
    </Heading>
  ),
  pre: ({ node }) => <FencedCode node={node as HastNode} />,
  a: ({ href = '', children }) =>
    href.startsWith('/') || href.startsWith('#') ? (
      <Link href={href}>{children}</Link>
    ) : (
      <a href={href} rel="noreferrer">
        {children}
      </a>
    ),
  table: ({ node, children }) => (
    <TableScroll label={String((node as HastNode | undefined)?.properties?.dataLabel ?? 'Table')}>
      <table>{children}</table>
    </TableScroll>
  ),
  blockquote: ({ node, children }) => {
    const kind = (node as HastNode | undefined)?.properties?.dataCallout as 'note' | 'tip' | 'warning' | undefined;
    return kind ? <Callout kind={kind}>{children}</Callout> : <blockquote>{children}</blockquote>;
  },
  // Tabs over consecutive blocks (codeTabs above): each block, without its own frame, is a tab.
  'code-tabs': ({ node }: { node?: HastNode }) => {
    const blocks = node?.children ?? [];
    return (
      <Tabs label="Code" labels={blocks.map((block) => attribute(metaOf(block), 'tab')!)}>
        {blocks.map((block, i) => (
          <FencedCode key={i} node={block} bare />
        ))}
      </Tabs>
    );
  },
} as Components;

export function DocMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="docs-prose">
      <Markdown
        remarkPlugins={[remarkGfm, listLayouts]}
        rehypePlugins={[labelTables, callouts, codeTabs]}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
