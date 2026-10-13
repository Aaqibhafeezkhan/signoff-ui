import { homeOgImage, OG_SIZE } from '@/lib/og';
import { PACKAGE, TAGLINE } from '@/lib/site';

export const alt = `${PACKAGE}: ${TAGLINE} A diff hunk to accept or reject, and a command to approve.`;
export const size = OG_SIZE;
export const contentType = 'image/png';

// The headline in two sentences, as the hero has it.
export default function Image() {
  return homeOgImage('Review what your agent changed. Approve what it may do.');
}
