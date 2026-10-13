/*
 * The file the ACP demo's scripted agent reads and edits (components/acp-demo.tsx). Here rather
 * than in the demo, so the server can highlight it at build time (lib/demo-code.ts).
 */

export const ROOT = '/home/dev/app';

export const BEFORE = `export function formatDuration(ms: number): string {
  if (ms < 1000) return \`\${Math.round(ms)}ms\`;
  return \`\${(ms / 1000).toFixed(1)}s\`;
}
`;

export const AFTER = `export function formatDuration(ms: number): string {
  if (ms < 1000) return \`\${Math.round(ms)}ms\`;
  // Truncate to tenths: 59,950 ms is 59.9s, not 60.0s.
  return \`\${(Math.floor(ms / 100) / 10).toFixed(1)}s\`;
}
`;
