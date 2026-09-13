import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { beginLogin, PKCE_COOKIE, getSession } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getSession()) redirect('/');

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
      <form action={signIn}><button type="submit">Sign in</button></form>
    </div>
  );
}
