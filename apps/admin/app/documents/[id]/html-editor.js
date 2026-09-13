'use client';
// HTML + page-CSS editors (spec §5 "paste or upload", §3.2 per-page CSS) and
// the ingest report — "report, never silently drop" (§5.8). The textareas
// are plain form fields; the file input just fills the HTML field from a
// local .html file (no upload — ingest runs server-side on save).
import { useState } from 'react';

function Removed({ removed }) {
  if (!removed?.length) return null;
  const total = removed.reduce((n, r) => n + (r.count || 1), 0);
  return (
    <div className="error">
      <strong>{total} thing{total === 1 ? '' : 's'} removed on save:</strong>{' '}
      {removed.map((r, i) => (
        <span key={i}>{i ? ', ' : ''}{r.count || 1}× {r.kind === 'tag' ? `<${r.tag}>` : r.kind === 'attribute' ? `${r.attr} attribute` : r.kind === 'url' ? `${r.attr} URL (${r.reason || 'unsafe scheme'})` : JSON.stringify(r)}</span>
      ))}
      <div className="hint">Inline styles, scripts, iframes and unknown attributes never survive ingest — see the HTML rules below.</div>
    </div>
  );
}

export default function HtmlEditor({ bodyHtmlRaw, pageCss, readOnly, report, orphans }) {
  const [html, setHtml] = useState(bodyHtmlRaw || '');
  const [css, setCss] = useState(pageCss || '');
  const [loaded, setLoaded] = useState('');

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    setHtml(text);
    setLoaded(`Loaded ${file.name} (${text.length} characters) — save to ingest.`);
  }

  return (
    <fieldset className="item">
      <legend>HTML &amp; page CSS</legend>
      {!readOnly && (
        <div>
          <label htmlFor="html-file">Upload an .html file (fills the editor below)</label>
          <input type="file" id="html-file" accept=".html,.htm,text/html" onChange={onFile} />
          {loaded && <div className="notice">{loaded}</div>}
        </div>
      )}
      <label htmlFor="bodyHtmlRaw">Body HTML (a fragment — no &lt;html&gt;/&lt;head&gt;; a full document is trimmed to its body)</label>
      <textarea id="bodyHtmlRaw" name="bodyHtmlRaw" className="code" rows={22} value={html} disabled={readOnly}
        onChange={(e) => setHtml(e.target.value)} spellCheck={false} />
      <div className="hint">
        Allowed: structural/text tags, lists, tables, images (alt required), links, details/summary, decorative inline SVG.
        Stripped: script, style, iframe, forms, inline style attributes, event handlers, javascript:/data: URLs.
        Tokens: <code>{'{{coverage:alpr}}'}</code> renders a coverage strip from the collection; <code>{'{{video:YOUTUBE_ID}}'}</code> embeds a video.
      </div>

      <label htmlFor="pageCss">Page CSS (published as a fingerprinted stylesheet for this page only)</label>
      <textarea id="pageCss" name="pageCss" className="code" rows={12} value={css} disabled={readOnly}
        onChange={(e) => setCss(e.target.value)} spellCheck={false} />

      {report && (
        <div className="ingest-report">
          <h3>Ingest report (last save)</h3>
          <Removed removed={report.removed} />
          {report.a11y?.length > 0 && (
            <div className="error">
              <strong>Accessibility gate — blocks publishing:</strong>
              <ul>{report.a11y.map((a, i) => <li key={i}>{a.message} <span className="hint">({a.rule}{a.nid ? `, element ${a.nid}` : ''})</span></li>)}</ul>
            </div>
          )}
          {report.foreignClasses?.length > 0 && (
            <div className="notice">
              <strong>{report.foreignClasses.length} class{report.foreignClasses.length === 1 ? '' : 'es'} removed that aren’t in your stylesheet:</strong>{' '}
              {[...new Set(report.foreignClasses.map(f => f.className || f.class || f))].join(', ')}
              <div className="hint">Map them once on the Styles page and the same substitution happens on every future paste.</div>
            </div>
          )}
          {report.warnings?.length > 0 && <div className="notice">{report.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
          {report.match && (
            <div className="hint">Re-paste match: {report.match.matched ?? 0} elements matched, {report.match.added ?? report.match.new ?? 0} new, {report.match.removed ?? 0} removed.</div>
          )}
          {orphans?.length > 0 && (
            <div className="notice">{orphans.length} per-element style override{orphans.length === 1 ? '' : 's'} no longer match an element after the last re-paste (orphaned). They are kept but have no effect.</div>
          )}
          {!report.removed?.length && !report.a11y?.length && !report.foreignClasses?.length && !report.warnings?.length && (
            <div className="ok">Clean: nothing removed, no accessibility issues, no foreign classes.</div>
          )}
        </div>
      )}
    </fieldset>
  );
}
