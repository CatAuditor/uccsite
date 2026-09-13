// Dashboard: publish button + run history (the Draft/Publishing…/Live/Failed
// answer from spec §7). Publish invokes the PublishFn Lambda async; the run
// lifecycle rows in publish_runs drive the table below.
import { revalidatePath } from 'next/cache';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireRole, getSession } from '../lib/auth';
import { withDb, recordChange, latestPublishRuns } from '../lib/data';
import { config } from '../lib/config';
import Refresher from './refresher';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await getSession();
  const runs = await withDb((client) => latestPublishRuns(client));
  const inFlight = runs[0]?.status === 'publishing';

  async function publishNow() {
    'use server';
    const s = await requireRole('editor');
    const lambda = new LambdaClient({ region: config.region });
    await lambda.send(new InvokeCommand({
      FunctionName: config.publishFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ trigger: `admin:${s.email}` })),
    }));
    await withDb((client) => recordChange(client, {
      actor: s.email, action: 'publish.trigger',
    }));
    revalidatePath('/');
  }

  return (
    <div>
      <h1>Publish &amp; Status</h1>
      <Refresher active={inFlight} />
      {session?.role !== 'viewer' ? (
        <form action={publishNow}>
          <button type="submit" disabled={inFlight}>
            {inFlight ? 'Publishing…' : 'Publish site'}
          </button>
        </form>
      ) : (
        <p className="notice">Viewer role — read-only.</p>
      )}
      <h2>Recent publish runs</h2>
      <table>
        <thead>
          <tr><th>Started</th><th>Trigger</th><th>Status</th><th>Changed</th><th>Error</th></tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{run.started_at?.slice(0, 19).replace('T', ' ')}</td>
              <td>{run.trigger_source}</td>
              <td className={`status-${run.status}`}>
                {run.status === 'succeeded' ? `Live (${run.finished_at?.slice(11, 16)})`
                  : run.status === 'publishing' ? 'Publishing…'
                  : run.status}
              </td>
              <td>{run.changed}</td>
              <td>{run.error || ''}</td>
            </tr>
          ))}
          {!runs.length && <tr><td colSpan="5">No publishes yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
