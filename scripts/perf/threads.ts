// What Chrome's processes are doing, from Linux's /proc, for a case that stalls: whether the page's
// main thread is running (CPU time going up) or waiting, and what for (`wchan`: a futex is a lock
// or an event, `do_epoll_wait` an idle message loop). Elsewhere it reports nothing.
import { readdirSync, readFileSync } from 'node:fs';

/** One thread at one moment. */
export interface ThreadSample {
  /** The process, and its type: `browser`, `renderer`, `gpu-process`, `utility`... */
  pid: number;
  type: string;
  tid: number;
  name: string;
  /** R running, S sleeping, D waiting on the disk, ... */
  state: string;
  /** User and system CPU time so far, in clock ticks (1/100 s). */
  ticks: number;
  wchan: string;
}

/** A /proc stat line's fields. The name sits in parentheses and may hold spaces and parentheses itself. */
export function parseStat(line: string) {
  const open = line.indexOf('(');
  const close = line.lastIndexOf(')');
  const fields = line
    .slice(close + 2)
    .trim()
    .split(' ');
  return {
    id: Number(line.slice(0, open).trim()),
    name: line.slice(open + 1, close),
    state: fields[0] ?? '?',
    ppid: Number(fields[1]),
    ticks: Number(fields[11]) + Number(fields[12]),
  };
}

/** A /proc file or directory; empty once its process has exited. */
const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};
const list = (path: string) => {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
};

/** Every thread of `root` and the processes under it, as they are now. */
export function sampleThreads(root: number): ThreadSample[] {
  const parents = new Map<number, number>();
  for (const entry of list('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = read(`/proc/${entry}/stat`);
    if (stat) parents.set(Number(entry), parseStat(stat).ppid);
  }
  const pids = [root];
  for (let i = 0; i < pids.length; i++)
    for (const [pid, ppid] of parents) if (ppid === pids[i] && !pids.includes(pid)) pids.push(pid);
  const samples: ThreadSample[] = [];
  for (const pid of pids) {
    const type = /--type=([\w-]+)/.exec(read(`/proc/${pid}/cmdline`).replaceAll('\0', ' '))?.[1] ?? 'browser';
    for (const task of list(`/proc/${pid}/task`)) {
      const stat = read(`/proc/${pid}/task/${task}/stat`);
      if (!stat) continue;
      const { id, name, state, ticks } = parseStat(stat);
      samples.push({ pid, type, tid: id, name, state, ticks, wchan: read(`/proc/${pid}/task/${task}/wchan`).trim() });
    }
  }
  return samples;
}

/**
 * A line per thread worth reading, from two samples a moment apart: the main thread of each
 * renderer, GPU and browser process, their compositor and worker threads, and any thread that used
 * CPU in between.
 */
export function describeThreads(before: readonly ThreadSample[], after: readonly ThreadSample[]): string[] {
  const earlier = new Map(before.map((t) => [t.tid, t]));
  const NAMED = /^(Compositor|VizCompositorTh|DedicatedWorker|CrGpuMain|CrRendererMain|CrBrowserMain)/;
  const lines: string[] = [];
  for (const t of after) {
    if (!/^(renderer|gpu-process|browser)$/.test(t.type)) continue;
    const used = t.ticks - (earlier.get(t.tid)?.ticks ?? t.ticks);
    const main = t.tid === t.pid;
    if (!main && !NAMED.test(t.name) && used <= 0) continue;
    const name = main ? 'main thread' : t.name;
    const doing = t.state === 'R' ? 'running' : `state ${t.state}, waiting in ${t.wchan || '?'}`;
    lines.push(`${t.type} ${t.pid}, ${name}: ${doing}, ${used * 10} ms of CPU in the last second`);
  }
  return lines;
}

/** Two samples of Chrome's threads a second apart, described; nothing where there is no /proc. */
export async function chromeThreads(root: number | undefined, gapMs = 1000): Promise<string[]> {
  if (process.platform !== 'linux' || !root) return [];
  const before = sampleThreads(root);
  await new Promise((resolve) => setTimeout(resolve, gapMs));
  return describeThreads(before, sampleThreads(root));
}
