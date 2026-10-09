'use client';
// Menus editor UI (docs/systems/navigation.md). Holds the whole menu in state
// and posts it as one JSON payload; the server normalizes and validates it
// (packages/render/navigation.js normalizeNavigation), so nothing here is
// trusted. One level of dropdown, like the live header.
import { useState } from 'react';
import ActionForm from '../action-form';

const STYLE_OPTIONS = [['', 'Plain link'], ['donate', 'Donate button (red)'], ['cta', 'Get Involved button (outlined)']];

const swap = (arr, i, j) => {
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
const without = (arr, i) => arr.filter((_, k) => k !== i);
const replace = (arr, i, v) => arr.map((x, k) => (k === i ? v : x));

function LinkFields({ value, onChange, readOnly, idBase }) {
  return (
    <div className="nav-link-fields">
      <label htmlFor={`${idBase}-label`}>Label</label>
      <input id={`${idBase}-label`} type="text" value={value.label} disabled={readOnly} maxLength={80}
        onChange={(e) => onChange({ ...value, label: e.target.value })} />
      <label htmlFor={`${idBase}-href`}>Links to</label>
      <input id={`${idBase}-href`} type="text" list="nav-page-options" value={value.href} disabled={readOnly} maxLength={500}
        placeholder="Pick a page or type an address" onChange={(e) => onChange({ ...value, href: e.target.value })} />
    </div>
  );
}

function Tools({ readOnly, children }) {
  return readOnly ? null : <span className="item-tools">{children}</span>;
}

function LinkList({ title, links, onChange, readOnly, idBase, addLabel = '+ Add link' }) {
  return (
    <div className="nav-sublist">
      {title && <div className="nested-title">{title}</div>}
      {links.map((l, i) => (
        <div key={i} className="nav-row">
          <div className="nav-row-head">
            <span className="nav-row-name">{l.label || '(new link)'}</span>
            <Tools readOnly={readOnly}>
              <button type="button" onClick={() => onChange(swap(links, i, i - 1))} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => onChange(swap(links, i, i + 1))} disabled={i === links.length - 1} aria-label="Move down">↓</button>
              <button type="button" onClick={() => onChange(without(links, i))}>remove</button>
            </Tools>
          </div>
          <LinkFields value={l} readOnly={readOnly} idBase={`${idBase}-${i}`} onChange={(v) => onChange(replace(links, i, v))} />
        </div>
      ))}
      {!readOnly && <button type="button" className="secondary" onClick={() => onChange([...links, { label: '', href: '' }])}>{addLabel}</button>}
    </div>
  );
}

