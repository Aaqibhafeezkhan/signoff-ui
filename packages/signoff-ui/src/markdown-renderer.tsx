'use client';

import { createContext, memo, useContext, type ComponentType, type ReactNode } from 'react';
import type { SignoffLabelsInput } from './lib/labels';
import { cn } from './lib/utils';

/*
 * The seam between the components that show text (AgentMessage, Reasoning) and the renderer that
 * turns it into markup. Nothing here imports react-markdown: the built-in `Markdown` is bound in
 * agent-message.tsx and reasoning.tsx, and `signoff-ui/custom-markdown` binds plain text instead.
 */

/** What a Markdown renderer gets for each text part, and for the reasoning. */
export interface MarkdownRendererProps {
  /** The text, as Markdown. */
  children: string;
  /** The text is still arriving: a renderer can close unterminated syntax and show a caret. */
  streaming: boolean;
  /**
   * The number of the message's sources. `[n]` markers up to it can link to
   * `#${citationPrefix}-${n}`, the ids `AgentMessage` gives its sources. 0 in reasoning.
   */
  citations: number;
  /** The start of those ids. */
  citationPrefix: string;
  /** Where images may load from, as the component got it: see `MarkdownProps.allowedImageHosts`. */
  allowedImageHosts: readonly string[] | undefined;
}

/** Renders text as markup instead of the built-in `Markdown`: Streamdown, or your own. */
export type MarkdownRenderer = (props: MarkdownRendererProps) => ReactNode;

const MarkdownRendererContext = createContext<MarkdownRenderer | undefined>(undefined);

export interface MarkdownRendererProviderProps {
  /** The renderer for every `AgentMessage` and `Reasoning` inside. `undefined` restores the built-in one. */
  renderMarkdown: MarkdownRenderer | undefined;
  children?: ReactNode;
}

/**
 * Sets the Markdown renderer of every `AgentMessage` and `Reasoning` inside, unless one has its
 * own `renderMarkdown`. Keep the function stable: a new one renders every text part again.
 */
export function MarkdownRendererProvider({ renderMarkdown, children }: MarkdownRendererProviderProps) {
  return <MarkdownRendererContext.Provider value={renderMarkdown}>{children}</MarkdownRendererContext.Provider>;
}

/** The renderer to use: the component's own, else the nearest provider's. `undefined` means the built-in one. */
export function useMarkdownRenderer(renderMarkdown: MarkdownRenderer | undefined) {
  const fromContext = useContext(MarkdownRendererContext);
  return renderMarkdown ?? fromContext;
}

/** What the built-in renderer gets: the same, and the component's own class names and labels. */
export interface BuiltInMarkdownProps extends Partial<Omit<MarkdownRendererProps, 'children'>> {
  children: string;
  className?: string;
  labels?: SignoffLabelsInput | undefined;
}

/** The renderer a component falls back to: `Markdown`, or plain text in `signoff-ui/custom-markdown`. */
export type BuiltInMarkdown = ComponentType<BuiltInMarkdownProps>;

/** Without a renderer, `signoff-ui/custom-markdown` shows the text as it is, with its line breaks. */
export function PlainText({ children, className }: BuiltInMarkdownProps) {
  return (
    <div
      data-signoff
      data-slot="signoff-markdown"
      className={cn(
        'font-signoff-sans text-signoff-fg text-[14.5px] leading-[1.7] [overflow-wrap:anywhere] whitespace-pre-wrap',
        className,
      )}
    >
      {children}
    </div>
  );
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((item, i) => item === b[i]));

type CustomProps = MarkdownRendererProps & { render: MarkdownRenderer; className?: string | undefined };

/** Shallow, except that `allowedImageHosts` compares by value, as `Markdown` does. */
const sameProps = (prev: CustomProps, next: CustomProps) =>
  prev.render === next.render &&
  prev.className === next.className &&
  prev.children === next.children &&
  prev.streaming === next.streaming &&
  prev.citations === next.citations &&
  prev.citationPrefix === next.citationPrefix &&
  sameList(prev.allowedImageHosts, next.allowedImageHosts);

/**
 * Your renderer's output. In a component of its own, so a renderer can use hooks and finished text
 * does not render again on every streamed delta; in a slot, since it is your app's markup.
 */
export const CustomMarkdown = memo(function CustomMarkdown({ render, className, ...props }: CustomProps) {
  return (
    <div data-signoff-slot className={className}>
      {render(props)}
    </div>
  );
}, sameProps);
