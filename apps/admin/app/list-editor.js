'use client';
// Generic ordered-list editor: add / remove / reorder items, one fieldset per
// item, serialized as JSON into a hidden input the server action parses.
// Fields with widget 'list' render a nested editor (projects → articles /
// videos) inside the item. The top level offers a text filter (narrows what
// is shown; order and hidden items are untouched) and A–Z / newest-first
// sorting of the whole list. Deliberately dependency-free (spec §15).
import { useState } from 'react';
import { parseFreeDate } from '@uccsite/render/dates.mjs';

function emptyItem(fields) {
  return Object.fromEntries(fields.map(f => [f.name, f.widget === 'list' ? [] : '']));
}

function Items({ fields, items, onChange, itemLabelField, readOnly, idPrefix, mediaOptions = {}, visible }) {
  const update = (i, field, value) => onChange(items.map((item, j) => (j === i ? { ...item, [field]: value } : item)));
  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, emptyItem(fields)]);

  return (
    <div className="list-editor">
      {items.map((item, i) => (
        <fieldset key={i} className="item" hidden={visible && !visible(item)}>
          <legend>
            {i + 1}. {item[itemLabelField] || '(new)'}
            {!readOnly && (
              <span className="item-tools">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" onClick={() => move(i, +1)} disabled={i === items.length - 1}>↓</button>
                <button type="button" onClick={() => remove(i)}>remove</button>
              </span>
            )}
          </legend>
          {fields.map((f) => {
            const id = `${idPrefix}-${i}-${f.name}`;
            if (f.widget === 'list') {
              const children = Array.isArray(item[f.name]) ? item[f.name] : [];
              return (
                <div key={f.name} className="nested">
                  <div className="nested-title">{f.label} ({children.length})</div>
                  <Items fields={f.fields} items={children} onChange={(v) => update(i, f.name, v)}
                    itemLabelField={f.itemLabelField || f.fields[0].name} readOnly={readOnly} idPrefix={id} />
                </div>
              );
            }
            return (
              <div key={f.name}>
                <label htmlFor={id}>{f.label}</label>
                {f.widget === 'textarea' ? (
                  <textarea id={id} value={item[f.name] ?? ''} disabled={readOnly}
                    onChange={(e) => update(i, f.name, e.target.value)} />
                ) : f.widget === 'media' ? (
                  <div className="media-field">
                    <input type="text" id={id} value={item[f.name] ?? ''} disabled={readOnly}
                      onChange={(e) => update(i, f.name, e.target.value)} />
                    <select aria-label={`${f.label} from media library`} value="" disabled={readOnly}
                      onChange={(e) => { if (e.target.value) update(i, f.name, e.target.value); }}>
                      <option value="">Pick from Media Library…</option>
                      {(mediaOptions[f.name] || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ) : (
                  <input type="text" id={id} value={item[f.name] ?? ''} disabled={readOnly}
                    onChange={(e) => update(i, f.name, e.target.value)} />
                )}
                {f.hint && <div className="hint">{f.hint}</div>}
              </div>
            );
          })}
        </fieldset>
      ))}
      {!readOnly && <button type="button" onClick={add}>+ Add {itemLabelField === 'headline' ? 'entry' : 'item'}</button>}
    </div>
  );
}

const parseDate = (s) => { const t = parseFreeDate(s); return Number.isNaN(t) ? -Infinity : t; };

// mediaOptions: { [fieldName]: [{ value, label }] } for widget 'media' fields —
// the server builds it from READY assets WITH alt text (see lib/media.js).
export default function ListEditor({ fields, items: initial, itemLabelField, readOnly, name = 'payload', mediaOptions = {}, sortable = false }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const visible = q ? (item) => fields.some(f => f.widget !== 'list' && String(item[f.name] || '').toLowerCase().includes(q)) : null;
  const sortBy = (kind) => {
    const next = [...items];
    if (kind === 'name') next.sort((a, b) => String(a[itemLabelField] || '').localeCompare(String(b[itemLabelField] || '')));
    if (kind === 'date') next.sort((a, b) => parseDate(b.date) - parseDate(a.date));
    setItems(next);
  };

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      {(sortable || items.length > 5) && (
        <div className="list-tools">
          <input type="search" placeholder="Filter items…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter items" />
          {sortable && !readOnly && (
            <>
              <button type="button" onClick={() => sortBy('name')}>Sort A–Z</button>
              {fields.some(f => f.name === 'date') && <button type="button" onClick={() => sortBy('date')}>Sort newest first</button>}
              <span className="hint">Sorting reorders the saved list — the site shows items in this order.</span>
            </>
          )}
        </div>
      )}
      <Items fields={fields} items={items} onChange={setItems} itemLabelField={itemLabelField} readOnly={readOnly}
        idPrefix={name} mediaOptions={mediaOptions} visible={visible} />
    </div>
  );
}
