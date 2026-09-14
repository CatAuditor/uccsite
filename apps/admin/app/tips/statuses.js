// Tip triage statuses. A 'use server' module may only export async functions,
// so the constant lives here. Imported rows may carry other Airtable values;
// the picker lists those too so they stay selectable.
export const STATUSES = ['New', 'In review', 'Closed'];

// Strict UUID check so a malformed id 404s instead of reaching Postgres.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || ''));
