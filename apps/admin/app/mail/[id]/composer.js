'use client';
// The newsletter composer: a block editor on the left, a phone-sized
// preview on the right rendered by the SAME renderer the sender uses
// (@uccsite/newsletter/render — pure, so it runs in the browser). Light /
// dark and phone / desktop toggles only change how the preview is shown;
// the sent email carries both colour schemes. Blocks and theme travel to the
// server as JSON hidden fields inside the surrounding ActionForm.
import { useMemo, useState } from 'react';
import { previewHtml, BLOCK_TYPES, DEFAULT_THEME, FONTS } from '@uccsite/newsletter/render';
import InlineImageUpload from '../../media/inline-upload';
import { importUpload } from './actions';

const RESIDENCIES = [['all', 'everyone'], ['utah', 'Utah residents'], ['outside', 'outside Utah'], ['unknown', 'ZIP unknown']];
const BLOCK_LABEL = { heading: 'Heading', text: 'Text', button: 'Button', image: 'Image', quote: 'Quote', divider: 'Divider' };
const NEW_BLOCK = {
  heading: { type: 'heading', text: '' }, text: { type: 'text', markdown: '' }, button: { type: 'button', label: '', url: '', align: 'center' },
  image: { type: 'image', url: '', alt: '', link: '', caption: '' }, quote: { type: 'quote', text: '', cite: '' }, divider: { type: 'divider' },
};
let seq = 0;
const withKey = (b) => ({ ...b, _k: b._k ?? `b${++seq}` });

