import { NextResponse } from 'next/server';
import { exchangeCode, SESSION_COOKIE, PKCE_COOKIE } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const pkce = request.cookies.get(PKCE_COOKIE)?.value;
  try {
    const idToken = await exchangeCode(code, state, pkce);
    const res = NextResponse.redirect(new URL('/', request.url));
    res.cookies.set(SESSION_COOKIE, idToken, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 3600, path: '/',
    });
    res.cookies.delete(PKCE_COOKIE);
    return res;
  } catch (err) {
    console.error('[admin] auth callback failed:', err.message);
    return NextResponse.redirect(new URL('/login?error=1', request.url));
  }
}
