'use client';
// Form wrapper that shows a server action's { ok } | { error } result inline
// (see lib/actions.js for why actions return instead of throw). Children are
// whatever inputs the page renders; they stay mounted on error, so an
// editor's unsaved list survives a rejected save.
//
// The action is dispatched from onSubmit inside startTransition rather than
// through <form action>: React 19 resets every UNCONTROLLED field of a
// <form action> form when the action settles — success or error — which
// would wipe an editor's typed metadata on a rejected save.
import { useActionState, startTransition } from 'react';

export default function ActionForm({ action, children, className, successMessage = 'Saved.' }) {
  const [state, formAction, pending] = useActionState(action, null);
  const onSubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // The clicked submit button's name/value (e.g. revisionId) is only added
    // by native submission; replicate it.
    const btn = e.nativeEvent?.submitter;
    if (btn?.name) fd.append(btn.name, btn.value);
    startTransition(() => formAction(fd));
  };
  return (
    <form className={className} onSubmit={onSubmit} aria-busy={pending}>
      {state?.error && <div className="error" role="alert">{state.error}</div>}
      {state?.ok && !pending && <div className="ok" role="status">{state.message || successMessage}</div>}
      {children}
    </form>
  );
}
