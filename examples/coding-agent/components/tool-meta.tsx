import { inferLanguage, Markdown, type RiskLevel, type ToolMeta } from 'signoff-ui';
import { REPO } from '@/lib/project';
import type { CommandResult } from '@/lib/shell';
import { DiffIcon, FileIcon, FolderIcon, TerminalIcon } from './icons';

const field = (key: string) => (input: unknown) =>
  input && typeof input === 'object' && key in input ? String((input as Record<string, unknown>)[key]) : undefined;

/** How risky a command is, for its approval card. */
export function commandRisk(input: unknown): RiskLevel {
  const command = (field('command')(input) ?? '').trim();
  if (/\brm\s+-\w*r/.test(command)) return 'critical';
  if (/^(?:npm (?:run )?test|node --test|git (?:status|diff))(?:\s|$)/.test(command)) return 'low';
  if (/^git commit(?:\s|$)/.test(command)) return 'medium';
  return 'high';
}

/** A file's contents as a Markdown code block: four backticks, so a README's own fences stay inside. */
const codeBlock = (path: string, content: string) => `\`\`\`\`${inferLanguage(path)}\n${content.trimEnd()}\n\`\`\`\``;

/** How each tool shows in the timeline and on its approval card. */
export const TOOL_META: Record<string, ToolMeta> = {
  list_files: {
    label: 'List files',
    icon: <FolderIcon />,
    summary: () => REPO,
    risk: 'low',
    renderOutput: (output) => (
      <ul className="file-list" aria-label="Files">
        {(output as { files: Array<{ path: string; lines: number }> }).files.map((file) => (
          <li key={file.path}>
            <span>{file.path}</span>
            <span className="muted">{file.lines} lines</span>
          </li>
        ))}
      </ul>
    ),
  },
  read_file: {
    label: 'Read file',
    icon: <FileIcon />,
    summary: field('path'),
    risk: 'low',
    renderOutput: (output) => {
      const file = output as { path: string; content: string };
      return <Markdown>{codeBlock(file.path, file.content)}</Markdown>;
    },
  },
  run_command: {
    label: 'Run command',
    icon: <TerminalIcon />,
    summary: field('command'),
    risk: commandRisk,
    renderOutput: (output) => {
      const result = output as CommandResult;
      return (
        <div className="terminal">
          <pre>{result.output}</pre>
          <p className="terminal-meta">Exit code {result.exitCode} · simulated over the files, nothing ran</p>
        </div>
      );
    },
  },
  review_changes: {
    label: 'Propose changes',
    icon: <DiffIcon />,
  },
};
