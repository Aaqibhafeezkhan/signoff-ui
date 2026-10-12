import { prettyDOM, render } from '@testing-library/react';
import { version } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { Reasoning } from '../src/reasoning';
import { assistant, toolPart } from './utils';

/*
 * The markup AgentMessage and Reasoning render with the built-in Markdown renderer, in the
 * browser and on the server. The snapshots were taken before the renderer became pluggable, so a
 * change to them is a change for every app that does not swap the renderer. React 18 and 19 write
 * ids and image preloads differently, and CI runs both, so each has its own file.
 */
const REACT = version.split('.')[0];

const TEXT = [
  '## Plan',
  '',
  'Add a **sliding window** limiter to `route.ts`, as [the docs](https://upstash.com/docs) suggest [1].',
  '',
  '1. Read the route',
  '2. Add the limiter',
  '',
  '| Window | Requests |',
  '| --- | --: |',
  '| 10 s | 5 |',
  '',
  '```ts',
  "const ratelimit = new Ratelimit({ limiter: Ratelimit.slidingWindow(5, '10 s') });",
  '```',
  '',
  '> Bursty chat traffic suits a sliding window.',
  '',
  '![chart](https://images.example.com/chart.png) and ![tracker](https://attacker.example/p.png?d=1)',
].join('\n');

const done = assistant([
  { type: 'step-start' },
  { type: 'reasoning', text: 'Check the **route handler** first.', state: 'done' },
  { type: 'text', text: TEXT, state: 'done' },
  toolPart('output-available', { toolCallId: 't1', toolName: 'search_code' }),
  toolPart('approval-requested', {
    toolCallId: 't2',
    toolName: 'run_command',
    input: { command: 'pnpm add @upstash/ratelimit' },
  }),
  { type: 'file', mediaType: 'text/plain', url: 'https://example.com/notes.txt', filename: 'notes.txt' },
  { type: 'text', text: 'Done [1].', state: 'done' },
  { type: 'source-url', sourceId: 's1', url: 'https://upstash.com/docs/ratelimit', title: 'Upstash Ratelimit' },
]);

const streaming = assistant([
  { type: 'reasoning', text: 'Thinking about `the', state: 'streaming' },
  { type: 'text', text: 'Adding **the limit', state: 'streaming' },
]);

const cases = [
  [
    'a finished message',
    <AgentMessage
      key="done"
      message={done}
      allowedImageHosts={['images.example.com']}
      onToolApproval={() => {}}
      tools={{ run_command: { label: 'Run command', risk: 'high' } }}
    />,
  ],
  ['a streaming message', <AgentMessage key="streaming" message={streaming} streaming />],
  ['Reasoning, open', <Reasoning key="reasoning" text={'A **bold** idea:\n\n- one\n- two'} defaultOpen />],
] as const;

it(`renders the built-in Markdown renderer's markup as before, on React ${REACT}`, async () => {
  const markup = cases.flatMap(([name, element]) => {
    const { container, unmount } = render(element);
    const browser = prettyDOM(container, Number.POSITIVE_INFINITY, { highlight: false });
    unmount();
    return [`## ${name}, in the browser`, browser, `## ${name}, on the server`, renderToString(element)];
  });
  await expect(markup.join('\n\n') + '\n').toMatchFileSnapshot(
    `./__snapshots__/default-markdown-output.react-${REACT}.txt`,
  );
});
