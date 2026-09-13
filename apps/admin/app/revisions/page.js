// Revisions browser + one-click restore-and-republish (spec §9: "the
// recovery path when someone pastes the wrong file"). Restoring writes the
// snapshot back as the current content (itself recorded as a new revision +
// audit row) and triggers a publish.
import { revalidatePath } from 'next/cache';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  saveSettings, saveHomepage, replaceCollectionRows, loadSettings, loadHomepage,
} from '@uccsite/db/content';
import { requireSession, requireRole } from '../../lib/auth';
import { withDb, withWriteDb, recordChange } from '../../lib/data';
import { COLLECTIONS } from '../../lib/collections';
import { loadCollectionItems } from '../../lib/collection-save';
import { config } from '../../lib/config';

export const dynamic = 'force-dynamic';

async function applySnapshot(client, entityType, snapshot) {
  if (entityType === 'settings') return saveSettings(client, snapshot);
  if (entityType === 'homepage') return saveHomepage(client, snapshot);
  const spec = COLLECTIONS[entityType];
  if (!spec) throw new Error(`No restore path for entity type ${entityType}`);
  return replaceCollectionRows(client, spec.table, snapshot, { where: spec.where });
}

export default async function RevisionsPage() {
  await requireSession();
  const rows = await withDb(async (client) => (await client.query(
    `SELECT id, entity_type, entity_id, author, created_at::text AS created_at,
            length(snapshot) AS bytes
     FROM revisions ORDER BY created_at DESC LIMIT 50`)).rows);

  async function restore(formData) {
    'use server';
    const s = await requireRole('editor');
    const revisionId = String(formData.get('revisionId'));
    await withWriteDb(async (client) => {
      const rev = (await client.query(
        `SELECT entity_type, entity_id, snapshot, created_at::text AS created_at
         FROM revisions WHERE id = $1`, [revisionId])).rows[0];
      if (!rev) throw new Error('Revision not found');
      // Snapshot the CURRENT state first so the restore itself is reversible.
      const current = rev.entity_type === 'settings' ? await loadSettings(client)
        : rev.entity_type === 'homepage' ? await loadHomepage(client)
        : await loadCollectionItems(client, rev.entity_type);
      await applySnapshot(client, rev.entity_type, JSON.parse(rev.snapshot));
      await recordChange(client, {
        actor: s.email,
        action: `${rev.entity_type}.restore`,
        entityType: rev.entity_type,
        entityId: rev.entity_id,
        snapshot: current,
        diff: { restoredRevision: revisionId, from: rev.created_at },
      });
    });
    // Republish so the restored content goes live (the "one-click" part).
    const lambda = new LambdaClient({ region: config.region });
    await lambda.send(new InvokeCommand({
      FunctionName: config.publishFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ trigger: `restore:${s.email}` })),
    }));
    revalidatePath('/revisions');
  }

  return (
    <div>
      <h1>Revisions</h1>
      <p className="notice">Restore writes the snapshot back as current content and republishes the site. The pre-restore state is snapshotted too, so a restore is itself reversible.</p>
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
                <form action={restore}>
                  <input type="hidden" name="revisionId" value={r.id} />
                  <button type="submit">Restore &amp; republish</button>
                </form>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="5">No revisions yet — every save creates one.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
