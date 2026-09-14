// Homepage editor: six flat-string groups + the hand-curated press list.
// The featured statement is NOT here — it derives from the newest Statement
// (docs/decisions/homepage-statement-links.md). Save = one transaction
// (groups upsert + press wipe-and-load + revision + audit) with a
// lost-update check on the singleton's updated_at.
import { revalidatePath } from 'next/cache';
import { loadHomepage, saveHomepage } from '@uccsite/db/content';
import { requireSession, requireRole } from '../../lib/auth';
import { withDb, withWriteTx, recordChange, singletonStamp } from '../../lib/data';
import { HOMEPAGE_GROUPS, HOMEPAGE_PRESS_FIELDS } from '../../lib/collections';
import { sanitizeItems, CONFLICT_MESSAGE } from '../../lib/collection-save';
import { runAction } from '../../lib/actions';
import ListEditor from '../list-editor';
import ActionForm from '../action-form';

export const dynamic = 'force-dynamic';

export default async function HomepagePage() {
  const session = await requireSession();
  const readOnly = session.role === 'viewer';
  const { homepage, baseline } = await withDb(async (client) => ({
    homepage: await loadHomepage(client),
    baseline: await singletonStamp(client, 'homepage'),
  }));

  async function save(prevState, formData) {
    'use server';
    return runAction(async () => {
      const s = await requireRole('editor');
      const next = {};
      for (const group of HOMEPAGE_GROUPS) {
        if (group.appeals) continue; // owned by /appeals; merged from `before` below
        next[group.key] = {};
        for (const [field] of group.fields) {
          const v = String(formData.get(`${group.key}.${field}`) ?? '').trim();
          if (v) next[group.key][field] = v;
        }
      }
      next.press = sanitizeItems(HOMEPAGE_PRESS_FIELDS, formData.get('press'));
      const expected = String(formData.get('baseline') ?? '');
      await withWriteTx(async (client) => {
        const current = await singletonStamp(client, 'homepage');
        if (expected && current !== expected) throw new Error(CONFLICT_MESSAGE);
        const before = await loadHomepage(client);
        for (const group of HOMEPAGE_GROUPS) if (group.appeals) next[group.key] = before[group.key];
        await saveHomepage(client, next, { tx: false });
        await recordChange(client, {
          actor: s.email, action: 'homepage.save', entityType: 'homepage', entityId: 'singleton',
          snapshot: before,
        });
      });
      revalidatePath('/homepage');
    });
  }

  return (
    <div>
      <h1>Homepage</h1>
      <p className="notice">The featured statement card comes from the newest entry in Statements — edit it there. The donate section and the timed donation modal are under Donation appeals.</p>
      {readOnly && <p className="notice">Viewer role — read-only.</p>}
      <ActionForm className="editor" action={save} successMessage="Homepage saved. Publish to make it live.">
        <input type="hidden" name="baseline" value={baseline} />
        {HOMEPAGE_GROUPS.filter(g => !g.appeals).map((group) => (
          <fieldset key={group.key} className="item">
            <legend>{group.title}</legend>
            {group.fields.map(([field, label, widget, hint]) => {
              const id = `${group.key}.${field}`;
              const value = homepage[group.key]?.[field] ?? '';
              return (
                <div key={field}>
                  <label htmlFor={id}>{label}</label>
                  {widget === 'textarea' ? (
                    <textarea id={id} name={id} defaultValue={value} disabled={readOnly} />
                  ) : (
                    <input type="text" id={id} name={id} defaultValue={value} disabled={readOnly} />
                  )}
                  {hint && <div className="hint">{hint}</div>}
                </div>
              );
            })}
          </fieldset>
        ))}
        <h2>Press strip</h2>
        <ListEditor fields={HOMEPAGE_PRESS_FIELDS} items={homepage.press || []}
          itemLabelField="headline" readOnly={readOnly} name="press" />
        {!readOnly && <button type="submit">Save Homepage</button>}
      </ActionForm>
    </div>
  );
}
