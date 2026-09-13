'use client';
// Upload widget: asks the server for a presigned PUT, sends the file straight
// to S3 from the browser, then tells the server it's done. The S3 event →
// media-process Lambda turns the pending row into a ready one; the page's
// Refresher polls until then.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { beginUpload, finishUpload } from './actions';

export default function Uploader({ accept, maxBytes }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function onChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    const errors = [];
    for (const file of files) {
      try {
        if (file.size > maxBytes) throw new Error(`${file.name}: larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
        setMessage(`Uploading ${file.name}…`);
        const begun = await beginUpload({ filename: file.name, mime: file.type, bytes: file.size });
        if (begun.error) throw new Error(`${file.name}: ${begun.error}`);
        const res = await fetch(begun.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        if (!res.ok) throw new Error(`${file.name}: S3 rejected the upload (${res.status})`);
        const done = await finishUpload(begun.id);
        if (done.error) throw new Error(`${file.name}: ${done.error}`);
      } catch (err) {
        console.error('[media] upload failed', err);
        errors.push(err.message || String(err));
      }
    }
    setBusy(false);
    setMessage(errors.length ? `Failed: ${errors.join('; ')}` : `Uploaded ${files.length} file(s) — processing.`);
    router.refresh();
  }

  return (
    <div className="uploader">
      <label htmlFor="media-file">Upload images</label>
      <input type="file" id="media-file" accept={accept} multiple disabled={busy} onChange={onChange} />
      <div className="hint">JPEG, PNG, WebP, AVIF, GIF or TIFF up to {Math.round(maxBytes / 1024 / 1024)} MB each. No SVG.</div>
      {message && <div className={message.startsWith('Failed') ? 'error' : 'notice'}>{message}</div>}
    </div>
  );
}
