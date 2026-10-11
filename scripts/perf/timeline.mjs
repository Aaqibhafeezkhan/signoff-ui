// The page scripts/perf.mjs loads for its ToolCallTimeline case: a long run's calls, each with its
// timing so the waterfall shows, then calls appended one at a time, and a call left running while
// its clock ticks. Bundled with Rolldown against the built package, like harness.mjs.
import { createElement as h, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ToolCallTimeline } from 'signoff-ui';

const step = (what) => console.log(`perf: ${what}`);
const n = Number(new URLSearchParams(location.search).get('n') ?? 2000);
const started = Date.now() - n * 1000;

const call = (i, state) => ({
  type: 'tool-read_file',
  toolCallId: `call-${i}`,
  state,
  input: { path: `src/module-${i}.ts` },
  ...(state === 'output-available' ? { output: { bytes: 1000 + i } } : {}),
});
// A call a second, each lasting 600 ms; a settled call keeps its timing object from render to render.
const timing = (i) => ({
  startedAt: started + i * 1000,
  runningAt: started + i * 1000 + 50,
  endedAt: started + i * 1000 + 600,
});

let parts = Array.from({ length: n }, (_, i) => call(i, 'output-available'));
let timings = Object.fromEntries(parts.map((p, i) => [p.toolCallId, timing(i)]));
let set;
function Run() {
  const [state, setState] = useState({ parts, timings });
  set = setState;
  return h(ToolCallTimeline, { parts: state.parts, timings: state.timings, label: 'Tool calls' });
}

const container = document.getElementById('root');
const root = createRoot(container);
const time = (fn) => {
  const t = performance.now();
  flushSync(fn);
  return performance.now() - t;
};
const frame = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 100);
  });

const result = {};
result.mountMs = time(() => root.render(h(Run)));
step(`rendered ${n} calls in ${Math.round(result.mountMs)} ms`);
await frame();
await frame();

// Append a call, as a run does, until the frame that shows it is painted: the main thread's time for
// the update and for that frame's style, layout and paint, without the wait for the frame to start.
// A message posted from the frame's animation callback runs once its rendering is done.
const channel = new MessageChannel();
const painted = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => {
      const start = performance.now();
      channel.port1.onmessage = () => resolve(performance.now() - start);
      channel.port2.postMessage(null);
    }),
  );
const appends = [];
for (let k = 0; k < 5; k++) {
  const i = parts.length;
  parts = [...parts, call(i, 'output-available')];
  timings = { ...timings, [`call-${i}`]: timing(i) };
  const update = time(() => set({ parts, timings }));
  appends.push(update + (await painted()));
  await frame();
}
result.appendMs = appends.sort((a, b) => a - b)[2];
step('appended five calls');

// One more call, left running: its clock ticks every 100 ms, and the waterfall's span with it.
const i = parts.length;
parts = [...parts, call(i, 'input-available')];
timings = { ...timings, [`call-${i}`]: { startedAt: Date.now() } };
set({ parts, timings });
await frame();
const frames = [];
let last = performance.now();
for (const end = last + 2000; performance.now() < end;) {
  await frame();
  const now = performance.now();
  frames.push(now - last);
  last = now;
}
frames.sort((a, b) => a - b);
result.runningFrameP95Ms = frames[Math.floor(frames.length * 0.95)] ?? 0;
result.domNodes = container.querySelectorAll('*').length;
result.renderedCalls = container.querySelectorAll('[data-slot="signoff-tool-call"]').length;
step(`watched a running call for ${frames.length} frames`);

window.__perf = result;
