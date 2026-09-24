'use server';
// Project files server actions. Every one re-checks the role — the client
// components are not authorization. Form actions return { ok } | { error }
// (lib/actions.js); beginFileUpload/finishFileUpload are called by the
// uploader programmatically and return { error } the same way.
import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { withWriteDb, withWriteTx, recordChange } from '../../lib/data';
import {
  createUpload, confirmUpload, updateFile, requestFilePublish, cancelFilePublish, unpublishFile, deleteFile,
} from '../../lib/files';
import { runAction } from '../../lib/actions';

// beginFileUpload({ filename, bytes, projectSlug, folder }) → { id, url, mime } | { error }
export async function beginFileUpload({ filename, bytes, projectSlug, folder }) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const { id, url, mime } = await withWriteDb((client) => createUpload(client, {
      filename, bytes: Number(bytes), projectSlug, folder, actor: s.email,
    }));
    return { ok: true, id, url, mime };
  });
}

// After the browser's PUT: verify the object landed, mark ready, audit.
export async function finishFileUpload(id) {
  return runAction(async () => {
    const s = await requireRole('editor');
    await withWriteDb(async (client) => {
      const file = await confirmUpload(client, id);
      await recordChange(client, {
        actor: s.email, action: 'files.upload', entityType: 'file', entityId: file.id,
        diff: { filename: file.originalFilename, bytes: file.bytes, project: file.projectSlug, folder: file.folder },
      });
    });
    revalidatePath('/files');
  });
}

export async function saveFileDetails(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = String(formData.get('id'));
    await withWriteTx(async (client) => {
      const { before, after } = await updateFile(client, id, {
        projectSlug: formData.get('project'), folder: formData.get('folder'), note: formData.get('note'),
      });
      await recordChange(client, {
        actor: s.email, action: 'files.update', entityType: 'file', entityId: id,
        diff: {
          project: { before: before.projectSlug, after: after.projectSlug },
          folder: { before: before.folder, after: after.folder },
          note: { before: before.note, after: after.note },
        },
      });
    });
    revalidatePath('/files');
    return { ok: true, message: 'Saved.' };
  });
}

// A file publish is a REQUEST. It goes live when a DIFFERENT admin approves a
// site publish (docs/decisions/project-files-two-person-publish.md).
export async function publish(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = String(formData.get('id'));
    await withWriteDb(async (client) => {
      const file = await requestFilePublish(client, id, s.email);
      await recordChange(client, {
        actor: s.email, action: 'files.publish_request', entityType: 'file', entityId: id,
        diff: { filename: file.originalFilename },
      });
    });
    revalidatePath('/files');
    return { ok: true, message: 'Requested. It goes live when another admin approves a publish.' };
  });
}

export async function cancelPublish(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = String(formData.get('id'));
    await withWriteDb(async (client) => {
      const file = await cancelFilePublish(client, id, s.email);
      await recordChange(client, {
        actor: s.email, action: 'files.publish_cancel', entityType: 'file', entityId: id,
        diff: { filename: file.originalFilename },
      });
    });
    revalidatePath('/files');
    return { ok: true, message: 'Request withdrawn. Nothing was public.' };
  });
}

export async function unpublish(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = String(formData.get('id'));
    await withWriteDb(async (client) => {
      const file = await unpublishFile(client, id, s.email);
      await recordChange(client, {
        actor: s.email, action: 'files.unpublish', entityType: 'file', entityId: id,
        diff: { filename: file.originalFilename },
      });
    });
    revalidatePath('/files');
    return { ok: true, message: 'Unpublished. Cached copies expire within 5 minutes.' };
  });
}

export async function remove(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = String(formData.get('id'));
    await withWriteDb(async (client) => {
      const file = await deleteFile(client, id);
      await recordChange(client, {
        actor: s.email, action: 'files.delete', entityType: 'file', entityId: id,
        diff: { filename: file.originalFilename, wasPublished: Boolean(file.publicKey) },
      });
    });
    revalidatePath('/files');
    return { ok: true, message: 'Deleted.' };
  });
}
