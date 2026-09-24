// Project files server helpers (docs/systems/files.md). Same shape as the
// media library: uploads never pass through the admin server (presigned PUT
// scoped to ONE key, type and length), signed-in users download through
// presigned GETs (the bucket is private), and "publish" is a server-side
// CopyObject into the files/ prefix that CloudFront serves at /files/*.
// No Lambda: the admin verifies the upload itself (HeadObject).
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { withRetry } from '@uccsite/db';
import {
  MAX_FILE_BYTES, MAX_PUBLIC_BYTES, mimeForFilename, fileKey, publicFileKey, contentDisposition, normalizeFolder,
  rowToFile, FILE_COLUMNS,
} from '@uccsite/db/files';
import { config } from './config';

let s3 = null;
function getS3() {
  s3 ??= new S3Client({ region: config.region });
  return s3;
}

const PUT_EXPIRY_S = 30 * 60;   // a 250 MB upload on a slow link
const GET_EXPIRY_S = 15 * 60;
const LIST_LIMIT = 1000;
const NOTE_MAX = 500;
const PUBLIC_CACHE_CONTROL = 'public, max-age=300';

const UUID_RE = /^[0-9a-f-]{36}$/;
function assertId(id) {
  if (!UUID_RE.test(String(id))) throw new Error('Bad file id');
  return String(id);
}

// listProjects(client) → [{ slug, name }] in site order, for the project
// chooser and the move/upload selects.
export async function listProjects(client) {
  const res = await client.query(`SELECT slug, name FROM projects WHERE slug IS NOT NULL AND slug <> '' ORDER BY sort_order`);
  return res.rows.map(r => ({ slug: r.slug, name: r.name || r.slug }));
}

// listFiles(client) → every row newest first, each with downloadUrl
// (presigned GET, attachment) when ready. One query; the page groups by
// project and folder itself. Bounded like the media library.
export async function listFiles(client) {
  const res = await client.query(`SELECT ${FILE_COLUMNS} FROM project_files ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`);
  const files = res.rows.map(rowToFile);
  await Promise.all(files.map(async (f) => {
    f.downloadUrl = f.status === 'ready' ? await presignGet(f) : null;
  }));
  return files;
}

function presignGet(file) {
  return getSignedUrl(getS3(), new GetObjectCommand({
    Bucket: config.mediaBucket,
    Key: file.s3Key,
    ResponseContentDisposition: `attachment; filename="${file.s3Key.split('/').pop()}"`,
  }), { expiresIn: GET_EXPIRY_S });
}

async function getFile(client, id) {
  const row = (await client.query(`SELECT ${FILE_COLUMNS} FROM project_files WHERE id = $1`, [assertId(id)])).rows[0];
  if (!row) throw new Error('File not found');
  return rowToFile(row);
}

async function assertProject(client, slug) {
  if (!slug) return '';
  const r = (await client.query(`SELECT 1 FROM projects WHERE slug = $1`, [slug])).rows[0];
  if (!r) throw new Error(`Unknown project "${slug}"`);
  return slug;
}

