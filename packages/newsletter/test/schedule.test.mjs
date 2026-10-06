import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedLocalToUtc, toLocalInput, formatZoned, parseSchedule, MIN_LEAD_MINUTES } from '../schedule.mjs';

test('Mountain local → UTC across DST (MDT -6, MST -7)', () => {
  assert.equal(zonedLocalToUtc('2026-10-06T09:00').toISOString(), '2026-10-06T15:00:00.000Z'); // MDT
  assert.equal(zonedLocalToUtc('2026-12-06T09:00').toISOString(), '2026-12-06T16:00:00.000Z'); // MST
  assert.equal(zonedLocalToUtc('2026-03-08T02:30').toISOString(), '2026-03-08T09:30:00.000Z'); // skipped hour → moved forward
  assert.equal(zonedLocalToUtc('garbage'), null);
  assert.equal(zonedLocalToUtc(''), null);
});

test('round trip through the datetime-local input', () => {
  assert.equal(toLocalInput('2026-10-06T15:00:00.000Z'), '2026-10-06T09:00');
  assert.equal(toLocalInput('2026-12-06T16:05:00.000Z'), '2026-12-06T09:05');
  assert.equal(toLocalInput('nope'), '');
});

test('formatZoned labels the zone', () => {
  assert.match(formatZoned('2026-10-06T15:00:00.000Z'), /Oct 6, 2026.*9:00 AM MDT/);
  assert.equal(formatZoned(''), '');
});

test('parseSchedule: empty = now; past or too soon refused', () => {
  const now = new Date('2026-10-06T15:00:00.000Z');
  assert.deepEqual(parseSchedule('', now), { at: null });
  assert.equal(parseSchedule('2026-10-06T10:00', now).at.toISOString(), '2026-10-06T16:00:00.000Z');
  assert.throws(() => parseSchedule('2026-10-06T08:00', now), new RegExp(`${MIN_LEAD_MINUTES} minutes`));
  assert.throws(() => parseSchedule('2026-10-06T09:02', now), /minutes from now/);
  assert.throws(() => parseSchedule('2026-10-06', now), /date and time/);
});
