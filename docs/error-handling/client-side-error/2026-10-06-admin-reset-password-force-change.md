# Admin: "Reset password" fails with "Current password is incorrect, or your session has expired"

**Reported:** 2026-10-06, Users page (`/users`), owner pressing **Reset password**
("seemingly broken").

**Error (shown inline above the row's form):**
```
Current password is incorrect, or your session has expired — sign out and back in.
```

**Route / component:** `app/users/page.js` → server action `sendPasswordReset`
(`app/users/actions.js`) → `lib/account.js resetPassword` →
`AdminResetUserPassword`.

**Reproduction:** invite a user; before they sign in for the first time
(status `FORCE_CHANGE_PASSWORD`), press Reset password for them. Reproduced
on the staging pool with a throwaway user (`MessageAction: SUPPRESS`):

```
NotAuthorizedException: User password cannot be reset in the current state.
```
A disabled user fails the same way with `NotAuthorizedException: User is disabled.`
On 2026-10-06 four of the seven prod accounts were `FORCE_CHANGE_PASSWORD`,
so the button failed for most of the list.

**Root cause:** two things.
1. Cognito cannot reset a password that was never set: `AdminResetUserPassword`
   refuses users still in `FORCE_CHANGE_PASSWORD` (and disabled users). The
   admin called it regardless of status.
2. `lib/account.js friendly()` mapped every `NotAuthorizedException` to the
   self-service wording ("Current password is incorrect…"), which is right for
   `ChangePassword` with an access token but nonsense for the admin APIs.
   So the owner saw a message about their own password.

**Fix (same day):**
- `sendPasswordReset` reads the user first (`getUser`). Disabled → "Enable the
  user first". `FORCE_CHANGE_PASSWORD` → `AdminCreateUser MessageAction=RESEND`
  (a fresh temporary-password invite; audit `user.invite_resent`); the
  button reads **Resend invite** for those users and is disabled for disabled
  accounts. Otherwise the reset as before.
- `friendly()` passes the admin APIs' own `NotAuthorizedException` text
  through; only messages mentioning the access token / incorrect username
  get the self-service wording.

**What would catch it earlier:** an owner-side smoke on staging that exercises
each Users-page action against a freshly invited user (status
`FORCE_CHANGE_PASSWORD`), not only against the confirmed test users.
