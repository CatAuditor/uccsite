'use client';
// The document builder (docs/systems/document-builder.md "Editor"): header
// fields, then sections of blocks, each block with its own fields, variant
// and styling; a live preview on the right that re-renders (server action
// previewBlocks: serialize → ingest → compose) a moment after every change,
// without saving. The whole model travels in one hidden input (bodyBlocks,
// JSON) inside the document form; Save serializes it to body_html_raw.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BLOCK_TYPES, HEADER_FIELDS, SECTION_FIELDS, newBlock, newSection, slugify } from '@uccsite/doc-blocks/schema';
import { previewBlocks, parseUpload } from '../actions';
import { Field, Fields } from './field-editors';
import BlockPicker from './block-picker';

const PREVIEW_DELAY_MS = 600;
const HEADER_GROUPS = [
  ['Hero', ['layout', 'eyebrow', 'headline', 'summary', 'ctas', 'provenance']],
  ['Byline', ['badge', 'status', 'date', 'authorTitle', 'metaLinkLabel', 'metaLinkHref', 'note']],
  ['Contents', ['toc']],
];
const LAYOUT_FIELD = { key: 'layout', label: 'Top of the page', kind: 'select', options: [{ value: 'hero', label: 'Hero, byline and contents (standard)' }, { value: 'none', label: 'None: the blocks draw the whole page' }] };
// Styling chips offered on every block: utilities and the block group's roots.
const CHIP_GROUPS = new Set(['Utilities', 'Document blocks']);

