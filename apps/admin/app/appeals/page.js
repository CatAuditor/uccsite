// Donation appeals — every place the site asks for money, edited in ONE
// spot: the homepage donate section + timed modal (homepage table groups)
// and the download modal shown after any file download (site_settings
// columns, rendered by the footer partial on every page). One transaction:
// both singletons, their revision snapshots and audit rows commit together,
// with a lost-update check on BOTH stamps. Field ownership is declared in
// lib/collections.js (appeals: true / APPEAL_SETTINGS_FIELDS) so the
// Homepage and Site Settings editors leave these fields alone.
import { revalidatePath } from 'next/cache';
import { loadSettings, saveSettings, loadHomepage, saveHomepage } from '@uccsite/db/content';
import { requireSession, requireRole } from '../../lib/auth';
import { withDb, withWriteTx, recordChange, singletonStamp } from '../../lib/data';
import { HOMEPAGE_GROUPS, APPEAL_SETTINGS_FIELDS } from '../../lib/collections';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import { runAction } from '../../lib/actions';
import ActionForm from '../action-form';

export const dynamic = 'force-dynamic';

const APPEAL_GROUPS = HOMEPAGE_GROUPS.filter(g => g.appeals);

export default async function AppealsPage() {
  const session = await requireSession();
  const readOnly = session.role === 'viewer';
  const { settings, homepage, settingsBaseline, homepageBaseline } = await withDb(async (client) => ({
    settings: await loadSettings(client),
    homepage: await loadHomepage(client),
    settingsBaseline: await singletonStamp(client, 'site_settings'),
    homepageBaseline: await singletonStamp(client, 'homepage'),
  }));

  async function save(prevState, formData) {
    'use server';
    return runAction(async () => {
      const s = await requireRole('editor');
      const groups = {};
      for (const group of APPEAL_GROUPS) {
        groups[group.key] = {};
        for (const [field] of group.fields) {
          const v = String(formData.get(`${group.key}.${field}`) ?? '').trim();
          if (v) groups[group.key][field] = v;
        }
      }
      const appealSettings = Object.fromEntries(
        APPEAL_SETTINGS_FIELDS.map(([key]) => [key, String(formData.get(key) ?? '').trim()]));
      const expectedSettings = String(formData.get('settingsBaseline') ?? '');
      const expectedHomepage = String(formData.get('homepageBaseline') ?? '');
      await withWriteTx(async (client) => {
        if (expectedSettings && (await singletonStamp(client, 'site_settings')) !== expectedSettings) throw new Error(CONFLICT_MESSAGE);
        if (expectedHomepage && (await singletonStamp(client, 'homepage')) !== expectedHomepage) throw new Error(CONFLICT_MESSAGE);
        const beforeSettings = await loadSettings(client);
        const beforeHomepage = await loadHomepage(client);
        const nextSettings = { ...beforeSettings, ...appealSettings };
        const nextHomepage = { ...beforeHomepage, ...groups };
        await saveSettings(client, nextSettings);
        await saveHomepage(client, nextHomepage, { tx: false });
        await recordChange(client, {
          actor: s.email, action: 'appeals.save', entityType: 'settings', entityId: 'singleton',
          snapshot: beforeSettings, diff: { before: beforeSettings, after: nextSettings },
        });
        await recordChange(client, {
          actor: s.email, action: 'appeals.save', entityType: 'homepage', entityId: 'singleton',
          snapshot: beforeHomepage,
        });
      });
      revalidatePath('/appeals');
      revalidatePath('/homepage');
      revalidatePath('/settings');
    });
  }

  return (
    <div>
      <h1>Donation appeals</h1>
      <p className="notice">
        Every donation ask on the site, in one place. The homepage donate section and the timed modal
        render on the homepage; the download modal appears on every page after a visitor downloads a
        published project file. Blank download-modal title = no modal.
      </p>
      {readOnly && <p className="notice">Viewer role — read-only.</p>}
      <ActionForm className="editor" action={save} successMessage="Appeals saved. Publish to make them live.">
        <input type="hidden" name="settingsBaseline" value={settingsBaseline} />
        <input type="hidden" name="homepageBaseline" value={homepageBaseline} />
        {APPEAL_GROUPS.map((group) => (
          <fieldset key={group.key} className="item">
            <legend>{group.title}</legend>
            {group.fields.map(([field, label, widget, hint]) => {
              const id = `${group.key}.${field}`;
              const value = homepage[group.key]?.[field] ?? '';
              return (
                <div key={field}>
                  <label htmlFor={id}>{label}</label>
                  {widget === 'textarea'
                    ? <textarea id={id} name={id} defaultValue={value} disabled={readOnly} />
                    : <input type="text" id={id} name={id} defaultValue={value} disabled={readOnly} />}
                  {hint && <div className="hint">{hint}</div>}
                </div>
              );
            })}
          </fieldset>
        ))}
        <fieldset className="item">
          <legend>Download modal (after every file download)</legend>
          {APPEAL_SETTINGS_FIELDS.map(([key, label, widget, hint]) => (
            <div key={key}>
              <label htmlFor={key}>{label}</label>
              {widget === 'textarea'
                ? <textarea id={key} name={key} defaultValue={settings[key] ?? ''} disabled={readOnly} />
                : <input type="text" id={key} name={key} defaultValue={settings[key] ?? ''} disabled={readOnly} />}
              {hint && <div className="hint">{hint}</div>}
            </div>
          ))}
        </fieldset>
        {!readOnly && <button type="submit">Save appeals</button>}
      </ActionForm>
      <p className="notice">
        Not editable here: the "Donate" links in the nav and footer, the donate form's button, and the
        501(c)(4) legal line — those live in the templates.
      </p>
    </div>
  );
}
