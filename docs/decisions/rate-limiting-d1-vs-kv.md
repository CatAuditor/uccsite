# Rate Limiting: D1 over KV

Used D1 for rate limiting instead of Cloudflare KV because D1 is already bound (`env.DB`). Adding KV would require a new binding and wrangler config change. For low-traffic civic org site, D1 latency is acceptable.

Tradeoff: D1 writes on every request add ~5-10ms. Acceptable given traffic volume.
