// Users & roles (owner only, spec §11): invite, role, disable/enable, force
// password reset, remove authenticator MFA, sign out everywhere. Backed by
// the Cognito admin APIs (lib/account.js); every action is audited.
import { requireRole } from '../../lib/auth';
import { listUsers, ROLES } from '../../lib/account';
import ActionForm from '../action-form';
import { inviteUser, changeRole, toggleEnabled, sendPasswordReset, clearMfa, signOutUser } from './actions';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  let session;
  try { session = await requireRole('owner'); } catch {
    return <div><h1>Users &amp; roles</h1><p className="notice">Owner role required. Ask an owner to change roles or invite people.</p></div>;
  }
  let users = [], error = '';
  try { users = await listUsers(); } catch (err) { error = err.message; }

  return (
    <div>
      <h1>Users &amp; roles</h1>
      <p className="notice">
        <strong>owner</strong>: everything incl. users and the script escape hatch · <strong>editor</strong>: edit, publish, media, donors/subscribers · <strong>viewer</strong>: read-only content.
        There is no self-signup: invite people here and Cognito emails them a temporary password.
      </p>
      {error && <div className="error">Could not list users: {error}</div>}
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>MFA</th><th>Actions</th></tr></thead>
        <tbody>
          {users.map((u) => {
            const isMe = u.email.toLowerCase() === session.email.toLowerCase();
            return (
              <tr key={u.username} className={u.enabled ? '' : 'status-noop'}>
                <td>{u.email}{isMe && <span className="hint"> (you)</span>}</td>
                <td>{u.name}</td>
                <td>
                  <ActionForm action={changeRole} className="inline">
                    <input type="hidden" name="username" value={u.username} />
                    <select name="role" defaultValue={u.role || ''} aria-label={`Role for ${u.email}`}>
                      {!u.role && <option value="">(no role — no access)</option>}
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button type="submit">Set</button>
                  </ActionForm>
                </td>
                <td>{u.enabled ? u.status : `disabled (${u.status})`}</td>
                <td>{u.mfa === 'totp' ? 'authenticator' : '—'}</td>
                <td className="user-actions">
                  <ActionForm action={toggleEnabled} className="inline">
                    <input type="hidden" name="username" value={u.username} />
                    <input type="hidden" name="enable" value={u.enabled ? '0' : '1'} />
                    <button type="submit" className={u.enabled ? 'danger' : ''} disabled={isMe && u.enabled}>{u.enabled ? 'Disable' : 'Enable'}</button>
                  </ActionForm>
                  <ActionForm action={sendPasswordReset} className="inline">
                    <input type="hidden" name="username" value={u.username} />
                    <button type="submit">Reset password</button>
                  </ActionForm>
                  <ActionForm action={clearMfa} className="inline">
                    <input type="hidden" name="username" value={u.username} />
                    <button type="submit" disabled={u.mfa !== 'totp'}>Remove MFA</button>
                  </ActionForm>
                  <ActionForm action={signOutUser} className="inline">
                    <input type="hidden" name="username" value={u.username} />
                    <button type="submit">Sign out everywhere</button>
                  </ActionForm>
                </td>
              </tr>
            );
          })}
          {!users.length && !error && <tr><td colSpan="6">No users.</td></tr>}
        </tbody>
      </table>
      <p className="hint">Status: CONFIRMED = active; FORCE_CHANGE_PASSWORD = invited, has not signed in; RESET_REQUIRED = must set a new password at next sign-in. Security keys are managed by each person on their own profile page. Admin sessions are 1-hour cookies: a role change or sign-out applies at their next sign-in, or immediately if you also “Sign out everywhere”.</p>

      <h2>Invite a user</h2>
      <ActionForm className="editor" action={inviteUser}>
        <label htmlFor="inv-email">Email</label>
        <input type="email" id="inv-email" name="email" required />
        <label htmlFor="inv-name">Full name</label>
        <input type="text" id="inv-name" name="name" />
        <label htmlFor="inv-role">Role</label>
        <select id="inv-role" name="role" defaultValue="editor">{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
        <button type="submit">Send invite</button>
      </ActionForm>
    </div>
  );
}
