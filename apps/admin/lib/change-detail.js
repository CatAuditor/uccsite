// "What changed" on Publish & Status (docs/systems/admin.md "What changed").
// For every thing saved since the site last went live: the state just BEFORE
// the first unpublished save (its revision snapshot) against the state now,
// turned into plain-English lines by change-detail-core.mjs. This is the net
// effect of publishing — an edit made and then undone shows as no change.
//
// Read-only. Anything that cannot be described (no revision kept, an unknown
// kind of save) still appears, as its list of saves, so nothing is hidden.
import { loadSettings, loadHomepage, list, loadProjects } from '@uccsite/db/content';
import { getDocument, listOverrides } from '@uccsite/db/documents';
import { DEFAULT_NAVIGATION } from '@uccsite/render/navigation';
import { COLLECTIONS, HOMEPAGE_GROUPS, SETTINGS_FIELDS, APPEAL_SETTINGS_FIELDS, HOMEPAGE_PRESS_FIELDS } from './collections';
import { diffFields, diffList, diffNavigation, diffDocument } from './change-detail-core.mjs';

const ADMIN_PAGE = {
  team: '/team', statements: '/statements', issues: '/issues', 'blog-articles': '/blog', 'blog-videos': '/blog',
  projects: '/projects', 'coverage-alpr': '/coverage', 'coverage-stratos': '/coverage',
};
const SECTION_PAGE = {
  Homepage: '/homepage', Petition: '/petition', 'Donation appeals': '/appeals',
  'Site Settings': '/settings', Menus: '/navigation',
};
// Which section a save belongs to, by its audit action.
const ACTION_SECTION = {
  'petition.save': 'Petition', 'appeals.save': 'Donation appeals', 'settings.navigation': 'Menus',
  'settings.save': 'Site Settings', 'homepage.save': 'Homepage',
};
const ACTION_WORDS = {
  save: 'saved', create: 'created', delete: 'deleted', restore: 'restored a revision of', upload: 'uploaded',
  navigation: 'saved', alt: 'edited alt text of', publish: 'published',
  archive: 'archived', unarchive: 'restored as a draft',
};
const humanAction = (action) => ACTION_WORDS[action.split('.').pop()] || action;
const labelMap = (pairs) => Object.fromEntries(pairs.map((f) => (Array.isArray(f) ? [f[0], f[1]] : [f.name, f.label])));

// Same read as collection-save.js loadCollectionItems, without its auth import
// (this module only reads).
function loadCollectionItems(client, key) {
  const spec = COLLECTIONS[key];
  if (spec.nested) return loadProjects(client);
  return spec.where ? list(client, spec.table, `WHERE ${spec.where[0]} = $1`, [spec.where[1]]) : list(client, spec.table, '', []);
}

async function revisionBefore(client, entityType, entityId, sinceIso) {
  const res = await client.query(
    `SELECT snapshot FROM revisions WHERE entity_type = $1 AND entity_id = $2 AND created_at > $3
     ORDER BY created_at ASC LIMIT 1`,
    [entityType, String(entityId), sinceIso || '1970-01-01']);
  if (!res.rows[0]) return undefined;
  try { return JSON.parse(res.rows[0].snapshot); } catch { return undefined; }
}

async function documentNow(client, id) {
  const doc = await getDocument(client, { id });
  if (!doc) return null;
  return { ...doc, overrides: (await listOverrides(client, id)).map(({ nid, classes, mode }) => ({ nid, classes, mode })) };
}

