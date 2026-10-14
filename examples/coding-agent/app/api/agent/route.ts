import { convertToModelMessages, stepCountIs, streamText, validateUIMessages } from 'ai';
import { addUsage, parseApprovalRules } from 'signoff-ui/core';
import { z } from 'zod';
import { approvalFor } from '@/lib/approval';
import { agentModel, INSTRUCTIONS } from '@/lib/model';
import { createTools } from '@/lib/tools';
import type { RunMessage } from '@/lib/types';
import { filesFromMessages } from '@/lib/workspace';

export const maxDuration = 60;

const bodySchema = z.object({
  messages: z.array(z.unknown()),
  // Live only when the server turns it on (OPENAI_API_KEY and LIVE_MODE=1) and the page asks for it:
  // a key on the server spends nothing until a person picks the model.
  mode: z.enum(['scripted', 'live']).default('scripted'),
  // The person's own rules, for their own runs: parseApprovalRules keeps those within its limits
  // (100 rules, short strings, one wildcard per pattern), so a crafted rule can't hold up matching.
  rules: z.unknown().optional(),
});

export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: 'Expected { messages, mode, rules }.' }, { status: 400 });
  const { mode } = body.data;
  const rules = parseApprovalRules(body.data.rules);
  let messages: RunMessage[];
  try {
    // Their shape only: a caller can still send an approval for a call the model never proposed. The
    // server's rules decide again on every approved call (see "What an approval is" in the README).
    messages = await validateUIMessages<RunMessage>({ messages: body.data.messages });
  } catch {
    return Response.json({ error: 'The messages are not valid UI messages.' }, { status: 400 });
  }
  const agent = agentModel(mode);
  if (!agent)
    return Response.json(
      { error: 'Live mode is off: it needs OPENAI_API_KEY and LIVE_MODE=1 on the server.' },
      { status: 501 },
    );

  // The project as the run has left it, rebuilt from the reviews in the messages: nothing is kept here.
  const tools = createTools(filesFromMessages(messages));
  const result = streamText({
    model: agent.model,
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    // The server's rules, then the person's, decide before anyone is asked; the card shows whose rule it was.
    toolApproval: approvalFor(rules),
    // Keep going after tool calls: the AI SDK stops after the first step by default.
    stopWhen: stepCountIs(20),
    abortSignal: req.signal,
  });

  // After a review or an approval, the run continues the same message in a new request whose
  // totalUsage starts from zero, and useChat replaces metadata.usage: add what the message had.
  const last = messages.at(-1);
  const previous = last?.role === 'assistant' ? last.metadata?.usage : undefined;

  return result.toUIMessageStreamResponse<RunMessage>({
    originalMessages: messages,
    messageMetadata: ({ part }) => {
      if (part.type === 'start') return { model: agent.id };
      if (part.type === 'finish') return { model: agent.id, usage: addUsage(previous, part.totalUsage) };
      return undefined;
    },
    // Failed tool calls show this text. The default hides every error as "An error occurred.".
    onError: (error) => (error instanceof Error ? error.message : 'An error occurred.'),
  });
}
