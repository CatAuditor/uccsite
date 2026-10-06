'use server';
// Media library server actions. Every one re-checks the role — the client
// component that calls beginUpload is not authorization. Form actions return
// { ok } | { error } (lib/actions.js); beginUpload/finishUpload are called
// programmatically by the uploader and return { error } the same way.
import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { withWriteDb, withWriteTx, recordChange } from '../../lib/data';
import { createUpload, deleteAsset, assetState } from '../../lib/media';
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
// alt (inline uploads) is stored now so the asset is placeable the moment
// the Lambda marks it ready; the Media page's uploader leaves it for later.
export async function finishUpload(id, alt) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const altText = String(alt || '').trim().slice(0, 300);
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new Error('Bad asset id');
    await withWriteDb(async (client) => {
      if (altText) await client.query('UPDATE media_assets SET alt = $2, updated_at = now() WHERE id = $1 AND (alt IS NULL OR alt = \'\')', [id, altText]);
      await recordChange(client, {
        actor: s.email, action: 'media.upload', entityType: 'media', entityId: String(id), diff: altText ? { alt: altText } : undefined,
      });
    });
    revalidatePath('/media');
  });
}

// assetReady(id, targetWidth) → { status, path?, width?, message? } for the
// inline uploader's poll. path = the variant the field should store.
export async function assetReady(id, targetWidth) {
  return runAction(async () => {
    await requireRole('editor');
    const state = await withWriteDb((client) => assetState(client, String(id), Number(targetWidth) || 800));
    return { ok: true, ...state };
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
