// Homepage editor: six flat-string groups. The press cards derive from the
// press list (ticked "Homepage card", first three) — docs/systems/press.md.
// The featured statement is NOT here — it derives from the newest Statement
// (docs/decisions/homepage-statement-links.md). Save = one transaction
// (groups upsert + press wipe-and-load + revision + audit) with a
// lost-update check on the singleton's updated_at.
import { revalidatePath } from 'next/cache';
import { loadHomepage, saveHomepage } from '@uccsite/db/content';
import { listPetitions } from '@uccsite/db/petitions';
import { requireSession, requireRole } from '../../lib/auth';
import { withDb, withWriteTx, recordChange, singletonStamp } from '../../lib/data';
import { HOMEPAGE_GROUPS } from '../../lib/collections';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import { runAction } from '../../lib/actions';
import ActionForm from '../action-form';
import RequestPublish from '../request-publish';
import { draftHero, liveHero, HeroStatus } from '../../lib/hero-status';

export const dynamic = 'force-dynamic';

export default async function HomepagePage() {
  const session = await requireSession();
  const readOnly = session.role === 'viewer';
  const [{ homepage, petitions, baseline }, live] = await Promise.all([
    withDb(async (client) => ({
      homepage: await loadHomepage(client),
      petitions: await listPetitions(client),
      baseline: await singletonStamp(client, 'homepage'),
    })),
    liveHero(),
  ]);

  async function save(prevState, formData) {
    'use server';
    return runAction(async () => {
      const s = await requireRole('editor');
      const next = {};
      for (const group of HOMEPAGE_GROUPS) {
        if (group.page) continue; // owned by /appeals; merged from `before` below
        next[group.key] = {};
        for (const [field] of group.fields) {
          const v = String(formData.get(`${group.key}.${field}`) ?? '').trim();
          if (v) next[group.key][field] = v;
        }
      }
      const expected = String(formData.get('baseline') ?? '');
      await withWriteTx(async (client) => {
        const current = await singletonStamp(client, 'homepage');
        if (expected && current !== expected) throw new Error(CONFLICT_MESSAGE);
        const before = await loadHomepage(client);
        for (const group of HOMEPAGE_GROUPS) if (group.page) next[group.key] = before[group.key];
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
      <p className="notice">The featured statement card comes from the newest entry in Statements — edit it there. The &quot;Recent Coverage&quot; cards are the stories ticked <strong>Homepage card</strong> on Press &amp; coverage (the first three). The donate section and the timed donation modal are under Donation appeals; the petition hero is the open petition ticked <strong>Show in the homepage hero</strong> under Petitions.</p>
      {readOnly && <p className="notice">Viewer role — read-only.</p>}
      <HeroStatus draft={draftHero(homepage, petitions)} live={live} />
      <p className="notice">The <strong>Hero</strong> fields below are the standing hero — the default whenever no open petition is featured on the Petitions page.</p>
      <ActionForm className="editor" action={save} successMessage="Homepage saved. Publish to make it live.">
        <input type="hidden" name="baseline" value={baseline} />
        {HOMEPAGE_GROUPS.filter(g => !g.page).map((group) => (
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
        {!readOnly && <><button type="submit">Save Homepage</button><RequestPublish /></>}
      </ActionForm>
    </div>
  );
}
