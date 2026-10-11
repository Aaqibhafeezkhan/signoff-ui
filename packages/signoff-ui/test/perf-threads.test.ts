// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeThreads, parseStat, type ThreadSample } from '../../../scripts/perf/threads';

/*
 * When a case stalls, scripts/perf.mjs prints what Chrome's threads are doing, from Linux's /proc:
 * whether the page's main thread runs or waits, and on what.
 */

describe('parseStat', () => {
  it('reads the state, parent and CPU time, whatever the name holds', () => {
    const line =
      '4242 (Compositor (x) y) S 4200 4100 4100 0 -1 4194560 120 0 0 0 37 5 0 0 20 0 9 0 1234 0 0 18446744073709551615';
    expect(parseStat(line)).toEqual({ id: 4242, name: 'Compositor (x) y', state: 'S', ppid: 4200, ticks: 42 });
  });
});

describe('describeThreads', () => {
  const thread = (over: Partial<ThreadSample>): ThreadSample => ({
    pid: 10,
    type: 'renderer',
    tid: 10,
    name: 'chrome',
    state: 'S',
    ticks: 0,
    wchan: 'futex_do_wait',
    ...over,
  });

  it('names each main thread, the compositor and any thread that used CPU, with what it waits on', () => {
    const before = [
      thread({}),
      thread({ tid: 11, name: 'Compositor', wchan: 'do_epoll_wait', ticks: 5 }),
      thread({ tid: 12, name: 'ThreadPoolForeg', ticks: 3 }),
      thread({ tid: 13, name: 'ThreadPoolForeg', ticks: 7 }),
      thread({ pid: 20, tid: 20, type: 'utility', ticks: 1 }),
    ];
    const after = [
      thread({}),
      thread({ tid: 11, name: 'Compositor', wchan: 'do_epoll_wait', ticks: 7 }),
      thread({ tid: 12, name: 'ThreadPoolForeg', ticks: 3 }),
      thread({ tid: 13, name: 'ThreadPoolForeg', state: 'R', wchan: '0', ticks: 107 }),
      thread({ pid: 20, tid: 20, type: 'utility', ticks: 9 }),
    ];
    expect(describeThreads(before, after)).toEqual([
      'renderer 10, main thread: state S, waiting in futex_do_wait, 0 ms of CPU in the last second',
      'renderer 10, Compositor: state S, waiting in do_epoll_wait, 20 ms of CPU in the last second',
      'renderer 10, ThreadPoolForeg: running, 1000 ms of CPU in the last second',
    ]);
  });
});
