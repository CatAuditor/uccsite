'use server';
// /profile server actions: the signed-in user's own account (password, TOTP,
// passkeys) and their own team bio/headshot. Every action re-verifies the
// session; self-service Cognito calls carry the user's access token.
import { revalidatePath } from 'next/cache';
import { requireSession, getAccessToken } from '../../lib/auth';
import { withWriteTx, recordChange, withDb } from '../../lib/data';
import { runAction } from '../../lib/actions';
import {
  changePassword, beginTotp, confirmTotp, disableTotp, deletePasskey,
} from '../../lib/account';
import { COLLECTIONS } from '../../lib/collections';
import { loadCollectionItems, mediaAssetIds } from '../../lib/collection-save';
import { assertAltText } from '../../lib/media';
import { replaceCollectionRows } from '@uccsite/db/content';

async function selfToken() {
  const session = await requireSession();
  const token = await getAccessToken();
  if (!token) throw new Error('Your session has no access token — sign out and back in.');
  return { session, token };
}

export async function changeOwnPassword(prevState, formData) {
  return runAction(async () => {
    const { session, token } = await selfToken();
    const next = String(formData.get('newPassword') || '');
    if (next !== String(formData.get('confirmPassword') || '')) throw new Error('New passwords do not match');
    await changePassword(token, String(formData.get('currentPassword') || ''), next);
    await withWriteTx((client) => recordChange(client, { actor: session.email, action: 'account.password_changed', entityType: 'user', entityId: session.email }));
    return { ok: true, message: 'Password changed.' };
  });
}

// startTotp() → { secret, otpauth } for the client TotpSetup component.
export async function startTotp() {
  return runAction(async () => {
    const { session, token } = await selfToken();
    const { secret, otpauth } = await beginTotp(token, session.email);
    return { ok: true, secret, otpauth };
  });
}
export async function finishTotp(prevState, formData) {
  return runAction(async () => {
    const { session, token } = await selfToken();
    await confirmTotp(token, String(formData.get('code') || ''));
    await withWriteTx((client) => recordChange(client, { actor: session.email, action: 'account.mfa.totp_enabled', entityType: 'user', entityId: session.email }));
    revalidatePath('/profile');
    return { ok: true, message: 'Authenticator app enabled. You will be asked for a code at sign-in.' };
  });
}
export async function turnOffTotp(prevState, formData) {
  return runAction(async () => {
    const { session, token } = await selfToken();
    await disableTotp(token);
    await withWriteTx((client) => recordChange(client, { actor: session.email, action: 'account.mfa.totp_disabled', entityType: 'user', entityId: session.email }));
    revalidatePath('/profile');
    return { ok: true, message: 'Authenticator app MFA turned off.' };
  });
}
export async function removePasskey(prevState, formData) {
  return runAction(async () => {
    const { session, token } = await selfToken();
    const id = String(formData.get('credentialId') || '');
    await deletePasskey(token, id);
    await withWriteTx((client) => recordChange(client, { actor: session.email, action: 'account.passkey_removed', entityType: 'user', entityId: session.email, diff: { credentialId: id.slice(0, 12) + '…' } }));
    revalidatePath('/profile');
    return { ok: true, message: 'Security key removed.' };
  });
}

// saveOwnProfile: edit ONLY the team member whose email matches the session
// (any role — it is their own bio). Goes through the team collection's write
// path so revisions/audit/alt-gate behave exactly like the Team editor.
export async function saveOwnProfile(prevState, formData) {
  return runAction(async () => {
    const session = await requireSession();
    const spec = COLLECTIONS.team;
    const bio = String(formData.get('bio') || '').trim();
    const photo = String(formData.get('photo') || '').trim();
    const title = String(formData.get('title') || '').trim();
    await withWriteTx(async (client) => {
      const items = await loadCollectionItems(client, 'team');
      const i = items.findIndex(m => (m.email || '').toLowerCase() === session.email.toLowerCase());
      if (i < 0) throw new Error('No team bio is linked to your email — an editor can set your admin email on the Team page.');
      const next = items.map((m, j) => (j === i ? { ...m, bio, photo, title } : m));
      await assertAltText(client, mediaAssetIds(spec, [next[i]]));
      await replaceCollectionRows(client, spec.table, next, { tx: false });
      await recordChange(client, {
        actor: session.email, action: 'team.save', entityType: 'team', entityId: 'collection',
        snapshot: items, diff: { self: session.email, fields: ['bio', 'photo', 'title'] },
      });
    });
    revalidatePath('/profile');
    revalidatePath('/team');
    return { ok: true, message: 'Your bio was saved. Publish to make it live.' };
  });
}
