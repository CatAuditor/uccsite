// Dashboard: publish button + run history (the Draft/Publishing…/Live/Failed
// answer from spec §7). Publish invokes the PublishFn Lambda async; the run
// lifecycle rows in publish_runs drive the table below.
import { revalidatePath } from 'next/cache';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireRole, requireSession } from '../lib/auth';
import { withDb, withWriteDb, recordChange, latestPublishRuns, inFlightPublish, IN_FLIGHT_GRACE_MS } from '../lib/data';
import { config } from '../lib/config';
import Refresher from './refresher';

export const dynamic = 'force-dynamic';

// Matches the drift reconciler's grace: a 'publishing' row older than this is
// an abandoned run (crashed Lambda) — shown as stalled, and no longer blocks.
function isFreshPublishing(run) {
  return run?.status === 'publishing'
    && Date.now() - new Date(run.started_at).getTime() < IN_FLIGHT_GRACE_MS;
}

export default async function Dashboard() {
  const session = await requireSession();
  const runs = await withDb((client) => latestPublishRuns(client));
  const inFlight = Boolean(await withDb(inFlightPublish));

  async function publishNow() {
    'use server';
    const s = await requireRole('editor');
    // UX-level in-flight guard; the authoritative mutex is publish_lock,
    // taken by the Lambda itself (a losing run shows as 'refused' below).
    const inFlightRun = await withDb(inFlightPublish);
    if (inFlightRun) {
      console.warn(`[admin] ${s.email} publish not sent: run ${inFlightRun.id} in flight`);
      return;
    }
    const lambda = new LambdaClient({ region: config.region });
    await lambda.send(new InvokeCommand({
      FunctionName: config.publishFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ trigger: `admin:${s.email}` })),
    }));
    await withWriteDb((client) => recordChange(client, {
      actor: s.email, action: 'publish.trigger',
    }));
    revalidatePath('/');
  }

  return (
    <div>
      <h1>Publish &amp; Status</h1>
      <Refresher active={inFlight} />
      {session.role !== 'viewer' ? (
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
                  : run.status === 'publishing' ? (isFreshPublishing(run) ? 'Publishing…' : 'Stalled (abandoned)')
                  : run.status === 'refused' ? 'Refused (another publish was running)'
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
