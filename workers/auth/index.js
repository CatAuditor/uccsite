const ALLOWED_ORIGIN = 'https://utahciviccompact.org';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/auth') {
      const params = new URLSearchParams({
        client_id: env.CLIENT_ID,
        redirect_uri: `${url.origin}/callback`,
        scope: 'repo,user',
        state: url.searchParams.get('state') || '',
      });
      return Response.redirect(`https://github.com/login/oauth/authorize?${params}`);
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('Missing code', { status: 400 });

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.CLIENT_ID,
          client_secret: env.CLIENT_SECRET,
          code,
        }),
      });

      const { access_token, error } = await tokenRes.json();

      if (!access_token || error) {
        return htmlResponse(`window.opener.postMessage('authorization:github:error:${error || 'auth_failed'}','${ALLOWED_ORIGIN}');window.close();`);
      }

      const payload = JSON.stringify({ token: access_token, provider: 'github' });
      return htmlResponse(`window.opener.postMessage('authorization:github:success:${payload}','${ALLOWED_ORIGIN}');window.close();`);
    }

    return new Response('Not found', { status: 404 });
  },
};

function htmlResponse(script) {
  return new Response(`<!DOCTYPE html><html><body><script>${script}</script></body></html>`, {
    headers: { 'Content-Type': 'text/html' },
  });
}
