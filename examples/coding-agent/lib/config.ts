import type { ModelPricing } from 'signoff-ui/core';

/** The real model when live mode is on and OPENAI_MODEL is not set. */
export const DEFAULT_LIVE_MODEL = 'gpt-5.4-mini';

/**
 * The real model's id when the server has OPENAI_API_KEY and LIVE_MODE=1, else `undefined`: the page
 * then offers only the scripted agent, and the route refuses live runs. The key alone is not enough:
 * the route has no rate limit or budget, so with live mode on, anyone who can reach it runs the model
 * on that key. Reads the environment; call it on the server.
 */
export function liveModelId(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  return env.LIVE_MODE === '1' && env.OPENAI_API_KEY ? env.OPENAI_MODEL || DEFAULT_LIVE_MODEL : undefined;
}

/** USD per million tokens, for the run meter's estimate. Example prices: set your model's. */
export const PRICING: ModelPricing = { input: 2.5, cachedInput: 0.25, output: 10 };
