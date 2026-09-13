import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { beginLogin, PKCE_COOKIE, getSession } from '../../lib/auth';

export const dynamic = 'force-dynamic';

const ERRORS = {
  nogroup: 'Your account is not in an admin group yet. Ask an owner to add you to owner, editor or viewer, then sign in again.',
  1: 'Sign-in failed. Try again; if it keeps failing, tell the site owner.',
};

export default async function LoginPage({ searchParams }) {
  if (await getSession()) redirect('/');
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] || ERRORS[1]) : null;

  async function signIn() {
    'use server';
    const { authorizeUrl, pkceCookieValue } = beginLogin();
    (await cookies()).set(PKCE_COOKIE, pkceCookieValue, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600, path: '/',
    });
    redirect(authorizeUrl);
  }

  return (
    <div>
      <h1>Utah Civic Compact — Admin</h1>
      <p>Sign in with your admin account. Accounts are created by an owner — there is no self-signup.</p>
      {message && <div className="error" role="alert">{message}</div>}
      <form action={signIn}><button type="submit">Sign in</button></form>
    </div>
  );
}
