'use server';
import { revalidatePath } from 'next/cache';
import { listRedirects, upsertRedirect, deleteRedirect } from '@uccsite/db/redirects';
import { requireRole } from '../../lib/auth';
import { withWriteTx, recordChange } from '../../lib/data';
import { runAction } from '../../lib/actions';

const str = (fd, k, n = 500) => String(fd.get(k) ?? '').trim().slice(0, n);

// saveRedirect: upsert by id, else by from_path (so "add" with an existing
// path updates it instead of failing the UNIQUE constraint).
export async function saveRedirect(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const input = {
      id: str(formData, 'id', 80) || null,
      fromPath: str(formData, 'fromPath'), toUrl: str(formData, 'toUrl'),
      statusCode: Number(str(formData, 'statusCode', 3) || 301),
      note: str(formData, 'note', 300), active: str(formData, 'active', 5) === '1',
    };
    await withWriteTx(async (client) => {
      if (!input.id) input.id = (await listRedirects(client)).find(r => r.fromPath === input.fromPath)?.id || null;
      const id = await upsertRedirect(client, input);
      await recordChange(client, { actor: s.email, action: 'redirect.save', entityType: 'redirect', entityId: id, diff: input });
    });
    revalidatePath('/redirects');
  });
}

export async function removeRedirect(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    await withWriteTx(async (client) => {
      await deleteRedirect(client, id);
      await recordChange(client, { actor: s.email, action: 'redirect.delete', entityType: 'redirect', entityId: id });
    });
    revalidatePath('/redirects');
    return { ok: true, message: 'Deleted. Publish to remove it from the edge.' };
  });
}
