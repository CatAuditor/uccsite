'use client';
// New/edit template or page rule (spec §6.2) with a match-count preview
// before saving. Selector subset is validated server-side (previewRule /
// saveRule); the count comes from css-select over every affected document.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { previewRule, saveRule } from '../documents/actions';

export default function RuleForm({ templateKeys, documents, kit }) {
  const router = useRouter();
  const [rule, setRule] = useState({ scope: 'template', templateKey: templateKeys[0], documentId: documents[0]?.id || '', selector: '', classes: '', priority: 10, note: '' });
  const [count, setCount] = useState(null);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const set = (k, v) => { setRule({ ...rule, [k]: v }); setCount(null); };

  const preview = () => start(async () => {
    const r = await previewRule(rule);
    setCount(r.error ? { error: r.error } : r);
  });
  const save = () => start(async () => {
    const r = await saveRule({ ...rule, classes: rule.classes.split(/\s+/).filter(Boolean) });
    setMessage(r.error ? `Error: ${r.error}` : r.message);
    if (!r.error) { setRule({ ...rule, selector: '', classes: '', note: '' }); setCount(null); router.refresh(); }
  });

  return (
    <div className="editor rule-form">
      <h3>Add a rule</h3>
      {message && <div className={message.startsWith('Error') ? 'error' : 'ok'}>{message}</div>}
      <div className="doc-grid">
        <div>
          <label htmlFor="rule-scope">Scope</label>
          <select id="rule-scope" value={rule.scope} onChange={(e) => set('scope', e.target.value)}>
            <option value="template">template (every document using it)</option>
            <option value="page">page (one document)</option>
          </select>
        </div>
        {rule.scope === 'template' ? (
          <div>
            <label htmlFor="rule-template">Template</label>
            <select id="rule-template" value={rule.templateKey} onChange={(e) => set('templateKey', e.target.value)}>
              {templateKeys.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor="rule-doc">Document</label>
            <select id="rule-doc" value={rule.documentId} onChange={(e) => set('documentId', e.target.value)}>
              {documents.map(d => <option key={d.id} value={d.id}>{d.slug}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="rule-priority">Priority (lower applies first)</label>
          <input type="text" id="rule-priority" value={rule.priority} onChange={(e) => set('priority', e.target.value)} />
        </div>
      </div>
      <label htmlFor="rule-selector">Selector</label>
      <input type="text" id="rule-selector" value={rule.selector} placeholder="e.g. main > p:first-of-type" onChange={(e) => set('selector', e.target.value)} />
      <div className="hint">Supported: tag, .class, descendant, &gt;, :first-of-type, :last-of-type, :nth-of-type(), :not(tag|.class).</div>
      <label htmlFor="rule-classes">Classes (space-separated, must exist in the Style Kit)</label>
      <input type="text" id="rule-classes" value={rule.classes} list="kit-classes-rule" onChange={(e) => set('classes', e.target.value)} />
      <datalist id="kit-classes-rule">{kit.map(c => <option key={c} value={c} />)}</datalist>
      <label htmlFor="rule-note">Note</label>
      <input type="text" id="rule-note" value={rule.note} onChange={(e) => set('note', e.target.value)} />
      <div className="picker-tools">
        <button type="button" onClick={preview} disabled={pending || !rule.selector}>Count matches</button>
        {count && (count.error ? <span className="error">{count.error}</span>
          : <span className="hint">{count.total} element{count.total === 1 ? '' : 's'}: {count.perDocument.map(d => `${d.slug} (${d.count})`).join(', ') || 'no documents'}</span>)}
        <button type="button" onClick={save} disabled={pending || !count || count.error}>Save rule</button>
      </div>
    </div>
  );
}
