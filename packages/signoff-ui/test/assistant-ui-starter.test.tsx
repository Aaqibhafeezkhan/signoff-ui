import {
  AssistantRuntimeProvider,
  AuiConfig,
  MessagePrimitive,
  ThreadPrimitive,
  Tools,
  groupPartByType,
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunResult,
  type ToolCallMessagePartComponent,
  type Toolkit,
} from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { ApprovalToolUI, ReviewToolUI, signoffTools } from '../src/assistant-ui';

/*
 * The app `npx assistant-ui create` makes doesn't render assistant messages through
 * `MessagePrimitive.Parts`, so there is no `components.tools` for `signoffTools()`. Its thread (the
 * `@assistant-ui/thread` registry item) groups the parts, and puts every tool call whose UI isn't
 * registered as standalone into a tool group that starts closed: a review or an approval card there
 * is out of sight, and the run waits on it. chat-ui.md's "In the assistant-ui starter" registers the
 * kit's tool UIs as toolkit entries with `display: 'standalone'`. This renders a message the way that
 * thread does, with the toolkit read from the page.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const chatUi = read('examples/playground/content/docs/chat-ui.md');
const readme = read('README.md');

/** A section, from its heading to the next heading of the same depth or higher. */
function section(markdown: string, heading: string) {
  const depth = /^#+/.exec(heading)![0].length;
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start === -1) return '';
  const next = new RegExp(`\\n#{2,${depth}} `, 'g');
  next.lastIndex = start + 1;
  return markdown.slice(start, next.exec(markdown)?.index);
}

const assistantUi = section(chatUi, '## assistant-ui');
const starter = section(chatUi, '### In the assistant-ui starter');
const code = /```tsx title="app\/assistant\.tsx"\n([\s\S]*?)```/.exec(starter)?.[1] ?? '';

/** The toolkit the page registers, entry by entry: `name: { type: '…', display: '…', render: … },`. */
function documentedToolkit() {
  const body = /^const toolkit = \{\n([\s\S]*?)^\} satisfies Toolkit;$/m.exec(code)?.[1] ?? '';
  const components: Record<string, ToolCallMessagePartComponent> = { ReviewToolUI, ApprovalToolUI };
  const entries = [...body.matchAll(/^ {2}(\w+): \{ type: '(\w+)', display: '(\w+)', render: (\w+) \},$/gm)];
  return Object.fromEntries(
    entries.map(([, name, type, display, render]) => [name!, { type, display, render: components[render!] }]),
  ) as Toolkit;
}

// How the starter's thread groups an assistant message's parts (thread.aui.tsx, assistant-ui 0.15.29).
const groupBy = groupPartByType({
  reasoning: ['group-chainOfThought', 'group-reasoning'],
  'tool-call': ['group-chainOfThought', 'group-tool'],
  'standalone-tool-call': [],
});

const files = [{ path: 'src/a.ts', oldContent: 'export const a = 1;\n', newContent: 'export const a = 2;\n' }];

/** A model that proposes an edit for review and asks to run a command, then waits on both. */
const model: ChatModelAdapter = {
  async *run(): AsyncGenerator<ChatModelRunResult> {
    yield {
      content: [
        { type: 'text', text: 'Here is the change, for you to review.' },
        {
          type: 'tool-call',
          toolCallId: 'call_review',
          toolName: 'review_changes',
          args: { files },
          argsText: JSON.stringify({ files }),
        },
        {
          type: 'tool-call',
          toolCallId: 'call_run',
          toolName: 'run_command',
          args: { command: 'pnpm add zod' },
          argsText: '{"command":"pnpm add zod"}',
          approval: { id: 'approval_run' },
        },
      ],
      status: { type: 'requires-action', reason: 'tool-calls' },
    };
  },
};

