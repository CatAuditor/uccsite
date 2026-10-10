'use server';
// Saved lists — the page's server actions (editor+). Rules live in
// lib/lists.js; this file only reads the form and returns { ok } | { error }
// (lib/actions.js runAction) for the ActionForms on ./page.js.
import { revalidatePath } from 'next/cache';
import { createList, saveList, freezeList, setMode, deleteList, addPeople, addToList, removePerson } from '../../lib/lists';
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

export async function addPeopleAction(prevState, formData) {
  return runAction(async () => {
    const r = await addPeople(String(formData.get('id') || ''), formData);
    done();
    const bits = [`${r.added} added to the list`];
    if (r.subscribed) bits.push(`${r.subscribed} also joined the mailing list`);
    if (r.notOnList.length) bits.push(`${r.notOnList.length} not on the mailing list, so never mailed: ${r.notOnList.slice(0, 5).join(', ')}${r.notOnList.length > 5 ? '…' : ''}`);
    if (r.notMailable.length) bits.push(`${r.notMailable.length} on the list but not mailable (${[...new Set(r.notMailable.map((x) => x.status))].join(', ')})`);
    return { ok: true, message: `${bits.join('. ')}.` };
  });
}

// From the Mailing list page: one person → one list (the row's select).
export async function addToListAction(prevState, formData) {
  return runAction(async () => {
    const list = await addToList(String(formData.get('list') || ''), String(formData.get('email') || ''));
    done();
    return { ok: true, message: `Added to “${list.name}”.` };
  });
}

export async function removePersonAction(prevState, formData) {
  return runAction(async () => {
    await removePerson(String(formData.get('id') || ''), String(formData.get('email') || ''));
    done();
    return { ok: true, message: 'Removed from the list.' };
  });
}

export async function deleteListAction(prevState, formData) {
  return runAction(async () => {
    await deleteList(String(formData.get('id') || ''));
    done();
    return { ok: true, message: 'Deleted.' };
  });
}
