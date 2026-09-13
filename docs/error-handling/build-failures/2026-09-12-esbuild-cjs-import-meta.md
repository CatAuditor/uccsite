# Lambda TypeError: createRequire(import.meta.url) undefined after esbuild bundling

**Date:** 2026-09-12 · **Where:** reconcile-drift Lambda (NodejsFunction)

## Error

```
TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' must be a file URL
object, file URL string, or absolute path string. Received undefined
    at createRequire (node:internal/modules/cjs/loader)
```

at Lambda cold start, first invocation.

## Cause

CDK's `NodejsFunction` bundles with esbuild to **CJS** output by default (no
`format` set). In CJS output, `import.meta.url` compiles to `undefined`, so
the ESM-source idiom `createRequire(import.meta.url)` explodes at module load.

## Fix

Don't use `createRequire` in Lambda entry sources — a plain
`import { x } from 'pkg'` of a CJS workspace package bundles fine (esbuild
handles ESM-source→CJS-dep interop itself).

## What would catch it earlier

Any invocation of the function (the error is at module init). This class of
bug passes synth + deploy; the phase verification (`scripts/staging-check.mjs`
or a direct `aws lambda invoke`) after every deploy catches it. Rule of thumb
for every NodejsFunction in this repo: no `import.meta.*` in bundled sources.
