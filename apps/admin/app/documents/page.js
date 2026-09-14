// Documents list (spec §3.2): grouped by category (planning addendum 3),
// with status, live state and the last publish error; plus "new document".
import Link from 'next/link';
import { listDocuments } from '@uccsite/db/documents';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import ActionForm from '../action-form';
import { createDocument } from './actions';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage({ searchParams }) {
  const session = await requireSession();
  const { category } = await searchParams;
  const all = await withDb((client) => listDocuments(client));
  const categories = [...new Set(all.map(d => d.category || 'Uncategorized'))];
  const docs = category ? all.filter(d => (d.category || 'Uncategorized') === category) : all;
  const readOnly = session.role === 'viewer';

  return (
    <div>
      <h1>{category ? category : 'Long-form Documents'}</h1>
      <p className="notice">
        A Document is pasted HTML plus its own page CSS and SEO fields. Saving runs the ingest
        report; the site changes when a publish request is approved on Publish &amp; Status. Categories: {categories.map((c, i) => (
          <span key={c}>{i ? ' · ' : ''}<Link href={`/documents?category=${encodeURIComponent(c)}`}>{c}</Link></span>
        ))}{category && <> · <Link href="/documents">all</Link></>}
      </p>
      <table>
        <thead><tr><th>Title</th><th>Slug</th><th>Category</th><th>Status</th><th>Live</th><th>Updated</th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/documents/${d.id}`}>{d.title}</Link></td>
              <td><code>/{d.slug}</code></td>
              <td>{d.category}</td>
              <td className={d.status === 'published' ? 'status-succeeded' : 'status-noop'}>{d.status}</td>
              <td>
                {d.lastPublishError ? <span className="status-failed" title={d.lastPublishError}>publish error</span>
                  : !d.liveAt ? '—'
                  : d.updatedAt > d.liveAt ? <span className="status-publishing" title={`live ${d.liveAt.slice(0, 16)}`}>edited since publish</span>
                  : d.liveAt.slice(0, 16).replace('T', ' ')}
              </td>
              <td>{d.updatedAt?.slice(0, 16).replace('T', ' ')}</td>
            </tr>
          ))}
          {!docs.length && <tr><td colSpan="6">No documents{category ? ' in this category' : ''}.</td></tr>}
        </tbody>
      </table>

      {!readOnly && (
        <>
          <h2>New document</h2>
          <ActionForm className="editor" action={createDocument}>
            <label htmlFor="new-title">Title</label>
            <input type="text" id="new-title" name="title" required />
            <label htmlFor="new-slug">Slug (URL path)</label>
            <input type="text" id="new-slug" name="slug" placeholder="e.g. box-elder-report" pattern="[a-z0-9][a-z0-9-]*" required />
            <div className="hint">Lowercase letters, digits, dashes. The page publishes at /slug.</div>
            <label htmlFor="new-category">Category</label>
            <input type="text" id="new-category" name="category" list="doc-categories" defaultValue="Reports" />
            <datalist id="doc-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
            <button type="submit">Create draft</button>
          </ActionForm>
        </>
      )}
    </div>
  );
}
