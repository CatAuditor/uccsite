// Saved lists (editor+) — named audiences for the newsletter composer
// (docs/systems/newsletters.md "Saved lists"). Each list is the Mailing list
// page's filters with a name, and is either DYNAMIC (whoever matches when
// an email is sent) or FROZEN (the people who matched when it was last
// updated — press Update to re-take the snapshot). The count column is what
// the list reaches right now, so a frozen list shows how far it has drifted
// (people who unsubscribed or bounced since the freeze are never mailed).
// Rules: lib/lists.js; actions: ./actions.js.
import Link from 'next/link';
import { RESIDENCIES } from '@uccsite/db/audience';
import { listsPage, filtersFrom } from '../../lib/lists';
import ActionForm from '../action-form';
import { createListAction, saveListAction, freezeListAction, setModeAction, deleteListAction } from './actions';

export const dynamic = 'force-dynamic';

const RESIDENCY_LABEL = { all: 'everyone', utah: 'Utah residents', outside: 'outside Utah', unknown: 'ZIP unknown' };
const HISTORY_LABEL = { all: 'anyone', never: 'never received a newsletter from the admin', reached: 'received a newsletter before' };
const day = (ts) => (ts ? ts.slice(0, 10) : '');

function FilterFields({ f, petitions, prefix }) {
  return (
    <div className="mail-row">
      <label htmlFor={`${prefix}-residency`}>Residency
        <select id={`${prefix}-residency`} name="residency" defaultValue={f.residency}>
          {['all', ...RESIDENCIES].map((r) => <option key={r} value={r}>{RESIDENCY_LABEL[r]}</option>)}
        </select>
      </label>
      <label htmlFor={`${prefix}-petition`}>Signed petition
        <select id={`${prefix}-petition`} name="petition" defaultValue={f.petition}>
          <option value="">any / none</option>
          {petitions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label htmlFor={`${prefix}-history`}>Newsletter history
        <select id={`${prefix}-history`} name="history" defaultValue={f.history}>
          {['all', 'never', 'reached'].map((h) => <option key={h} value={h}>{HISTORY_LABEL[h]}</option>)}
        </select>
      </label>
      <label className="mail-check"><input type="checkbox" name="donors" value="1" defaultChecked={f.donors} /> donors only</label>
    </div>
  );
}

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
        last updated — nobody joins it until you press <em>Update</em>, which re-takes the snapshot. Either way, anyone
        who has unsubscribed or bounced since is skipped at send time. &ldquo;Never received a newsletter&rdquo; is read
        from the admin&rsquo;s own send ledger (sends since October&nbsp;5, 2026); issues sent by other tools before
        that are not in it.
      </p>

      <h2>New list</h2>
      <ActionForm action={createListAction} className="editor">
        <label htmlFor="new-name">Name</label>
        <input id="new-name" name="name" required maxLength={120} placeholder="e.g. Dormant — never emailed" />
        <FilterFields f={seed} petitions={petitions} prefix="new" />
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
              {l.using.length > 0 && <> Used by {l.using.length} email{l.using.length === 1 ? '' : 's'}{l.inFlight ? ' — one is in flight, so the list is locked until it has sent' : ''}.</>}
            </p>
            <label htmlFor={`${l.id}-name`}>Name</label>
            <input id={`${l.id}-name`} name="name" defaultValue={l.name} required maxLength={120} />
            <FilterFields f={l.filters} petitions={petitions} prefix={l.id} />
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
        </section>
      ))}
    </div>
  );
}
