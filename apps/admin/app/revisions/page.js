// Revisions browser + one-click restore-and-republish (spec §9: "the
// recovery path when someone pastes the wrong file"). Restoring writes the
// snapshot back as the current content (itself recorded as a new revision +
// audit row, all in ONE transaction) and triggers a publish. The publish
// Lambda holds the real mutex — if another publish is running the run shows
// as "Refused" on the dashboard and the editor republishes afterwards.
import { revalidatePath } from 'next/cache';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  saveSettings, saveHomepage, replaceCollectionRows, loadSettings, loadHomepage,
} from '@uccsite/db/content';
import { requireSession, requireRole } from '../../lib/auth';
import { withDb, withWriteTx, recordChange } from '../../lib/data';
import { COLLECTIONS } from '../../lib/collections';
import { loadCollectionItems, mediaAssetIds } from '../../lib/collection-save';
import { assertAltText } from '../../lib/media';
import { runAction } from '../../lib/actions';
import { config } from '../../lib/config';
import ActionForm from '../action-form';

export const dynamic = 'force-dynamic';

function hasRestorePath(entityType) {
  return entityType === 'settings' || entityType === 'homepage' || Boolean(COLLECTIONS[entityType]);
}

async function loadCurrent(client, entityType) {
  if (entityType === 'settings') return loadSettings(client);
  if (entityType === 'homepage') return loadHomepage(client);
  return loadCollectionItems(client, entityType);
}

// Inside the caller's transaction (tx: false).
async function applySnapshot(client, entityType, snapshot) {
  if (entityType === 'settings') return saveSettings(client, snapshot);
  if (entityType === 'homepage') return saveHomepage(client, snapshot, { tx: false });
  const spec = COLLECTIONS[entityType];
  // The alt-text gate applies to restores too: a snapshot may point at an
  // asset deleted or alt-stripped since it was taken.
  await assertAltText(client, mediaAssetIds(spec, snapshot));
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
        const current = await loadCurrent(client, rev.entity_type);
        await applySnapshot(client, rev.entity_type, JSON.parse(rev.snapshot));
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
