'use client';
// Backstop error boundary. Form actions return their errors inline
// (lib/actions.js); this catches everything else (render-time DB failures,
// misconfiguration) so the editor sees the admin's own page, not Next's
// generic "Application error".
export default function Error({ error, reset }) {
  return (
    <div>
      <h1>Something went wrong</h1>
      <div className="error" role="alert">
        {error?.message || 'Unexpected error'}
        {error?.digest && <div className="hint">ref {error.digest}</div>}
      </div>
      <p className="notice">Your last change may not have been saved. Reload the page and check before retrying.</p>
      <button type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
