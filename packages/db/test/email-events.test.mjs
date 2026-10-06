import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classify, SUPPRESSED_SQL } = require('../email-events.js');
const { AUDIENCE_ROWS_SQL } = require('../audience.js');

test('classify: permanent bounce + complaint suppress; transient bounce and reject do not', () => {
  const mail = { messageId: 'm1', destination: ['A@x.y'] };
  assert.deepEqual(classify({ eventType: 'Bounce', mail, bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'A@x.y', diagnosticCode: '550 no such user' }] } }),
    [{ email: 'a@x.y', type: 'bounce', subtype: 'Permanent/General', suppress: 1, messageId: 'm1', detail: '550 no such user' }]);
  assert.equal(classify({ eventType: 'Bounce', mail, bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', bouncedRecipients: [{ emailAddress: 'a@x.y' }] } })[0].suppress, 0);
  assert.equal(classify({ eventType: 'Complaint', mail, complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'a@x.y' }] } })[0].suppress, 1);
  const rej = classify({ eventType: 'Reject', mail, reject: { reason: 'Bad content' } });
  assert.equal(rej[0].type, 'reject'); assert.equal(rej[0].suppress, 0);
  // the account-suppression-list bounce SES emits for already-suppressed addresses
  assert.equal(classify({ notificationType: 'Bounce', mail, bounce: { bounceType: 'Permanent', bounceSubType: 'OnAccountSuppressionList', bouncedRecipients: [{ emailAddress: 'a@x.y' }] } })[0].suppress, 1);
  assert.deepEqual(classify({ eventType: 'Send', mail }), []);
  assert.deepEqual(classify(null), []);
});

test('the audience skips suppressed addresses and unconfirmed join-form rows', () => {
  assert.ok(AUDIENCE_ROWS_SQL.includes(`NOT ${SUPPRESSED_SQL('s.email')}`));
  assert.ok(AUDIENCE_ROWS_SQL.includes(`NOT ${SUPPRESSED_SQL('mm.email')}`));
  assert.ok(AUDIENCE_ROWS_SQL.includes('s.confirmed_at IS NOT NULL'));
});
