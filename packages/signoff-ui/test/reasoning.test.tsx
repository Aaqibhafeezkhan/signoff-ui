import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Reasoning } from '../src/reasoning';

describe('Reasoning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens while streaming and closes when streaming ends', () => {
    const { rerender } = render(<Reasoning text="Thinking..." streaming />);

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute('aria-expanded', 'true');

    vi.setSystemTime(1000);
    rerender(<Reasoning text="Finished thinking." streaming={false} />);

    expect(screen.getByRole('button', { name: 'Thought for 1.00s' })).toHaveAttribute('aria-expanded', 'false');
  });

  it("keeps the reader's choice when streaming ends", () => {
    const { rerender } = render(<Reasoning text="Thinking..." streaming />);
    const toggle = screen.getByRole('button', { name: 'Thinking' });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    vi.setSystemTime(1000);
    rerender(<Reasoning text="Finished thinking." streaming={false} />);

    expect(screen.getByRole('button', { name: 'Thought for 1.00s' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the measured duration when streaming ends', () => {
    const { rerender } = render(<Reasoning text="Thinking..." streaming />);

    vi.setSystemTime(3200);
    rerender(<Reasoning text="Finished thinking." streaming={false} />);

    expect(screen.getByRole('button', { name: 'Thought for 3.20s' })).toBeInTheDocument();
  });

  it('uses durationMs instead of the measured duration', () => {
    const { rerender } = render(<Reasoning text="Thinking..." streaming durationMs={4200} />);

    vi.setSystemTime(3200);
    rerender(<Reasoning text="Finished thinking." streaming={false} durationMs={4200} />);

    expect(screen.getByRole('button', { name: 'Thought for 4.20s' })).toBeInTheDocument();
  });

  it('shows the plain Reasoning label if it never streamed and has no duration', () => {
    render(<Reasoning text="A previous thought." />);

    expect(screen.getByRole('button', { name: 'Reasoning' })).toBeInTheDocument();
  });

  it('keeps controlled open state independent of streaming and calls onOpenChange', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Reasoning text="Thinking..." streaming open={false} onOpenChange={onOpenChange} />,
    );
    const toggle = screen.getByRole('button', { name: 'Thinking' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    vi.setSystemTime(1000);
    rerender(<Reasoning text="Finished thinking." streaming={false} open={false} onOpenChange={onOpenChange} />);
    expect(screen.getByRole('button', { name: 'Thought for 1.00s' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Thought for 1.00s' }));

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Thought for 1.00s' })).toHaveAttribute('aria-expanded', 'false');
  });
});
