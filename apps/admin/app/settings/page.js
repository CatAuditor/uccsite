// Site Settings editor — the first collection editor and the pattern for the
// rest: load via packages/db/content, save via its write helpers, every save
// records a revision snapshot + audit row, authorization enforced in the
// server action (requireRole), never in UI state.
import { revalidatePath } from 'next/cache';
import { createRequire } from 'node:module';
import { requireRole, getSession } from '../../lib/auth';
import { withDb, recordChange } from '../../lib/data';

const require = createRequire(import.meta.url);
const { loadContent, saveSettings } = require('@uccsite/db/content');

export const dynamic = 'force-dynamic';

const FIELDS = [
  ['orgName', 'Organization Name'],
  ['orgNameShort', 'Short Name'],
  ['email', 'Contact Email'],
  ['instagram', 'Instagram URL'],
  ['footerTagline', 'Footer Tagline'],
  ['copyright', 'Copyright Line'],
  ['turnstileSiteKey', 'Turnstile Site Key (blank = no CAPTCHA widget)'],
];

export default async function SettingsPage() {
  const session = await getSession();
  const { settings } = await withDb(loadContent);

  async function save(formData) {
    'use server';
    const s = await requireRole('editor');
    const next = Object.fromEntries(FIELDS.map(([key]) => [key, String(formData.get(key) ?? '').trim()]));
    await withDb(async (client) => {
      const before = (await loadContent(client)).settings;
      await saveSettings(client, next);
      await recordChange(client, {
        actor: s.email, action: 'settings.save', entityType: 'settings', entityId: 'singleton',
        snapshot: before, diff: { before, after: next },
      });
    });
    revalidatePath('/settings');
  }

  const readOnly = session?.role === 'viewer';
  return (
    <div>
      <h1>Site Settings</h1>
      {readOnly && <p className="notice">Viewer role — read-only.</p>}
      <form className="editor" action={save}>
        {FIELDS.map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key}>{label}</label>
            <input type="text" id={key} name={key} defaultValue={settings[key] ?? ''} disabled={readOnly} />
          </div>
        ))}
        {!readOnly && <button type="submit">Save</button>}
      </form>
      <p className="notice">Saves change the database only — the live site updates on the next Publish.</p>
    </div>
  );
}
