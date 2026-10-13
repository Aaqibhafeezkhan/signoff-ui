import { getSearchIndex } from '@/lib/docs';

// The docs search's index, built with the site; the sidebar fetches it when the search is first used.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(getSearchIndex());
}
