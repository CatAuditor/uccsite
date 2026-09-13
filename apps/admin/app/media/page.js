// Media library (spec §13): upload → presigned PUT → S3 event → sharp
// variants; alt text editing; delete. Assets without alt text are shown but
// never offered to page editors (the alt-required gate).
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { listAssets } from '../../lib/media';
import { ACCEPTED_MIMES, MAX_UPLOAD_BYTES } from '@uccsite/db/media';
import Refresher from '../refresher';
import Uploader from './uploader';
import { saveAlt, removeAsset } from './actions';

export const dynamic = 'force-dynamic';

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default async function MediaPage() {
  const session = await requireSession();
  const readOnly = session.role === 'viewer';
  const assets = await withDb((client) => listAssets(client));
  const inFlight = assets.some(a => (a.status === 'pending' || a.status === 'processing') && !a.stalled);

  return (
    <div>
      <h1>Media Library</h1>
      <Refresher active={inFlight} />
      <p className="notice">
        Uploads are resized to AVIF and WebP at 400–2400px and served from <code>/media/…</code> with a one-year cache.
        <strong> Alt text is required</strong> before an image can be placed on a page.
      </p>
      {readOnly ? <p className="notice">Viewer role — read-only.</p>
        : <Uploader accept={ACCEPTED_MIMES.join(',')} maxBytes={MAX_UPLOAD_BYTES} />}

      <h2>Assets ({assets.length})</h2>
      <div className="media-grid">
        {assets.map((a) => (
          <div key={a.id} className={`media-card status-${a.status}`}>
            <div className="media-thumb">
              {a.thumbUrl ? <img src={a.thumbUrl} alt={a.alt || ''} />
                : <span className="media-status">{a.status === 'failed' ? 'failed' : a.stalled ? `stalled (${a.status})` : `${a.status}…`}</span>}
            </div>
            <div className="media-meta">
              <div className="media-name" title={a.originalFilename}>{a.originalFilename}</div>
              <div className="hint">
                {a.width && a.height ? `${a.width}×${a.height} · ` : ''}{a.bytes ? fmtBytes(a.bytes) : ''}
                {a.variants.length ? ` · ${a.variants.length} variants` : ''}
              </div>
              {a.error && <div className="error">{a.error}</div>}
              {a.stalled && <div className="error">No progress for 15+ minutes — the upload never arrived or processing crashed. Delete and re-upload.</div>}
              {a.status === 'ready' && (
                <details>
                  <summary>Variant URLs</summary>
                  <ul className="media-variants">
                    {a.variants.map(v => <li key={v.path}><code>{v.path}</code> {fmtBytes(v.bytes)}</li>)}
                  </ul>
                </details>
              )}
              <form action={saveAlt} className="media-alt">
                <input type="hidden" name="id" value={a.id} />
                <label htmlFor={`alt-${a.id}`}>Alt text</label>
                <input type="text" id={`alt-${a.id}`} name="alt" defaultValue={a.alt}
                  placeholder="Describe the image for screen readers" disabled={readOnly} />
                {!a.alt && <div className="hint media-warn">No alt text — not available to editors yet.</div>}
                {!readOnly && <button type="submit">Save alt</button>}
              </form>
              {!readOnly && (
                <form action={removeAsset}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="danger">Delete</button>
                </form>
              )}
              <div className="hint">by {a.uploadedBy} · {a.createdAt?.slice(0, 16).replace('T', ' ')}</div>
            </div>
          </div>
        ))}
        {!assets.length && <p>No uploads yet.</p>}
      </div>
    </div>
  );
}
