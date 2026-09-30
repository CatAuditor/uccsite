// Minimal markdown → HTML for the Development notes tab (docs/dev-notes.md).
// Escape FIRST, then a small fixed set of constructs — the output is rendered
// with dangerouslySetInnerHTML, so nothing from the source may survive as
// markup. Supported: #/##/### headings, "- " bullets, "---" rules, paragraphs,
// **bold**, `code`, [text](http(s) or /path) links. Tested in
// test/mini-markdown.test.mjs.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, (m, text, href) =>
      `<a href="${href}"${href.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${text}</a>`);
}

export function renderMarkdown(src) {
  const out = [];
  let para = [];
  let list = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list.length) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = []; }
  };
  for (const raw of String(src || '').split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^---+$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } list.push(li[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list.length && /^\s{2,}\S/.test(raw)) { list[list.length - 1] += ` ${line.trim()}`; continue; }
    if (list.length) flush();
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}
