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
import { projectOf } from '@uccsite/render';
import ActionForm from '../../action-form';
import RequestPublish from '../../request-publish';
import HtmlEditor from './html-editor';
import StyleEditor from './style-editor';
import ImageUrlField from '../../media/image-url-field';
import { saveDocument, deleteDocument, archiveDocument, unarchiveDocument } from '../actions';

export const dynamic = 'force-dynamic';

const SEO_FIELDS = [
  ['metaTitle', 'Meta title', 'blank = "Title | Organization"'],
  ['metaDescription', 'Meta description', 'REQUIRED to publish; aim for ≤160 characters'],
  ['metaKeywords', 'Meta keywords', 'optional'],
  ['canonicalUrl', 'Canonical URL', 'blank = https://utahciviccompact.org/slug'],
  ['ogType', 'og:type', 'blank = article'],
  ['ogTitle', 'og:title', 'blank = meta title'],
  ['ogDescription', 'og:description', 'blank = meta description'],
  ['ogImage', 'og:image URL', 'blank = the logo on navy (/assets/share-default.png)'],
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
  const { doc, rows, kit, preview, overrides, orphans, unstyledCount, rules, foreignClassMap, siteCssDrift, projects } = data;
  // Nesting (docs/systems/projects.md): explicit project, or the project whose button opens this page.
  const impliedProject = !doc.projectSlug ? projectOf(doc, projects) : null;
  const orphanProject = doc.projectSlug && !projects.some(p => p.slug === doc.projectSlug) ? doc.projectSlug : '';
  const readOnly = session.role === 'viewer';
  const archived = doc.status === 'archived';
  const report = doc.ingestReport || null;
  const serp = serpWarnings(doc);

  return (
    <div className="doc-editor">
      <h1>{doc.title} <span className="hint">/{doc.slug} · {doc.status}</span></h1>
      {archived && (
        <div className="notice">
          <strong>Archived.</strong> This document is off the site: it is not rendered, listed or in the sitemap, and
          /{doc.slug} answers &quot;410 Gone&quot; once the archive has been published. Edits here are kept but change nothing
          on the site. Use <strong>Restore as draft</strong> at the bottom to bring it back.
        </div>
      )}
      {doc.lastPublishError && <div className="error">Last publish failed for this document: {doc.lastPublishError}</div>}
      {siteCssDrift && <div className="error"><strong>Live stylesheet is behind the code.</strong> {siteCssDrift}</div>}
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
              <label htmlFor="author">Author</label>
              <input type="text" id="author" name="author" defaultValue={doc.author} disabled={readOnly} placeholder="Team member's full name" />
            </div>
            <div>
              <label htmlFor="projectSlug">Project</label>
              <select id="projectSlug" name="projectSlug" defaultValue={doc.projectSlug} disabled={readOnly}>
                <option value="">{impliedProject ? `${impliedProject.name} (via its button)` : '— none —'}</option>
                {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                {orphanProject && <option value={orphanProject}>{orphanProject} (project no longer exists)</option>}
              </select>
              <div className="hint">Lists this page under the project on /projects and adds a link back at the foot of the page.</div>
            </div>
            <div>
              <label htmlFor="status">Status</label>
              {archived
                ? <><input type="hidden" name="status" value="archived" /><input type="text" id="status" value="archived" disabled readOnly /></>
                : <select id="status" name="status" defaultValue={doc.status} disabled={readOnly}>
                    {STATUSES.filter(s => s !== 'archived').map(s => <option key={s} value={s}>{s}</option>)}
                  </select>}
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
          <div className="hint">Published documents go live when a publish request is approved on Publish &amp; Status. A published page needs a meta description and a clean accessibility gate.
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
                : name === 'ogImage'
                  ? <ImageUrlField id={name} name={name} defaultValue={doc[name]} disabled={readOnly} targetWidth={1200} label="Upload a share image" />
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

        {!readOnly && <><button type="submit">Save document</button><RequestPublish /></>}
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

      {!readOnly && (
        <fieldset className="item">
          <legend>Take down</legend>
          {archived ? (
            <>
              <p className="hint">Restoring makes this a draft again. It returns to the site only when you set it to published and a publish request is approved.</p>
              <ActionForm className="inline" action={unarchiveDocument}>
                <input type="hidden" name="id" value={doc.id} />
                <button type="submit">Restore as draft</button>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="hint">
                <strong>Archive</strong> removes the page from the site for good unless it is restored: the page and its styling are
                deleted and cleared from the cache, it leaves the sitemap, the author page and Writing, and its address answers
                &quot;410 Gone&quot; so links and search engines drop it. Takes effect when the next publish request is approved.
                The text, styling and revisions stay here. Prefer this over Delete for anything that has been live.
              </p>
              <ActionForm className="inline" action={archiveDocument}>
                <input type="hidden" name="id" value={doc.id} />
                <button type="submit" className="danger">Archive this document</button>
              </ActionForm>
            </>
          )}
          {doc.status !== 'published' && (
            <ActionForm className="inline" action={deleteDocument}>
              <input type="hidden" name="id" value={doc.id} />
              <button type="submit" className="danger">Delete this {archived ? 'archived document' : 'draft'}</button>
            </ActionForm>
          )}
        </fieldset>
      )}
    </div>
  );
}
