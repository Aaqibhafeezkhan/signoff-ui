'use client';

import { inferLanguage, Markdown } from 'signoff-ui';
import { createContext, useContext, type ReactNode } from 'react';
import { codeKey } from '@/lib/terminal';
import { CodeScroll, CopyCodeButton } from './docs/code';

/** Build-time highlighting of the files the demos read (lib/demo-code.ts), by `codeKey` of their content. */
const HighlightedFiles = createContext<Record<string, string>>({});

export function HighlightedFilesProvider({ files, children }: { files: Record<string, string>; children: ReactNode }) {
  return <HighlightedFiles value={files}>{children}</HighlightedFiles>;
}

/**
 * A file a tool read, as source code in the site's code block with its path in the bar. Without
 * build-time highlighting for it (a live agent reading another file), the library's Markdown
 * block highlights it instead.
 */
export function FileOutput({ path, content }: { path: string; content: string }) {
  const files = useContext(HighlightedFiles);
  const code = content.trimEnd();
  const html = files[codeKey(code)];
  if (!html) return <Markdown>{'```' + inferLanguage(path) + '\n' + code + '\n```'}</Markdown>;
  return (
    <figure data-code-block className="code-block relative">
      <figcaption className="code-title truncate pr-12">{path}</figcaption>
      <CopyCodeButton />
      <CodeScroll html={html} />
    </figure>
  );
}
