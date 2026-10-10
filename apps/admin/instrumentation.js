// Next.js instrumentation hooks (docs/error-handling/debug/admin.md).
//
// register(): runs once at server start. Surfaces the wrong-AWS-account error
// in the terminal immediately instead of on the first gated page; the same
// check gates every DB use in lib/data.js.
//
// onRequestError(): runs for EVERY uncaught error in a render or a Server
// Action — the ones production shows the editor only as "An error occurred
// in the Server Components render … ref <digest>". Amplify Hosting keeps no
// readable server log for this app (2026-10-10, docs/error-handling/
// client-side-error/2026-10-10-admin-server-components-digest.md), so the
// real message, the path and the stack are written to the audit_log table
// (action `admin.error`, entity_id = the digest) where the Audit Log page
// shows them — look the ref up there. Also logged as
// `[admin] request error digest=… path=… type=… <message>`.
//
// Both hooks are also compiled for the edge runtime; the DB code sits inside
// `if (process.env.NEXT_RUNTIME === 'nodejs')` blocks (a compile-time
// constant there) so the bundler drops the pg import from the edge build.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertAwsAccount } = await import('./lib/aws-account');
    await assertAwsAccount().catch((err) => console.error(`[admin] ${err.message}`));
  }
}

export async function onRequestError(err, request, context) {
  const digest = err?.digest || '';
  const message = String(err?.message || err || 'unknown error').slice(0, 1000);
  const where = `${request?.method || ''} ${request?.path || ''}`.trim();
  const type = `${context?.routerKind || ''}/${context?.routeType || ''}${context?.renderSource ? `/${context.renderSource}` : ''}`;
  console.error(`[admin] request error digest=${digest || '-'} path=${where} type=${type} route=${context?.routePath || ''} ${err?.name || 'Error'}: ${message}`);
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { withWriteDb } = await import('./lib/data');
      await withWriteDb((client) => client.query(
        `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), 'system', 'admin.error', 'request', $1, $2)`,
        [digest || null, JSON.stringify({
          message, name: err?.name || 'Error', path: where, route: context?.routePath || '', type,
          stack: String(err?.stack || '').split('\n').slice(0, 12).join('\n').slice(0, 2500),
        })]));
    } catch (e) {
      // Never let the error reporter throw into the failing request.
      console.error(`[admin] request error could not be recorded: ${e?.message || e}`);
    }
  }
}
