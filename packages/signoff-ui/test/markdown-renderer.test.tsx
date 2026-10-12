import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import * as customMarkdown from '../src/custom-markdown';
import * as index from '../src/index';
import { MarkdownRendererProvider, type MarkdownRenderer } from '../src/markdown-renderer';
import { Reasoning } from '../src/reasoning';
import { assistant, axe } from './utils';

const HOSTS = ['images.example.com'];

const message = assistant([
  { type: 'reasoning', text: 'Check the **route**.', state: 'done' },
  { type: 'text', text: 'Add a **limiter** [1].', state: 'done' },
  { type: 'source-url', sourceId: 's1', url: 'https://upstash.com/docs', title: 'Upstash' },
]);

const custom = () => vi.fn<MarkdownRenderer>(({ children }) => <p data-testid="custom">{children}</p>);

/** The text parts' and reasoning's markup from the built-in renderer, or plain text. */
const builtIn = (container: HTMLElement) => container.querySelectorAll('[data-slot="signoff-markdown"]');

describe('renderMarkdown', () => {
  it('renders the text parts and the reasoning, in a slot, instead of the built-in Markdown', async () => {
    const renderMarkdown = custom();
    const { container } = render(
      <AgentMessage message={message} allowedImageHosts={HOSTS} renderMarkdown={renderMarkdown} />,
    );
    expect(renderMarkdown).toHaveBeenCalledWith({
      children: 'Add a **limiter** [1].',
      streaming: false,
      citations: 1,
      citationPrefix: 'msg_1-source',
      allowedImageHosts: HOSTS,
    });
    // Closed reasoning renders nothing; opened, it goes through the renderer too.
    await userEvent.setup().click(screen.getByRole('button', { name: /reasoning/i }));
    expect(renderMarkdown).toHaveBeenCalledWith({
      children: 'Check the **route**.',
      streaming: false,
      citations: 0,
      citationPrefix: 'source',
      allowedImageHosts: HOSTS,
    });
    const outputs = screen.getAllByTestId('custom');
    expect(outputs.map((p) => p.textContent)).toEqual(['Check the **route**.', 'Add a **limiter** [1].']);
    for (const output of outputs) expect(output.parentElement).toHaveAttribute('data-signoff-slot');
    expect(builtIn(container)).toHaveLength(0);
    // The sources still render, with the ids the renderer can link [n] markers to.
    expect(document.getElementById('msg_1-source-1')).not.toBeNull();
  });

  it('passes streaming for the part still arriving', () => {
    const renderMarkdown = custom();
    render(
      <AgentMessage
        message={assistant([{ type: 'text', text: 'Adding **the', state: 'streaming' }])}
        renderMarkdown={renderMarkdown}
      />,
    );
    expect(renderMarkdown).toHaveBeenLastCalledWith(expect.objectContaining({ streaming: true }));
  });

  it('renders Reasoning on its own, muted like the built-in renderer', () => {
    const renderMarkdown = custom();
    render(<Reasoning text="Planned it." defaultOpen streaming renderMarkdown={renderMarkdown} />);
    expect(renderMarkdown).toHaveBeenCalledWith(expect.objectContaining({ children: 'Planned it.', streaming: true }));
    expect(screen.getByTestId('custom').parentElement).toHaveClass('text-signoff-fg-muted');
  });

  it('keeps the built-in Markdown without one', () => {
    const { container } = render(<AgentMessage message={message} />);
    expect(builtIn(container)).toHaveLength(1);
    expect(screen.getByText('limiter').tagName).toBe('STRONG');
  });

  it('renders a finished part once while a later part streams', () => {
    const renderMarkdown = custom();
    const ui = (tail: string) => (
      <AgentMessage
        message={assistant([
          { type: 'text', text: 'First.', state: 'done' },
          { type: 'text', text: 'Second.', state: 'done' },
          { type: 'text', text: `Streaming ${tail}`, state: 'streaming' },
        ])}
        // A new array on every render, as written inline: compared by value.
        allowedImageHosts={['images.example.com']}
        renderMarkdown={renderMarkdown}
      />
    );
    const { rerender } = render(ui('a'));
    expect(renderMarkdown).toHaveBeenCalledTimes(3);
    for (const tail of ['ab', 'abc']) rerender(ui(tail));
    expect(renderMarkdown).toHaveBeenCalledTimes(3 + 2);
  });

  it('lets a renderer use hooks, as parts come and go', () => {
    const WithState: MarkdownRenderer = ({ children }) => {
      const [first] = useState(children);
      return <p data-testid="custom">{first}</p>;
    };
    const parts = (n: number) =>
      assistant(
        Array.from({ length: n }, (_, i) => ({ type: 'text' as const, text: `Part ${i}`, state: 'done' as const })),
      );
    const { rerender } = render(<AgentMessage message={parts(1)} renderMarkdown={WithState} />);
    rerender(<AgentMessage message={parts(3)} renderMarkdown={WithState} />);
    expect(screen.getAllByTestId('custom').map((p) => p.textContent)).toEqual(['Part 0', 'Part 1', 'Part 2']);
  });
});

