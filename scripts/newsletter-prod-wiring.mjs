#!/usr/bin/env node
// newsletter-prod-wiring.mjs — the two hand-managed pieces the admin needs
// to start a newsletter send on prod (docs/systems/newsletters.md "Env /
// IAM"), both idempotent:
//   1. lambda:InvokeFunction on the NewsletterSendFn ARN in the admin SSR
//      role's inline policy (UccProdAdminCompute / admin-runtime) — appended
//      as its own statement; nothing else in the policy is touched.
//   2. NEWSLETTER_FUNCTION_NAME in the Amplify app's env vars (merged into
//      the existing map — update-app replaces the whole map, so read first).
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/newsletter-prod-wiring.mjs [--app-id dmfjtx0gh1s1n] [--role UccProdAdminCompute] [--policy admin-runtime]
import { IAMClient, GetRolePolicyCommand, PutRolePolicyCommand } from '@aws-sdk/client-iam';
import { AmplifyClient, GetAppCommand, UpdateAppCommand } from '@aws-sdk/client-amplify';
import { resolveEnv, argValue } from './lib/stack.mjs';

const args = process.argv.slice(2);
const appId = argValue(args, '--app-id', 'dmfjtx0gh1s1n');
const roleName = argValue(args, '--role', 'UccProdAdminCompute');
const policyName = argValue(args, '--policy', 'admin-runtime');
const { region, outputs } = await resolveEnv('prod', ['NewsletterFunctionName', 'NewsletterFunctionArn']);

const iam = new IAMClient({ region });
const current = await iam.send(new GetRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }));
const doc = JSON.parse(decodeURIComponent(current.PolicyDocument));
const has = doc.Statement.some((s) => s.Sid === 'NewsletterSend');
if (has) console.log(`ok  ${roleName}/${policyName} already grants NewsletterSend`);
else {
  doc.Statement.push({ Sid: 'NewsletterSend', Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: outputs.NewsletterFunctionArn });
  await iam.send(new PutRolePolicyCommand({ RoleName: roleName, PolicyName: policyName, PolicyDocument: JSON.stringify(doc) }));
  console.log(`ok  ${roleName}/${policyName}: added lambda:InvokeFunction on ${outputs.NewsletterFunctionArn}`);
}

const amplify = new AmplifyClient({ region });
const { app } = await amplify.send(new GetAppCommand({ appId }));
const env = { ...(app.environmentVariables || {}) };
if (env.NEWSLETTER_FUNCTION_NAME === outputs.NewsletterFunctionName) console.log(`ok  Amplify ${appId} already has NEWSLETTER_FUNCTION_NAME`);
else {
  env.NEWSLETTER_FUNCTION_NAME = outputs.NewsletterFunctionName;
  await amplify.send(new UpdateAppCommand({ appId, environmentVariables: env }));
  console.log(`ok  Amplify ${appId}: NEWSLETTER_FUNCTION_NAME=${outputs.NewsletterFunctionName} (takes effect on the next build — the next push)`);
}
