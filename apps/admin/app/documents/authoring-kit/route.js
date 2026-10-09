// GET /documents/authoring-kit → the authoring and style kit as ONE
// self-contained .html download (docs/systems/documents.md "Authoring kit").
// Built on every request from the live stylesheet (Style Kit, embedded
// verbatim in the page's <style>), the template rules and the coverage keys,
// so it never drifts from what the editor does. Any signed-in role: it holds
// no personal data, only the site's public vocabulary and writing rules.
import { listStyleRules } from '@uccsite/db/documents';
import { getSession } from '../../../lib/auth';
import { withDb } from '../../../lib/data';
import { loadSiteSources, styleKitFor, siteCssDrift } from '../../../lib/documents';
import { buildAuthoringKitHtml } from '../../../lib/authoring-kit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return new Response('Forbidden', { status: 403 });
  const { rules, coverageKeys } = await withDb(async (client) => ({
    rules: await listStyleRules(client),
    coverageKeys: (await client.query(`SELECT slug FROM projects WHERE slug IS NOT NULL AND slug <> '' ORDER BY sort_order`)).rows.map(r => r.slug), // {{coverage:<project slug>}}
  }));
  const sources = await loadSiteSources();
  const kit = styleKitFor(sources.siteCss, '');
  // The :root block (palette, fonts, widths) so the catalog's var(--x) reads.
  const designTokens = (String(sources.siteCss || '').match(/:root\s*\{([^}]*)\}/) || [])[1] || '';
  const notice = siteCssDrift(sources) || '';
  const html = buildAuthoringKitHtml({ kit, rules, coverageKeys, designTokens, siteCss: sources.siteCss, notice });
  console.log(`[documents] authoring kit for ${session.email}: ${kit.entries.length} classes, ${rules.filter(r => r.scope === 'template').length} template rules, ${coverageKeys.length} coverage keys, ${html.length} chars html${notice ? ', STALE live stylesheet' : ''}`);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="ucc-authoring-kit-${new Date().toISOString().slice(0, 10)}.html"`,
      'Cache-Control': 'no-store',
    },
  });
}
