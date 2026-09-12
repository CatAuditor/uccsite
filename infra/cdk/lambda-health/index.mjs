// Phase 3 placeholder API Lambda: proves (a) the origin lock and (b) that a
// VPC-free Lambda reaches Aurora DSQL over IAM auth. Replaced by the full
// functions/api port in Phase 5.
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';

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
    const signer = new DsqlSigner({ hostname: DSQL_ENDPOINT, region: process.env.AWS_REGION });
    const token = await signer.getDbConnectAdminAuthToken();
    const client = new pg.Client({
      host: DSQL_ENDPOINT, port: 5432, user: 'admin', database: 'postgres',
      password: token, ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 8000,
    });
    await client.connect();
    const r = await client.query('SELECT 1 AS ok');
    await client.end();
    db = r.rows[0].ok === 1 ? 'ok' : 'unexpected';
  } catch (err) {
    console.error('health db check failed:', err.message); // status detail only, no payloads
  }

  return {
    statusCode: db === 'ok' ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({ db }),
  };
}
