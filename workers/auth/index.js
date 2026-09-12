// GitHub OAuth proxy for Decap CMS.
//   /auth      → redirects to GitHub with a random `state`, stored in a cookie
//   /callback  → verifies `state` against the cookie, exchanges code, hands token to /admin/callback.html
// Secrets: CLIENT_ID (var), CLIENT_SECRET (wrangler secret put CLIENT_SECRET)

const ADMIN_ORIGIN = 'https://utahciviccompact.org';
const STATE_COOKIE = 'oauth_state';
const STATE_TTL = 600; // seconds

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/auth') {
      const state = randomState();
      const params = new URLSearchParams({
        client_id: env.CLIENT_ID,
        redirect_uri: `${url.origin}/callback`,
        scope: env.GITHUB_SCOPE || 'public_repo',
        state,
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: `https://github.com/login/oauth/authorize?${params}`,
          'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/callback; Max-Age=${STATE_TTL}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookieState = getCookie(request, STATE_COOKIE);

      if (!code) return errorRedirect('missing_code');
      if (!state || !cookieState || !timingSafeEqual(state, cookieState)) {
        return errorRedirect('state_mismatch');
      }

      let access_token, error;
      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: env.CLIENT_ID,
            client_secret: env.CLIENT_SECRET,
            code,
            redirect_uri: `${url.origin}/callback`,
          }),
        });
        if (!tokenRes.ok) return errorRedirect('token_exchange_failed');
        ({ access_token, error } = await tokenRes.json());
      } catch {
        return errorRedirect('token_exchange_failed');
      }

      if (!access_token || error) return errorRedirect('auth_failed');

      // Token goes in the URL fragment only (never sent to a server); same-origin
      // callback page relays it to the Decap window via BroadcastChannel/postMessage.
      const msg = encodeURIComponent(
        `authorization:github:success:${JSON.stringify({ token: access_token, provider: 'github' })}`
      );
      return redirectToAdmin(msg);
    }

    return new Response('Not found', { status: 404 });
  },
};

function errorRedirect(code) {
  return redirectToAdmin(encodeURIComponent(`authorization:github:error:${code}`));
}

function redirectToAdmin(fragment) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${ADMIN_ORIGIN}/admin/callback.html#${fragment}`,
      'Set-Cookie': `${STATE_COOKIE}=; Path=/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
