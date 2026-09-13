// Phase 3 placeholder API Lambda: proves (a) the origin lock and (b) that a
// VPC-free Lambda reaches Aurora DSQL over IAM auth. Replaced by the full
// functions/api port in Phase 5. DB access goes through @uccsite/db — the
// same connection path every other component uses.
import { withConnection } from '@uccsite/db';

const { DSQL_ENDPOINT, ORIGIN_VERIFY_SECRET } = process.env;

export async function handler(event) {
  // Origin lock: only requests that came through CloudFront carry the header.
  const supplied = event.headers?.['x-origin-verify'];
  if (!ORIGIN_VERIFY_SECRET || supplied !== ORIGIN_VERIFY_SECRET) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const path = event.requestContext?.http?.path || '';
  if (path !== '/api/health') {
    return { statusCode: 404, headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ error: 'Not found' }) };
  }

  let db = 'unreachable';
  try {
    const row = await withConnection(
      { endpoint: DSQL_ENDPOINT, region: process.env.AWS_REGION },
      (client) => client.query('SELECT 1 AS ok'),
    );
    db = row.rows[0].ok === 1 ? 'ok' : 'unexpected';
  } catch (err) {
    console.error('[health] db check failed:', err.message); // status detail only, no payloads
  }

  return {
    statusCode: db === 'ok' ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({ db }),
  };
}
