/**
 * A risk level for an approval card from what an MCP server says about its own tools. No React
 * here, so servers can call it too.
 */
import type { RiskLevel } from './labels';

/** The hints of an MCP tool's `annotations` (`ToolAnnotations` in the MCP schema) that rate a risk. */
type Hints = { readOnlyHint?: unknown; destructiveHint?: unknown; openWorldHint?: unknown };

/**
 * A risk level from an MCP tool's annotations, for `ToolMeta.risk` or the card's `risk`. AI SDK 7's
 * MCP client puts them on each tool's `metadata.annotations`, and on its calls' parts as
 * `toolMetadata.annotations`. The first that applies: `'high'` for a tool its server marks
 * destructive (`destructiveHint: true`), `'low'` for one it marks read-only (`readOnlyHint: true`),
 * and `'medium'` for one it marks as changing things (`readOnlyHint: false`) or as reaching outside
 * systems, such as the web (`openWorldHint: true`).
 *
 * Only hints the server set count. The MCP spec reads a missing `destructiveHint` or
 * `openWorldHint` as `true`, which would rate every tool with no annotations as risky: a tool with
 * none of these hints gets `undefined`, and its card shows no risk. A value other than `true` or
 * `false` counts as missing.
 *
 * A hint, not a guarantee: a server describes its own tools, and one you don't trust can mark a
 * tool that deletes as read-only. Show it to a person; don't let it decide an approval.
 */
export function riskFromMcpAnnotations(annotations: unknown): RiskLevel | undefined {
  if (typeof annotations !== 'object' || annotations === null) return undefined;
  const { readOnlyHint, destructiveHint, openWorldHint } = annotations as Hints;
  if (destructiveHint === true) return 'high';
  if (readOnlyHint === true) return 'low';
  if (readOnlyHint === false || openWorldHint === true) return 'medium';
  return undefined;
}
