// Styles (spec §6): template rules with match counts across the documents
// they apply to, the foreign-class map (§5.5), and the Style Kit catalog
// parsed from the live stylesheet (§6.1) with the "N undocumented" nudge.
import { listStyleRules, listForeignClassMap, listDocuments, TEMPLATE_KEYS } from '@uccsite/db/documents';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { loadSiteSources, styleKitFor, ruleMatchCounts, parsedDocuments } from '../../lib/documents';
import { rootedTree } from '@uccsite/style-apply';
import ActionForm from '../action-form';
import RuleForm from './rule-form';
import { removeRule, mapForeignClass, unmapForeignClass } from '../documents/actions';

export const dynamic = 'force-dynamic';

export default async function StylesPage() {
  const session = await requireSession();
  const readOnly = session.role === 'viewer';
  const { rules, map, docs, counts } = await withDb(async (client) => {
    const rules = await listStyleRules(client);
    const docs = await listDocuments(client);
    // Parse every document once; each rule counts against the parsed trees.
    const parsed = docs.map(d => ({ id: d.id, slug: d.slug, templateKey: d.templateKey, rooted: d.bodyHtmlNormalized ? rootedTree(d.bodyHtmlNormalized) : null }));
    const counts = {};
    for (const r of rules) counts[r.id] = await ruleMatchCounts(client, r, parsed);
    return { rules, map: await listForeignClassMap(client), docs, counts };
  });
  const sources = await loadSiteSources();
  const kit = styleKitFor(sources.siteCss, '');
  const docTitle = (id) => docs.find(d => d.id === id)?.slug || id;
  // Foreign classes currently reported by any document, for the mapping form.
  const reported = [...new Set(docs.flatMap(d => (d.ingestReport?.foreignClasses || []).map(f => f.className || f.class || f)))]
    .filter(c => !map.some(m => m.fromClass === c));

  return (
    <div>
      <h1>Styles</h1>
      <p className="notice">
        Template rules style every document on arrival (“main &gt; h1 → .report-title” — selectors run against the page’s
        &lt;main&gt;, so “main &gt; p:first-of-type” is the first top-level paragraph). Style one document by hand,
        promote the patterns to rules from its editor, and the next paste lands mostly styled.
      </p>

      <h2>Rules</h2>
      <table>
        <thead><tr><th>Scope</th><th>Selector</th><th>Classes</th><th>Priority</th><th>Matches</th><th>Note</th><th></th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.scope === 'page' ? `page: ${docTitle(r.documentId)}` : `template: ${r.templateKey}`}</td>
              <td><code>{r.selector}</code></td>
              <td>{r.classes.join(' ')}</td>
              <td>{r.priority}</td>
              <td title={counts[r.id]?.perDocument?.map(d => `${d.slug}: ${d.count}`).join('\n')}>{counts[r.id]?.error ? 'invalid' : counts[r.id]?.total}</td>
              <td>{r.note}</td>
              <td>
                {!readOnly && (
                  <ActionForm action={removeRule}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="danger">Delete</button>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
          {!rules.length && <tr><td colSpan="7">No rules yet. Style a document, then “Promote to template rule”, or add one below.</td></tr>}
        </tbody>
      </table>
      {!readOnly && <RuleForm templateKeys={TEMPLATE_KEYS} documents={docs.map(d => ({ id: d.id, slug: d.slug }))} kit={kit.entries.map(e => e.className)} />}

      <h2>Foreign class map</h2>
      <p className="hint">Classes in pasted HTML that aren’t in the stylesheet are stripped and reported. Map them here once and the substitution happens on every future save (blank target = drop silently).</p>
      <table>
        <thead><tr><th>From</th><th>To</th><th>Template</th><th></th></tr></thead>
        <tbody>
          {map.map((m) => (
            <tr key={m.id}>
              <td><code>{m.fromClass}</code></td>
              <td>{m.toClass ? <code>{m.toClass}</code> : <em>drop</em>}</td>
              <td>{m.templateKey || 'all'}</td>
              <td>{!readOnly && (
                <ActionForm action={unmapForeignClass}><input type="hidden" name="id" value={m.id} /><button type="submit" className="danger">Remove</button></ActionForm>
              )}</td>
            </tr>
          ))}
          {!map.length && <tr><td colSpan="4">No mappings.</td></tr>}
        </tbody>
      </table>
      {!readOnly && (
        <ActionForm className="editor" action={mapForeignClass}>
          <label htmlFor="fromClass">Foreign class</label>
          <input type="text" id="fromClass" name="fromClass" list="reported-classes" required />
          <datalist id="reported-classes">{reported.map(c => <option key={c} value={c} />)}</datalist>
          {reported.length > 0 && <div className="hint">Currently reported and unmapped: {reported.join(', ')}</div>}
          <label htmlFor="toClass">Maps to (Style Kit class; blank = drop)</label>
          <input type="text" id="toClass" name="toClass" list="kit-classes" />
          <datalist id="kit-classes">{kit.entries.map(e => <option key={e.className} value={e.className} />)}</datalist>
          <label htmlFor="templateKey">Template (blank = all)</label>
          <input type="text" id="templateKey" name="templateKey" list="template-keys" />
          <datalist id="template-keys">{TEMPLATE_KEYS.map(t => <option key={t} value={t} />)}</datalist>
          <button type="submit">Save mapping</button>
        </ActionForm>
      )}

      <h2>Style Kit <span className="hint">{kit.entries.length} classes · {kit.undocumented.length} undocumented</span></h2>
      <p className="hint">Parsed from the live <code>css/styles.css</code>. Document a class with a <code>/* @class name @label … @applies p @group … @desc … */</code> comment above its rule — a developer task, once per stylesheet.</p>
      <table>
        <thead><tr><th>Class</th><th>Label</th><th>Applies to</th><th>Group</th><th>Declarations</th></tr></thead>
        <tbody>
          {kit.entries.map(e => (
            <tr key={e.className}>
              <td><code>.{e.className}</code></td>
              <td>{e.label !== e.className ? e.label : <em className="hint">undocumented</em>}</td>
              <td>{e.applies?.join(', ') || 'any'}</td>
              <td>{e.group}</td>
              <td className="hint" title={e.declarations}>{(e.declarations || '').slice(0, 80)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
