'use client';
// Field editors for the builder (docs/systems/document-builder.md "Editor"):
// one component per field kind in packages/doc-blocks/schema.js. `Field`
// dispatches on `def.kind`; `Fields` renders a list of them bound to an
// object. Everything is controlled: value in, onChange(next) out.
import RichText from './rich-text';
import InlineImageUpload from '../../media/inline-upload';

export function Field({ def, value, onChange, disabled, ctx }) {
  const id = `${ctx?.prefix || 'f'}-${def.key}`;
  const label = <label htmlFor={id}>{def.label}{def.hint && <span className="hint"> {def.hint}</span>}</label>;
  switch (def.kind) {
    case 'text':
    case 'url':
      return <div className="bf">{label}<input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} /></div>;
    case 'inline':
      return <div className="bf">{label}<RichText value={value ?? ''} onChange={onChange} disabled={disabled} placeholder={def.hint || ''} /></div>;
    case 'html':
      return <div className="bf">{label}<RichText value={value ?? ''} onChange={onChange} disabled={disabled} multi rows={4} /></div>;
    case 'code':
      return <div className="bf">{label}<textarea id={id} className="code" rows={8} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} /></div>;
    case 'bool':
      return <div className="bf bf-bool"><label><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /> {def.label}{def.hint && <span className="hint"> {def.hint}</span>}</label></div>;
    case 'select':
      return (
        <div className="bf">{label}
          <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
            {(def.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    case 'coverage':
      return (
        <div className="bf">{label}
          <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
            <option value="">— choose —</option>
            {(ctx?.coverageKeys || []).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      );
    case 'file':
      return (
        <div className="bf">{label}
          <div className="bf-row">
            <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="/files/… or a URL" />
            {!disabled && (ctx?.publishedFiles || []).length > 0 && (
              <select value="" onChange={(e) => { if (e.target.value) onChange(e.target.value); }} title="Pick a published file">
                <option value="">Pick a file…</option>
                {ctx.publishedFiles.map(f => <option key={f.href} value={f.href}>{f.label}</option>)}
              </select>
            )}
          </div>
        </div>
      );
    case 'image':
      return (
        <div className="bf">{label}
          <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="/media/… (upload below)" />
          {!disabled && <InlineImageUpload targetWidth={1200} compact label="Upload an image" onDone={(path, meta) => { onChange(path); if (meta?.alt && ctx?.setSibling) ctx.setSibling('alt', meta.alt); }} />}
        </div>
      );
    case 'cells':
      return <CellsEditor label={def.label} cells={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} />;
    case 'rows':
      return <RowsEditor label={def.label} rows={Array.isArray(value) ? value : []} width={ctx?.width || 2} onChange={onChange} disabled={disabled} />;
    case 'list':
      return <ListEditor def={def} items={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} ctx={ctx} />;
    default:
      return null;
  }
}

export function Fields({ defs, obj, onChange, disabled, ctx }) {
  return defs.map(def => (
    <Field
      key={def.key}
      def={def}
      value={obj?.[def.key]}
      disabled={disabled}
      ctx={{ ...ctx, prefix: `${ctx?.prefix || 'f'}-${def.key}`, setSibling: (k, v) => onChange({ ...obj, [k]: v }) }}
      onChange={(v) => onChange({ ...obj, [def.key]: v })}
    />
  ));
}

function ListEditor({ def, items, onChange, disabled, ctx }) {
  const set = (i, next) => onChange(items.map((it, k) => (k === i ? next : it)));
  const move = (i, d) => { const n = [...items]; const [it] = n.splice(i, 1); n.splice(i + d, 0, it); onChange(n); };
  const blank = () => Object.fromEntries((def.of || []).map(f => [f.key, f.kind === 'bool' ? false : '']));
  return (
    <div className="bf bf-list">
      <label>{def.label}{def.hint && <span className="hint"> {def.hint}</span>}</label>
      {items.map((it, i) => (
        <div className="bf-item" key={i}>
          <div className="bf-item-fields">
            <Fields defs={def.of || []} obj={it} onChange={(next) => set(i, next)} disabled={disabled} ctx={{ ...ctx, prefix: `${ctx?.prefix || 'f'}-${i}` }} />
          </div>
          {!disabled && (
            <div className="bf-item-tools">
              <button type="button" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" title="Remove" className="danger" onClick={() => onChange(items.filter((_, k) => k !== i))}>×</button>
            </div>
          )}
        </div>
      ))}
      {!disabled && <button type="button" className="small" onClick={() => onChange([...items, blank()])}>+ Add {def.label.replace(/s$/, '').toLowerCase()}</button>}
    </div>
  );
}

function CellsEditor({ label, cells, onChange, disabled }) {
  return (
    <div className="bf">
      <label>{label}</label>
      <div className="bf-cells">
        {cells.map((c, i) => (
          <input key={i} type="text" value={c} onChange={(e) => onChange(cells.map((x, k) => (k === i ? e.target.value : x)))} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

// Rows: each row is an array of cells (or { cells, cls } for a highlighted row).
function RowsEditor({ label, rows, width, onChange, disabled }) {
  const cellsOf = (r) => (Array.isArray(r) ? r : r.cells || []);
  const withCells = (r, cells) => (Array.isArray(r) ? cells : { ...r, cells });
  const setCell = (i, j, v) => onChange(rows.map((r, k) => (k === i ? withCells(r, cellsOf(r).map((c, m) => (m === j ? v : c))) : r)));
  const w = Math.max(width, ...rows.map(r => cellsOf(r).length), 1);
  return (
    <div className="bf">
      <label>{label}</label>
      <div className="bf-rows">
        {rows.map((r, i) => (
          <div className="bf-cells" key={i}>
            {Array.from({ length: w }, (_, j) => (
              <input key={j} type="text" value={cellsOf(r)[j] ?? ''} onChange={(e) => setCell(i, j, e.target.value)} disabled={disabled} />
            ))}
            {!disabled && (
              <>
                <select value={Array.isArray(r) ? '' : r.cls || ''} title="Row style" onChange={(e) => onChange(rows.map((x, k) => (k === i ? (e.target.value ? { cells: cellsOf(x), cls: e.target.value } : cellsOf(x)) : x)))}>
                  <option value="">plain</option><option value="highlight">highlight</option><option value="subtotal">subtotal</option>
                </select>
                <button type="button" className="danger" title="Remove row" onClick={() => onChange(rows.filter((_, k) => k !== i))}>×</button>
              </>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <div className="bf-row">
          <button type="button" className="small" onClick={() => onChange([...rows, Array.from({ length: w }, () => '')])}>+ Row</button>
          <button type="button" className="small" onClick={() => onChange(rows.map(r => withCells(r, [...cellsOf(r), ''])))} title="Adds a column to every row (and add a header cell above)">+ Column</button>
        </div>
      )}
    </div>
  );
}