// createUpload(client, { filename, bytes, projectSlug, folder, actor })
//   → { id, key, url, mime }
// The type comes from the extension (packages/db/files.js), never from the
// browser; Content-Type AND Content-Length are signed so S3 itself enforces
// both. Presign first, then insert, so a presign failure leaves no row.
export async function createUpload(client, { filename, bytes, projectSlug, folder, actor }) {
  const mime = mimeForFilename(filename);
  if (!mime) throw new Error(`"${filename}" is not an accepted file type`);
  if (!(bytes > 0) || bytes > MAX_FILE_BYTES) throw new Error(`File must be 1 byte to ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const slug = await assertProject(client, String(projectSlug || ''));
  const dir = normalizeFolder(folder);
  const id = randomUUID();
  const key = fileKey(id, filename);
  const url = await getSignedUrl(getS3(),
    new PutObjectCommand({ Bucket: config.mediaBucket, Key: key, ContentType: mime, ContentLength: bytes }),
    { expiresIn: PUT_EXPIRY_S, signableHeaders: new Set(['content-type', 'content-length']) });
  await client.query(
    `INSERT INTO project_files (id, project_slug, folder, original_filename, mime, bytes, s3_key, uploaded_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
    [id, slug, dir, String(filename).slice(0, 200), mime, bytes, key, actor]);
  console.log(`[files] ${actor} upload begun ${id} ${key} ${mime} ${bytes}B project=${slug || '-'} folder=${dir || '/'}`);
  return { id, key, url, mime };
}

// confirmUpload(client, id) → file. The browser says its PUT succeeded; the
// server checks the object is really there with the signed size before the
// row becomes 'ready' (a download link is only ever issued for real bytes).
export async function confirmUpload(client, id) {
  const file = await getFile(client, id);
  if (file.status === 'ready') return file;
  let head;
  try {
    head = await getS3().send(new HeadObjectCommand({ Bucket: config.mediaBucket, Key: file.s3Key }));
  } catch (err) {
    throw new Error(`Upload did not arrive in storage (${err.name || err.message})`);
  }
  if (Number(head.ContentLength) !== file.bytes) {
    throw new Error(`Stored size ${head.ContentLength} does not match the declared ${file.bytes} bytes`);
  }
  await withRetry(() => client.query(
    `UPDATE project_files SET status = 'ready', updated_at = now() WHERE id = $1`, [file.id]));
  console.log(`[files] ${file.id} ready ${file.bytes}B`);
  return { ...file, status: 'ready' };
}

// updateFile(client, id, { projectSlug, folder, note }) → { before, after }
export async function updateFile(client, id, { projectSlug, folder, note }) {
  const before = await getFile(client, id);
  const slug = await assertProject(client, String(projectSlug || ''));
  const dir = normalizeFolder(folder);
  const text = String(note || '').trim().slice(0, NOTE_MAX);
  await client.query(
    `UPDATE project_files SET project_slug = $2, folder = $3, note = $4, updated_at = now() WHERE id = $1`,
    [before.id, slug, dir, text]);
  return { before, after: { ...before, projectSlug: slug, folder: dir, note: text } };
}

// requestFilePublish(client, id, actor) → file. Records the ASK. Nothing is
// copied and nothing is reachable from the site until a second admin approves
// a site publish (docs/decisions/project-files-two-person-publish.md) — one
// editor must never be able to put a document on the internet alone.
// Validation runs here so the writer is told now, not at approval time.
export async function requestFilePublish(client, id, actor) {
  const file = await getFile(client, id);
  if (file.status !== 'ready') throw new Error('Upload is not complete');
  // CDN egress cap (docs/systems/files.md): big files belong on archive.org / YouTube.
  if (file.bytes > MAX_PUBLIC_BYTES) {
    throw new Error(`Files over ${MAX_PUBLIC_BYTES / 1024 / 1024} MB are not published from the site (CDN cost). Host it on archive.org (documents/data) or YouTube (video) and link to it instead.`);
  }
  if (file.publicKey) return file;
  await withRetry(() => client.query(
    `UPDATE project_files SET publish_requested_at = now(), publish_requested_by = $2, updated_at = now() WHERE id = $1`,
    [file.id, actor]));
  console.log(`[files] ${actor} requested publish of ${file.id}`);
  return { ...file, publishRequestedBy: actor };
}

// cancelFilePublish(client, id, actor) → file. Withdraws a request that has not
// been approved yet. Nothing was ever public, so there is no object to remove.
export async function cancelFilePublish(client, id, actor) {
  const file = await getFile(client, id);
  if (!file.publishRequestedAt) return file;
  await withRetry(() => client.query(
    `UPDATE project_files SET publish_requested_at = NULL, publish_requested_by = NULL, updated_at = now() WHERE id = $1`,
    [file.id]));
  console.log(`[files] ${actor} cancelled the publish request for ${file.id}`);
  return { ...file, publishRequestedAt: null, publishRequestedBy: null };
}

// promoteRequestedFiles(client, approver) → [{ id, key }]. Called by
// approvePublish once a DIFFERENT admin has approved, BEFORE the render runs —
// listPublishedFiles selects on public_key, so the copy has to land first or
// the site would list a URL that 404s.
//
// Per-file failures are collected, not thrown: one unreadable object must not
// block a whole site publish. A file that fails keeps its request and is
// retried on the next approval.
export async function promoteRequestedFiles(client, approver) {
  const res = await client.query(
    `SELECT ${FILE_COLUMNS} FROM project_files
     WHERE publish_requested_at IS NOT NULL AND public_key IS NULL AND status = 'ready'
     ORDER BY created_at`);
  const promoted = [];
  const failed = [];
  for (const row of res.rows) {
    const file = rowToFile(row);
    if (file.bytes > MAX_PUBLIC_BYTES) {
      failed.push({ id: file.id, reason: 'over the publish size cap' });
      continue;
    }
    const key = publicFileKey(file.id, file.s3Key.split('/').pop());
    try {
      await getS3().send(new CopyObjectCommand({
        Bucket: config.mediaBucket,
        CopySource: `${config.mediaBucket}/${encodeURIComponent(file.s3Key).replace(/%2F/g, '/')}`,
        Key: key,
        MetadataDirective: 'REPLACE',
        ContentType: file.mime,
        ContentDisposition: contentDisposition(file.mime, file.originalFilename),
        CacheControl: PUBLIC_CACHE_CONTROL,
      }));
    } catch (err) {
      console.error(`[files] promote failed for ${file.id}: ${err.name || 'error'}`);
      failed.push({ id: file.id, reason: err.name || 'copy failed' });
      continue;
    }
    await withRetry(() => client.query(
      `UPDATE project_files SET public_key = $2, published_at = now(), published_by = $3,
         publish_requested_at = NULL, publish_requested_by = NULL, updated_at = now()
       WHERE id = $1`,
      [file.id, key, approver]));
    console.log(`[files] ${approver} approved ${file.id} → ${key} (requested by ${file.publishRequestedBy})`);
    promoted.push({ id: file.id, key, requestedBy: file.publishRequestedBy });
  }
  return { promoted, failed };
}

// unpublishFile(client, id, actor) → file. Row first (a failed object delete
// leaves a stray public copy for a retry, never a row that claims a URL that
// is gone). The bucket is versioned: a delete marker; CloudFront may serve a
// cached copy for up to the 5 minute max-age.
//
// Deliberately ONE person: taking something down fast is a safety valve, and
// the two-person rule exists to stop things going up, not coming down. Also
// clears any outstanding request so an unpublish is not undone by the next
// approval.
export async function unpublishFile(client, id, actor) {
  const file = await getFile(client, id);
  if (!file.publicKey && !file.publishRequestedAt) return file;
  await withRetry(() => client.query(
    `UPDATE project_files SET public_key = NULL, published_at = NULL, published_by = NULL,
       publish_requested_at = NULL, publish_requested_by = NULL, updated_at = now()
     WHERE id = $1`,
    [file.id]));
  if (file.publicKey) await deleteKeys([file.publicKey]);
  console.log(`[files] ${actor} unpublished ${file.id} (${file.publicKey || 'request only'})`);
  return { ...file, publicKey: null, publishRequestedAt: null, publishRequestedBy: null };
}

// deleteFile(client, id) → file. Row first, then the original + public copy.
export async function deleteFile(client, id) {
  const file = await getFile(client, id);
  await withRetry(() => client.query('DELETE FROM project_files WHERE id = $1', [file.id]));
  await deleteKeys([file.s3Key, file.publicKey].filter(Boolean));
  return file;
}

async function deleteKeys(keys) {
  if (!keys.length) return;
  await getS3().send(new DeleteObjectsCommand({
    Bucket: config.mediaBucket,
    Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
  }));
}
