// Runs axe-core in real Chrome against the playground, across the run's states (approval
// pending, diff review, done), the components page, the docs and a phone viewport, in the dark theme and
// then the light one.
// Unlike the jsdom tests, this checks color contrast with real layout.
//
//   pnpm build:lib && pnpm registry:build && pnpm build:playground
//   pnpm a11y   # starts the built playground on :3230, or audits BASE_URL if set
//   BASE_URL=http://localhost:3100 pnpm a11y   # the one `pnpm dev` serves
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 3230;
const BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`;

let server;
if (!process.env.BASE_URL) {
  server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
    cwd: join(import.meta.dirname, '../examples/playground'),
    stdio: 'inherit',
    detached: true,
  });
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      if (attempt > 60) throw new Error(`The playground did not start on ${BASE}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const require = createRequire(join(import.meta.dirname, '../packages/signoff-ui/package.json'));
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch({ channel: 'chrome' });
let failures = 0;

async function audit(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  });
  failures += violations.length;
  console.log(`${violations.length === 0 ? 'pass' : 'FAIL'}  ${label}`);
  for (const v of violations) console.log(`      ${v.id} (${v.impact}): ${v.nodes.slice(0, 3).join(', ')}`);
}

const pending = '[data-slot="signoff-approval-card"][data-status="pending"]';
// Let enter animations settle so contrast is measured at full opacity.
const settle = (page) => page.waitForTimeout(800);

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await page.goto(`${BASE}/?speed=4`, { waitUntil: 'networkidle' });
await page.waitForSelector(pending, { timeout: 60_000 });
await settle(page);
await audit(page, 'playground · approval pending');
// The run started on load, so its card doesn't take focus: go to it, then approve.
await page.focus(pending);
await page.keyboard.press('y');
await page.waitForSelector('[data-slot="signoff-diff-submit"]', { timeout: 60_000 });
await settle(page);
await page.keyboard.press('a');
await page.keyboard.press('r');
await audit(page, 'playground · diff review');
await page.keyboard.press('Control+Enter');
await page.getByText('Run complete').waitFor({ timeout: 60_000 });
await settle(page);
await audit(page, 'playground · done');
await page.goto(`${BASE}/components`, { waitUntil: 'networkidle' });
await settle(page);
await audit(page, 'components page (dark, light and custom themes)');
for (const path of [
  '/docs',
  '/docs/getting-started',
  '/docs/chat-ui',
  '/docs/ag-ui',
  '/docs/acp',
  '/docs/accessibility',
  '/docs/labels',
  '/docs/limits',
  '/docs/comparison',
  '/docs/migrating-from-agent-ui-kit',
  '/docs/components/approval-card',
  '/docs/components/use-approval-policy',
  '/docs/components/diff-review',
  '/docs/components/use-diff-review',
  '/docs/components/run-meter',
  '/docs/components/use-ag-ui-agent',
  // No such page: the 404.
  '/docs/theming',
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(page);
  await audit(page, `docs ${path}`);
}
// A review mid-way: lines selected in a hunk, a comment being written, a file marked viewed.
await page.goto(`${BASE}/docs/components/diff-review`, { waitUntil: 'networkidle' });
await page.locator('[data-slot="signoff-diff-hunk"]').nth(1).focus();
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('c');
await page.keyboard.type('Keep the existing error format.');
await page.locator('[data-slot="signoff-diff-file"] input[type="checkbox"]').last().check();
await settle(page);
await audit(page, 'docs /docs/components/diff-review · lines selected, a comment being written');
// Approval rules at work: a rule made, a call it answers, two at once, and arguments being edited.
await page.goto(`${BASE}/docs/components/use-approval-policy`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'two at once' }).click();
await page.locator('[data-slot="signoff-approval-batch"]').first().waitFor();
await settle(page);
await audit(page, 'docs /docs/components/use-approval-policy · two approvals waiting, with Approve all');
await page.getByRole('button', { name: 'Approve all' }).click();
await page.getByRole('button', { name: 'npm test', exact: true }).click();
await page.getByRole('button', { name: 'For this session', exact: true }).click();
await page.getByRole('button', { name: 'npm test -- --watch', exact: true }).click();
await page.locator('main [data-slot="signoff-approval-card"]', { hasText: 'Allowed by your rule' }).waitFor();
await settle(page);
await audit(page, 'docs /docs/components/use-approval-policy · a session rule, and a call it answered');
await page.goto(`${BASE}/docs/components/approval-card`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Edit arguments' }).first().click();
await settle(page);
await audit(page, 'docs /docs/components/approval-card · editing arguments');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/?speed=4`, { waitUntil: 'networkidle' });
await page.waitForSelector(pending, { timeout: 60_000 });
await settle(page);
await audit(page, 'playground · 390px viewport');
await page.goto(`${BASE}/docs/getting-started`, { waitUntil: 'networkidle' });
await settle(page);
await audit(page, 'docs /docs/getting-started · 390px viewport');
await page.goto(`${BASE}/docs/components/tool-call-timeline`, { waitUntil: 'networkidle' });
await settle(page);
await audit(page, 'docs /docs/components/tool-call-timeline · 390px viewport');
// A sub-agent open under the call that started it, its calls nested.
await page
  .locator('main')
  .getByRole('button', { name: /^Researcher/ })
  .first()
  .click();
await settle(page);
await audit(page, 'docs /docs/components/tool-call-timeline · a sub-agent open, 390px viewport');
// Under 30rem a review wraps its lines, so axe measures each one, the rejected hunk's too.
for (const path of ['/docs/components/diff-review', '/components']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(page);
  await audit(page, `${path} · a rejected hunk, 390px viewport`);
}

// The light theme, with a light OS: the site follows it until the reader picks.
const light = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
await light.goto(`${BASE}/?speed=4`, { waitUntil: 'networkidle' });
await light.waitForSelector(pending, { timeout: 60_000 });
await settle(light);
await audit(light, 'light · playground · approval pending');
for (const path of ['/components', '/docs/getting-started', '/docs/components/diff-review']) {
  await light.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(light);
  await audit(light, `light · ${path}`);
}
await light.setViewportSize({ width: 390, height: 844 });
await light.goto(`${BASE}/docs/components/approval-card`, { waitUntil: 'networkidle' });
await settle(light);
await audit(light, 'light · /docs/components/approval-card · 390px viewport');
for (const path of ['/docs/components/diff-review', '/components']) {
  await light.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await settle(light);
  await audit(light, `light · ${path} · a rejected hunk, 390px viewport`);
}
await browser.close();
if (server) process.kill(-server.pid);

if (failures > 0) {
  console.error(`\n${failures} violation type(s) found.`);
  process.exit(1);
}
console.log('\nNo axe violations.');
