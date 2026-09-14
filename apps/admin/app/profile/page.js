// My profile & security (spec §11): the signed-in user's account — password
// change, authenticator-app MFA, security keys / passkeys — and their own
// team bio + headshot (linked by team_members.email). Everything else about
// other people lives on /users (owners) and /team (editors).
import { requireSession, getAccessToken } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { accountStatus, passkeyAddUrl } from '../../lib/account';
import { loadCollectionItems, loadCollectionBaseline } from '../../lib/collection-save';
import { mediaOptionsFor } from '../../lib/media';
import { COLLECTIONS } from '../../lib/collections';
import ActionForm from '../action-form';
import TotpSetup from './totp-setup';
import { changeOwnPassword, turnOffTotp, removePasskey, saveOwnProfile } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await requireSession();
  const token = await getAccessToken();
  let account = null, accountError = '';
  if (token) {
    try { account = await accountStatus(token); } catch (err) { accountError = err.message; }
  } else {
    accountError = 'Your session predates the security features — sign out and back in to manage your password, MFA and security keys.';
  }
  const { me, photoOptions, baseline } = await withDb(async (client) => {
    const items = await loadCollectionItems(client, 'team');
    const me = items.find(m => (m.email || '').toLowerCase() === session.email.toLowerCase()) || null;
    const photoField = COLLECTIONS.team.fields.find(f => f.name === 'photo');
    return { me, photoOptions: await mediaOptionsFor(client, photoField.targetWidth || 400), baseline: await loadCollectionBaseline(client, 'team') };
  });

  return (
    <div>
      <h1>My profile &amp; security</h1>
      <p className="notice">Signed in as <strong>{session.email}</strong> · role <strong>{session.role}</strong>. Roles are assigned by an owner on the Users page.</p>

      <h2>Password</h2>
      {accountError ? <div className="error">{accountError}</div> : (
        <ActionForm className="editor" action={changeOwnPassword} successMessage="Password changed.">
          <label htmlFor="currentPassword">Current password</label>
          <input type="password" id="currentPassword" name="currentPassword" autoComplete="current-password" required />
          <label htmlFor="newPassword">New password (12+ characters)</label>
          <input type="password" id="newPassword" name="newPassword" autoComplete="new-password" minLength={12} required />
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input type="password" id="confirmPassword" name="confirmPassword" autoComplete="new-password" minLength={12} required />
          <button type="submit">Change password</button>
        </ActionForm>
      )}

      <h2>Two-factor: authenticator app</h2>
      {account && (account.mfa === 'totp' ? (
        <div className="editor">
          <p className="ok">Enabled — a code from your authenticator app is required at sign-in.</p>
          <ActionForm action={turnOffTotp}><button type="submit" className="danger">Turn off authenticator MFA</button></ActionForm>
          <p className="hint">Turning MFA off or removing a security key needs a sign-in less than 15 minutes old.</p>
        </div>
      ) : (
        <div className="editor">
          <p>Not enabled. Passwords alone are phishable; an authenticator app adds a rotating code at sign-in.</p>
          <TotpSetup />
        </div>
      ))}

      <h2>Security keys &amp; passkeys</h2>
      {account && (
        <div className="editor">
          <p>A security key (YubiKey, Titan…) or a platform passkey (Touch ID, Windows Hello, phone) signs you in without a password and cannot be phished. Registration happens on the sign-in service and returns you here.</p>
          <table>
            <thead><tr><th>Name</th><th>Registered</th><th></th></tr></thead>
            <tbody>
              {account.passkeys.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.createdAt.slice(0, 10)}</td>
                  <td>
                    <ActionForm action={removePasskey}>
                      <input type="hidden" name="credentialId" value={p.id} />
                      <button type="submit" className="danger">Remove</button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
              {!account.passkeys.length && <tr><td colSpan="3">No security keys or passkeys registered.</td></tr>}
            </tbody>
          </table>
          <p><a className="btn-link" href={passkeyAddUrl()}>Add a security key or passkey →</a></p>
          <p className="hint">Keep a second factor you can use if a key is lost: another key, the authenticator app, or ask an owner to reset your password.</p>
        </div>
      )}

      <h2>My bio &amp; headshot</h2>
      {me ? (
        <ActionForm className="editor" action={saveOwnProfile} successMessage="Saved. Publish to make it live.">
          <input type="hidden" name="baseline" value={baseline} />
          <p className="hint">This is your entry on the Team page ({me.name}). Name changes go through the Team editor.</p>
          <label htmlFor="title">Title / role</label>
          <input type="text" id="title" name="title" defaultValue={me.title || ''} />
          <label htmlFor="photo">Headshot</label>
          <input type="text" id="photo" name="photo" defaultValue={me.photo || ''} list="headshots" />
          <datalist id="headshots">{photoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
          <div className="hint">Pick a Media Library image (only images with alt text are offered — upload yours on the Media page) or keep the current path.</div>
          <label htmlFor="bio">Bio</label>
          <textarea id="bio" name="bio" defaultValue={me.bio || ''} rows={8} />
          <div className="hint">Supports **bold**, *italic*, [link text](https://url). Blank line = new paragraph.</div>
          <button type="submit">Save my bio</button>
        </ActionForm>
      ) : (
        <p className="notice">No team bio is linked to {session.email}. An editor can set your admin email on your entry in the Team editor; after that you can edit your bio and headshot here.</p>
      )}
    </div>
  );
}
