/*
 * Every row of a component page's API tables says what it is for: the props, a hook's options and
 * what it returns, and the types the page lists. Read with the site's own generator (lib/api.ts),
 * from the published declarations, so it is what an app's editor shows too. The `@default` tags
 * the Default column falls back to are written by hand, so each is checked against the code that
 * sets the default. Needs the library built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as kit from 'signoff-ui/core';
import { getInterface, getType, sourceDefaults, type InterfaceDoc } from '../lib/api';
import { COMPONENTS, type ComponentDoc } from '../lib/components';

/**
 * The pages held to it: a page joins once every row on it has a description and every default its
 * code sets is an `@default` tag.
 */
const DESCRIBED = ['diff-review', 'use-diff-review', 'approval-card', 'use-approval-policy'];

/**
 * Props a component hands on to a hook without a default of its own: their `@default` tag is
 * checked against the hook's parameter list.
 */
const PASSED_ON: Record<string, { file: string; functions: string[] }> = {
  DiffReviewProps: { file: 'use-diff-review.ts', functions: ['useDiffReview'] },
};

const SRC = join(process.cwd(), '../../packages/signoff-ui/src');

const page = (slug: string) => {
  const found = COMPONENTS.find((c) => c.slug === slug);
  assert.ok(found, `no component page ${slug}`);
  return found;
};

/** A page's API tables, as the page builds them, by the name each is listed under. */
function tables(page: ComponentDoc): Array<[string, InterfaceDoc]> {
  const out: Array<[string, InterfaceDoc]> = [];
  for (const entry of page.api) {
    if (entry.props) out.push([entry.name, getInterface(entry.props, entry.defaults)]);
    if (entry.parameters) out.push([entry.parameters, getInterface(entry.parameters)]);
    if (entry.returns) out.push([entry.returns, getInterface(entry.returns)]);
  }
  for (const name of page.types ?? []) {
    const type = getType(name);
    if (type.kind === 'interface') out.push([name, type]);
  }
  return out;
}

/**
 * A page's interfaces that have defaults, with the parameter lists that set them: a component's
 * props, the props it hands on to a hook, and a hook's options (the hook in the page's file).
 */
function defaulted(page: ComponentDoc): Array<[string, { file: string; functions: string[] }]> {
  const out: Array<[string, { file: string; functions: string[] }]> = [];
  for (const entry of page.api) {
    if (entry.props && entry.defaults) out.push([entry.props, entry.defaults]);
    if (entry.props && PASSED_ON[entry.props]) out.push([entry.props, PASSED_ON[entry.props]!]);
    if (entry.parameters) out.push([entry.parameters, { file: page.file, functions: [entry.name] }]);
  }
  return out;
}

/** A value as the source writes it: `'Approve'`, `['allow-once', 'deny-once']`, `2000`. */
function written(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map(written).join(', ')}]`;
  return String(value);
}

/** A literal default, ready to compare: `2_000` reads `2000`. */
const literal = (text: string) => text.trim().replace(/(\d)_(?=\d)/g, '$1');

/**
 * What a parameter list's default comes to: a literal as written, a constant (`DEFAULT_DECISIONS`)
 * at its value, from `signoff-ui/core` or the same file. `undefined` for anything else, such as a
 * function it falls back to (`defaultDiffWorker`), which the description gives in words.
 */
function codeDefault(code: string, file: string): string | undefined {
  if (/^[A-Z][A-Z0-9_]*$/.test(code)) {
    const exported = (kit as Record<string, unknown>)[code];
    if (exported !== undefined) return written(exported);
    const local = new RegExp(`const ${code}\\b[^=]*=\\s*([^;]+);`).exec(readFileSync(join(SRC, file), 'utf8'));
    assert.ok(local, `${code}, a default in src/${file}: export it from signoff-ui/core or define it in that file`);
    return literal(local[1]!);
  }
  const isLiteral = /^(?:true|false|null|-?\d[\d_]*(?:\.\d+)?|'[^']*'|"[^"]*"|\[[^\]]*\])$/.test(code);
  return isLiteral ? literal(code) : undefined;
}

describe('the API tables', () => {
  for (const slug of DESCRIBED) {
    it(`describe every row on the ${slug} page`, () => {
      const blank = tables(page(slug)).flatMap(([owner, doc]) =>
        doc.props.filter((prop) => !prop.description).map((prop) => `${owner}.${prop.name}`),
      );
      assert.deepEqual(blank, [], 'rows with no description: give them JSDoc in packages/signoff-ui/src');
    });

    it(`give each default on the ${slug} page as an @default tag with the code's value`, () => {
      const drift: string[] = [];
      // A prop the component sets a default for itself is held to that one, not the hook's.
      const checked = new Set<string>();
      for (const [name, from] of defaulted(page(slug))) {
        const listed = sourceDefaults(from.file, from.functions);
        // Without a parameter list, getInterface's Default column is the @default tag alone.
        for (const prop of getInterface(name).props) {
          const code = listed.get(prop.name);
          const value = code === undefined ? undefined : codeDefault(code, from.file);
          if (value === undefined || checked.has(`${name}.${prop.name}`)) continue;
          checked.add(`${name}.${prop.name}`);
          if (prop.defaultValue !== value)
            drift.push(
              `${name}.${prop.name}: @default ${prop.defaultValue ?? '(none)'}, ${from.functions[0]} sets ${value}`,
            );
        }
      }
      assert.deepEqual(drift, [], "write the default the code sets as the prop's @default tag");
    });
  }

  it('give a label default as the English label it names', () => {
    // "Without one, the card uses `labels.approvalCard.approve`": the tag is that label's text.
    const labels = kit.defaultLabels as unknown as Record<string, Record<string, unknown>>;
    const checked: string[] = [];
    const drift: string[] = [];
    for (const slug of DESCRIBED) {
      for (const [owner, doc] of tables(page(slug))) {
        for (const prop of doc.props) {
          const named = /uses `labels\.(\w+)\.(\w+)`/.exec(prop.description);
          if (!named) continue;
          const label = labels[named[1]!]?.[named[2]!];
          assert.equal(typeof label, 'string', `${owner}.${prop.name} names labels.${named[1]}.${named[2]}`);
          checked.push(`${owner}.${prop.name}`);
          if (prop.defaultValue !== written(label))
            drift.push(
              `${owner}.${prop.name}: @default ${prop.defaultValue ?? '(none)'}, the label reads ${written(label)}`,
            );
        }
      }
    }
    assert.deepEqual(drift, []);
    // The label defaults these pages give: the review's title and the approval card's three.
    assert.ok(checked.length >= 4, `checked ${checked.join(', ')}`);
  });

  it('show a default written as @default, where no parameter list has it', () => {
    // A hook's options are read from their interface alone: the Default column is their @default.
    const options = getInterface('UseDiffReviewOptions').props;
    assert.equal(options.find((prop) => prop.name === 'context')?.defaultValue, '3');
    // DiffReview hands maxEditLength on to useDiffReview without a default of its own.
    const props = getInterface('DiffReviewProps', { file: 'diff-review.tsx', functions: ['DiffReview'] }).props;
    assert.equal(
      props.find((prop) => prop.name === 'maxEditLength')?.defaultValue,
      String(kit.DEFAULT_MAX_EDIT_LENGTH),
    );
  });
});
