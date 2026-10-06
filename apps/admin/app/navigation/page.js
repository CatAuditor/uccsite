// Menus editor: the site's header menu, footer columns and footer bottom links
// (docs/systems/navigation.md). Stored as site_settings.navigation (JSON).
// Same pattern as Site Settings: one transaction holding the lost-update check,
// the save, the revision snapshot and the audit row. The action name
// `settings.navigation` matches publishing's content filter, so a menu change
// counts as unpublished, and Revisions can restore it (entityType 'settings').
import { revalidatePath } from 'next/cache';
import { loadSettings, saveSettings } from '@uccsite/db/content';
import { listDocuments } from '@uccsite/db/documents';
import { PAGES } from '@uccsite/render';
import { DEFAULT_NAVIGATION, normalizeNavigation } from '@uccsite/render/navigation';
import { requireRole, requireSession } from '../../lib/auth';
import { withDb, withWriteTx, recordChange, singletonStamp } from '../../lib/data';
import { runAction } from '../../lib/actions';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import RequestPublish from '../request-publish';
import NavEditor from './nav-editor';

export const dynamic = 'force-dynamic';

const PAGE_NAMES = {
  index: 'Homepage', team: 'Team & Bios', blog: 'News & Media', statements: 'Statements', issues: 'Policy Positions',
  projects: 'Projects', tip: 'Submit a Tip', success: 'Donation thank-you', petition: 'Petition', '404': 'Not found',
};
const ANCHORS = [
  ['/#mission', 'Homepage → Mission'], ['/#issues', 'Homepage → Issues'],
  ['/#join', 'Homepage → Join / Get Involved'], ['/#donate', 'Homepage → Donate'],
  ['/newsletters', 'Newsletter archive'], ['mailto:{email}', 'Email us (the address in Site Settings)'],
];

// Everything a menu item can point at, for the link picker. Published
// Documents are the site's own pages (privacy, reports, …); Draft ones are
// listed too, marked, so a menu can be prepared before a page goes live.
async function pageOptions(client) {
  const opts = [];
  for (const { template, sitemap } of PAGES) {
    const key = template.replace(/\.html$/, '');
    if (sitemap === false && !PAGE_NAMES[key]) continue;
    if (key.includes('/') || key === '404' || key === 'petition-thanks') continue;
    opts.push([key === 'index' ? '/' : `/${template}`, PAGE_NAMES[key] || key]);
  }
  for (const d of await listDocuments(client)) {
    opts.push([`/${d.slug}.html`, `${d.title}${d.status === 'published' ? '' : ` (${d.status} — not live)`}`]);
  }
  return [...opts, ...ANCHORS].map(([value, label]) => ({ value, label }));
}

export default async function NavigationPage() {
  const session = await requireSession();
  const { settings, baseline, options } = await withDb(async (client) => ({
    settings: await loadSettings(client),
    baseline: await singletonStamp(client, 'site_settings'),
    options: await pageOptions(client),
  }));
  const nav = normalizeNavigation(settings.navigation) || DEFAULT_NAVIGATION;
  const usingDefaults = !normalizeNavigation(settings.navigation);

  async function save(prevState, formData) {
    'use server';
    return runAction(async () => {
      const s = await requireRole('editor');
      let raw;
      try { raw = JSON.parse(String(formData.get('payload') || '')); } catch { throw new Error('The menu could not be read. Reload the page and try again.'); }
      const next = normalizeNavigation(raw);
      if (!next) throw new Error('The header menu needs at least one item with a label and a link.');
      const expected = String(formData.get('baseline') ?? '');
      await withWriteTx(async (client) => {
        const current = await singletonStamp(client, 'site_settings');
        if (expected && current !== expected) throw new Error(CONFLICT_MESSAGE);
        const before = await loadSettings(client);
        await saveSettings(client, { ...before, navigation: next });
        await recordChange(client, {
          actor: s.email, action: 'settings.navigation', entityType: 'settings', entityId: 'singleton',
          snapshot: before,
          diff: { header: next.header.length, columns: next.footer.columns.length, bottom: next.footer.bottom.length },
        });
      });
      revalidatePath('/navigation');
      return { ok: true, message: 'Menus saved. Publish to make them live.' };
    });
  }

  return (
    <div>
      <h1>Menus</h1>
      <p className="notice">
        The menu at the top of every page and the links in the footer. Drag nothing — use the arrows to reorder,
        <strong> Into dropdown</strong> / <strong>Out of dropdown</strong> to move a link between levels, and the
        link box to pick any page (or type any address). To add a brand-new page, create it in{' '}
        <a href="/documents">All documents</a> first; it then appears in the link picker here.
        {usingDefaults && ' These are the menus the site has always had — nothing has been edited here yet.'}
      </p>
      <NavEditor initial={nav} options={options} baseline={baseline} save={save} readOnly={session.role === 'viewer'}
        requestPublish={<RequestPublish />} />
      <p className="notice">Saving keeps this as a draft. It goes live with the next publish (Publish &amp; Status).</p>
    </div>
  );
}
