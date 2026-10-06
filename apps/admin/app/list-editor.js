'use client';
// Generic ordered-list editor: add / remove / reorder items, one fieldset per
// item, serialized as JSON into a hidden input the server action parses.
// Fields with widget 'list' render a nested editor (projects → articles /
// videos) inside the item. The top level offers a text filter (narrows what
// is shown; order and hidden items are untouched) and A–Z / newest-first
// sorting of the whole list. Deliberately dependency-free (spec §15).
import { useState, useTransition } from 'react';
import { parseFreeDate } from '@uccsite/render/dates.mjs';
import InlineImageUpload from './media/inline-upload';
import { unfurlLink } from '../lib/unfurl';

const hostOf = (href) => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return ''; } };
const DEFAULT_BADGE = '#1b2f4e';

// "Add from link" (docs/systems/admin.md "Link previews"): paste an article
// URL, see the card a social feed would show, add it to the TOP of the list
// with the fields filled. An outlet already in the list keeps its existing
// name and badge colour, so KSL stays "KSL" in KSL blue. Nothing is saved
// until the editor presses Save.
function LinkAdder({ fields, items, onAdd, maxItems }) {
  const [link, setLink] = useState('');
  const [result, setResult] = useState(null);
  const [pending, start] = useTransition();
  const has = (name) => fields.some((f) => f.name === name);

  const fetchPreview = () => {
    const url = link.trim();
    if (!url) return;
    setResult(null);
    start(async () => setResult(await unfurlLink(url)));
  };

  const add = () => {
    const f = { ...result.fields };
    const host = hostOf(f.url);
    const known = items.find((it) => hostOf(it.url) === host)
      || items.find((it) => String(it.outlet || '').toLowerCase() === f.outlet.toLowerCase());
    if (known?.outlet) {
      const spanish = f.lang_attr === 'lang="es"';
      f.outlet = known.outlet;
      f.read_more = spanish ? `Leer en ${known.outlet} →` : `Read on ${known.outlet} →`;
    }
    f.badge_color = known?.badge_color || DEFAULT_BADGE;
    const item = Object.fromEntries(fields.map((fd) => [fd.name, fd.widget === 'list' ? [] : (f[fd.name] ?? '')]));
    onAdd(item);
    setLink('');
    setResult(null);
  };

  const duplicate = result?.ok && items.some((it) => it.url && it.url === result.fields.url);

  return (
    <div className="unfurl">
      <label htmlFor="unfurl-link">Add from link</label>
      <div className="unfurl-row">
        <input id="unfurl-link" type="url" placeholder="Paste an article link…" value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchPreview(); } }} />
        <button type="button" onClick={fetchPreview} disabled={pending || !link.trim()}>
          {pending ? 'Fetching…' : 'Fetch preview'}
        </button>
      </div>
      {result && !result.ok && <p className="unfurl-error" role="alert">{result.error}</p>}
      {result?.ok && (
        <div className="unfurl-card">
          {result.card.image && <img className="unfurl-image" src={result.card.image} alt="" referrerPolicy="no-referrer" />}
          <div className="unfurl-body">
            <div className="unfurl-site">
              <img src={result.card.icon} alt="" width="16" height="16" referrerPolicy="no-referrer"
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <span>{result.card.site}</span>
              <span className="unfurl-host">{result.card.host}</span>
            </div>
            <div className="unfurl-title">{result.card.title || '(no headline found)'}</div>
            {result.card.description && <div className="unfurl-desc">{result.card.description}</div>}
            <dl className="unfurl-fields">
              {has('date') && <><dt>Date</dt><dd>{result.fields.date || 'not found — fill in'}</dd></>}
              {result.fields.lang_attr && has('lang_attr') && <><dt>Language</dt><dd>{result.fields.lang_attr}</dd></>}
            </dl>
            {result.partial && (
              <p className="unfurl-note">This site blocks link previews, so these came from the link itself.
                Check the headline and add a summary before saving.</p>
            )}
            {duplicate && <p className="unfurl-error">This link is already in the list.</p>}
            <div className="unfurl-actions">
              <button type="button" onClick={add}>Add to top</button>
              <button type="button" className="secondary" onClick={() => setResult(null)}>Discard</button>
            </div>
            {maxItems && items.length >= maxItems && (
              <p className="hint">This list shows {maxItems}. Adding puts this first and drops the last one.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
                    {!readOnly && <InlineImageUpload targetWidth={f.targetWidth || 800} compact onDone={(path) => update(i, f.name, path)} />}
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
export default function ListEditor({ fields, items: initial, itemLabelField, readOnly, name = 'payload', mediaOptions = {}, sortable = false, maxItems }) {
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

  const linkable = !readOnly && fields.some(f => f.name === 'url') && fields.some(f => f.name === 'headline');
  // New stories go to the TOP; a capped list (homepage press = 3) drops its last.
  const addFromLink = (item) => setItems((prev) => {
    const next = [item, ...prev];
    return maxItems ? next.slice(0, maxItems) : next;
  });

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      {linkable && <LinkAdder fields={fields} items={items} onAdd={addFromLink} maxItems={maxItems} />}
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
