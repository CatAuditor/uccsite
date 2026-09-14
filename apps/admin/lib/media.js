// Media library server helpers (spec §13). Uploads never pass through the
// admin server: the browser PUTs straight to the media bucket with a
// presigned URL scoped to ONE key + content type; the S3 event then drives
// the media-process Lambda. Thumbnails are presigned GETs (the bucket is
// private and staging CloudFront sits behind basic auth).
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { withRetry } from '@uccsite/db';
import {
  ACCEPTED_MIMES, MAX_UPLOAD_BYTES, uploadKey, pickVariant, rowToAsset, ASSET_COLUMNS,
} from '@uccsite/db/media';
import { config } from './config';

let s3 = null;
function getS3() {
  s3 ??= new S3Client({ region: config.region });
  return s3;
}

const PUT_EXPIRY_S = 15 * 60;
const GET_EXPIRY_S = 60 * 60;
// A pending/processing row older than this is abandoned (PUT never landed,
// or the Lambda crashed): shown as stalled, and it stops the page polling.
const STALL_MS = 15 * 60 * 1000;

export function isStalled(asset) {
  return (asset.status === 'pending' || asset.status === 'processing')
    && Date.now() - new Date(asset.updatedAt || asset.createdAt).getTime() > STALL_MS;
}

// Bounded lists: the library page presigns one GET per row and the editor
// pickers ship every option as client props. Pagination arrives when the
// library outgrows this.
const LIST_LIMIT = 500;

// listAssets(client) → asset[] newest first, each with thumbUrl (presigned
// GET of the smallest WebP variant) when ready, and stalled (see above).
export async function listAssets(client) {
  const res = await client.query(`SELECT ${ASSET_COLUMNS} FROM media_assets ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`);
  const assets = res.rows.map(rowToAsset);
  await Promise.all(assets.map(async (a) => {
    const thumb = pickVariant(a.variants, 1, 'webp');
    a.thumbUrl = thumb ? await presignGet(thumb.path.slice(1)) : null;
    a.stalled = isStalled(a);
    a.usedBy = await assetUsage(client, a.id);
  }));
  return assets;
}

function presignGet(key) {
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: config.mediaBucket, Key: key }),
    { expiresIn: GET_EXPIRY_S });
}

// createUpload(client, { filename, mime, bytes, actor }) → { id, key, url }
// Presign first (local crypto, but it is where a missing MEDIA_BUCKET or
// expired credentials throw), then insert the pending row so the Lambda
// always finds it — no orphan rows from a failed presign. The content type
// is SIGNED (the presigner leaves it unsigned by default), so the browser's
// PUT must carry exactly the type it declared.
export async function createUpload(client, { filename, mime, bytes, actor }) {
  if (!ACCEPTED_MIMES.includes(mime)) throw new Error(`Unsupported file type ${mime || '(unknown)'}`);
  if (!(bytes > 0) || bytes > MAX_UPLOAD_BYTES) throw new Error(`File must be 1 byte to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const id = randomUUID();
  const key = uploadKey(id, filename);
  // Content-Type AND Content-Length are signed: the browser must send
  // exactly the declared type and size, so the 25 MB gate is enforced by S3
  // itself, not just by the declared `bytes`.
  const url = await getSignedUrl(getS3(),
    new PutObjectCommand({ Bucket: config.mediaBucket, Key: key, ContentType: mime, ContentLength: bytes }),
    { expiresIn: PUT_EXPIRY_S, signableHeaders: new Set(['content-type', 'content-length']) });
  await client.query(
    `INSERT INTO media_assets (id, s3_key, original_filename, mime, bytes, uploaded_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [id, key, String(filename).slice(0, 200), mime, bytes, actor]);
  console.log(`[media] ${actor} upload begun ${id} ${key} ${mime} ${bytes}B`);
  return { id, key, url };
}

// assetUsage(client, id) → ['team: Jarom Gillins', 'document: alpr', …] — every
// place a /media/<id>/ path is referenced (team headshots, document bodies).
export async function assetUsage(client, id) {
  const needle = `/media/${id}/`;
  const team = await client.query(`SELECT name FROM team_members WHERE photo LIKE $1`, [`%${needle}%`]);
  const docs = await client.query(`SELECT slug FROM documents WHERE body_html_raw LIKE $1 OR og_image LIKE $1 OR page_css LIKE $1`, [`%${needle}%`]);
  return [...team.rows.map(r => `team: ${r.name}`), ...docs.rows.map(r => `document: ${r.slug}`)];
}

// deleteAsset(client, id) → asset. Refuses while anything references the
// asset (a deleted image would 404 on the next publish). Row FIRST (retried
// on 40001 — the Lambda may be updating it), then the S3 objects: a failed
// object delete leaves orphaned bytes, never a live row whose variants are gone.
export async function deleteAsset(client, id) {
  const row = (await client.query(`SELECT ${ASSET_COLUMNS} FROM media_assets WHERE id = $1`, [id])).rows[0];
  if (!row) throw new Error('Asset not found');
  const asset = rowToAsset(row);
  const used = await assetUsage(client, id);
  if (used.length) throw new Error(`Still used by ${used.join(', ')} — remove it there first.`);
  await withRetry(() => client.query('DELETE FROM media_assets WHERE id = $1', [id]));
  const keys = [asset.s3Key, ...asset.variants.map(v => v.path.slice(1))].filter(Boolean);
  if (keys.length) {
    await getS3().send(new DeleteObjectsCommand({
      Bucket: config.mediaBucket,
      Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
    }));
  }
  return asset;
}

// mediaOptionsFor(client, targetWidth) → [{ value, label }] for editor pickers:
// READY assets WITH alt text only — the spec's "alt text is required before an
// asset can attach" gate, enforced again server-side in collection-save.
export async function mediaOptionsFor(client, targetWidth) {
  const res = await client.query(
    `SELECT ${ASSET_COLUMNS} FROM media_assets
     WHERE status = 'ready' AND alt IS NOT NULL AND alt <> '' ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`);
  return res.rows.map(rowToAsset).map((a) => {
    const v = pickVariant(a.variants, targetWidth, 'webp');
    return v ? { value: v.path, label: `${a.alt} (${a.originalFilename}, ${v.width}px)` } : null;
  }).filter(Boolean);
}

// assertAltText(client, ids) — throws naming the first asset lacking alt text.
export async function assertAltText(client, ids) {
  if (!ids.length) return;
  const res = await client.query(
    `SELECT id, original_filename, alt, status FROM media_assets WHERE id = ANY($1::uuid[])`, [ids]);
  const byId = new Map(res.rows.map(r => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) throw new Error(`Media asset ${id} no longer exists`);
    if (r.status !== 'ready') throw new Error(`"${r.original_filename}" is not processed yet (${r.status})`);
    if (!r.alt) throw new Error(`"${r.original_filename}" needs alt text before it can be used on a page`);
  }
}
