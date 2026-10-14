import type { BudgetOptions } from 'ondocs/server';
import { MCP_PATH } from '../../../lib/ask';
import { SITE_URL } from '../../../lib/site';

/**
 * Ask's daily cap for the whole site, so rotating addresses can't run up the bill. Raised for
 * launch week from 300 questions and 1M model tokens: an answer is about 3k tokens, so 5M leaves
 * about 3,300 for each of the 1,500 questions and the token cap doesn't run out first. Back to 300
 * and 1M after launch week. Both count in memory, per server instance; the hard cap is the spend
 * limit on the OpenAI project. Once the day's budget is spent, the dialog shows `message`.
 */
export const ASK_BUDGET = {
  requestsPerDay: 1_500,
  tokensPerDay: 5_000_000,
  message: `Ask has answered all the questions it can today. The docs are at ${SITE_URL}/docs, and your agent can search them over MCP: ${SITE_URL}${MCP_PATH}`,
} satisfies BudgetOptions;
