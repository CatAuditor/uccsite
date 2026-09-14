// Redirects (spec §9 `redirects`): old path → new URL. The database is the
// source of truth; the next Publish syncs active rows into the CloudFront
// KeyValueStore the edge function consults before serving anything.
import { listRedirects, STATUSES } from '@uccsite/db/redirects';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import ActionForm from '../action-form';
import { saveRedirect, removeRedirect } from './actions';

export const dynamic = 'force-dynamic';

export default async function RedirectsPage() {
  const session = await requireSession();
  const readOnly = session.role === 'viewer';
  const redirects = await withDb((client) => listRedirects(client));

  return (
    <div>
      <h1>Redirects</h1>
      <p className="notice">
        Use these when a page moves (a document slug change, a retired URL). Paths are matched exactly at the edge before
        the page is served. Changes take effect on the next <strong>Publish</strong>. 301/308 = permanent (search engines
        move the ranking), 302/307 = temporary.
      </p>
      <table>
        <thead><tr><th>From</th><th>To</th><th>Status</th><th>Active</th><th>Note</th><th></th></tr></thead>
        <tbody>
          {redirects.map((r) => (
            <tr key={r.id} className={r.active ? '' : 'status-noop'}>
              <td><code>{r.fromPath}</code></td>
              <td><code>{r.toUrl}</code></td>
              <td>{r.statusCode}</td>
              <td>{r.active ? 'yes' : 'no'}</td>
              <td>{r.note}</td>
              <td className="user-actions">
                {!readOnly && (
                  <>
                    <ActionForm action={saveRedirect} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="fromPath" value={r.fromPath} />
                      <input type="hidden" name="toUrl" value={r.toUrl} />
                      <input type="hidden" name="statusCode" value={r.statusCode} />
                      <input type="hidden" name="note" value={r.note} />
                      <input type="hidden" name="active" value={r.active ? '' : '1'} />
                      <button type="submit">{r.active ? 'Deactivate' : 'Activate'}</button>
                    </ActionForm>
                    <ActionForm action={removeRedirect} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="danger">Delete</button>
                    </ActionForm>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!redirects.length && <tr><td colSpan="6">No redirects.</td></tr>}
        </tbody>
      </table>

      {!readOnly && (
        <>
          <h2>Add or update a redirect</h2>
          <ActionForm className="editor" action={saveRedirect} successMessage="Saved. Publish to make it live.">
            <label htmlFor="rd-from">From (site path)</label>
            <input type="text" id="rd-from" name="fromPath" placeholder="/old-report" required />
            <div className="hint">Saving an existing path updates that redirect.</div>
            <label htmlFor="rd-to">To (site path or https URL)</label>
            <input type="text" id="rd-to" name="toUrl" placeholder="/new-report or https://…" required />
            <label htmlFor="rd-status">Status</label>
            <select id="rd-status" name="statusCode" defaultValue="301">{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <label htmlFor="rd-note">Note</label>
            <input type="text" id="rd-note" name="note" placeholder="why this exists" />
            <label><input type="checkbox" name="active" value="1" defaultChecked /> active</label>
            <button type="submit">Save redirect</button>
          </ActionForm>
        </>
      )}
    </div>
  );
}
