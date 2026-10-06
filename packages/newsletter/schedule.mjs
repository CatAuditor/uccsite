// Scheduling helpers for newsletters. The admin's "send at" field is a
// datetime-local value typed in Mountain time (America/Denver, DST-aware);
// the database stores UTC. Dependency-free (Intl only) so the client bundle
// can import it for the preview label.

export const ZONE = 'America/Denver';
export const ZONE_LABEL = 'Mountain time';
export const MIN_LEAD_MINUTES = 5;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// offsetMinutes(utcMs, zone) → the zone's UTC offset at that instant (MDT = -360).
function offsetMinutes(utcMs, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - utcMs) / 60000);
}

// zonedLocalToUtc('2026-10-06T09:00', zone) → Date (UTC instant) | null when malformed.
// Two passes resolve the offset across a DST boundary; in the skipped hour
// the later offset wins (the time is moved forward, never sent twice).
export function zonedLocalToUtc(local, zone = ZONE) {
  const m = LOCAL_RE.exec(String(local || '').trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(guess)) return null;
  const cand1 = guess - offsetMinutes(guess, zone) * 60000;
  const cand2 = guess - offsetMinutes(cand1, zone) * 60000;
  // Whichever candidate reads back as the typed time is right; in the
  // skipped hour neither does, so take the later instant (moved forward).
  if (toLocalInput(cand2, zone) === local) return new Date(cand2);
  if (toLocalInput(cand1, zone) === local) return new Date(cand1);
  return new Date(Math.max(cand1, cand2));
}

// toLocalInput(isoOrDate, zone) → 'YYYY-MM-DDTHH:mm' for a datetime-local default.
export function toLocalInput(value, zone = ZONE) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`;
}

// formatZoned(isoOrDate, zone) → 'Tue, Oct 6, 2026, 9:00 AM MDT' ('' when unset).
export function formatZoned(value, zone = ZONE) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}

// parseSchedule(local, now) → { at: Date|null } ; throws when the time is in
// the past or sooner than MIN_LEAD_MINUTES (a reviewer needs time to act).
export function parseSchedule(local, now = new Date()) {
  if (!String(local || '').trim()) return { at: null };
  const at = zonedLocalToUtc(local);
  if (!at) throw new Error('Send time must be a date and time (YYYY-MM-DD HH:MM).');
  if (at.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60000) {
    throw new Error(`Send time must be at least ${MIN_LEAD_MINUTES} minutes from now (${ZONE_LABEL}).`);
  }
  return { at };
}
