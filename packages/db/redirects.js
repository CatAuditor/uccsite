'use strict';
// redirects table (spec §9): from_path → to_url with a status. The database
// is the source of truth; every publish syncs the ACTIVE rows into the
// CloudFront KeyValueStore the viewer-request function reads
// (aws/publish/redirects-sync.js). Export writes redirects.json (§14.2).
const DDL = [
  `CREATE TABLE IF NOT EXISTS redirects (
    id UUID PRIMARY KEY,
    from_path TEXT UNIQUE NOT NULL,
    to_url TEXT NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 301,
    active INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
];

const FROM_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/; // an absolute site path
const STATUSES = [301, 302, 307, 308];

// validateRedirect({ fromPath, toUrl, statusCode }) → normalized | throws
function validateRedirect({ fromPath, toUrl, statusCode, note, active }) {
  const from = String(fromPath || '').trim();
  const to = String(toUrl || '').trim();
  const code = Number(statusCode || 301);
  if (!FROM_RE.test(from) || from.includes('//') || from.includes('..')) throw new Error('From must be a site path like /old-page (no query string)');
  if (from === '/') throw new Error('Cannot redirect the homepage');
  const sitePath = to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/\\') && /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/.test(to) && !to.includes('..');
  if (!(/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s"<>\\]*)?$/.test(to) || sitePath)) throw new Error('To must be an absolute https URL or a site path like /new-page (no spaces or control characters)');
  if (!STATUSES.includes(code)) throw new Error(`Status must be one of ${STATUSES.join(', ')}`);
  if (to === from) throw new Error('A redirect to itself would loop');
  return { fromPath: from, toUrl: to, statusCode: code, note: String(note || '').slice(0, 300), active: active ? 1 : 0 };
}

const rowToRedirect = (r) => ({
  id: r.id, fromPath: r.from_path, toUrl: r.to_url, statusCode: Number(r.status_code), active: Number(r.active) === 1,
  note: r.note || '', createdAt: r.created_at, updatedAt: r.updated_at,
});

async function listRedirects(client, { activeOnly = false } = {}) {
  const res = await client.query(
    `SELECT id, from_path, to_url, status_code, active, note, created_at::text AS created_at, updated_at::text AS updated_at
     FROM redirects ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY from_path`);
  return res.rows.map(rowToRedirect);
}

async function upsertRedirect(client, redirect) {
  const v = validateRedirect(redirect);
  // Two-hop loop guard: A → B while B → A already exists.
  if (v.toUrl.startsWith('/')) {
    const back = (await client.query('SELECT to_url FROM redirects WHERE from_path = $1 AND active = 1', [v.toUrl])).rows[0];
    if (back && back.to_url === v.fromPath) throw new Error(`${v.toUrl} already redirects back to ${v.fromPath} — that would loop`);
  }
  if (redirect.id) {
    await client.query(
      `UPDATE redirects SET from_path=$2, to_url=$3, status_code=$4, active=$5, note=$6, updated_at=now() WHERE id=$1`,
      [redirect.id, v.fromPath, v.toUrl, v.statusCode, v.active, v.note || null]);
    return redirect.id;
  }
  const res = await client.query(
    `INSERT INTO redirects (id, from_path, to_url, status_code, active, note)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
    [v.fromPath, v.toUrl, v.statusCode, v.active, v.note || null]);
  return res.rows[0].id;
}

async function deleteRedirect(client, id) {
  await client.query('DELETE FROM redirects WHERE id = $1', [id]); // caller owns the transaction/retry
}

// replaceRedirects(client, list) — restore path (wipe-and-load).
async function replaceRedirects(client, list) {
  await client.query('DELETE FROM redirects');
  for (const r of list) await upsertRedirect(client, { ...r, id: null });
}

// kvsEntries(redirects) → [{ key, value }] in the viewer function's format
// ({"to": …, "status": …}) — only active rows.
function kvsEntries(redirects) {
  return redirects.filter(r => r.active).map(r => ({ key: r.fromPath, value: JSON.stringify({ to: r.toUrl, status: r.statusCode }) }));
}

module.exports = { DDL, STATUSES, validateRedirect, listRedirects, upsertRedirect, deleteRedirect, replaceRedirects, kvsEntries };
