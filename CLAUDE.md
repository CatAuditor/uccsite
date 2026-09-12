# uccsite — Utah Civic Compact (Cloudflare Pages)

## AWS (Amplify migration)

- AWS work uses profile `uccsite` (account 017110365763, us-west-2) — NEVER the default profile (personal account). Every `aws` command gets `--profile uccsite`.
- @.claude/aws-agent-rules.md

## Architecture & hard rules (read `docs/systems/site-structure.md`)

- Static site: `templates/*.html` + `templates/partials/` + `content/*.json` → `node build.js` → `dist/`. **Never edit `dist/`**; never add page HTML at repo root.
- Nav and footer live ONLY in `templates/partials/header.html` / `footer.html`.
- **No inline `<script>`** — the CSP blocks it. JS goes in `js/`.
- Backend is Cloudflare Pages Functions in `functions/api/` (shared helpers in `_lib.js`) + D1 (`schema.sql`). Secrets inventory is in `wrangler.toml`.
- Every key in `content/*.json` must be declared in `static/admin/config.yml` or the CMS deletes it on save.
- `main` auto-deploys to production with no preview.
- The tipline is confidential: never log request or upstream response bodies in `functions/api/tip.js`.

---

# MANDATORY 

These are not suggestions. Violations cause broken builds, lost context, and wasted tokens.

---

## Checklist: Before Completing Any Response That Touches Code

Every response involving code changes MUST complete all of the following before sending:

- [ ] **Docs updated** — every system file touched by this change is updated to reflect the new state
- [ ] **Code Map updated** — if a new file, route, or API was added or removed, the relevant `docs/systems/` Code Map section reflects it
- [ ] **Error-handling logged** — if this response debugged something, a log was written to `docs/error-handling/`
- [ ] **No build-breaking syntax** — all edited files have valid syntax; no broken imports, no missing types
- [ ] **Surgical changes only** — no adjacent cleanup, refactors, or unrelated edits were made

If any item is unchecked, complete it before sending the response.

---

## Checklist: After Every Push to Remote

After every `git push`, update `docs/changelog.md` before the session ends:

- Add a new version entry at the top (format: `## vX.Y.Z — YYYY-MM-DD`)
- List every feature, fix, or change included in the push — grouped by system
- Note any open P0/P1 items that are still unresolved at time of push
- Do NOT batch multiple pushes into one entry — one push = one entry

---

# Docs Structure

```
docs/
  systems/        — HOW features are built (Code Maps, data flow, file paths, API routes, DB tables)
  decisions/      — WHY non-obvious choices were made (ADRs)
  branding/       — Brand identity assets and guidance
  security/       — Security notes and review material
  legal/          — Terms & Conditions, Privacy Policy (do not modify without explicit instruction)
  error-handling/ — Debugging logs, build failures, client-side errors (write here whenever relevant)
  changelog.md    — One entry per push (see checklist above)
```

---

# After Every Code Change — Not Just After Tasks

Update docs immediately when you make a change — not at the end of the session, not at the end of the task. After every edit to code, update the affected docs in the same response.

## What Goes Where

**`docs/systems/[feature].md`** — Update when you change how something works:
- Code Map section: add/remove files, routes, API endpoints, DB tables
- Data flow: what queries run, what they return
- All API endpoints: method, path, auth, request body, success response, all error responses, side effects
- Env vars: what it controls, what breaks if missing, build-time vs runtime
- Error handling: where caught, what client receives, what's logged
- Implementation status: what's built vs spec-only
- Hard constraints: unique constraints, FK deps, Stripe requirements, Cognito group membership

**`docs/decisions/`** — Write when making a non-obvious architectural choice:
- What you chose + what the alternatives were
- Why this approach
- What breaks if someone reverses it without reading this

**`docs/error-handling/`** — Write whenever you debug, fix a build failure, or resolve a client-side error:

| Subfolder | When to write | What to include |
|-----------|--------------|-----------------|
| `debug/` | When you add or change debug logging in any feature | The log prefix (`[TAG]`), where logs fire (file + event), what each log reports, what normal vs broken looks like, where to find logs (browser console / CloudWatch). Filename: `feature-name.md`. This is instrumentation reference — not a fix log. |
| `build-failures/` | Any time a build fails | Exact error message, file + line, cause, fix, what would catch it earlier. Filename: `YYYY-MM-DD-short-description.md` |
| `client-side-error/` | Any time a runtime error occurs in the browser or API | Error message, route/component, reproduction steps, root cause, fix. Filename: `YYYY-MM-DD-short-description.md` |

**`docs/legal/`** — do not modify without explicit instruction. Exception, which updates automatically:

- **`data-handling.md`** — Update when: a DB migration adds or removes columns that store PII or sensitive data; a new API route collects user data not yet listed; a 3rd-party integration is added, changed, or removed. Add/remove rows from the relevant table section and update the retention schedule if it changes.

---

# Behavioral Rules

## Think Before Coding
Surface assumptions and ambiguities before writing code. Never silently pick an approach when there are meaningful trade-offs — ask first.