export default function Builder({ documentId, initialBody, initialPreview, gallery, kit, coverageKeys, publishedFiles, pageCss, readOnly }) {
  const [body, setBody] = useState(initialBody);
  const [preview, setPreview] = useState(initialPreview || '');
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [picker, setPicker] = useState(null); // { sectionIndex, index }
  const [uploadNote, setUploadNote] = useState('');
  const frame = useRef(null);
  const scrollY = useRef(0);
  const timer = useRef(null);
  const first = useRef(true);
  const ctx = useMemo(() => ({ coverageKeys, publishedFiles }), [coverageKeys, publishedFiles]);

  // Title/author live in the document form above the builder; the preview
  // and the byline read them as typed.
  const formValue = (id) => (typeof document !== 'undefined' ? document.getElementById(id)?.value || '' : '');

  const refresh = useCallback(async (next) => {
    setStatus('Updating preview…');
    const r = await previewBlocks({ id: documentId, body: next, title: formValue('title'), author: formValue('author') });
    if (r?.error) { setStatus(`Preview failed: ${r.error}`); return; }
    setPreview(r.html);
    setReport(r.report);
    setStatus('');
  }, [documentId]);

  // Debounced preview after any change (not on first render: the server gave us one).
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => refresh(body), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [body, refresh]);
  // Title / author edits refresh the preview too.
  useEffect(() => {
    const els = ['title', 'author'].map(id => document.getElementById(id)).filter(Boolean);
    const on = () => { clearTimeout(timer.current); timer.current = setTimeout(() => refresh(body), PREVIEW_DELAY_MS); };
    els.forEach(el => el.addEventListener('input', on));
    return () => els.forEach(el => el.removeEventListener('input', on));
  }, [body, refresh]);

  // Preview ↔ editor: click a block in the preview → select its card; keep the scroll position across re-renders.
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.ucc === 'block' && e.data.id) {
        setSelected(e.data.id);
        document.querySelector(`[data-card="${e.data.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      if (e.data?.ucc === 'scroll') scrollY.current = e.data.y;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const outline = (id) => frame.current?.contentWindow?.postMessage({ ucc: 'hoverBlock', id }, '*');
  const onFrameLoad = () => frame.current?.contentWindow?.postMessage({ ucc: 'scrollTo', y: scrollY.current }, '*');

  // ---- model updates ----
  const setHeader = (h) => setBody(b => ({ ...b, header: h }));
  const setSections = (fn) => setBody(b => ({ ...b, sections: fn(b.sections) }));
  const setSection = (i, fn) => setSections(ss => ss.map((s, k) => (k === i ? fn(s) : s)));
  const setBlock = (i, j, fn) => setSection(i, s => ({ ...s, blocks: s.blocks.map((bl, k) => (k === j ? fn(bl) : bl)) }));
  const moveIn = (arr, from, to) => { const n = [...arr]; const [it] = n.splice(from, 1); n.splice(to, 0, it); return n; };
  const addSection = (at) => { const s = newSection(''); setSections(ss => { const n = [...ss]; n.splice(at, 0, s); return n; }); setSelected(s.id); };
  const addBlock = (type) => {
    if (!picker) return;
    const block = newBlock(type);
    setSection(picker.sectionIndex, s => { const blocks = [...s.blocks]; blocks.splice(picker.index, 0, block); return { ...s, blocks }; });
    setSelected(block.id);
    setPicker(null);
    setTimeout(() => document.querySelector(`[data-card="${block.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  };

  async function onReplaceFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(`Replace everything in this document with the contents of ${file.name}? (Nothing is saved until you press Save.)`)) return;
    setUploadNote(`Reading ${file.name}…`);
    const fd = new FormData();
    fd.append('file', file);
    const r = await parseUpload(fd);
    if (r?.error) { setUploadNote(`Could not read ${file.name}: ${r.error}`); return; }
    setBody(r.body);
    const t = document.getElementById('title'); const a = document.getElementById('author');
    if (t && r.title) t.value = r.title;
    if (a && r.author && !a.value) a.value = r.author;
    const notes = [`${r.report.sections} sections, ${r.report.blocks} blocks`];
    if (r.report.raw) notes.push(`${r.report.raw} piece${r.report.raw === 1 ? '' : 's'} kept as custom HTML`);
    if (r.report.imagesPending) notes.push(`${r.report.imagesPending} image${r.report.imagesPending === 1 ? '' : 's'} to upload (open each Image block)`);
    if (r.report.warnings?.length) notes.push(r.report.warnings.join('; '));
    setUploadNote(`Read ${file.name}: ${notes.join(' · ')}. Review, then Save.`);
  }

  const headerField = (key) => key === 'layout' ? LAYOUT_FIELD : HEADER_FIELDS.find(f => f.key === key);
  const sectionDefs = SECTION_FIELDS.filter(f => f.key !== 'heading');

  return (
    <div className="builder">
      <input type="hidden" name="bodyBlocks" value={JSON.stringify(body)} />
      <div className="builder-cols">
        <div className="builder-edit">
          {!readOnly && (
            <fieldset className="item">
              <legend>Start from a file</legend>
              <label htmlFor="replace-file">Replace this document&apos;s contents with a .docx (Word, Google Docs, Claude Docs), .md or .html file. The header fields and blocks are filled from it; images come in as Image blocks waiting for an upload.</label>
              <input type="file" id="replace-file" accept=".html,.htm,.docx,.md,.markdown,.txt,text/html,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onReplaceFile} />
              {uploadNote && <div className="notice">{uploadNote}</div>}
            </fieldset>
          )}

          <fieldset className="item">
            <legend>Page header</legend>
            <div className="hint">The title and author fields above are the headline and the byline name. Everything here follows the site&apos;s one document style.</div>
            {HEADER_GROUPS.map(([name, keys]) => (
              <details key={name} open={name === 'Hero'} className="bgroup">
                <summary>{name}</summary>
                {keys.map(k => headerField(k)).filter(Boolean).filter(f => body.header.layout !== 'none' || f.key === 'layout').map(def => (
                  <Field key={def.key} def={def} value={body.header[def.key]} disabled={readOnly} ctx={{ ...ctx, prefix: 'hdr' }} onChange={(v) => setHeader({ ...body.header, [def.key]: v })} />
                ))}
              </details>
            ))}
          </fieldset>

          <AddBar label="Add a section here" onClick={() => addSection(0)} disabled={readOnly} />
          {body.sections.map((section, i) => (
            <div key={section.id}>
              <section className={`bsection${selected === section.id ? ' on' : ''}`} data-card={section.id} onMouseEnter={() => outline(section.id)} onMouseLeave={() => outline(null)}>
                <div className="bsection-head">
                  <input type="text" className="bsection-title" placeholder="Section heading (leave blank for an unheaded run of blocks)" value={section.heading} disabled={readOnly}
                    onChange={(e) => setSection(i, s => ({ ...s, heading: e.target.value }))} />
                  {!readOnly && (
                    <div className="btools">
                      <button type="button" title="Move section up" disabled={i === 0} onClick={() => setSections(ss => moveIn(ss, i, i - 1))}>↑</button>
                      <button type="button" title="Move section down" disabled={i === body.sections.length - 1} onClick={() => setSections(ss => moveIn(ss, i, i + 1))}>↓</button>
                      <button type="button" title="Remove section and its blocks" className="danger" onClick={() => { if (window.confirm('Remove this section and every block in it?')) setSections(ss => ss.filter((_, k) => k !== i)); }}>×</button>
                    </div>
                  )}
                </div>
                <details className="bgroup bsection-more">
                  <summary>Section options{section.heading ? ` · #${section.anchor || slugify(section.heading)}` : ''}</summary>
                  <Fields defs={sectionDefs} obj={section} disabled={readOnly} ctx={{ ...ctx, prefix: `sec-${i}` }} onChange={(next) => setSection(i, () => ({ ...next, blocks: section.blocks }))} />
                  <Field def={{ key: 'classes', label: 'Extra classes on the band', kind: 'text', hint: 'space-separated; for migrated per-part styles' }} value={(section.classes || []).join(' ')} disabled={readOnly} ctx={{ prefix: `sec-${i}` }}
                    onChange={(v) => setSection(i, s => ({ ...s, classes: v.split(/\s+/).filter(Boolean) }))} />
                </details>

                <AddBar label="Add a block" onClick={() => setPicker({ sectionIndex: i, index: 0 })} disabled={readOnly} small />
                {section.blocks.map((block, j) => (
                  <div key={block.id}>
                    <BlockCard
                      block={block} kit={kit} ctx={{ ...ctx, prefix: `b-${block.id}` }} readOnly={readOnly} selected={selected === block.id}
                      onSelect={() => setSelected(block.id)} onHover={(on) => outline(on ? block.id : null)}
                      onChange={(fn) => setBlock(i, j, fn)}
                      onMove={(d) => setSection(i, s => ({ ...s, blocks: moveIn(s.blocks, j, j + d) }))}
                      canUp={j > 0} canDown={j < section.blocks.length - 1}
                      onRemove={() => setSection(i, s => ({ ...s, blocks: s.blocks.filter((_, k) => k !== j) }))}
                    />
                    <AddBar label="Add a block" onClick={() => setPicker({ sectionIndex: i, index: j + 1 })} disabled={readOnly} small />
                  </div>
                ))}
              </section>
              <AddBar label="Add a section here" onClick={() => addSection(i + 1)} disabled={readOnly} />
            </div>
          ))}
          {!body.sections.length && <p className="notice">No sections yet. Add a section, then add blocks to it, or start from a file above.</p>}
        </div>

        <div className="builder-preview">
          <div className="builder-preview-head">
            <strong>Preview</strong> <span className="hint">as it will publish · click a piece to jump to it</span>
            {status && <span className="hint builder-status">{status}</span>}
          </div>
          <iframe ref={frame} title="Live preview" sandbox="allow-scripts" srcDoc={preview} onLoad={onFrameLoad} />
          {report && (report.a11y?.length > 0 || report.foreignClasses?.length > 0 || report.warnings?.length > 0) && (
            <div className="builder-report">
              {report.a11y?.map((a, i) => <div className="error" key={`a${i}`}>Blocks publishing: {a.message}</div>)}
              {report.foreignClasses?.length > 0 && <div className="error">Classes the site does not know (removed on save): {[...new Set(report.foreignClasses.map(f => f.className || f.class || f))].join(', ')}</div>}
              {report.warnings?.map((w, i) => <div className="notice" key={`w${i}`}>{w}</div>)}
            </div>
          )}
        </div>
      </div>

      <details className="bgroup builder-advanced">
        <summary>Advanced: page CSS</summary>
        <label htmlFor="pageCss">Page CSS (published as a fingerprinted stylesheet for this page only; a builder document normally needs none)</label>
        <textarea id="pageCss" name="pageCss" className="code" rows={8} defaultValue={pageCss || ''} disabled={readOnly} spellCheck={false} />
      </details>

      {picker && <BlockPicker types={BLOCK_TYPES} gallery={gallery} onPick={addBlock} onClose={() => setPicker(null)} />}
    </div>
  );
}

