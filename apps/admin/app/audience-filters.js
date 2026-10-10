'use client';
// The audience filter controls, ONE markup for the three places that take
// them: the Mailing list page (GET form), the Saved lists page (list filters)
// and the newsletter composer (docs/systems/newsletters.md "Saved lists" →
// "Filters"). Field names = packages/db/audience.js FILTER_KEYS, so any form
// that renders this can be read with normalizeFilters(Object.fromEntries(fd)).
// Uncontrolled (defaultValue) so it works in a plain GET form; `onChange(name,
// value)` lets the composer mirror the values into its own state for the
// live count. `lists` feeds "Not on saved list" (pass every list but the one
// being edited).
import { RESIDENCIES, HISTORIES, GIVINGS } from '@uccsite/db/audience';

const RESIDENCY_LABEL = { all: 'everyone', utah: 'Utah residents', outside: 'outside Utah', unknown: 'ZIP unknown' };
const HISTORY_LABEL = { all: 'anyone', never: 'never received a newsletter', reached: 'received a newsletter before' };
const GIVING_LABEL = { '': 'anyone', any: 'donors (any gift)', monthly: 'monthly members', onetime: 'one-time donors only', none: 'non-donors' };
const VIA_LABEL = { '': 'any way', subscriber: 'join form / petition', member: 'donation checkout' };

export default function AudienceFilters({ f, petitions = [], lists = [], prefix = 'af', disabled = false, onChange }) {
  const id = (k) => `${prefix}-${k}`;
  const change = (e) => onChange?.(e.target.name, e.target.value);
  const sel = (name, value, options) => (
    <select id={id(name)} name={name} defaultValue={value} onChange={change} disabled={disabled}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const petitionOptions = (first) => [first, ['any', 'any petition'], ...petitions.map((p) => [p, p])];
  return (
    <div className="audience-filters">
      <div className="mail-row">
        <label htmlFor={id('residency')}>Residency{sel('residency', f.residency || 'all', ['all', ...RESIDENCIES].map((r) => [r, RESIDENCY_LABEL[r]]))}</label>
        <label htmlFor={id('zip')}>ZIP starts with
          <input id={id('zip')} name="zip" defaultValue={f.zip || ''} onChange={change} disabled={disabled} inputMode="numeric" pattern="[0-9]{1,5}" maxLength={5} placeholder="841" size={6} />
        </label>
        <label htmlFor={id('giving')}>Giving{sel('giving', f.giving || (f.donors ? 'any' : ''), ['', ...GIVINGS].map((g) => [g, GIVING_LABEL[g]]))}</label>
        <label htmlFor={id('via')}>Joined via{sel('via', f.via || '', Object.entries(VIA_LABEL))}</label>
      </div>
      <div className="mail-row">
        <label htmlFor={id('petition')}>Signed{sel('petition', f.petition || '', [['', 'no filter'], ['any', 'any petition'], ['none', 'no petition at all'], ...petitions.map((p) => [p, p])])}</label>
        <label htmlFor={id('not_petition')}>Did NOT sign{sel('not_petition', f.not_petition || '', petitionOptions(['', 'no filter']))}</label>
        <label htmlFor={id('history')}>Newsletter history{sel('history', f.history || 'all', ['all', ...HISTORIES].map((h) => [h, HISTORY_LABEL[h]]))}</label>
        <label htmlFor={id('last_sent_before')}>Not emailed since
          <input type="date" id={id('last_sent_before')} name="last_sent_before" defaultValue={f.last_sent_before || ''} onChange={change} disabled={disabled} />
        </label>
      </div>
      <div className="mail-row">
        <label htmlFor={id('joined_after')}>Joined on or after
          <input type="date" id={id('joined_after')} name="joined_after" defaultValue={f.joined_after || ''} onChange={change} disabled={disabled} />
        </label>
        <label htmlFor={id('joined_before')}>Joined on or before
          <input type="date" id={id('joined_before')} name="joined_before" defaultValue={f.joined_before || ''} onChange={change} disabled={disabled} />
        </label>
        {lists.length > 0 && (
          <label htmlFor={id('not_list')}>Not on saved list{sel('not_list', f.not_list || '', [['', 'no filter'], ...lists.map((l) => [l.id, l.name])])}</label>
        )}
      </div>
    </div>
  );
}
