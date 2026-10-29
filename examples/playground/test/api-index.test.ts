/*
 * The API index (/docs/api): every export of every entry point in the package's `exports`, each
 * under its entry point with its declaration and its doc comment, and links that land. The exports
 * are read here with TypeScript straight from the built declarations, not with the generator the
 * page uses (lib/api.ts), so a name the generator drops fails. Needs the library built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { COMPONENTS, componentHref } from '../lib/components';
import { getGuide, getHeadings, GUIDES, NAV, readGuide, toMarkdown } from '../lib/docs';

const KIT = join(process.cwd(), '../../packages/signoff-ui');
const manifest = JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { types?: string }>;
};

/** Each entry point with types, and the names it exports, with the doc comment of each. */
const entryPoints = (() => {
  const points = Object.entries(manifest.exports).flatMap(([path, target]) =>
    typeof target === 'object' && target.types
      ? [{ name: path === '.' ? 'signoff-ui' : `signoff-ui/${path.slice(2)}`, file: join(KIT, target.types) }]
      : [],
  );
  const program = ts.createProgram(
    points.map((point) => point.file),
    {
      noEmit: true,
      skipLibCheck: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  );
  const checker = program.getTypeChecker();
  return points.map((point) => {
    const module = checker.getSymbolAtLocation(program.getSourceFile(point.file)!)!;
    const exports = checker.getExportsOfModule(module).map((symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return { name: symbol.name, doc: ts.displayPartsToString(target.getDocumentationComment(checker)).trim() };
    });
    return { name: point.name, exports };
  });
})();

const doc = getGuide('api');
const markdown = doc ? readGuide(doc) : '';
const headings = getHeadings(markdown);

/** A `##` section of the page, by its heading, up to the next `##`. */
function entrySection(name: string) {
  const start = markdown.indexOf(`\n## ${name}\n`);
  if (start === -1) return '';
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

/** A `###` section of an entry point's section, by its heading text. */
function exportSection(entry: string, heading: string) {
  const text = entrySection(entry);
  const start = text.indexOf(`\n### ${heading}\n`);
  if (start === -1) return '';
  const end = text.indexOf('\n### ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** An entry point's "On the component pages" line: the exports a component page documents. */
const componentLine = (entry: string) => /^On the component pages: .*$/m.exec(entrySection(entry))?.[0] ?? '';

/** An export's declaration: a code block, or a paragraph of inline code when it is one line. */
const declarationIn = (section: string) =>
  /```ts\n([\s\S]*?)\n```/.exec(section)?.[1] ?? /^`([^`\n]+)`$/m.exec(section)?.[1] ?? '';

describe('the API index', () => {
  it('is a docs page, in the sidebar', () => {
    assert.ok(doc, 'no guide with the slug "api" in lib/docs.ts');
    assert.ok(
      NAV.some((group) => group.items.some((item) => item.href === doc.href)),
      `${doc.href} is in no sidebar group`,
    );
  });

  it('has a section for each entry point, in package.json order', () => {
    const sections = headings.filter((h) => h.depth === 2).map((h) => h.text);
    assert.deepEqual(
      sections,
      entryPoints.map((point) => point.name),
    );
    assert.ok(entryPoints.length >= 6, `only ${entryPoints.length} entry points`);
  });

  it('lists every export of each entry point, under it, or links where another entry point or a component page has it', () => {
    let listed = 0;
    for (const point of entryPoints) {
      const text = entrySection(point.name);
      const onPages = componentLine(point.name);
      for (const { name } of point.exports) {
        const own =
          text.includes(`\n### ${name}\n`) ||
          text.includes(`\n### ${name} (${point.name})\n`) ||
          onPages.includes(`[\`${name}\`](/docs/components/`);
        const elsewhere = new RegExp(
          `^It also exports (?:everything in \\[\`([^\`]+)\`\\]|these, listed under .*\\[\`${name}\`\\])`,
          'm',
        ).exec(text);
        // "everything in <entry point>": that entry point exports the name too.
        const all =
          elsewhere?.[1] && entryPoints.find((p) => p.name === elsewhere[1])?.exports.some((e) => e.name === name);
        assert.ok(own || (elsewhere && (!elsewhere[1] || all)), `${point.name}: ${name} is not on the page`);
        if (own) listed++;
      }
    }
    // Each export once: 222 when the page was written.
    assert.ok(listed >= 200, `only ${listed} exports listed`);
  });

  it('links the exports a component page documents to it, instead of a section of their own', () => {
    const line = componentLine('signoff-ui');
    for (const [name, href] of [
      ['ApprovalCard', '/docs/components/approval-card#approvalcard'],
      ['ApprovalCardProps', '/docs/components/approval-card#approvalcard'],
      ['useApprovalPolicy', '/docs/components/use-approval-policy#useapprovalpolicy'],
    ]) {
      assert.ok(line.includes(`[\`${name}\`](${href})`), `${name} is not linked to ${href}`);
      assert.ok(!headings.some((h) => h.text === name), `${name} has a section of its own`);
    }
    // signoff-ui/custom-markdown's own components, and what it shares with the main entry.
    const custom = entrySection('signoff-ui/custom-markdown');
    assert.ok(componentLine('signoff-ui/custom-markdown').includes('[`AgentMessage`](/docs/components/agent-message#'));
    assert.match(custom, /^It also exports these, .*\[`AgentMessageProps`\]\(\/docs\/components\/agent-message#/m);
  });

  it('writes a one-line declaration as inline code, and a longer one as a code block', () => {
    const inline = exportSection('signoff-ui/core', 'evaluateRules');
    assert.match(inline, /^`function evaluateRules\([^`\n]+;`$/m);
    assert.ok(!inline.includes('```'), 'evaluateRules has a code block');
    const block = exportSection('signoff-ui/core', 'computeReviewResult');
    assert.match(block, /^```ts\nfunction computeReviewResult\([^\n]*\n {4}/m);
    // Only a declaration of more than one line, or with a backtick in it, gets a code block.
    const blocks = [...markdown.matchAll(/^```ts\n([\s\S]*?)\n```$/gm)].map((match) => match[1]!);
    assert.deepEqual(
      blocks.filter((code) => !/[\n`]/.test(code)),
      [],
    );
  });

  it('shows the declaration and the doc comment of each export it lists', () => {
    for (const point of entryPoints) {
      for (const { name, doc: comment } of point.exports) {
        const own = exportSection(point.name, name) || exportSection(point.name, `${name} (${point.name})`);
        if (!own) continue;
        const code = declarationIn(own);
        assert.match(code, new RegExp(`^(?:function|const|interface|type) ${name}\\b`), `${name}: ${code}`);
        const first = comment.split('\n')[0]!;
        if (first) assert.ok(own.includes(first), `${name}: its doc comment, "${first}", is not on the page`);
      }
    }
  });

  it('names the helpers the changelog calls API, with their declarations', () => {
    for (const name of [
      'evaluateRules',
      'matchesGlob',
      'ruleFromDecision',
      'ruleMatches',
      'memoryRuleStorage',
      'toToolApprovalResponse',
      'isSubagentPart',
      'formatCost',
      'formatTokens',
      'formatDuration',
      'getToolParts',
      'getAllToolParts',
      'createAgUiRun',
      'fromAgUiUsage',
    ]) {
      assert.ok(
        headings.some((h) => h.depth === 3 && h.text === name),
        `${name} has no heading`,
      );
      assert.match(
        declarationIn(entryPoints.map((point) => exportSection(point.name, name)).find(Boolean) ?? ''),
        new RegExp(`^function ${name}\\(`),
        `${name} has no declaration`,
      );
    }
  });

  it('gives every heading an id of its own', () => {
    const ids = headings.map((h) => h.id);
    assert.deepEqual(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      [],
    );
  });

  it('links only to headings, guides and component sections that exist', () => {
    const ids = new Set(headings.map((h) => h.id));
    // Each other guide's headings, by its address.
    const guides = new Map(
      GUIDES.filter((guide) => guide !== doc).map((guide) => [
        guide.href,
        new Set(getHeadings(readGuide(guide)).map((h) => h.id)),
      ]),
    );
    // A component page's sections: one per API entry and listed type (components/docs/component-page.tsx).
    const sections = new Map(
      COMPONENTS.map((c) => [
        componentHref(c.slug),
        new Set([...c.api.map((entry) => entry.name), ...(c.types ?? [])].map((name) => name.toLowerCase())),
      ]),
    );
    const links = [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]!);
    assert.ok(links.length > 100, `only ${links.length} links`);
    for (const link of links) {
      const [path, hash] = link.split('#') as [string, string | undefined];
      if (/^https?:\/\//.test(path)) continue;
      if (path === '') assert.ok(ids.has(hash!), `${link}: no such heading`);
      else if (path.startsWith('/docs/components/')) {
        assert.ok(sections.has(path), `${link}: no such component page`);
        if (hash) assert.ok(sections.get(path)!.has(hash), `${link}: no such section`);
      } else {
        assert.ok(guides.has(path), `${link}: no such guide`);
        if (hash) assert.ok(guides.get(path)!.has(hash), `${link}: no such section`);
      }
    }
  });

  it('is in the page’s Markdown too, for "Copy page", llms-full.txt and Ask', () => {
    const served = toMarkdown(doc!, markdown);
    assert.match(served, /^### evaluateRules$/m);
    assert.ok(!served.includes('<!-- exports:'), 'an exports line was left in');
    assert.ok(served.includes('(https://signoff-ui.vercel.app/docs/components/approval-card#approvalcard)'));
    // Every link absolute, the page's own headings too, as llms-full.txt needs them.
    assert.doesNotMatch(served, /\]\((?!https?:)/);
    assert.ok(served.includes('(https://signoff-ui.vercel.app/docs/api#signoff-uicore)'));
  });

  it('fails the build when the page has no exports line for an entry point, or none at all', () => {
    const site = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'signoff-ui-api-index-'));
    const source = readFileSync(join(site, 'content/docs/api.md'), 'utf8');
    mkdirSync(join(dir, 'content/docs'), { recursive: true });
    const build = (text: string) => {
      writeFileSync(join(dir, 'content/docs/api.md'), text);
      return () => readGuide(doc!);
    };
    // readGuide reads the guide from the working directory, as `next build` runs in the site.
    process.chdir(dir);
    try {
      assert.throws(
        build(source.replace('<!-- exports: signoff-ui/acp -->\n', '')),
        /add a <!-- exports: <entry point> --> line for signoff-ui\/acp$/,
      );
      assert.throws(build(source.replace(/^<!-- exports: .*\n/gm, '')), /line for signoff-ui, signoff-ui\/core, /);
      assert.throws(build(`${source}\n<!-- exports: signoff-ui/vue -->\n`), /has no entry point signoff-ui\/vue$/);
    } finally {
      process.chdir(site);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