## Surgical Changes
Only modify what was requested. No adjacent refactors, style cleanup, or "while I'm in here" changes. A bug fix does not get surrounding cleanup. A new route does not get existing route refactors.

## Simplicity First
No speculative features, no unnecessary abstractions. If code could be half as long without losing clarity, rewrite it. Do not design for hypothetical future requirements.

## Goal-Driven Execution
Convert vague tasks into verifiable success criteria before starting. Define what done looks like, then execute.

## Unanswered Questions (hands-off sessions)
If an AskUserQuestion times out with no answer selected: append the question, its options, and the choice you made to `docs/pending-questions.md` (create if missing), pick the most reversible option, and continue — never treat silence as agreement with any specific option. When the user later answers an entry in that file, apply their answer and delete the entry.

## Delegate to lightweight subagents

Only delegate a subtask to a lesser subagent when doing so is *clearly* cheaper or
faster than handling it in the main thread — i.e. the overhead of spinning up a
subagent, writing its prompt, and verifying its output is obviously smaller than
the cost of doing the task inline. If it's a close call, don't delegate.

"Lesser" means either axis below (independent, can combine):

**Smaller model** (e.g. Haiku instead of Sonnet) when the task:
- Has a clear, checkable success condition (tests pass, output matches spec, parses correctly)
- Doesn't require broad codebase judgment or architectural decisions
- Is mechanical/narrow: grep/search, running a test suite, formatting, boilerplate,
  simple refactors, summarizing a file, parsing/fetching data

**Narrower tool/context scope** (regardless of model) when the task:
- Only needs a subset of tools (e.g. read-only, or a single directory) to complete
- Would otherwise dump large intermediate output into the main thread's context
  (long file dumps, verbose logs, search results to be filtered)
- Is self-contained enough to specify with a short, explicit prompt

**Do not delegate:**
- Anything touching architecture, public APIs, or cross-file design decisions
- Tasks where a wrong answer wouldn't be caught by a downstream check
- Tasks requiring context accumulated earlier in the main thread that can't be
  cheaply restated
- Small tasks where writing the delegation prompt would take as long as just doing it

When delegating, give the subagent a narrow, self-contained prompt with explicit
success criteria, and verify its output before relying on it in the main thread.

---

# Debugging & Logging

All features require debug logging at every meaningful step. Use a consistent log format, and when a decision is made, modify this paragraph in CLAUDE.md

Debug logs persist until explicitly instructed to remove them.

## When to write to `docs/error-handling/`

**`debug/`** — When you add or modify debug logging in a feature. One file with routes to debugs, and what feature they are attached to. Documents what logs exist and how to read them so future sessions know exactly where to look when that feature breaks. This is instrumentation reference — not a fix log.

**`build-failures/`** — When a build fails. Document the exact error, the cause, and the fix. Future sessions should recognize repeat failures immediately.

**`client-side-error/`** — When a runtime error occurs in the browser or an API returns unexpectedly. Document the error, repro steps, and fix so the user doesn't need to re-describe it.

---

# Before Any Push to Production

- All edited files compile without errors
- All API endpoints return correct status codes and response shapes
- No broken imports or type errors
- Docs updated to reflect current state

## Amplify Environment Variables — Verify Every Push

**Every push must confirm all vars below are set in Amplify Console → App → Environment variables.**
Missing vars cause silent 401s, broken auth, and failed payments — they do NOT cause build failures.
`.env.local` is never deployed. The Amplify console is the only source of truth for prod.

If you add a new `process.env.FOO` reference anywhere in the codebase, you MUST:
1. Add it to `.env.local.example`
2. Add it to the list below
3. Set it in Amplify Console before merging

Note: this is a Vite SPA — client-visible env vars use `import.meta.env.VITE_*`
(the `VITE_` prefix is what exposes them to the bundle). The rule above applies to
those identically.

**Single source of truth (2026-07-12):** Amplify Console env vars drive both the
client bundle AND the CSP. `src/config.ts` reads `import.meta.env.VITE_*`; the
`prebuild` step (`scripts/gen-csp.ts`) resolves the same vars via Vite's
`loadEnv` (so `.env.local` overrides reach the CSP too) and regenerates
`customHttp.yml`'s `connect-src`, failing the build on any value that isn't a
bare https origin. So **never hand-edit a Function URL into `customHttp.yml`**
— set the env var, redeploy, both update. Fallback defaults live in
`src/endpoints.ts` (client/CSP) and `amplify/functions/shared/client-id.ts`
(backend); a missing **or empty** var degrades to the last-known-good default
(`||`, not `??`, everywhere). `customHttp.yml` is a generated artifact — edit
the generator, not the file. Decision:
`docs/decisions/2026-07-12-env-vars-single-source.md`.

### Current environment variables

