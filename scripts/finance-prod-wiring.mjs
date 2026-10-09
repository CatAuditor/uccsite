#!/usr/bin/env node
// finance-prod-wiring.mjs — the hand-managed IAM piece the admin's Costs
// page needs on prod (docs/systems/finance.md "Env / IAM"), idempotent:
// one statement `FinanceRead` in the admin SSR role's inline policy
// (UccProdAdminCompute / admin-runtime) granting
//   ce:GetCostAndUsage                 (AWS bill by service and month)
//   secretsmanager:GetSecretValue      on ucc/<env>/STRIPE_SECRET_KEY only
//                                      (the Stripe balance + fees)
// Appended as its own statement; nothing else in the policy is touched. The
// Amplify branch already carries UCC_ENV, from which lib/finance.js derives
// the secret name — nothing to set there.
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/finance-prod-wiring.mjs [--env prod] [--role UccProdAdminCompute] [--policy admin-runtime]
import { IAMClient, GetRolePolicyCommand, PutRolePolicyCommand } from '@aws-sdk/client-iam';
import { SecretsManagerClient, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { resolveEnv, argValue } from './lib/stack.mjs';

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'prod');
const roleName = argValue(args, '--role', 'UccProdAdminCompute');
const policyName = argValue(args, '--policy', 'admin-runtime');
const { region } = await resolveEnv(envName, []);

const secretName = `ucc/${envName}/STRIPE_SECRET_KEY`;
const { ARN: secretArn } = await new SecretsManagerClient({ region }).send(new DescribeSecretCommand({ SecretId: secretName }));

const iam = new IAMClient({ region });
const current = await iam.send(new GetRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }));
const doc = JSON.parse(decodeURIComponent(current.PolicyDocument));
const wanted = [
  { Effect: 'Allow', Action: 'ce:GetCostAndUsage', Resource: '*' },
  { Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: secretArn },
];
const existing = doc.Statement.find((s) => s.Sid === 'FinanceRead' || s.Sid === 'FinanceReadStripe');
const same = doc.Statement.some((s) => s.Sid === 'FinanceRead' && s.Action === 'ce:GetCostAndUsage')
  && doc.Statement.some((s) => s.Sid === 'FinanceReadStripe' && s.Resource === secretArn);
if (same) console.log(`ok  ${roleName}/${policyName} already grants FinanceRead + FinanceReadStripe`);
else {
  doc.Statement = doc.Statement.filter((s) => s.Sid !== 'FinanceRead' && s.Sid !== 'FinanceReadStripe');
  doc.Statement.push({ Sid: 'FinanceRead', ...wanted[0] }, { Sid: 'FinanceReadStripe', ...wanted[1] });
  await iam.send(new PutRolePolicyCommand({ RoleName: roleName, PolicyName: policyName, PolicyDocument: JSON.stringify(doc) }));
  console.log(`ok  ${roleName}/${policyName}: ${existing ? 'replaced' : 'added'} FinanceRead (ce:GetCostAndUsage) + FinanceReadStripe (GetSecretValue on ${secretName})`);
}
