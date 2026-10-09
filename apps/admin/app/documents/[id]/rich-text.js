'use client';
// Small rich-text editor for block fields (docs/systems/document-builder.md
// "Editor"): a contenteditable box with a short toolbar. `multi` allows
// paragraphs, sub-headings and lists (the Text block); without it the field
// is one paragraph of inline text (summary, captions, descriptions). The
// HTML it emits is cleaned here (strong/em/a/br, p/h3/h4/ul/ol/li only; no
// style, class or span) and sanitised again by the ingest on save.
import { useEffect, useRef, useState } from 'react';

const INLINE_OK = new Set(['STRONG', 'EM', 'A', 'BR', 'CODE', 'SUB', 'SUP']);
const BLOCK_OK = new Set(['P', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR']);
const RENAME = { B: 'strong', I: 'em', DIV: 'p', H1: 'h3', H2: 'h3', H5: 'h4', H6: 'h4' };

// clean(html, multi) → tidy HTML string.
export function cleanHtml(html, multi) {
  if (typeof window === 'undefined') return String(html || '');
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const out = (node) => {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { s += n.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, ' '); continue; }
      if (n.nodeType !== 1) continue;
      let tag = (RENAME[n.tagName] || n.tagName).toUpperCase();
      const inner = out(n);
      if (tag === 'BR') { s += '<br>'; continue; }
      if (INLINE_OK.has(tag)) {
        if (tag === 'A') {
          const href = (n.getAttribute('href') || '').trim();
          if (!href || /^\s*javascript:/i.test(href)) { s += inner; continue; }
          const ext = /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?utahciviccompact\.org/i.test(href);
          s += `<a href="${href.replace(/"/g, '&quot;')}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
        } else s += `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
        continue;
      }
      if (BLOCK_OK.has(tag)) {
        if (!multi) { s += (s && !/(<br>|\s)$/.test(s) ? ' ' : '') + inner; continue; }
        if (!inner.trim() || inner === '<br>') continue; // empty paragraph
        s += `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>\n`;
        continue;
      }
      s += inner; // span, font, unknown: unwrap
    }
    return s;
  };
  let result = out(doc.body).trim();
  if (multi && result && !/^<(p|h3|h4|ul|ol|blockquote|hr)\b/i.test(result)) result = `<p>${result}</p>`;
  return result;
}

export default function RichText({ value, onChange, multi = false, placeholder = '', disabled = false, rows }) {
  const ref = useRef(null);
  const lastEmitted = useRef(null);
  const [focused, setFocused] = useState(false);

  // Only write into the box when the value changed from outside (not from our own typing),
  // or the caret would jump on every keystroke.
  useEffect(() => {
    if (!ref.current) return;
    if (value === lastEmitted.current) return;
    ref.current.innerHTML = value || '';
    lastEmitted.current = value;
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const html = cleanHtml(ref.current.innerHTML, multi);
    lastEmitted.current = html;
    onChange(html);
  };
  const cmd = (name, arg) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };
  const link = () => {
    const sel = window.getSelection();
    const existing = sel?.anchorNode?.parentElement?.closest('a');
    const url = window.prompt('Link to (URL or /path):', existing?.getAttribute('href') || 'https://');
    if (url === null) return;
    if (!url.trim()) { cmd('unlink'); return; }
    cmd('createLink', url.trim());
  };
  const onPaste = (e) => {
    // plain text paste; the writer formats with the toolbar
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };
  const onKey = (e) => {
    if (!multi && e.key === 'Enter') { e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); link(); }
  };

  return (
    <div className={`rt${multi ? ' rt-multi' : ''}${focused ? ' rt-focus' : ''}`}>
      {!disabled && (
        <div className="rt-bar" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" title="Bold (Ctrl+B)" onClick={() => cmd('bold')}><strong>B</strong></button>
          <button type="button" title="Italic (Ctrl+I)" onClick={() => cmd('italic')}><em>I</em></button>
          <button type="button" title="Link (Ctrl+K)" onClick={link}>Link</button>
          {multi && (
            <>
              <span className="rt-sep" />
              <button type="button" title="Paragraph" onClick={() => cmd('formatBlock', 'p')}>¶</button>
              <button type="button" title="Sub-heading" onClick={() => cmd('formatBlock', 'h3')}>H3</button>
              <button type="button" title="Minor heading" onClick={() => cmd('formatBlock', 'h4')}>H4</button>
              <button type="button" title="Bulleted list" onClick={() => cmd('insertUnorderedList')}>• List</button>
              <button type="button" title="Numbered list" onClick={() => cmd('insertOrderedList')}>1. List</button>
            </>
          )}
          <span className="rt-sep" />
          <button type="button" title="Clear formatting" onClick={() => cmd('removeFormat')}>Clear</button>
        </div>
      )}
      <div
        ref={ref}
        className="rt-box"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={rows ? { minHeight: `${rows * 1.6}em` } : undefined}
        onInput={emit}
        onBlur={() => { setFocused(false); emit(); }}
        onFocus={() => setFocused(true)}
        onPaste={onPaste}
        onKeyDown={onKey}
      />
    </div>
  );
}
