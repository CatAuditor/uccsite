// GET /documents/authoring-kit → the authoring kit as a Markdown download
// (docs/systems/documents.md "Authoring kit"). Built on every request from
// the live stylesheet (Style Kit), the template rules and the coverage keys,
// so it never drifts from what the editor does. Any signed-in role: it holds
// no personal data, only the site's public vocabulary and writing rules.
import { listStyleRules } from '@uccsite/db/documents';
import { getSession } from '../../../lib/auth';
import { withDb } from '../../../lib/data';
import { loadSiteSources, styleKitFor } from '../../../lib/documents';
import { buildAuthoringKit } from '../../../lib/authoring-kit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return new Response('Forbidden', { status: 403 });
  const { rules, coverageKeys } = await withDb(async (client) => ({
    rules: await listStyleRules(client),
    coverageKeys: (await client.query('SELECT DISTINCT report_key FROM coverage_entries ORDER BY report_key')).rows.map(r => r.report_key),
  }));
  const sources = await loadSiteSources();
  const kit = styleKitFor(sources.siteCss, '');
  const md = buildAuthoringKit({ kit, rules, coverageKeys });
  console.log(`[documents] authoring kit for ${session.email}: ${kit.entries.length} classes, ${rules.filter(r => r.scope === 'template').length} template rules, ${coverageKeys.length} coverage keys, ${md.length} chars`);
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="ucc-authoring-kit-${new Date().toISOString().slice(0, 10)}.md"`,
      'Cache-Control': 'no-store',
    },
  });
}