| Var | Purpose | Behavior when missing |
|---|---|---|
| `VITE_SHARE_URL` / `VITE_CHECKOUT_URL` / `VITE_ENTITLEMENT_URL` / `VITE_UNSUB_PROXY_URL` / `VITE_DELETE_URL` / `VITE_WORK_SUMMARY_URL` | Lambda Function URLs. Read by `src/config.ts` (client) and `scripts/gen-csp.ts` (CSP) at build time. Set/change in Amplify Console after a function (re)deploys. `VITE_DELETE_URL` set in console 2026-07-12. `VITE_WORK_SUMMARY_URL` (cleanup-summary email, added 2026-07-25): committed default is EMPTY — must be set in console after the work-summary function's first deploy. | Falls back to the last-known-good URL in `src/endpoints.ts` (first five have real defaults; `WORK_SUMMARY_URL` default is empty → "Email me this summary" button hidden); an endpoint is excluded from CSP only if both var and default are empty. |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID (public). The ONE canonical override for the client bundle **and** every Lambda (`amplify/functions/shared/client-id.ts` reads the same var at synth) — a single console var can never bind the two sides to different OAuth audiences. Set in console 2026-07-25 (`294920447419-...`); committed default is the older `84279819282-...` ID. | Falls back to the committed default client ID. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key baked into the bundle at build time (`src/config.ts`). Pre-launch this is a TEST-mode key on purpose — `docs/decisions/2026-07-08-test-stripe-keys-in-prod.md`. | Falls back to `pk_PLACEHOLDER`; embedded checkout fails closed. |
| `STRIPE_PRICE_ANNUAL` / `STRIPE_PRICE_PASS` | Price IDs read at `ampx pipeline-deploy` synth time (`amplify/functions/checkout/resource.ts`). Currently Vail0 LLC sandbox test prices (account migrated 2026-07-17). | Checkout Lambda gets placeholder IDs → 500 fail-closed on checkout. |
| `STRIPE_SECRET_KEY` | Amplify **secret** (`npx ampx secret set`). Held by BOTH checkout (create sessions) and stripe-webhook (retrieve the PaymentIntent behind a `charge.refunded`/`charge.dispute.created` event to resolve the buyer's `sub` for revocation). | **Deploy fails while unset** (unresolvable `secret()`). Checkout 500s. Webhook can't resolve `sub` on refund/dispute → access is NOT revoked (logged); grants unaffected. |
| `LICENSE_TOKEN_SECRET` | Amplify **secret** (`npx ampx secret set`), held by the entitlement Lambda (mints/verifies returning-user license tokens — `docs/decisions/2026-07-09-license-token-returning-users.md`), by the unsub-proxy, data-deletion, and work-summary Lambdas (all verify those tokens as their identity gate), and by lifecycle-mailer (signs/verifies promo-unsubscribe tokens — distinct JWT audience, `shared/promo-unsub-token.ts`). | **Deploy fails while unset** (unresolvable `secret()`). If empty at runtime: Google-idToken checks work, no license tokens minted; license-token requests 500 (the four gate Lambdas fail closed); lifecycle-mailer skips promo sends and its unsub endpoint 500s. |
| `STRIPE_WEBHOOK_SECRET` | Amplify **secret** (`npx ampx secret set`), held by stripe-webhook: HMAC key for verifying the `stripe-signature` header — the webhook's ONLY auth. | **Deploy fails while unset** (unresolvable `secret()`). If empty at runtime: signature verification fails → all webhook events 400 → no grants, no revocations. |
| `RESEND_API_KEY` | Amplify **secret** (`npx ampx secret set`), held by stripe-webhook (purchase receipts), work-summary (cleanup-summary emails), and lifecycle-mailer (annual expiry notices + opt-in pass promos, 2026-07-28), all via Resend. | **Deploy fails while unset** (unresolvable `secret()`). Placeholder/empty at runtime: receipts skipped with a log (grants unaffected); summary requests return `{ok:false}` (client shows copy fallback); lifecycle runs send nothing (logged). |
| `RESEND_FROM` | From address, hardcoded on the stripe-webhook, work-summary, and lifecycle-mailer Lambdas (`resource.ts`: `Vail0 <receipts@vail0.com>`) — not a console var. Change it in all three `resource.ts` files. | If it were emptied: Resend rejects the send, email skipped (logged), grants unaffected. |
| `PROMO_UNSUB_URL` / `POSTAL_ADDRESS` | Both Amplify Console env vars read at **synth** in `lifecycle-mailer/resource.ts`. `PROMO_UNSUB_URL` = the mailer's OWN Function URL (promo unsubscribe endpoint; CDK can't wire a function's own URL into its env — cycle), set in the console after the mailer's first deploy. `POSTAL_ADDRESS` = the CAN-SPAM physical postal address printed in the promo footer. NOT `VITE_` vars — the browser never calls them, so no endpoints.ts/config.ts/CSP wiring. | Either empty (current state for both) ⇒ **promotional sends are skipped entirely** (fail closed — a promo without a working unsubscribe/postal address is a CAN-SPAM violation); transactional annual expiry notices are unaffected. |
| `VITE_TEST_MODE` | Dev-only switch arming the fake Google/Gmail/Stripe shims (`src/lib/testMode.ts`). Set to `1` ONLY by the committed `.env.test` via `npm run dev:test`. | Unset = real integrations (normal). Never set it in `.env.local` or Amplify Console — in `.env.local` it arms the fakes for every plain `npm run dev`; prod builds are immune (`import.meta.env.DEV` gate). |
