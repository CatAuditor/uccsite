import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { aliasTokens, fillText, fillHtml, receiptHtml, receiptText, sampleVars, formatAmount, recipientVars } = require('../fill.cjs');

test('recipientVars: the mailing-list name, "there" when none, trimmed', () => {
  assert.deepEqual(recipientVars({ firstName: ' Ada ', lastName: 'L', email: 'a@x.y' }), { text: { first_name: 'Ada', last_name: 'L', email: 'a@x.y' } });
  assert.deepEqual(recipientVars({ email: 'a@x.y' }).text, { first_name: 'there', last_name: '', email: 'a@x.y' });
  assert.equal(fillText('Hi {first_name}, [First name]!', recipientVars({}).text), 'Hi there, there!');
});

test('bracket aliases: known placeholders only, case-insensitive, $ ignored; other brackets untouched', () => {
  const known = { first_name: 1, amount: 1 };
  assert.equal(aliasTokens('Hi [First name], [$amount] [AMOUNT] [CHECK: x] [website link]', known), 'Hi {first_name}, {amount} {amount} [CHECK: x] [website link]');
});

test('fillText replaces verbatim; unknown tokens stay', () => {
  assert.equal(fillText('Hi {first_name} {nope} [First name]', { first_name: '<A>' }), 'Hi <A> {nope} <A>');
});

test('fillHtml escapes text values, inserts raw ones, and unwraps a raw token that is a paragraph of its own', () => {
  const out = fillHtml('<p style="m">Hi {first_name}</p><p class="em-text" style="x">{receipt}</p><p>in {receipt} line</p>', { text: { first_name: '<A>' }, raw: { receipt: '<table>R</table>' } });
  assert.equal(out, '<p style="m">Hi &lt;A&gt;</p><table>R</table><p>in <table>R</table> line</p>');
  assert.equal(fillHtml('<p>[Receipt]</p>', { raw: { receipt: '<b>r</b>' } }), '<b>r</b>');
});

test('receipt html + text agree; monthly adds the cancel line; sampleVars covers every trigger placeholder', () => {
  const r = { amount: '$10.00', recurring: true, date: 'June 1, 2026' };
  assert.match(receiptHtml(r), /\$10\.00 \/ month[\s\S]*Monthly membership[\s\S]*June 1, 2026[\s\S]*<strong>not<\/strong> tax-deductible[\s\S]*mailto:info@/);
  assert.equal(receiptText(r), 'Amount: $10.00 / month\nType: Monthly membership\nDate: June 1, 2026\n\nUtah Civic Compact is a 501(c)(4) social welfare organization. Contributions are not tax-deductible as charitable donations. Keep this email for your records. To change or cancel your monthly membership, email info@utahciviccompact.org.');
  assert.ok(!receiptText({ ...r, recurring: false }).includes('cancel'));
  const v = sampleVars({ firstName: 'Jo', when: new Date('2026-06-01T18:00:00Z') });
  for (const k of ['first_name', 'headline', 'project_name', 'amount', 'type', 'date', 'receipt']) assert.ok(k in v.text, k);
  assert.match(v.raw.receipt, /<table/);
  assert.equal(v.text.date, 'June 1, 2026');
  assert.equal(formatAmount(123456), '$1,234.56');
  assert.equal(formatAmount(0), '');
});
