/*
 * CopilotKit on /docs/ag-ui: most AG-UI frontends are CopilotKit apps, and the README's AG-UI
 * badge sends them to that page. It tells them to keep CopilotKit's hooks (useAgUiAgent is for apps
 * without it), and its snippet imports only what signoff-ui exports and names the CopilotKit
 * version it ran with. Needs the library built (pnpm build:lib).
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as kit from 'signoff-ui';
import { getGuide, getHeadings, readGuide } from '../lib/docs';

const markdown = readGuide(getGuide('ag-ui')!);
const HEADING = 'Using CopilotKit?';

/** The text under a `##` heading, up to the next one. */
function section(heading: string) {
  return markdown.split(/^## /m).find((part) => part.startsWith(`${heading}\n`)) ?? '';
}

/** What a `from '<module>'` import in the code takes, by name. */
function imported(code: string, module: string) {
  const names = new RegExp(`import \\{([^}]*)\\} from '${module}';`).exec(code)?.[1] ?? '';
  return names
    .split(',')
    .map((name) => name.replace(/^\s*type\s+/, '').trim())
    .filter(Boolean);
}

describe('/docs/ag-ui for CopilotKit apps', () => {
  const text = section(HEADING);
  const code = /```tsx[^\n]*\n([\s\S]*?)```/.exec(text)?.[1] ?? '';

  it('has a section for them, linked from the top of the page', () => {
    const id = getHeadings(markdown).find((h) => h.text === HEADING)?.id;
    assert.ok(id, `no "## ${HEADING}" heading`);
    const intro = markdown.slice(0, markdown.indexOf('\n## '));
    assert.ok(intro.includes(`(/docs/ag-ui#${id})`), `the intro doesn't link to #${id}`);
  });

  it('keeps CopilotKit’s hooks, and leaves useAgUiAgent to apps without CopilotKit', () => {
    assert.match(text, /`useAgUiAgent`[^.]*without/);
    assert.ok(imported(code, '@copilotkit/react-core/v2').includes('useHumanInTheLoop'), code);
    assert.doesNotMatch(code, /signoff-ui\/ag-ui/);
  });

  it('imports only what signoff-ui exports', () => {
    const names = imported(code, 'signoff-ui');
    assert.ok(names.length > 0, 'the snippet imports nothing from signoff-ui');
    for (const name of names) assert.ok(name in kit, `signoff-ui exports no ${name}`);
  });

  it('names the CopilotKit version it was tested with', () => {
    assert.match(text, /[Tt]ested with `@copilotkit\/react-core` and `@copilotkit\/runtime` \d+\.\d+\.\d+/);
  });

  it('says the render is registered once, so a value it closes over goes in its deps', () => {
    assert.match(text, /registers the tool and its `render` once/);
    assert.match(text, /`\[policy\.rules, policy\.ready\]`/);
  });
});
