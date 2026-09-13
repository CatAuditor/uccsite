'use server';
// Media library server actions. Every one re-checks the role — the client
// component that calls beginUpload is not authorization. Form actions return
// { ok } | { error } (lib/actions.js); beginUpload/finishUpload are called
// programmatically by the uploader and return { error } the same way.
import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { withWriteDb, withWriteTx, recordChange } from '../../lib/data';
import { createUpload, deleteAsset } from '../../lib/media';
import { runAction } from '../../lib/actions';

// beginUpload({ filename, mime, bytes }) → { id, url } | { error }
export async function beginUpload({ filename, mime, bytes }) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const { id, url } = await withWriteDb((client) => createUpload(client, {
      filename, mime, bytes: Number(bytes), actor: s.email,
    }));
    return { ok: true, id, url };
  });
}

// After the browser's PUT succeeds: audit it (the Lambda does the rest).
export async function finishUpload(id) {
  return runAction(async () => {
    const s = await requireRole('editor');
    await withWriteDb((client) => recordChange(client, {
      actor: s.email, action: 'media.upload', entityType: 'media', entityId: String(id),
    }));
    revalidatePath('/media');
  });
}

export async function saveAlt(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = String(formData.get('id'));
    const alt = String(formData.get('alt') || '').trim().slice(0, 300);
    await withWriteTx(async (client) => {
      const before = (await client.query('SELECT alt FROM media_assets WHERE id = $1', [id])).rows[0];
      if (!before) throw new Error('Asset not found');
      // Alt is a placement gate; an asset already on a page must not lose it.
      if (before.alt && !alt) throw new Error('Alt text cannot be cleared once set — edit it instead');
      await client.query('UPDATE media_assets SET alt = $2, updated_at = now() WHERE id = $1', [id, alt]);
      await recordChange(client, {
        actor: s.email, action: 'media.alt', entityType: 'media', entityId: id,
        diff: { alt: { before: before.alt || '', after: alt } },
      });
    });
    revalidatePath('/media');
    return { ok: true, message: 'Alt text saved.' };
  });
}

export async function removeAsset(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = String(formData.get('id'));
    await withWriteDb(async (client) => {
      const asset = await deleteAsset(client, id);
      await recordChange(client, {
        actor: s.email, action: 'media.delete', entityType: 'media', entityId: id,
        diff: { filename: asset.originalFilename, variants: asset.variants.length },
      });
    });
    revalidatePath('/media');
    return { ok: true, message: 'Deleted.' };
  });
}
