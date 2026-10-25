import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sources } from '../src/sources';
import { axe } from './utils';

const sources = [
  {
    type: 'source-url' as const,
    sourceId: 's1',
    url: 'https://upstash.com/docs/redis/sdks/ratelimit-ts/overview',
    title: 'Ratelimit overview',
  },
  { type: 'source-url' as const, sourceId: 's2', url: 'https://www.example.com/post' },
  {
    type: 'source-document' as const,
    sourceId: 'd1',
    mediaType: 'application/pdf',
    title: 'Runbook',
    filename: 'runbook.pdf',
  },
];

describe('Sources', () => {
  it('renders numbered chips that open in a new tab', () => {
    render(<Sources sources={sources} />);
    expect(screen.getByRole('list', { name: 'Sources' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ratelimit overview/ });
    expect(link).toHaveAttribute('href', sources[0]!.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName(/opens in a new tab/);
    // Untitled sources fall back to the hostname, without "www.".
    expect(screen.getByRole('link', { name: /example\.com/ })).toBeInTheDocument();
    // Documents are not links.
    expect(screen.getByText('Runbook')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('gives each source an id for inline citations', () => {
    const { container } = render(<Sources sources={sources} idPrefix="m1-source" />);
    expect(container.querySelector('#m1-source-1')).not.toBeNull();
    expect(container.querySelector('#m1-source-3')).not.toBeNull();
  });

  it('renders cards with descriptions and accepts plain items', () => {
    render(
      <Sources
        variant="cards"
        sources={[{ id: 'x', url: 'https://ai-sdk.dev/docs', title: 'AI SDK', description: 'Docs' }]}
      />,
    );
    expect(screen.getByText('AI SDK')).toBeInTheDocument();
    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('ai-sdk.dev')).toBeInTheDocument();
  });

  it('lays out by its own width, not the viewport', () => {
    // jsdom has no layout, so this checks the classes rather than the rendered columns.
    const { container, rerender } = render(<Sources sources={sources} variant="cards" />);
    expect(container.firstElementChild).toHaveClass('@container');
    expect(screen.getByRole('list', { name: 'Sources' })).toHaveClass('@lg:grid-cols-2');

    rerender(<Sources sources={sources} />);
    expect(container.firstElementChild).toHaveClass('@container');
    // Only a titled source shows its host name beside the title.
    expect(screen.getByText('upstash.com')).toHaveClass('hidden', '@lg:inline');
  });

  it('can hide the visible heading while keeping the accessible name', () => {
    render(<Sources sources={sources} label={null} />);
    expect(screen.getByRole('list', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.queryByText(/^Sources/)).not.toBeInTheDocument();
  });

  it('renders nothing without sources', () => {
    const { container } = render(<Sources sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no axe violations', async () => {
    const { container, rerender } = render(<Sources sources={sources} />);
    expect(await axe(container)).toHaveNoViolations();
    rerender(<Sources sources={sources} variant="cards" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
