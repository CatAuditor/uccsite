// Legacy → builder conversion helpers (docs/systems/document-builder.md
// "Legacy conversion"). A converted page keeps its own frame wrappers
// (header.frame) and section wrappers, so its page CSS applies unchanged;
// the only rewrite is a class alias when a legacy class name means a
// DIFFERENT thing site-wide (alpr's grey finding-box is the site's
// violation-box): the alias is applied to the HTML before parsing and to the
// page CSS selectors. Pure string work; the conversion script and the admin's
// "Convert to blocks" action both use it.

// rewritePageCss(css, { classAliases }) → css with aliased classes renamed
// in selectors. Declarations are left alone. No aliases → unchanged.
function rewritePageCss(css, { classAliases = {} } = {}) {
  const entries = Object.entries(classAliases);
  if (!entries.length) return String(css || '');
  return String(css || '').replace(/([^{}]+)\{/g, (m, sel) => {
    let s = sel;
    for (const [from, to] of entries) s = s.replace(new RegExp(`\\.${from}\\b`, 'g'), `.${to}`);
    return `${s}{`;
  });
}

// aliasClasses(html, classAliases) → html with class names renamed in class
// attributes only (used before parse() when a legacy page's class means
// something else site-wide: alpr's grey finding-box is the site's violation-box).
function aliasClasses(html, classAliases = {}) {
  if (!Object.keys(classAliases).length) return String(html || '');
  return String(html || '').replace(/class="([^"]*)"/g, (m, cls) =>
    `class="${cls.split(/\s+/).map(c => classAliases[c] || c).join(' ')}"`);
}

export { rewritePageCss, aliasClasses };
