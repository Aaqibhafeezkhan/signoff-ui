import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class names, resolving Tailwind utility conflicts (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** True when a keyboard event originates from a text-entry control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(type);
  }
  return false;
}

/**
 * True for a key pressed on the app's own content inside a component: an element in a
 * `data-signoff-slot` within it (such as `ApprovalCard`'s `preview`), or a portal rendered from
 * there, such as a menu, whose keys reach the component through React but come from outside its
 * element. A component that is itself in another component's slot still gets its keys, since that
 * slot is outside it.
 */
export function fromSlot(event: { target: EventTarget | null; currentTarget: Element }): boolean {
  const { target, currentTarget } = event;
  if (!(target instanceof Element)) return false;
  if (!currentTarget.contains(target)) return true;
  const slot = target.closest('[data-signoff-slot]');
  return slot !== null && currentTarget.contains(slot);
}

/** True for a promise or any other thenable, e.g. what an async event handler returns. */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** True when a key event carries a modifier we should not intercept. */
export function hasModifier(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  return event.altKey || event.ctrlKey || event.metaKey;
}

/** Heading levels a component title can render as. */
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;