describe('MarkdownRendererProvider', () => {
  it('sets the renderer for every AgentMessage and Reasoning inside', () => {
    const renderMarkdown = custom();
    render(
      <MarkdownRendererProvider renderMarkdown={renderMarkdown}>
        <AgentMessage message={message} />
        <Reasoning text="Planned it." defaultOpen />
      </MarkdownRendererProvider>,
    );
    expect(screen.getAllByTestId('custom').map((p) => p.textContent)).toEqual([
      'Add a **limiter** [1].',
      'Planned it.',
    ]);
  });

  it('gives way to a component’s own renderMarkdown', () => {
    const fromProvider = custom();
    const own = custom();
    render(
      <MarkdownRendererProvider renderMarkdown={fromProvider}>
        <AgentMessage message={message} renderMarkdown={own} />
      </MarkdownRendererProvider>,
    );
    expect(own).toHaveBeenCalled();
    expect(fromProvider).not.toHaveBeenCalled();
  });

  it('restores the built-in renderer with undefined', () => {
    const renderMarkdown = custom();
    const { container } = render(
      <MarkdownRendererProvider renderMarkdown={renderMarkdown}>
        <MarkdownRendererProvider renderMarkdown={undefined}>
          <AgentMessage message={message} />
        </MarkdownRendererProvider>
      </MarkdownRendererProvider>,
    );
    expect(renderMarkdown).not.toHaveBeenCalled();
    expect(builtIn(container)).toHaveLength(1);
  });

  it('is exported from both entries', () => {
    expect(index.MarkdownRendererProvider).toBe(MarkdownRendererProvider);
    expect(customMarkdown.MarkdownRendererProvider).toBe(MarkdownRendererProvider);
  });
});

describe('signoff-ui/custom-markdown', () => {
  it('renders AgentMessage with the renderer it is given', () => {
    const renderMarkdown = custom();
    const { container } = render(<customMarkdown.AgentMessage message={message} renderMarkdown={renderMarkdown} />);
    expect(screen.getByTestId('custom')).toHaveTextContent('Add a **limiter** [1].');
    expect(builtIn(container)).toHaveLength(0);
  });

  it('shows text as it is without a renderer, in the markdown slot', async () => {
    const { container } = render(
      <>
        <customMarkdown.AgentMessage message={message} />
        <customMarkdown.Reasoning text={'Line one\n**Line two**'} defaultOpen />
      </>,
    );
    const [text, reasoning] = builtIn(container);
    expect(text).toHaveTextContent('Add a **limiter** [1].');
    expect(text).toHaveClass('whitespace-pre-wrap');
    expect(reasoning!.textContent).toBe('Line one\n**Line two**');
    expect(reasoning).toHaveClass('text-signoff-fg-muted');
    expect(container.querySelector('strong')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses the provider’s renderer', () => {
    const renderMarkdown = custom();
    render(
      <customMarkdown.MarkdownRendererProvider renderMarkdown={renderMarkdown}>
        <customMarkdown.Reasoning text="Planned it." defaultOpen />
      </customMarkdown.MarkdownRendererProvider>,
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('Planned it.');
  });
});
