// Revisions browser + one-click restore-and-republish (spec §9: "the
// recovery path when someone pastes the wrong file"). Restoring writes the
// snapshot back as the current content (itself recorded as a new revision +
// audit row, all in ONE transaction) and triggers a publish. The publish
// Lambda holds the real mutex — if another publish is running the run shows
// as "Refused" on the dashboard and the editor republishes afterwards.
import { revalidatePath } from 'next/cache';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  saveSettings, saveHomepage, replaceCollectionRows, replaceProjects, loadSettings, loadHomepage,
} from '@uccsite/db/content';
import { requireSession, requireRole } from '../../lib/auth';
import { withDb, withWriteTx, recordChange } from '../../lib/data';
import { COLLECTIONS } from '../../lib/collections';
import { loadCollectionItems, mediaAssetIds } from '../../lib/collection-save';
import { assertAltText } from '../../lib/media';
import { getDocument, upsertDocument, listOverrides, replaceOverrides, loadForeignClassMap } from '@uccsite/db/documents';
import { runIngest, loadSiteSources } from '../../lib/documents';
import { runAction } from '../../lib/actions';
import { config } from '../../lib/config';
import ActionForm from '../action-form';

export const dynamic = 'force-dynamic';

function hasRestorePath(entityType) {
  return entityType === 'settings' || entityType === 'homepage' || entityType === 'document' || Boolean(COLLECTIONS[entityType]);
}

// Document snapshots carry the editable fields + overrides (app/documents/actions.js snapshotOf).
async function documentSnapshot(client, id) {
  const doc = await getDocument(client, { id });
  if (!doc) return null;
  const { bodyHtmlNormalized, ingestReport, liveHash, liveAt, lastPublishError, createdAt, updatedAt, contentHash, publishedAt, ...fields } = doc;
  return { ...fields, overrides: (await listOverrides(client, id)).map(({ nid, classes, mode }) => ({ nid, classes, mode })) };
}

async function loadCurrent(client, entityType, entityId) {
  if (entityType === 'settings') return loadSettings(client);
  if (entityType === 'homepage') return loadHomepage(client);
  if (entityType === 'document') return documentSnapshot(client, entityId);
  return loadCollectionItems(client, entityType);
}

// Inside the caller's transaction (tx: false).
async function applySnapshot(client, entityType, snapshot, entityId, session) {
  if (entityType === 'settings') return saveSettings(client, snapshot);
  if (entityType === 'homepage') return saveHomepage(client, snapshot, { tx: false });
  if (entityType === 'document') {
    // Re-ingest the restored raw body (normalized + report are derived state).
    const current = await getDocument(client, { id: entityId });
    const { overrides = [], ...fields } = snapshot;
    const next = { ...(current || {}), ...fields, id: entityId };
    // allow_scripts is owner-only on every path: a restored snapshot cannot
    // re-enable it for an editor, and an owner's change through restore is
    // audited like a save.
    if (session.role !== 'owner') next.allowScripts = current?.allowScripts || 0;
    if (Number(next.allowScripts) !== Number(current?.allowScripts || 0)) {
      await recordChange(client, { actor: session.email, action: next.allowScripts ? 'document.allow_scripts.on' : 'document.allow_scripts.off', entityType: 'document', entityId, diff: { via: 'restore' } });
    }
    const sources = await loadSiteSources();
    const result = runIngest(next, { siteCss: sources.siteCss, foreignClassMap: await loadForeignClassMap(client, next.templateKey) });
    next.bodyHtmlNormalized = result.bodyHtmlNormalized;
    next.ingestReport = result.report;
    if (next.status === 'published' && !result.ok) throw new Error('Restored HTML fails the accessibility gate — restore as draft first.');
    await upsertDocument(client, next);
    await replaceOverrides(client, entityId, overrides);
    return;
  }
  const spec = COLLECTIONS[entityType];
  // The alt-text gate applies to restores too: a snapshot may point at an
  // asset deleted or alt-stripped since it was taken.
  await assertAltText(client, mediaAssetIds(spec, snapshot));
  if (spec.nested) return replaceProjects(client, snapshot, { tx: false });
  return replaceCollectionRows(client, spec.table, snapshot, { where: spec.where, tx: false });
}

export default async function RevisionsPage() {
  await requireSession();
  const rows = await withDb(async (client) => (await client.query(
    `SELECT id, entity_type, entity_id, author, created_at::text AS created_at,
            length(snapshot) AS bytes
     FROM revisions ORDER BY created_at DESC LIMIT 50`)).rows);

  async function restore(prevState, formData) {
    'use server';
    return runAction(async () => {
      const s = await requireRole('editor');
      const revisionId = String(formData.get('revisionId'));
      const restored = await withWriteTx(async (client) => {
        const rev = (await client.query(
          `SELECT entity_type, entity_id, snapshot, created_at::text AS created_at
           FROM revisions WHERE id = $1`, [revisionId])).rows[0];
        if (!rev) throw new Error('Revision not found');
        if (!hasRestorePath(rev.entity_type)) throw new Error(`No restore path for entity type ${rev.entity_type}`);
        // Snapshot the CURRENT state first so the restore itself is reversible.
        const current = await loadCurrent(client, rev.entity_type, rev.entity_id);
        if (rev.entity_type === 'document' && !current) throw new Error('That document was deleted; recreate it before restoring.');
        await applySnapshot(client, rev.entity_type, JSON.parse(rev.snapshot), rev.entity_id, s);
        await recordChange(client, {
          actor: s.email,
          action: `${rev.entity_type}.restore`,
          entityType: rev.entity_type,
          entityId: rev.entity_id,
          snapshot: current,
          diff: { restoredRevision: revisionId, from: rev.created_at },
        });
        return rev;
      });
      // Republish so the restored content goes live (the "one-click" part).
      const lambda = new LambdaClient({ region: config.region });
      await lambda.send(new InvokeCommand({
        FunctionName: config.publishFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ trigger: `restore:${s.email}` })),
      }));
      revalidatePath('/revisions');
      return { ok: true, message: `Restored ${restored.entity_type} from ${restored.created_at.slice(0, 19).replace('T', ' ')} and started a publish — watch Publish & Status.` };
    });
  }

  return (
    <div>
      <h1>Revisions</h1>
      <p className="notice">Restore writes the snapshot back as current content and republishes the site. The pre-restore state is snapshotted too, so a restore is itself reversible.</p>
      <ActionForm action={restore}>
        <table>
          <thead><tr><th>When</th><th>Entity</th><th>Author</th><th>Size</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.created_at?.slice(0, 19).replace('T', ' ')}</td>
                <td>{r.entity_type}</td>
                <td>{r.author}</td>
                <td>{r.bytes}B</td>
                <td>
                  <button type="submit" name="revisionId" value={r.id}>Restore &amp; republish</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="5">No revisions yet — every save creates one.</td></tr>}
          </tbody>
        </table>
      </ActionForm>
    </div>
  );
}
