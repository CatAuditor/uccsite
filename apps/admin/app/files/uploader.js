'use client';
// Upload widget for project files: pick the project + folder, then the
// files. Per file: presigned PUT from the server → browser PUT straight to
// S3 with the SERVER's content type (it is signed; the browser's guess is
// ignored) → finishFileUpload verifies the object and marks the row ready.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { beginFileUpload, finishFileUpload } from './actions';

export default function FileUploader({ projects, accept, maxBytes, defaultProject, defaultFolder }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [project, setProject] = useState(defaultProject || '');
  const [folder, setFolder] = useState(defaultFolder || '');

  async function onChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    const errors = [];
    let done = 0;
    for (const file of files) {
      try {
        if (file.size > maxBytes) throw new Error(`${file.name}: larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
        setMessage(`Uploading ${file.name}…`);
        const begun = await beginFileUpload({ filename: file.name, bytes: file.size, projectSlug: project, folder });
        if (begun.error) throw new Error(`${file.name}: ${begun.error}`);
        const res = await fetch(begun.url, { method: 'PUT', body: file, headers: { 'Content-Type': begun.mime } });
        if (!res.ok) throw new Error(`${file.name}: storage rejected the upload (${res.status})`);
        const finished = await finishFileUpload(begun.id);
        if (finished.error) throw new Error(`${file.name}: ${finished.error}`);
        done++;
      } catch (err) {
        console.error('[files] upload failed', err);
        errors.push(err.message || String(err));
      }
    }
    setBusy(false);
    setMessage(errors.length ? `Failed: ${errors.join('; ')}` : `Uploaded ${done} file(s).`);
    router.refresh();
  }

  return (
    <div className="uploader">
      <label htmlFor="files-project">Upload to project</label>
      <select id="files-project" value={project} onChange={(e) => setProject(e.target.value)} disabled={busy}>
        <option value="">General (no project)</option>
        {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
      </select>
      <label htmlFor="files-folder">Folder (optional)</label>
      <input type="text" id="files-folder" value={folder} onChange={(e) => setFolder(e.target.value)}
        placeholder="e.g. Records requests/2026" disabled={busy} />
      <label htmlFor="files-file">Files</label>
      <input type="file" id="files-file" accept={accept} multiple disabled={busy} onChange={onChange} />
      <div className="hint">
        PDF, Office, OpenDocument, text, CSV, JSON, ZIP, images, audio or video up to {Math.round(maxBytes / 1024 / 1024)} MB each.
        Nothing a browser would run (HTML, SVG, scripts) is accepted.
      </div>
      {message && <div className={message.startsWith('Failed') ? 'error' : 'notice'}>{message}</div>}
    </div>
  );
}
