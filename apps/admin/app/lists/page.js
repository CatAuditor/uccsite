// Saved lists (editor+) — named audiences for the newsletter composer
// (docs/systems/newsletters.md "Saved lists"). Each list is the Mailing list
// page's filters with a name, and is either DYNAMIC (whoever matches when
// an email is sent) or FROZEN (the people who matched when it was last
// updated — press Update to re-take the snapshot). People can also be ADDED
// BY HAND (pasted addresses, or "Add to list" on the Mailing list page); a
// frozen list mails them with the snapshot, a dynamic list in addition to the
// filter match — if they are an eligible mailing-list row. The count column
// is what the list reaches right now, so a frozen list shows how far it has
// drifted (people who unsubscribed or bounced since the freeze are never
// mailed). Rules: lib/lists.js; actions: ./actions.js.
import Link from 'next/link';
import { listsPage, filtersFrom } from '../../lib/lists';
import ActionForm from '../action-form';
import AudienceFilters from '../audience-filters';
import { createListAction, saveListAction, freezeListAction, setModeAction, deleteListAction, addPeopleAction, removePersonAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL = { subscribed: 'will be mailed', unconfirmed: 'not confirmed yet — not mailed', unsubscribed: 'unsubscribed — not mailed', suppressed: 'bounced / complained — not mailed', '': 'not on the mailing list — not mailed' };
const day = (ts) => (ts ? ts.slice(0, 10) : '');

export default async function ListsPage({ searchParams }) {
  const sp = await searchParams;
  const { lists, petitions } = await listsPage();
  // "Save these filters as a list" on the Mailing list page lands here with
  // the filters in the query string; the new-list form starts from them.
  const seed = filtersFrom({ get: (k) => (typeof sp?.[k] === 'string' ? sp[k] : '') });

  return (
    <div>
      <h1>Saved lists <span className="hint">{lists.length}</span></h1>
      <p className="notice">
        A saved list is a set of <Link href="/subscribers">Mailing list</Link> filters with a name, so an email can be sent
        to it from the composer&rsquo;s Audience box. <strong>Dynamic</strong> lists follow the filters: whoever matches
        when the email goes out gets it. <strong>Frozen</strong> lists keep the people who matched when the list was
        last updated — nobody joins it until you press <em>Update</em>, which re-takes the snapshot. People you
        <strong> add by hand</strong> stay on the list through Updates. Either way, only people who are on the mailing
        list and still subscribed are mailed — anyone who has unsubscribed or bounced is skipped at send time.
        &ldquo;Never received a newsletter&rdquo; / &ldquo;Not emailed since&rdquo; read the admin&rsquo;s own send ledger
        (sends since October&nbsp;5, 2026); issues sent by other tools before that are not in it.
      </p>

      <h2>New list</h2>
      <ActionForm action={createListAction} className="editor">
        <label htmlFor="new-name">Name</label>
        <input id="new-name" name="name" required maxLength={120} placeholder="e.g. Dormant — never emailed" />
        <AudienceFilters f={seed} petitions={petitions} lists={lists} prefix="new" />
        <label htmlFor="new-mode">Mode</label>
        <select id="new-mode" name="mode" defaultValue="frozen">
          <option value="frozen">Frozen — the people who match right now; Update to refresh</option>
          <option value="dynamic">Dynamic — whoever matches when an email is sent</option>
        </select>
        <button type="submit">Save list</button>
      </ActionForm>

      <h2>Lists</h2>
      {!lists.length && <p className="hint">No saved lists yet.</p>}
      {lists.map((l) => (
        <section key={l.id} className="item">
          <ActionForm action={saveListAction} className="editor" successMessage="Saved.">
            <input type="hidden" name="id" value={l.id} />
            <h3>
              {l.name} <span className={`chip status-${l.mode === 'frozen' ? 'unconfirmed' : 'subscribed'}`}>{l.mode}</span>
              {' '}<span className="hint">reaches {l.count} {l.count === 1 ? 'person' : 'people'} today</span>
            </h3>
            <p className="hint">
              {l.mode === 'frozen'
                ? <>Frozen {day(l.frozenAt)} with {l.frozenCount ?? 0} people ({l.description}). {l.count !== l.frozenCount ? `${(l.frozenCount ?? 0) - l.count} of them can no longer be mailed. ` : ''}Update re-takes the snapshot from the filters below.</>
                : <>Follows the filters: {l.description}.</>}
              {l.manual.length > 0 && <> {l.manual.length} added by hand.</>}
              {l.using.length > 0 && <> Used by {l.using.length} email{l.using.length === 1 ? '' : 's'}{l.inFlight ? ' — one is in flight, so the list is locked until it has sent' : ''}.</>}
            </p>
            <label htmlFor={`${l.id}-name`}>Name</label>
            <input id={`${l.id}-name`} name="name" defaultValue={l.name} required maxLength={120} />
            <AudienceFilters f={l.filters} petitions={petitions} lists={lists.filter((x) => x.id !== l.id)} prefix={l.id} />
            <div className="item-tools">
              <button type="submit">Save name &amp; filters</button>
              <span className="hint">{l.mode === 'frozen' ? ' Saving filters does not change who is on a frozen list — press Update for that.' : ''}</span>
            </div>
          </ActionForm>
          <div className="item-tools">
            {l.mode === 'frozen' && (
              <ActionForm action={freezeListAction} className="inline">
                <input type="hidden" name="id" value={l.id} />
                <button type="submit" className="secondary" disabled={l.inFlight}>Update (re-take the snapshot)</button>
              </ActionForm>
            )}
            <ActionForm action={setModeAction} className="inline">
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="mode" value={l.mode === 'frozen' ? 'dynamic' : 'frozen'} />
              <button type="submit" className="secondary" disabled={l.inFlight}>{l.mode === 'frozen' ? 'Make dynamic' : 'Freeze now'}</button>
            </ActionForm>
            <form action="/subscribers/export" method="post" className="inline">
              <input type="hidden" name="list" value={l.id} />
              <button type="submit" className="secondary">Download CSV ({l.count})</button>
            </form>
            <ActionForm action={deleteListAction} className="inline">
              <input type="hidden" name="id" value={l.id} />
              <button type="submit" className="danger" disabled={l.inFlight}>Delete list</button>
            </ActionForm>
          </div>

          <details>
            <summary>People added by hand ({l.manual.length})</summary>
            {l.manual.length > 0 && (
              <table>
                <thead><tr><th>Email</th><th>Name</th><th>Added</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {l.manual.map((m) => (
                    <tr key={m.email}>
                      <td>{m.email}</td>
                      <td>{[m.firstName, m.lastName].filter(Boolean).join(' ')}</td>
                      <td>{day(m.addedAt)}</td>
                      <td><span className={`chip status-${m.status || 'unsubscribed'}`}>{STATUS_LABEL[m.status] || m.status}</span></td>
                      <td>
                        <ActionForm className="inline" action={removePersonAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="email" value={m.email} />
                          <button type="submit" className="danger">Remove from list</button>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ActionForm action={addPeopleAction} className="editor">
              <input type="hidden" name="id" value={l.id} />
              <label htmlFor={`${l.id}-people`}>Add people — one per line: <code>email</code>, or <code>email, First, Last</code></label>
              <textarea id={`${l.id}-people`} name="people" rows={4} placeholder={'jane@example.org, Jane, Doe\nsam@example.org'} />
              <label className="mail-check">
                <input type="checkbox" name="subscribe" value="1" />
                {' '}Also add anyone not yet on the mailing list as a confirmed subscriber — only tick this if they asked you (in person or in writing) to receive our emails; the names you paste become their greeting
              </label>
              <button type="submit" className="secondary">Add to this list</button>
            </ActionForm>
            <p className="hint">Someone who is not on the mailing list, or has unsubscribed or bounced, stays on this list but is never mailed — the status column says which.</p>
          </details>
        </section>
      ))}
    </div>
  );
}
