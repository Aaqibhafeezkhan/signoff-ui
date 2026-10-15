// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decisionsFromAcpOptions, toAcpPermissionResponse, type AcpPermissionOption } from '../src/lib/policy';

/*
 * The ACP page's card names a single allow_always option in its description, never on the button,
 * and has no reason field, since ACP's response has none: acp.test.tsx renders a card the same way
 * (DocsCard), and acp-docs-transport.test.tsx runs the page's own code. Its words on
 * toAcpPermissionResponse are checked against what the function does.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const page = readFileSync(join(root, 'examples/playground/content/docs/acp.md'), 'utf8');
const card = /```tsx title="components\/acp-turn\.tsx"\n([\s\S]*?)```/.exec(page)?.[1] ?? '';
const response = page.split('\n\n').find((p) => p.startsWith('`toAcpPermissionResponse(decision, options)`')) ?? '';

describe('the ACP page', () => {
  it("names a single allow_always option in the card's description, not on the button", () => {
    expect(card).toContain(
      "const always = decisions.includes('allow-always')\n          ? permission.options.find((o) => o.kind === 'allow_always')?.name",
    );
    expect(card).toContain('description={always ? `Always: ${always}` : undefined}');
    expect(card).not.toMatch(/allowAlways\b/);
  });

  it('turns off the reason field: ACP has no field for a denial reason', () => {
    expect(card).toContain('allowReason={false}');
  });

  it('says a kind the agent sent several options of is canceled, as toAcpPermissionResponse does', () => {
    expect(response).toContain('With no option of that kind, or several, the request is canceled');
    const options: AcpPermissionOption[] = [
      { optionId: 'once', name: 'Yes', kind: 'allow_once' },
      { optionId: 'auto', name: 'Yes, and use auto mode', kind: 'allow_always' },
      { optionId: 'bypass', name: 'Yes, and bypass permissions', kind: 'allow_always' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
      { optionId: 'no-2', name: 'No, and tell the agent why', kind: 'reject_once' },
    ];
    expect(toAcpPermissionResponse('allow-always', options)).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(decisionsFromAcpOptions(options)).not.toContain('allow-always');
    // Deny is the exception the page names: the first of several reject_once options.
    expect(response).toContain('with several `reject_once` options it answers the first');
    expect(toAcpPermissionResponse('deny-once', options)).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
  });
});
