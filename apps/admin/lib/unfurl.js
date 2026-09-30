'use server';
// "Add from link" for News & Media (docs/systems/admin.md "Link previews"):
// fetch a pasted article URL server-side and return a preview card plus the
// fields it fills. Parsing is in unfurl-parse.mjs (pure, tested).
//
// This runs under the admin's AWS compute role, so every hop is checked
// against private/link-local/loopback ranges BEFORE it is fetched, and
// redirects are followed by hand so a public URL cannot bounce the request to
// the instance metadata service. Residual risk: DNS rebinding between the
// check and the connect — acceptable for an editor-only, audited-session tool.
import { lookup } from 'node:dns/promises';
import { requireRole } from './auth';
import { parsePreview, previewFromUrl, looksBlocked, isPrivateAddress } from './unfurl-parse.mjs';

const MAX_HOPS = 4;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; UCC-LinkPreview/1.0; +https://utahciviccompact.org)';

async function assertPublic(u) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) links can be previewed.');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('That link uses an unusual port and cannot be previewed.');
  if (u.username || u.password) throw new Error('Links with embedded credentials cannot be previewed.');
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Could not find ${u.hostname}. Check the link.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('That address is not a public website.');
}

async function readCapped(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= MAX_BYTES) { await reader.cancel(); break; }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

export async function unfurlLink(rawUrl) {
  const s = await requireRole('editor');
  let url;
  try { url = new URL(String(rawUrl || '').trim()); } catch { return { ok: false, error: 'That does not look like a web address.' }; }

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      await assertPublic(url);
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.8,es;q=0.5' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url);
        continue;
      }
      // Blocked (bot wall) → fill what the link itself reveals, marked partial.
      if ([401, 403, 429, 503].includes(res.status)) {
        console.warn(`[unfurl] ${s.email} ${url.hostname} blocked (HTTP ${res.status}) → from-link fallback`);
        return { ok: true, ...previewFromUrl(url.href) };
      }
      if (!res.ok) {
        console.warn(`[unfurl] ${s.email} ${url.hostname} → HTTP ${res.status}`);
        return { ok: false, error: res.status === 404 ? 'That page does not exist (404). Check the link.' : `The site answered ${res.status}. Fill the fields in by hand.` };
      }
      const type = res.headers.get('content-type') || '';
      if (!/html/i.test(type)) return { ok: false, error: 'That link is not a web page (it looks like a file).' };
      const html = await readCapped(res);
      const preview = looksBlocked(html) ? previewFromUrl(url.href) : parsePreview(html, url.href);
      console.log(`[unfurl] ${s.email} ${url.hostname} ok`);
      return { ok: true, ...preview };
    }
    return { ok: false, error: 'That link redirects too many times.' };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return { ok: false, error: 'The site took too long to answer.' };
    if (/public website|port|credentials|Could not find|http\(s\)/.test(err.message)) return { ok: false, error: err.message };
    console.error(`[unfurl] ${s.email} ${url.hostname} failed: ${err.name}`);
    return { ok: false, error: 'Could not read that page. Fill the fields in by hand.' };
  }
}
