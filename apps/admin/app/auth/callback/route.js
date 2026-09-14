import { NextResponse } from 'next/server';
import { exchangeCode, SESSION_COOKIE, PKCE_COOKIE, ACCESS_COOKIE } from '../../../lib/auth';
import { config } from '../../../lib/config';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const pkce = request.cookies.get(PKCE_COOKIE)?.value;
  // Redirects are built from APP_ORIGIN, not the request Host — behind
  // Amplify's proxy the Host header is not necessarily the public origin.
  try {
    const { idToken, accessToken, role } = await exchangeCode(code, state, pkce);
    if (!role) {
      // Authenticated but in no group: don't set the cookie (it would only
      // bounce between / and /login with no message).
      console.warn('[admin] sign-in by a user in no Cognito group — refused');
      const res = NextResponse.redirect(new URL('/login?error=nogroup', config.appOrigin));
      res.cookies.delete(PKCE_COOKIE);
      return res;
    }
    const res = NextResponse.redirect(new URL('/', config.appOrigin));
    const flags = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 3600, path: '/' };
    res.cookies.set(SESSION_COOKIE, idToken, flags);
    if (accessToken) res.cookies.set(ACCESS_COOKIE, accessToken, flags);
    res.cookies.delete(PKCE_COOKIE);
    return res;
  } catch (err) {
    console.error('[admin] auth callback failed:', err.message);
    return NextResponse.redirect(new URL('/login?error=1', config.appOrigin));
  }
}