// → [{ name, href, lines }] for one saved thing; [] = described, nothing
// differs from the live site; null = cannot be described (no revision kept).
async function describe(client, entityType, entityId, before, saves) {
  const spec = COLLECTIONS[entityType];
  if (spec) {
    if (before === undefined) return null;
    const after = await loadCollectionItems(client, entityType);
    return [{ name: spec.title, href: ADMIN_PAGE[entityType], lines: diffList(before || [], after, labelMap(spec.fields)) }];
  }
  if (entityType === 'homepage') {
    if (before === undefined) return null;
    const after = await loadHomepage(client);
    const out = [];
    for (const g of HOMEPAGE_GROUPS) {
      const fields = diffFields(before[g.key] || {}, after[g.key] || {}, labelMap(g.fields));
      if (!fields.length) continue;
      const name = g.page === 'petition' ? 'Petition' : g.page === 'appeals' ? 'Donation appeals' : 'Homepage';
      out.push({ name, lines: [{ kind: 'changed', text: g.title, fields }] });
    }
    const press = diffList(before.press || [], after.press || [], labelMap(HOMEPAGE_PRESS_FIELDS))
      .map((l) => ({ ...l, text: `Press strip — ${l.text}` }));
    if (press.length) out.push({ name: 'Homepage', lines: press });
    return out;
  }
  if (entityType === 'settings') {
    if (before === undefined) return null;
    const after = await loadSettings(client);
    const out = [];
    const site = diffFields(before, after, labelMap(SETTINGS_FIELDS), { only: SETTINGS_FIELDS.map(([k]) => k) });
    if (site.length) out.push({ name: 'Site Settings', lines: [{ kind: 'changed', text: 'Settings', fields: site }] });
    const appeals = diffFields(before, after, labelMap(APPEAL_SETTINGS_FIELDS), { only: APPEAL_SETTINGS_FIELDS.map(([k]) => k) });
    if (appeals.length) out.push({ name: 'Donation appeals', lines: [{ kind: 'changed', text: 'Download pop-up', fields: appeals }] });
    const menus = diffNavigation(before.navigation, after.navigation, DEFAULT_NAVIGATION);
    if (menus.length) out.push({ name: 'Menus', lines: menus });
    return out;
  }
  if (entityType === 'document') {
    const created = saves.some((s) => s.action === 'document.create');
    const after = await documentNow(client, entityId);
    const prior = created ? null : before;
    if (prior === undefined) return null;
    const title = (after || prior)?.title || 'document';
    return [{ name: `Documents › ${title}`, href: after ? `/documents/${entityId}` : '/documents', lines: diffDocument(prior, after) }];
  }
  return null; // a kind of save with no before/after model
}

// describeChanges(client, changes, liveAt) → [{ name, href, lines, saves }]
// changes: the rows lib/publish.js already lists (changesSince).
export async function describeChanges(client, changes, liveAt) {
  if (!changes.length) return [];
  const groups = new Map();
  for (const c of changes) {
    const key = `${c.entityType}|${c.entityId}`;
    if (!groups.has(key)) groups.set(key, { entityType: c.entityType, entityId: c.entityId, saves: [] });
    groups.get(key).saves.push(c);
  }
  const sections = new Map();
  const add = (name, href, lines, saves) => {
    if (!sections.has(name)) sections.set(name, { name, href: href || SECTION_PAGE[name], lines: [], saves: [] });
    const s = sections.get(name);
    s.lines.push(...lines);
    for (const v of saves) if (!s.saves.includes(v)) s.saves.push(v);
  };
  for (const g of groups.values()) {
    let described = null;
    try {
      const before = await revisionBefore(client, g.entityType, g.entityId, liveAt);
      described = await describe(client, g.entityType, g.entityId, before, g.saves);
    } catch (err) {
      console.warn(`[admin] what-changed: ${g.entityType}/${g.entityId} not described: ${err.message}`);
    }
    // Each save goes to the section its action names (petition.save →
    // Petition), else to every section this thing produced.
    const named = (s) => ACTION_SECTION[s.action];
    if (described && !described.length) {
      const where = named(g.saves[0]) || COLLECTIONS[g.entityType]?.title || g.entityType;
      add(where, ADMIN_PAGE[g.entityType], [], g.saves);
      continue;
    }
    if (!described) {
      const fallback = COLLECTIONS[g.entityType]?.title || named(g.saves[0])
        || `${g.entityType.charAt(0).toUpperCase()}${g.entityType.slice(1).replace(/[-_]/g, ' ')}`;
      add(fallback, ADMIN_PAGE[g.entityType], [{ kind: 'note', text: 'Saved — no before/after detail is kept for this kind of change.' }], g.saves);
      continue;
    }
    for (const d of described) {
      add(d.name, d.href, d.lines, g.saves.filter((s) => !named(s) || named(s) === d.name));
    }
    // A save whose own section shows no difference (e.g. Petition saved, then
    // put back) still appears, under its section, marked as no change.
    const shown = new Set(described.map((d) => d.name));
    for (const s of g.saves) if (named(s) && !shown.has(named(s))) add(named(s), undefined, [], [s]);
  }
  return [...sections.values()].map((s) => ({
    ...s,
    lines: s.lines.length ? s.lines : [{ kind: 'note', text: 'Saved, but it now matches the live site — publishing changes nothing here.' }],
    saves: s.saves.map((v) => ({ actor: v.actor, at: v.at, what: humanAction(v.action) })),
  }));
}
