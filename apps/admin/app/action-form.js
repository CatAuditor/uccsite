'use client';
// Form wrapper that shows a server action's { ok } | { error } result inline
// (see lib/actions.js for why actions return instead of throw). Children are
// whatever inputs the page renders; they stay mounted on error, so an
// editor's unsaved list survives a rejected save.
import { useActionState } from 'react';

export default function ActionForm({ action, children, className, successMessage = 'Saved.' }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form className={className} action={formAction} aria-busy={pending}>
      {state?.error && <div className="error" role="alert">{state.error}</div>}
      {state?.ok && !pending && <div className="ok" role="status">{state.message || successMessage}</div>}
      {children}
    </form>
  );
}