function BlockFields({ block, onChange, readOnly, publicOrigin }) {
  const set = (field) => (e) => onChange({ ...block, [field]: e.target.value });
  switch (block.type) {
    case 'heading': return <input value={block.text} onChange={set('text')} placeholder="Section heading" maxLength={300} disabled={readOnly} />;
    case 'text': return (
      <>
        <textarea value={block.markdown} onChange={set('markdown')} rows={6} disabled={readOnly}
          placeholder={'Paragraphs separated by a blank line.\n**bold**, *italic*, [link text](https://…)\n- bullet\n## small heading'} />
        <div className="hint">Blank line = new paragraph · **bold** · *italic* · [text](https://…) · &quot;- &quot; bullets · &quot;## &quot; small heading</div>
      </>
    );
    case 'button': return (
      <div className="mail-row">
        <input value={block.label} onChange={set('label')} placeholder="Button label" maxLength={120} disabled={readOnly} />
        <input value={block.url} onChange={set('url')} placeholder="https://utahciviccompact.org/…" type="url" disabled={readOnly} />
        <select value={block.align} onChange={set('align')} disabled={readOnly}><option value="center">centered</option><option value="left">left</option></select>
      </div>
    );
    case 'image': return (
      <>
        {!readOnly && (
          <InlineImageUpload targetWidth={1200} compact label="Upload an image"
            onDone={(path, { alt }) => onChange({ ...block, url: `${publicOrigin}${path}`, alt: block.alt || alt })} />
        )}
        <div className="mail-row">
          <input value={block.url} onChange={set('url')} placeholder="Image address (upload above, or paste from the Media Library)" type="url" disabled={readOnly} />
          <input value={block.alt} onChange={set('alt')} placeholder="Alt text (what the image shows)" maxLength={300} disabled={readOnly} />
        </div>
        <div className="mail-row">
          <input value={block.link || ''} onChange={set('link')} placeholder="Link when clicked (optional)" type="url" disabled={readOnly} />
          <input value={block.caption || ''} onChange={set('caption')} placeholder="Caption (optional)" maxLength={300} disabled={readOnly} />
        </div>
      </>
    );
    case 'quote': return (
      <div className="mail-row">
        <textarea value={block.text} onChange={set('text')} rows={3} placeholder="Quoted words" disabled={readOnly} />
        <input value={block.cite || ''} onChange={set('cite')} placeholder="Who said it (optional)" maxLength={200} disabled={readOnly} />
      </div>
    );
    default: return <div className="hint">A thin rule between sections.</div>;
  }
}

export default function Composer({ newsletter, names, count, petitions, readOnly, publicOrigin }) {
  const [subject, setSubject] = useState(newsletter.subject);
  const [preheader, setPreheader] = useState(newsletter.preheader);
  const [headline, setHeadline] = useState(newsletter.headline);
  const [fromName, setFromName] = useState(newsletter.fromName);
  const [blocks, setBlocks] = useState(() => newsletter.blocks.filter((b) => b.type !== 'raw').map(withKey));
  // "Ignore all style — raw HTML": the email is the typed HTML plus an
  // unsubscribe link; the builder blocks are kept underneath but not sent.
  const savedRaw = newsletter.blocks.find((b) => b.type === 'raw');
  const [rawOn, setRawOn] = useState(Boolean(savedRaw));
  const [rawHtml, setRawHtml] = useState(savedRaw?.html || '');
  const [theme, setTheme] = useState({ ...DEFAULT_THEME, ...newsletter.theme });
  const [mode, setMode] = useState('light');
  const [width, setWidth] = useState('phone');
  const sent = useMemo(() => {
    const builder = blocks.map(({ _k, ...b }) => b);
    return rawOn ? [{ type: 'raw', html: rawHtml }, ...builder] : builder;
  }, [blocks, rawOn, rawHtml]);
  const html = useMemo(() => previewHtml({ subject, preheader, headline, blocks: sent, theme }, mode), [subject, preheader, headline, sent, theme, mode]);

  const update = (i, b) => setBlocks((list) => list.map((x, j) => (j === i ? { ...b, _k: x._k } : x)));
  const move = (i, d) => setBlocks((list) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return list; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = (i) => setBlocks((list) => list.filter((_, j) => j !== i));
  const add = (type) => setBlocks((list) => [...list, withKey({ ...NEW_BLOCK[type] })]);
  const setT = (field) => (e) => setTheme((t) => ({ ...t, [field]: e.target.value }));
  const fromOptions = names.includes(fromName) || !fromName ? names : [fromName, ...names];

  // Audience: the page's count is for the SAVED filters; "Apply filters"
  // counts the chosen ones (GET /mail/audience-count) without saving.
  const [audience, setAudience] = useState({
    residency: newsletter.audience.residency || 'all', petition: newsletter.audience.petition || '', donors: Boolean(newsletter.audience.donors),
  });
  const [live, setLive] = useState({ count, applied: false, busy: false, error: '' });
  const setA = (field) => (e) => { setAudience((a) => ({ ...a, [field]: field === 'donors' ? e.target.checked : e.target.value })); setLive((l) => ({ ...l, applied: false })); };
  async function applyFilters() {
    setLive((l) => ({ ...l, busy: true, error: '' }));
    try {
      const q = new URLSearchParams({ residency: audience.residency, petition: audience.petition, donors: audience.donors ? '1' : '' });
      const res = await fetch(`/mail/audience-count?${q}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.count !== 'number') throw new Error(body.error || `Count failed (${res.status})`);
      setLive({ count: body.count, applied: true, busy: false, error: '' });
    } catch (err) {
      setLive((l) => ({ ...l, busy: false, error: err.message || 'Could not count the audience' }));
    }
  }

  // Import a .docx / .md / .html file: converted on the server into blocks,
  // appended after the current ones; an h1 fills an empty headline.
  const [imported, setImported] = useState('');
  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImported(`Converting ${file.name}…`);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('existing', String(blocks.length));
    fd.append('headline', headline);
    const res = await importUpload(fd);
    if (res?.error) { setImported(`Could not import ${file.name}: ${res.error}`); return; }
    setBlocks((list) => [...list, ...res.blocks.map((b) => withKey({ ...b }))]);
    if (res.headline && res.headline !== headline) setHeadline(res.headline);
    setImported(`Added ${res.blocks.length} block${res.blocks.length === 1 ? '' : 's'} from ${file.name}${res.notes?.length ? ` — ${res.notes.join(' — ')}` : ''}. Check them in the preview, then save.`);
  }

  return (
    <div className="mail-split">
      <div className="mail-editor">
        <input type="hidden" name="blocks" value={JSON.stringify(sent)} />
        <input type="hidden" name="theme" value={JSON.stringify(theme)} />

        <fieldset className="item">
          <legend>Email</legend>
          <label htmlFor="subject">Subject line</label>
          <input id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required disabled={readOnly} />
          <label htmlFor="preheader">Preview text (the line inboxes show after the subject)</label>
          <input id="preheader" name="preheader" value={preheader} onChange={(e) => setPreheader(e.target.value)} maxLength={200} disabled={readOnly} />
          <label htmlFor="headline">Headline in the header band (optional)</label>
          <input id="headline" name="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={200} disabled={readOnly} />
          <label htmlFor="fromName">From</label>
          <select id="fromName" name="fromName" value={fromName} onChange={(e) => setFromName(e.target.value)} disabled={readOnly}>
            {fromOptions.map((n) => <option key={n} value={n}>{n} from Utah Civic Compact</option>)}
            <option value="">Utah Civic Compact (no name)</option>
          </select>
          <div className="hint">Always sent from hello@utahciviccompact.org; the name is what the inbox shows.</div>
        </fieldset>

        <fieldset className="item">
          <legend>Audience — {live.count} {live.count === 1 ? 'person' : 'people'} match {live.applied ? 'these filters' : 'the saved filters'}</legend>
          <div className="mail-row">
            <label>Residency
              <select name="residency" value={audience.residency} onChange={setA('residency')} disabled={readOnly}>
                {RESIDENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>Signed petition
              <select name="petition" value={audience.petition} onChange={setA('petition')} disabled={readOnly}>
                <option value="">any / none</option>
                {petitions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="mail-check"><input type="checkbox" name="donors" value="1" checked={audience.donors} onChange={setA('donors')} disabled={readOnly} /> donors only</label>
            {!readOnly && <button type="button" className="secondary" onClick={applyFilters} disabled={live.busy}>{live.busy ? 'Counting…' : 'Apply filters'}</button>}
          </div>
          {live.error && <div className="error" role="alert">{live.error}</div>}
          <div className="hint">Same rules as the Mailing list page. Apply filters shows how many people the chosen filters reach; saving keeps them.</div>
          <label className="mail-check"><input type="checkbox" name="publishToSite" value="1" defaultChecked={newsletter.publishToSite !== false} disabled={readOnly} /> Also publish a web copy at utahciviccompact.org/newsletters (adds a &ldquo;View in browser&rdquo; link)</label>
        </fieldset>

        <fieldset className="item">
          <legend>Content</legend>
          <label className="mail-check">
            <input type="checkbox" checked={rawOn} onChange={(e) => setRawOn(e.target.checked)} disabled={readOnly} />
            {' '}Ignore all style — raw HTML (sent exactly as typed; only an Unsubscribe link is added)
          </label>
          {rawOn && (
            <>
              <textarea value={rawHtml} onChange={(e) => setRawHtml(e.target.value)} rows={22} spellCheck={false} disabled={readOnly}
                className="mail-raw" placeholder={'<html>\n<body>\n  <p>Your email…</p>\n</body>\n</html>'} />
              <div className="hint">
                No header, footer, colours or web copy. The Unsubscribe link goes just before &lt;/body&gt; — or put
                {' '}<code>{'{{unsubscribe_url}}'}</code> in your own link to place it yourself. Include the org&rsquo;s postal
                address (required by CAN-SPAM). Use inline styles; Gmail drops most &lt;style&gt; rules. The blocks below are
                kept but not sent while this is ticked.
              </div>
            </>
          )}
          {!rawOn && blocks.map((b, i) => (
            <div key={b._k} className="mail-block">
              <div className="mail-block-head">
                <strong>{BLOCK_LABEL[b.type]}</strong>
                {!readOnly && (
                  <span className="mail-block-tools">
                    <button type="button" className="linkish" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" className="linkish" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down">↓</button>
                    <button type="button" className="linkish" onClick={() => remove(i)} aria-label="Remove block">✕</button>
                  </span>
                )}
              </div>
              <BlockFields block={b} onChange={(nb) => update(i, nb)} readOnly={readOnly} publicOrigin={publicOrigin} />
            </div>
          ))}
          {!rawOn && !blocks.length && <p className="hint">Nothing yet — add a block below.</p>}
          {!rawOn && !readOnly && (
            <div className="mail-add">
              Add: {BLOCK_TYPES.map((t) => <button key={t} type="button" className="secondary" onClick={() => add(t)}>{BLOCK_LABEL[t]}</button>)}
            </div>
          )}
          {!rawOn && !readOnly && (
            <div>
              <label htmlFor="mail-import">Or import a file (.docx from Word, Google Docs or Claude Docs; .md Markdown; .html) — its headings, paragraphs, lists, quotes, links and images become blocks after the ones above, in the email&rsquo;s own look</label>
              <input type="file" id="mail-import" accept=".docx,.md,.markdown,.txt,.html,.htm,text/markdown,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onImport} />
              {imported && <div className="notice">{imported}</div>}
            </div>
          )}
        </fieldset>

        <fieldset className="item" hidden={rawOn}>
          <legend>Look</legend>
          <div className="hint">The letterhead (logo and name, linking to the site) is always there. The defaults copy the live site: navy bands, red accent, the site&rsquo;s type.</div>
          <div className="mail-row">
            <label>Bands, headings &amp; buttons colour <input type="color" value={theme.accent} onChange={setT('accent')} disabled={readOnly} /></label>
            <label>Highlight colour <input type="color" value={theme.highlight} onChange={setT('highlight')} disabled={readOnly} /></label>
            <label>Font
              <select value={theme.font} onChange={setT('font')} disabled={readOnly}>
                {Object.keys(FONTS).map((f) => <option key={f} value={f}>{f === 'serif' ? 'Serif (Playfair / Georgia)' : 'Sans-serif (the site’s)'}</option>)}
              </select>
            </label>
            {!readOnly && <button type="button" className="secondary" onClick={() => setTheme({ ...DEFAULT_THEME })}>Reset to the site look</button>}
          </div>
          <label>Small line above the headline (optional)</label>
          <input value={theme.eyebrow} onChange={setT('eyebrow')} maxLength={80} placeholder="e.g. October update" disabled={readOnly} />
          <label>Footer (the unsubscribe link is always added after it)</label>
          <textarea value={theme.footer} onChange={setT('footer')} rows={2} maxLength={600} disabled={readOnly} />
        </fieldset>
      </div>

      <div className="mail-preview">
        <div className="mail-preview-tools">
          <span>Preview:</span>
          <button type="button" className={mode === 'light' ? 'on' : ''} onClick={() => setMode('light')}>Light</button>
          <button type="button" className={mode === 'dark' ? 'on' : ''} onClick={() => setMode('dark')}>Dark</button>
          <span className="sep" />
          <button type="button" className={width === 'phone' ? 'on' : ''} onClick={() => setWidth('phone')}>Phone</button>
          <button type="button" className={width === 'desktop' ? 'on' : ''} onClick={() => setWidth('desktop')}>Desktop</button>
        </div>
        <div className={`mail-device ${width} ${mode}`}>
          <div className="mail-device-bar"><span>{fromName ? `${fromName} from Utah Civic Compact` : 'Utah Civic Compact'}</span><strong>{subject || '(no subject)'}</strong><em>{preheader}</em></div>
          <iframe title="Email preview" sandbox="" srcDoc={html} />
        </div>
        <p className="hint">Dark mode here mimics Apple Mail / Outlook. Gmail ignores the email&rsquo;s own dark styles and recolours on its own; a test send shows the real thing.</p>
      </div>
    </div>
  );
}
