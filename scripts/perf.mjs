// How DiffReview holds up on large files, in Chrome with React's production build: the audit's
// cases (local edits to 1,000 and 5,000 lines, full rewrites of 2,000 and 5,000) and the 5,000-line
// rewrite in split view. For each: the first render, the time until every file is compared and on
// screen, the longest task that blocked the page, the DOM it leaves, one keyboard decision, and
// paging through the whole review a screen per frame. Then ToolCallTimeline on a run of 2,000
// calls: the first render, appending a call until the frame that shows it is painted, the frames
// while a call runs, and the calls it renders.
//
// Chrome runs with the GPU off (scripts/perf/chrome.ts). Every case runs three times, each pass in a
// browser of its own, and each metric is the median of the three; CI fails when one goes over its
// budget (scripts/perf/cases.ts). The old behaviour (a 5,000-line rewrite blocking for 3 s, 260k DOM
// nodes) is far outside every budget.
//
//   pnpm build:lib && pnpm perf
//   node scripts/perf.mjs --dist <other checkout>/packages/signoff-ui/dist --no-budget   # compare
//   node scripts/perf.mjs --passes 1    # one pass, a third of the time
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire, SourceMap } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build } from 'rolldown';
import { CASES, TIMELINE_CASES } from './perf/cases.ts';
import { launchOptions, onTheGpu } from './perf/chrome.ts';
import { runCases, within } from './perf/deadline.ts';
import { interleave, medianOfPasses, overBudget } from './perf/passes.ts';
import { chromeThreads } from './perf/threads.ts';

// Each pass runs in a browser of its own, with a minute a try and two more tries in a new browser
// when it stalls (scripts/perf/deadline.ts): four minutes at most for a pass that stalls every time.
// On the slowest runner seen a pass took 26 s at most, and one pass over every case 48 to 74 s, so
// three passes take under four minutes there. This is the backstop: however the browser behaves, the
// check ends before the CI job's clock (10 minutes) does.
setTimeout(() => {
  console.error('perf: no result after 9 minutes');
  process.exit(1);
}, 9 * 60_000).unref();

const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const dist = resolve(arg('--dist') ?? join(import.meta.dirname, '../packages/signoff-ui/dist'));
const enforce = !process.argv.includes('--no-budget');
const json = process.argv.includes('--json');
const passes = Number(arg('--passes') ?? 3);
if (!Number.isInteger(passes) || passes < 1) {
  console.error(`perf: --passes takes a whole number from 1, not ${arg('--passes')}`);
  process.exit(1);
}

// Bundle the harness against the built package, with the React that package resolves.
const pkg = createRequire(join(dist, '../package.json'));
const out = mkdtempSync(join(tmpdir(), 'signoff-perf-'));
const reactDir = dirname(pkg.resolve('react/package.json'));
const reactDomDir = dirname(pkg.resolve('react-dom/package.json'));
await build({
  input: join(import.meta.dirname, 'perf/harness.mjs'),
  platform: 'browser',
  logLevel: 'silent',
  resolve: { alias: { 'signoff-ui': join(dist, 'index.js'), react: reactDir, 'react-dom': reactDomDir } },
  transform: { define: { 'process.env.NODE_ENV': '"production"' } },
  // The map only reaches a stalled case's stack (`diagnose`): nothing in the page loads it.
  output: { dir: out, format: 'esm', entryFileNames: 'harness.js', minify: true, sourcemap: true },
});
const LOADED = "console.log('perf: diff worker loaded');";
// The package starts its diff worker from `new URL('./diff-worker.js', import.meta.url)`, which a
// bundler with worker support emits on its own. Here the worker is built beside the page instead.
const worker = join(dist, 'lib/diff-worker.js');
if (existsSync(worker)) {
  await build({
    input: worker,
    platform: 'browser',
    logLevel: 'silent',
    // Once it can answer: a case that stalls says whether its worker got this far.
    output: { dir: out, format: 'esm', entryFileNames: 'diff-worker.js', minify: true, footer: LOADED },
  });
}
await build({
  input: join(import.meta.dirname, 'perf/timeline.mjs'),
  platform: 'browser',
  logLevel: 'silent',
  resolve: { alias: { 'signoff-ui': join(dist, 'index.js'), react: reactDir, 'react-dom': reactDomDir } },
  transform: { define: { 'process.env.NODE_ENV': '"production"' } },
  output: { dir: out, format: 'esm', entryFileNames: 'timeline.js', minify: true, sourcemap: true },
});
copyFileSync(join(dist, 'styles.css'), join(out, 'styles.css'));
const html = (script) =>
  '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css">' +
  '<style>body{margin:0;padding:24px;background:#0d0f12}</style></head>' +
  `<body><div id="root"></div><script type="module" src="${script}"></script></body></html>`;
