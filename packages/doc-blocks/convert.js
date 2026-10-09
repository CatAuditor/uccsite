// Legacy → builder conversion helpers (docs/systems/document-builder.md
// "Legacy conversion"). A migrated report's page CSS targets its own
// wrappers (.paper-inner, .briefing-body …); the serializer writes
// .doc-body > .doc-inner instead, so the page CSS is rewritten to keep
// styling the same elements. Pure string work; the conversion script and the
// admin's "Convert to blocks" action both use it.

// Wrapper selectors → the frame the serializer writes.
const WRAPPER_MAP = [
  [/\.(paper-inner|briefing-inner|report-section|theory-section|privacy-inner|page)\b/g, '.doc-inner'],
  [/\.(paper-body|briefing-body|report-body|theory-body|privacy-body)\b/g, '.doc-body'],
  // .container only ever wrapped the column in these pages
  [/\.container\b/g, '.doc-inner'],
];

// rewritePageCss(css, { classAliases }) → css with the wrapper selectors
// renamed and any aliased classes (finding-box → violation-box) renamed too.
// Only selector text changes; declarations are left alone.
function rewritePageCss(css, { classAliases = {} } = {}) {
  let out = String(css || '');
  // selectors are everything before a "{" that is not inside a declaration block
  out = out.replace(/([^{}]+)\{/g, (m, sel) => {
    let s = sel;
    for (const [re, to] of WRAPPER_MAP) s = s.replace(re, to);
    for (const [from, to] of Object.entries(classAliases)) s = s.replace(new RegExp(`\\.${from}\\b`, 'g'), `.${to}`);
    // bare element rules the migration wrote unscoped now live under the frame
    s = s.replace(/(^|,)\s*(details|summary|blockquote)\b/g, (mm, sep, el) => `${sep} .doc-inner ${el}`);
    return `${s}{`;
  });
  // the serializer's wrappers already collapse duplicates like ".doc-inner .doc-inner"
  out = out.replace(/\.doc-inner\s+\.doc-inner\b/g, '.doc-inner').replace(/\.doc-body\s+\.doc-inner\s+\.doc-inner\b/g, '.doc-body .doc-inner');
  return out;
}

// aliasClasses(html, classAliases) → html with class names renamed in class
// attributes only (used before parse() when a legacy page's class means
// something else site-wide: alpr's grey finding-box is the site's violation-box).
function aliasClasses(html, classAliases = {}) {
  if (!Object.keys(classAliases).length) return String(html || '');
  return String(html || '').replace(/class="([^"]*)"/g, (m, cls) =>
    `class="${cls.split(/\s+/).map(c => classAliases[c] || c).join(' ')}"`);
}

export { rewritePageCss, aliasClasses, WRAPPER_MAP };
