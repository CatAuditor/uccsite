// Account & user management (spec §11). Two halves:
//   self-service — the signed-in user's OWN Cognito account, authorised by
//     their access token (scope aws.cognito.signin.user.admin): password
//     change, TOTP MFA, passkeys / security keys list + delete. Passkey
//     REGISTRATION happens on the pool's managed-login page (/passkeys/add):
//     the relying-party ID is the pool domain, so the WebAuthn ceremony must
//     run there, not on the admin origin.
//   owner — user administration through the pool's admin APIs with the
//     app's AWS credentials (local profile / Amplify SSR role): list, create
//     (invite email with a temporary password), group changes, disable /
//     enable, password reset, MFA removal, global sign-out.
import {
  CognitoIdentityProviderClient, ChangePasswordCommand, GetUserCommand,
  AssociateSoftwareTokenCommand, VerifySoftwareTokenCommand, SetUserMFAPreferenceCommand,
  ListWebAuthnCredentialsCommand, DeleteWebAuthnCredentialCommand,
  ListUsersCommand, AdminGetUserCommand, AdminListGroupsForUserCommand, AdminCreateUserCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand, AdminDisableUserCommand, AdminEnableUserCommand,
  AdminResetUserPasswordCommand, AdminSetUserMFAPreferenceCommand, AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from './config';

export const ROLES = ['owner', 'editor', 'viewer'];

let client = null;
const cognito = () => (client ??= new CognitoIdentityProviderClient({ region: config.region }));

const friendly = (err) => {
  const map = {
    NotAuthorizedException: 'Current password is incorrect, or your session has expired — sign out and back in.',
    InvalidPasswordException: 'Password does not meet the policy (12+ characters, upper/lower case, number, symbol).',
    LimitExceededException: 'Too many attempts — wait a few minutes and try again.',
    EnableSoftwareTokenMFAException: 'That code was not accepted. Codes rotate every 30 seconds — enter the current one.',
    CodeMismatchException: 'That code was not accepted.',
    UsernameExistsException: 'A user with that email already exists.',
    UserNotFoundException: 'No such user.',
  };
  return map[err?.name] || err?.message || 'Cognito request failed';
};
const run = async (cmd) => { try { return await cognito().send(cmd); } catch (err) { throw new Error(friendly(err)); } };

// ── self-service ─────────────────────────────────────────────────────────────

// accountStatus(accessToken) → { mfa: 'totp'|'none', passkeys: [{id, name, createdAt, relyingPartyId}] }
export async function accountStatus(accessToken) {
  const user = await run(new GetUserCommand({ AccessToken: accessToken }));
  const mfa = (user.UserMFASettingList || []).includes('SOFTWARE_TOKEN_MFA') ? 'totp' : 'none';
  let passkeys = [];
  try {
    const res = await run(new ListWebAuthnCredentialsCommand({ AccessToken: accessToken, MaxResults: 20 }));
    passkeys = (res.Credentials || []).map(c => ({
      id: c.CredentialId, name: c.FriendlyCredentialName || c.AuthenticatorAttachment || 'passkey',
      createdAt: c.CreatedAt ? new Date(c.CreatedAt).toISOString() : '', relyingPartyId: c.RelyingPartyId || '',
    }));
  } catch (err) {
    console.warn(`[account] ListWebAuthnCredentials failed: ${err.message}`);
  }
  return { mfa, passkeys, email: (user.UserAttributes || []).find(a => a.Name === 'email')?.Value || '' };
}

export async function changePassword(accessToken, previous, proposed) {
  if (!previous || !proposed) throw new Error('Both passwords are required');
  if (proposed.length < 12) throw new Error('New password must be at least 12 characters');
  await run(new ChangePasswordCommand({ AccessToken: accessToken, PreviousPassword: previous, ProposedPassword: proposed }));
}

// beginTotp(accessToken) → { secret, otpauth } — show the secret / otpauth
// link; the user scans or types it into an authenticator app.
export async function beginTotp(accessToken, email) {
  const res = await run(new AssociateSoftwareTokenCommand({ AccessToken: accessToken }));
  const secret = res.SecretCode;
  const otpauth = `otpauth://totp/${encodeURIComponent('UCC Admin')}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent('UCC Admin')}`;
  return { secret, otpauth };
}
export async function confirmTotp(accessToken, code) {
  const res = await run(new VerifySoftwareTokenCommand({ AccessToken: accessToken, UserCode: String(code).replace(/\s+/g, ''), FriendlyDeviceName: 'authenticator app' }));
  if (res.Status !== 'SUCCESS') throw new Error('That code was not accepted');
  await run(new SetUserMFAPreferenceCommand({ AccessToken: accessToken, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } }));
}
export async function disableTotp(accessToken) {
  await run(new SetUserMFAPreferenceCommand({ AccessToken: accessToken, SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false } }));
}
export async function deletePasskey(accessToken, credentialId) {
  await run(new DeleteWebAuthnCredentialCommand({ AccessToken: accessToken, CredentialId: credentialId }));
}
// passkeyAddUrl() → the pool's managed-login page that registers a passkey /
// security key for the signed-in user and returns to /profile.
export function passkeyAddUrl() {
  const url = new URL(`https://${config.authDomain}/passkeys/add`);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.appOrigin}/profile` }).toString();
  return url.toString();
}

// ── owner: user administration ───────────────────────────────────────────────

const attr = (u, name) => (u.Attributes || u.UserAttributes || []).find(a => a.Name === name)?.Value || '';

// listUsers() → [{ username, email, name, enabled, status, mfa, groups: [], role, created }]
export async function listUsers() {
  const all = [];
  let PaginationToken;
  do {
    const page = await run(new ListUsersCommand({ UserPoolId: config.poolId, Limit: 60, PaginationToken }));
    all.push(...(page.Users || []));
    PaginationToken = page.PaginationToken;
  } while (PaginationToken && all.length < 1000);
  const users = [];
  for (const u of all) {
    const groups = (await run(new AdminListGroupsForUserCommand({ UserPoolId: config.poolId, Username: u.Username }))).Groups?.map(g => g.GroupName) || [];
    const detail = await run(new AdminGetUserCommand({ UserPoolId: config.poolId, Username: u.Username }));
    users.push({
      username: u.Username,
      email: attr(u, 'email'),
      name: attr(u, 'name'),
      enabled: u.Enabled !== false,
      status: u.UserStatus,
      mfa: (detail.UserMFASettingList || []).includes('SOFTWARE_TOKEN_MFA') ? 'totp' : 'none',
      groups,
      role: ROLES.find(r => groups.includes(r)) || null,
      created: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString() : '',
    });
  }
  return users.sort((a, b) => a.email.localeCompare(b.email));
}

// createUser({ email, name, role }) → username. Cognito emails a temporary
// password (the invite); first sign-in forces a new password.
export async function createUser({ email, name, role }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is required');
  if (!ROLES.includes(role)) throw new Error('Role must be owner, editor or viewer');
  const res = await run(new AdminCreateUserCommand({
    UserPoolId: config.poolId,
    Username: email,
    DesiredDeliveryMediums: ['EMAIL'],
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      ...(name ? [{ Name: 'name', Value: name }] : []),
    ],
  }));
  await run(new AdminAddUserToGroupCommand({ UserPoolId: config.poolId, Username: res.User.Username, GroupName: role }));
  return res.User.Username;
}

export async function setRole(username, role) {
  if (!ROLES.includes(role)) throw new Error('Role must be owner, editor or viewer');
  const groups = (await run(new AdminListGroupsForUserCommand({ UserPoolId: config.poolId, Username: username }))).Groups?.map(g => g.GroupName) || [];
  for (const g of groups) if (ROLES.includes(g) && g !== role) await run(new AdminRemoveUserFromGroupCommand({ UserPoolId: config.poolId, Username: username, GroupName: g }));
  if (!groups.includes(role)) await run(new AdminAddUserToGroupCommand({ UserPoolId: config.poolId, Username: username, GroupName: role }));
}
export async function setEnabled(username, enabled) {
  await run(enabled
    ? new AdminEnableUserCommand({ UserPoolId: config.poolId, Username: username })
    : new AdminDisableUserCommand({ UserPoolId: config.poolId, Username: username }));
  if (!enabled) await run(new AdminUserGlobalSignOutCommand({ UserPoolId: config.poolId, Username: username }));
}
export async function resetPassword(username) {
  await run(new AdminResetUserPasswordCommand({ UserPoolId: config.poolId, Username: username })); // emails a code; next sign-in must set a new password
}
export async function removeMfa(username) {
  await run(new AdminSetUserMFAPreferenceCommand({ UserPoolId: config.poolId, Username: username, SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false } }));
}
export async function signOutEverywhere(username) {
  await run(new AdminUserGlobalSignOutCommand({ UserPoolId: config.poolId, Username: username }));
}
