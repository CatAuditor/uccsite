'use server';
// Tipline triage (docs/systems/tipline.md). Staff may change a tip's status
// and owners may delete one; nobody edits what the tipster wrote. Both
// mutations are audited (audit_log only — tips are not content, so no
// revisions snapshot). Confidential: never log tip fields, only ids.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '../../lib/auth';
import { withWriteTx, recordChange } from '../../lib/data';
import { runAction } from '../../lib/actions';
import { STATUSES, isUuid } from './statuses';

const str = (fd, k, n = 80) => String(fd.get(k) ?? '').trim().slice(0, n);

export async function setTipStatus(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id');
    if (!isUuid(id)) throw new Error('Tip not found');
    const status = str(formData, 'status', 40);
    await withWriteTx(async (client) => {
      const before = (await client.query('SELECT status FROM tips WHERE id = $1', [id])).rows[0];
      if (!before) throw new Error('Tip not found');
      // Imported rows may carry an Airtable-era value; keeping it is allowed.
      if (!STATUSES.includes(status) && status !== before.status) throw new Error('Unknown status');
      await client.query('UPDATE tips SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
      await recordChange(client, {
        actor: s.email, action: 'tip.status', entityType: 'tip', entityId: id,
        diff: { from: before.status, to: status },
      });
    });
    revalidatePath('/tips');
    revalidatePath(`/tips/${id}`);
    return { ok: true, message: `Marked ${status}.` };
  });
}

export async function deleteTip(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('owner');
    const id = str(formData, 'id');
    if (!isUuid(id)) throw new Error('Tip not found');
    await withWriteTx(async (client) => {
      const before = (await client.query('SELECT legacy_airtable_id FROM tips WHERE id = $1', [id])).rows[0];
      if (!before) throw new Error('Tip not found');
      await client.query('DELETE FROM tips WHERE id = $1', [id]);
      // No snapshot: a deleted tip's contents must not live on in audit_log.
      // The legacy Airtable record id (opaque, no content) IS kept so a later
      // scripts/migrate-tips.mjs run does not resurrect the tip.
      await recordChange(client, {
        actor: s.email, action: 'tip.delete', entityType: 'tip', entityId: id,
        diff: before.legacy_airtable_id ? { legacy_airtable_id: before.legacy_airtable_id } : undefined,
      });
    });
    revalidatePath('/tips');
    redirect('/tips');
  });
}
