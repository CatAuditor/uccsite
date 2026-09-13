# packages/db: "require is not defined in ES module scope"

**Date:** 2026-09-12 · **Where:** `node scripts/publish.mjs` (first run)

## Error

```
const { DsqlSigner } = require('@aws-sdk/dsql-signer');
ReferenceError: require is not defined in ES module scope
This file is being treated as an ES module because ... package.json contains "type": "module"
```

## Cause

`packages/db/package.json` was scaffolded in Phase 0 with `"type": "module"`,
but the Phase 4 implementation of `index.js` was written CommonJS (matching
every other `@uccsite/*` package). Node honored the package type and parsed
the CJS file as ESM.

## Fix

`"type": "commonjs"` in packages/db/package.json. Repo convention: all
`@uccsite/*` workspace packages are CommonJS; `.mjs` entrypoints (scripts,
Lambda handlers) are the ESM boundary.

## What would catch it earlier

Any test in the package — packages/db had none when scaffolded. It now sits on
every publish/reconcile path, which exercises it constantly.
