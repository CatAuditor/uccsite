'use server';
// Saved lists — the page's server actions (editor+). Rules live in
// lib/lists.js; this file only reads the form and returns { ok } | { error }
// (lib/actions.js runAction) for the ActionForms on ./page.js.
import { revalidatePath } from 'next/cache';
import { createList, saveList, freezeList, setMode, deleteList } from '../../lib/lists';
import { runAction } from '../../lib/actions';

const done = () => { revalidatePath('/lists'); revalidatePath('/subscribers'); };

export async function createListAction(prevState, formData) {
  return runAction(async () => {
    const list = await createList(formData);
    done();
    return { ok: true, message: `"${list.name}" saved.` };
  });
}

export async function saveListAction(prevState, formData) {
  return runAction(async () => {
    await saveList(String(formData.get('id') || ''), formData);
    done();
    return { ok: true, message: 'Saved.' };
  });
}

export async function freezeListAction(prevState, formData) {
  return runAction(async () => {
    const count = await freezeList(String(formData.get('id') || ''));
    done();
    return { ok: true, message: `Updated — the list now holds ${count} ${count === 1 ? 'person' : 'people'}.` };
  });
}

export async function setModeAction(prevState, formData) {
  return runAction(async () => {
    const mode = String(formData.get('mode') || '');
    const count = await setMode(String(formData.get('id') || ''), mode);
    done();
    return { ok: true, message: mode === 'frozen' ? `Frozen with ${count} ${count === 1 ? 'person' : 'people'}.` : 'Now dynamic — it follows the filters again.' };
  });
}

export async function deleteListAction(prevState, formData) {
  return runAction(async () => {
    await deleteList(String(formData.get('id') || ''));
    done();
    return { ok: true, message: 'Deleted.' };
  });
}
