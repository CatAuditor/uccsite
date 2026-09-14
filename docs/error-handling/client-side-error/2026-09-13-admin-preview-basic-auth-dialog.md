# Browser Basic-auth sign-in dialog on the admin document editor (staging)

**Date:** 2026-09-13

## Symptom
Signed-in admin user opens a report under `/documents/<id>` and the browser
shows a native "Sign in — https://d3heb9s058a59m.cloudfront.net" username /
password dialog over the page.

## Route / component
`apps/admin/app/documents/[id]` → `style-editor.js` preview iframe (`srcDoc`,
`sandbox="allow-scripts"`), HTML built by `editorData` in
`apps/admin/lib/documents.js`.

## Root cause
The preview HTML carries `<base href="<PUBLIC_ORIGIN>/">` and loads
`<PUBLIC_ORIGIN>/css/fonts.css`, so fonts, `/assets/*` and `/media/*` images
are fetched from the staging CloudFront distribution. Its viewer-request
function returned `401` + `WWW-Authenticate: Basic realm="staging"` for every
URI, and the browser turns that into a credential prompt. The admin's Cognito
session is unrelated to CloudFront and cannot satisfy the gate.

## Fix
`infra/cdk/cf-fn/viewer-request.js`: `/css/`, `/assets/`, `/media/` bypass the
basic-auth check (pages stay gated). Redeployed `UccStaging`.
`scripts/staging-check.mjs` now asserts unauthenticated `/css/styles.css`
is 200. Decision: `docs/decisions/staging-basic-auth-asset-exemption.md`.

## Repro (before fix)
`curl -I https://d3heb9s058a59m.cloudfront.net/css/fonts.css` → 401 with a
`www-authenticate` header. After: 200.
