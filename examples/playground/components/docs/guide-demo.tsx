'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { Preview } from './preview';

/**
 * Each guide's live example, by slug, in a chunk of its own: imported here, in the browser's code,
 * only the page that renders one loads it. The docs pages share one route, and a demo imported on
 * the server would be loaded by every one of them.
 */
const DEMOS: Partial<Record<string, ComponentType>> = {
  'own-renderer': dynamic(() => import('../demos/pierre-review').then((m) => m.PierreReviewDemo)),
};

/** A guide's live example above its text, as a component page shows its own; nothing for the others. */
export function GuideDemo({ slug }: { slug: string }) {
  const Demo = DEMOS[slug];
  if (!Demo) return null;
  return (
    <div className="mb-10">
      <Preview>
        <Demo />
      </Preview>
    </div>
  );
}
