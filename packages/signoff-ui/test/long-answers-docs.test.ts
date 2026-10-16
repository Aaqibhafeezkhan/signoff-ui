// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * Long streamed answers: the end of the text, or all of it, is parsed again on every delta, and the
 * docs say how to parse it less often, with useChat's throttle. The option is checked against the
 * @ai-sdk/react the docs' snippets are typechecked with (the playground's), so the advice can't
 * outlive the option.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const doc = (page: string) => readFileSync(join(root, 'examples/playground/content/docs', `${page}.md`), 'utf8');

/** A page's section, from its `## ` heading to the next one. */
function section(markdown: string, heading: string) {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

/** The names of the properties `UseChatOptions` declares, read from @ai-sdk/react's types. */
function useChatOptions() {
  const require = createRequire(join(root, 'examples/playground/package.json'));
  const folder = dirname(require.resolve('@ai-sdk/react/package.json'));
  const { types } = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { types: string };
  const source = ts.createSourceFile('index.d.ts', readFileSync(join(folder, types), 'utf8'), ts.ScriptTarget.Latest);
  const alias = source.statements.find(
    (node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === 'UseChatOptions',
  );
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertySignature(node)) names.push(node.name.getText(source));
    ts.forEachChild(node, visit);
  };
  if (alias) visit(alias.type);
  return names;
}

describe('long streamed answers', () => {
  const bullet =
    section(doc('limits'), 'Known limitations')
      .split('\n')
      .find((line) => line.startsWith('- **Markdown cost while streaming.**')) ?? '';

  it("names useChat's throttle where Known limitations gives the cost of parsing on every delta", () => {
    expect(bullet).toContain('parsed again on every delta');
    expect(bullet).toContain('`useChat({ throttle: 50 })`');
    // AI SDK 6's @ai-sdk/react (3.x) has only the experimental name.
    expect(bullet).toContain('`experimental_throttle` in AI SDK 6');
  });

  it('says so in the walkthrough too, linking to the limitation', () => {
    const walkthrough = section(doc('getting-started'), 'Render a run');
    const paragraph = walkthrough.split('\n').find((line) => line.includes('`throttle: 50`')) ?? '';
    expect(paragraph).toContain('`useChat`');
    expect(paragraph).toContain('(/docs/limits#known-limitations)');
  });

  it("is an option of AI SDK 7's useChat", () => {
    const names = useChatOptions();
    expect(names).toContain('throttle');
    expect(names).toContain('experimental_throttle');
  });
});
