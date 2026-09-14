'use strict';
// Project files shared layer (docs/systems/files.md): the S3 key layout the
// admin's presigned PUT, the publish copy and the CloudFront /files/*
// behavior must agree on, the type allow-list, and the project_files row ⇄
// object mapping. Pure functions — no pg, no SDK — so client components can
// import it too.
//
// Bucket layout (the media bucket, next to the media library's prefixes):
//   private-files/<id>/<filename>  private upload (presigned PUT target;
//                                  signed-in admins download via presigned GET)
//   files/<id>/<filename>          the published copy, served at /files/<id>/<filename>
//                                  by CloudFront (the key IS the URL path; the
//                                  bucket policy grants media/* and files/* only)
// Neither prefix is uploads/, so the media-process Lambda never sees them.

const FILE_PREFIX = 'private-files/';
const PUBLIC_FILE_PREFIX = 'files/';
const PUBLIC_URL_PREFIX = '/files/';

const MAX_FILE_BYTES = 250 * 1024 * 1024;
// Publish cap (CDN egress control, docs/systems/files.md): a public file
// larger than this must go to archive.org / YouTube instead.
const MAX_PUBLIC_BYTES = 50 * 1024 * 1024;

// Extension → content type. The browser's declared type is IGNORED: the
// type is derived here, signed into the presigned PUT and written on the
// public copy, so nothing that a browser would execute on the site origin
// (html, svg, js, …) can ever be published, whatever the file was called.
const FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};
const ACCEPTED_EXTENSIONS = Object.keys(FILE_TYPES);

// Types a browser may render in place when published; everything else is
// sent as an attachment (Content-Disposition on the public copy).
const INLINE_TYPES = new Set(['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'audio/mpeg', 'audio/mp4', 'audio/wav',
  'video/mp4', 'video/webm']);

const STATUSES = ['pending', 'ready'];

// safeFilename('Q3 Records (final).PDF') → 'q3-records-final.pdf'
function safeFilename(name) {
  const base = String(name || 'file').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `${stem}.${ext}` : stem;
}

// mimeForFilename('report.PDF') → 'application/pdf' | null (not accepted)
function mimeForFilename(name) {
  const safe = safeFilename(name);
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 ? safe.slice(dot + 1) : '';
  return FILE_TYPES[ext] || null;
}

function fileKey(id, filename) {
  return `${FILE_PREFIX}${id}/${safeFilename(filename)}`;
}
function publicFileKey(id, filename) {
  return `${PUBLIC_FILE_PREFIX}${id}/${safeFilename(filename)}`;
}
// The site URL path of a published copy: /files/<id>/<filename>
function publicFilePath(id, filename) {
  return `${PUBLIC_URL_PREFIX}${id}/${safeFilename(filename)}`;
}

// contentDisposition(mime, filename) → header value for the public copy.
function contentDisposition(mime, filename) {
  return `${INLINE_TYPES.has(mime) ? 'inline' : 'attachment'}; filename="${safeFilename(filename)}"`;
}

// Folders are a free-text path inside a project ("Records requests/2026").
// normalizeFolder trims each segment, drops empties, caps depth and length,
// and strips characters that would break the path display; '' = root.
const FOLDER_MAX_DEPTH = 5;
const FOLDER_SEGMENT_MAX = 60;
function normalizeFolder(value) {
  return String(value || '')
    .split('/')
    .map(s => s.replace(/[^\p{L}\p{N} _.&()-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, FOLDER_SEGMENT_MAX))
    .filter(Boolean)
    .slice(0, FOLDER_MAX_DEPTH)
    .join('/');
}

// formatBytes(1536) → '2 KB'; (5*1024*1024) → '5.0 MB'
function formatBytes(n) {
  n = Number(n) || 0;
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function rowToFile(row) {
  return {
    id: row.id,
    projectSlug: row.project_slug || '',
    folder: row.folder || '',
    originalFilename: row.original_filename,
    mime: row.mime,
    bytes: row.bytes == null ? null : Number(row.bytes),
    note: row.note || '',
    s3Key: row.s3_key,
    publicKey: row.public_key || null,
    publicPath: row.public_key ? `/${row.public_key}` : null,
    publishedAt: row.published_at || null,
    publishedBy: row.published_by || null,
    uploadedBy: row.uploaded_by,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FILE_COLUMNS = `id, project_slug, folder, original_filename, mime, bytes, note, s3_key, public_key,
  published_at::text AS published_at, published_by, uploaded_by, status,
  created_at::text AS created_at, updated_at::text AS updated_at`;

module.exports = {
  FILE_PREFIX, PUBLIC_FILE_PREFIX, PUBLIC_URL_PREFIX, MAX_FILE_BYTES, MAX_PUBLIC_BYTES, FILE_TYPES, ACCEPTED_EXTENSIONS,
  INLINE_TYPES, STATUSES, FOLDER_MAX_DEPTH,
  safeFilename, mimeForFilename, fileKey, publicFileKey, publicFilePath, contentDisposition, normalizeFolder,
  formatBytes, rowToFile, FILE_COLUMNS,
};
