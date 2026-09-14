// Cognito auth for the admin (spec §11). Server-side only: authorization-code
// + PKCE against the hosted UI, ID token in an httpOnly cookie, verified with
// aws-jwt-verify on every read. Roles come from cognito:groups; authorization
// is enforced HERE (data layer), never in UI state.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config';
import { SESSION_COOKIE, PKCE_COOKIE, ACCESS_COOKIE } from './cookies';

export { SESSION_COOKIE, PKCE_COOKIE, ACCESS_COOKIE };

const b64url = (buf) => buf.toString('base64url');

let verifier = null;
function getVerifier() {
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: config.poolId,
    clientId: config.clientId,
    tokenUse: 'id',
  });
  return verifier;
}

// beginLogin() → { authorizeUrl, pkceCookieValue } (caller sets the cookie)
export function beginLogin() {
  const verifierValue = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifierValue).digest());
  const state = b64url(randomBytes(16));
  const url = new URL(`https://${config.authDomain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: `${config.appOrigin}/auth/callback`,
    scope: 'openid email profile aws.cognito.signin.user.admin',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return { authorizeUrl: url.toString(), pkceCookieValue: JSON.stringify({ v: verifierValue, s: state }) };
}

// exchangeCode(code, state, pkceCookieValue) → { idToken, accessToken, role }
// (throws on any mismatch; role null = authenticated but in no group)
export async function exchangeCode(code, state, pkceCookieValue) {
  const pkce = JSON.parse(pkceCookieValue || '{}');
  if (!pkce.v || pkce.s !== state) throw new Error('PKCE state mismatch');
  const res = await fetch(`https://${config.authDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: `${config.appOrigin}/auth/callback`,
      code,
      code_verifier: pkce.v,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id_token) throw new Error(`token exchange failed (${res.status})`);
  const payload = await getVerifier().verify(data.id_token); // reject before we ever store it
  return { idToken: data.id_token, accessToken: data.access_token, role: roleFromGroups(payload['cognito:groups']) };
}

// getAccessToken() → the signed-in user's access token (for their OWN
// Cognito self-service calls) or null. Only returned alongside a verified
// session so a stale/forged pair can't be used.
export async function getAccessToken() {
  if (!(await getSession())) return null;
  return (await cookies()).get(ACCESS_COOKIE)?.value || null;
}

// roleFromGroups(groups) → 'owner' | 'editor' | 'viewer' | null
export function roleFromGroups(groups = []) {
  return groups.includes('owner') ? 'owner'
    : groups.includes('editor') ? 'editor'
    : groups.includes('viewer') ? 'viewer' : null;
}

// getSession() → { email, groups, role, raw } | null. Verifies the JWT every call.
export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // Config errors (missing COGNITO_* env) must surface as a loud 500, not
  // masquerade as "not logged in" — so the verifier is built OUTSIDE the try.
  const verifier = getVerifier();
  try {
    const payload = await verifier.verify(token);
    const role = roleFromGroups(payload['cognito:groups']);
    if (!role) return null; // authenticated but ungrouped = no access
    // The email claim is the admin's identity (audit actor, team-bio link,
    // owner self-guards). Users can change their own email through the
    // self-service scope, so only a VERIFIED email counts (and the pool keeps
    // the original until the new one is verified — CDK keepOriginal).
    if (payload.email_verified !== true && payload.email_verified !== 'true') {
      console.warn('[admin] session rejected: email not verified');
      return null;
    }
    return { email: String(payload.email).toLowerCase(), username: payload['cognito:username'] || payload.sub, groups: payload['cognito:groups'] || [], role, raw: payload };
  } catch (err) {
    // A JWKS outage must look different from a forged token in the logs.
    console.warn(`[admin] session token rejected: ${err?.name || 'Error'}: ${err?.message || ''}`);
    return null;
  }
}

// requireSession() — PAGE-level gate: a verified session or a redirect to
// /login. Cookie PRESENCE (middleware) is not authentication; every page
// that renders anything protected calls this. A null session here covers
// forged/expired tokens AND authenticated-but-ungrouped users.
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    console.warn('[admin] request with invalid/ungrouped session token — redirecting to login');
    redirect('/login');
  }
  return session;
}

const ROLE_RANK = { viewer: 0, editor: 1, owner: 2 };

// requireRecentAuth(session, maxAgeMinutes) — sensitive account changes
// (removing a second factor) need a fresh sign-in, not just a live cookie.
export function requireRecentAuth(session, maxAgeMinutes = 15) {
  const authTime = Number(session?.raw?.auth_time || 0) * 1000;
  if (!authTime || Date.now() - authTime > maxAgeMinutes * 60_000) {
    throw new Error(`For this change, sign out and back in first (sign-in must be less than ${maxAgeMinutes} minutes old).`);
  }
}

// requireRole('editor') → session (throws if unauthenticated/underprivileged).
// Every server action calls this — UI hiding is not authorization.
export async function requireRole(minRole) {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  if (ROLE_RANK[session.role] < ROLE_RANK[minRole]) {
    throw new Error(`Requires ${minRole} role (you are ${session.role})`);
  }
  return session;
}

export function logoutUrl() {
  const url = new URL(`https://${config.authDomain}/logout`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: `${config.appOrigin}/login`,
  }).toString();
  return url.toString();
}
