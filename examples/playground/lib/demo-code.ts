import { inferLanguage } from 'signoff-ui/core';
import { BEFORE, ROOT } from './acp-script';
import { highlight } from './highlight';
import { FILES, REDIS } from './scenario';
import { codeKey } from './terminal';

/*
 * The files the demos' agents read, highlighted by Shiki when the site builds, so a Read tool's
 * output is source code in the site's code block (components/file-output.tsx) without a
 * highlighter in the browser. Keyed by their content: a file the live agent reads that isn't here
 * falls back to the library's Markdown block.
 */

interface DemoFile {
  path: string;
  content: string;
}

/** What the scripted coding agent on the home page reads (lib/mock-agent.ts). */
export const PLAYGROUND_FILES: DemoFile[] = ['app/api/chat/route.ts', 'lib/redis.ts'].map((path) => ({
  path,
  content: FILES[path]!,
}));

/** What the AG-UI demo's agent reads (components/ag-ui-demo.tsx). */
export const AG_UI_FILES: DemoFile[] = [{ path: 'lib/redis.ts', content: REDIS }];

/** What the ACP demo's agent reads (components/acp-demo.tsx). */
export const ACP_FILES: DemoFile[] = [{ path: `${ROOT}/lib/format.ts`, content: BEFORE }];

/** Shiki's HTML for each file, by `codeKey` of its content. */
export async function highlightFiles(files: DemoFile[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    files.map(
      async (file) =>
        [codeKey(file.content.trimEnd()), await highlight(file.content.trimEnd(), inferLanguage(file.path))] as const,
    ),
  );
  return Object.fromEntries(entries);
}
