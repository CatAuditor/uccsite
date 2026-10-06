# Admin: "Server Action … was not found on the server" on save

**Reported:** 2026-10-05, saving the personal bio on `/profile`.

**Error (browser):**
```
Server Action "60ded58258e86bb9d02a0b9be77d0880f687c858f6" was not found on the server.
Read more: https://nextjs.org/docs/messages/failed-to-find-server-action
```

**Route / component:** any admin page with a form (`app/action-form.js` →
a `'use server'` action); seen on `/profile`.

**Reproduction:** open an admin page, deploy a new admin build (every push
to `refactor` does — Amplify), then submit the form in the old tab.

**Root cause:** Next.js derives Server Action ids from the build. A tab
rendered by build N posts build N's id; build N+1 (five admin deploys landed
on 2026-10-05) has different ids and rejects it. Not a data problem: the
action never ran, nothing was saved or half-saved.

**Fix:** reload the page and save again. `app/error.js` now recognises the
message and shows "This page is out of date … Reload the page" with a
reload button instead of the raw error.

**What would catch it earlier:** Next's skew protection needs Vercel; on
Amplify the honest mitigation is the message above plus fewer back-to-back
deploys during editing hours. If it recurs often, add a build-id check to
`app/refresher.js` that prompts a reload when the server's build id changes.
