'use client';
// Backstop error boundary. Form actions return their errors inline
// (lib/actions.js); this catches everything else (render-time DB failures,
// misconfiguration) so the editor sees the admin's own page, not Next's
// generic "Application error".
//
// Stale-tab case (docs/error-handling/client-side-error/2026-10-05-admin-stale-server-action.md):
// every admin deploy gives Server Actions new ids, so a page opened BEFORE a
// deploy posts an id the new build does not know ("Server Action … was not
// found on the server"). Nothing was saved; the fix is a reload. Say that
// instead of the raw message.
const STALE_ACTION = /server action .* was not found|failed to find server action/i;

export default function Error({ error, reset }) {
  const stale = STALE_ACTION.test(error?.message || '');
  if (stale) {
    return (
      <div>
        <h1>This page is out of date</h1>
        <div className="notice" role="alert">
          The admin was updated while this page was open, so your save could not be sent. Nothing was
          saved. <strong>Reload the page</strong>, then make the change again.
        </div>
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    );
  }
  return (
    <div>
      <h1>Something went wrong</h1>
      <div className="error" role="alert">
        {error?.message || 'Unexpected error'}
        {error?.digest && <div className="hint">ref {error.digest}</div>}
      </div>
      <p className="notice">
        Your last change may not have been saved. <strong>Reload the page</strong> and check before retrying — this
        also happens when the admin was updated while the page was open.
        {error?.digest && <> The real message is recorded under <a href="/audit">Audit Log</a> as <code>admin.error</code> with ref {error.digest}.</>}
      </p>
      <button type="button" onClick={() => window.location.reload()}>Reload page</button>{' '}
      <button type="button" className="secondary" onClick={() => reset()}>Try again</button>
    </div>
  );
}
