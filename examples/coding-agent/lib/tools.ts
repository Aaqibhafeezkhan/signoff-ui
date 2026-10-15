import { tool } from 'ai';
import type { DiffReviewToolOutput } from 'signoff-ui/core';
import { z } from 'zod';
import { pause } from './pace';
import { listPaths, type Files } from './project';
import { runCommand } from './shell';
import { normalizePath } from './workspace';

const lineCount = (text: string) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

/**
 * The agent's tools, over the project as the run has left it. Reads and commands run on the server
 * once the approval rules (app/api/agent/route.ts) or a person allow them; `review_changes` has no
 * `execute`: the page answers it with a review.
 */
export function createTools(files: Files) {
  return {
    list_files: tool({
      description: 'List the files in the repository, with their line counts.',
      inputSchema: z.object({}),
      execute: async (_input, { abortSignal }) => {
        await pause(180, abortSignal);
        return { files: listPaths(files).map((path) => ({ path, lines: lineCount(files[path]!) })) };
      },
    }),
    read_file: tool({
      description: 'Read a file from the repository.',
      inputSchema: z.object({ path: z.string().describe('The path from the repository root, e.g. src/index.ts') }),
      execute: async ({ path }, { abortSignal }) => {
        await pause(220, abortSignal);
        const key = normalizePath(path);
        const content = files[key];
        if (content === undefined) throw new Error(`ENOENT: no such file or directory, open '${key}'`);
        return { path: key, content };
      },
    }),
    run_command: tool({
      description:
        'Run a shell command in the repository. Available: npm test, git status, git diff, git commit -am "message" and git push. Commands are simulated over the files.',
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }, { abortSignal }) => {
        await pause(/^(?:npm|node)\b/.test(command.trim()) ? 1400 : 450, abortSignal);
        return runCommand(command, files);
      },
    }),
    // No execute: the page shows a DiffReview, and its result comes back as this call's output.
    review_changes: tool({
      description:
        'Propose edits for the person to review hunk by hunk. Pass every file you change, with its full new contents. ' +
        'Nothing is written until they apply it; the result has each file as applied, the hunks they rejected and their comments.',
      inputSchema: z.object({
        files: z
          .array(
            z.object({
              path: z.string().describe('The path from the repository root'),
              content: z.string().describe('The whole file as it should be'),
            }),
          )
          .min(1),
      }),
      // What the page sends back: reviewToolOutput(review). Messages typed with InferUITools take it from here.
      outputSchema: z.custom<DiffReviewToolOutput>(),
    }),
  };
}

export type AgentTools = ReturnType<typeof createTools>;

/** The input `review_changes` takes. */
export interface ProposedFiles {
  files: Array<{ path: string; content: string }>;
}
