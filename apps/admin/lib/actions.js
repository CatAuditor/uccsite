// Server-action result convention. Next 15 MASKS thrown server-action
// messages in production ("An error occurred in the Server Components
// render…"), so a thrown "needs alt text" never reaches the editor and the
// crash discards their unsaved form state. Every form action therefore
// returns { ok } | { error } — via runAction — and the ActionForm client
// component renders it. Next's own control-flow throws (redirect/notFound)
// are re-thrown untouched.
//
// Usage (the action itself must carry the 'use server' directive — a wrapper
// returned from here would not be registered as an action):
//   async function save(prevState, formData) {
//     'use server';
//     return runAction(() => saveCollection(key, formData));
//   }

export const OK = { ok: true };

export async function runAction(fn) {
  try {
    const result = await fn();
    return result && typeof result === 'object' ? result : OK;
  } catch (err) {
    if (typeof err?.digest === 'string' && err.digest.startsWith('NEXT_')) throw err;
    console.error(`[admin] action failed: ${err?.message || err}`);
    return { error: err?.message || 'Something went wrong' };
  }
}
