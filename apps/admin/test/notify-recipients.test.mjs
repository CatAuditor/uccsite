import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishReviewRecipients, publishRequestEmail, PUBLISH_REVIEWERS } from '../lib/notify-recipients.mjs';

test('an editor request on prod mails every reviewer except the requester', () => {
  const to = publishReviewRecipients({ requestedBy: 'Clark.Dice@utahciviccompact.org', role: 'editor', envName: 'prod' });
  assert.deepEqual(to, PUBLISH_REVIEWERS.filter((e) => e !== 'clark.dice@utahciviccompact.org'));
  assert.equal(to.length, 3);
});

test('an owner request mails nobody — owners approve their own', () => {
  assert.deepEqual(publishReviewRecipients({ requestedBy: 'x@utahciviccompact.org', role: 'owner', envName: 'prod' }), []);
  assert.deepEqual(publishReviewRecipients({ requestedBy: 'x@y', role: 'owner', envName: 'staging', override: 'a@b' }), []);
});

test('off prod nothing is sent unless PUBLISH_NOTIFY_TO is set', () => {
  assert.deepEqual(publishReviewRecipients({ requestedBy: 'test-editor@x', role: 'editor', envName: 'staging' }), []);
  assert.deepEqual(
    publishReviewRecipients({ requestedBy: 'a@b', role: 'editor', envName: 'staging', override: ' a@b, success@simulator.amazonses.com ,' }),
    ['success@simulator.amazonses.com'],
  );
});

test('email escapes content and links to the dashboard', () => {
  const { subject, html } = publishRequestEmail({
    requestedBy: 'ed@x', note: '<b>look</b>', appOrigin: 'https://admin.example',
    changes: [{ action: 'blog.save', entityId: 'a&b', actor: 'ed@x', at: '2026-10-05T20:00:00Z' }],
  });
  assert.equal(subject, 'Publish request from ed@x needs a review');
  assert.match(html, /&lt;b&gt;look&lt;\/b&gt;/);
  assert.match(html, /a&amp;b/);
  assert.match(html, /href="https:\/\/admin\.example\/"/);
  assert.match(html, /1 saved change to/);
});