function AddBar({ label, onClick, disabled, small }) {
  if (disabled) return null;
  return (
    <div className={`add-bar${small ? ' small' : ''}`}>
      <button type="button" onClick={onClick}>+ {label}</button>
    </div>
  );
}

function BlockCard({ block, kit, ctx, readOnly, selected, onSelect, onHover, onChange, onMove, canUp, canDown, onRemove }) {
  const def = BLOCK_TYPES[block.type];
  const [styling, setStyling] = useState(false);
  if (!def) return <div className="bcard error">Unknown block type {block.type}</div>;
  const fields = def.fields.filter(f => !f.variant || f.variant === block.variant);
  const chips = kit.filter(e => CHIP_GROUPS.has(e.group));
  const toggleClass = (c) => onChange(b => ({ ...b, classes: (b.classes || []).includes(c) ? (b.classes || []).filter(x => x !== c) : [...(b.classes || []), c] }));
  return (
    <div className={`bcard${selected ? ' on' : ''}`} data-card={block.id} onMouseDown={onSelect} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="bcard-head">
        <strong>{def.label}</strong>
        {def.variants && (
          <select value={block.variant || def.variants[0].value} disabled={readOnly} onChange={(e) => onChange(b => ({ ...b, variant: e.target.value }))} title="Style">
            {def.variants.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        )}
        {!readOnly && (
          <div className="btools">
            <button type="button" title="Styling" className={styling ? 'on' : ''} onClick={() => setStyling(s => !s)}>Style{block.classes?.length ? ` (${block.classes.length})` : ''}</button>
            <button type="button" title="Move up" disabled={!canUp} onClick={() => onMove(-1)}>↑</button>
            <button type="button" title="Move down" disabled={!canDown} onClick={() => onMove(1)}>↓</button>
            <button type="button" title="Remove block" className="danger" onClick={onRemove}>×</button>
          </div>
        )}
      </div>
      {block.type === 'figure' && block.pending && !block.src && <div className="notice">This image came from the uploaded file. Upload it below so it can be placed (alt text first).</div>}
      {block.type === 'byline' && <div className="hint">Shows the badge, date and author here. Edit the text in Page header → Byline.</div>}
      <Fields defs={fields} obj={block} disabled={readOnly} ctx={{ ...ctx, width: Array.isArray(block.head) ? block.head.length : 2 }} onChange={(next) => onChange(() => next)} />
      {styling && (
        <div className="bchips">
          <div className="hint">Extra site classes on this block&apos;s outer element. Hover for what each does.</div>
          {chips.map(e => (
            <button type="button" key={e.className} className={`kit-class${(block.classes || []).includes(e.className) ? ' on' : ''}`} title={`${e.description || ''}\n${e.declarations || ''}`} onClick={() => toggleClass(e.className)}>
              {e.label || e.className} <code>.{e.className}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
