'use server';
// importUpload(formData): a .docx, .md or .html file → newsletter blocks for
// the composer (docs/systems/newsletters.md "Import a file"). Called
// directly from the client, not through ActionForm; nothing is stored — the
// blocks land in the editor and the writer still saves. Same 8 MB cap as
// the Documents upload (next.config.js bodySizeLimit).
import { requireRole } from '../../../lib/auth';
import { runAction } from '../../../lib/actions';
import { uploadToHtml } from '../../../lib/convert-upload.mjs';
import { htmlToBlocks } from '../../../lib/newsletter-import.mjs';
import { MAX_BLOCKS } from '@uccsite/newsletter/render';

const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export async function importUpload(formData) {
  return runAction(async () => {
    await requireRole('editor');
    const file = formData.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('No file received');
    if (file.size > UPLOAD_MAX_BYTES) throw new Error('File is larger than 8 MB');
    const existing = Math.max(0, Number(formData.get('existing')) || 0);
    const headline = String(formData.get('headline') || '');
    const converted = await uploadToHtml(file);
    const out = htmlToBlocks(converted.html, { headline });
    if (existing + out.blocks.length > MAX_BLOCKS) throw new Error(`That file makes ${out.blocks.length} blocks; an email holds at most ${MAX_BLOCKS} (${existing} already here)`);
    const notes = [...out.notes, ...(converted.warnings || [])];
    console.log(`[newsletter] import ${converted.kind} "${file.name}" ${file.size}B -> ${out.blocks.length} blocks${out.headline !== headline ? ', headline set' : ''}${notes.length ? `; notes: ${notes.join(' | ')}` : ''}`);
    return { ok: true, blocks: out.blocks, headline: out.headline, notes };
  });
}
