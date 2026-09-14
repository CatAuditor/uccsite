'use strict';
// Published project files for the site render (docs/systems/files.md):
// project slug → the files an editor has published, in folder/name order,
// shaped for templates/projects.html. Only rows with a public copy.
const { rowToFile, formatBytes, FILE_COLUMNS } = require('./files');

// listPublishedFiles(client) → { [slug]: [{ name, url, size, folder, note }] }
async function listPublishedFiles(client) {
  const res = await client.query(
    `SELECT ${FILE_COLUMNS} FROM project_files
     WHERE public_key IS NOT NULL AND status = 'ready' AND project_slug IS NOT NULL AND project_slug <> ''
     ORDER BY project_slug, folder, original_filename`);
  const bySlug = {};
  for (const row of res.rows) {
    const f = rowToFile(row);
    (bySlug[f.projectSlug] ??= []).push({
      name: f.originalFilename,
      url: f.publicPath,
      size: formatBytes(f.bytes),
      folder: f.folder,
      note: f.note,
    });
  }
  return bySlug;
}

module.exports = { listPublishedFiles };