writeFileSync(join(out, 'index.html'), html('harness.js'));
writeFileSync(join(out, 'timeline.html'), html('timeline.js'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(out, path === '/' ? 'index.html' : path);
  if (!file.startsWith(out) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, done));
const base = `http://localhost:${server.address().port}`;

let described = false;

/**
 * Chrome with the GPU off, in a process the check can kill. Playwright's `browser.close()` waits for
 * the browser to exit and has no timeout of its own, so a browser that stops answering would hang it.
 */
async function launch() {
  const server = await chromium.launchServer(launchOptions);
  const chrome = server.process();
  const kill = () => {
    // Its renderers too: Playwright starts Chrome as the leader of a process group.
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      chrome.kill('SIGKILL');
    }
  };
  const browser = await chromium.connect(server.wsEndpoint());
  // The budgets are for a page drawn in software: a browser that draws on the GPU does not measure.
  const { gpu } = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  const onGpu = onTheGpu(gpu.featureStatus);
  if (onGpu) {
    kill();
    throw new Error(`perf: ${onGpu}; the budgets are for a page drawn in software`);
  }
  if (!described) {
    described = true;
    console.error(`perf: Chrome ${browser.version()}, with the GPU off: it draws in software`);
  }
  return { browser, pid: chrome.pid, close: () => server.close(), kill };
}

/** What a case's page and its worker report, a line each, timed from the start of the case. */
function record(page, log) {
  const started = Date.now();
  const add = (line) => log.push(`${((Date.now() - started) / 1000).toFixed(1)} s ${line}`);
  page.on('console', (message) => add(`console.${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => add(`pageerror: ${error.message}`));
  page.on('crash', () => add('the page crashed'));
  page.on('requestfailed', (request) => add(`request failed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => response.status() >= 400 && add(`${response.status()} for ${response.url()}`));
  page.on('worker', (worker) => {
    add(`worker attached: ${worker.url()}`);
    worker.on('close', () => add(`worker closed: ${worker.url()}`));
  });
}

/**
 * Where a case's main-thread time went, from a Chrome trace of loading it again: self time by
 * kind (script, style, layout, paint, garbage collection) and the busiest trace events. Printed
 * for a case over budget, so a CI failure says what to look at.
 */
async function whereTimeWent(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8', transferMode: 'ReportEvents' });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__perf, null, { polling: 100 });
  await cdp.send('Tracing.end');
  await done;
  await page.close();
  const mains = new Set(
    events
      .filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      .map((e) => `${e.pid}:${e.tid}`),
  );
  const slices = events
    .filter((e) => e.ph === 'X' && mains.has(`${e.pid}:${e.tid}`) && e.dur > 0)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // Self time: an event's duration less its children's, on each thread's stack.
  const self = new Map();
  const stacks = new Map();
  for (const event of slices) {
    const key = `${event.pid}:${event.tid}`;
    const stack = stacks.get(key) ?? [];
    stacks.set(key, stack);
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= event.ts) stack.pop();
    const parent = stack.at(-1);
    if (parent) self.set(parent, (self.get(parent) ?? 0) - Math.min(event.dur, parent.ts + parent.dur - event.ts));
    self.set(event, (self.get(event) ?? 0) + event.dur);
    stack.push(event);
  }
  const KIND = [
    ['style', /UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|ScheduleStyleRecalculation/],
    ['layout', /^Layout$|UpdateLayerTree|IntersectionObserverController/],
    ['paint', /Paint|Layerize|Commit|CompositeLayers|UpdateLayer/],
    ['gc', /GC|Scavenge|MarkCompact/i],
  ];
  const kinds = new Map();
  const names = new Map();
  for (const [event, time] of self) {
    const kind = KIND.find(([, re]) => re.test(event.name))?.[0] ?? 'script and other';
    kinds.set(kind, (kinds.get(kind) ?? 0) + time);
    names.set(event.name, (names.get(event.name) ?? 0) + time);
  }
  const top = (map, n) =>
    [...map]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, us]) => `${name} ${Math.round(us / 1000)} ms`)
      .join(', ');
  return `${top(kinds, 5)}\n    busiest: ${top(names, 8)}`;
}

