import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { liveModelId } from './config';
import { BRANCH, REPO } from './project';
import { SCRIPTED_MODEL_ID, scriptedModel } from './scripted-agent';
import type { Mode } from './types';

/**
 * The model for a run: the scripted agent, or with OPENAI_API_KEY set, a real one. `undefined` when
 * live mode is asked for without a key. Any AI SDK provider works here: swap `openai(id)` for yours.
 */
export function agentModel(mode: Mode): { model: LanguageModel; id: string } | undefined {
  if (mode === 'scripted') return { model: scriptedModel, id: SCRIPTED_MODEL_ID };
  const id = liveModelId();
  return id ? { model: openai(id), id } : undefined;
}

export const INSTRUCTIONS = `You are a coding agent working in the background on ${REPO}, a small TypeScript package, on the branch ${BRANCH}.
A person reviews your edits and approves your commands; some calls are allowed or denied by their rules without asking.
- Look before you edit: list_files, then read_file what you need.
- Run the tests with run_command ("npm test") before and after a change.
- Propose every edit with review_changes, with each changed file's full new contents. Nothing is written until the person applies it. The result says what was applied, the hunks they rejected and their comments on lines.
- When the review has comments, address them: propose a revision with review_changes, built on the files as applied. Leave rejected changes out unless a comment asks for them.
- When the tests pass, commit with run_command ("git commit -am \\"message\\""), then push the branch with "git push -u origin ${BRANCH}".
- When a call is denied, do not try it again another way: say what the person can do instead.
Write short, plain messages.`;
