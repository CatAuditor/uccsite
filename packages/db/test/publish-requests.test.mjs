import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CONTENT_ACTION_RE } = require('../publish-requests.js');

// Every action name the admin records for a content save must count as
// unpublished — a miss here makes "Request publish" say "Nothing to publish"
// after a real save (petition.save, 2026-10-05).
test('every content save action counts for publishing', () => {
  for (const a of ['settings.save', 'homepage.save', 'team.save', 'statements.save', 'issues.save', 'blog.save',
    'blog-articles.save', 'projects.save', 'press.save', 'coverage.save', 'coverage-strips.save', 'document.save', 'document.create',
    'document.override', 'media.alt', 'media.delete', 'redirect.save', 'redirect.delete', 'style_rule.create',
    'foreign_class.map', 'petition.save', 'appeals.save', 'homepage.restore', 'team.restore']) {
    assert.ok(CONTENT_ACTION_RE.test(a), `${a} should count as content`);
  }
});

test('bookkeeping actions do not count', () => {
  for (const a of ['publish.request', 'publish.approve', 'account.password_changed', 'user.invite', 'tip.status', 'files.publish_request', 'petition.export', 'subscribers.export']) {
    assert.equal(CONTENT_ACTION_RE.test(a), false, `${a} should not count`);
  }
});