/** The case running now: a DevTools session on its page and its scripts by id, for `diagnose`. */
let current;

/** A paused stack frame, at its place in the source when it is in one of the bundled pages. */
function frameAt({ functionName, location }) {
  const url = current?.scripts.get(location.scriptId) ?? '';
  let where = `${url.split('/').pop() || '?'}:${location.lineNumber + 1}:${location.columnNumber + 1}`;
  let name = functionName;
  const bundle = /\/(harness|timeline)\.js$/.exec(url)?.[1];
  if (bundle) {
    current.maps ??= new Map();
    if (!current.maps.has(bundle))
      current.maps.set(bundle, new SourceMap(JSON.parse(readFileSync(join(out, `${bundle}.js.map`), 'utf8'))));
    const found = current.maps.get(bundle).findEntry(location.lineNumber, location.columnNumber);
    if (found?.originalSource) {
      where = `${found.originalSource.replace(/^.*?(packages|scripts)\//, '$1/')}:${found.originalLine + 1}:${found.originalColumn + 1}`;
      name = found.name ?? name;
    }
  }
  return `  at ${name || '(anonymous)'} (${where})`;
}

/**
 * What a stalled case's browser is doing: whether its page answers, the JavaScript it is running if
 * any, and on Linux what its threads are waiting on. Printed with the page's log.
 */
async function diagnose({ pid }) {
  const lines = [];
  const cdp = current?.cdp;
  if (cdp) {
    // Pausing works while the page runs JavaScript, even a script that never ends: its stack says
    // which code is stuck. Asked first, since an evaluate waits for that script to end.
    const paused = new Promise((resolve) => cdp.once('Debugger.paused', resolve));
    cdp.send('Debugger.pause').catch(() => {});
    const stack = await within(paused, 5000, '').then(
      ({ callFrames }) => callFrames.slice(0, 12).map(frameAt),
      () => undefined,
    );
    if (stack) {
      lines.push('paused in JavaScript:', ...stack);
      await within(cdp.send('Debugger.resume'), 5000, '').catch(() => {});
    } else {
      lines.push('not running JavaScript: it did not pause within 5 s');
      lines.push(
        await within(
          cdp.send('Runtime.evaluate', { expression: 'performance.now()', returnByValue: true }),
          5000,
          '',
        ).then(
          ({ result }) => `the page answers, ${Math.round(result.value)} ms after it started`,
          () => 'the page does not answer within 5 s: its main thread is waiting on something',
        ),
      );
    }
  }
  return [...lines, ...(await chromeThreads(pid))];
}

const urlOf = ({ query, timeline }) => (timeline ? `${base}/timeline.html?${query}` : `${base}/?${query}`);

