'use client';
// Styling split view (spec §6.5): element tree left, live preview right.
// Rows show paste classes, rule-derived chips (source rule on hover) and
// override chips; the class picker (grouped Style Kit, filtered by
// `applies`) writes overrides through setOverrides; bulk actions apply to
// siblings / all same-tag elements; promote-to-rule generates a selector,
// previews the match count across the template's documents, and saves a
// template rule. Preview ↔ tree link via postMessage (see lib/documents.js).
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setOverrides, previewRule, saveRule } from '../actions';

export default function StyleEditor({ documentId, rows, kit, undocumented, rules, preview, unstyledCount, readOnly, templateKey }) {
  const router = useRouter();
  const frame = useRef(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState('');
  const [promote, setPromote] = useState(null); // { selector, classes, count, perDocument }
  const [pending, start] = useTransition();
  const ruleById = useMemo(() => Object.fromEntries(rules.map(r => [r.id, r])), [rules]);
  const row = rows.find(r => r.nid === selected) || null;

  // Preview → tree (click) ; tree → preview (hover/select)
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== frame.current?.contentWindow) return; // only our preview frame
      if (e.data?.ucc === 'select' && typeof e.data.nid === 'string') setSelected(e.data.nid);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const outline = (nid) => frame.current?.contentWindow?.postMessage({ ucc: 'hover', nid }, '*');
  useEffect(() => {
    outline(selected);
    // A row selected from the preview scrolls into view in the tree.
    document.querySelector(`.tree-row[data-nid="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = kit.filter(e => (showAll || !row || !e.applies?.length || e.applies.includes(row.tag))
      && (!q || e.className.includes(q) || (e.label || '').toLowerCase().includes(q) || (e.group || '').toLowerCase().includes(q)));
    const byGroup = {};
    for (const e of list) (byGroup[e.group || 'Other'] ??= []).push(e);
    return byGroup;
  }, [kit, search, showAll, row]);

  function apply(nids, classes, mode = 'append') {
    if (readOnly) return;
    start(async () => {
      const r = await setOverrides({ documentId, nids, classes, mode });
      setMessage(r.error ? `Error: ${r.error}` : r.message);
      if (!r.error) router.refresh();
    });
  }
  // Toggle semantics: a class that is ON because of a rule or the paste can
  // only be turned off by a replace-mode override that omits it; a class
  // that is ON because of the override is simply removed from it.
  const toggleClass = (cls) => {
    if (!row) return;
    const mode = row.override?.mode || 'append';
    const ovr = row.override ? row.override.classes : [];
    if (row.classes.includes(cls)) {
      if (ovr.includes(cls) && mode === 'append') return apply([row.nid], ovr.filter(c => c !== cls), 'append');
      return apply([row.nid], row.classes.filter(c => c !== cls), 'replace'); // came from a rule/paste
    }
    return apply([row.nid], mode === 'replace' ? [...row.classes, cls] : [...ovr, cls], mode);
  };
  // Replace ↔ append is visually neutral: replace stores the resolved set;
  // append keeps only what the rules/paste don't already give.
  const setMode = (replace) => {
    if (!row) return;
    if (replace) return apply([row.nid], row.classes, 'replace');
    const fromRules = new Set([...row.pasteClasses, ...row.ruleClasses.flatMap(r => r.classes)]);
    apply([row.nid], row.classes.filter(c => !fromRules.has(c)), 'append');
  };
  const siblings = () => {
    if (!row) return [];
    const i = rows.indexOf(row);
    let start = i; while (start > 0 && rows[start - 1].depth >= row.depth) start--;
    const out = [];
    for (let j = start; j < rows.length; j++) {
      if (j > i && rows[j].depth < row.depth) break;
      if (rows[j].depth === row.depth && rows[j].tag === row.tag) out.push(rows[j].nid);
    }
    return out;
  };
  const sameTag = () => rows.filter(r => r.tag === row.tag).map(r => r.nid);
  const rowClasses = (r) => r.override ? r.override.classes : [];

  function openPromote() {
    if (!row) return;
    const i = rows.indexOf(row);
    let parent = null;
    for (let j = i - 1; j >= 0; j--) if (rows[j].depth === row.depth - 1) { parent = rows[j]; break; }
    const selector = parent ? `${parent.tag} > ${row.tag}` : row.tag;
    setPromote({ selector, classes: row.classes.join(' '), priority: 10, count: null, perDocument: [] });
  }
  // Debounced + sequenced: one request ~300ms after the last keystroke, and
  // a slow earlier response can never overwrite a newer selector's count.
  const seq = useRef(0);
  const timer = useRef(null);
  function previewPromote(next) {
    setPromote(next);
    clearTimeout(timer.current);
    const mine = ++seq.current;
    timer.current = setTimeout(() => start(async () => {
      const r = await previewRule({ scope: 'template', templateKey, selector: next.selector });
      if (mine !== seq.current) return;
      setPromote(p => p && ({ ...p, count: r.error ? `invalid: ${r.error}` : r.total, perDocument: r.perDocument || [] }));
    }), 300);
  }
  function savePromote() {
    start(async () => {
      const r = await saveRule({ scope: 'template', templateKey, selector: promote.selector, classes: promote.classes.split(/\s+/).filter(Boolean), priority: Number(promote.priority) || 10, note: `promoted from element ${row?.nid || ''}` });
      setMessage(r.error ? `Error: ${r.error}` : `${r.message} It now applies to every "${templateKey}" document.`);
      if (!r.error) { setPromote(null); router.refresh(); }
    });
  }

  return (
    <section className="style-editor">
      <h2>Styling <span className="hint">{unstyledCount} unstyled element{unstyledCount === 1 ? '' : 's'} · {rules.length} rule{rules.length === 1 ? '' : 's'} apply · {undocumented} kit classes undocumented</span></h2>
      {message && <div className={message.startsWith('Error') ? 'error' : 'ok'}>{message}</div>}
      {!rows.length && <p className="notice">Save some HTML first — the tree and preview appear after the first ingest.</p>}
      <div className="split">
        <div className="tree">
          {rows.map((r) => (
            <div key={r.nid} className={`tree-row${r.nid === selected ? ' selected' : ''}${r.unstyled ? ' unstyled' : ''}`}
              style={{ paddingLeft: 8 + r.depth * 14 }}
              onMouseEnter={() => outline(r.nid)} onMouseLeave={() => outline(selected)} onFocus={() => outline(r.nid)}
              onClick={() => setSelected(r.nid)} role="button" tabIndex={0} data-nid={r.nid}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r.nid); } }}>
              <span className="tag">{r.tag}</span>
              <span className="txt">{r.text}</span>
              <span className="chips">
                {r.pasteClasses.map(c => <span key={'p' + c} className="chip paste" title="from the pasted HTML">{c}</span>)}
                {r.ruleClasses.flatMap(rc => rc.classes.map(c => <span key={rc.ruleId + c} className="chip rule" title={`rule: ${ruleById[rc.ruleId]?.selector || rc.ruleId}`}>{c}</span>))}
                {r.override && r.override.classes.map(c => <span key={'o' + c} className={`chip override ${r.override.mode}`} title={`override (${r.override.mode})`}>{c}</span>)}
                {r.unstyled && <span className="chip none">unstyled</span>}
              </span>
            </div>
          ))}
        </div>
        <div className="preview">
          {preview ? <iframe ref={frame} title="Live preview" srcDoc={preview} sandbox="allow-scripts" onLoad={() => outline(selected)} /> : null}
        </div>
      </div>

      {row && (
        <div className="picker">
          <h3>&lt;{row.tag}&gt; <span className="hint">{row.text}</span></h3>
          <div className="hint">Resolved classes: {row.classes.length ? row.classes.join(' ') : '(none)'}</div>
          {!readOnly && (
            <div className="picker-tools">
              <input type="search" placeholder="Search classes…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <label><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show classes for any tag</label>
              <label><input type="checkbox" checked={row.override?.mode === 'replace'} onChange={(e) => setMode(e.target.checked)} /> override replaces rule classes</label>
              <button type="button" onClick={() => apply(siblings(), rowClasses(row), row.override?.mode || 'append')} disabled={pending || !row.override}>Apply to sibling &lt;{row.tag}&gt;s ({siblings().length})</button>
              <button type="button" onClick={() => apply(sameTag(), rowClasses(row), row.override?.mode || 'append')} disabled={pending || !row.override}>Apply to every &lt;{row.tag}&gt; ({sameTag().length})</button>
              <button type="button" onClick={openPromote} disabled={pending || !row.classes.length}>Promote to template rule…</button>
              {row.override && <button type="button" className="danger" onClick={() => apply([row.nid], [], 'append')} disabled={pending}>Clear override</button>}
            </div>
          )}
          <div className="kit">
            {Object.entries(groups).map(([group, entries]) => (
              <div key={group} className="kit-group">
                <div className="nav-group-title">{group}</div>
                {entries.map(e => (
                  <button type="button" key={e.className} disabled={readOnly || pending}
                    className={`kit-class${row.classes.includes(e.className) ? ' on' : ''}`}
                    title={`${e.description || e.label || e.className}\n${e.declarations || ''}`}
                    onClick={() => toggleClass(e.className)}>
                    {e.label || e.className} <code>.{e.className}</code>
                  </button>
                ))}
              </div>
            ))}
            {!Object.keys(groups).length && <div className="hint">No classes match{row ? ` <${row.tag}>` : ''} — try “show classes for any tag”.</div>}
          </div>
        </div>
      )}

      {promote && (
        <div className="promote">
          <h3>Promote to template rule</h3>
          <p className="hint">Rules match structure, so they survive re-pasting and apply to every document using the “{templateKey}” template.</p>
          <label>Selector <input type="text" value={promote.selector} onChange={(e) => previewPromote({ ...promote, selector: e.target.value })} /></label>
          <label>Classes <input type="text" value={promote.classes} onChange={(e) => setPromote({ ...promote, classes: e.target.value })} /></label>
          <label>Priority <input type="text" value={promote.priority} onChange={(e) => setPromote({ ...promote, priority: e.target.value })} /></label>
          <div className="hint">
            {promote.count === null ? <button type="button" onClick={() => previewPromote(promote)}>Count matches</button>
              : typeof promote.count === 'string' ? promote.count
              : <>Matches {promote.count} element{promote.count === 1 ? '' : 's'}: {promote.perDocument.map(d => `${d.slug} (${d.count})`).join(', ')}</>}
          </div>
          <button type="button" onClick={savePromote} disabled={pending || typeof promote.count !== 'number'}>Save rule</button>
          <button type="button" onClick={() => setPromote(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}
