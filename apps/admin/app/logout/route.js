import { NextResponse } from 'next/server';
import { logoutUrl, SESSION_COOKIE } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const res = NextResponse.redirect(logoutUrl());
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
