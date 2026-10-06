'use server';
// The "Request publish" button beside every Save button (app/request-publish.js)
// calls this. Same rules as the dashboard form — lib/publish.js requestPublish —
// just without the optional note.
import { revalidatePath } from 'next/cache';
import { requestPublish } from '../lib/publish';
import { runAction } from '../lib/actions';

export async function requestPublishInline() {
  return runAction(async () => {
    const { needsReview, notified } = await requestPublish('');
    revalidatePath('/');
    return {
      ok: true,
      message: needsReview
        ? `Publish requested — ${notified ? 'the other admins have been emailed to review it' : 'an owner or another editor has to approve it on Publish & Status'}.`
        : 'Publish requested — approve it on Publish & Status.',
    };
  });
}
