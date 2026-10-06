'use client';
// "Request publish" beside a Save button. A plain button (not a nested form —
// invalid HTML) that calls the server action directly and shows the result
// inline. It asks to publish everything SAVED so far: unsaved edits in the
// form around it are not included, hence the title.
import { useState, useTransition } from 'react';
import { requestPublishInline } from './publish-actions';

export default function RequestPublish() {
  const [state, setState] = useState(null);
  const [pending, start] = useTransition();
  const onClick = () => start(async () => setState(await requestPublishInline()));
  return (
    <span className="request-publish">
      <button type="button" className="secondary" onClick={onClick} disabled={pending}
        title="Asks for everything saved so far to be published. Save first.">
        {pending ? 'Requesting…' : 'Request publish'}
      </button>
      {state?.error && <span className="error" role="alert">{state.error}</span>}
      {state?.ok && !pending && <span className="ok" role="status">{state.message}</span>}
    </span>
  );
}
