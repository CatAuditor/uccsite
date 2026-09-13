// parseFreeDate(text) → ms timestamp | NaN. Content dates are free text
// ("August 2026", "June 4, 2026", "2026-06-04"). Date.parse of month-year
// strings is implementation-defined (Safari returns NaN), so both the site
// (deriveProjectFilters) and the admin's "newest first" use THIS parser.
// Dependency-free so the client bundle can import it.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function parseFreeDate(text) {
  const s = String(text || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
  if (!s) return NaN;
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/); // ISO
  if (m) return Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1));
  m = s.match(/^([a-z]+)\.? (?:(\d{1,2}) )?(\d{4})$/); // "august 2026", "june 4 2026"
  if (m) {
    const month = MONTHS.findIndex(name => name === m[1] || name.slice(0, 3) === m[1]);
    if (month >= 0) return Date.UTC(+m[3], month, +(m[2] || 1));
  }
  m = s.match(/^(\d{1,2}) ([a-z]+)\.? (\d{4})$/); // "4 june 2026"
  if (m) {
    const month = MONTHS.findIndex(name => name === m[2] || name.slice(0, 3) === m[2]);
    if (month >= 0) return Date.UTC(+m[3], month, +m[1]);
  }
  m = s.match(/^(\d{4})$/);
  if (m) return Date.UTC(+m[1], 0, 1);
  return NaN;
}
