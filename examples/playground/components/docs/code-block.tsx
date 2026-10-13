import { highlight } from '@/lib/highlight';
import { CodeScroll, CopyCodeButton } from './code';

// What a block's bar says without a file name.
const LANGUAGES: Record<string, string> = {
  tsx: 'TSX',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  css: 'CSS',
  json: 'JSON',
  python: 'Python',
  py: 'Python',
};

/**
 * Prose-like output wraps, so it reads without scrolling; source code keeps its lines and scrolls
 * sideways, with its right edge faded while more of it is out of view.
 */
const WRAPS = new Set(['text', 'txt', 'console', 'output', 'transcript', 'log']);

/**
 * Highlighted code under a slim bar with its file name (or its language) and a copy button, so the
 * button never covers the code. Server-rendered. `bare` drops the frame, for code inside another
 * framed block. `collapse` folds a long block behind a summary.
 */
export async function CodeBlock({
  code,
  language,
  title,
  bare = false,
  collapse = false,
}: {
  code: string;
  language?: string;
  title?: string;
  bare?: boolean;
  collapse?: boolean;
}) {
  const html = await highlight(code, language);
  const label = title ?? (language ? (LANGUAGES[language] ?? language) : 'Text');
  const block = (
    <figure
      data-code-block
      data-wraps={WRAPS.has(language ?? 'text') || undefined}
      className={`${bare ? 'code-block-bare' : 'code-block'} relative`}
    >
      <figcaption className={`code-title truncate pr-12 ${title ? '' : 'code-title-language'}`}>{label}</figcaption>
      <CopyCodeButton />
      {/* Shiki's output: escaped code in spans, from the site's own sources at build time. */}
      <CodeScroll html={html} />
    </figure>
  );
  if (!collapse) return block;
  const lines = code.split('\n').length;
  return (
    <details className="code-collapse">
      <summary>
        Show all {lines} lines{title ? ` of ${title}` : ''}
      </summary>
      {block}
    </details>
  );
}
