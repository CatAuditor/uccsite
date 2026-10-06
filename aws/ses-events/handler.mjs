// SesEventsFn (docs/systems/newsletters.md "Bounces and complaints").
// Subscribed to the ops SNS topic that the SES configuration set publishes
// BOUNCE / COMPLAINT / REJECT events to; writes one email_events row per
// affected recipient so the audience query can skip suppressed addresses
// and the Mailing list can show why. Everything else on the topic (alarms,
// budgets) is ignored by shape. Never throws on a malformed record — SNS
// would retry and the ops emails would repeat.
import { withConnection } from '@uccsite/db';
import { classify, recordEvents } from '@uccsite/db/email-events';

const db = { endpoint: process.env.DSQL_ENDPOINT, region: process.env.AWS_REGION };

export async function handler(event = {}) {
  const found = [];
  for (const rec of event.Records || []) {
    let msg;
    try { msg = JSON.parse(rec?.Sns?.Message || ''); } catch { continue; }
    if (!msg || typeof msg !== 'object' || !(msg.eventType || msg.notificationType)) continue;
    found.push(...classify(msg));
  }
  if (!found.length) { console.log('[ses-events] nothing to record'); return { recorded: 0 }; }
  await withConnection(db, (client) => recordEvents(client, found));
  // Counts only — never the addresses.
  const by = {};
  for (const e of found) by[`${e.type}${e.suppress ? '/suppress' : ''}`] = (by[`${e.type}${e.suppress ? '/suppress' : ''}`] || 0) + 1;
  console.log(`[ses-events] recorded ${found.length}: ${JSON.stringify(by)}`);
  return { recorded: found.length };
}
