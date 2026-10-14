/**
 * Live mode runs the playground's agent on a real model. It is opt-in: the server needs
 * OPENAI_API_KEY and LIVE_MODE=1. The key alone is not enough, because the public site sets it for
 * Ask (app/api/ask), and the chat route has no rate limit or budget of its own: with live mode on,
 * anyone who opens the page runs the model on that key.
 */
export function liveModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LIVE_MODE === '1' && Boolean(env.OPENAI_API_KEY);
}
