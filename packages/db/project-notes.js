'use strict';
// Internal project notes (docs/systems/projects.md "Notes"): markdown a
// signed-in admin types or uploads, filed under a project and an optional
// folder (the project_files folder convention, so notes and files share one
// tree in the admin). Never rendered to the site; never exported with the
// content (it is working material, not content).
const { normalizeFolder } = require('./files');

const TITLE_MAX = 200;
const BODY_MAX = 200_000;
const COLS = 'id, project_slug, folder, title, body_md, source_filename, pinned, author, created_at::text AS created_at, updated_at::text AS updated_at';

const rowToNote = (r) => ({
  id: r.id, projectSlug: r.project_slug, folder: r.folder || '', title: r.title, bodyMd: r.body_md || '',
  sourceFilename: r.source_filename || '', pinned: Number(r.pinned) === 1, author: r.author || '',
  createdAt: r.created_at, updatedAt: r.updated_at,
});

// listNotes(client, { projectSlug? }) → pinned first, then newest.
async function listNotes(client, { projectSlug } = {}) {
  const res = projectSlug
    ? await client.query(`SELECT ${COLS} FROM project_notes WHERE project_slug = $1 ORDER BY pinned DESC, updated_at DESC`, [projectSlug])
    : await client.query(`SELECT ${COLS} FROM project_notes ORDER BY pinned DESC, updated_at DESC`);
  return res.rows.map(rowToNote);
}

async function getNote(client, id) {
  const res = await client.query(`SELECT ${COLS} FROM project_notes WHERE id = $1`, [id]);
  return res.rows[0] ? rowToNote(res.rows[0]) : null;
}

function clean({ projectSlug, folder, title, bodyMd, sourceFilename, pinned, author }) {
  const t = String(title || '').trim().slice(0, TITLE_MAX);
  if (!t) throw new Error('A note needs a title');
  const body = String(bodyMd || '').replace(/\r\n/g, '\n');
  if (body.length > BODY_MAX) throw new Error(`A note is at most ${BODY_MAX.toLocaleString()} characters`);
  return [String(projectSlug || '').trim(), normalizeFolder(folder), t, body, sourceFilename ? String(sourceFilename).slice(0, 200) : null, pinned ? 1 : 0, author || null];
}

// upsertNote(client, note) → id. Insert when note.id is absent.
async function upsertNote(client, note) {
  const params = clean(note);
  if (!params[0]) throw new Error('A note belongs to a project');
  if (note.id) {
    await client.query(
      `UPDATE project_notes SET project_slug = $2, folder = $3, title = $4, body_md = $5, source_filename = $6, pinned = $7, author = $8, updated_at = now() WHERE id = $1`,
      [note.id, ...params]);
    return note.id;
  }
  const res = await client.query(
    `INSERT INTO project_notes (id, project_slug, folder, title, body_md, source_filename, pinned, author)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`, params);
  return res.rows[0].id;
}

async function deleteNote(client, id) {
  await client.query('DELETE FROM project_notes WHERE id = $1', [id]);
}

// noteCounts(client) → Map slug → n, for the admin's project list.
async function noteCounts(client) {
  const res = await client.query('SELECT project_slug, count(*)::int AS n FROM project_notes GROUP BY project_slug');
  return new Map(res.rows.map(r => [r.project_slug, r.n]));
}

module.exports = { TITLE_MAX, BODY_MAX, listNotes, getNote, upsertNote, deleteNote, noteCounts, rowToNote };
