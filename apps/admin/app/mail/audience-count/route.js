// GET /mail/audience-count?residency=&donors=&petition=&history=&list= → { count, description }
// for the composer's "Apply filters" button (docs/systems/newsletters.md
// "Audience"): the same audienceCount the page shows for the SAVED filters,
// run on the filters currently chosen, without saving. Any signed-in admin
// (the page shows the saved count to viewers too); nothing is written.
import { getSession } from '../../../lib/auth';
import { withDb } from '../../../lib/data';
import { audienceInfo } from '../../../lib/newsletters';
import { normalizeFilters } from '@uccsite/db/audience';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!(await getSession())) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const filters = normalizeFilters({ residency: q.get('residency'), donors: q.get('donors'), petition: q.get('petition'), history: q.get('history'), list: q.get('list') });
  try {
    const { count, description, missing } = await withDb((client) => audienceInfo(client, filters));
    console.log(`[newsletter] audience-count ${description} -> ${count}`);
    if (missing) return Response.json({ error: 'That saved list no longer exists' }, { status: 404 });
    return Response.json({ count, description }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`[newsletter] audience-count failed: ${err?.message}`);
    return Response.json({ error: 'Could not count the audience' }, { status: 500 });
  }
}
