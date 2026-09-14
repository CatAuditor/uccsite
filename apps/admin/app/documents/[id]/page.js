// Document editor (spec §5, §6.5, §12): metadata + SEO panel, the HTML /
// page-CSS editors with the ingest report, and the styling split view
// (element tree ↔ live preview) with class picker, bulk actions and
// promote-to-rule. Everything server-computed (lib/documents.js); the two
// client components only hold UI state and call server actions.
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/auth';
import { withDb } from '../../../lib/data';
import { editorData } from '../../../lib/documents';
import { STATUSES, TEMPLATE_KEYS } from '@uccsite/db/documents';
import ActionForm from '../../action-form';
import HtmlEditor from './html-editor';
import StyleEditor from './style-editor';
import { saveDocument, deleteDocument } from '../actions';

export const dynamic = 'force-dynamic';

const SEO_FIELDS = [
  ['metaTitle', 'Meta title', 'blank = "Title | Organization"'],
  ['metaDescription', 'Meta description', 'REQUIRED to publish; aim for ≤160 characters'],
  ['metaKeywords', 'Meta keywords', 'optional'],
  ['canonicalUrl', 'Canonical URL', 'blank = https://utahciviccompact.org/slug'],
  ['ogType', 'og:type', 'blank = article'],
  ['ogTitle', 'og:title', 'blank = meta title'],
  ['ogDescription', 'og:description', 'blank = meta description'],
  ['ogImage', 'og:image URL', 'blank = /UCC.png'],
  ['twitterCard', 'twitter:card', 'summary or summary_large_image (blank = summary)'],
  ['jsonldType', 'JSON-LD @type', 'e.g. Article; blank = no JSON-LD'],
];

function serpWarnings(doc) {
  const w = [];
  const title = doc.metaTitle || `${doc.title} | Utah Civic Compact`;
  if (!doc.metaDescription) w.push('Missing meta description.');
  if (title.length > 60) w.push(`Title is ${title.length} characters (over 60).`);
  if (doc.metaDescription.length > 160) w.push(`Description is ${doc.metaDescription.length} characters (over 160).`);
  if (doc.noindex && doc.status === 'published') w.push('noindex on a published page.');
  return { title, w };
}

export default async function DocumentEditorPage({ params }) {
  const session = await requireSession();
  const { id } = await params;
  const data = await withDb((client) => editorData(client, id));
  if (!data) notFound();
  const { doc, rows, kit, preview, overrides, orphans, unstyledCount, rules, foreignClassMap } = data;
  const readOnly = session.role === 'viewer';
  const report = doc.ingestReport || null;
  const serp = serpWarnings(doc);

  return (
    <div className="doc-editor">
      <h1>{doc.title} <span className="hint">/{doc.slug} · {doc.status}</span></h1>
      {doc.lastPublishError && <div className="error">Last publish failed for this document: {doc.lastPublishError}</div>}
      {readOnly && <p className="notice">Viewer role — read-only.</p>}

      <ActionForm className="editor doc-form" action={saveDocument} successMessage="Saved.">
        <input type="hidden" name="id" value={doc.id} />
        <input type="hidden" name="baseline" value={doc.updatedAt || ''} />

        <fieldset className="item">
          <legend>Document</legend>
          <label htmlFor="title">Title</label>
          <input type="text" id="title" name="title" defaultValue={doc.title} disabled={readOnly} required />
          <div className="doc-grid">
            <div>
              <label htmlFor="slug">Slug</label>
              <input type="text" id="slug" name="slug" defaultValue={doc.slug} disabled={readOnly} pattern="[a-z0-9][a-z0-9-]*" />
            </div>
            <div>
              <label htmlFor="category">Category</label>
              <input type="text" id="category" name="category" defaultValue={doc.category} disabled={readOnly} />
            </div>
            <div>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={doc.status} disabled={readOnly}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="templateKey">Template</label>
              <select id="templateKey" name="templateKey" defaultValue={doc.templateKey} disabled={readOnly}>
                {TEMPLATE_KEYS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sortOrder">Sort order</label>
              <input type="text" id="sortOrder" name="sortOrder" defaultValue={doc.sortOrder} disabled={readOnly} />
            </div>
            <div>
              <label htmlFor="sitemapPriority">Sitemap priority</label>
              <input type="text" id="sitemapPriority" name="sitemapPriority" defaultValue={doc.sitemapPriority} placeholder="0.7" disabled={readOnly} />
            </div>
          </div>
          <div className="hint">Published documents go live on the next Publish. A published page needs a meta description and a clean accessibility gate.
            {rows.length > 0 && <> Pre-publish check: <strong>{unstyledCount}</strong> unstyled block{unstyledCount === 1 ? '' : 's'} (see Styling below).</>}</div>
        </fieldset>

        <HtmlEditor bodyHtmlRaw={doc.bodyHtmlRaw} pageCss={doc.pageCss} readOnly={readOnly} report={report} orphans={orphans} />

        <fieldset className="item">
          <legend>SEO</legend>
          <div className="serp">
            <div className="serp-title">{serp.title}</div>
            <div className="serp-url">utahciviccompact.org › {doc.slug}</div>
            <div className="serp-desc">{doc.metaDescription || <em>No description — search engines will pick text from the page.</em>}</div>
          </div>
          {serp.w.length > 0 && <div className="error">{serp.w.join(' ')}</div>}
          {SEO_FIELDS.map(([name, label, hint]) => (
            <div key={name}>
              <label htmlFor={name}>{label}</label>
              {name === 'metaDescription' || name === 'ogDescription'
                ? <textarea id={name} name={name} defaultValue={doc[name]} disabled={readOnly} rows={2} />
                : <input type="text" id={name} name={name} defaultValue={doc[name]} disabled={readOnly} />}
              <div className="hint">{hint}</div>
            </div>
          ))}
          <label htmlFor="jsonldOverrides">JSON-LD overrides (JSON object merged over the generated block)</label>
          <textarea id="jsonldOverrides" name="jsonldOverrides" className="code" rows={6} disabled={readOnly}
            defaultValue={doc.jsonldOverrides ? JSON.stringify(doc.jsonldOverrides, null, 2) : ''} />
          <div className="doc-checks">
            <label><input type="checkbox" name="noindex" defaultChecked={!!doc.noindex} disabled={readOnly} /> noindex</label>
            <label><input type="checkbox" name="nofollow" defaultChecked={!!doc.nofollow} disabled={readOnly} /> nofollow</label>
            {session.role === 'owner' && (
              <label title="Owner-only escape hatch (spec §5): keeps <script src> tags whose host is on the allowlist (currently challenges.cloudflare.com). Inline scripts and other hosts are always stripped. Every toggle is audited.">
                <input type="checkbox" name="allowScripts" defaultChecked={!!doc.allowScripts} /> allow_scripts (owner)
              </label>
            )}
          </div>
        </fieldset>

        {!readOnly && <button type="submit">Save document</button>}
      </ActionForm>

      <StyleEditor
        documentId={doc.id}
        rows={rows}
        kit={kit.entries}
        undocumented={kit.undocumented.length}
        rules={rules.map(r => ({ id: r.id, scope: r.scope, selector: r.selector, classes: r.classes, priority: r.priority }))}
        preview={preview}
        unstyledCount={unstyledCount}
        readOnly={readOnly}
        templateKey={doc.templateKey}
      />

      {!readOnly && doc.status !== 'published' && (
        <ActionForm action={deleteDocument}>
          <input type="hidden" name="id" value={doc.id} />
          <button type="submit" className="danger">Delete this draft</button>
        </ActionForm>
      )}
    </div>
  );
}
