// Review-request email through Amazon SES (docs/systems/email.md). Same
// identity, From and configuration set as the API's sesSend; auth is the
// admin's SSR compute role (ses:SendEmail, From pinned by IAM condition).
// Never throws: the request row is already committed when this runs, and a
// mail failure must not make the editor think the request was lost.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from './config';
import { publishReviewRecipients, publishRequestEmail } from './notify-recipients.mjs';

const FROM_ADDRESS = 'Utah Civic Compact <hello@utahciviccompact.org>';
let client = null;

// notifyPublishRequested({ requestedBy, role, note, changes }) → number of
// recipients mailed (0 = skipped or failed; the log line says which).
export async function notifyPublishRequested({ requestedBy, role, note, changes }) {
  const to = publishReviewRecipients({
    requestedBy, role, envName: config.envName, override: process.env.PUBLISH_NOTIFY_TO,
  });
  if (!to.length) {
    console.log(`[admin] publish notify skipped (${role === 'owner' ? 'owner request' : `no recipients on ${config.envName}`})`);
    return 0;
  }
  const { subject, html } = publishRequestEmail({ requestedBy, note, changes, appOrigin: config.appOrigin });
  try {
    client ||= new SESv2Client({ region: config.region, requestHandler: { requestTimeout: 8000 } });
    const res = await client.send(new SendEmailCommand({
      FromEmailAddress: FROM_ADDRESS,
      Destination: { ToAddresses: to },
      Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Html: { Data: html, Charset: 'UTF-8' } } } },
      ...(config.envName === 'prod' ? { ConfigurationSetName: 'ucc-prod' } : {}),
    }));
    console.log(`[admin] publish notify sent ${res.MessageId} to ${to.length} reviewer(s)`);
    return to.length;
  } catch (err) {
    console.error(`[admin] publish notify SES error: ${err?.name} ${err?.message}`);
    return 0;
  }
}
