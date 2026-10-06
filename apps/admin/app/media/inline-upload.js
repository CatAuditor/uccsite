'use client';
// Inline image upload for any image field (docs/systems/media.md "Inline
// upload"). Same pipeline as the Media Library page — presigned PUT straight
// to S3, the media-process Lambda makes the variants — but the editor never
// leaves the form: alt text is asked FIRST (the placement gate), the widget
// polls until the asset is ready, then hands the variant path to the field
// via onDone(path, { alt, id }). Nothing here is authorization; every server
// action re-checks the role.
import { useEffect, useRef, useState } from 'react';
import { beginUpload, finishUpload, assetReady } from './actions';

const POLL_MS = 2000;
const POLL_LIMIT = 45; // 90 s — the Lambda normally takes 2-10 s

export default function InlineImageUpload({ targetWidth = 800, accept, maxBytes, onDone, label = 'Upload a new image', compact = false, disabled = false }) {
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    const altText = alt.trim();
    if (!altText) { setError('Describe the image first (alt text) — it is required before an image can be placed.'); return; }
    if (maxBytes && file.size > maxBytes) { setError(`${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`); return; }
    try {
      setBusy(`Uploading ${file.name}…`);
      const begun = await beginUpload({ filename: file.name, mime: file.type, bytes: file.size });
      if (begun.error) throw new Error(begun.error);
      const res = await fetch(begun.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!res.ok) throw new Error(`S3 rejected the upload (${res.status})`);
      const done = await finishUpload(begun.id, altText);
      if (done.error) throw new Error(done.error);
      setBusy('Processing…');
      for (let i = 0; i < POLL_LIMIT; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (cancelled.current) return;
        const state = await assetReady(begun.id, targetWidth);
        if (state.error) throw new Error(state.error);
        if (state.status === 'ready' && state.path) {
          setBusy('');
          setAlt('');
          onDone(state.path, { alt: altText, id: begun.id, width: state.width });
          return;
        }
        if (state.status === 'failed') throw new Error(state.message || 'The image could not be processed');
      }
      throw new Error('Still processing after 90 s — find it on the Media Library page once it is ready.');
    } catch (err) {
      console.error('[media] inline upload failed', err);
      setBusy('');
      setError(err.message || String(err));
    }
  }

  return (
    <div className={`inline-upload${compact ? ' compact' : ''}`}>
      <input type="text" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Alt text: what the image shows (required)" maxLength={300} disabled={disabled || Boolean(busy)} aria-label="Alt text for the new image" />
      <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={disabled || Boolean(busy)}>{busy || label}</button>
      <input ref={fileRef} type="file" accept={accept || 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff'} onChange={onFile} hidden />
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
