import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';
import { askEnabled, loadAskIndex } from '@/lib/ask';
import { askCount, withAskCounter } from '../counters';
import { ASK_BUDGET } from './budget';

/*
 * Ask, the header's ⌘K dialog: a short answer from the docs, citing them, written by OpenAI with
 * the server's OPENAI_API_KEY (and OPENAI_MODEL, as live mode uses). Without a key there is no
 * Ask, and this answers 404.
 *
 * The limits are ondocs.vercel.app's own. Five questions a minute per visitor, a burst of five then
 * one every 12 seconds, keyed by the last X-Forwarded-For entry, which Vercel sets. A daily cap for
 * the whole site (./budget.ts). A repeated question is answered from memory, with no model call.
 *
 * Each question posted and each answer logs a counter line (../counters.ts): how it was answered,
 * and the tokens it spent, never the question.
 */
const answers = askEnabled()
  ? createAskHandler({
      index: loadAskIndex,
      model: createOpenAI()(process.env.OPENAI_MODEL ?? 'gpt-5.4-mini'),
      siteName: 'the signoff-ui docs',
      rateLimit: memoryRateLimit({ limit: 5, windowMs: 60_000 }),
      budget: ASK_BUDGET,
      answerCache: true,
      onFinish: (event) => {
        console.info(JSON.stringify(askCount(event)));
      },
    })
  : undefined;
const ask = answers && withAskCounter(answers);

export function POST(request: Request) {
  return ask ? ask(request) : Response.json({ error: 'Ask is not available on this site.' }, { status: 404 });
}
