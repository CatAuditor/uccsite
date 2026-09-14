#!/usr/bin/env node
// tip-smoke.mjs — end-to-end check of the tipline on a deployed environment
// (docs/systems/tipline.md): POST /api/tip through CloudFront, confirm the
// row landed in DSQL with the expected shape, confirm the API log group
// contains NO trace of the tip text or email (the confidentiality DoD), then
// delete the smoke row. Uses one of the 5/hour tip rate-limit slots.
//
// If Turnstile is armed on the environment the POST returns 403 and the
// insert half is reported as SKIPPED (the route cannot be exercised without
// a browser-issued token); the log search still runs.
//
// Usage:
//   $env:AWS_PROFILE='uccsite'
//   node scripts/tip-smoke.mjs --env staging [--auth preview:…] [--no-log-wait]
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolveEnv, argValue, REGION } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const authCred = argValue(args, '--auth', envName === 'staging' ? 'preview:wasatch-front-2026' : '');
const logWait = !args.includes('--no-log-wait');

const { stackName, outputs } = await resolveEnv(envName, ['PublicOrigin', 'DsqlEndpoint']);
const base = outputs.PublicOrigin.replace(/\/$/, '');
const marker = `tip-smoke-${randomUUID()}`;
const email = `${marker}@example.com`;
const startedAt = Date.now();

let pass = 0, fail = 0, skipped = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); ok ? pass++ : fail++; };

// 1. POST the tip.
const res = await fetch(`${base}/api/tip`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(authCred ? { authorization: 'Basic ' + Buffer.from(authCred).toString('base64') } : {}),
  },
  body: JSON.stringify({ name: 'Smoke Test', email, subject_of_tip: 'smoke', tip_summary: `automated smoke ${marker}` }),
});
let inserted = false;
if (res.status === 403) {
  console.log(`SKIP  POST /api/tip → 403 (Turnstile armed on ${envName}; insert path not exercised)`);
  skipped++;
} else {
  check('POST /api/tip → 200 {ok:true}', res.status === 200 && (await res.json()).ok === true, String(res.status));
  inserted = res.status === 200;
}

// 2. Row shape + cleanup.
if (inserted) {
  await withConnection({ endpoint: outputs.DsqlEndpoint, region: REGION }, async (client) => {
    const rows = (await client.query(
      `SELECT id, name, anonymous, email, subject_of_tip, status, legacy_airtable_id FROM tips WHERE email = $1`, [email])).rows;
    check('exactly one tips row for the smoke email', rows.length === 1, String(rows.length));
    const r = rows[0] || {};
    check('row shape: name/anonymous/subject/status/legacy id', r.name === 'Smoke Test' && r.anonymous === 0
      && r.subject_of_tip === 'smoke' && r.status === 'New' && r.legacy_airtable_id === null, JSON.stringify({ ...r, id: undefined }));
    const del = await client.query('DELETE FROM tips WHERE email = $1', [email]);
    check('smoke row deleted', del.rowCount === rows.length, String(del.rowCount));
  });
}

// 3. Confidentiality: the API log group must not contain the marker or email.
const groups = JSON.parse(execFileSync('aws', [
  'logs', 'describe-log-groups', '--profile', 'uccsite', '--region', REGION,
  '--log-group-name-prefix', `/aws/lambda/${stackName}-ApiFunction`, '--query', 'logGroups[].logGroupName', '--output', 'json',
], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }));
check('API log group found', groups.length >= 1, groups.join(','));
if (groups.length) {
  if (logWait) { console.log('…waiting 20 s for log delivery'); await new Promise(r => setTimeout(r, 20_000)); }
  for (const term of [marker, email]) {
    const events = JSON.parse(execFileSync('aws', [
      'logs', 'filter-log-events', '--profile', 'uccsite', '--region', REGION,
      '--log-group-name', groups[0], '--start-time', String(startedAt - 60_000),
      '--filter-pattern', `"${term}"`, '--query', 'events[].message', '--output', 'json',
    ], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }));
    check(`no log line contains ${term === email ? 'the tip email' : 'the tip text'}`, events.length === 0, events.length ? `${events.length} hit(s)` : '');
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
process.exit(fail ? 1 : 0);
