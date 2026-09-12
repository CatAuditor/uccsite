'use strict';
// Style Kit (build-spec-aws.md §6.1): parse a stylesheet into a catalog of
// classes the Document editor can offer. Two sources merge:
//   1. Structured annotations —
//        /* @class lead
//           @label Lead paragraph
//           @applies p
//           @group Typography
//           @desc Larger intro paragraph. */
//      immediately documenting a class.
//   2. Every class selector found in the sheet — unannotated ones get their
//      class name as the label so the vocabulary is complete from day one.
// Zero-dependency: styles.css is conventional flat CSS; a tokenizer that
// understands comments, selectors, and {...} blocks is sufficient and keeps
// this package pure.

// type StyleKitEntry = { className, label, applies: string[], description,
//                        group?, declarations }

function parseAnnotation(comment) {
  const m = comment.match(/@class\s+([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const get = (tag) => {
    const mm = comment.match(new RegExp(`@${tag}\\s+([^@*]+)`));
    return mm ? mm[1].replace(/\s+/g, ' ').trim() : undefined;
  };
  return {
    className: m[1],
    label: get('label'),
    applies: (get('applies') || '').split(/[\s,]+/).filter(Boolean),
    description: get('desc') || '',
    group: get('group'),
  };
}

// Tokenize top-level: comments and rule blocks (selector + declarations).
// Nested blocks (@media) recurse so their rules are captured too.
function* rules(css) {
  let i = 0;
  let pendingComment = null;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const comment = css.slice(i + 2, end === -1 ? css.length : end);
      if (comment.includes('@class')) pendingComment = comment;
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const selector = css.slice(i, brace).trim();
    const close = matchBrace(css, brace);
    const body = css.slice(brace + 1, close);
    if (selector.startsWith('@media') || selector.startsWith('@supports')) {
      yield* rules(body);
    } else if (selector && !selector.startsWith('@')) {
      yield { selector, declarations: body.replace(/\s+/g, ' ').trim(), annotation: pendingComment };
      pendingComment = null;
    }
    i = close + 1;
  }
}

function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return css.length;
}

const CLASS_IN_SELECTOR = /\.([A-Za-z0-9_-]+)/g;

// parseStyleKit(cssText) → { entries: StyleKitEntry[], undocumented: string[] }
function parseStyleKit(cssText) {
  const byClass = new Map();
  for (const rule of rules(cssText)) {
    const ann = rule.annotation ? parseAnnotation(rule.annotation) : null;
    const classes = [...rule.selector.matchAll(CLASS_IN_SELECTOR)].map((m) => m[1]);
    for (const className of new Set(classes)) {
      const existing = byClass.get(className);
      if (existing) {
        // Later rules on the same class append declarations (cascade order matters).
        if (!existing.declarations.includes(rule.declarations)) {
          existing.declarations += ` /* + */ ${rule.declarations}`;
        }
        continue;
      }
      const annotated = ann && ann.className === className ? ann : null;
      byClass.set(className, {
        className,
        label: annotated?.label || className,
        applies: annotated?.applies || [],
        description: annotated?.description || '',
        group: annotated?.group,
        declarations: rule.declarations,
        annotated: !!annotated,
      });
    }
  }
  const entries = [...byClass.values()];
  return {
    entries,
    undocumented: entries.filter((e) => !e.annotated).map((e) => e.className),
  };
}

function classNames(kit) {
  return new Set(kit.entries.map((e) => e.className));
}

module.exports = { parseStyleKit, classNames };
