// Which automatic email goes out for a trigger — the dropdown on the Petition
// page (petition-thanks) and the Appeals page (donation-thanks). Options are
// the automatic emails composed under Mail → Outgoing emails; "Built-in email"
// = the fixed body in aws/api/emails.js. Choosing freezes that draft for the
// trigger (lib/transactional.js chooseEmail) — swap any time, no publish.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { automaticEmails, transactionalSlot, chooseEmail } from '../lib/transactional';
import { runAction } from '../lib/actions';
import ActionForm from './action-form';

const when = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

export default async function AutomaticEmailPicker({ trigger, readOnly, revalidate = [] }) {
  const [slot, emails] = await Promise.all([transactionalSlot(trigger), automaticEmails()]);
  const current = slot.attachment;
  const currentEmail = current ? emails.find((e) => e.id === current.newsletterId) : null;

  async function choose(prev, formData) {
    'use server';
    return runAction(async () => {
      const { label, builtIn } = await chooseEmail(trigger, String(formData.get('email') || ''));
      for (const p of revalidate) revalidatePath(p);
      revalidatePath('/mail');
      return { ok: true, message: builtIn ? 'Back to the built-in email.' : `"${label}" now goes out — frozen as it is saved right now.` };
    });
  }

  return (
    <fieldset className="item">
      <legend>{slot.label}</legend>
      <p className="hint">
        Sent {slot.when}. Pick one of the automatic emails written under <Link href="/mail">Outgoing emails</Link>, or the
        built-in email. The chosen email is frozen when you pick it — after editing it there, pick it again here.
        {slot.placeholders.length ? <> Placeholders it may use: {slot.placeholders.map((p) => `{${p}}`).join(' ')}{slot.required.length ? ` (${slot.required.map((p) => `{${p}}`).join(' ')} required)` : ''}.</> : null}
      </p>
      {current && (
        <p>
          Now going out: <strong>{currentEmail?.subject || current.subject}</strong> — chosen {when(current.attachedAt)} by {current.attachedBy || 'an admin'}
          {currentEmail && currentEmail.updatedAt > current.attachedAt ? <> · <em>edited since; pick it again to send the new version</em></> : null}.
        </p>
      )}
      {!current && <p>Now going out: <strong>built-in email</strong>.</p>}
      {!readOnly && (
        <ActionForm action={choose} className="inline">
          <label htmlFor={`email-${trigger}`}>Email to send</label>
          <select id={`email-${trigger}`} name="email" defaultValue={current?.newsletterId || ''}>
            <option value="">Built-in email</option>
            {emails.map((e) => <option key={e.id} value={e.id}>{e.subject || '(no subject)'}</option>)}
          </select>
          <button type="submit">Use this email</button>
          {' '}<Link href="/mail">Write a new one →</Link>
        </ActionForm>
      )}
    </fieldset>
  );
}
