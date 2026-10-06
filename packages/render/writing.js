'use strict';
// /writing — every published statement, report and paper in one list, newest
// first (docs/systems/writing.md). Built from what the site already has:
// content.statements and content.documents_index (the published Documents the
// publish step lists for author pages). Nothing is stored for this page, so a
// newly published document appears on it with no extra step.
const { parseFreeDate } = require('./dates');

// Document Category → the type shown on the page (editors choose it on the
// document; a document set to "Statements" is listed as a statement). 'Legal' (the privacy
// policy) is not writing and is left out.
const TYPE = { Reports: 'Report', Whitepapers: 'Paper', Statements: 'Statement', Newsletters: 'Newsletter' };
const SKIP_CATEGORIES = new Set(['Legal']);

const clean = (u) => String(u || '').replace(/\.html(?=$|[#?])/, '');
const longDate = (raw) => {
  const t = parseFreeDate(raw);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
};

// deriveWriting(content, authorUrl) → { items, types, count }
// authorUrl(name) → team page URL or ''.
function deriveWriting(content, authorUrl = () => '') {
  const statements = content.statements?.statements || [];
  const documents = Array.isArray(content.documents_index) ? content.documents_index : [];
  const items = new Map(); // url → item; a statement that points at a document merges into it

  for (const d of documents) {
    if (SKIP_CATEGORIES.has(d.category)) continue;
    const url = `/${d.slug}`;
    items.set(url, {
      url, title: d.title, author: d.author || '', summary: d.summary || '',
      type: TYPE[d.category] || 'Report', rawDate: d.date || '',
    });
  }
  for (const s of statements) {
    const url = s.url ? clean(s.url) : `/statements#${s.slug}`;
    const existing = items.get(url);
    if (existing) {
      // The homepage-featured statements that point at a Document: one entry,
      // the document's title, the statement's date if the document has none.
      existing.rawDate = existing.rawDate || s.date || '';
      existing.summary = existing.summary || s.snippet || '';
      existing.author = existing.author || s.author || '';
      continue; // its type stays the document's Category — editors set it there
    }
    items.set(url, {
      url, title: s.title, author: s.author || '', summary: s.snippet || '',
      type: 'Statement', rawDate: s.date || '',
    });
  }

  const list = [...items.values()]
    .map((it) => {
      const t = parseFreeDate(it.rawDate);
      return {
        ...it, sort: Number.isNaN(t) ? -Infinity : t, date: longDate(it.rawDate),
        author_url: authorUrl(it.author), type_key: it.type.toLowerCase(),
      };
    })
    .sort((a, b) => b.sort - a.sort || a.title.localeCompare(b.title))
    .map(({ sort, rawDate, ...it }) => it);

  const counts = list.reduce((m, it) => ({ ...m, [it.type]: (m[it.type] || 0) + 1 }), {});
  return {
    items: list,
    count: list.length,
    types: Object.entries(counts).map(([label, n]) => ({ label, key: label.toLowerCase(), n })),
  };
}

module.exports = { deriveWriting };
