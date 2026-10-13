import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';
import { askEnabled, loadAskIndex } from '@/lib/ask';

/*
 * Ask, the header's ⌘K dialog: a short answer from the docs, citing them, written by OpenAI with
 * the server's OPENAI_API_KEY (and OPENAI_MODEL, as live mode uses). Without a key there is no
 * Ask, and this answers 404.
 *
 * The limits are ondocs.vercel.app's own. Five questions a minute per visitor, a burst of five then
 * one every 12 seconds, keyed by the last X-Forwarded-For entry, which Vercel sets. A daily cap for
 * the whole site, so rotating addresses can't run up the bill: 300 questions and 1M model tokens a
 * day (an answer is about 3k). Both count in memory, per server instance; the hard cap is the spend
 * limit on the OpenAI project. A repeated question is answered from memory, with no model call.
 */
const ask = askEnabled()
  ? createAskHandler({
      index: loadAskIndex,
      model: createOpenAI()(process.env.OPENAI_MODEL ?? 'gpt-5.4-mini'),
      siteName: 'the signoff-ui docs',
      rateLimit: memoryRateLimit({ limit: 5, windowMs: 60_000 }),
      budget: { requestsPerDay: 300, tokensPerDay: 1_000_000 },
      answerCache: true,
    })
  : undefined;

export function POST(request: Request) {
  return ask ? ask(request) : Response.json({ error: 'Ask is not available on this site.' }, { status: 404 });
}
