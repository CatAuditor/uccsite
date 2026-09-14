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
// Zero-dependency by design; the tokenizer below is string- and comment-aware
// (a '}' inside content:"..." or a comment must not close a block) and skips
// block-less at-statements (@import/@charset/...;) so they can't swallow the
// following rule.

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

// Advance past a quoted string starting at css[i] (i points at the quote).
// Returns the index just after the closing quote.
function skipString(css, i) {
  const quote = css[i];
  for (i++; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === quote) return i + 1;
  }
  return i;
}

// Find the matching '}' for the '{' at `open`, ignoring braces inside quoted
// strings and comments.
function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") { i = skipString(css, i) - 1; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return css.length;
}

// Tokenize top-level: comments, block-less at-statements, and rule blocks.
// Nested blocks (@media/@supports) recurse so their rules are captured too.
function* rules(css) {
  let i = 0;
  let pendingComment = null;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;

    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const comment = css.slice(i + 2, end === -1 ? css.length : end);
      // Several @class comments may stack before one rule that names several
      // classes (".a, .b { … }") — keep them all.
      if (comment.includes('@class')) pendingComment = (pendingComment ? pendingComment + '\n' : '') + comment;
      i = end === -1 ? css.length : end + 2;
      continue;
    }

    // Block-less at-statement (@import url(x); @charset "utf-8"; @layer a,b;)
    // — consume through its ';' so it can't swallow the next rule's selector.
    if (css[i] === '@') {
      let j = i;
      while (j < css.length && css[j] !== ';' && css[j] !== '{') {
        if (css[j] === '"' || css[j] === "'") j = skipString(css, j) - 1;
        j++;
      }
      if (j >= css.length || css[j] === ';') { i = j + 1; continue; }
      // at-rule WITH a block falls through to the selector path below
    }

    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const selector = css.slice(i, brace).trim();
    const close = matchBrace(css, brace);
    const body = css.slice(brace + 1, close);
    if (selector.startsWith('@media') || selector.startsWith('@supports') || selector.startsWith('@layer')) {
      yield* rules(body);
    } else if (selector && !selector.startsWith('@')) {
      yield { selector, declarations: body.replace(/\s+/g, ' ').trim(), annotation: pendingComment };
      pendingComment = null;
    }
    i = close + 1;
  }
}

const CLASS_IN_SELECTOR = /\.([A-Za-z0-9_-]+)/g;

// parseStyleKit(cssText) → { entries: StyleKitEntry[], undocumented: string[] }
function parseStyleKit(cssText) {
  const byClass = new Map();     // className -> entry (declarations as array here)
  const seenBodies = new Map();  // className -> Set of exact rule bodies (dedupe)
  const documented = new Set();
  for (const rule of rules(cssText)) {
    // One annotation block per @class comment stacked before the rule.
    const anns = rule.annotation
      ? rule.annotation.split(/(?=@class\s)/).map(parseAnnotation).filter(Boolean)
      : [];
    const classes = [...rule.selector.matchAll(CLASS_IN_SELECTOR)].map((m) => m[1]);
    for (const className of new Set(classes)) {
      const annotated = anns.find((a) => a.className === className) || null;
      if (annotated) documented.add(className);
      let entry = byClass.get(className);
      if (!entry) {
        entry = {
          className,
          label: className,
          applies: [],
          description: '',
          group: undefined,
          declarations: [],
        };
        byClass.set(className, entry);
        seenBodies.set(className, new Set());
      }
      if (annotated) {
        entry.label = annotated.label || className;
        entry.applies = annotated.applies;
        entry.description = annotated.description;
        entry.group = annotated.group;
      }
      // Later rules on the same class append declarations (cascade order matters);
      // exact-duplicate bodies collapse.
      if (!seenBodies.get(className).has(rule.declarations)) {
        seenBodies.get(className).add(rule.declarations);
        entry.declarations.push(rule.declarations);
      }
    }
  }
  const entries = [...byClass.values()].map((e) => ({
    ...e,
    declarations: e.declarations.join(' /* + */ '),
  }));
  return {
    entries,
    undocumented: entries.filter((e) => !documented.has(e.className)).map((e) => e.className),
  };
}

function classNames(kit) {
  return new Set(kit.entries.map((e) => e.className));
}

module.exports = { parseStyleKit, classNames };
