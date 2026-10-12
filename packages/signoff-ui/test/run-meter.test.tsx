import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateCost } from '../src/lib/usage';
import { RunMeter } from '../src/run-meter';
import { axe } from './utils';

const usage = {
  inputTokens: 16_200,
  outputTokens: 2_150,
  inputTokenDetails: { cacheReadTokens: 9_000, cacheWriteTokens: undefined, noCacheTokens: 7_200 },
  outputTokenDetails: { reasoningTokens: 640, textTokens: 1_510 },
};
const pricing = { input: 2.5, cachedInput: 0.25, output: 10 };

describe('estimateCost', () => {
  it('prices fresh input, cached input and output separately', () => {
    const cost = estimateCost(usage, pricing);
    expect(cost.input).toBeCloseTo((7_200 * 2.5) / 1e6);
    expect(cost.cachedInput).toBeCloseTo((9_000 * 0.25) / 1e6);
    expect(cost.output).toBeCloseTo((2_150 * 10) / 1e6);
    expect(cost.total).toBeCloseTo(0.018 + 0.00225 + 0.0215);
  });

  it('falls back to the input price for cached tokens and handles missing usage', () => {
    expect(
      estimateCost({ inputTokens: 1e6, inputTokenDetails: { cacheReadTokens: 5e5 } }, { input: 1, output: 2 }).total,
    ).toBe(1);
    expect(estimateCost(undefined, pricing).total).toBe(0);
  });

  it('prices cache writes at the cacheWrite rate, and at the input rate without one', () => {
    // Anthropic-style usage: 2k fresh tokens and 8k written to the cache (billed at 1.25x input).
    const written = {
      inputTokens: 10_000,
      outputTokens: 0,
      inputTokenDetails: { noCacheTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 8_000 },
    };
    const cost = estimateCost(written, { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 });
    expect(cost.input).toBeCloseTo((2_000 * 3) / 1e6);
    expect(cost.cacheWrite).toBeCloseTo((8_000 * 3.75) / 1e6);
    expect(cost.total).toBeCloseTo(0.036);
    expect(estimateCost(written, { input: 3, output: 15 }).total).toBeCloseTo(0.03);
  });

  it('never prices more cached tokens than the input it was given', () => {
    const cost = estimateCost(
      { inputTokens: 100, inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 80 } },
      { input: 1e6, output: 0, cachedInput: 1e6, cacheWrite: 1e6 },
    );
    expect([cost.input, cost.cachedInput, cost.cacheWrite]).toEqual([0, 80, 20]);
  });
});

describe('RunMeter', () => {
  it('compact: shows tokens, cost and latency, with a spoken summary', () => {
    render(<RunMeter usage={usage} pricing={pricing} ttftMs={412} durationMs={8_240} />);
    const group = screen.getByRole('group', { name: 'Run metrics' });
    expect(group).toHaveTextContent('16.2k');
    expect(group).toHaveTextContent('2.15k');
    expect(group).toHaveTextContent('$0.042');
    expect(group).toHaveTextContent('412ms');
    expect(group).toHaveTextContent('8.24s');
    expect(
      screen.getByText(
        '16.2k input tokens, 2.15k output tokens, estimated cost $0.042, time to first token 412ms, total 8.24s',
      ),
    ).toBeInTheDocument();
  });

  it('compact: labels live runs', () => {
    render(<RunMeter usage={usage} live durationMs={1_000} />);
    expect(screen.getByRole('group', { name: 'Run metrics (live)' })).toBeInTheDocument();
  });

  it('expanded: shows totals, breakdown and cache hit rate', () => {
    render(
      <RunMeter
        variant="expanded"
        usage={usage}
        pricing={pricing}
        ttftMs={400}
        durationMs={4_700}
        model="mock-1"
        live
      />,
    );
    expect(screen.getByRole('heading', { name: 'Run' })).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('mock-1')).toBeInTheDocument();
    expect(screen.getByText('18.4k')).toBeInTheDocument();
    expect(screen.getByText('(9.00k cached)')).toBeInTheDocument();
    expect(screen.getByText('(640 reasoning)')).toBeInTheDocument();
    // 9,000 of 16,200 input tokens came from the prompt cache.
    expect(screen.getByText('56%')).toBeInTheDocument();
  });

  it('prefers an explicit cost over the estimate', () => {
    render(<RunMeter usage={usage} pricing={pricing} cost={1.5} />);
    expect(screen.getByRole('group')).toHaveTextContent('$1.50');
  });

  it('reads "–" for the cost, as for the tokens, until there is usage', () => {
    render(<RunMeter variant="expanded" pricing={pricing} />);
    expect(screen.getByText('Tokens').nextElementSibling).toHaveTextContent(/^–$/);
    // It said $0.00, while every token count said "–".
    expect(screen.getByText('Est. cost').nextElementSibling).toHaveTextContent(/^–$/);
    expect(screen.getByText(/input · .* output/)).toHaveTextContent('– input · – output · $2.5/$10 per 1M');
  });

  describe('as the numbers change', () => {
    let frames: FrameRequestCallback[] = [];
    beforeEach(() => {
      frames = [];
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
      vi.stubGlobal('cancelAnimationFrame', () => {});
      vi.spyOn(performance, 'now').mockReturnValue(1000);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });
    // Every figure that is moving asked for this frame.
    const frame = (at: number) =>
      act(() => {
        const due = frames;
        frames = [];
        for (const callback of due) callback(at);
      });
    const tokens = () => screen.getByText('Tokens').nextElementSibling;

    it('reaches a new value within 250 ms', () => {
      const { rerender } = render(<RunMeter variant="expanded" usage={usage} pricing={pricing} />);
      expect(tokens()).toHaveTextContent('18.4k');
      rerender(
        <RunMeter
          variant="expanded"
          usage={{ ...usage, inputTokens: 30_000, outputTokens: 5_000 }}
          pricing={pricing}
        />,
      );
      frame(1100);
      expect(tokens()).not.toHaveTextContent('35.0k');
      frame(1250);
      expect(tokens()).toHaveTextContent('35.0k');
    });

    it("starts a new run from its own numbers, not by counting down from the last run's", () => {
      const { rerender } = render(<RunMeter variant="expanded" usage={usage} pricing={pricing} />);
      expect(tokens()).toHaveTextContent('18.4k');
      // A new run: no usage yet, then its first.
      rerender(<RunMeter variant="expanded" pricing={pricing} />);
      expect(tokens()).toHaveTextContent(/^–$/);
      rerender(<RunMeter variant="expanded" usage={{ inputTokens: 1_200, outputTokens: 300 }} pricing={pricing} />);
      expect(tokens()).toHaveTextContent('1.50k');
      expect(screen.getByText('Est. cost').nextElementSibling).toHaveTextContent('$0.0060');
    });
  });

  it('has no axe violations in either variant', async () => {
    const { container, rerender } = render(
      <RunMeter usage={usage} pricing={pricing} ttftMs={412} durationMs={8_240} />,
    );
    expect(await axe(container)).toHaveNoViolations();
    rerender(<RunMeter variant="expanded" usage={usage} pricing={pricing} ttftMs={412} durationMs={8_240} live />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
