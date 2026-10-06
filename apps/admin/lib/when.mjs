// Timestamps for people (pure, tested). DSQL hands the admin `at::text` /
// `started_at::text` like "2026-10-06 03:14:16.177+00" — UTC. Until 2026-10-05
// the dashboard sliced that string and showed a bare UTC clock, 6-7 hours off
// the wall clock in Utah. Everything user-facing now goes through when().
const TZ = 'America/Denver';

// parseDbTime(text) → Date | null. Accepts the DSQL text forms (space or T,
// optional fraction of any length, "+00" or "+00:00" offset) and ISO strings.
export function parseDbTime(text) {
  if (!text) return null;
  const iso = String(text).trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// when(text) → "Oct 5, 9:14 PM MT" ('' for null/garbage). seconds: true adds :ss.
export function when(text, { seconds = false } = {}) {
  const d = parseDbTime(text);
  if (!d) return '';
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  }).format(d);
  return `${s} MT`;
}
