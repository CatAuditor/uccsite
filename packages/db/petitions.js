'use strict';
// Petitions (docs/systems/petition.md): ONE row per petition, filed under a
// project like press stories and documents. Replaces the single
// `homepage.petition` group (docs/decisions/petitions-collection.md): several
// petitions can be open at once, each with its own page at
// /projects/<project path>/<slug>, its own thank-you page under it, and the
// one ticked `featured` taking over the homepage hero.
//
// Strings only, like every collection; blanks are dropped on save. `status`
// is draft (never rendered), open (form live) or closed (page stays, form
// off). Signatures stay keyed by `slug` in petition_signatures, so renaming
// a slug starts a new count — the admin refuses a rename once signatures exist.

const PETITION_FIELDS = [
  'slug', 'project_slug', 'status', 'featured',
  'label', 'headline', 'body', 'cta', 'cta_secondary', 'cta_secondary_url', 'count_label',
  'form_title', 'form_intro', 'consent',
  'thanks_title', 'thanks_body', 'thanks_cta', 'thanks_dismiss',
  'donate_title', 'donate_body', 'donate_amounts', 'donate_default', 'donate_frequency', 'donate_default_frequency',
  'donate_custom_label', 'donate_button', 'donate_public_label',
  'share_title', 'share_text', 'share_image',
  'closed_body',
];
const PETITION_STATUSES = ['draft', 'open', 'closed'];
// Same pattern aws/api/routes.js enforces on the public form.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const isOpen = (p) => String(p?.status || '') === 'open';
const isClosed = (p) => String(p?.status || '') === 'closed';
const isFeatured = (p) => String(p?.featured || '') === '1';

// listPetitions(client, { ids }) → rows in admin order, the content shape
// (strings; NULL columns omitted). ids: true adds each row's `id` for the
// admin; the renderer and the export never see ids.
async function listPetitions(client, { ids = false } = {}) {
  const { rowToObject } = require('./content');
  const res = await client.query('SELECT * FROM petitions ORDER BY sort_order');
  return res.rows.map(r => ({ ...(ids ? { id: r.id } : {}), ...rowToObject('petitions', r) }));
}

async function getPetition(client, { id, slug }) {
  const { rowToObject } = require('./content');
  const res = id
    ? await client.query('SELECT * FROM petitions WHERE id = $1', [id])
    : await client.query('SELECT * FROM petitions WHERE slug = $1', [String(slug || '')]);
  const r = res.rows[0];
  return r ? { id: r.id, ...rowToObject('petitions', r) } : null;
}

// validatePetition(p, { others, projects }) → [] | ['message', …]. Pure.
//   others: the other petitions (slug uniqueness — signatures key on it alone)
//   projects: [{ slug, parent_slug }] — a petition always belongs to a project
function validatePetition(p, { others = [], projects = [] } = {}) {
  const errors = [];
  const slug = String(p.slug || '').trim();
  const project = String(p.project_slug || '').trim();
  if (!SLUG_RE.test(slug)) errors.push('Slug must be lowercase letters, digits and dashes (e.g. udot-alpr-permits)');
  if (slug === 'thanks') errors.push('"thanks" is reserved for the thank-you page');
  if (others.some(o => String(o.slug || '').trim() === slug)) errors.push(`Another petition already uses the slug "${slug}"`);
  if (!project) errors.push('Every petition belongs to a project — pick one');
  else if (!projects.some(x => String(x.slug || '').trim() === project)) errors.push(`"${project}" is not a project`);
  if (!PETITION_STATUSES.includes(String(p.status || 'draft'))) errors.push('Status must be draft, open or closed');
  if (String(p.featured || '') === '1' && !isOpen(p)) errors.push('Only an open petition can take over the homepage hero');
  return errors;
}

// savePetition(client, petition, { actor }) → id. Insert (no id) or update,
// inside the CALLER's transaction. Checks: the slug/project/status rules
// above, no clash with a document or sub-project at the same address, and a
// slug that already has signatures cannot change. Ticking `featured`
// un-ticks every other petition (one hero).
async function savePetition(client, petition) {
  const { insertRow, objectToParams, FIELD_MAPS } = require('./content');
  const p = {};
  for (const f of PETITION_FIELDS) {
    const v = petition[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') p[f] = String(v).trim();
  }
  p.status = p.status || 'draft';
  const id = petition.id || null;
  const current = id ? await getPetition(client, { id }) : null;
  if (id && !current) throw new Error('That petition no longer exists');
  const others = (await listPetitions(client, { ids: true })).filter(o => o.id !== id);
  const projects = (await client.query('SELECT slug, parent_slug FROM projects')).rows;
  const errors = validatePetition(p, { others, projects });
  if (errors.length) throw new Error(errors.join('. '));
  if (current && current.slug !== p.slug) {
    const n = Number((await client.query('SELECT count(*)::int AS n FROM petition_signatures WHERE petition = $1', [current.slug])).rows[0].n);
    if (n) throw new Error(`"${current.slug}" already has ${n} signature${n === 1 ? '' : 's'} filed under it; the slug cannot change. Close this petition and start a new one instead.`);
  }
  // Address clashes: /projects/<path>/<slug> is also where a document or a
  // sub-project of that project would live.
  const doc = (await client.query('SELECT title FROM documents WHERE project_slug = $1 AND slug = $2 LIMIT 1', [p.project_slug, p.slug])).rows[0];
  if (doc) throw new Error(`"${p.slug}" is already the address of the document "${doc.title}" in that project`);
  if (projects.some(x => String(x.parent_slug || '') === p.project_slug && x.slug === p.slug)) {
    throw new Error(`"${p.slug}" is a sub-project of that project; the petition needs another slug`);
  }
  if (isFeatured(p)) await client.query('UPDATE petitions SET featured = NULL, updated_at = now() WHERE id IS DISTINCT FROM $1 AND featured = $2', [id, '1']);
  if (current) {
    const cols = Object.keys(FIELD_MAPS.petitions);
    await client.query(
      `UPDATE petitions SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [id, ...objectToParams('petitions', p)]);
    return id;
  }
  const next = Number((await client.query('SELECT coalesce(max(sort_order), -1)::int + 1 AS n FROM petitions')).rows[0].n);
  return insertRow(client, 'petitions', p, { sort_order: next });
}

// deletePetition(client, id) — refused while signatures are filed under its
// slug (close it instead; the signatures are the record).
async function deletePetition(client, id) {
  const current = await getPetition(client, { id });
  if (!current) return;
  const n = Number((await client.query('SELECT count(*)::int AS n FROM petition_signatures WHERE petition = $1', [current.slug])).rows[0].n);
  if (n) throw new Error(`"${current.slug}" has ${n} signature${n === 1 ? '' : 's'}; close it instead of deleting it.`);
  await client.query('DELETE FROM petitions WHERE id = $1', [id]);
}

module.exports = { PETITION_FIELDS, PETITION_STATUSES, SLUG_RE, isOpen, isClosed, isFeatured, listPetitions, getPetition, validatePetition, savePetition, deletePetition };