/** One pass over one case: what the page measured. */
async function measure({ browser }, { item, label }, log) {
  const started = Date.now();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // With the debugger on from the start, a stalled case can be paused even inside a long script
  // (DevTools cannot turn it on then). It costs nothing measurable here, and with breakpoints off a
  // `debugger` statement does not stop the page.
  const cdp = await page.context().newCDPSession(page);
  const scripts = new Map();
  cdp.on('Debugger.scriptParsed', ({ scriptId, url }) => scripts.set(scriptId, url));
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.setBreakpointsActive', { active: false });
  current = { cdp, scripts };
  page.setDefaultTimeout(45_000);
  const errors = [];
  record(page, log);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(urlOf(item), { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__perf, null, { polling: 100 });
  const result = await page.evaluate(() => window.__perf);
  await page.close();
  current = undefined;
  if (errors.length || result.error)
    throw new Error([...new Set([result.error, ...errors])].filter(Boolean).join('; '));
  console.error(`perf: ${label} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { item, metrics: result };
}

const cases = [...CASES, ...TIMELINE_CASES];
const options = {
  launch,
  deadlineMs: 60_000,
  retries: 2,
  // Playwright's own timeouts, and a crashed page, count as a stuck browser too: worth another try.
  stalled: (error) => error.name === 'TimeoutError' || /crashed/i.test(error.message),
  diagnose,
  diagnoseMs: 20_000,
};
let results;
let over = [];
let breakdowns = [];
try {
  const measured = await runCases(interleave(cases, passes), { ...options, run: measure });
  results = cases.map((item) => {
    const runs = measured.filter((m) => m.item === item).map((m) => m.metrics);
    return { label: item.label, timeline: item.timeline, ...medianOfPasses(runs), budgets: item.budgets, passes: runs };
  });
  const overByCase = results.map((r) => overBudget(r.label, r, r.budgets));
  over = overByCase.flat();
  // A case over budget is loaded once more with a trace, so a CI failure says what to look at.
  const traced = cases.filter((_, i) => overByCase[i].length);
  if (enforce && traced.length) {
    breakdowns = await runCases(traced, {
      ...options,
      retries: 0,
      diagnose: undefined,
      run: async ({ browser }, item) => `${item.label}: ${await whereTimeWent(browser, urlOf(item))}`,
    }).catch((error) => [`could not trace: ${error.message}`]);
  }
} catch (error) {
  console.error(error.message);
} finally {
  server.close();
  rmSync(out, { recursive: true, force: true });
}
if (!results) process.exit(1);

const ms = (value) => `${Math.round(value)} ms`;
const count = (value) => value.toLocaleString('en-US');
if (json) console.log(JSON.stringify(results, null, 2));
else {
  console.log(`Each value is the median of ${passes} ${passes === 1 ? 'pass' : 'passes'}.\n`);
  console.log(
    '| Case | First render | Ready | Longest task | DOM nodes | Keypress | Scroll p95 frame | Longest task, scrolling | DOM after scrolling |',
  );
  console.log('| --- | --: | --: | --: | --: | --: | --: | --: | --: |');
  for (const r of results.filter((r) => !r.timeline)) {
    console.log(
      `| ${r.label} | ${ms(r.mountMs)} | ${ms(r.readyMs)} | ${ms(r.longestTaskMs)} | ${count(r.domNodes)} | ${r.keyMs.toFixed(1)} ms | ${ms(r.scrollFrameP95Ms)} | ${ms(r.scrollLongestTaskMs)} | ${count(r.domNodesAfterScroll)} |`,
    );
  }
  console.log(
    '\n| Case | First render | Append, to the painted frame | p95 frame, a call running | DOM nodes | Calls rendered |',
  );
  console.log('| --- | --: | --: | --: | --: | --: |');
  for (const r of results.filter((r) => r.timeline)) {
    console.log(
      `| ${r.label} | ${ms(r.mountMs)} | ${r.appendMs.toFixed(1)} ms | ${ms(r.runningFrameP95Ms)} | ${count(r.domNodes)} | ${count(r.renderedCalls)} |`,
    );
  }
}
if (enforce && over.length) {
  console.error(
    `\nOver budget (raise it in scripts/perf/cases.ts only if the slowdown is worth it):\n  ${over.join('\n  ')}`,
  );
  if (breakdowns.length)
    console.error(`\nWhere the main thread's time went, loading each again:\n  ${breakdowns.join('\n  ')}`);
  process.exit(1);
}
process.exit(0);
