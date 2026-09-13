'use strict';
// Media library shared layer (build-spec-aws.md §13): the S3 key layout the
// admin (presigned PUT) and the media-process Lambda (S3 event) must agree
// on, the media_assets row ⇄ object mapping, and the variant picker the
// editors use to turn an asset into a URL. Pure functions — no pg, no SDK —
// so the admin's client components can import it too.
//
// Bucket layout (one media bucket per environment):
//   uploads/<id>/<filename>          private original (presigned PUT target)
//   media/<id>/<hash>-<width>.<ext>  processed variants, served at /media/*
//                                    by CloudFront, immutable cache
// Existing /assets/* stays on the site bucket untouched (plan: URLs never move).

const UPLOAD_PREFIX = 'uploads/';
const PUBLIC_PREFIX = 'media/';

// Responsive widths (spec §13). Variants larger than the original are skipped;
// an original narrower than the smallest width gets one variant at its own width.
const VARIANT_WIDTHS = [400, 800, 1200, 1600, 2400];
const FORMATS = ['avif', 'webp'];

// Images the pipeline accepts. SVG deliberately excluded (sharp would
// rasterize it, and hand-authored SVG is a script vector on a static site).
const ACCEPTED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/tiff'];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const STATUSES = ['pending', 'processing', 'ready', 'failed'];

// safeFilename('My Photo (1).JPG') → 'my-photo-1.jpg'
function safeFilename(name) {
  const base = String(name || 'upload').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `${stem}.${ext}` : stem;
}

function uploadKey(id, filename) {
  return `${UPLOAD_PREFIX}${id}/${safeFilename(filename)}`;
}

// parseUploadKey('uploads/<uuid>/x.jpg') → { id, filename } | null
function parseUploadKey(key) {
  const m = /^uploads\/([0-9a-f-]{36})\/([^/]+)$/.exec(key);
  return m ? { id: m[1], filename: m[2] } : null;
}

function variantKey(id, hash, width, format) {
  return `${PUBLIC_PREFIX}${id}/${hash}-${width}.${format}`;
}

// The public URL path for a bucket key under media/.
function publicPath(key) {
  return `/${key}`;
}

// assetIdFromPath('/media/<uuid>/abc-400.webp') → uuid | null. The editors'
// alt-text gate uses it: a photo field pointing at the media library must
// resolve to an asset with alt text before the save is accepted.
function assetIdFromPath(value) {
  const m = /^\/media\/([0-9a-f-]{36})\//.exec(String(value || ''));
  return m ? m[1] : null;
}

// pickVariant(variants, targetWidth, format) → variant | null. Smallest
// variant at least targetWidth wide, else the largest available.
function pickVariant(variants, targetWidth, format = 'webp') {
  const ofFormat = (variants || []).filter(v => v.format === format).sort((a, b) => a.width - b.width);
  if (!ofFormat.length) return null;
  return ofFormat.find(v => v.width >= targetWidth) || ofFormat[ofFormat.length - 1];
}

// Row ⇄ object. variants is stored as JSON text.
function rowToAsset(row) {
  return {
    id: row.id,
    s3Key: row.s3_key,
    originalFilename: row.original_filename,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    alt: row.alt || '',
    variants: row.variants ? JSON.parse(row.variants) : [],
    uploadedBy: row.uploaded_by,
    status: row.status,
    error: row.error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ASSET_COLUMNS = `id, s3_key, original_filename, mime, width, height, bytes, alt, variants,
  uploaded_by, status, error, created_at::text AS created_at, updated_at::text AS updated_at`;

module.exports = {
  UPLOAD_PREFIX, PUBLIC_PREFIX, VARIANT_WIDTHS, FORMATS, ACCEPTED_MIMES, MAX_UPLOAD_BYTES, STATUSES,
  safeFilename, uploadKey, parseUploadKey, variantKey, publicPath, assetIdFromPath, pickVariant,
  rowToAsset, ASSET_COLUMNS,
};
