# pg DeprecationWarning: client.query() while already executing a query

**Date:** 2026-09-13

## Symptom
Admin dev server prints:

```
(node:5592) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
```

## Root cause
Two places ran several queries on ONE `pg.Client` (from `withDb`) inside a
`Promise.all`: `editorData` in `apps/admin/lib/documents.js` (rules,
overrides, foreign class map, settings) and the Files page
(`apps/admin/app/files/page.js`: `listFiles` + `listProjects`). pg 8 queues
the extra queries and warns; pg 9 will throw.

## Fix
Both sites await the queries sequentially. `loadSiteSources()` (no DB) is
awaited last in `editorData`. Other `Promise.all` calls in the admin fan out
over S3 presign calls, not DB queries, and are unchanged.

## What would catch it earlier
Run the admin with `node --trace-deprecation` once after adding any
`Promise.all` that receives a `client`.
