'use server';
// Petition server actions (docs/systems/petition.md "Admin"): create, save,
// delete one row of the petitions collection. Every write is one transaction
// with a lost-update stamp (the petitions table stamp), a revision snapshot
// of the row before the change and an audit row — the standard save path.
// Editor+; the rules themselves (slug, project, status, address clashes,
// signatures pinning the slug, one featured) live in packages/db/petitions.js.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getPetition, savePetition as saveRow, deletePetition as deleteRow } from '@uccsite/db/petitions';
import { requireRole } from '../../lib/auth';
import { withWriteTx, recordChange, collectionStamp } from '../../lib/data';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import { PETITION_FIELDS, PETITION_RECORD_FIELDS } from '../../lib/collections';
import { runAction } from '../../lib/actions';

const str = (fd, name, max = 4000) => String(fd.get(name) ?? '').trim().slice(0, max);

function fieldsFrom(formData) {
  const next = {};
  for (const f of PETITION_RECORD_FIELDS) next[f] = f === 'featured' ? (formData.get('featured') ? '1' : '') : str(formData, f, 80);
  next.slug = next.slug.toLowerCase();
  for (const [f] of PETITION_FIELDS) next[f] = str(formData, f);
  return next;
}

const revalidate = (id) => {
  revalidatePath('/petitions');
  revalidatePath('/homepage');
  if (id) revalidatePath(`/petitions/${id}`);
};

// createPetition — the "New petition" form on /petitions: slug + project (+ a
// headline, so the row is not blank); it starts as a draft and opens its editor.
export async function createPetition(prevState, formData) {
  let newId = null;
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    const row = {
      slug: str(formData, 'slug', 80).toLowerCase(), project_slug: str(formData, 'project_slug', 80), status: 'draft',
      headline: str(formData, 'headline'), label: 'Unofficial Petition', cta: 'Sign the petition now', form_title: 'Sign the petition',
    };
    await withWriteTx(async (client) => {
      newId = await saveRow(client, row);
      await recordChange(client, { actor: s.email, action: 'petition.create', entityType: 'petition', entityId: newId, diff: { slug: row.slug, project: row.project_slug } });
    });
    revalidate();
  });
  if (result.ok && newId) redirect(`/petitions/${newId}`);
  return result;
}

export async function savePetition(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 64);
    const expected = str(formData, 'baseline', 200);
    const next = fieldsFrom(formData);
    await withWriteTx(async (client) => {
      if (expected && (await collectionStamp(client, 'petitions')) !== expected) throw new Error(CONFLICT_MESSAGE);
      const before = await getPetition(client, { id });
      if (!before) throw new Error('That petition no longer exists');
      const { id: _id, ...snapshot } = before;
      await saveRow(client, { ...next, id });
      await recordChange(client, { actor: s.email, action: 'petition.save', entityType: 'petition', entityId: id, snapshot, diff: { slug: next.slug, status: next.status, featured: next.featured === '1' } });
    });
    revalidate(id);
  });
}

export async function deletePetition(prevState, formData) {
  let done = false;
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 64);
    await withWriteTx(async (client) => {
      const before = await getPetition(client, { id });
      if (!before) throw new Error('That petition no longer exists');
      const { id: _id, ...snapshot } = before;
      await deleteRow(client, id);
      await recordChange(client, { actor: s.email, action: 'petition.delete', entityType: 'petition', entityId: id, snapshot, diff: { slug: before.slug } });
    });
    revalidate(id);
    done = true;
  });
  if (result.ok && done) redirect('/petitions');
  return result;
}
