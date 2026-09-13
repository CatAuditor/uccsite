// Homepage editor: six flat-string groups + the hand-curated press list.
// The featured statement is NOT here — it derives from the newest Statement
// (docs/decisions/homepage-statement-links.md).
import { revalidatePath } from 'next/cache';
import { createRequire } from 'node:module';
import { getSession, requireRole } from '../../lib/auth';
import { withDb, recordChange } from '../../lib/data';
import { HOMEPAGE_GROUPS, HOMEPAGE_PRESS_FIELDS } from '../../lib/collections';
import { sanitizeItems } from '../../lib/collection-save';
import ListEditor from '../list-editor';

const require = createRequire(import.meta.url);
const { loadContent, saveHomepage } = require('@uccsite/db/content');

export const dynamic = 'force-dynamic';

export default async function HomepagePage() {
  const session = await getSession();
  const readOnly = session?.role === 'viewer';
  const { homepage } = await withDb(loadContent);

  async function save(formData) {
    'use server';
    const s = await requireRole('editor');
    const next = {};
    for (const group of HOMEPAGE_GROUPS) {
      next[group.key] = {};
      for (const [field] of group.fields) {
        const v = String(formData.get(`${group.key}.${field}`) ?? '').trim();
        if (v) next[group.key][field] = v;
      }
    }
    next.press = sanitizeItems(HOMEPAGE_PRESS_FIELDS, formData.get('press'));
    await withDb(async (client) => {
      const before = (await loadContent(client)).homepage;
      await saveHomepage(client, next);
      await recordChange(client, {
        actor: s.email, action: 'homepage.save', entityType: 'homepage', entityId: 'singleton',
        snapshot: before,
      });
    });
    revalidatePath('/homepage');
  }

  return (
    <div>
      <h1>Homepage</h1>
      <p className="notice">The featured statement card comes from the newest entry in Statements — edit it there.</p>
      {readOnly && <p className="notice">Viewer role — read-only.</p>}
      <form className="editor" action={save}>
        {HOMEPAGE_GROUPS.map((group) => (
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
      </form>
    </div>
  );
}
