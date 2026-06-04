// Proxy Decap's popup open to the auth worker.
// This lets base_url = utahciviccompact.org so Decap accepts same-origin messages.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const dest = new URL('https://uccsite-auth.cothv.workers.dev/auth');
  dest.search = url.search;
  return Response.redirect(dest.toString(), 302);
}
