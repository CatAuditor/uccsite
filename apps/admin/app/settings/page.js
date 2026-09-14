// Site Settings editor — the pattern for singleton editors: load via
// packages/db/content, save inside ONE transaction with the revision
// snapshot + audit row, lost-update check on the singleton's updated_at,
// errors returned to the form (lib/actions.js), authorization in the
// server action (requireRole), never in UI state.
import { revalidatePath } from 'next/cache';
import { loadSettings, saveSettings } from '@uccsite/db/content';
import { requireRole, requireSession } from '../../lib/auth';
import { withDb, withWriteTx, recordChange, singletonStamp } from '../../lib/data';
import { SETTINGS_FIELDS } from '../../lib/collections';
import { runAction } from '../../lib/actions';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import ActionForm from '../action-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSession();
  const { settings, baseline } = await withDb(async (client) => ({
    settings: await loadSettings(client),
    baseline: await singletonStamp(client, 'site_settings'),
  }));

  async function save(prevState, formData) {
    'use server';
    return runAction(async () => {
      const s = await requireRole('editor');
      const next = Object.fromEntries(SETTINGS_FIELDS.map(([key]) => [key, String(formData.get(key) ?? '').trim()]));
      const expected = String(formData.get('baseline') ?? '');
      await withWriteTx(async (client) => {
        const current = await singletonStamp(client, 'site_settings');
        if (expected && current !== expected) throw new Error(CONFLICT_MESSAGE);
        const before = await loadSettings(client);
        // Fields owned by the Donation appeals page (APPEAL_SETTINGS_FIELDS) ride through untouched.
        const merged = { ...before, ...next };
        await saveSettings(client, merged);
        await recordChange(client, {
          actor: s.email, action: 'settings.save', entityType: 'settings', entityId: 'singleton',
          snapshot: before, diff: { before, after: merged },
        });
      });
      revalidatePath('/settings');
    });
  }

  const readOnly = session.role === 'viewer';
  return (
    <div>
      <h1>Site Settings</h1>
      {readOnly && <p className="notice">Viewer role — read-only.</p>}
      <ActionForm className="editor" action={save} successMessage="Settings saved. Publish to make them live.">
        <input type="hidden" name="baseline" value={baseline} />
        {SETTINGS_FIELDS.map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key}>{label}</label>
            <input type="text" id={key} name={key} defaultValue={settings[key] ?? ''} disabled={readOnly} />
          </div>
        ))}
        {!readOnly && <button type="submit">Save</button>}
      </ActionForm>
      <p className="notice">Saves change the database only — the live site updates on the next Publish. Donation copy (including the download modal) is under Donation appeals.</p>
    </div>
  );
}
