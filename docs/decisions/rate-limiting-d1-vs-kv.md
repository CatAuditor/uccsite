# Rate Limiting: D1 over KV

**Status (2026-09-13):** superseded on AWS — the same sliding-window table lives in Aurora DSQL (`rate_limits`, `aws/api`); the D1-vs-KV trade-off is Cloudflare-only and retires at cutover. Kept as history.

Used D1 for rate limiting instead of Cloudflare KV because D1 is already bound (`env.DB`). Adding KV would require a new binding and wrangler config change. For low-traffic civic org site, D1 latency is acceptable.

Tradeoff: D1 writes on every request add ~5-10ms. Acceptable given traffic volume.
