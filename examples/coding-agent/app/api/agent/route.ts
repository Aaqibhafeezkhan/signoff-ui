import { convertToModelMessages, stepCountIs, streamText, validateUIMessages } from 'ai';
import { addUsage } from 'signoff-ui/core';
import { z } from 'zod';
import { approvalFor } from '@/lib/approval';
import { agentModel, INSTRUCTIONS } from '@/lib/model';
import { createTools } from '@/lib/tools';
import type { RunMessage } from '@/lib/types';
import { filesFromMessages } from '@/lib/workspace';

export const maxDuration = 60;

/** A rule as the page sends it: the person's own, for their own runs. */
const ruleSchema = z.object({
  id: z.string().max(200),
  tool: z.string().max(200),
  args: z.record(z.string(), z.string().max(500)).optional(),
  effect: z.enum(['allow', 'deny']),
  scope: z.enum(['session', 'always']),
  reason: z.string().max(500).optional(),
});

const bodySchema = z.object({
  messages: z.array(z.unknown()),
  mode: z.enum(['scripted', 'live']).default('scripted'),
  rules: z.array(ruleSchema).max(100).default([]),
});

export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: 'Expected { messages, mode, rules }.' }, { status: 400 });
  const { mode, rules } = body.data;
  let messages: RunMessage[];
  try {
    messages = await validateUIMessages<RunMessage>({ messages: body.data.messages });
  } catch {
    return Response.json({ error: 'The messages are not valid UI messages.' }, { status: 400 });
  }
  const agent = agentModel(mode);
  if (!agent) return Response.json({ error: 'Live mode needs OPENAI_API_KEY on the server.' }, { status: 501 });

  // The project as the run has left it, rebuilt from the reviews in the messages: nothing is kept here.
  const tools = createTools(filesFromMessages(messages));
  const result = streamText({
    model: agent.model,
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    // The server's rules, then the person's, decide before anyone is asked; the reason shows on the card.
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
