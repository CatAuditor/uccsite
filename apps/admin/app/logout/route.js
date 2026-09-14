import { NextResponse } from 'next/server';
import { logoutUrl, SESSION_COOKIE, ACCESS_COOKIE } from '../../lib/auth';

export const dynamic = 'force-dynamic';

// POST only: a GET logout can be triggered by any cross-site link
// (SameSite=Lax cookies ride along on top-level navigations).
export async function POST() {
  const res = NextResponse.redirect(logoutUrl(), 303);
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(ACCESS_COOKIE);
  return res;
}
