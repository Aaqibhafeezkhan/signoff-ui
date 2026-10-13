import { tokenizeJson, tokenizeTerminal, type TermLine } from '@/lib/terminal';
import { CodeScroll, CopyCodeButton } from './docs/code';

/*
 * Terminal output, agent output and JSON made in the browser, in the same block as the docs' code
 * (components/docs/code-block.tsx): a bar with a title and Copy, then the lines. Coloured by the
 * site's grammar (lib/terminal.ts) through the `.term-*` classes. No hooks of its own, so server
 * and client components both render it.
 */

/** Lines of output, each a block, so Copy (the text as shown) keeps one line per line. */
export function TermLines({ lines }: { lines: TermLine[] }) {
  return (
    <code>
      {lines.map((line, i) => (
        <span key={i} className="term-line">
          {line.map((token, j) =>
            token.kind ? (
              <span key={j} className={`term-${token.kind}`}>
                {token.text}
              </span>
            ) : (
              token.text
            ),
          )}
        </span>
      ))}
    </code>
  );
}

/** A framed block for output: the title in the bar (a working directory, a file, "Output"), Copy, the lines. */
export function TerminalBlock({
  title,
  text,
  lines,
  wrap = true,
  className = '',
}: {
  title: string;
  /** Output to tokenize; or `lines`, already tokenized. */
  text?: string;
  lines?: TermLine[];
  /** Output wraps by default, so it reads without scrolling sideways. */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <figure data-code-block data-wraps={wrap || undefined} className={`code-block relative ${className}`}>
      <figcaption className="code-title truncate pr-12">{title}</figcaption>
      <CopyCodeButton />
      <CodeScroll>
        {/* A scrollable group the keyboard can reach, like Shiki's blocks, named by the bar. */}
        <pre className="term" role="group" aria-label={title} tabIndex={0}>
          <TermLines lines={lines ?? tokenizeTerminal(text ?? '')} />
        </pre>
      </CodeScroll>
    </figure>
  );
}

/** JSON made in the browser, coloured as Shiki colours JSON in the docs. */
export function JsonBlock({
  value,
  title = 'JSON',
  className = '',
}: {
  value: unknown;
  title?: string;
  className?: string;
}) {
  const lines = tokenizeJson(JSON.stringify(value, null, 2) ?? 'undefined');
  return (
    <figure data-code-block data-wraps className={`code-block relative ${className}`}>
      <figcaption className="code-title code-title-language truncate pr-12">{title}</figcaption>
      <CopyCodeButton />
      <CodeScroll>
        <pre className="term" role="group" aria-label={title} tabIndex={0}>
          <code>
            {lines.map((line, i) => (
              <span key={i} className="term-line">
                {line.map((token, j) =>
                  token.kind ? (
                    <span key={j} className={`json-${token.kind}`}>
                      {token.text}
                    </span>
                  ) : (
                    token.text
                  ),
                )}
              </span>
            ))}
          </code>
        </pre>
      </CodeScroll>
    </figure>
  );
}

/** A shell command after a dim prompt; the prompt is not selected or copied with it. */
export function PromptLine({ command }: { command: string }) {
  return (
    <>
      <span className="term-prompt" aria-hidden="true">
        ${' '}
      </span>
      <span className="term-command">{command}</span>
    </>
  );
}
