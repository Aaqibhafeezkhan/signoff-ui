// Checks the built playground: link preview metadata and llms.txt, then in Chrome what a visitor
// sees first on a phone, what the header offers when it was built without a model key
// (OPENAI_API_KEY, as in CI), the phone menu, the docs shell, and the components page.
//
//   pnpm build:lib && pnpm registry:build && pnpm build:playground
//   pnpm smoke:playground   # starts the built playground on :3220, or tests BASE_URL if set
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 3220;
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

const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
const check = (ok, label, detail = '') => {
  failed ||= !ok;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}${ok || !detail ? '' : `: ${detail}`}`);
};

try {
  // Link previews: each page has its title, description and a 1200×630 image that is served.
  for (const [path, title] of [
    ['/', 'signoff-ui: review what your agent changed and approve what it may do'],
    ['/components', 'Components · signoff-ui'],
    ['/docs/getting-started', 'Getting started · signoff-ui docs'],
    ['/docs/components/approval-card', 'ApprovalCard · signoff-ui docs'],
  ]) {
    const html = await (await fetch(BASE + path)).text();
    const meta = (key) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
    const image = meta('og:image');
    const served = image ? await fetch(BASE + new URL(image).pathname + new URL(image).search) : undefined;
    check(
      meta('og:title') === title &&
        !!meta('og:description') &&
        meta('twitter:card') === 'summary_large_image' &&
        served?.headers.get('content-type') === 'image/png',
      `${path}: Open Graph and Twitter metadata with an image`,
      `og:title ${meta('og:title')}, og:image ${image} (${served?.status})`,
    );
  }

  // Every page in the sitemap, which robots.txt points to.
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check(
    ['/docs/getting-started', '/docs/components/approval-card', '/components'].every((path) =>
      sitemap.includes(`https://signoff-ui.vercel.app${path}</loc>`),
    ) && robots.includes('Sitemap: https://signoff-ui.vercel.app/sitemap.xml'),
    'sitemap.xml lists the docs and components, and robots.txt points to it',
  );

  // Each page has its own canonical address and a description short enough for search results.
  const decode = (text) =>
    text
      .replace(/&amp;/g, '&')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<');
  const metaOf = (html, key) =>
    decode(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1] ?? '') || undefined;
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const offPage = [];
  for (const url of pages) {
    const html = await (await fetch(BASE + new URL(url).pathname)).text();
    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
    const description = metaOf(html, 'description') ?? '';
    if (canonical !== url || !description || description.length > 160) {
      offPage.push(`${url}: canonical ${canonical}, description ${description.length} characters`);
    }
  }
  check(
    pages.length > 20 && offPage.length === 0,
    'every page: its own canonical address and a description of 160 characters or fewer',
    offPage.join('; '),
  );

  // Sitemap dates come from git: none is later than the commit the site was built from (the build's
  // own time always is). A shallow clone leaves out the dates it can't know.
  const head = new Date(
    execFileSync('git', ['log', '-1', '--format=%cI'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim(),
  );
  const dates = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => new Date(match[1]));
  check(
    dates.every((date) => date <= head),
    'sitemap.xml: each page dated by its last commit, never by the build',
    dates.map((date) => date.toISOString()).join(', '),
  );

  // The header's stars and the footer's downloads are fetched fresh by each build (no-store, rather
  // than from a data cache that outlives the deployment), and the pages stay static all the same:
  // never regenerated on a server with no git history for the docs' "Last updated" dates.
  const playground = join(import.meta.dirname, '../examples/playground');
  const statsSource = readFileSync(join(playground, 'lib/stats.ts'), 'utf8');
  const layoutSource = readFileSync(join(playground, 'app/layout.tsx'), 'utf8');
  const regenerated = process.env.BASE_URL
    ? []
    : Object.entries(JSON.parse(readFileSync(join(playground, '.next/prerender-manifest.json'), 'utf8')).routes)
        .filter(([, route]) => route.initialRevalidateSeconds !== false)
        .map(([path, route]) => `${path} ${route.initialRevalidateSeconds}`);
  check(
    statsSource.includes("cache: 'no-store'") &&
      !/revalidate/.test(statsSource) &&
      layoutSource.includes("export const dynamic = 'force-static';") &&
      regenerated.length === 0,
    'the stars and downloads are fetched by each build (no-store), and every page stays static',
    regenerated.join(', '),
  );

  // The home page describes the project for search engines (schema.org), with this version.
  const kit = JSON.parse(readFileSync(join(import.meta.dirname, '../packages/signoff-ui/package.json'), 'utf8'));
  const homeHtml = await (await fetch(`${BASE}/`)).text();
  const ld = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(homeHtml)?.[1];
  const structured = ld ? JSON.parse(ld) : {};
  check(
    structured['@type'] === 'SoftwareSourceCode' &&
      structured.version === kit.version &&
      structured.codeRepository === 'https://github.com/dgesteves/signoff-ui',
    'home: JSON-LD SoftwareSourceCode with the version and the repository',
    ld?.slice(0, 160),
  );

  // Docs for LLMs, built from the README, the docs and the registry: no HTML, and every component described
  // in words (its screenshot's indented <source srcset> lines once stood in for the description).
  for (const [path, heading] of [
    ['/llms.txt', '## Components'],
    ['/llms-full.txt', '## shadcn registry items'],
  ]) {
    const response = await fetch(BASE + path);
    const text = await response.text();
    // Code shows JSX and element names, which is fine; the prose around it has no HTML.
    const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const html = /<\/?(?:img|picture|source|p|div|br)\b[^>]*>/.exec(prose)?.[0];
    check(
      response.ok &&
        response.headers.get('content-type')?.startsWith('text/plain') &&
        text.startsWith('# signoff-ui\n') &&
        text.includes(heading) &&
        !html &&
        !/\]\((?!https?:)/.test(text),
      `${path}: plain markdown with absolute links`,
      `${response.status} ${response.headers.get('content-type')}${html ? `, HTML: ${html}` : ''}`,
    );
  }
  const llms = await (await fetch(`${BASE}/llms.txt`)).text();
  const components = llms.slice(llms.indexOf('## Components'), llms.indexOf('## Optional')).match(/^- .+$/gm) ?? [];
  const undescribed = components.filter((line) => !/^- `\w+`: [^\s<][^<]*\.$/.test(line));
  check(
    components.length >= 7 && undescribed.length === 0,
    '/llms.txt: each component has a sentence of its own',
    undescribed.join(' | ') || `${components.length} components`,
  );

  // The docs as an MCP server for agents, with no model key: initialize, the three tools, and a
  // search that finds the section that answers, at its address on the site.
  const mcp = async (id, method, params) => {
    const response = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
    });
    const text = await response.text();
    const data = text.startsWith('{') ? text : (/^data: (.+)$/m.exec(text)?.[1] ?? '{}');
    return { status: response.status, ...JSON.parse(data) };
  };
  const initialized = await mcp(1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'smoke-playground', version: '0' },
  });
  const tools = await mcp(2, 'tools/list');
  const searched = await mcp(3, 'tools/call', {
    name: 'search',
    arguments: { query: 'approve a tool call for the whole session' },
  });
  const searchResults = JSON.parse(searched.result?.content?.[0]?.text ?? '{}').results ?? [];
  check(
    initialized.status === 200 &&
      initialized.result?.serverInfo?.name === 'signoff-ui' &&
      ['search', 'fetch', 'list_pages'].every((name) => tools.result?.tools?.some((tool) => tool.name === name)) &&
      searchResults[0]?.url?.startsWith('https://signoff-ui.vercel.app/docs/components/approval-card#'),
    '/api/mcp: initialize, the search, fetch and list_pages tools, and a search that finds ApprovalCard',
    `${initialized.status} ${tools.result?.tools?.map((tool) => tool.name).join(', ')} · ${searchResults[0]?.url}`,
  );

  // Without OPENAI_API_KEY (as in CI) there is no Ask: the endpoint answers 404, and no page has the button.
  const askResponse = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How do I install it?' }),
  });
  const askButtons = await Promise.all(
    ['/', '/docs', '/components'].map(async (path) =>
      (await (await fetch(BASE + path)).text()).includes('data-ask-trigger'),
    ),
  );
  check(
    askResponse.status === 404 && askButtons.every((shown) => !shown),
    'no model key: /api/ask answers 404, and no page shows the Ask button',
    `${askResponse.status}, ${askButtons.join(', ')}`,
  );

  // The docs home says how to add the MCP server to an agent; llms.txt names it too.
  const docsHome = await (await fetch(`${BASE}/docs`)).text();
  const llmsTxt = await (await fetch(`${BASE}/llms.txt`)).text();
  check(
    docsHome.includes('id="use-these-docs-from-your-agent"') &&
      [
        'https://cursor.com/en/install-mcp?name=signoff-ui',
        'https://insiders.vscode.dev/redirect/mcp/install?name=signoff-ui',
        'https://claude.ai/customize/connectors?modal=add-custom-connector&amp;connectorName=signoff-ui',
      ].every((text) => docsHome.includes(text)) &&
      // The command is highlighted on the page, so it is read from the page's Markdown.
      (await (await fetch(`${BASE}/docs.md`)).text()).includes(
        'claude mcp add --transport http signoff-ui https://signoff-ui.vercel.app/api/mcp',
      ) &&
      llmsTxt.includes('(https://signoff-ui.vercel.app/api/mcp)'),
    'docs home: "Use these docs from your agent" with the Cursor, VS Code, Claude and Claude Code installs; llms.txt has the MCP server',
  );

  // Each docs page is also Markdown at its URL plus .md, for "Copy page" and coding agents.
  for (const [path, heading] of [
    ['/docs.md', '# Introduction\n'],
    ['/docs/getting-started.md', '# Getting started\n'],
    ['/docs/ag-ui.md', '# AG-UI agents\n'],
    ['/docs/components/approval-card.md', '# ApprovalCard\n'],
  ]) {
    const response = await fetch(BASE + path);
    const text = await response.text();
    check(
      response.ok && response.headers.get('content-type')?.startsWith('text/markdown') && text.startsWith(heading),
      `${path}: the page as Markdown`,
      `${response.status} ${response.headers.get('content-type')}`,
    );
  }

  // An address with no page: a 404 titled as one, with the docs' navigation to get back.
  const unknown = await fetch(`${BASE}/docs/theming`);
  const unknownHtml = await unknown.text();
  const robotsTags = unknownHtml.match(/<meta name="robots"[^>]*>/g) ?? [];
  check(
    unknown.status === 404 &&
      unknownHtml.includes('<title>Page not found · signoff-ui</title>') &&
      robotsTags.length === 1 &&
      robotsTags[0].includes('content="noindex"') &&
      metaOf(unknownHtml, 'description') === 'There is no page at this address.' &&
      !/<link rel="canonical"|<meta property="og:(?:image|url|description)"|<meta name="twitter:image"/.test(
        unknownHtml,
      ) &&
      ['/docs/getting-started', '/docs/components/diff-review', '/components'].every((path) =>
        unknownHtml.includes(`href="${path}"`),
      ),
    'an unknown address: a 404 titled "Page not found", not indexed (one robots tag), with no canonical or preview of the home page, and the docs navigation',
    `${unknown.status}, ${robotsTags.join(' ')}`,
  );
  // The preview image of a docs or component page that doesn't exist: a 404, not a server error.
  const missingImages = await Promise.all(
    ['/docs/theming/opengraph-image', '/docs/components/nope/opengraph-image'].map(
      async (path) => `${path} ${(await fetch(BASE + path)).status}`,
    ),
  );
  check(
    missingImages.every((line) => line.endsWith(' 404')),
    "an unknown docs or component page's preview image answers 404",
    missingImages.join(', '),
  );

  // Component pages document props from the package's own types: ApprovalCard's toolName is a
  // required string, risk has no default, allowReason defaults to true, and approveLabel says which
  // label it defaults to (the page and its Markdown share the source).
  const card = await (await fetch(`${BASE}/docs/components/approval-card.md`)).text();
  check(
    card.includes('| `toolName` (required) | `string` |') &&
      /\| `risk` \| `RiskLevel` \| {2}\|/.test(card) &&
      /\| `allowReason` \| `boolean` \| `true` \|/.test(card) &&
      /\| `approveLabel` \| `string` \| {2}\| The approve button's text\. Default "Approve"/.test(card),
    'docs: props tables come from the types, with defaults from the source',
    card
      .split('\n')
      .filter((line) => /`(risk|approveLabel)`/.test(line))
      .join('\n'),
  );

  // Security headers on every response, and the favicon browsers ask for at /favicon.ico.
  const home = await fetch(`${BASE}/`);
  const favicon = await fetch(`${BASE}/favicon.ico`);
  check(
    home.headers.get('x-content-type-options') === 'nosniff' &&
      home.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' &&
      home.headers.get('x-frame-options') === 'DENY' &&
      !home.headers.has('x-powered-by') &&
      favicon.ok &&
      favicon.headers.get('content-type') === 'image/x-icon',
    'security headers, and /favicon.ico',
    `${[...home.headers].filter(([key]) => /^(x-|referrer)/.test(key)).join('; ')}; favicon ${favicon.status} ${favicon.headers.get('content-type')}`,
  );

  // The docs search finds sections, not only pages, by what they say, and every option and prop.
  const docs = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await docs.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
  await docs.keyboard.press('ControlOrMeta+k');
  const search = async (query) => {
    await docs.keyboard.press('ControlOrMeta+a');
    await docs.keyboard.type(query);
    const results = docs.getByRole('list', { name: 'Search results' });
    await results.waitFor({ timeout: 10_000 }).catch(() => {});
    return results
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => `${a.getAttribute('href')} ${a.innerText}`));
  };
  const found = await search('theme');
  check(
    found.some((text) => text.includes('Theming')),
    'docs: ⌘K focuses the search, and "theme" finds Theming',
    found.join(', '),
  );
  const darkMode = await search('dark mode');
  const tailwind3 = await search('tailwind v3');
  const storage = await search('storage');
  check(
    darkMode.some((text) => text.startsWith('/docs/getting-started#')) &&
      tailwind3.some((text) => text.startsWith('/docs/getting-started#')) &&
      storage.some((text) => text.startsWith('/docs/components/use-approval-policy#useapprovalpolicyoptions-storage')),
    'docs search: "dark mode" and "tailwind v3" find Getting started, "storage" finds useApprovalPolicy\'s option',
    [darkMode[0], tailwind3[0], storage.find((text) => text.includes('storage'))].join(' | '),
  );
  // Without Ask (no model key, as here), / is not bound: no single-key shortcut on the page (WCAG
  // 2.1.4). On a site with Ask, which takes ⌘K, the search takes / instead.
  await docs.evaluate(() => document.activeElement?.blur());
  await docs.keyboard.press('/');
  check(
    !(await docs.evaluate(() => document.activeElement?.hasAttribute('data-docs-search') ?? false)),
    'docs without Ask: / does not focus the search, only ⌘K does',
  );
  await docs.close();

  // The search box shows the reader's own shortcut, ⌘K on a Mac and Ctrl K elsewhere, set once the
  // page has hydrated, with no hydration mismatch.
  for (const [platform, label] of [
    ['MacIntel', '⌘K'],
    ['Win32', 'Ctrl K'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript((value) => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => value });
    }, platform);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    const shown = await page.getByRole('navigation', { name: 'Docs' }).locator('kbd').textContent();
    const mismatch = errors.filter((text) => /hydrat/i.test(text));
    check(
      shown === label && mismatch.length === 0,
      `docs on ${platform}: the search box shows ${label}`,
      `${shown}${mismatch.length ? `, ${mismatch.join(' | ')}` : ''}`,
    );
    await context.close();
  }

  // /gallery is now /components, anchors and all; /docs/components goes there too.
  for (const from of ['/gallery', '/docs/components']) {
    const response = await fetch(BASE + from, { redirect: 'manual' });
    check(
      response.status === 308 && new URL(response.headers.get('location'), BASE).pathname === '/components',
      `${from} redirects to /components for good`,
      `${response.status} ${response.headers.get('location')}`,
    );
  }

  // The docs shell. The sidebar in groups, with short labels and the migration guide under Resources.
  const shell = await browser.newPage({ viewport: { width: 1024, height: 800 }, colorScheme: 'light' });
  await shell.goto(`${BASE}/docs/comparison`, { waitUntil: 'networkidle' });
  const sidebar = shell.getByRole('navigation', { name: 'Docs' });
  const groups = await sidebar.locator('p[id$="-group-0"], p[id*="-group-"]').allInnerTexts();
  const resources = await sidebar
    .getByRole('list', { name: /^resources$/i })
    .getByRole('link')
    .allInnerTexts();
  check(
    JSON.stringify(groups.map((g) => g.toLowerCase())) === '["get started","guides","components","resources"]' &&
      resources.includes('Migration'),
    'docs: the sidebar in four groups, the migration guide under Resources',
    `${groups.join(', ')} · ${resources.join(', ')}`,
  );
  // From 1024px, "On this page" is beside the page; the comparison is the last page, with no "Next".
  const rail = shell.getByRole('navigation', { name: /^on this page$/i });
  const pager = shell.getByRole('navigation', { name: 'Previous and next pages' });
  check(
    (await rail.isVisible()) &&
      (await rail.getByRole('link').count()) >= 2 &&
      (await pager.getByText('Next').count()) === 0,
    'docs at 1024px: "On this page" beside the page, and the pager ends at How it compares',
  );
  // The comparison's table has a column for AI Elements as well as assistant-ui.
  const headers = await shell.locator('main table').first().locator('th').allInnerTexts();
  check(
    headers.includes('assistant-ui Elements') && headers.includes('AI Elements'),
    'docs: the comparison has an AI Elements column',
    headers.join(', '),
  );
  // Edit, report and, when the build has the history, the date of the last change, never after HEAD.
  const updated = await shell
    .locator('main time[datetime]')
    .getAttribute('datetime', { timeout: 1000 })
    .catch(() => null);
  check(
    (await shell.getByRole('link', { name: 'Edit this page on GitHub' }).getAttribute('href')).endsWith(
      '/edit/main/examples/playground/content/docs/comparison.md',
    ) &&
      (await shell.getByRole('link', { name: 'Report an issue' }).getAttribute('href')).includes('/issues/new?') &&
      (updated === null || new Date(updated) <= head),
    'docs: edit this page, report an issue, and the last update from git',
    `updated ${updated}`,
  );
  // Page actions: Copy page, and a menu with the Markdown and the two assistants; Escape closes it.
  await shell.getByRole('button', { name: 'More page actions' }).click();
  const actions = shell.getByRole('list', { name: 'Page actions' });
  const actionLinks = await actions.getByRole('link').evaluateAll((links) => links.map((a) => a.href));
  const actionNames = await actions.locator('li').allInnerTexts();
  await shell.keyboard.press('Escape');
  check(
    ['Copy page as Markdown', 'View as Markdown', 'Open in ChatGPT', 'Open in Claude'].every((name, i) =>
      actionNames[i]?.startsWith(name),
    ) &&
      actionLinks[0].endsWith('/docs/comparison.md') &&
      actionLinks
        .slice(1)
        .every((href) => decodeURIComponent(href).includes('https://signoff-ui.vercel.app/docs/comparison.md')) &&
      !(await actions.isVisible()) &&
      (await shell.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'More page actions',
    'docs: the page actions menu: copy, view as Markdown, ChatGPT and Claude with the .md URL; Escape closes it',
    actionNames.join(' | '),
  );
  await shell.close();

  // Below 1024px, "On this page" is a menu in the docs bar.
  const tablet = await browser.newPage({ viewport: { width: 768, height: 900 }, colorScheme: 'dark' });
  await tablet.goto(`${BASE}/docs/getting-started`, { waitUntil: 'networkidle' });
  const tocButton = tablet.getByRole('button', { name: 'On this page' });
  await tocButton.click();
  const tocMenu = tablet.locator('#docs-toc-menu');
  await tocMenu.getByRole('link', { name: 'Dark mode' }).click();
  await tablet.waitForTimeout(400);
  const target = await tablet.evaluate(() => ({
    hash: location.hash,
    top: Math.round(document.getElementById('dark-mode')?.getBoundingClientRect().top ?? -1),
  }));
  check(
    !(await tablet.locator('nav[aria-labelledby="toc-heading"]').isVisible()) &&
      target.hash === '#dark-mode' &&
      target.top > 100 &&
      target.top < 300 &&
      !(await tocMenu.isVisible()),
    'docs at 768px: "On this page" in the docs bar goes to the section, below the bars, and closes',
    JSON.stringify(target),
  );

  // Docs Markdown: a callout, code tabs (Tailwind v4 or not), each block under a bar with its name
  // or language and the copy button, and steps in the migration guide.
  const callout = tablet.locator('main [role="note"].callout[data-kind="note"]');
  const styleTabs = await tablet.getByRole('tablist', { name: 'Code' }).first().getByRole('tab').allInnerTexts();
  const bars = await tablet.locator('main figure[data-code-block]').evaluateAll((figures) =>
    figures.map((figure) => {
      const caption = figure.querySelector('figcaption');
      const button = figure.querySelector('button[aria-label="Copy code"]');
      const pre = figure.querySelector('pre');
      if (!caption || !button || !pre || !caption.textContent.trim()) return 'missing';
      if (!pre.getClientRects().length) return 'ok';
      return button.getBoundingClientRect().bottom <= pre.getBoundingClientRect().top + 1 ? 'ok' : 'overlaps';
    }),
  );
  check(
    (await callout.count()) === 1 &&
      (await tablet.locator('main aside.callout').count()) === 0 &&
      JSON.stringify(styleTabs) === '["Tailwind v4","Tailwind v3 or no Tailwind"]' &&
      bars.length > 5 &&
      bars.every((bar) => bar === 'ok'),
    'docs: a callout (a note, not a landmark), code tabs, and every code block under a bar with its name and Copy, clear of the code',
    `${styleTabs.join(', ')} · ${bars.join(', ')}`,
  );
  await tablet.goto(`${BASE}/docs/migrating-from-agent-ui-kit`, { waitUntil: 'networkidle' });
  check(
    (await tablet.locator('main ol.steps > li').count()) === 3 &&
      !(await tablet.locator('main').innerText()).includes('<!--'),
    'docs: numbered steps in the migration guide, and no marker left showing',
  );
  await tablet.goto(`${BASE}/docs/labels`, { waitUntil: 'networkidle' });
  const folded = tablet.locator('main details.code-collapse');
  check(
    (await folded.count()) === 1 &&
      !(await folded.locator('pre').isVisible()) &&
      (await folded.locator('summary').innerText()).includes('labels-pt.ts'),
    'docs: the Portuguese labels are folded behind "Show all … lines of labels-pt.ts"',
  );
  await tablet.close();

  // Inline code in tables stays whole on a laptop; only long code (over 28 characters) may wrap.
  const unbroken = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const broken = [];
  for (const path of ['/docs', '/docs/limits', '/docs/ag-ui']) {
    await unbroken.goto(BASE + path, { waitUntil: 'load' });
    broken.push(
      ...(await unbroken
        .locator('main td code, main th code')
        .evaluateAll((codes) =>
          codes
            .filter((code) => !code.dataset.long && code.getClientRects().length > 1)
            .map((code) => code.textContent),
        )),
    );
  }
  await unbroken.close();
  check(broken.length === 0, 'docs at 1440px: no identifier in a table breaks across lines', broken.join(', '));

  // The header, the same on the sibling sites: the name and the version on the left; the pages, the
  // theme and GitHub on the right, with a star count only from 10 stars. Then the footer's columns.
  const wide = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await wide.goto(`${BASE}/docs/getting-started`, { waitUntil: 'networkidle' });
  const banner = wide.getByRole('banner');
  const pagesNav = banner.getByRole('navigation', { name: 'Pages' });
  const github = banner.getByRole('link', { name: /on GitHub/ });
  const githubName = (await github.getAttribute('aria-label')) ?? '';
  const starCount = /, ([\d,]+) stars$/.exec(githubName)?.[1];
  check(
    (await banner.locator('[data-version]').innerText()) === `v${kit.version}` &&
      JSON.stringify(await pagesNav.getByRole('link').allInnerTexts()) === '["Docs","Components"]' &&
      (await pagesNav.boundingBox()).x > 720 &&
      (await banner.getByRole('radiogroup', { name: 'Theme' }).isVisible()) &&
      (await github.isVisible()) &&
      (starCount === undefined || Number(starCount.replace(/,/g, '')) >= 10),
    'header: name and version on the left; Docs, Components, the theme and GitHub on the right',
    githubName,
  );
  // Vercel Web Analytics, rendered once in the root layout: its script is added once to the page.
  const insights = await wide.evaluate(
    () => document.querySelectorAll('script[src="/_vercel/insights/script.js"]').length,
  );
  check(insights === 1, 'Vercel Web Analytics: its script is on the page once', `${insights} scripts`);
  await wide.evaluate(() => scrollTo(0, 3000));
  check(
    (await banner.evaluate((el) => el.getBoundingClientRect().top)) === 0,
    'header: stays at the top as the page scrolls',
  );
  const footer = wide.getByRole('contentinfo');
  const columns = await footer.getByRole('navigation').evaluateAll((els) => els.map((el) => el.ariaLabel));
  const project = await footer.getByRole('navigation', { name: 'Project' }).getByRole('link').allInnerTexts();
  const agents = await footer.getByRole('navigation', { name: 'For agents' }).getByRole('link').allInnerTexts();
  check(
    JSON.stringify(columns) === '["Project","For agents","More by Diogo Esteves"]' &&
      ['Docs', 'Changelog', 'Issues'].every((label, i) => project[i] === label) &&
      project[3]?.startsWith('npm') &&
      project[4]?.startsWith(`v${kit.version}`) &&
      ['llms.txt', 'llms-full.txt', 'MCP server'].every((label) => agents.includes(label)),
    'footer: Project, For agents and More by Diogo Esteves',
    `${columns.join(', ')} · ${project.join(', ')} · ${agents.join(', ')}`,
  );
  await wide.close();

  // No page scrolls sideways, and nothing spills out of a docs article, on a phone, a tablet or a
  // laptop, in either theme.
  const sideways = [];
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [390, 768, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      for (const path of [
        '/',
        '/components',
        '/docs',
        '/docs/getting-started',
        '/docs/ag-ui',
        '/docs/components/diff-review',
        '/docs/components/use-approval-policy',
        '/nope',
      ]) {
        await page.goto(BASE + path, { waitUntil: 'load' });
        // The page, and a docs article (whose tables and code blocks scroll on their own).
        const wider = await page.evaluate(() => {
          const article = document.querySelector('main article');
          return Math.max(
            document.documentElement.scrollWidth - innerWidth,
            article ? article.scrollWidth - article.clientWidth : 0,
          );
        });
        if (wider > 0) sideways.push(`${path} at ${width}px, ${colorScheme}: ${wider}px`);
      }
      await page.close();
    }
  }
  check(
    sideways.length === 0,
    'no page scrolls sideways at 390, 768, 1024 or 1440px, light or dark',
    sideways.join('; '),
  );

  // On a phone the run starts on load and grows past the screen; the page must not follow it
  // (and scroll the headline away) until the reader scrolls down or starts a run.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });
  const phone = await phoneContext.newPage();
  await phone.goto(BASE, { waitUntil: 'networkidle' });

  // The first screen says what the kit is and how to get it, and shows the run's status.
  const fold = await phone.evaluate(() =>
    ['h1', 'aside [data-slot="signoff-agent-status"]'].map(
      (s) => document.querySelector(s)?.getBoundingClientRect().bottom,
    ),
  );
  const install = phone.getByRole('button', { name: 'Copy the install command' }).first();
  const star = phone.getByRole('link', { name: 'Star on GitHub' }).first();
  check(
    fold.every((bottom) => bottom !== undefined && bottom < 844) &&
      (await install.boundingBox())?.y < 844 &&
      (await star.boundingBox())?.y < 844,
    'phone: headline, install command, star link and run status on the first screen',
    JSON.stringify(fold),
  );
  check(!(await phone.locator('#kbd-heading').isVisible()), 'phone: no keyboard shortcuts card on a touch screen');
  await phone.waitForFunction(
    () =>
      document.querySelectorAll('[data-slot="signoff-tool-call-trigger"]').length >= 3 &&
      document.documentElement.scrollHeight > innerHeight * 1.5,
    null,
    { timeout: 60_000 },
  );
  const scrollY = await phone.evaluate(() => scrollY);
  check(scrollY === 0, 'phone: the page stays on the headline while the run streams', `scrolled to ${scrollY}px`);
  check((await phone.getByRole('radio', { name: 'Live' }).count()) === 0, 'header: no Live mode without a model key');

  // On a phone the header keeps the name and the version, and the rest is in the menu.
  await phone.evaluate(() => scrollTo(0, 0));
  const phoneBanner = phone.getByRole('banner');
  check(
    (await phoneBanner.locator('[data-version]').isVisible()) &&
      (await phoneBanner.getByRole('link', { name: 'signoff-ui', exact: true }).isVisible()) &&
      !(await phoneBanner.getByRole('radiogroup', { name: 'Theme' }).isVisible()) &&
      !(await phoneBanner.getByRole('link', { name: /on GitHub/ }).isVisible()),
    'phone: the header shows the name and the version, and a menu for the rest',
  );
  await phone.getByRole('button', { name: 'Menu' }).click();
  const menu = phone.locator('#site-menu');
  const menuLinks = await menu.getByRole('link').allInnerTexts();
  check(
    ['Docs', 'Components', 'GitHub', 'npm'].every((label) => menuLinks.some((text) => text.startsWith(label))) &&
      (await menu.getByRole('radiogroup', { name: 'Theme' }).isVisible()),
    'phone: the menu has every page, the theme, GitHub and npm',
    menuLinks.join(', '),
  );
  await phone.locator('#site-menu').getByRole('link', { name: 'Components' }).click();
  await phone.waitForURL(/\/components$/, { timeout: 10_000 }).catch(() => {});
  check(new URL(phone.url()).pathname === '/components', 'phone: the menu reaches the components page', phone.url());
  await phoneContext.close();

  // The run that starts on load leaves the reader where they are: its approval card doesn't take
  // focus when it comes up, which would scroll the page to it, away from the headline (a phone, no
  // input) or from the link the reader is on ("Get started" from the keyboard). Replay, below, does.
  const pendingCard = '[data-slot="signoff-approval-card"][data-status="pending"]';
  const where = () => {
    const el = document.activeElement;
    const focus = !el || el === document.body ? 'body' : `${el.tagName}:${el.textContent?.trim().slice(0, 40)}`;
    return { y: Math.round(scrollY), focus };
  };
  for (const { width, height, touch } of [
    { width: 390, height: 844, touch: true },
    { width: 1440, height: 900, touch: false },
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: 'dark',
      isMobile: touch,
      hasTouch: touch,
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/?speed=4`, { waitUntil: 'networkidle' });
    if (!touch) await page.getByRole('link', { name: 'Get started' }).first().focus();
    const before = await page.evaluate(where);
    await page.waitForSelector(pendingCard, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(where);
    check(
      after.y === before.y && after.focus === before.focus,
      `${width}px: the approval card of the run on load leaves scroll and focus where the reader left them`,
      `${JSON.stringify(before)}, then ${JSON.stringify(after)}`,
    );
    await context.close();
  }

  // Through a whole run from the keyboard: after the review is applied, the reader stays with the
  // run (the diff folds away above them) and sees it finish at the bottom of the screen, not
  // scrolled past it into the sections below. The reader goes to the card: it doesn't come to them.
  const run = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  await run.goto(`${BASE}/?speed=4`, { waitUntil: 'networkidle' });
  await run.waitForSelector(pendingCard, { timeout: 60_000 });
  await run.focus(pendingCard);
  await run.keyboard.press('y');
  await run.waitForSelector('[data-slot="signoff-diff-submit"]', { timeout: 60_000 });
  for (const key of ['a', 'a', 'a', 'r']) await run.keyboard.press(key);
  await run.keyboard.press('Control+Enter');
  await run.getByText('Run complete').waitFor({ timeout: 60_000 });
  await run.waitForTimeout(1000);
  const end = await run.evaluate(() => {
    const box = [...document.querySelectorAll('span')].find((el) => el.textContent === 'Run complete');
    const { top, bottom } = box.getBoundingClientRect();
    return { top: Math.round(top), bottom: Math.round(bottom), height: innerHeight };
  });
  check(
    end.top > end.height / 2 && end.bottom <= end.height,
    'run: after the review is applied, the run fills the screen down to its end',
    JSON.stringify(end),
  );
  await run.close();

  // Replay mid-run starts over once the stopped run has settled, so the new run's time to first
  // token is measured from its own request (the script pauses 680ms first, 170ms at 4x), not 0ms.
  const replay = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  await replay.goto(`${BASE}/?speed=4`, { waitUntil: 'networkidle' });
  const calls = replay.locator('[data-slot="signoff-tool-call-trigger"]');
  await calls.first().waitFor({ timeout: 60_000 });
  await replay.getByRole('button', { name: 'Replay', exact: true }).first().click();
  await calls.first().waitFor({ state: 'detached', timeout: 10_000 });
  await calls.first().waitFor({ timeout: 60_000 });
  const ttft = await replay
    .locator('aside [data-slot="signoff-run-meter"]')
    .evaluate((el) => /TTFT\s*([\d.]+)(ms|s)/.exec(el.textContent ?? '')?.slice(1));
  const ttftMs = ttft && Number(ttft[0]) * (ttft[1] === 's' ? 1000 : 1);
  check(ttftMs >= 100, 'replay: the new run times its first token from its own request', `TTFT ${ttft?.join('')}`);
  // Replay is the reader starting a run: the page follows it, and its approval card takes focus, so Y and N work.
  await replay.waitForSelector(pendingCard, { timeout: 60_000 });
  const replayFocus = await replay.evaluate(() => document.activeElement?.getAttribute('data-slot'));
  check(
    replayFocus === 'signoff-approval-card',
    'replay: the approval card of a run the reader started takes focus',
    String(replayFocus),
  );
  await replay.close();

  // The components page: the anchors launch posts link to, npm snippets that bring the styles, and the
  // header's theme switch, which re-themes the page and the frames, with no axe violations
  // (contrast included) and remembered on the next visit.
  const gallery = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await gallery.goto(`${BASE}/components`, { waitUntil: 'networkidle' });
  const anchors = ['agent-status', 'tool-call-timeline', 'approval-card', 'diff-review', 'run-meter', 'sources'];
  anchors.push('theming', 'labels', 'agent-message', 'ag-ui', 'acp');
  const missing = await gallery.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), anchors);
  check(missing.length === 0, 'components page: every section anchor is there', missing.join(', '));
  const portuguese = await gallery.locator('#labels [lang="pt-PT"]').evaluate((el) => ({
    review: el.querySelector('[data-slot="signoff-diff-review"]')?.getAttribute('aria-label'),
    approval: el.querySelector('[data-slot="signoff-approval-card"]')?.textContent ?? '',
  }));
  check(
    portuguese.review === 'Rever alterações' && portuguese.approval.includes('Aprovação necessária'),
    'components page: the labels section is in Portuguese',
    JSON.stringify(portuguese).slice(0, 200),
  );
  const snippets = await gallery.locator('pre:visible').allInnerTexts();
  check(
    snippets.some((text) => text.includes("import 'signoff-ui/styles.css';")),
    'components page: the npm snippets import the styles',
  );
  await gallery.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click();
  const frame = await gallery.$eval('[data-shot="approval-card"]', (el) => getComputedStyle(el).backgroundColor);
  const page = await gallery.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(
    frame === 'rgb(255, 255, 255)' && page === 'rgb(255, 255, 255)',
    'components page: the theme switch turns the page and the frames light',
    `frame ${frame}, page ${page}`,
  );
  await gallery.reload({ waitUntil: 'networkidle' });
  const remembered = await gallery.evaluate(() => document.documentElement.className);
  check(/\blight\b/.test(remembered), 'theme: the choice is remembered, and applied before paint', remembered);
  await gallery.waitForTimeout(800);
  const require = createRequire(join(import.meta.dirname, '../packages/signoff-ui/package.json'));
  await gallery.addScriptTag({ content: readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
  const violations = await gallery.evaluate(async () =>
    (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')}`,
    ),
  );
  check(violations.length === 0, 'components page, light: no axe violations', violations.join('; '));
  await gallery.close();

  // The ACP demo: a scripted agent's turn, its edit shown as a diff on the card that asks permission,
  // the agent's options as the card's choices, and the turn carrying on after each answer.
  const acpPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await acpPage.goto(`${BASE}/components#acp`, { waitUntil: 'networkidle' });
  const acp = acpPage.locator('#acp');
  await acp.getByRole('button', { name: 'Run the ACP agent' }).click();
  const editCard = acp.getByRole('group', { name: /Edit lib\/format\.ts/ });
  await editCard.and(acpPage.locator('[data-status="pending"]')).waitFor({ timeout: 30_000 });
  const diff = await editCard.locator('[data-slot="signoff-diff-file"]').innerText();
  const choices = await editCard
    .locator('button[data-decision]')
    .evaluateAll((els) => els.map((el) => el.dataset.decision).sort());
  check(
    diff.includes('lib/format.ts') && JSON.stringify(choices) === '["allow-always","allow-once","deny-once"]',
    "components page: the ACP edit shows its diff and offers the agent's options",
    `${choices.join(', ')} · ${diff.slice(0, 80)}`,
  );
  await acpPage.mouse.move(0, 0);
  await acpPage.waitForTimeout(800);
  await acpPage.addScriptTag({ content: readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
  const acpViolations = await acpPage.evaluate(async () =>
    (await window.axe.run('#acp', { resultTypes: ['violations'] })).violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')}`,
    ),
  );
  check(
    acpViolations.length === 0,
    'components page: the ACP edit card, with its diff, has no axe violations',
    acpViolations.join('; '),
  );
  await editCard.getByRole('button', { name: 'Always' }).click();
  const testCard = acp.getByRole('group', { name: /pnpm test lib\/format/ });
  await testCard.and(acpPage.locator('[data-status="pending"]')).waitFor({ timeout: 30_000 });
  await testCard.getByRole('button', { name: /^Approve/ }).click();
  await acp.getByText('now reads').waitFor({ timeout: 30_000 });
  const acpState = await acp.locator('[data-slot="signoff-agent-status"]').getAttribute('data-state');
  const edited = await editCard.getAttribute('data-status');
  check(
    acpState === 'done' && edited === 'approved',
    'components page: the ACP turn carries on after each answer and ends done',
    `${acpState}, edit ${edited}`,
  );
  await acpPage.close();

  // A 5,000-line rewrite: Next.js emits the package's diff worker, the page keeps responding while
  // the worker diffs it, the review says it fell back to one replacing hunk, and only the rows near
  // the screen are in the DOM, with no axe violations.
  const large = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await large.goto(`${BASE}/components`, { waitUntil: 'networkidle' });
  const workers = [];
  large.on('worker', (worker) => workers.push(worker.url()));
  await large.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((e) => e.duration))).observe({
      type: 'longtask',
    });
  });
  await large.getByRole('button', { name: 'A 5,000-line rewrite' }).click();
  const review = large.getByRole('region', { name: 'Review a regenerated schema' });
  await review.getByText('Too many changes to compare line by line').waitFor({ timeout: 30_000 });
  await large.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 });
  const busiest = await large.evaluate(() => Math.max(0, ...window.__longTasks));
  const nodes = await review.evaluate((el) => el.querySelectorAll('*').length);
  check(
    workers.length > 0 && busiest < 400 && nodes < 20_000,
    'components page: a 5,000-line rewrite is diffed in a worker, and renders what is near the screen',
    `workers ${JSON.stringify(workers)}, longest task ${Math.round(busiest)} ms, ${nodes} elements`,
  );
  await large.addScriptTag({ content: readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
  const largeViolations = await large.evaluate(async () =>
    (await window.axe.run('[data-slot="signoff-diff-review"]', { resultTypes: ['violations'] })).violations.map(
      (v) => v.id,
    ),
  );
  check(
    largeViolations.length === 0,
    'components page: the large review has no axe violations',
    largeViolations.join(', '),
  );
  await large.close();

  // On a phone, diff hunks, code and the compact run meter scroll sideways: each must be reachable
  // from the keyboard while it does (axe's scrollable-region-focusable, WCAG 2.1.1).
  const narrow = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await narrow.goto(`${BASE}/components`, { waitUntil: 'networkidle' });
  await narrow.waitForTimeout(800);
  await narrow.addScriptTag({ content: readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
  const unreachable = await narrow.evaluate(async () =>
    (
      await window.axe.run(document, { runOnly: ['scrollable-region-focusable'], resultTypes: ['violations'] })
    ).violations.flatMap((v) => v.nodes.map((n) => n.target.join(' '))),
  );
  check(
    unreachable.length === 0,
    'components page, 390px: every sideways scroller is reachable',
    unreachable.join(', '),
  );
  await narrow.close();
} finally {
  await browser.close();
  if (server) process.kill(-server.pid);
}
if (failed) process.exit(1);
