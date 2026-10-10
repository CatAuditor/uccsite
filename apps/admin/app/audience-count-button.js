'use client';
// "Apply filters" for a form that carries AudienceFilters but is not the
// composer (the Saved lists page): reads the enclosing form's filter fields,
// asks GET /mail/audience-count (the same resolver the sender uses) and
// shows the number — nothing is saved. docs/systems/newsletters.md "Filters".
import { useState } from 'react';
import { FILTER_KEYS } from '@uccsite/db/audience';

export default function AudienceCountButton({ label = 'Apply filters (count)' }) {
  const [state, setState] = useState({ busy: false, text: '' });
  async function count(e) {
    const form = e.currentTarget.form;
    if (!form) return;
    const fd = new FormData(form);
    const q = new URLSearchParams();
    for (const k of FILTER_KEYS) { const v = fd.get(k); if (typeof v === 'string' && v) q.set(k, v); }
    setState({ busy: true, text: '' });
    try {
      const res = await fetch(`/mail/audience-count?${q}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.count !== 'number') throw new Error(body.error || `Count failed (${res.status})`);
      setState({ busy: false, text: `${body.count} ${body.count === 1 ? 'person matches' : 'people match'} (${body.description})` });
    } catch (err) {
      setState({ busy: false, text: err.message || 'Could not count' });
    }
  }
  return (
    <span className="inline">
      <button type="button" className="secondary" onClick={count} disabled={state.busy}>{state.busy ? 'Counting…' : label}</button>
      {state.text && <span className="hint"> {state.text}</span>}
    </span>
  );
}
