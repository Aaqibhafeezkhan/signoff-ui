/*
 * Every row of a component page's API tables says what it is for: the props, a hook's options and
 * what it returns, and the types the page lists. Read with the site's own generator (lib/api.ts),
 * from the published declarations, so it is what an app's editor shows too. Needs the library
 * built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getInterface, getType, type InterfaceDoc } from '../lib/api';
import { COMPONENTS, type ComponentDoc } from '../lib/components';

/** The pages held to it: a page joins once every row on it has a description. */
const DESCRIBED = ['diff-review', 'use-diff-review', 'approval-card'];

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

describe('the API tables', () => {
  for (const slug of DESCRIBED) {
    it(`describe every row on the ${slug} page`, () => {
      const page = COMPONENTS.find((c) => c.slug === slug);
      assert.ok(page, `no component page ${slug}`);
      const blank = tables(page).flatMap(([owner, doc]) =>
        doc.props.filter((prop) => !prop.description).map((prop) => `${owner}.${prop.name}`),
      );
      assert.deepEqual(blank, [], 'rows with no description: give them JSDoc in packages/signoff-ui/src');
    });
  }

  it('show a default written as @default, where no parameter list has it', () => {
    // A hook's options are read from their interface alone: the Default column is their @default.
    const options = getInterface('UseDiffReviewOptions').props;
    assert.equal(options.find((prop) => prop.name === 'context')?.defaultValue, '3');
    // DiffReview hands maxEditLength on to useDiffReview without a default of its own.
    const props = getInterface('DiffReviewProps', { file: 'diff-review.tsx', functions: ['DiffReview'] }).props;
    assert.equal(props.find((prop) => prop.name === 'maxEditLength')?.defaultValue, '2000');
  });
});
