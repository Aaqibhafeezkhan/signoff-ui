import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};
const detectApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/**
 * Whether the reader's keyboard has ⌘ rather than Ctrl, for the shortcuts the site prints. The
 * server's HTML has ⌘ (most visitors), and other platforms switch to Ctrl once hydrated, with no
 * mismatch.
 */
export function useIsApple() {
  return useSyncExternalStore(noSubscription, detectApple, () => true);
}
