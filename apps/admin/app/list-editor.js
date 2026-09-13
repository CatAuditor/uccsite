'use client';
// Generic ordered-list editor: add / remove / reorder items, one fieldset per
// item, serialized as JSON into a hidden input the server action parses.
// Deliberately dependency-free (spec §15: no component library).
import { useState } from 'react';

// mediaOptions: { [fieldName]: [{ value, label }] } for widget 'media' fields —
// the server builds it from READY assets WITH alt text (see lib/media.js).
export default function ListEditor({ fields, items: initial, itemLabelField, readOnly, name = 'payload', mediaOptions = {} }) {
  const [items, setItems] = useState(initial);

  const update = (i, field, value) => {
    setItems(items.map((item, j) => (j === i ? { ...item, [field]: value } : item)));
  };
  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const remove = (i) => setItems(items.filter((_, j) => j !== i));
  const add = () => setItems([...items, Object.fromEntries(fields.map(f => [f.name, '']))]);

  return (
    <div className="list-editor">
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      {items.map((item, i) => (
        <fieldset key={i} className="item">
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
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={`${name}-${i}-${f.name}`}>{f.label}</label>
              {f.widget === 'textarea' ? (
                <textarea id={`${name}-${i}-${f.name}`} value={item[f.name] ?? ''} disabled={readOnly}
                  onChange={(e) => update(i, f.name, e.target.value)} />
              ) : f.widget === 'media' ? (
                <div className="media-field">
                  <input type="text" id={`${name}-${i}-${f.name}`} value={item[f.name] ?? ''} disabled={readOnly}
                    onChange={(e) => update(i, f.name, e.target.value)} />
                  <select aria-label={`${f.label} from media library`} value="" disabled={readOnly}
                    onChange={(e) => { if (e.target.value) update(i, f.name, e.target.value); }}>
                    <option value="">Pick from Media Library…</option>
                    {(mediaOptions[f.name] || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ) : (
                <input type="text" id={`${name}-${i}-${f.name}`} value={item[f.name] ?? ''} disabled={readOnly}
                  onChange={(e) => update(i, f.name, e.target.value)} />
              )}
              {f.hint && <div className="hint">{f.hint}</div>}
            </div>
          ))}
        </fieldset>
      ))}
      {!readOnly && <button type="button" onClick={add}>+ Add item</button>}
    </div>
  );
}