function StarterMessage({ ToolFallback }: { ToolFallback: ToolCallMessagePartComponent }) {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.GroupedParts groupBy={groupBy}>
        {({ part, children }) => {
          switch (part.type) {
            case 'group-chainOfThought':
              return <div>{children}</div>;
            // The starter's ToolGroupRoot, closed until someone opens it (tool-group.aui.tsx: defaultOpen = false).
            case 'group-tool':
              return (
                <details data-testid="tool-group">
                  <summary>{part.indices.length} tool calls</summary>
                  {children}
                </details>
              );
            case 'text':
              return <p>{part.text}</p>;
            case 'tool-call':
              return part.toolUI ?? <ToolFallback {...part} />;
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
    </MessagePrimitive.Root>
  );
}

/** The starter's tool fallback, a card that renders nothing the kit needs. */
const StarterToolFallback: ToolCallMessagePartComponent = ({ toolName }) => <p>{toolName}</p>;

function Starter({
  config,
  ToolFallback = StarterToolFallback,
}: {
  config?: AuiConfig;
  ToolFallback?: ToolCallMessagePartComponent;
}) {
  const runtime = useLocalRuntime(model);
  useEffect(() => {
    runtime.thread.append('Add rate limiting to the chat route');
  }, [runtime]);
  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages>
          {({ message }) => (message.role === 'assistant' ? <StarterMessage ToolFallback={ToolFallback} /> : null)}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

describe('In the assistant-ui starter', () => {
  it('registers the review tool and the gated tool as standalone toolkit entries', () => {
    expect(documentedToolkit()).toEqual({
      review_changes: { type: 'backend', display: 'standalone', render: ReviewToolUI },
      run_command: { type: 'backend', display: 'standalone', render: ApprovalToolUI },
    });
    expect(code).toContain('const config = AuiConfig({ tools: Tools({ toolkit }) });');
    expect(code).toContain('<AssistantRuntimeProvider runtime={runtime} config={config}>');
    // Deprecated in assistant-ui 0.15 for toolkit entries.
    expect(code).not.toContain('useAssistantToolUI');
  });

  it('shows the review and the approval card outside the closed tool group', async () => {
    render(<Starter config={AuiConfig({ tools: Tools({ toolkit: documentedToolkit() }) })} />);
    expect(await screen.findByRole('button', { name: 'Accept all' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeVisible();
    expect(screen.queryByTestId('tool-group')).toBeNull();
  });

  it.each([
    [
      "signoffTools() through the thread's ToolFallback",
      () => {
        const tools = signoffTools({ review: ['review_changes'] });
        const ToolFallback: ToolCallMessagePartComponent = (props) => {
          const Component = tools.by_name[props.toolName] ?? tools.Fallback;
          return <Component {...props} />;
        };
        return <Starter ToolFallback={ToolFallback} />;
      },
    ],
    [
      "the same entries without display: 'standalone'",
      () => {
        const toolkit = {
          review_changes: { type: 'backend', render: ReviewToolUI },
          run_command: { type: 'backend', render: ApprovalToolUI },
        } satisfies Toolkit;
        return <Starter config={AuiConfig({ tools: Tools({ toolkit }) })} />;
      },
    ],
  ])('without it, %s renders them inside the closed group', async (_case, app) => {
    render(app());
    const review = await screen.findByRole('button', { name: 'Accept all' });
    const group = screen.getByTestId('tool-group');
    expect(group).toContainElement(review);
    expect(group).toContainElement(screen.getByRole('button', { name: /^Approve/ }));
    expect(review).not.toBeVisible();
  });

  it('continues the run on approval answers, which the starter leaves out', () => {
    expect(code).toMatch(
      /sendAutomaticallyWhen: \(chat\) =>\n\s+lastAssistantMessageIsCompleteWithToolCalls\(chat\) \|\| lastAssistantMessageIsCompleteWithApprovalResponses\(chat\),/,
    );
    expect(starter).toMatch(/\*\*`sendAutomaticallyWhen`:\*\* .*lastAssistantMessageIsCompleteWithApprovalResponses/);
  });

  it("imports useChatRuntime from @assistant-ui/ai-sdk, as new starters do, and says it's the same hook", () => {
    expect(code).toMatch(/^import \{ [^}]*useChatRuntime[^}]* \} from '@assistant-ui\/ai-sdk';$/m);
    expect(starter).toMatch(/\*\*`@assistant-ui\/ai-sdk`:\*\* .*`@assistant-ui\/react-ai-sdk`/);
  });

  it('is where the assistant-ui section and the README send people with the starter', () => {
    const intro = assistantUi.split('\n\n')[1] ?? '';
    expect(intro).toContain('`components.tools`');
    expect(intro).toContain('](/docs/chat-ui#in-the-assistant-ui-starter)');
    const bullet = readme.split('\n').find((line) => line.startsWith('- **assistant-ui:**')) ?? '';
    expect(bullet).toContain('](https://signoff-ui.vercel.app/docs/chat-ui#in-the-assistant-ui-starter)');
  });
});
