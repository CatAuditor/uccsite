'use server';
// Mailing list management (editor+): remove a person from the list, undo an
// admin removal, erase a record. Every action is one transaction with its
// audit_log row (entityType 'subscriber', entityId = the address) —
// docs/systems/newsletters.md "Mailing list management".
import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { withWriteTx, recordChange } from '../../lib/data';
import { runAction } from '../../lib/actions';

const emailOf = (fd) => String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 254);

async function audited(action, email, diff, fn) {
  const s = await requireRole('editor');
  if (!email.includes('@')) throw new Error('Pick a person first.');
  const result = await withWriteTx(async (client) => {
    const out = await fn(client, s);
    await recordChange(client, { actor: s.email, action, entityType: 'subscriber', entityId: email, diff: { ...diff, ...out } });
    return out;
  });
  console.log(`[admin] ${s.email} ${action} subscriber`);
  revalidatePath('/subscribers');
  return result;
}

// Remove from list — the admin-side equivalent of the unsubscribe link: the
// row stays, stamped unsubscribed_at / unsubscribed_by = the admin's email, and
// any member opt-in is cleared. An opted-in member with no subscribers row
// gets one (stamped) so the removal stays visible and can be undone.
export async function removeFromList(prevState, formData) {
  return runAction(async () => {
    const email = emailOf(formData);
    await audited('subscribers.remove', email, null, async (client, s) => {
      const cur = await client.query('SELECT unsubscribed_at FROM subscribers WHERE email = $1', [email]);
      if (cur.rows[0]?.unsubscribed_at) throw new Error('They are already off the list.');
      const up = await client.query(
        `INSERT INTO subscribers (id, email, first_name, last_name, zip, confirmed_at, unsubscribed_at, unsubscribed_by)
         SELECT gen_random_uuid(), mm.email, MAX(mm.first_name), MAX(mm.last_name), MAX(mm.zip), MIN(mm.created_at), now(), $2
         FROM members mm WHERE mm.email = $1 AND mm.newsletter_opt_in = 1 GROUP BY mm.email
         ON CONFLICT (email) DO UPDATE SET unsubscribed_at = now(), unsubscribed_by = excluded.unsubscribed_by`,
        [email, s.email]);
      if (up.rowCount === 0) {
        const own = await client.query('UPDATE subscribers SET unsubscribed_at = now(), unsubscribed_by = $2 WHERE email = $1', [email, s.email]);
        if (own.rowCount === 0) throw new Error('Nobody on the list has that address.');
      }
      await client.query('UPDATE members SET newsletter_opt_in = 0 WHERE email = $1', [email]);
      return { via: cur.rows.length ? 'subscriber' : 'member' };
    });
    return { ok: true, message: `${email} removed from the list.` };
  });
}

// Undo an ADMIN removal only. Someone who pressed the unsubscribe link
// themselves stays off until they sign up (or sign a petition) again.
export async function restoreToList(prevState, formData) {
  return runAction(async () => {
    const email = emailOf(formData);
    await audited('subscribers.restore', email, null, async (client) => {
      const res = await client.query(
        `UPDATE subscribers SET unsubscribed_at = NULL, unsubscribed_by = NULL, confirmed_at = COALESCE(confirmed_at, now())
         WHERE email = $1 AND unsubscribed_at IS NOT NULL AND unsubscribed_by <> 'self'`, [email]);
      if (res.rowCount === 0) throw new Error('Only a removal made here can be undone. Someone who unsubscribed themselves has to sign up again.');
      return {};
    });
    return { ok: true, message: `${email} is back on the list.` };
  });
}

// Erase: delete the subscribers row for good (a "forget me" request). Member,
// donation and petition records are separate legal/financial records and
// stay; email_events stay so a bouncing address is still skipped if it ever
// comes back.
export async function eraseRecord(prevState, formData) {
  return runAction(async () => {
    const email = emailOf(formData);
    const confirm = String(formData.get('confirm') ?? '').trim().toLowerCase();
    if (!email || confirm !== email) throw new Error('Type the address exactly to confirm.');
    await audited('subscribers.erase', email, null, async (client) => {
      const res = await client.query('DELETE FROM subscribers WHERE email = $1', [email]);
      const mem = await client.query('UPDATE members SET newsletter_opt_in = 0 WHERE email = $1 AND newsletter_opt_in = 1', [email]);
      if (res.rowCount === 0 && mem.rowCount === 0) throw new Error('Nobody on the list has that address.');
      return { deleted: res.rowCount, memberOptOuts: mem.rowCount };
    });
    return { ok: true, message: `${email} erased from the mailing list.` };
  });
}
