'use server';
// Owner-only user administration (spec §11 "owner: user management").
import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { withWriteTx, recordChange } from '../../lib/data';
import { runAction } from '../../lib/actions';
import { createUser, setRole, setEnabled, resetPassword, removeMfa, signOutEverywhere, ROLES } from '../../lib/account';

const str = (fd, k, n = 200) => String(fd.get(k) ?? '').trim().slice(0, n);

async function audited(action, entityId, diff, fn) {
  const s = await requireRole('owner');
  await fn(s);
  await withWriteTx((client) => recordChange(client, { actor: s.email, action, entityType: 'user', entityId, diff }));
  revalidatePath('/users');
}

export async function inviteUser(prevState, formData) {
  return runAction(async () => {
    const email = str(formData, 'email').toLowerCase();
    const name = str(formData, 'name');
    const role = str(formData, 'role', 20);
    if (!ROLES.includes(role)) throw new Error('Pick a role');
    await audited('user.invite', email, { name, role }, async () => { await createUser({ email, name, role }); });
    return { ok: true, message: `Invited ${email} as ${role}. Cognito emailed them a temporary password; they set their own at first sign-in.` };
  });
}

export async function changeRole(prevState, formData) {
  return runAction(async () => {
    const username = str(formData, 'username');
    const role = str(formData, 'role', 20);
    await audited('user.role', username, { role }, async (s) => {
      if (username.toLowerCase() === s.email.toLowerCase() && role !== 'owner') throw new Error('You cannot remove your own owner role.');
      await setRole(username, role);
    });
    return { ok: true, message: `${username} is now ${role}. Their existing session keeps the old role until it expires (1 h) — sign them out below to apply it now.` };
  });
}

export async function toggleEnabled(prevState, formData) {
  return runAction(async () => {
    const username = str(formData, 'username');
    const enable = str(formData, 'enable', 5) === '1';
    await audited(enable ? 'user.enable' : 'user.disable', username, null, async (s) => {
      if (!enable && username.toLowerCase() === s.email.toLowerCase()) throw new Error('You cannot disable yourself.');
      await setEnabled(username, enable);
    });
    return { ok: true, message: enable ? `${username} enabled.` : `${username} disabled and signed out everywhere.` };
  });
}

export async function sendPasswordReset(prevState, formData) {
  return runAction(async () => {
    const username = str(formData, 'username');
    await audited('user.password_reset', username, null, async () => { await resetPassword(username); });
    return { ok: true, message: `${username} must set a new password at next sign-in (Cognito emailed a code).` };
  });
}

export async function clearMfa(prevState, formData) {
  return runAction(async () => {
    const username = str(formData, 'username');
    await audited('user.mfa_removed', username, null, async () => { await removeMfa(username); await signOutEverywhere(username); });
    return { ok: true, message: `Authenticator MFA removed for ${username} and they were signed out. Security keys can only be removed by the user on their profile page.` };
  });
}

export async function signOutUser(prevState, formData) {
  return runAction(async () => {
    const username = str(formData, 'username');
    await audited('user.global_sign_out', username, null, async () => { await signOutEverywhere(username); });
    return { ok: true, message: `${username} signed out everywhere (their admin cookie stops working within the hour).` };
  });
}