export default function NavEditor({ initial, options, baseline, save, readOnly, requestPublish }) {
  const [header, setHeader] = useState(initial.header);
  const [columns, setColumns] = useState(initial.footer.columns);
  const [bottom, setBottom] = useState(initial.footer.bottom);
  const payload = JSON.stringify({ header, footer: { columns, bottom } });

  // Move a top-level link into the dropdown directly above it, or a dropdown
  // link back out to the top level just after its dropdown.
  const intoDropdownAbove = (i) => {
    const target = [...header.slice(0, i)].map((x, k) => [x, k]).reverse().find(([x]) => x.children);
    if (!target) return;
    const [drop, k] = target;
    const { style, ...plain } = header[i];
    setHeader(without(replace(header, k, { ...drop, children: [...drop.children, plain] }), i));
  };
  const outOfDropdown = (k, j) => {
    const drop = header[k];
    const child = drop.children[j];
    const next = replace(header, k, { ...drop, children: without(drop.children, j) });
    setHeader([...next.slice(0, k + 1), child, ...next.slice(k + 1)]);
  };

  return (
    <ActionForm className="editor nav-editor" action={save} successMessage="Menus saved. Publish to make them live.">
      <input type="hidden" name="baseline" value={baseline} />
      <input type="hidden" name="payload" value={payload} />
      <datalist id="nav-page-options">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </datalist>

      <h2>Header menu</h2>
      <p className="hint">Left to right on a computer, top to bottom on a phone. A dropdown opens a short list.</p>
      {header.map((item, i) => (
        <fieldset key={i} className="item nav-item">
          <legend>
            {i + 1}. {item.label || '(new)'}{item.children ? ' — dropdown' : ''}
            <Tools readOnly={readOnly}>
              <button type="button" onClick={() => setHeader(swap(header, i, i - 1))} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => setHeader(swap(header, i, i + 1))} disabled={i === header.length - 1} aria-label="Move down">↓</button>
              {!item.children && header.slice(0, i).some((x) => x.children) && (
                <button type="button" onClick={() => intoDropdownAbove(i)}>Into dropdown</button>
              )}
              <button type="button" onClick={() => setHeader(without(header, i))}>remove</button>
            </Tools>
          </legend>
          {item.children ? (
            <>
              <label htmlFor={`h-${i}-label`}>Dropdown label</label>
              <input id={`h-${i}-label`} type="text" value={item.label} disabled={readOnly} maxLength={80}
                onChange={(e) => setHeader(replace(header, i, { ...item, label: e.target.value }))} />
              <label htmlFor={`h-${i}-style`}>Looks like</label>
              <select id={`h-${i}-style`} value={item.style || ''} disabled={readOnly}
                onChange={(e) => setHeader(replace(header, i, { ...item, style: e.target.value || undefined }))}>
                {STYLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div className="nav-sublist">
                <div className="nested-title">Links in this dropdown ({item.children.length})</div>
                {item.children.map((c, j) => (
                  <div key={j} className="nav-row">
                    <div className="nav-row-head">
                      <span className="nav-row-name">{c.label || '(new link)'}</span>
                      <Tools readOnly={readOnly}>
                        <button type="button" onClick={() => setHeader(replace(header, i, { ...item, children: swap(item.children, j, j - 1) }))} disabled={j === 0} aria-label="Move up">↑</button>
                        <button type="button" onClick={() => setHeader(replace(header, i, { ...item, children: swap(item.children, j, j + 1) }))} disabled={j === item.children.length - 1} aria-label="Move down">↓</button>
                        <button type="button" onClick={() => outOfDropdown(i, j)}>Out of dropdown</button>
                        <button type="button" onClick={() => setHeader(replace(header, i, { ...item, children: without(item.children, j) }))}>remove</button>
                      </Tools>
                    </div>
                    <LinkFields value={c} readOnly={readOnly} idBase={`h-${i}-${j}`}
                      onChange={(v) => setHeader(replace(header, i, { ...item, children: replace(item.children, j, v) }))} />
                  </div>
                ))}
                {!readOnly && (
                  <button type="button" className="secondary"
                    onClick={() => setHeader(replace(header, i, { ...item, children: [...item.children, { label: '', href: '' }] }))}>
                    + Add link to this dropdown
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <LinkFields value={item} readOnly={readOnly} idBase={`h-${i}`} onChange={(v) => setHeader(replace(header, i, v))} />
              <label htmlFor={`h-${i}-style`}>Looks like</label>
              <select id={`h-${i}-style`} value={item.style || ''} disabled={readOnly}
                onChange={(e) => setHeader(replace(header, i, { ...item, style: e.target.value || undefined }))}>
                {STYLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </>
          )}
        </fieldset>
      ))}
      {!readOnly && (
        <div className="list-tools">
          <button type="button" className="secondary" onClick={() => setHeader([...header, { label: '', href: '' }])}>+ Add link</button>
          <button type="button" className="secondary" onClick={() => setHeader([...header, { label: '', children: [] }])}>+ Add dropdown</button>
        </div>
      )}

      <h2>Footer columns</h2>
      <p className="hint">The link columns at the bottom of every page.</p>
      {columns.map((col, i) => (
        <fieldset key={i} className="item nav-item">
          <legend>
            {i + 1}. {col.heading || '(new column)'}
            <Tools readOnly={readOnly}>
              <button type="button" onClick={() => setColumns(swap(columns, i, i - 1))} disabled={i === 0} aria-label="Move left">←</button>
              <button type="button" onClick={() => setColumns(swap(columns, i, i + 1))} disabled={i === columns.length - 1} aria-label="Move right">→</button>
              <button type="button" onClick={() => setColumns(without(columns, i))}>remove</button>
            </Tools>
          </legend>
          <label htmlFor={`f-${i}-heading`}>Column heading</label>
          <input id={`f-${i}-heading`} type="text" value={col.heading} disabled={readOnly} maxLength={80}
            onChange={(e) => setColumns(replace(columns, i, { ...col, heading: e.target.value }))} />
          <LinkList title={`Links (${col.links.length})`} links={col.links} readOnly={readOnly} idBase={`f-${i}`}
            onChange={(links) => setColumns(replace(columns, i, { ...col, links }))} />
        </fieldset>
      ))}
      {!readOnly && (
        <button type="button" className="secondary" onClick={() => setColumns([...columns, { heading: '', links: [] }])}>+ Add column</button>
      )}

      <h2>Footer bottom links</h2>
      <p className="hint">The small links on the last line of every page — where Privacy Policy lives.</p>
      <fieldset className="item nav-item">
        <legend>Bottom line</legend>
        <LinkList links={bottom} readOnly={readOnly} idBase="b" onChange={setBottom} />
      </fieldset>

      <p className="hint">
        In labels and links, <code>{'{email}'}</code> becomes the email address in Site Settings. Empty rows are dropped when you save.
      </p>
      {!readOnly && <div className="nav-actions"><button type="submit">Save menus</button>{requestPublish}</div>}
    </ActionForm>
  );
}
