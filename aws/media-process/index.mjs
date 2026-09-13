// media-process Lambda (build-spec-aws.md §13): fired by the media bucket's
// ObjectCreated event under uploads/. Reads the private original, generates
// AVIF + WebP variants at the responsive widths with sharp, writes them under
// media/<id>/<hash>-<w>.<ext> with an immutable cache header, and records
// dimensions + the variant list on the media_assets row.
//
// Idempotent: variant keys are derived from the original's content hash, so a
// duplicate S3 event rewrites identical objects and lands on the same row
// state. Failures land on the row as status 'failed' + error (the admin shows
// it) and are NOT rethrown — an S3 → Lambda retry would only fail the same way.
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { withConnection } from '@uccsite/db';
import {
  VARIANT_WIDTHS, FORMATS, ACCEPTED_MIMES, MAX_UPLOAD_BYTES,
  parseUploadKey, variantKey, publicPath,
} from '@uccsite/db/media';

const { MEDIA_BUCKET, DSQL_ENDPOINT } = process.env;
const region = process.env.AWS_REGION;
const s3 = new S3Client({ region });
const db = { endpoint: DSQL_ENDPOINT, region };

const ENCODE = {
  avif: { quality: 55, effort: 4 },
  webp: { quality: 80, effort: 4 },
};
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

async function setStatus(client, id, status, extra = {}) {
  const sets = ['status = $2', 'updated_at = now()'];
  const params = [id, status];
  for (const [k, v] of Object.entries(extra)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  await client.query(`UPDATE media_assets SET ${sets.join(', ')} WHERE id = $1`, params);
}

// processOne(key) → { id, variants } | null (null = skipped, logged why)
async function processOne(key) {
  const parsed = parseUploadKey(key);
  if (!parsed) { console.warn(`[media] ignoring key outside uploads/<id>/: ${key}`); return null; }
  const { id } = parsed;

  return withConnection(db, async (client) => {
    const row = (await client.query('SELECT id, mime, status FROM media_assets WHERE id = $1', [id])).rows[0];
    if (!row) { console.warn(`[media] no media_assets row for ${id} (${key}) — skipping`); return null; }
    await setStatus(client, id, 'processing', { s3_key: key, error: null });
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
      const original = Buffer.from(await obj.Body.transformToByteArray());
      const mime = obj.ContentType || row.mime || '';
      if (original.length > MAX_UPLOAD_BYTES) throw new Error(`original is ${original.length} bytes (max ${MAX_UPLOAD_BYTES})`);
      if (!ACCEPTED_MIMES.includes(mime)) throw new Error(`unsupported content type ${mime || '(none)'}`);

      const hash = createHash('sha256').update(original).digest('hex').slice(0, 12);
      const meta = await sharp(original).rotate().metadata();
      // rotate() normalizes EXIF orientation; width/height after rotation.
      const srcW = meta.orientation >= 5 ? meta.height : meta.width;
      const srcH = meta.orientation >= 5 ? meta.width : meta.height;
      if (!srcW || !srcH) throw new Error('could not read image dimensions');
      const widths = VARIANT_WIDTHS.filter(w => w <= srcW);
      if (!widths.length) widths.push(srcW);
      console.log(`[media] ${id} ${mime} ${srcW}x${srcH} ${original.length}B → widths ${widths.join('/')} hash ${hash}`);

      const variants = [];
      for (const width of widths) {
        for (const format of FORMATS) {
          const out = await sharp(original).rotate().resize({ width, withoutEnlargement: true })
            .toFormat(format, ENCODE[format]).toBuffer({ resolveWithObject: true });
          const vkey = variantKey(id, hash, width, format);
          await s3.send(new PutObjectCommand({
            Bucket: MEDIA_BUCKET, Key: vkey, Body: out.data,
            ContentType: `image/${format}`, CacheControl: CACHE_CONTROL,
          }));
          variants.push({ format, width: out.info.width, height: out.info.height, path: publicPath(vkey), bytes: out.data.length });
        }
      }
      await setStatus(client, id, 'ready', {
        mime, width: srcW, height: srcH, bytes: original.length, variants: JSON.stringify(variants),
      });
      console.log(`[media] ${id} ready: ${variants.length} variants`);
      return { id, variants };
    } catch (err) {
      console.error(`[media] ${id} failed: ${err.message}`);
      await setStatus(client, id, 'failed', { error: String(err.message).slice(0, 500) });
      return null;
    }
  });
}

export async function handler(event) {
  const records = event?.Records || [];
  for (const rec of records) {
    const key = decodeURIComponent((rec.s3?.object?.key || '').replace(/\+/g, ' '));
    if (!key) continue;
    await processOne(key);
  }
  return { processed: records.length };
}
