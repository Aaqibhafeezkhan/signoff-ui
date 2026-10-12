'use client';

import { Markdown } from './markdown';
import { ReasoningBase, type ReasoningProps } from './reasoning-base';

export type { ReasoningProps } from './reasoning-base';

/**
 * Collapsible model reasoning. Opens automatically while the model thinks and
 * collapses to a one-line "Thought for 3.2s" summary when it finishes, unless
 * the user has toggled it.
 */
export function Reasoning(props: ReasoningProps) {
  return <ReasoningBase {...props} builtInMarkdown={Markdown} />;
}
