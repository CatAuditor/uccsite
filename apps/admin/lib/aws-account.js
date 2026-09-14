// Wrong-account guard. Locally the SDK's default credential chain silently
// picks whatever profile is active; if that is the personal default profile
// every DSQL connect fails with an opaque "access denied" (see
// docs/error-handling/client-side-error/2026-09-13-admin-dev-wrong-aws-profile.md).
// scripts/admin-env.mjs writes UCC_ACCOUNT_ID from the stack ARN; when it is
// set, the first DB use (and instrumentation.js at boot) checks the caller
// account once per process and refuses loudly on mismatch. Unset on Amplify
// Hosting (the SSR compute role is always the right account) → no-op.
// Reads env directly (not lib/config.js): instrumentation.js bundles this
// file, and config.js's require('node:path') does not survive that bundle.
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

let checked = null;

export function assertAwsAccount() {
  const expected = process.env.UCC_ACCOUNT_ID;
  if (!expected) return Promise.resolve();
  checked ??= (async () => {
    const { Account, Arn } = await new STSClient({ region: process.env.UCC_REGION || 'us-west-2' }).send(new GetCallerIdentityCommand({}));
    if (Account !== expected) {
      throw new Error(`AWS credentials resolve to account ${Account} (${Arn}) but UCC_ENV=${process.env.UCC_ENV || 'staging'} lives in ${expected}. Restart with AWS_PROFILE=uccsite.`);
    }
    console.log(`[admin] AWS credentials OK: account ${Account} (${Arn})`);
  })().catch((err) => { checked = null; throw err; }); // transient STS failure → retry next call
  return checked;
}
