# 2026-10-06 — Authoring-kit classes stripped on save: prod bucket served stale site CSS

## Symptom

After the "Document prose" group was added to `css/styles.css` and pushed
(v0.18.2), documents written with the authoring kit still arrived unstyled
in the admin: `prose`, `callout`, `callout-label`, `callout-dark` were
reported as unknown classes and stripped on save, the kit download listed
them under "Not in the current stylesheet", and the editor preview showed
bare text. User report: "it's still being fucky".

## Route / component

- `apps/admin/lib/documents.js loadSiteSources()` reads `css/styles.css`
  from the **site bucket** (`config.siteBucket`, prod), cached 5 minutes;
  `styleKitFor()` builds `knownClasses` from it; `html-ingest` strips any
  class not in that set.
- `apps/admin/app/documents/authoring-kit/route.js` builds the kit from
  the same bucket copy.

## Root cause

The publish Lambda does not read `css/` from git at publish time. The site
source (`templates`, `css`, `js`, `assets`, ...) is **bundled into the
Lambda asset at `cdk deploy`** (`infra/cdk/copy-site-src.js`, list =
`aws/publish/inputs.js SITE_SRC_*`). A git push therefore changes nothing
on the live site until the stack is redeployed AND a publish runs. Prod had
been published at 01:34 MDT with the old bundle: bucket `css/styles.css`
was 64,603 bytes without the group. Staging had already been redeployed and
carried it (69,967 bytes).

## Fix

1. `cd infra/cdk; npx cdk deploy UccProd --profile uccsite --require-approval never`
   (diff: PublishFn and MediaProcessFn code assets only; 67 s).
2. Invoke the publish Lambda as the admin's button does:
   `UccProd-PublishFnB0C9E186-WouF4oexSmRN`, payload `{"trigger":"manual"}`
   → `{"status":"succeeded","changed":34,"removed":0}` + invalidation.
3. Verified bucket and live `https://utahciviccompact.org/css/styles.css`
   contain `DOCUMENT PROSE`.

The admin's 5-minute source cache means a kit downloaded within 5 minutes
of the publish can still show the old catalog; download again after that.

## What would catch it earlier

- Done 2026-10-06 evening: `loadSiteSources` compares the bucket stylesheet
  with the admin build's repo copy and the difference is shown as a red
  banner on the Documents editor and the Styles page and as the first block
  of the downloaded kit (`siteCssDrift`, docs/systems/documents.md).
- Any change under `css/`, `js/`, `assets/` or `templates/` is a **deploy +
  publish**, not a push. Noted in `docs/systems/publish-pipeline.md` and
  `docs/systems/documents.md` (Style Kit source). A future improvement: the
  admin's Styles page could show the bucket stylesheet's size/mtime next to
  the repo copy's, or the publish could read site source from a git-synced
  S3 prefix instead of the Lambda bundle.
